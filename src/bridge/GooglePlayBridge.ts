/**
 * Main Google Play Bridge class that orchestrates the entire bridge system
 */

import { Bridge, AppServiceRegistration } from 'matrix-appservice-bridge';
import { MatrixHandler } from './MatrixHandler';
import { UserManager } from '../models/User';
import { RoomManager } from '../models/Room';
import { MessageManager } from '../models/Message';
import { Config } from '../utils/Config';
import { Logger } from '../utils/Logger';

/**
 * Main bridge class that coordinates all bridge components
 */
export class GooglePlayBridge {
  private config: Config;
  private logger: Logger;
  private bridge?: Bridge;
  private matrixHandler?: MatrixHandler;
  private userManager: UserManager;
  private roomManager: RoomManager;
  private messageManager: MessageManager;
  private isRunning: boolean = false;

  constructor(config: Config) {
    this.config = config;
    this.logger = Logger.getInstance();
    this.userManager = new UserManager();
    this.roomManager = new RoomManager();
    this.messageManager = new MessageManager();
  }

  /**
   * Start the bridge
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Bridge is already running');
      return;
    }

    this.logger.info('Starting Google Play Bridge...');

    try {
      // Initialize components in order
      await this.initializeBridge();
      await this.initializeHandlers();
      await this.initializeAppMappings();
      await this.startBridge();

      this.isRunning = true;
      this.logger.info('Google Play Bridge started successfully');

      // Set up graceful shutdown handlers
      this.setupShutdownHandlers();

    } catch (error) {
      this.logger.error(`Failed to start bridge: ${error instanceof Error ? error.message : error}`);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Stop the bridge
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Bridge is not running');
      return;
    }

    this.logger.info('Stopping Google Play Bridge...');

    try {
      await this.cleanup();
      this.isRunning = false;
      this.logger.info('Google Play Bridge stopped successfully');
    } catch (error) {
      this.logger.error(`Error during bridge shutdown: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  /**
   * Initialize the Matrix Application Service bridge
   */
  private async initializeBridge(): Promise<void> {
    this.logger.info('Initializing Matrix Application Service...');

    // Create registration from config
    const registration = this.createRegistration();

    // Create the bridge instance
    this.bridge = new Bridge({
      homeserverUrl: this.config.homeserver.url,
      domain: this.config.homeserver.domain,
      registration,
      controller: {
        // These will be wired up after MatrixHandler is created
        onUserQuery: (matrixUser: any) => {
          if (this.matrixHandler && typeof matrixUser === 'string') {
            return this.matrixHandler.onUserQuery(matrixUser);
          }
          return Promise.resolve(null);
        },
        
        onAliasQuery: (alias: string) => {
          if (this.matrixHandler) {
            return this.matrixHandler.onRoomQuery(alias).then(() => null);
          }
          return Promise.resolve(null);
        },
        
        onEvent: (request: any) => {
          if (this.matrixHandler) {
            return this.matrixHandler.handleEvent(request);
          }
          return Promise.resolve();
        },
      },
    });

    this.logger.info('Matrix Application Service initialized');
  }

  /**
   * Initialize all handlers
   */
  private async initializeHandlers(): Promise<void> {
    if (!this.bridge) {
      throw new Error('Bridge not initialized');
    }

    this.logger.info('Initializing bridge handlers...');

    // Initialize Matrix handler
    this.matrixHandler = new MatrixHandler({
      bridge: this.bridge,
      userManager: this.userManager,
      roomManager: this.roomManager,
      messageManager: this.messageManager,
      config: this.config,
    });

    await this.matrixHandler.initialize();

    this.logger.info('Bridge handlers initialized');
  }

  /**
   * Initialize app-to-room mappings from configuration
   */
  private async initializeAppMappings(): Promise<void> {
    this.logger.info('Initializing app-to-room mappings...');

    const apps = this.config.googleplay.applications;
    
    for (const app of apps) {
      try {
        // Create room mapping
        await this.roomManager.createRoomMapping(
          app.packageName,
          app.matrixRoom,
          app.appName || app.packageName,
          'reviews'
        );

        // Create app room mapping
        await this.roomManager.createAppRoomMapping(
          app.packageName,
          app.appName || app.packageName,
          app.matrixRoom,
          true
        );

        this.logger.info(`Mapped app ${app.packageName} to room ${app.matrixRoom}`);
      } catch (error) {
        this.logger.error(`Failed to map app ${app.packageName}: ${error instanceof Error ? error.message : error}`);
      }
    }

    this.logger.info(`Initialized ${apps.length} app-to-room mappings`);
  }

