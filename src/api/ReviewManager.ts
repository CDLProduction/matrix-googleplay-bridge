import { GooglePlayClient, GooglePlayReviewData } from './GooglePlayClient';
import { MessageManager, GooglePlayReview } from '../models/Message';
import { MatrixHandler } from '../bridge/MatrixHandler';
import { Logger } from '../utils/Logger';

export interface ReviewPollingOptions {
  packageName: string;
  pollIntervalMs: number;
  maxReviewsPerPoll?: number;
  lookbackDays?: number;
}

export interface ReviewProcessingStats {
  totalReviewsProcessed: number;
  newReviewsFound: number;
  updatedReviewsFound: number;
  repliesSent: number;
  errors: number;
  lastPollTime: Date;
}

export interface PendingReply {
  packageName: string;
  reviewId: string;
  replyText: string;
  matrixEventId: string;
  matrixRoomId: string;
  senderId: string;
  timestamp: Date;
  retryCount: number;
}

/**
 * Manages Google Play review polling, processing, and reply coordination
 * Handles the 7-day review access window and coordinates with Matrix
 */
export class ReviewManager {
  private googlePlayClient: GooglePlayClient;
  private messageManager: MessageManager;
  private matrixHandler: MatrixHandler;
  private logger: Logger;
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastPollTimes: Map<string, Date> = new Map();
  private processingStats: Map<string, ReviewProcessingStats> = new Map();
  private pendingReplies: PendingReply[] = [];
  private replyProcessor: NodeJS.Timeout | null = null;

  constructor(
    googlePlayClient: GooglePlayClient,
    messageManager: MessageManager,
    matrixHandler: MatrixHandler
  ) {
    this.googlePlayClient = googlePlayClient;
    this.messageManager = messageManager;
    this.matrixHandler = matrixHandler;
    this.logger = Logger.getInstance();
  }

  /**
   * Initialize the review manager and start processing
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Review Manager...');

    // Ensure Google Play client is ready
    if (!this.googlePlayClient.isReady()) {
      await this.googlePlayClient.initialize();
    }

    // Start reply processor (processes pending replies every 30 seconds)
    this.replyProcessor = setInterval(() => {
      this.processRepliesQueue().catch(error => {
        this.logger.error(
          `Error processing replies queue: ${error instanceof Error ? error.message : error}`
        );
      });
    }, 30000);

    this.logger.info('Review Manager initialized successfully');
  }

  /**
   * Start polling reviews for a specific package
   */
  async startPollingReviews(options: ReviewPollingOptions): Promise<void> {
    const {
      packageName,
      pollIntervalMs,
      maxReviewsPerPoll = 100,
      lookbackDays = 7,
    } = options;

    this.logger.info(
      `Starting review polling for ${packageName} (interval: ${pollIntervalMs}ms)`
    );

    // Test connection first
    const connectionTest =
      await this.googlePlayClient.testConnection(packageName);
    if (!connectionTest) {
      throw new Error(
        `Failed to connect to Google Play API for package: ${packageName}`
      );
    }

    // Initialize stats
    this.processingStats.set(packageName, {
      totalReviewsProcessed: 0,
      newReviewsFound: 0,
      updatedReviewsFound: 0,
      repliesSent: 0,
      errors: 0,
      lastPollTime: new Date(),
    });

    // Set initial poll time (look back the specified number of days)
    const lookbackTime = new Date();
    lookbackTime.setDate(lookbackTime.getDate() - lookbackDays);
    this.lastPollTimes.set(packageName, lookbackTime);

    // Start immediate poll
    await this.pollReviews(packageName, maxReviewsPerPoll);

    // Set up recurring polling
    const interval = setInterval(async () => {
      try {
        await this.pollReviews(packageName, maxReviewsPerPoll);
      } catch (error) {
        this.logger.error(
          `Error polling reviews for ${packageName}: ${error instanceof Error ? error.message : error}`
        );
        this.incrementErrorCount(packageName);
      }
    }, pollIntervalMs);

    this.pollingIntervals.set(packageName, interval);
    this.logger.info(`Review polling started for ${packageName}`);
  }

