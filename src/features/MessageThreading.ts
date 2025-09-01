import { GooglePlayReview } from '../models/Message';
import { Logger } from '../utils/Logger';
import { EventEmitter } from 'events';
import { Bridge } from 'matrix-appservice-bridge';

export interface ThreadInfo {
  threadId: string;
  rootEventId: string;
  reviewId: string;
  packageName: string;
  roomId: string;
  participants: Set<string>;
  messageCount: number;
  lastActivity: Date;
  status: 'active' | 'resolved' | 'archived';
  tags: string[];
}

export interface ThreadMessage {
  eventId: string;
  threadId: string;
  userId: string;
  content: any;
  timestamp: Date;
  messageType: 'review' | 'reply' | 'system' | 'notification';
  isFromBridge: boolean;
}

export interface ThreadingConfig {
  enableThreading: boolean;
  enableReplyChains: boolean;
  threadTimeoutHours: number;
  maxThreadMessages: number;
  autoResolveAfterHours: number;
  notifyOnNewThread: boolean;
  mentionOnReply: boolean;
  threadSummaryEnabled: boolean;
  archiveResolvedThreads: boolean;
}

export interface ThreadStats {
  totalThreads: number;
  activeThreads: number;
  resolvedThreads: number;
  archivedThreads: number;
  averageMessagesPerThread: number;
  averageThreadLifetime: number; // in hours
  topParticipants: Array<{ userId: string; threadCount: number }>;
}

/**
 * Message threading system for organizing review conversations
 * Implements Matrix thread specification for structured discussions
 */
export class MessageThreading extends EventEmitter {
  private readonly logger: Logger;
  private threads: Map<string, ThreadInfo> = new Map();
  private messageToThread: Map<string, string> = new Map();
  private reviewToThread: Map<string, string> = new Map();
  private userThreads: Map<string, Set<string>> = new Map();
  private roomThreads: Map<string, Set<string>> = new Map();

  constructor(
    private readonly bridge: Bridge,
    private readonly config: ThreadingConfig
  ) {
    super();
    this.logger = Logger.getInstance().child({ component: 'MessageThreading' });

    if (this.config.enableThreading) {
      this.setupAutoCleanup();
    }
  }

  /**
   * Create a new thread for a review
   */
  public async createReviewThread(
    review: GooglePlayReview,
    roomId: string,
    rootEventId: string,
    packageName: string
  ): Promise<ThreadInfo> {
    const threadId = this.generateThreadId(review.reviewId, packageName);

    const threadInfo: ThreadInfo = {
      threadId,
      rootEventId,
      reviewId: review.reviewId,
      packageName,
      roomId,
      participants: new Set(),
      messageCount: 1,
      lastActivity: new Date(),
      status: 'active',
      tags: this.generateThreadTags(review),
    };

    // Add initial participant (virtual reviewer user)
    const reviewerUserId = this.getReviewerUserId(
      review.authorName,
      packageName
    );
    threadInfo.participants.add(reviewerUserId);

    // Store thread info
    this.threads.set(threadId, threadInfo);
    this.messageToThread.set(rootEventId, threadId);
    this.reviewToThread.set(review.reviewId, threadId);
    this.updateUserThreads(reviewerUserId, threadId);
    this.updateRoomThreads(roomId, threadId);

    // Send thread creation notification if enabled
    if (this.config.notifyOnNewThread) {
      await this.sendThreadNotification(threadInfo, 'created');
    }

    this.logger.info(
      `Created thread ${threadId} for review ${review.reviewId}`
    );
    this.emit('thread:created', threadInfo);

    return threadInfo;
  }

  /**
   * Add a message to an existing thread
   */
  public async addMessageToThread(
    threadId: string,
    eventId: string,
    userId: string,
    content: any,
    messageType: 'review' | 'reply' | 'system' | 'notification' = 'reply',
    isFromBridge: boolean = false
  ): Promise<ThreadMessage> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const threadMessage: ThreadMessage = {
      eventId,
      threadId,
      userId,
      content,
      timestamp: new Date(),
      messageType,
      isFromBridge,
    };

