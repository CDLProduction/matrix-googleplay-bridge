/**
 * Message data models for Matrix Google Play Bridge
 */

/**
 * Represents a Google Play review
 */
export interface GooglePlayReview {
  /** Unique review identifier */
  reviewId: string;
  /** Package name the review belongs to */
  packageName: string;
  /** Author name (may be anonymized by Google) */
  authorName: string;
  /** Review text content */
  text?: string;
  /** Star rating (1-5) */
  starRating: number;
  /** Review language code (e.g., 'en', 'es') */
  languageCode?: string;
  /** Device information */
  device?: string;
  /** Android version */
  androidOsVersion?: string;
  /** App version code when review was written */
  appVersionCode?: number;
  /** App version name when review was written */
  appVersionName?: string;
  /** Timestamp when review was created */
  createdAt: Date;
  /** Timestamp when review was last modified */
  lastModifiedAt: Date;
  /** Whether this review has been replied to */
  hasReply: boolean;
  /** Developer reply (if any) */
  developerReply?: GooglePlayReply;
}

/**
 * Represents a developer reply to a Google Play review
 */
export interface GooglePlayReply {
  /** Reply text content */
  text: string;
  /** Timestamp when reply was created */
  createdAt: Date;
  /** Timestamp when reply was last modified */
  lastModifiedAt: Date;
}

/**
 * Represents a Matrix message in the bridge system
 */
export interface MatrixMessage {
  /** Matrix event ID */
  eventId: string;
  /** Matrix room ID where message was sent */
  roomId: string;
  /** Matrix user ID who sent the message */
  senderId: string;
  /** Message content */
  content: MatrixMessageContent;
  /** Timestamp when message was sent */
  timestamp: Date;
  /** Whether this message was sent by the bridge */
  isBridgeMessage: boolean;
  /** Associated Google Play review ID (if applicable) */
  googlePlayReviewId?: string;
}

/**
 * Matrix message content structure
 */
export interface MatrixMessageContent {
  /** Message type (m.text, m.notice, etc.) */
  msgtype: string;
  /** Plain text body */
  body: string;
  /** Formatted HTML body (optional) */
  formatted_body?: string;
  /** Format type (org.matrix.custom.html) */
  format?: string;
  /** Additional metadata */
  [key: string]: any;
}

/**
 * Mapping between Google Play reviews and Matrix messages
 */
export interface MessageMapping {
  /** Internal mapping ID */
  id: string;
  /** Google Play review ID */
  googlePlayReviewId: string;
  /** Matrix event ID */
  matrixEventId: string;
  /** Matrix room ID where message was sent */
  matrixRoomId: string;
  /** Message type */
  messageType: 'review' | 'reply' | 'notification';
  /** Package name associated with this message */
  packageName: string;
  /** Timestamp when mapping was created */
  createdAt: Date;
  /** Timestamp when mapping was last updated */
  updatedAt: Date;
}

/**
 * Message formatting templates
 */
export interface MessageFormatter {
  /** Format a review for Matrix display */
  formatReviewForMatrix(review: GooglePlayReview): MatrixMessageContent;
  
  /** Format a reply confirmation for Matrix display */
  formatReplyConfirmation(success: boolean, error?: string): MatrixMessageContent;
  
  /** Format an error message for Matrix display */
  formatErrorMessage(error: string): MatrixMessageContent;
  
  /** Format a notification message for Matrix display */
  formatNotification(message: string): MatrixMessageContent;
}

/**
 * Default message formatter implementation
 */
export class DefaultMessageFormatter implements MessageFormatter {
  formatReviewForMatrix(review: GooglePlayReview): MatrixMessageContent {
    const rating = '⭐'.repeat(review.starRating) + '☆'.repeat(5 - review.starRating);
    const device = review.device ? ` (${review.device})` : '';
    const appVersion = review.appVersionName ? ` - v${review.appVersionName}` : '';
    
    const plainBody = `📱 New Google Play Review for ${review.packageName}

${rating} by ${review.authorName}${device}${appVersion}

${review.text || 'No review text provided.'}

📅 ${review.createdAt.toLocaleDateString()} at ${review.createdAt.toLocaleTimeString()}`;

    const htmlBody = `<h3>📱 New Google Play Review for <code>${review.packageName}</code></h3>
<p><strong>${rating}</strong> by <strong>${review.authorName}</strong>${device}${appVersion}</p>
<blockquote>${this.escapeHtml(review.text || 'No review text provided.')}</blockquote>
<p><small>📅 ${review.createdAt.toLocaleDateString()} at ${review.createdAt.toLocaleTimeString()}</small></p>`;

    return {
      msgtype: 'm.text',
      body: plainBody,
      formatted_body: htmlBody,
      format: 'org.matrix.custom.html',
      'dev.googleplay.review_id': review.reviewId,
      'dev.googleplay.package_name': review.packageName,
      'dev.googleplay.rating': review.starRating,
    };
  }

  formatReplyConfirmation(success: boolean, error?: string): MatrixMessageContent {
    if (success) {
      return {
        msgtype: 'm.notice',
        body: '✅ Reply sent successfully to Google Play!',
        formatted_body: '<p>✅ <strong>Reply sent successfully to Google Play!</strong></p>',
        format: 'org.matrix.custom.html',
      };
    } else {
      const errorMsg = error ? `: ${error}` : '';
      return {
        msgtype: 'm.notice',
        body: `❌ Failed to send reply to Google Play${errorMsg}`,
        formatted_body: `<p>❌ <strong>Failed to send reply to Google Play</strong>${errorMsg ? `<br><code>${this.escapeHtml(errorMsg)}</code>` : ''}</p>`,
        format: 'org.matrix.custom.html',
      };
    }
  }

