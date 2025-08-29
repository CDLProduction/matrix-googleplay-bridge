import { GooglePlayApp, BridgeConfig } from '../models/Config';
import { Bridge } from 'matrix-appservice-bridge';
import { Logger } from '../utils/Logger';
import { EventEmitter } from 'events';
import { DatabaseInterface } from '../storage/Database';

export interface AppContext {
  app: GooglePlayApp;
  roomId?: string;
  roomAlias?: string;
  stats: {
    reviewsProcessed: number;
    repliesSent: number;
    lastPoll?: Date;
    errors: number;
  };
  active: boolean;
}

export interface AppEvents {
  'app:added': (app: GooglePlayApp) => void;
  'app:removed': (packageName: string) => void;
  'app:updated': (app: GooglePlayApp) => void;
  'app:enabled': (packageName: string) => void;
  'app:disabled': (packageName: string) => void;
  'room:created': (packageName: string, roomId: string) => void;
}

export class AppManager extends EventEmitter {
  private readonly logger: Logger;
  private apps: Map<string, AppContext> = new Map();
  private roomToApp: Map<string, string> = new Map();
  private userNamespaces: Map<string, string> = new Map();

  constructor(
    private readonly bridge: Bridge,
    private readonly config: BridgeConfig,
    private readonly database: DatabaseInterface
  ) {
    super();
    this.logger = Logger.getInstance().child({ component: 'AppManager' });
  }

  public async initialize(): Promise<void> {
    this.logger.info('Initializing app manager');
    
    // Load apps from configuration
    for (const app of this.config.googleplay.applications) {
      await this.addApp(app);
    }

    // Load persisted app states from database
    await this.loadPersistedStates();
    
    this.logger.info(`Initialized with ${this.apps.size} apps`);
  }

  public async addApp(app: GooglePlayApp): Promise<void> {
    if (this.apps.has(app.packageName)) {
      throw new Error(`App ${app.packageName} already exists`);
    }

    // Validate app configuration
    this.validateAppConfig(app);

    // Create app context
    const context: AppContext = {
      app: { ...this.config.bridge?.appManagement?.appDefaults, ...app },
      stats: {
        reviewsProcessed: 0,
        repliesSent: 0,
        errors: 0
      },
      active: app.enabled !== false
    };

    // Set up room if auto-create is enabled
    if (context.app.autoCreateRoom && context.active) {
      await this.setupAppRoom(context);
    }

    this.apps.set(app.packageName, context);
    this.updateRoomMapping(context);
    
    // Persist to database
    await this.persistAppConfig(app);
    
    this.logger.info(`Added app: ${app.packageName} (${app.appName || 'Unnamed'})`);
    this.emit('app:added', app);
  }

  public async removeApp(packageName: string): Promise<void> {
    const context = this.apps.get(packageName);
    if (!context) {
      throw new Error(`App ${packageName} not found`);
    }

    // Clean up room mappings
    if (context.roomId) {
      this.roomToApp.delete(context.roomId);
    }

    // Clean up user namespaces
    this.cleanupUserNamespace(packageName);

    // Remove from database
    await this.database.deleteAppConfig(packageName);

    this.apps.delete(packageName);
    
    this.logger.info(`Removed app: ${packageName}`);
    this.emit('app:removed', packageName);
  }

  public async updateApp(packageName: string, updates: Partial<GooglePlayApp>): Promise<void> {
    const context = this.apps.get(packageName);
    if (!context) {
      throw new Error(`App ${packageName} not found`);
    }

    // Merge updates
    context.app = { ...context.app, ...updates };
    
    // Validate updated configuration
    this.validateAppConfig(context.app);

    // Update room if needed
    if (updates.matrixRoom || updates.roomAlias) {
      this.updateRoomMapping(context);
    }

    // Persist changes
    await this.persistAppConfig(context.app);
    
    this.logger.info(`Updated app: ${packageName}`);
    this.emit('app:updated', context.app);
  }

  public async enableApp(packageName: string): Promise<void> {
    const context = this.apps.get(packageName);
    if (!context) {
      throw new Error(`App ${packageName} not found`);
    }

    context.active = true;
    context.app.enabled = true;
    
    // Create room if needed
    if (context.app.autoCreateRoom && !context.roomId) {
      await this.setupAppRoom(context);
    }

    await this.persistAppConfig(context.app);
    
    this.logger.info(`Enabled app: ${packageName}`);
    this.emit('app:enabled', packageName);
  }

  public async disableApp(packageName: string): Promise<void> {
    const context = this.apps.get(packageName);
    if (!context) {
      throw new Error(`App ${packageName} not found`);
    }

    context.active = false;
    context.app.enabled = false;
    
    await this.persistAppConfig(context.app);
    
    this.logger.info(`Disabled app: ${packageName}`);
    this.emit('app:disabled', packageName);
  }