  /**
   * Start the bridge server
   */
  private async startBridge(): Promise<void> {
    if (!this.bridge) {
      throw new Error('Bridge not initialized');
    }

    this.logger.info(`Starting bridge server on port ${this.config.appservice.port}...`);

    await this.bridge.listen(
      this.config.appservice.port,
      this.config.appservice.bind
    );

    this.logger.info(`Bridge server listening on ${this.config.appservice.bind}:${this.config.appservice.port}`);
  }

  /**
   * Create Application Service registration from config
   */
  private createRegistration(): AppServiceRegistration {
    const registration = new AppServiceRegistration(this.config.appservice.id);

    // Set basic registration properties
    registration.setHomeserverToken(this.generateToken());
    registration.setAppServiceToken(this.config.appservice.token);
    registration.setSenderLocalpart(this.config.appservice.botUsername);
    registration.setId(this.config.appservice.id);
    registration.setProtocols(['googleplay']);
    registration.setRateLimited(false);

    // Set user namespace - all Google Play virtual users
    registration.addRegexPattern('users', '@googleplay_.*', true);
    
    // Add the bot user specifically
    registration.addRegexPattern(
      'users', 
      `@${this.config.appservice.botUsername}`, 
      true
    );

    // We don't claim exclusive rights to rooms or aliases
    // since users will invite the bot to existing rooms

    return registration;
  }

  /**
   * Generate a homeserver token (this should match registration.yaml)
   */
  private generateToken(): string {
    // In a real implementation, this would be loaded from the registration file
    // For now, we'll use a placeholder
    return 'hs_token_placeholder';
  }

  /**
   * Get bridge statistics
   */
  getStats(): {
    isRunning: boolean;
    uptime: number;
    bridge: any;
  } {
    const bridgeStats = this.matrixHandler?.getBridgeStats() || {
      connectedRooms: 0,
      virtualUsers: 0,
      messagesSent: 0,
    };

    return {
      isRunning: this.isRunning,
      uptime: process.uptime(),
      bridge: bridgeStats,
    };
  }

  /**
   * Handle a new Google Play review
   */
  async handleNewReview(reviewData: any): Promise<void> {
    try {
      // This would be called by the GooglePlayHandler when a new review is detected
      this.logger.info(`Handling new review: ${reviewData.reviewId} for ${reviewData.packageName}`);

      // Create virtual user for reviewer
      if (this.matrixHandler) {
        await this.matrixHandler.createVirtualUser(
          reviewData.reviewId,
          reviewData.authorName
        );

        // Send review to Matrix
        await this.matrixHandler.sendReviewToMatrix(
          reviewData.reviewId,
          reviewData.packageName
        );
      }
    } catch (error) {
      this.logger.error(`Error handling new review: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Handle a reply from Matrix to Google Play
   */
  async handleReplyToGooglePlay(
    roomId: string,
    reviewId: string,
    replyText: string
  ): Promise<boolean> {
    try {
      // This would integrate with GooglePlayClient to send the reply
      this.logger.info(`Handling reply to Google Play: review ${reviewId} from room ${roomId}`);

      // For now, just log and return success
      this.logger.info(`Reply text: ${replyText}`);
      
      return true;
    } catch (error) {
      this.logger.error(`Error sending reply to Google Play: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }


  /**
   * Setup graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string): Promise<void> => {
      this.logger.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        this.logger.error(`Error during shutdown: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // nodemon restart
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    this.logger.info('Cleaning up bridge resources...');

    try {
      // Shutdown handlers
      if (this.matrixHandler) {
        await this.matrixHandler.shutdown();
      }

      // Close bridge server
      if (this.bridge) {
        // The bridge doesn't have a direct close method, but stopping
        // the process will handle cleanup
        this.logger.debug('Bridge server will be cleaned up on process exit');
      }

      this.logger.info('Bridge cleanup completed');
    } catch (error) {
      this.logger.error(`Error during cleanup: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  /**
   * Check if the bridge is running
   */
  isRunningStatus(): boolean {
    return this.isRunning;
  }

  /**
   * Get the Matrix handler (for testing/debugging)
   */
  getMatrixHandler(): MatrixHandler | undefined {
    return this.matrixHandler;
  }

  /**
   * Get the user manager (for testing/debugging)
   */
  getUserManager(): UserManager {
    return this.userManager;
  }

  /**
   * Get the room manager (for testing/debugging)
   */
  getRoomManager(): RoomManager {
    return this.roomManager;
  }

  /**
   * Get the message manager (for testing/debugging)
   */
  getMessageManager(): MessageManager {
    return this.messageManager;
  }
}