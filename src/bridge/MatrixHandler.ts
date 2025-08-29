/**
 * Matrix event handler for Google Play Bridge
 */

import { Bridge, WeakEvent, Request } from 'matrix-appservice-bridge';
import { UserManager } from '../models/User';
import { RoomManager } from '../models/Room';
import { MessageManager, MatrixMessage } from '../models/Message';
import { Config } from '../utils/Config';
import { Logger } from '../utils/Logger';
import { AppManager } from '../managers/AppManager';
import { BridgeCommands } from './BridgeCommands';

export interface MatrixHandlerOptions {
  bridge: Bridge;
  userManager: UserManager;
  roomManager: RoomManager;
  messageManager: MessageManager;
  appManager?: AppManager;
  config: Config;
  googlePlayBridge?: any; // GooglePlayBridge type to avoid circular dependency
}

export interface BridgeCommandHandler {
  handleBridgeCommand(event: WeakEvent): Promise<void>;
}

/**
 * Handles Matrix events and manages bridge interactions
 */
export class MatrixHandler {
  private bridge: Bridge;
  private userManager: UserManager;
  private roomManager: RoomManager;
  private messageManager: MessageManager;
  private appManager: AppManager | undefined;
  private config: Config;
  private logger: Logger;
  private bridgeCommands?: BridgeCommands;

  constructor(options: MatrixHandlerOptions) {
    this.bridge = options.bridge;
    this.userManager = options.userManager;
    this.roomManager = options.roomManager;
    this.messageManager = options.messageManager;
    this.appManager = options.appManager;
    this.config = options.config;
    this.logger = Logger.getInstance();
    
    // Initialize bridge commands with admin users from config (if AppManager is available)
    if (this.appManager) {
      const adminUsers = options.config.bridge?.admins || [];
      this.bridgeCommands = new BridgeCommands(
        this.bridge, 
        this.appManager, 
        options.googlePlayBridge,
        adminUsers
      );
    }
  }

  /**
   * Initialize the Matrix handler
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Matrix handler...');

    // Note: Event handlers will be set up by the bridge's controller
    // This is handled in GooglePlayBridge.ts when creating the Bridge instance

    // Register the bot user
    await this.ensureBotRegistered();

    this.logger.info('Matrix handler initialized successfully');
  }

  /**
   * Handle incoming Matrix events
   */
  async handleEvent(request: Request<WeakEvent>): Promise<void> {
    return this.onEvent(request);
  }