  public getApp(packageName: string): GooglePlayApp | undefined {
    return this.apps.get(packageName)?.app;
  }

  public getAppByRoom(roomId: string): GooglePlayApp | undefined {
    const packageName = this.roomToApp.get(roomId);
    if (!packageName) return undefined;
    return this.apps.get(packageName)?.app;
  }

  public getAllApps(): GooglePlayApp[] {
    return Array.from(this.apps.values())
      .map(context => context.app);
  }

  public getActiveApps(): GooglePlayApp[] {
    return Array.from(this.apps.values())
      .filter(context => context.active)
      .map(context => context.app);
  }

  public getAppStats(packageName: string): AppContext['stats'] | undefined {
    return this.apps.get(packageName)?.stats;
  }

  public updateAppStats(packageName: string, updates: Partial<AppContext['stats']>): void {
    const context = this.apps.get(packageName);
    if (context) {
      context.stats = { ...context.stats, ...updates };
    }
  }

  public getUserNamespace(packageName: string, userId: string): string {
    const baseNamespace = `_googleplay_${packageName.replace(/\./g, '_')}`;
    return `@${baseNamespace}_${userId}:${this.config.homeserver.domain}`;
  }

  public parseUserNamespace(matrixUserId: string): { packageName: string; userId: string } | null {
    const match = matrixUserId.match(/@_googleplay_(.+?)_(.+?):.+/);
    if (!match || !match[1] || !match[2]) return null;
    
    const packageNamePart = match[1];
    const userId = match[2];
    const packageName = packageNamePart.replace(/_/g, '.');
    
    return { packageName, userId };
  }

  public getRoomAlias(app: GooglePlayApp): string {
    if (app.roomAlias) {
      return app.roomAlias;
    }
    const packagePart = app.packageName.replace(/\./g, '_').toLowerCase();
    return `#_googleplay_${packagePart}:${this.config.homeserver.domain}`;
  }

  public async routeMessageToApps(roomId: string, message: any): Promise<void> {
    const app = this.getAppByRoom(roomId);
    if (!app) {
      this.logger.debug(`No app found for room ${roomId}`);
      return;
    }

    // Handle forwarding to other rooms if configured
    if (app.forwardTo && app.forwardTo.length > 0) {
      for (const targetRoom of app.forwardTo) {
        await this.forwardMessage(targetRoom, message, app);
      }
    }
  }

  private async setupAppRoom(context: AppContext): Promise<void> {
    const intent = this.bridge.getIntent();
    const roomAlias = this.getRoomAlias(context.app);
    
    try {
      // Try to resolve existing room
      const existingRoom = await intent.resolveRoom(roomAlias);
      if (existingRoom && typeof existingRoom === 'string') {
        context.roomId = existingRoom;
        context.roomAlias = roomAlias;
        this.logger.info(`Using existing room ${existingRoom} for ${context.app.packageName}`);
        return;
      }
    } catch (error) {
      // Room doesn't exist, create it
    }

    // Create new room
    const roomOptions: any = {
      name: context.app.roomName || `${context.app.appName || context.app.packageName} Reviews`,
      topic: context.app.roomTopic || `Google Play reviews for ${context.app.appName || context.app.packageName}`,
      room_alias_name: roomAlias.split(':')[0]?.substring(1),
      visibility: 'private',
      preset: 'private_chat'
    };

    try {
      const roomResult = await intent.createRoom(roomOptions);
      const roomId = typeof roomResult === 'string' ? roomResult : roomResult.room_id;
      context.roomId = roomId;
      context.roomAlias = roomAlias;
      
      // Set room avatar if provided
      if (context.app.roomAvatar) {
        await intent.setRoomAvatar(roomId, context.app.roomAvatar);
      }

      // Send welcome message if configured
      if (context.app.welcomeMessage) {
        await intent.sendMessage(roomId, {
          msgtype: 'm.text',
          body: context.app.welcomeMessage,
          format: 'org.matrix.custom.html',
          formatted_body: `<p>${context.app.welcomeMessage}</p>`
        });
      }

      // Invite admins and moderators
      await this.inviteRoomMembers(roomId, context.app);
      
      this.logger.info(`Created room ${roomId} for ${context.app.packageName}`);
      this.emit('room:created', context.app.packageName, roomId);
    } catch (error) {
      this.logger.error(`Failed to create room for ${context.app.packageName}:`, error);
      throw error;
    }
  }