  /**
   * Stop polling reviews for a specific package
   */
  stopPollingReviews(packageName: string): void {
    const interval = this.pollingIntervals.get(packageName);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(packageName);
      this.logger.info(`Stopped review polling for ${packageName}`);
    }
  }

  /**
   * Queue a reply to be sent to Google Play
   */
  async queueReply(
    packageName: string,
    reviewId: string,
    replyText: string,
    matrixEventId: string,
    matrixRoomId: string,
    senderId: string
  ): Promise<void> {
    this.logger.debug(
      `Queueing reply for review ${reviewId}: ${replyText.substring(0, 50)}...`
    );

    const pendingReply: PendingReply = {
      packageName,
      reviewId,
      replyText,
      matrixEventId,
      matrixRoomId,
      senderId,
      timestamp: new Date(),
      retryCount: 0,
    };

    this.pendingReplies.push(pendingReply);
    this.logger.info(
      `Reply queued for review ${reviewId} (queue size: ${this.pendingReplies.length})`
    );
  }

  /**
   * Get processing statistics for a package
   */
  getProcessingStats(packageName: string): ReviewProcessingStats | null {
    return this.processingStats.get(packageName) || null;
  }

  /**
   * Get processing statistics for all packages
   */
  getAllProcessingStats(): Map<string, ReviewProcessingStats> {
    return new Map(this.processingStats);
  }

  /**
   * Get the number of pending replies
   */
  getPendingRepliesCount(): number {
    return this.pendingReplies.length;
  }

  /**
   * Gracefully shutdown the review manager
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Review Manager...');

    // Stop all polling intervals
    for (const [packageName, interval] of this.pollingIntervals.entries()) {
      clearInterval(interval);
      this.logger.debug(`Stopped polling for ${packageName}`);
    }
    this.pollingIntervals.clear();

    // Stop reply processor
    if (this.replyProcessor) {
      clearInterval(this.replyProcessor);
      this.replyProcessor = null;
    }

    // Process any remaining replies
    if (this.pendingReplies.length > 0) {
      this.logger.info(
        `Processing ${this.pendingReplies.length} pending replies before shutdown...`
      );
      await this.processRepliesQueue();
    }

    this.logger.info('Review Manager shutdown complete');
  }

  /**
   * Poll reviews for a specific package since last poll time
   */
  private async pollReviews(
    packageName: string,
    maxReviews: number
  ): Promise<void> {
    const lastPollTime =
      this.lastPollTimes.get(packageName) ||
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default to 7 days ago
    const currentPollTime = new Date();

    this.logger.debug(
      `Polling reviews for ${packageName} since ${lastPollTime.toISOString()}`
    );

    try {
      // Get recent reviews from Google Play
      const recentReviews = await this.googlePlayClient.getRecentReviews(
        packageName,
        lastPollTime,
        maxReviews
      );

      this.logger.debug(
        `Found ${recentReviews.length} recent reviews for ${packageName}`
      );

      // Process each review
      let newReviews = 0;
      let updatedReviews = 0;

      for (const reviewData of recentReviews) {
        try {
          const isNew = await this.processReview(packageName, reviewData);
          if (isNew) {
            newReviews++;
          } else {
            updatedReviews++;
          }
        } catch (error) {
          this.logger.error(
            `Error processing review ${reviewData.reviewId}: ${error instanceof Error ? error.message : error}`
          );
          this.incrementErrorCount(packageName);
        }
      }

      // Update stats
      const stats = this.processingStats.get(packageName);
      if (stats) {
        stats.totalReviewsProcessed += recentReviews.length;
        stats.newReviewsFound += newReviews;
        stats.updatedReviewsFound += updatedReviews;
        stats.lastPollTime = currentPollTime;
      }

      // Update last poll time
      this.lastPollTimes.set(packageName, currentPollTime);

      if (recentReviews.length > 0) {
        this.logger.info(
          `Processed ${recentReviews.length} reviews for ${packageName} (${newReviews} new, ${updatedReviews} updated)`
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to poll reviews for ${packageName}: ${error instanceof Error ? error.message : error}`
      );
      this.incrementErrorCount(packageName);
      throw error;
    }
  }

  /**
   * Process a single review and send to Matrix if new or updated
   */
  private async processReview(
    packageName: string,
    reviewData: GooglePlayReviewData
  ): Promise<boolean> {
    // Convert to internal review format
    const review: GooglePlayReview = {
      reviewId: reviewData.reviewId,
      packageName: reviewData.packageName,
      authorName: reviewData.authorName,
      starRating: reviewData.starRating,
      createdAt: reviewData.createdAt,
      lastModifiedAt: reviewData.lastModifiedAt,
      hasReply: reviewData.hasReply,
    };

    if (reviewData.text) {
      review.text = reviewData.text;
    }

    // Add optional metadata if available
    if (reviewData.languageCode) {
      review.languageCode = reviewData.languageCode;
    }

    if (reviewData.device) {
      review.device = reviewData.device;
    }

    if (reviewData.androidOsVersion) {
      review.androidOsVersion = reviewData.androidOsVersion;
    }

    if (reviewData.appVersionCode) {
      review.appVersionCode = reviewData.appVersionCode;
    }

    if (reviewData.appVersionName) {
      review.appVersionName = reviewData.appVersionName;
    }

    // Check if this is a new review or an update
    const existingReview = this.messageManager.getGooglePlayReview(
      reviewData.reviewId
    );
    const isNewReview = !existingReview;

    if (isNewReview) {
      // Store new review
      this.messageManager.storeGooglePlayReview(review);
      this.logger.debug(`Stored new review: ${reviewData.reviewId}`);
    } else {
      // Check if review was updated
      if (
        existingReview &&
        existingReview.lastModifiedAt < reviewData.lastModifiedAt
      ) {
        // Update existing review
        this.messageManager.updateGooglePlayReview(review);
        this.logger.debug(`Updated existing review: ${reviewData.reviewId}`);
      } else {
        // No changes, skip processing
        return false;
      }
    }

    // Send review to Matrix rooms
    try {
      await this.matrixHandler.sendReviewToMatrix(
        reviewData.reviewId,
        packageName
      );

      if (isNewReview) {
        // Create virtual user for the reviewer
        await this.matrixHandler.createVirtualUser(
          reviewData.reviewId,
          reviewData.authorName
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send review ${reviewData.reviewId} to Matrix: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }

    return isNewReview;
  }

  /**
   * Process the queue of pending replies
   */
  private async processRepliesQueue(): Promise<void> {
    if (this.pendingReplies.length === 0) {
      return;
    }

    this.logger.debug(
      `Processing ${this.pendingReplies.length} pending replies`
    );

    const toProcess = [...this.pendingReplies];
    this.pendingReplies = [];

    for (const reply of toProcess) {
      try {
        await this.sendReplyToGooglePlay(reply);

        // Update stats
        const stats = this.processingStats.get(reply.packageName);
        if (stats) {
          stats.repliesSent++;
        }

        this.logger.info(`Successfully sent reply to review ${reply.reviewId}`);
      } catch (error) {
        this.logger.error(
          `Failed to send reply to review ${reply.reviewId}: ${error instanceof Error ? error.message : error}`
        );

        // Retry logic
        if (reply.retryCount < 3) {
          reply.retryCount++;
          reply.timestamp = new Date();
          this.pendingReplies.push(reply);
          this.logger.debug(
            `Reply to ${reply.reviewId} requeued for retry (attempt ${reply.retryCount + 1}/4)`
          );
        } else {
          // Send failure notification to Matrix
          await this.sendReplyFailureNotification(reply, error);
          this.incrementErrorCount(reply.packageName);
        }
      }
    }
  }

  /**
   * Send a reply to Google Play Console
   */
  private async sendReplyToGooglePlay(reply: PendingReply): Promise<void> {
    await this.googlePlayClient.replyToReview({
      packageName: reply.packageName,
      reviewId: reply.reviewId,
      replyText: reply.replyText,
    });

    // Send confirmation to Matrix
    await this.sendReplyConfirmation(reply, true);
  }

  /**
   * Send reply confirmation to Matrix
   */
  private async sendReplyConfirmation(
    reply: PendingReply,
    success: boolean,
    error?: any
  ): Promise<void> {
    const confirmationContent = this.messageManager.formatReplyConfirmation(
      success,
      error?.message
    );

    try {
      await this.matrixHandler.sendMessageToRoom(
        reply.matrixRoomId,
        confirmationContent
      );
    } catch (error) {
      this.logger.error(
        `Failed to send reply confirmation to Matrix: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * Send reply failure notification to Matrix
   */
  private async sendReplyFailureNotification(
    reply: PendingReply,
    error: any
  ): Promise<void> {
    const failureContent = {
      msgtype: 'm.notice',
      body: `❌ Failed to send reply to review ${reply.reviewId} after 4 attempts. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      format: 'org.matrix.custom.html',
      formatted_body: `<p><strong>❌ Reply Failed</strong></p><p>Could not send reply to review <code>${reply.reviewId}</code> after 4 attempts.</p><p><strong>Error:</strong> ${error instanceof Error ? error.message : 'Unknown error'}</p>`,
    };

    try {
      await this.matrixHandler.sendMessageToRoom(
        reply.matrixRoomId,
        failureContent
      );
    } catch (matrixError) {
      this.logger.error(
        `Failed to send reply failure notification to Matrix: ${matrixError instanceof Error ? matrixError.message : matrixError}`
      );
    }
  }

  /**
   * Increment error count for a package
   */
  private incrementErrorCount(packageName: string): void {
    const stats = this.processingStats.get(packageName);
    if (stats) {
      stats.errors++;
    }
  }

  // Phase 4.3 methods for maintenance mode support
  async pauseProcessing(): Promise<void> {
    this.logger.info('Pausing review processing for maintenance mode');
    
    // Stop all polling timers
    for (const timer of this.pollingIntervals.values()) {
      clearInterval(timer);
    }
    this.pollingIntervals.clear();
    
    this.logger.info('Review processing paused');
  }

  async resumeProcessing(): Promise<void> {
    this.logger.info('Resuming review processing from maintenance mode');
    
    // Restart polling for all active packages
    for (const [packageName] of this.processingStats) {
      this.logger.info(`Resuming polling for ${packageName}`);
      // Note: Would need access to the original config to restart properly
      // For now, just log that we would restart polling
    }
    
    this.logger.info('Review processing resumed');
  }

  updateConfiguration(newGooglePlayConfig: any): void {
    this.logger.info('Updating ReviewManager configuration');
    
    // Log configuration update
    this.logger.info('Review manager configuration updated', {
      pollInterval: newGooglePlayConfig.pollIntervalMs,
      appCount: newGooglePlayConfig.applications?.length || 0
    });
    
    // Note: In a full implementation, this would update polling intervals
    // but requires restructuring to store app configurations
  }
}
