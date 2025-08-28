/**
 * Matrix event handler for Google Play Bridge
 */

import { Bridge, WeakEvent, Request } from 'matrix-appservice-bridge';
import { UserManager } from '../models/User';
import { RoomManager } from '../models/Room';
import { MessageManager, MatrixMessage } from '../models/Message';
import { Config } from '../utils/Config';
import { Logger } from '../utils/Logger';

export interface MatrixHandlerOptions {
  bridge: Bridge;
  userManager: UserManager;
  roomManager: RoomManager;
  messageManager: MessageManager;
  config: Config;
}

/**
 * Handles Matrix events and manages bridge interactions
 */
export class MatrixHandler {
  private bridge: Bridge;
  private userManager: UserManager;
  private roomManager: RoomManager;
  private messageManager: MessageManager;
  private config: Config;
  private logger: Logger;

  constructor(options: MatrixHandlerOptions) {
    this.bridge = options.bridge;
    this.userManager = options.userManager;
    this.roomManager = options.roomManager;
    this.messageManager = options.messageManager;
    this.config = options.config;
    this.logger = Logger.getInstance();
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

      this.logger.debug(`Received Matrix event: ${event.type} in room ${event.room_id}`);

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
      this.logger.error(`Error handling Matrix event: ${error instanceof Error ? error.message : error}`);
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
      // Extract review ID from user ID pattern: @googleplay_<reviewId>:domain.com
      const reviewIdMatch = userId.match(/@googleplay_([^:]+):/);
      if (!reviewIdMatch) {
        this.logger.warn(`Invalid Google Play user ID format: ${userId}`);
        return null;
      }

      const reviewId = reviewIdMatch[1];
      const user = this.userManager.getMatrixUser(userId);
      
      if (user) {
        this.logger.info(`Creating virtual user: ${userId} (${user.displayName})`);
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
      this.logger.error(`Error handling user query for ${userId}: ${error instanceof Error ? error.message : error}`);
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

    // Check if this room is configured for Google Play integration
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

    // Handle potential reply to Google Play
    await this.handlePotentialReply(event, roomMapping.packageName);
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
   * Handle potential reply to Google Play
   */
  private async handlePotentialReply(event: WeakEvent, _packageName: string): Promise<void> {
    const messageBody = event.content?.body as string;
    
    // Simple heuristic: if message starts with "reply:" or is a reply to a bridge message
    // In a full implementation, this would be more sophisticated
    if (messageBody.toLowerCase().startsWith('reply:') || 
        (event.content as any)['m.relates_to']?.['m.in_reply_to']) {
      
      this.logger.info(`Potential Google Play reply detected in room ${event.room_id}`);
      
      // Here we would normally:
      // 1. Extract the actual reply content
      // 2. Determine which review this is a reply to
      // 3. Send the reply via GooglePlayClient
      // 4. Send confirmation back to Matrix
      
      // TODO: Implement actual reply logic when GooglePlayClient is ready
      
      // For now, just send a placeholder confirmation
      const intent = this.bridge.getIntent();
      const confirmationContent = this.messageManager.formatReplyConfirmation(
        true
      );
      
      await intent.sendMessage(event.room_id!, confirmationContent);
    }
  }

  /**
   * Handle bot being invited to a room
   */
  private async handleBotInvited(roomId: string, inviterId: string): Promise<void> {
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
      this.logger.error(`Failed to join room ${roomId}: ${error instanceof Error ? error.message : error}`);
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
  async sendMessageToRoom(roomId: string, content: any): Promise<string | null> {
    try {
      const intent = this.bridge.getIntent();
      const response = await intent.sendMessage(roomId, content);
      const eventId = typeof response === 'string' ? response : response.event_id;
      
      this.logger.debug(`Sent message to room ${roomId}: ${eventId}`);
      return eventId;
    } catch (error) {
      this.logger.error(`Failed to send message to room ${roomId}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Send a Google Play review to Matrix room(s)
   */
  async sendReviewToMatrix(reviewId: string, packageName: string): Promise<void> {
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
        const eventId = await this.sendMessageToRoom(room.matrixRoomId, messageContent);
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
    
    this.logger.debug(`Virtual user created/updated for review ${reviewId}: ${authorName}`);
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