  private async inviteRoomMembers(roomId: string, app: GooglePlayApp): Promise<void> {
    const intent = this.bridge.getIntent();
    
    // Invite admins
    if (app.admins) {
      for (const admin of app.admins) {
        try {
          await intent.invite(roomId, admin);
          await intent.setPowerLevel(roomId, admin, 100);
        } catch (error) {
          this.logger.warn(`Failed to invite admin ${admin} to room ${roomId}:`, error);
        }
      }
    }

    // Invite moderators
    if (app.moderators) {
      for (const moderator of app.moderators) {
        try {
          await intent.invite(roomId, moderator);
          await intent.setPowerLevel(roomId, moderator, 50);
        } catch (error) {
          this.logger.warn(`Failed to invite moderator ${moderator} to room ${roomId}:`, error);
        }
      }
    }
  }

  private async forwardMessage(targetRoom: string, message: any, sourceApp: GooglePlayApp): Promise<void> {
    try {
      const intent = this.bridge.getIntent();
      const forwardedMessage = {
        ...message,
        body: `[Forwarded from ${sourceApp.appName || sourceApp.packageName}] ${message.body}`,
        'com.googleplay.forward': {
          source_app: sourceApp.packageName,
          original_room: sourceApp.matrixRoom
        }
      };
      
      await intent.sendMessage(targetRoom, forwardedMessage);
    } catch (error) {
      this.logger.error(`Failed to forward message to ${targetRoom}:`, error);
    }
  }

  private updateRoomMapping(context: AppContext): void {
    // Clear old mapping
    for (const [roomId, packageName] of this.roomToApp.entries()) {
      if (packageName === context.app.packageName) {
        this.roomToApp.delete(roomId);
      }
    }

    // Set new mapping
    if (context.app.matrixRoom) {
      this.roomToApp.set(context.app.matrixRoom, context.app.packageName);
    }
    if (context.roomId && context.roomId !== context.app.matrixRoom) {
      this.roomToApp.set(context.roomId, context.app.packageName);
    }
  }

  private cleanupUserNamespace(packageName: string): void {
    const namespacePrefix = `_googleplay_${packageName.replace(/\./g, '_')}`;
    for (const [userId, namespace] of this.userNamespaces.entries()) {
      if (namespace.startsWith(namespacePrefix)) {
        this.userNamespaces.delete(userId);
      }
    }
  }

  private validateAppConfig(app: GooglePlayApp): void {
    if (!app.packageName) {
      throw new Error('App packageName is required');
    }
    
    if (!app.matrixRoom && !app.autoCreateRoom) {
      throw new Error('Either matrixRoom or autoCreateRoom must be specified');
    }

    if (app.packageName.length > 255) {
      throw new Error('Package name too long');
    }

    // Validate package name format
    if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(app.packageName)) {
      throw new Error('Invalid package name format');
    }
  }

  private async persistAppConfig(app: GooglePlayApp): Promise<void> {
    await this.database.saveAppConfig(app.packageName, app);
  }

  private async loadPersistedStates(): Promise<void> {
    try {
      const configs = await this.database.getAllAppConfigs();
      for (const [packageName, config] of configs) {
        if (!this.apps.has(packageName)) {
          await this.addApp(config);
        }
      }
    } catch (error) {
      this.logger.error('Failed to load persisted app states:', error);
    }
  }

  public async reloadConfiguration(): Promise<void> {
    this.logger.info('Reloading app manager configuration');
    
    try {
      // Get fresh config instance
      const { Config } = await import('../utils/Config');
      const newConfig = Config.getInstance();
      
      // Update internal config reference
      (this as any).config = newConfig.all;
      
      // Get current apps from new config
      const newApps = new Set(newConfig.googleplay.applications.map(app => app.packageName));
      const currentApps = new Set(this.apps.keys());
      
      // Remove apps that are no longer in config
      for (const packageName of currentApps) {
        if (!newApps.has(packageName)) {
          this.logger.info(`Removing app ${packageName} (not in new config)`);
          await this.removeApp(packageName);
        }
      }
      
      // Add or update apps from new config
      for (const app of newConfig.googleplay.applications) {
        if (this.apps.has(app.packageName)) {
          // Update existing app
          this.logger.info(`Updating configuration for app ${app.packageName}`);
          const context = this.apps.get(app.packageName)!;
          context.app = app;
          await this.persistAppConfig(app);
          this.emit('app:updated', app);
        } else {
          // Add new app
          this.logger.info(`Adding new app ${app.packageName}`);
          await this.addApp(app);
        }
      }
      
      this.logger.info('App manager configuration reloaded successfully', {
        totalApps: this.apps.size,
        addedApps: Array.from(newApps).filter(name => !currentApps.has(name)),
        removedApps: Array.from(currentApps).filter(name => !newApps.has(name))
      });
    } catch (error) {
      this.logger.error('Failed to reload app manager configuration', { error });
      throw error;
    }
  }
}