  formatErrorMessage(error: string): MatrixMessageContent {
    return {
      msgtype: 'm.notice',
      body: `⚠️ Bridge Error: ${error}`,
      formatted_body: `<p>⚠️ <strong>Bridge Error:</strong><br><code>${this.escapeHtml(error)}</code></p>`,
      format: 'org.matrix.custom.html',
    };
  }

  formatNotification(message: string): MatrixMessageContent {
    return {
      msgtype: 'm.notice',
      body: `ℹ️ ${message}`,
      formatted_body: `<p>ℹ️ ${this.escapeHtml(message)}</p>`,
      format: 'org.matrix.custom.html',
    };
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

/**
 * Message management class for handling Google Play reviews and Matrix messages
 */
export class MessageManager {
  private messageMappings: Map<string, MessageMapping> = new Map();
  private matrixMessages: Map<string, MatrixMessage> = new Map();
  private googlePlayReviews: Map<string, GooglePlayReview> = new Map();
  private formatter: MessageFormatter = new DefaultMessageFormatter();

  /**
   * Set a custom message formatter
   */
  setFormatter(formatter: MessageFormatter): void {
    this.formatter = formatter;
  }

  /**
   * Store a Google Play review
   */
  async storeGooglePlayReview(review: GooglePlayReview): Promise<void> {
    this.googlePlayReviews.set(review.reviewId, review);
  }

  /**
   * Update an existing Google Play review
   */
  async updateGooglePlayReview(review: GooglePlayReview): Promise<void> {
    this.googlePlayReviews.set(review.reviewId, review);
  }

  /**
   * Store a Matrix message
   */
  async storeMatrixMessage(message: MatrixMessage): Promise<void> {
    this.matrixMessages.set(message.eventId, message);
  }

  /**
   * Create a message mapping
   */
  async createMessageMapping(
    googlePlayReviewId: string,
    matrixEventId: string,
    matrixRoomId: string,
    messageType: 'review' | 'reply' | 'notification',
    packageName: string
  ): Promise<MessageMapping> {
    const mappingId = `${googlePlayReviewId}_${matrixEventId}`;

    const mapping: MessageMapping = {
      id: mappingId,
      googlePlayReviewId,
      matrixEventId,
      matrixRoomId,
      messageType,
      packageName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.messageMappings.set(mappingId, mapping);
    return mapping;
  }

  /**
   * Get message mapping by Matrix event ID
   */
  async getMessageMappingByEventId(matrixEventId: string): Promise<MessageMapping | undefined> {
    for (const [, mapping] of this.messageMappings) {
      if (mapping.matrixEventId === matrixEventId) {
        return mapping;
      }
    }
    return undefined;
  }

  /**
   * Get message mapping by Google Play review ID
   */
  async getMessageMappingByReviewId(reviewId: string): Promise<MessageMapping | undefined> {
    for (const [, mapping] of this.messageMappings) {
      if (mapping.googlePlayReviewId === reviewId) {
        return mapping;
      }
    }
    return undefined;
  }

  /**
   * Format a Google Play review for Matrix
   */
  formatReviewForMatrix(review: GooglePlayReview): MatrixMessageContent {
    return this.formatter.formatReviewForMatrix(review);
  }

  /**
   * Format a reply confirmation for Matrix
   */
  formatReplyConfirmation(success: boolean, error?: string): MatrixMessageContent {
    return this.formatter.formatReplyConfirmation(success, error);
  }

  /**
   * Format an error message for Matrix
   */
  formatErrorMessage(error: string): MatrixMessageContent {
    return this.formatter.formatErrorMessage(error);
  }

  /**
   * Format a notification for Matrix
   */
  formatNotification(message: string): MatrixMessageContent {
    return this.formatter.formatNotification(message);
  }

  /**
   * Get Google Play review by ID
   */
  getGooglePlayReview(reviewId: string): GooglePlayReview | undefined {
    return this.googlePlayReviews.get(reviewId);
  }

  /**
   * Get Matrix message by event ID
   */
  getMatrixMessage(eventId: string): MatrixMessage | undefined {
    return this.matrixMessages.get(eventId);
  }

  /**
   * Get all Google Play reviews
   */
  getAllGooglePlayReviews(): GooglePlayReview[] {
    return Array.from(this.googlePlayReviews.values());
  }

  /**
   * Get all Matrix messages
   */
  getAllMatrixMessages(): MatrixMessage[] {
    return Array.from(this.matrixMessages.values());
  }

  /**
   * Get all message mappings
   */
  getAllMessageMappings(): MessageMapping[] {
    return Array.from(this.messageMappings.values());
  }

  /**
   * Check if a review has already been sent to Matrix
   */
  async hasReviewBeenSent(reviewId: string): Promise<boolean> {
    return this.googlePlayReviews.has(reviewId);
  }

  /**
   * Get message statistics
   */
  getMessageStats(): {
    totalReviews: number;
    totalMatrixMessages: number;
    totalMappings: number;
    reviewsWithReplies: number;
  } {
    const totalReviews = this.googlePlayReviews.size;
    const totalMatrixMessages = this.matrixMessages.size;
    const totalMappings = this.messageMappings.size;
    const reviewsWithReplies = Array.from(this.googlePlayReviews.values()).filter(
      review => review.hasReply
    ).length;

    return {
      totalReviews,
      totalMatrixMessages,
      totalMappings,
      reviewsWithReplies,
    };
  }
}