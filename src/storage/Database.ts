import { Logger } from '../utils/Logger';

/**
 * Database row interfaces for the bridge storage layer
 */

export interface UserMappingRow {
  id?: number;
  reviewId: string;
  matrixUserId: string;
  authorName: string;
  packageName: string;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface RoomMappingRow {
  id?: number;
  packageName: string;
  matrixRoomId: string;
  appName: string;
  roomType: 'reviews' | 'admin' | 'general';
  isPrimary: boolean;
  config: string; // JSON string
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageMappingRow {
  id?: number;
  googlePlayReviewId: string;
  matrixEventId: string;
  matrixRoomId: string;
  messageType: 'review' | 'reply' | 'notification';
  packageName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GooglePlayReviewRow {
  reviewId: string;
  packageName: string;
  authorName: string;
  text?: string;
  starRating: number;
  languageCode?: string;
  device?: string;
  androidOsVersion?: string;
  appVersionCode?: number;
  appVersionName?: string;
  createdAt: Date;
  lastModifiedAt: Date;
  hasReply: boolean;
  developerReplyText?: string;
  developerReplyCreatedAt?: Date;
  developerReplyLastModifiedAt?: Date;
}

export interface MatrixMessageRow {
  eventId: string;
  roomId: string;
  senderId: string;
  content: string; // JSON string
  timestamp: Date;
  isBridgeMessage: boolean;
}

/**
 * Database migration interface
 */
export interface Migration {
  version: number;
  description: string;
  up: (db: DatabaseInterface) => Promise<void>;
  down?: (db: DatabaseInterface) => Promise<void>;
}

/**
 * Database transaction interface
 */
export interface DatabaseTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  run(sql: string, params?: any[]): Promise<{ changes: number; lastID?: number }>;
}

/**
 * Generic database interface for the bridge
 */
export interface DatabaseInterface {
  /**
   * Initialize the database connection and run migrations
   */
  initialize(): Promise<void>;

  /**
   * Close the database connection
   */
  close(): Promise<void>;

  /**
   * Begin a database transaction
   */
  beginTransaction(): Promise<DatabaseTransaction>;

  /**
   * Execute a raw SQL query
   */
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;

  /**
   * Execute a SQL statement (INSERT, UPDATE, DELETE)
   */
  run(sql: string, params?: any[]): Promise<{ changes: number; lastID?: number }>;

  /**
   * Get the current database schema version
   */
  getSchemaVersion(): Promise<number>;

  /**
   * Set the database schema version
   */
  setSchemaVersion(version: number): Promise<void>;

  /**
   * Run database migrations
   */
  runMigrations(migrations: Migration[]): Promise<void>;

  // User mapping operations
  createUserMapping(mapping: Omit<UserMappingRow, 'id'>): Promise<UserMappingRow>;
  getUserMappingByReviewId(reviewId: string): Promise<UserMappingRow | null>;
  getUserMappingByMatrixUserId(matrixUserId: string): Promise<UserMappingRow | null>;
  updateUserLastActive(reviewId: string, lastActiveAt: Date): Promise<void>;
  deleteUserMapping(reviewId: string): Promise<void>;
  getAllUserMappings(): Promise<UserMappingRow[]>;
  cleanupInactiveUsers(olderThan: Date): Promise<number>;

  // Room mapping operations
  createRoomMapping(mapping: Omit<RoomMappingRow, 'id'>): Promise<RoomMappingRow>;
  getRoomMappingByRoomId(matrixRoomId: string): Promise<RoomMappingRow | null>;
  getRoomMappingsForPackage(packageName: string): Promise<RoomMappingRow[]>;
  updateRoomMapping(id: number, updates: Partial<RoomMappingRow>): Promise<void>;
  deleteRoomMapping(id: number): Promise<void>;
  getAllRoomMappings(): Promise<RoomMappingRow[]>;

  // Message mapping operations
  createMessageMapping(mapping: Omit<MessageMappingRow, 'id'>): Promise<MessageMappingRow>;
  getMessageMappingByEventId(matrixEventId: string): Promise<MessageMappingRow | null>;
  getMessageMappingsByReviewId(reviewId: string): Promise<MessageMappingRow[]>;
  deleteMessageMapping(id: number): Promise<void>;
  getAllMessageMappings(): Promise<MessageMappingRow[]>;

  // Google Play review operations
  storeGooglePlayReview(review: GooglePlayReviewRow): Promise<void>;
  getGooglePlayReview(reviewId: string): Promise<GooglePlayReviewRow | null>;
  updateGooglePlayReview(reviewId: string, updates: Partial<GooglePlayReviewRow>): Promise<void>;
  getReviewsForPackage(packageName: string, limit?: number): Promise<GooglePlayReviewRow[]>;
  getReviewsModifiedSince(since: Date, packageName?: string): Promise<GooglePlayReviewRow[]>;
  deleteGooglePlayReview(reviewId: string): Promise<void>;

  // Matrix message operations
  storeMatrixMessage(message: MatrixMessageRow): Promise<void>;
  getMatrixMessage(eventId: string): Promise<MatrixMessageRow | null>;
  getMatrixMessagesForRoom(roomId: string, limit?: number): Promise<MatrixMessageRow[]>;
  deleteMatrixMessage(eventId: string): Promise<void>;

  // Statistics and maintenance
  getStorageStats(): Promise<{
    userMappings: number;
    roomMappings: number;
    messageMappings: number;
    googlePlayReviews: number;
    matrixMessages: number;
    databaseSize?: number;
  }>;
  
  vacuum(): Promise<void>;
}

/**
 * Base database class with common functionality
 */
export abstract class BaseDatabase implements DatabaseInterface {
  protected logger: Logger;
  protected isInitialized: boolean = false;

  constructor() {
    this.logger = Logger.getInstance();
  }

  abstract initialize(): Promise<void>;
  abstract close(): Promise<void>;
  abstract beginTransaction(): Promise<DatabaseTransaction>;
  abstract query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  abstract run(sql: string, params?: any[]): Promise<{ changes: number; lastID?: number }>;

  async getSchemaVersion(): Promise<number> {
    try {
      const result = await this.query<{ version: number }>('SELECT version FROM schema_version ORDER BY id DESC LIMIT 1');
      return result.length > 0 ? result[0]!.version : 0;
    } catch (error) {
      // Table doesn't exist yet, return 0
      return 0;
    }
  }

  async setSchemaVersion(version: number): Promise<void> {
    await this.run('INSERT OR REPLACE INTO schema_version (id, version, applied_at) VALUES (1, ?, ?)', [
      version,
      new Date().toISOString(),
    ]);
  }

  async runMigrations(migrations: Migration[]): Promise<void> {
    const currentVersion = await this.getSchemaVersion();
    const pendingMigrations = migrations.filter(m => m.version > currentVersion);

    if (pendingMigrations.length === 0) {
      this.logger.info('Database schema is up to date');
      return;
    }

    this.logger.info(`Running ${pendingMigrations.length} database migrations...`);

    for (const migration of pendingMigrations.sort((a, b) => a.version - b.version)) {
      this.logger.info(`Applying migration ${migration.version}: ${migration.description}`);

      const transaction = await this.beginTransaction();
      try {
        await migration.up(this);
        await this.setSchemaVersion(migration.version);
        await transaction.commit();
        
        this.logger.info(`Migration ${migration.version} applied successfully`);
      } catch (error) {
        await transaction.rollback();
        this.logger.error(`Migration ${migration.version} failed: ${error instanceof Error ? error.message : error}`);
        throw error;
      }
    }

    this.logger.info('All database migrations completed successfully');
  }

  // Default implementations for common operations
  protected ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Database must be initialized before use');
    }
  }