  /**
   * Internal event handler
   */
  private async onEvent(request: Request<WeakEvent>): Promise<void> {
    const event = request.getData();

    try {
      // Skip events from the bridge bot itself
      if (this.isBridgeBotEvent(event)) {
        return;
      }

      this.logger.debug(
        `Received Matrix event: ${event.type} in room ${event.room_id}`
      );

      // Handle different event types
      switch (event.type) {
        case 'm.room.message':
          await this.handleRoomMessage(event);
          break;
        case 'm.room.member':
          await this.handleMemberEvent(event);
          break;
        case 'm.room.create':
          await this.handleRoomCreate(event);
          break;
        default:
          // Log but don't process other event types
          this.logger.debug(`Ignoring event type: ${event.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Error handling Matrix event: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * Handle user queries (for virtual user creation)
   */
  async onUserQuery(
    userId: string,
    _request?: Request<WeakEvent>
  ): Promise<{ name?: string; avatar_url?: string } | null> {
    this.logger.debug(`User query for: ${userId}`);

    // Check if this is a Google Play user we should manage
    if (!this.userManager.isManagedUser(userId)) {
      this.logger.debug(`User ${userId} is not managed by this bridge`);
      return null;
    }

    try {
      // Try to parse the app-specific user namespace
      const namespaceInfo = this.appManager?.parseUserNamespace(userId);
      if (namespaceInfo && this.appManager) {
        const { packageName, userId: reviewId } = namespaceInfo;
        const app = this.appManager.getApp(packageName);
        
        this.logger.info(
          `Creating virtual user: ${userId} for app ${packageName} (reviewer ${reviewId})`
        );

        // Try to get display name from user manager
        const user = this.userManager.getMatrixUser(userId);
        if (user) {
          return {
            name: user.displayName,
            ...(user.avatarUrl && { avatar_url: user.avatarUrl }),
          };
        }

        // Create a name based on the app and review info
        const appName = app?.appName || packageName;
        return {
          name: `${appName} Reviewer ${reviewId.substring(0, 8)}`,
        };
      }

      // Fallback to old pattern for backwards compatibility
      const reviewIdMatch = userId.match(/@_?googleplay_([^:]+):/);
      if (!reviewIdMatch) {
        this.logger.warn(`Invalid Google Play user ID format: ${userId}`);
        return null;
      }

      const reviewId = reviewIdMatch[1];
      const user = this.userManager.getMatrixUser(userId);

      if (user) {
        this.logger.info(
          `Creating virtual user: ${userId} (${user.displayName})`
        );
        return {
          name: user.displayName,
          ...(user.avatarUrl && { avatar_url: user.avatarUrl }),
        };
      }

      // Default response for unknown users
      this.logger.info(`Creating virtual user: ${userId} (Google Play User)`);
      return {
        name: `Google Play User ${reviewId}`,
      };
    } catch (error) {
      this.logger.error(
        `Error handling user query for ${userId}: ${error instanceof Error ? error.message : error}`
      );
      return null;
    }
  }

  /**
   * Handle room queries (for room discovery)
   */
  async onRoomQuery(
    roomAlias: string,
    _request?: Request<WeakEvent>
  ): Promise<{ name?: string; topic?: string } | null> {
    this.logger.debug(`Room query for: ${roomAlias}`);

    // This bridge doesn't create rooms via aliases
    // All rooms are managed explicitly through configuration
    return null;
  }

  /**
   * Handle room message events
   */
  private async handleRoomMessage(event: WeakEvent): Promise<void> {
    if (!event.content || !event.content.body) {
      return;
    }

    const roomId = event.room_id!;
    const senderId = event.sender!;
    const content = event.content as any;

    // Store the Matrix message
    const matrixMessage: MatrixMessage = {
      eventId: event.event_id!,
      roomId,
      senderId,
      content,
      timestamp: new Date(event.origin_server_ts || Date.now()),
      isBridgeMessage: false,
    };

    await this.messageManager.storeMatrixMessage(matrixMessage);

    // Handle bridge admin commands first (but exclude Google Play commands)
    const messageBody = content.body as string;
    if (messageBody.startsWith('!') && !this.isGooglePlayCommand(messageBody)) {
      if (this.bridgeCommands) {
        await this.bridgeCommands.handleMessage(roomId, senderId, messageBody);
      } else {
        this.logger.debug('Bridge commands not available - AppManager not initialized');
      }
      return;
    }

    // Route message to apps for cross-app functionality
    if (this.appManager) {
      await this.appManager.routeMessageToApps(roomId, matrixMessage);
    }

    // Check if this room is configured for Google Play integration using AppManager
    const app = this.appManager?.getAppByRoom(roomId);
    if (!app) {
      // Fallback to old room manager for backwards compatibility
      const roomMapping = await this.roomManager.getRoomMappingByRoomId(roomId);
      if (!roomMapping) {
        this.logger.debug(`Room ${roomId} is not mapped to any Google Play app`);
        return;
      }

      // Check if replies are allowed from this room
      const canReply = await this.roomManager.canSendReply(roomId);
      if (!canReply) {
        this.logger.debug(`Replies not allowed from room ${roomId}`);
        return;
      }

      // Handle potential reply to Google Play (old method)
      await this.handlePotentialReply(event, roomMapping.packageName);
      return;
    }

    // New app-based handling
    if (!app.enabled) {
      this.logger.debug(`App ${app.packageName} is disabled, ignoring message`);
      return;
    }

    // Handle potential reply to Google Play using app configuration
    await this.handleAppSpecificReply(event, app);
  }

  /**
   * Handle member events (joins, leaves, etc.)
   */
  private async handleMemberEvent(event: WeakEvent): Promise<void> {
    const roomId = event.room_id!;
    const userId = event.state_key!;
    const membership = event.content?.membership;

    if (membership === 'join' && userId === this.getBotUserId()) {
      // Bot joined a room
      await this.handleBotJoinedRoom(roomId);
    } else if (membership === 'invite' && userId === this.getBotUserId()) {
      // Bot was invited to a room
      await this.handleBotInvited(roomId, event.sender!);
    }
  }

  /**
   * Handle room creation events
   */
  private async handleRoomCreate(event: WeakEvent): Promise<void> {
    const roomId = event.room_id!;
    const creatorId = event.sender!;

    // Register the room with our room manager
    await this.roomManager.registerMatrixRoom(roomId);

    this.logger.info(`New room created: ${roomId} by ${creatorId}`);
  }

  /**
   * Handle app-specific reply using AppManager configuration
   */
  private async handleAppSpecificReply(event: WeakEvent, app: import('../models/Config').GooglePlayApp): Promise<void> {
    const roomId = event.room_id!;
    const senderId = event.sender!;
    const content = event.content as any;
    const messageBody = content.body as string;

    try {
      // Handle different reply formats based on app configuration
      let reviewId: string | null = null;
      let replyText: string | null = null;

      // 1. Try !reply <reviewId> <text> format
      const explicitMatch = messageBody.match(/^!reply\s+([^\s]+)\s+(.+)/i);
      if (explicitMatch && explicitMatch[1] && explicitMatch[2]) {
        reviewId = explicitMatch[1];
        replyText = explicitMatch[2];
      }
      // 2. Try "reply: <text>" format (uses most recent review)
      else if (messageBody.toLowerCase().startsWith('reply:')) {
        replyText = messageBody.substring(6).trim();
        reviewId = await this.findMostRecentReviewInRoom(roomId, app.packageName);
      }
      // 3. Handle threaded replies (if Matrix threading is supported)
      else if (content['m.relates_to']?.['m.in_reply_to']) {
        const replyToEventId = content['m.relates_to']['m.in_reply_to'].event_id;
        const mapping = await this.messageManager.getMessageMappingByEventId(replyToEventId);
        if (mapping && mapping.messageType === 'review') {
          reviewId = mapping.googlePlayReviewId;
          replyText = messageBody;
        }
      }

      if (!reviewId || !replyText) {
        // Not a reply format we recognize, ignore silently
        return;
      }

      // Use app-specific reply template if configured
      if (app.replyTemplate && !explicitMatch) {
        replyText = app.replyTemplate.replace('{{reply}}', replyText);
      }

      // Process the reply with app-specific settings
      await this.processAppSpecificReply(
        reviewId,
        app,
        replyText,
        event.event_id!,
        roomId,
        senderId
      );

    } catch (error) {
      this.logger.error(
        `Error handling app-specific reply for ${app.packageName}: ${error instanceof Error ? error.message : error}`
      );
      await this.sendErrorMessage(
        roomId,
        `Failed to process reply: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Process app-specific reply with enhanced validation and notifications
   */
  private async processAppSpecificReply(
    reviewId: string,
    app: import('../models/Config').GooglePlayApp,
    rawMessage: string,
    matrixEventId: string,
    matrixRoomId: string,
    senderId: string
  ): Promise<void> {
    try {
      // Validate the review exists
      const review = this.messageManager.getGooglePlayReview(reviewId);
      if (!review) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Review ${reviewId} not found.`
        );
        return;
      }

      // Validate the package name matches the app
      if (review.packageName !== app.packageName) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Review ${reviewId} belongs to a different app (${review.packageName}).`
        );
        return;
      }

      // Check if review already has a reply
      if (review.hasReply) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Review ${reviewId} already has a reply. Use !edit to modify or !delete to remove.`
        );
        return;
      }

      // Extract and validate the reply text
      const replyText = this.extractReplyText(rawMessage);
      if (!replyText?.trim()) {
        await this.sendErrorMessage(
          matrixRoomId,
          'Reply text is empty or invalid.'
        );
        return;
      }

      // Validate reply text length (Google Play limit is usually 350 characters)
      if (replyText.length > 350) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Reply text too long (${replyText.length}/350 characters). Please shorten your reply.`
        );
        return;
      }

      this.logger.info(
        `Processing app-specific reply to review ${reviewId} for ${app.packageName}: ${replyText.substring(0, 50)}...`
      );

      // Send confirmation that reply is being processed
      await this.sendStatusMessage(
        matrixRoomId,
        `⏳ Sending reply to review ${reviewId} for ${app.appName || app.packageName}...`
      );

      // Create message mapping for tracking
      await this.messageManager.createMessageMapping(
        reviewId,
        matrixEventId,
        matrixRoomId,
        'reply',
        app.packageName
      );

      // Update app statistics
      if (this.appManager) {
        this.appManager.updateAppStats(app.packageName, {
          repliesSent: (this.appManager.getAppStats(app.packageName)?.repliesSent || 0) + 1
        });
      }

      // Notify admins/moderators if configured
      if (app.notificationSettings?.mentionAdmins || app.notificationSettings?.mentionModerators) {
        await this.notifyAppModerators(app, `New reply sent to review ${reviewId} by ${senderId}`, matrixRoomId);
      }

      // Delegate to the bridge to queue the reply
      await this.queueReplyToBridge(
        app.packageName,
        reviewId,
        replyText,
        matrixEventId,
        matrixRoomId,
        senderId
      );
    } catch (error) {
      this.logger.error(
        `Error processing app-specific reply to review ${reviewId}: ${error instanceof Error ? error.message : error}`
      );
      
      // Update error statistics
      if (this.appManager) {
        this.appManager.updateAppStats(app.packageName, {
          errors: (this.appManager.getAppStats(app.packageName)?.errors || 0) + 1
        });
      }

      await this.sendErrorMessage(
        matrixRoomId,
        `Failed to process reply: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Notify app moderators about important events
   */
  private async notifyAppModerators(
    app: import('../models/Config').GooglePlayApp,
    message: string,
    roomId: string
  ): Promise<void> {
    try {
      const intent = this.bridge.getIntent();
      let mentions: string[] = [];

      if (app.notificationSettings?.mentionAdmins && app.admins) {
        mentions.push(...app.admins);
      }

      if (app.notificationSettings?.mentionModerators && app.moderators) {
        mentions.push(...app.moderators);
      }

      if (mentions.length > 0) {
        const mentionText = mentions.map(userId => `<a href="https://matrix.to/#/${userId}">${userId}</a>`).join(' ');
        const notificationContent = {
          msgtype: 'm.text',
          body: `${message} - ${mentions.join(' ')}`,
          format: 'org.matrix.custom.html',
          formatted_body: `<p>${message}</p><p>${mentionText}</p>`
        };

        await intent.sendMessage(roomId, notificationContent);
      }
    } catch (error) {
      this.logger.warn(`Failed to notify moderators: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Handle potential reply to Google Play
   */
  private async handlePotentialReply(
    event: WeakEvent,
    packageName: string
  ): Promise<void> {
    const messageBody = event.content?.body as string;
    const roomId = event.room_id!;
    const senderId = event.sender!;
    const eventId = event.event_id!;

    // Check if this is a reply to a bridge message
    let reviewId: string | null = null;

    // Check for thread/reply relationship
    if ((event.content as any)['m.relates_to']?.['m.in_reply_to']) {
      const replyToEventId = (event.content as any)['m.relates_to'][
        'm.in_reply_to'
      ]['event_id'];
      reviewId = await this.extractReviewIdFromReply(replyToEventId);
    }

    // Check for command format: "!reply <reviewId> <message>"
    const commandMatch = messageBody.match(/^!reply\s+([^\s]+)\s+(.+)/i);
    if (commandMatch) {
      reviewId = commandMatch[1] || null;
    }

    // Handle other commands
    if (messageBody.startsWith('!edit ')) {
      await this.handleEditCommand(
        messageBody,
        packageName,
        eventId,
        roomId,
        senderId
      );
      return;
    }

    if (messageBody.startsWith('!delete ')) {
      await this.handleDeleteCommand(
        messageBody,
        packageName,
        eventId,
        roomId,
        senderId
      );
      return;
    }

    if (messageBody.startsWith('!status ')) {
      await this.handleStatusCommand(messageBody, packageName, roomId);
      return;
    }

    // Check for simple reply prefix format: "reply: <message>"
    if (messageBody.toLowerCase().startsWith('reply:') && !reviewId) {
      // Try to find the most recent review in this room
      reviewId = await this.findMostRecentReviewInRoom(roomId, packageName);
    }

    if (!reviewId) {
      this.logger.debug(
        `No valid reply format detected for message in room ${roomId}`
      );
      return;
    }

    // Validate and process the reply
    await this.processReplyToReview(
      reviewId,
      packageName,
      messageBody,
      eventId,
      roomId,
      senderId
    );
  }

  /**
   * Extract review ID from a Matrix event that was a reply to a bridge message
   */
  private async extractReviewIdFromReply(
    replyToEventId: string
  ): Promise<string | null> {
    try {
      // Get the original message mapping
      const mapping =
        this.messageManager.getMessageMappingByMatrixEventId(replyToEventId);
      if (mapping && mapping.messageType === 'review') {
        return mapping.googlePlayReviewId;
      }
      return null;
    } catch (error) {
      this.logger.error(
        `Error extracting review ID from reply: ${error instanceof Error ? error.message : error}`
      );
      return null;
    }
  }

  /**
   * Find the most recent review posted to a room (for simple "reply:" format)
   */
  private async findMostRecentReviewInRoom(
    roomId: string,
    packageName: string
  ): Promise<string | null> {
    try {
      const mappings = this.messageManager.getMessageMappingsByRoom(roomId);
      const reviewMappings = mappings
        .filter(
          m => m.messageType === 'review' && m.packageName === packageName
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return reviewMappings.length > 0
        ? reviewMappings[0]?.googlePlayReviewId || null
        : null;
    } catch (error) {
      this.logger.error(
        `Error finding most recent review in room: ${error instanceof Error ? error.message : error}`
      );
      return null;
    }
  }

  /**
   * Process and validate a reply to a Google Play review
   */
  private async processReplyToReview(
    reviewId: string,
    packageName: string,
    rawMessage: string,
    matrixEventId: string,
    matrixRoomId: string,
    senderId: string
  ): Promise<void> {
    try {
      // Validate the review exists
      const review = this.messageManager.getGooglePlayReview(reviewId);
      if (!review) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Review ${reviewId} not found.`
        );
        return;
      }

      // Validate the package name matches
      if (review.packageName !== packageName) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Review ${reviewId} belongs to a different app.`
        );
        return;
      }

      // Check if review already has a reply
      if (review.hasReply) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Review ${reviewId} already has a reply. Use !edit to modify or !delete to remove.`
        );
        return;
      }

      // Extract and validate the reply text
      const replyText = this.extractReplyText(rawMessage);
      if (!replyText?.trim()) {
        await this.sendErrorMessage(
          matrixRoomId,
          'Reply text is empty or invalid.'
        );
        return;
      }

      // Validate reply text length (Google Play limit is usually 350 characters)
      if (replyText.length > 350) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Reply text too long (${replyText.length}/350 characters). Please shorten your reply.`
        );
        return;
      }

      this.logger.info(
        `Processing reply to review ${reviewId}: ${replyText.substring(0, 50)}...`
      );

      // Send confirmation that reply is being processed
      await this.sendStatusMessage(
        matrixRoomId,
        `⏳ Sending reply to review ${reviewId}...`
      );

      // Create message mapping for tracking
      await this.messageManager.createMessageMapping(
        reviewId,
        matrixEventId,
        matrixRoomId,
        'reply',
        packageName
      );

      // Delegate to the bridge to queue the reply
      await this.queueReplyToBridge(
        packageName,
        reviewId,
        replyText,
        matrixEventId,
        matrixRoomId,
        senderId
      );
    } catch (error) {
      this.logger.error(
        `Error processing reply to review ${reviewId}: ${error instanceof Error ? error.message : error}`
      );
      await this.sendErrorMessage(
        matrixRoomId,
        `Failed to process reply: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if a command is a Google Play specific command (not a bridge admin command)
   */
  private isGooglePlayCommand(message: string): boolean {
    const googlePlayCommands = ['!reply', '!edit', '!delete', '!status'];
    const command = message.split(/\s+/)[0]?.toLowerCase();
    return googlePlayCommands.includes(command || '');
  }

  /**
   * Extract reply text from various message formats
   */
  private extractReplyText(rawMessage: string): string | null {
    // Handle "reply: <text>" format
    const replyMatch = rawMessage.match(/^reply:\s*(.+)/i);
    if (replyMatch && replyMatch[1]) {
      return replyMatch[1].trim();
    }

    // Handle "!reply <reviewId> <text>" format
    const commandMatch = rawMessage.match(/^!reply\s+[^\s]+\s+(.+)/i);
    if (commandMatch && commandMatch[1]) {
      return commandMatch[1].trim();
    }

    // If it's a Matrix thread reply, use the entire message body
    return rawMessage.trim() || null;
  }

  /**
   * Queue a reply to be sent through the bridge
   */
  private async queueReplyToBridge(
    packageName: string,
    reviewId: string,
    replyText: string,
    matrixEventId: string,
    matrixRoomId: string,
    senderId: string
  ): Promise<void> {
    // This will be called through a callback to the main bridge
    const controller = this.bridge.opts?.controller as any;
    if (controller && controller.onBridgeReply) {
      await controller.onBridgeReply(
        packageName,
        reviewId,
        replyText,
        matrixEventId,
        matrixRoomId,
        senderId
      );
    } else {
      throw new Error('Bridge reply handler not configured');
    }
  }

  /**
   * Send an error message to a Matrix room
   */
  private async sendErrorMessage(
    roomId: string,
    errorText: string
  ): Promise<void> {
    const errorContent = this.messageManager.formatErrorMessage(errorText);
    await this.sendMessageToRoom(roomId, errorContent);
  }

  /**
   * Send a status message to a Matrix room
   */
  private async sendStatusMessage(
    roomId: string,
    statusText: string
  ): Promise<void> {
    const statusContent = this.messageManager.formatNotification(statusText);
    await this.sendMessageToRoom(roomId, statusContent);
  }

  /**
   * Handle edit command: !edit <reviewId> <new text>
   */
  private async handleEditCommand(
    messageBody: string,
    packageName: string,
    matrixEventId: string,
    matrixRoomId: string,
    senderId: string
  ): Promise<void> {
    const editMatch = messageBody.match(/^!edit\s+([^\s]+)\s+(.+)/i);
    if (!editMatch || !editMatch[1] || !editMatch[2]) {
      await this.sendErrorMessage(
        matrixRoomId,
        'Invalid edit command. Use: !edit <reviewId> <new text>'
      );
      return;
    }

    const reviewId = editMatch[1];
    const newReplyText = editMatch[2].trim();

    try {
      // Validate the review exists and has a reply
      const review = this.messageManager.getGooglePlayReview(reviewId);
      if (!review) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Review ${reviewId} not found.`
        );
        return;
      }

      if (!review.hasReply) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Review ${reviewId} has no reply to edit. Use !reply instead.`
        );
        return;
      }

      // Validate text length
      if (newReplyText.length > 350) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Reply text too long (${newReplyText.length}/350 characters). Please shorten your reply.`
        );
        return;
      }

      this.logger.info(
        `Editing reply for review ${reviewId}: ${newReplyText.substring(0, 50)}...`
      );
      await this.sendStatusMessage(
        matrixRoomId,
        `⏳ Updating reply for review ${reviewId}...`
      );

      // Queue the edit (same as reply, Google Play API handles updates)
      await this.queueReplyToBridge(
        packageName,
        reviewId,
        newReplyText,
        matrixEventId,
        matrixRoomId,
        senderId
      );
    } catch (error) {
      this.logger.error(
        `Error editing reply for review ${reviewId}: ${error instanceof Error ? error.message : error}`
      );
      await this.sendErrorMessage(
        matrixRoomId,
        `Failed to edit reply: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle delete command: !delete <reviewId>
   */
  private async handleDeleteCommand(
    messageBody: string,
    packageName: string,
    matrixEventId: string,
    matrixRoomId: string,
    senderId: string
  ): Promise<void> {
    const deleteMatch = messageBody.match(/^!delete\s+([^\s]+)/i);
    if (!deleteMatch || !deleteMatch[1]) {
      await this.sendErrorMessage(
        matrixRoomId,
        'Invalid delete command. Use: !delete <reviewId>'
      );
      return;
    }

    const reviewId = deleteMatch[1];

    try {
      // Validate the review exists and has a reply
      const review = this.messageManager.getGooglePlayReview(reviewId);
      if (!review) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Review ${reviewId} not found.`
        );
        return;
      }

      if (!review.hasReply) {
        await this.sendErrorMessage(
          matrixRoomId,
          `Review ${reviewId} has no reply to delete.`
        );
        return;
      }

      this.logger.info(`Deleting reply for review ${reviewId}`);
      await this.sendStatusMessage(
        matrixRoomId,
        `⏳ Deleting reply for review ${reviewId}...`
      );

      // Queue the deletion (send empty reply to Google Play)
      await this.queueReplyToBridge(
        packageName,
        reviewId,
        '',
        matrixEventId,
        matrixRoomId,
        senderId
      );
    } catch (error) {
      this.logger.error(
        `Error deleting reply for review ${reviewId}: ${error instanceof Error ? error.message : error}`
      );
      await this.sendErrorMessage(
        matrixRoomId,
        `Failed to delete reply: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle status command: !status [reviewId]
   */
  private async handleStatusCommand(
    messageBody: string,
    packageName: string,
    matrixRoomId: string
  ): Promise<void> {
    const statusMatch = messageBody.match(/^!status(?:\s+([^\s]+))?/i);
    const reviewId = statusMatch?.[1];

    try {
      if (reviewId) {
        // Show status for specific review
        const review = this.messageManager.getGooglePlayReview(reviewId);
        if (!review) {
          await this.sendErrorMessage(
            matrixRoomId,
            `Review ${reviewId} not found.`
          );
          return;
        }

        const statusText =
          `**Review Status**: ${reviewId}\n` +
          `📱 **App**: ${review.packageName}\n` +
          `⭐ **Rating**: ${review.starRating}/5\n` +
          `👤 **Author**: ${review.authorName}\n` +
          `💬 **Has Reply**: ${review.hasReply ? 'Yes' : 'No'}\n` +
          `📅 **Created**: ${review.createdAt.toLocaleDateString()}\n` +
          `🔄 **Modified**: ${review.lastModifiedAt.toLocaleDateString()}`;

        await this.sendStatusMessage(matrixRoomId, statusText);
      } else {
        // Show general status for this room/app
        const mappings =
          this.messageManager.getMessageMappingsByRoom(matrixRoomId);
        const reviewCount = mappings.filter(
          m => m.messageType === 'review' && m.packageName === packageName
        ).length;
        const replyCount = mappings.filter(
          m => m.messageType === 'reply' && m.packageName === packageName
        ).length;

        const statusText =
          `**Bridge Status for ${packageName}**\n` +
          `📊 **Reviews in this room**: ${reviewCount}\n` +
          `💬 **Replies sent**: ${replyCount}\n` +
          `🔄 **Bridge**: Active`;

        await this.sendStatusMessage(matrixRoomId, statusText);
      }
    } catch (error) {
      this.logger.error(
        `Error showing status: ${error instanceof Error ? error.message : error}`
      );
      await this.sendErrorMessage(
        matrixRoomId,
        `Failed to show status: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle bot being invited to a room
   */
  private async handleBotInvited(
    roomId: string,
    inviterId: string
  ): Promise<void> {
    this.logger.info(`Bot invited to room ${roomId} by ${inviterId}`);

    try {
      // Auto-accept invites from configured administrators
      const intent = this.bridge.getIntent();
      await intent.join(roomId);

      this.logger.info(`Bot successfully joined room ${roomId}`);

      // Send welcome message
      const welcomeContent = this.messageManager.formatNotification(
        'Google Play Bridge connected! This room can now receive Google Play reviews and send replies.'
      );

      await intent.sendMessage(roomId, welcomeContent);
    } catch (error) {
      this.logger.error(
        `Failed to join room ${roomId}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * Handle bot joining a room
   */
  private async handleBotJoinedRoom(roomId: string): Promise<void> {
    await this.roomManager.markRoomJoined(roomId);
    this.logger.info(`Bot joined room: ${roomId}`);
  }

  /**
   * Send a message to a Matrix room
   */
  async sendMessageToRoom(
    roomId: string,
    content: any
  ): Promise<string | null> {
    try {
      const intent = this.bridge.getIntent();
      const response = await intent.sendMessage(roomId, content);
      const eventId =
        typeof response === 'string' ? response : response.event_id;

      this.logger.debug(`Sent message to room ${roomId}: ${eventId}`);
      return eventId;
    } catch (error) {
      this.logger.error(
        `Failed to send message to room ${roomId}: ${error instanceof Error ? error.message : error}`
      );
      return null;
    }
  }

  /**
   * Send a Google Play review to Matrix room(s)
   */
  async sendReviewToMatrix(
    reviewId: string,
    packageName: string
  ): Promise<void> {
    // Get the review from message manager
    const review = this.messageManager.getGooglePlayReview(reviewId);
    if (!review) {
      this.logger.error(`Review not found: ${reviewId}`);
      return;
    }

    // Get rooms for this app
    const rooms = await this.roomManager.getRoomsForApp(packageName);
    if (rooms.length === 0) {
      this.logger.warn(`No rooms configured for app: ${packageName}`);
      return;
    }

    // Format the review for Matrix
    const messageContent = this.messageManager.formatReviewForMatrix(review);

    // Send to all configured rooms
    for (const room of rooms) {
      const shouldForward = await this.roomManager.shouldForwardReview(
        packageName,
        room.matrixRoomId,
        review.starRating
      );

      if (shouldForward) {
        const eventId = await this.sendMessageToRoom(
          room.matrixRoomId,
          messageContent
        );
        if (eventId) {
          // Create message mapping
          await this.messageManager.createMessageMapping(
            reviewId,
            eventId,
            room.matrixRoomId,
            'review',
            packageName
          );
        }
      }
    }
  }

  /**
   * Create a virtual user for a Google Play reviewer
   */
  async createVirtualUser(reviewId: string, authorName: string): Promise<void> {
    const domain = this.config.homeserver.domain;

    // Create or update the user in our user manager
    await this.userManager.getOrCreateMatrixUser(reviewId, authorName, domain);

    this.logger.debug(
      `Virtual user created/updated for review ${reviewId}: ${authorName}`
    );
  }

  /**
   * Get the bot user ID
   */
  private getBotUserId(): string {
    return `@${this.config.appservice.botUsername}:${this.config.homeserver.domain}`;
  }

  /**
   * Check if an event is from the bridge bot
   */
  private isBridgeBotEvent(event: WeakEvent): boolean {
    return event.sender === this.getBotUserId();
  }

  /**
   * Ensure the bot user is registered
   */
  private async ensureBotRegistered(): Promise<void> {
    try {
      const botUserId = this.getBotUserId();
      const intent = this.bridge.getIntent(botUserId);

      // Try to get the bot's profile to ensure it exists
      await intent.getProfileInfo(botUserId);

      this.logger.info(`Bot user ${botUserId} is registered`);
    } catch (error) {
      // Bot probably needs to be created, which will happen automatically
      // when the bridge processes events
      this.logger.debug(`Bot user registration will be handled automatically`);
    }
  }

  /**
   * Handle bridge admin commands
   */
  async handleBridgeCommand(event: WeakEvent): Promise<void> {
    const roomId = event.room_id!;
    const senderId = event.sender!;
    const messageBody = (event.content as any).body as string;

    this.logger.info(
      `Processing bridge command from ${senderId} in ${roomId}: ${messageBody}`
    );

    // Check if user is authorized to run bridge commands
    if (!(await this.isAuthorizedAdmin(senderId, roomId))) {
      await this.sendErrorMessage(
        roomId,
        '❌ You are not authorized to run bridge commands.'
      );
      return;
    }

    try {
      // Parse command and arguments
      const parts = messageBody.trim().split(/\s+/);
      const command = parts[1]?.toLowerCase(); // !bridge <command>
      const args = parts.slice(2);

      switch (command) {
        case 'status':
          await this.handleBridgeStatusCommand(roomId, args);
          break;
        case 'stats':
          await this.handleBridgeStatsCommand(roomId, args);
          break;
        case 'health':
          await this.handleBridgeHealthCommand(roomId);
          break;
        case 'restart':
          await this.handleBridgeRestartCommand(roomId, senderId);
          break;
        case 'reload':
          await this.handleBridgeReloadCommand(roomId);
          break;
        case 'help':
          await this.handleBridgeHelpCommand(roomId);
          break;
        default:
          await this.sendErrorMessage(
            roomId,
            `❌ Unknown bridge command: ${command}. Use \`!bridge help\` for available commands.`
          );
      }
    } catch (error) {
      this.logger.error(
        `Error processing bridge command: ${error instanceof Error ? error.message : error}`
      );
      await this.sendErrorMessage(
        roomId,
        `❌ Error processing command: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle bridge status command
   */
  private async handleBridgeStatusCommand(
    roomId: string,
    _args: string[]
  ): Promise<void> {
    const bridgeStats = this.getBridgeStats();
    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);

    const statusMessage =
      `**🔗 Bridge Status**\n\n` +
      `**Status**: ✅ Running\n` +
      `**Uptime**: ${uptimeHours}h ${uptimeMinutes}m\n` +
      `**Connected Rooms**: ${bridgeStats.connectedRooms}\n` +
      `**Virtual Users**: ${bridgeStats.virtualUsers}\n` +
      `**Messages Sent**: ${bridgeStats.messagesSent}\n` +
      `**Memory Usage**: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n` +
      `**Node.js**: ${process.version}\n` +
      `**Platform**: ${process.platform}`;

    await this.sendStatusMessage(roomId, statusMessage);
  }

  /**
   * Handle bridge stats command
   */
  private async handleBridgeStatsCommand(
    roomId: string,
    _args: string[]
  ): Promise<void> {
    // Get detailed statistics from all components
    const roomStats = this.roomManager.getRoomStats();
    const userCount = this.userManager.getAllMatrixUsers().length;
    const messageStats = this.messageManager.getMessageStats();

    const statsMessage =
      `**📊 Bridge Statistics**\n\n` +
      `**Rooms**:\n` +
      `  • Total Rooms: ${roomStats.totalRooms}\n` +
      `  • Bridge Joined: ${roomStats.bridgeJoinedRooms}\n` +
      `  • App Mappings: ${roomStats.totalAppMappings}\n\n` +
      `**Users**:\n` +
      `  • Virtual Users: ${userCount}\n\n` +
      `**Messages**:\n` +
      `  • Matrix Messages: ${messageStats.totalMatrixMessages}\n` +
      `  • Review Messages: ${messageStats.totalReviews}\n` +
      `  • Message Mappings: ${messageStats.totalMappings}\n` +
      `  • Reviews with Replies: ${messageStats.reviewsWithReplies}\n\n` +
      `**Performance**:\n` +
      `  • Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n` +
      `  • CPU Usage: ${Math.round(process.cpuUsage().user / 1000)}ms`;

    await this.sendStatusMessage(roomId, statsMessage);
  }

  /**
   * Handle bridge health command
   */
  private async handleBridgeHealthCommand(roomId: string): Promise<void> {
    try {
      // Get health status from the bridge's health monitor via callback
      const controller = this.bridge.opts?.controller as any;
      if (controller?.getBridgeHealth) {
        const healthStatus = await controller.getBridgeHealth();

        let healthMessage = `**🏥 Bridge Health Report**\n\n`;
        healthMessage += `**Overall Status**: ${this.getStatusEmoji(healthStatus.status)} ${healthStatus.status.toUpperCase()}\n\n`;

        healthMessage += `**Component Health**:\n`;
        for (const check of healthStatus.checks) {
          healthMessage += `  • ${check.name}: ${this.getStatusEmoji(check.status)} ${check.status}\n`;
          if (check.message) {
            healthMessage += `    ${check.message}\n`;
          }
        }

        await this.sendStatusMessage(roomId, healthMessage);
      } else {
        await this.sendErrorMessage(
          roomId,
          '❌ Health monitoring not available.'
        );
      }
    } catch (error) {
      await this.sendErrorMessage(
        roomId,
        `❌ Error getting health status: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle bridge restart command
   */
  private async handleBridgeRestartCommand(
    roomId: string,
    senderId: string
  ): Promise<void> {
    await this.sendStatusMessage(
      roomId,
      `⚠️ Bridge restart initiated by ${senderId}. The bridge will be unavailable for a few moments...`
    );

    this.logger.warn(
      `Bridge restart requested by ${senderId} from room ${roomId}`
    );

    // Schedule restart after a short delay to allow the message to be sent
    setTimeout(() => {
      process.exit(0); // Assuming process manager will restart the bridge
    }, 2000);
  }

  /**
   * Handle bridge reload command
   */
  private async handleBridgeReloadCommand(roomId: string): Promise<void> {
    await this.sendStatusMessage(
      roomId,
      `🔄 Configuration reload is not yet implemented. Please restart the bridge for configuration changes.`
    );
  }

  /**
   * Handle bridge help command
   */
  private async handleBridgeHelpCommand(roomId: string): Promise<void> {
    const helpMessage =
      `**🤖 Bridge Commands Help**\n\n` +
      `**Available Commands**:\n` +
      `  • \`!bridge status\` - Show bridge status and basic info\n` +
      `  • \`!bridge stats\` - Show detailed statistics\n` +
      `  • \`!bridge health\` - Show health check results\n` +
      `  • \`!bridge restart\` - Restart the bridge (requires admin)\n` +
      `  • \`!bridge reload\` - Reload configuration (not implemented)\n` +
      `  • \`!bridge help\` - Show this help message\n\n` +
      `**Google Play Commands**:\n` +
      `  • \`!reply <reviewId> <text>\` - Reply to a review\n` +
      `  • \`!edit <reviewId> <text>\` - Edit an existing reply\n` +
      `  • \`!delete <reviewId>\` - Delete a reply\n` +
      `  • \`!status [reviewId]\` - Show review status\n` +
      `  • \`reply: <text>\` - Reply to most recent review\n\n` +
      `**Note**: Bridge commands require admin permissions.`;

    await this.sendStatusMessage(roomId, helpMessage);
  }

  /**
   * Check if user is authorized to run admin commands
   */
  private async isAuthorizedAdmin(
    userId: string,
    roomId: string
  ): Promise<boolean> {
    try {
      // Check if user is room admin or configured bridge admin
      const intent = this.bridge.getIntent();
      const powerLevels = await intent.getStateEvent(
        roomId,
        'm.room.power_levels'
      );

      const userPowerLevel =
        powerLevels?.users?.[userId] || powerLevels?.users_default || 0;
      const requiredLevel = powerLevels?.kick || 50; // Require at least kick permission level

      if (userPowerLevel >= requiredLevel) {
        return true;
      }

      // Check configured admins (if any) - Need to access from the full config
      // For now, we'll just use Matrix room permissions
      return false;
    } catch (error) {
      this.logger.warn(
        `Error checking admin permissions for ${userId}: ${error instanceof Error ? error.message : error}`
      );
      return false;
    }
  }

  /**
   * Get status emoji for health status
   */
  private getStatusEmoji(status: string): string {
    switch (status.toLowerCase()) {
      case 'healthy':
        return '✅';
      case 'degraded':
        return '⚠️';
      case 'unhealthy':
        return '❌';
      default:
        return '❓';
    }
  }

  /**
   * Get bridge statistics
   */
  getBridgeStats(): {
    connectedRooms: number;
    virtualUsers: number;
    messagesSent: number;
  } {
    const roomStats = this.roomManager.getRoomStats();
    const userStats = this.userManager.getAllMatrixUsers().length;
    const messageStats = this.messageManager.getMessageStats();

    return {
      connectedRooms: roomStats.bridgeJoinedRooms,
      virtualUsers: userStats,
      messagesSent: messageStats.totalMatrixMessages,
    };
  }

  /**
   * Shutdown the Matrix handler
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Matrix handler...');

    // Clean up any resources
    this.userManager.cleanupInactiveUsers();

    this.logger.info('Matrix handler shutdown complete');
  }
}