    // Update thread info
    thread.participants.add(userId);
    thread.messageCount++;
    thread.lastActivity = new Date();
    thread.status = 'active'; // Reactivate if was resolved

    // Store mappings
    this.messageToThread.set(eventId, threadId);
    this.updateUserThreads(userId, threadId);

    this.logger.debug(`Added message to thread ${threadId}: ${eventId}`);
    this.emit('thread:message', threadMessage, thread);

    return threadMessage;
  }

  /**
   * Send a threaded reply to a review
   */
  public async sendThreadedReply(
    threadId: string,
    replyText: string,
    fromUserId: string,
    mentionUsers: string[] = []
  ): Promise<string> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const intent = this.bridge.getIntent(fromUserId);

    // Prepare threaded message content
    const content: any = {
      msgtype: 'm.text',
      body: replyText,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: thread.rootEventId,
      } as any,
    };

    // Add mentions if configured
    if (this.config.mentionOnReply && mentionUsers.length > 0) {
      const mentions = mentionUsers
        .map(userId => `[${userId}](https://matrix.to/#/${userId})`)
        .join(' ');
      content.body = `${mentions} ${replyText}`;
      content.format = 'org.matrix.custom.html';
      content.formatted_body = `${mentionUsers.map(userId => `<a href="https://matrix.to/#/${userId}">${userId}</a>`).join(' ')} ${replyText}`;
    }

    // Send the message
    const eventResult = await intent.sendMessage(thread.roomId, content);
    const eventId =
      typeof eventResult === 'string' ? eventResult : eventResult.event_id;

    // Add to thread
    await this.addMessageToThread(
      threadId,
      eventId,
      fromUserId,
      content,
      'reply',
      true
    );

    this.logger.info(`Sent threaded reply in ${threadId}: ${eventId}`);
    return eventId;
  }

  /**
   * Get thread information by thread ID
   */
  public getThread(threadId: string): ThreadInfo | undefined {
    return this.threads.get(threadId);
  }

  /**
   * Get thread by review ID
   */
  public getThreadByReview(reviewId: string): ThreadInfo | undefined {
    const threadId = this.reviewToThread.get(reviewId);
    return threadId ? this.threads.get(threadId) : undefined;
  }

  /**
   * Get thread by message event ID
   */
  public getThreadByMessage(eventId: string): ThreadInfo | undefined {
    const threadId = this.messageToThread.get(eventId);
    return threadId ? this.threads.get(threadId) : undefined;
  }

  /**
   * Get all threads in a room
   */
  public getRoomThreads(roomId: string): ThreadInfo[] {
    const threadIds = this.roomThreads.get(roomId) || new Set();
    return Array.from(threadIds)
      .map(id => this.threads.get(id))
      .filter((thread): thread is ThreadInfo => thread !== undefined)
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  }

  /**
   * Get threads for a specific user
   */
  public getUserThreads(userId: string): ThreadInfo[] {
    const threadIds = this.userThreads.get(userId) || new Set();
    return Array.from(threadIds)
      .map(id => this.threads.get(id))
      .filter((thread): thread is ThreadInfo => thread !== undefined)
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  }

  /**
   * Get active threads across all rooms
   */
  public getActiveThreads(): ThreadInfo[] {
    return Array.from(this.threads.values())
      .filter(thread => thread.status === 'active')
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  }

  /**
   * Resolve a thread (mark as completed/resolved)
   */
  public async resolveThread(
    threadId: string,
    resolvedBy: string,
    reason?: string
  ): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    thread.status = 'resolved';
    thread.lastActivity = new Date();

    // Send resolution notification
    const intent = this.bridge.getIntent();
    const notificationContent = {
      msgtype: 'm.notice',
      body: `Thread resolved${reason ? `: ${reason}` : ''} (by ${resolvedBy})`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: thread.rootEventId,
      } as any,
    };

    await intent.sendMessage(thread.roomId, notificationContent);

    this.logger.info(`Resolved thread ${threadId} by ${resolvedBy}`);
    this.emit('thread:resolved', thread, resolvedBy, reason);

    // Schedule archiving if configured
    if (this.config.archiveResolvedThreads) {
      setTimeout(
        () => {
          this.archiveThread(threadId).catch(error => {
            this.logger.error(
              `Failed to archive resolved thread ${threadId}:`,
              error
            );
          });
        },
        this.config.autoResolveAfterHours * 60 * 60 * 1000
      );
    }
  }

  /**
   * Archive a thread (move to archived state)
   */
  public async archiveThread(threadId: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    thread.status = 'archived';
    thread.lastActivity = new Date();

    this.logger.info(`Archived thread ${threadId}`);
    this.emit('thread:archived', thread);
  }

  /**
   * Generate thread summary
   */
  public async generateThreadSummary(threadId: string): Promise<string> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const duration = Date.now() - new Date(thread.lastActivity).getTime();
    const durationHours = Math.round(duration / (1000 * 60 * 60));

    const summary = [
      `**Thread Summary: ${threadId}**`,
      `📱 Review ID: ${thread.reviewId}`,
      `📦 App: ${thread.packageName}`,
      `👥 Participants: ${thread.participants.size}`,
      `💬 Messages: ${thread.messageCount}`,
      `⏱️ Duration: ${durationHours}h`,
      `🏷️ Status: ${thread.status}`,
      `🏷️ Tags: ${thread.tags.join(', ')}`,
    ];

    return summary.join('\n');
  }

  /**
   * Get threading statistics
   */
  public getThreadingStats(): ThreadStats {
    const threads = Array.from(this.threads.values());
    const activeThreads = threads.filter(t => t.status === 'active');
    const resolvedThreads = threads.filter(t => t.status === 'resolved');
    const archivedThreads = threads.filter(t => t.status === 'archived');

    const totalMessages = threads.reduce((sum, t) => sum + t.messageCount, 0);
    const averageMessagesPerThread =
      threads.length > 0 ? totalMessages / threads.length : 0;

    // Calculate average thread lifetime
    const now = Date.now();
    const lifetimes = threads.map(
      t => (now - t.lastActivity.getTime()) / (1000 * 60 * 60)
    ); // in hours
    const averageThreadLifetime =
      lifetimes.length > 0
        ? lifetimes.reduce((sum, l) => sum + l, 0) / lifetimes.length
        : 0;

    // Count user participation
    const userParticipation = new Map<string, number>();
    for (const thread of threads) {
      for (const userId of thread.participants) {
        userParticipation.set(userId, (userParticipation.get(userId) || 0) + 1);
      }
    }

    const topParticipants = Array.from(userParticipation.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, threadCount]) => ({ userId, threadCount }));

    return {
      totalThreads: threads.length,
      activeThreads: activeThreads.length,
      resolvedThreads: resolvedThreads.length,
      archivedThreads: archivedThreads.length,
      averageMessagesPerThread,
      averageThreadLifetime,
      topParticipants,
    };
  }

  /**
   * Clean up old threads
   */
  public async cleanupOldThreads(): Promise<number> {
    const cutoffTime =
      Date.now() - this.config.threadTimeoutHours * 60 * 60 * 1000;
    const threadsToCleanup: string[] = [];

    for (const [threadId, thread] of this.threads) {
      if (
        thread.lastActivity.getTime() < cutoffTime &&
        thread.status !== 'active'
      ) {
        threadsToCleanup.push(threadId);
      }
    }

    // Remove old threads
    for (const threadId of threadsToCleanup) {
      const thread = this.threads.get(threadId);
      if (thread) {
        this.removeThread(threadId);
        this.emit('thread:cleanup', thread);
      }
    }

    if (threadsToCleanup.length > 0) {
      this.logger.info(`Cleaned up ${threadsToCleanup.length} old threads`);
    }

    return threadsToCleanup.length;
  }

  /**
   * Export thread data
   */
  public exportThreads(roomId?: string): string {
    let threads: ThreadInfo[];

    if (roomId) {
      threads = this.getRoomThreads(roomId);
    } else {
      threads = Array.from(this.threads.values());
    }

    return JSON.stringify(threads, null, 2);
  }

  private generateThreadId(reviewId: string, packageName: string): string {
    const timestamp = Date.now();
    const hash = this.simpleHash(`${reviewId}${packageName}${timestamp}`);
    return `thread_${hash}`;
  }

  private generateThreadTags(review: GooglePlayReview): string[] {
    const tags: string[] = [];

    // Rating-based tags
    if (review.starRating <= 2) tags.push('negative');
    else if (review.starRating >= 4) tags.push('positive');
    else tags.push('neutral');

    // Device-based tags
    if (review.device) {
      tags.push('device-info');
    }

    // Version-based tags
    if (review.appVersionName) {
      tags.push(`version-${review.appVersionName.replace(/\./g, '_')}`);
    }

    return tags;
  }

  private getReviewerUserId(authorName: string, packageName: string): string {
    const hash = this.simpleHash(authorName + packageName);
    // Use homeserver domain from config instead of bridge.domain
    const domain = (this.bridge as any).domain || 'localhost';
    return `@_googleplay_${packageName.replace(/\./g, '_')}_${hash}:${domain}`;
  }

  private updateUserThreads(userId: string, threadId: string): void {
    if (!this.userThreads.has(userId)) {
      this.userThreads.set(userId, new Set());
    }
    this.userThreads.get(userId)!.add(threadId);
  }

  private updateRoomThreads(roomId: string, threadId: string): void {
    if (!this.roomThreads.has(roomId)) {
      this.roomThreads.set(roomId, new Set());
    }
    this.roomThreads.get(roomId)!.add(threadId);
  }

  private async sendThreadNotification(
    thread: ThreadInfo,
    action: 'created' | 'resolved'
  ): Promise<void> {
    try {
      const intent = this.bridge.getIntent();
      const content = {
        msgtype: 'm.notice',
        body: `Thread ${action}: ${thread.threadId} for review ${thread.reviewId}`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: thread.rootEventId,
        },
      };

      await intent.sendMessage(thread.roomId, content);
    } catch (error) {
      this.logger.error(`Failed to send thread notification:`, error);
    }
  }

  private removeThread(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;

    // Remove from all indices
    this.threads.delete(threadId);
    this.reviewToThread.delete(thread.reviewId);

    // Clean up user threads
    for (const userId of thread.participants) {
      const userThreadSet = this.userThreads.get(userId);
      if (userThreadSet) {
        userThreadSet.delete(threadId);
        if (userThreadSet.size === 0) {
          this.userThreads.delete(userId);
        }
      }
    }

    // Clean up room threads
    const roomThreadSet = this.roomThreads.get(thread.roomId);
    if (roomThreadSet) {
      roomThreadSet.delete(threadId);
      if (roomThreadSet.size === 0) {
        this.roomThreads.delete(thread.roomId);
      }
    }

    // Clean up message mappings (would need to track all messages in thread)
    // This is simplified - in production you'd want to track all message IDs
  }

  private setupAutoCleanup(): void {
    // Run cleanup every hour
    setInterval(
      () => {
        this.cleanupOldThreads().catch(error => {
          this.logger.error('Auto cleanup failed:', error);
        });
      },
      60 * 60 * 1000
    );

    // Run initial cleanup after 1 minute
    setTimeout(() => {
      this.cleanupOldThreads().catch(error => {
        this.logger.error('Initial cleanup failed:', error);
      });
    }, 60 * 1000);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

/**
 * Utility functions for thread management
 */
export class ThreadingUtils {
  /**
   * Extract thread ID from Matrix event content
   */
  static extractThreadId(eventContent: any): string | null {
    const relatesTo = eventContent['m.relates_to'];
    if (relatesTo?.rel_type === 'm.thread' && relatesTo.event_id) {
      return relatesTo.event_id;
    }
    return null;
  }

  /**
   * Create threaded message content
   */
  static createThreadedContent(
    body: string,
    rootEventId: string,
    format?: string,
    formattedBody?: string
  ): any {
    const content: any = {
      msgtype: 'm.text',
      body,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootEventId,
      },
    };

    if (format && formattedBody) {
      content.format = format;
      content.formatted_body = formattedBody;
    }

    return content;
  }

  /**
   * Check if event is part of a thread
   */
  static isThreadedEvent(eventContent: any): boolean {
    return this.extractThreadId(eventContent) !== null;
  }
}