  // User mapping operations with default implementations
  async createUserMapping(mapping: Omit<UserMappingRow, 'id'>): Promise<UserMappingRow> {
    this.ensureInitialized();
    const result = await this.run(
      `INSERT INTO user_mappings (review_id, matrix_user_id, author_name, package_name, created_at, last_active_at) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        mapping.reviewId,
        mapping.matrixUserId,
        mapping.authorName,
        mapping.packageName,
        mapping.createdAt.toISOString(),
        mapping.lastActiveAt.toISOString(),
      ]
    );

    if (result.lastID === undefined) {
      throw new Error('Failed to create user mapping: no ID returned');
    }
    
    return {
      id: result.lastID,
      ...mapping,
    };
  }

  async getUserMappingByReviewId(reviewId: string): Promise<UserMappingRow | null> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM user_mappings WHERE review_id = ?',
      [reviewId]
    );

    if (results.length === 0) return null;

    const row = results[0];
    return {
      id: row.id,
      reviewId: row.review_id,
      matrixUserId: row.matrix_user_id,
      authorName: row.author_name,
      packageName: row.package_name,
      createdAt: new Date(row.created_at),
      lastActiveAt: new Date(row.last_active_at),
    };
  }

  async getUserMappingByMatrixUserId(matrixUserId: string): Promise<UserMappingRow | null> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM user_mappings WHERE matrix_user_id = ?',
      [matrixUserId]
    );

    if (results.length === 0) return null;

    const row = results[0];
    return {
      id: row.id,
      reviewId: row.review_id,
      matrixUserId: row.matrix_user_id,
      authorName: row.author_name,
      packageName: row.package_name,
      createdAt: new Date(row.created_at),
      lastActiveAt: new Date(row.last_active_at),
    };
  }

  async updateUserLastActive(reviewId: string, lastActiveAt: Date): Promise<void> {
    this.ensureInitialized();
    await this.run(
      'UPDATE user_mappings SET last_active_at = ? WHERE review_id = ?',
      [lastActiveAt.toISOString(), reviewId]
    );
  }

  async deleteUserMapping(reviewId: string): Promise<void> {
    this.ensureInitialized();
    await this.run('DELETE FROM user_mappings WHERE review_id = ?', [reviewId]);
  }

  async getAllUserMappings(): Promise<UserMappingRow[]> {
    this.ensureInitialized();
    const results = await this.query<any>('SELECT * FROM user_mappings ORDER BY created_at DESC');

    return results.map((row: any) => ({
      id: row.id,
      reviewId: row.review_id,
      matrixUserId: row.matrix_user_id,
      authorName: row.author_name,
      packageName: row.package_name,
      createdAt: new Date(row.created_at),
      lastActiveAt: new Date(row.last_active_at),
    }));
  }

  async cleanupInactiveUsers(olderThan: Date): Promise<number> {
    this.ensureInitialized();
    const result = await this.run(
      'DELETE FROM user_mappings WHERE last_active_at < ?',
      [olderThan.toISOString()]
    );
    return result.changes;
  }

  // Abstract methods that must be implemented by concrete database classes
  abstract createRoomMapping(mapping: Omit<RoomMappingRow, 'id'>): Promise<RoomMappingRow>;
  abstract getRoomMappingByRoomId(matrixRoomId: string): Promise<RoomMappingRow | null>;
  abstract getRoomMappingsForPackage(packageName: string): Promise<RoomMappingRow[]>;
  abstract updateRoomMapping(id: number, updates: Partial<RoomMappingRow>): Promise<void>;
  abstract deleteRoomMapping(id: number): Promise<void>;
  abstract getAllRoomMappings(): Promise<RoomMappingRow[]>;

  abstract createMessageMapping(mapping: Omit<MessageMappingRow, 'id'>): Promise<MessageMappingRow>;
  abstract getMessageMappingByEventId(matrixEventId: string): Promise<MessageMappingRow | null>;
  abstract getMessageMappingsByReviewId(reviewId: string): Promise<MessageMappingRow[]>;
  abstract deleteMessageMapping(id: number): Promise<void>;
  abstract getAllMessageMappings(): Promise<MessageMappingRow[]>;

  abstract storeGooglePlayReview(review: GooglePlayReviewRow): Promise<void>;
  abstract getGooglePlayReview(reviewId: string): Promise<GooglePlayReviewRow | null>;
  abstract updateGooglePlayReview(reviewId: string, updates: Partial<GooglePlayReviewRow>): Promise<void>;
  abstract getReviewsForPackage(packageName: string, limit?: number): Promise<GooglePlayReviewRow[]>;
  abstract getReviewsModifiedSince(since: Date, packageName?: string): Promise<GooglePlayReviewRow[]>;
  abstract deleteGooglePlayReview(reviewId: string): Promise<void>;

  abstract storeMatrixMessage(message: MatrixMessageRow): Promise<void>;
  abstract getMatrixMessage(eventId: string): Promise<MatrixMessageRow | null>;
  abstract getMatrixMessagesForRoom(roomId: string, limit?: number): Promise<MatrixMessageRow[]>;
  abstract deleteMatrixMessage(eventId: string): Promise<void>;

  abstract getStorageStats(): Promise<{
    userMappings: number;
    roomMappings: number;
    messageMappings: number;
    googlePlayReviews: number;
    matrixMessages: number;
    databaseSize?: number;
  }>;

  abstract vacuum(): Promise<void>;
}