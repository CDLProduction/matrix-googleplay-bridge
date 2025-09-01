import * as sqlite3 from 'sqlite3';
import { open, Database as SQLiteDB } from 'sqlite';
import * as path from 'path';
import * as fs from 'fs';
import {
  BaseDatabase,
  DatabaseTransaction,
  RoomMappingRow,
  MessageMappingRow,
  GooglePlayReviewRow,
  MatrixMessageRow,
} from './Database';

/**
 * SQLite-specific transaction implementation
 */
class SQLiteTransaction implements DatabaseTransaction {
  constructor(
    private transactionDb: SQLiteDB<sqlite3.Database, sqlite3.Statement>
  ) {}

  async commit(): Promise<void> {
    await this.transactionDb.run('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.transactionDb.run('ROLLBACK');
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return await this.transactionDb.all<T[]>(sql, params);
  }

  async run(
    sql: string,
    params?: any[]
  ): Promise<{ changes: number; lastID?: number }> {
    const result = await this.transactionDb.run(sql, params);
    return {
      changes: result.changes || 0,
      ...(result.lastID !== undefined && { lastID: result.lastID }),
    };
  }
}

/**
 * SQLite database implementation for the Matrix Google Play Bridge
 */
export class SQLiteDatabase extends BaseDatabase {
  private sqliteDb: SQLiteDB<sqlite3.Database, sqlite3.Statement> | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    super();
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info(`Initializing SQLite database at: ${this.dbPath}`);

      // Ensure directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Open database connection
      this.sqliteDb = await open({
        filename: this.dbPath,
        driver: sqlite3.Database,
      });

      // Enable foreign keys and WAL mode for better performance
      await this.sqliteDb.run('PRAGMA foreign_keys = ON');
      await this.sqliteDb.run('PRAGMA journal_mode = WAL');
      await this.sqliteDb.run('PRAGMA synchronous = NORMAL');
      await this.sqliteDb.run('PRAGMA cache_size = 1000');
      await this.sqliteDb.run('PRAGMA temp_store = memory');

      this.isInitialized = true;
      this.logger.info('SQLite database initialized successfully');
    } catch (error) {
      this.logger.error(
        `Failed to initialize SQLite database: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.sqliteDb) {
      await this.sqliteDb.close();
      this.sqliteDb = null;
      this.isInitialized = false;
      this.logger.info('SQLite database connection closed');
    }
  }

  async beginTransaction(): Promise<DatabaseTransaction> {
    this.ensureDB();
    await this.sqliteDb!.run('BEGIN TRANSACTION');
    return new SQLiteTransaction(this.sqliteDb!);
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    this.ensureDB();
    return await this.sqliteDb!.all<T[]>(sql, params);
  }

  async run(
    sql: string,
    params?: any[]
  ): Promise<{ changes: number; lastID?: number }> {
    this.ensureDB();
    const result = await this.sqliteDb!.run(sql, params);
    const returnValue: { changes: number; lastID?: number } = {
      changes: result.changes || 0,
    };

    if (result.lastID !== undefined) {
      returnValue.lastID = result.lastID;
    }

    return returnValue;
  }

  // Room mapping operations
  async createRoomMapping(
    mapping: Omit<RoomMappingRow, 'id'>
  ): Promise<RoomMappingRow> {
    this.ensureInitialized();
    const result = await this.run(
      `INSERT INTO room_mappings (package_name, matrix_room_id, app_name, room_type, is_primary, config, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mapping.packageName,
        mapping.matrixRoomId,
        mapping.appName,
        mapping.roomType,
        mapping.isPrimary ? 1 : 0,
        mapping.config,
        mapping.createdAt.toISOString(),
        mapping.updatedAt.toISOString(),
      ]
    );

    if (result.lastID === undefined) {
      throw new Error('Failed to create room mapping: no ID returned');
    }

    return {
      id: result.lastID,
      ...mapping,
    };
  }

  async getRoomMappingByRoomId(
    matrixRoomId: string
  ): Promise<RoomMappingRow | null> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM room_mappings WHERE matrix_room_id = ?',
      [matrixRoomId]
    );

    if (results.length === 0) return null;

    return this.mapRoomMappingRow(results[0]);
  }

  async getRoomMappingsForPackage(
    packageName: string
  ): Promise<RoomMappingRow[]> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM room_mappings WHERE package_name = ? ORDER BY is_primary DESC, created_at ASC',
      [packageName]
    );

    return results.map(row => this.mapRoomMappingRow(row));
  }

  async updateRoomMapping(
    id: number,
    updates: Partial<RoomMappingRow>
  ): Promise<void> {
    this.ensureInitialized();
    const setClause: string[] = [];
    const params: any[] = [];

    if (updates.appName !== undefined) {
      setClause.push('app_name = ?');
      params.push(updates.appName);
    }
    if (updates.roomType !== undefined) {
      setClause.push('room_type = ?');
      params.push(updates.roomType);
    }
    if (updates.isPrimary !== undefined) {
      setClause.push('is_primary = ?');
      params.push(updates.isPrimary ? 1 : 0);
    }
    if (updates.config !== undefined) {
      setClause.push('config = ?');
      params.push(updates.config);
    }
    if (updates.updatedAt !== undefined) {
      setClause.push('updated_at = ?');
      params.push(updates.updatedAt.toISOString());
    }

    if (setClause.length === 0) return;

    params.push(id);
    await this.run(
      `UPDATE room_mappings SET ${setClause.join(', ')} WHERE id = ?`,
      params
    );
  }

  async deleteRoomMapping(id: number): Promise<void> {
    this.ensureInitialized();
    await this.run('DELETE FROM room_mappings WHERE id = ?', [id]);
  }

  async getAllRoomMappings(): Promise<RoomMappingRow[]> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM room_mappings ORDER BY package_name, is_primary DESC'
    );
    return results.map(row => this.mapRoomMappingRow(row));
  }

  // Message mapping operations
  async createMessageMapping(
    mapping: Omit<MessageMappingRow, 'id'>
  ): Promise<MessageMappingRow> {
    this.ensureInitialized();
    const result = await this.run(
      `INSERT INTO message_mappings (google_play_review_id, matrix_event_id, matrix_room_id, message_type, package_name, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        mapping.googlePlayReviewId,
        mapping.matrixEventId,
        mapping.matrixRoomId,
        mapping.messageType,
        mapping.packageName,
        mapping.createdAt.toISOString(),
        mapping.updatedAt.toISOString(),
      ]
    );

    if (result.lastID === undefined) {
      throw new Error('Failed to create message mapping: no ID returned');
    }

    return {
      id: result.lastID,
      ...mapping,
    };
  }

  async getMessageMappingByEventId(
    matrixEventId: string
  ): Promise<MessageMappingRow | null> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM message_mappings WHERE matrix_event_id = ?',
      [matrixEventId]
    );

    if (results.length === 0) return null;

    return this.mapMessageMappingRow(results[0]);
  }

  async getMessageMappingsByReviewId(
    reviewId: string
  ): Promise<MessageMappingRow[]> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM message_mappings WHERE google_play_review_id = ? ORDER BY created_at ASC',
      [reviewId]
    );

    return results.map(row => this.mapMessageMappingRow(row));
  }

  async deleteMessageMapping(id: number): Promise<void> {
    this.ensureInitialized();
    await this.run('DELETE FROM message_mappings WHERE id = ?', [id]);
  }

  async getAllMessageMappings(): Promise<MessageMappingRow[]> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM message_mappings ORDER BY created_at DESC'
    );
    return results.map(row => this.mapMessageMappingRow(row));
  }

  // Google Play review operations
  async storeGooglePlayReview(review: GooglePlayReviewRow): Promise<void> {
    this.ensureInitialized();
    await this.run(
      `INSERT OR REPLACE INTO google_play_reviews (
        review_id, package_name, author_name, text, star_rating, 
        language_code, device, android_os_version, app_version_code, app_version_name,
        created_at, last_modified_at, has_reply, 
        developer_reply_text, developer_reply_created_at, developer_reply_last_modified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        review.reviewId,
        review.packageName,
        review.authorName,
        review.text || null,
        review.starRating,
        review.languageCode || null,
        review.device || null,
        review.androidOsVersion || null,
        review.appVersionCode || null,
        review.appVersionName || null,
        review.createdAt.toISOString(),
        review.lastModifiedAt.toISOString(),
        review.hasReply ? 1 : 0,
        review.developerReplyText || null,
        review.developerReplyCreatedAt?.toISOString() || null,
        review.developerReplyLastModifiedAt?.toISOString() || null,
      ]
    );
  }

  async getGooglePlayReview(
    reviewId: string
  ): Promise<GooglePlayReviewRow | null> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM google_play_reviews WHERE review_id = ?',
      [reviewId]
    );

    if (results.length === 0) return null;

    return this.mapGooglePlayReviewRow(results[0]);
  }

  async updateGooglePlayReview(
    reviewId: string,
    updates: Partial<GooglePlayReviewRow>
  ): Promise<void> {
    this.ensureInitialized();
    const setClause: string[] = [];
    const params: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && key !== 'reviewId') {
        const columnName = this.camelToSnakeCase(key);
        setClause.push(`${columnName} = ?`);

        if (value instanceof Date) {
          params.push(value.toISOString());
        } else if (typeof value === 'boolean') {
          params.push(value ? 1 : 0);
        } else {
          params.push(value);
        }
      }
    });

    if (setClause.length === 0) return;

    params.push(reviewId);
    await this.run(
      `UPDATE google_play_reviews SET ${setClause.join(', ')} WHERE review_id = ?`,
      params
    );
  }

  async getReviewsForPackage(
    packageName: string,
    limit?: number
  ): Promise<GooglePlayReviewRow[]> {
    this.ensureInitialized();
    const sql = limit
      ? 'SELECT * FROM google_play_reviews WHERE package_name = ? ORDER BY last_modified_at DESC LIMIT ?'
      : 'SELECT * FROM google_play_reviews WHERE package_name = ? ORDER BY last_modified_at DESC';

    const params = limit ? [packageName, limit] : [packageName];
    const results = await this.query<any>(sql, params);

    return results.map(row => this.mapGooglePlayReviewRow(row));
  }

  async getReviewsModifiedSince(
    since: Date,
    packageName?: string
  ): Promise<GooglePlayReviewRow[]> {
    this.ensureInitialized();
    const sql = packageName
      ? 'SELECT * FROM google_play_reviews WHERE last_modified_at >= ? AND package_name = ? ORDER BY last_modified_at DESC'
      : 'SELECT * FROM google_play_reviews WHERE last_modified_at >= ? ORDER BY last_modified_at DESC';

    const params = packageName
      ? [since.toISOString(), packageName]
      : [since.toISOString()];
    const results = await this.query<any>(sql, params);

    return results.map(row => this.mapGooglePlayReviewRow(row));
  }

  async deleteGooglePlayReview(reviewId: string): Promise<void> {
    this.ensureInitialized();
    await this.run('DELETE FROM google_play_reviews WHERE review_id = ?', [
      reviewId,
    ]);
  }

  // Matrix message operations
  async storeMatrixMessage(message: MatrixMessageRow): Promise<void> {
    this.ensureInitialized();
    await this.run(
      `INSERT OR REPLACE INTO matrix_messages (event_id, room_id, sender_id, content, timestamp, is_bridge_message) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        message.eventId,
        message.roomId,
        message.senderId,
        message.content,
        message.timestamp.toISOString(),
        message.isBridgeMessage ? 1 : 0,
      ]
    );
  }

  async getMatrixMessage(eventId: string): Promise<MatrixMessageRow | null> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM matrix_messages WHERE event_id = ?',
      [eventId]
    );

    if (results.length === 0) return null;

    return this.mapMatrixMessageRow(results[0]);
  }

  async getMatrixMessagesForRoom(
    roomId: string,
    limit?: number
  ): Promise<MatrixMessageRow[]> {
    this.ensureInitialized();
    const sql = limit
      ? 'SELECT * FROM matrix_messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM matrix_messages WHERE room_id = ? ORDER BY timestamp DESC';

    const params = limit ? [roomId, limit] : [roomId];
    const results = await this.query<any>(sql, params);

    return results.map(row => this.mapMatrixMessageRow(row));
  }

  async deleteMatrixMessage(eventId: string): Promise<void> {
    this.ensureInitialized();
    await this.run('DELETE FROM matrix_messages WHERE event_id = ?', [eventId]);
  }

  // Statistics and maintenance
  async getStorageStats(): Promise<{
    userMappings: number;
    roomMappings: number;
    messageMappings: number;
    googlePlayReviews: number;
    matrixMessages: number;
    appConfigs: number;
    databaseSize?: number;
  }> {
    this.ensureInitialized();

    const [
      userMappings,
      roomMappings,
      messageMappings,
      googlePlayReviews,
      matrixMessages,
      appConfigs,
      dbSize,
    ] = await Promise.all([
      this.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM user_mappings'
      ),
      this.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM room_mappings'
      ),
      this.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM message_mappings'
      ),
      this.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM google_play_reviews'
      ),
      this.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM matrix_messages'
      ),
      this.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM app_configs'
      ),
      this.query<{ page_size: number; page_count: number }>(
        'PRAGMA page_size; PRAGMA page_count;'
      ),
    ]);

    // Calculate database size if possible
    let databaseSize: number | undefined;
    if (dbSize.length >= 2 && dbSize[0]?.page_size && dbSize[1]?.page_count) {
      databaseSize = dbSize[0].page_size * dbSize[1].page_count;
    }

    const result: {
      userMappings: number;
      roomMappings: number;
      messageMappings: number;
      googlePlayReviews: number;
      matrixMessages: number;
      appConfigs: number;
      databaseSize?: number;
    } = {
      userMappings: userMappings[0]?.count || 0,
      roomMappings: roomMappings[0]?.count || 0,
      messageMappings: messageMappings[0]?.count || 0,
      googlePlayReviews: googlePlayReviews[0]?.count || 0,
      matrixMessages: matrixMessages[0]?.count || 0,
      appConfigs: appConfigs[0]?.count || 0,
    };

    if (databaseSize !== undefined) {
      result.databaseSize = databaseSize;
    }

    return result;
  }

  // App configuration operations
  async saveAppConfig(
    packageName: string,
    config: import('../models/ConfigTypes').GooglePlayApp
  ): Promise<void> {
    this.ensureInitialized();

    const configJson = JSON.stringify(config);
    await this.run(
      `
      INSERT OR REPLACE INTO app_configs (package_name, config_json, updated_at) 
      VALUES (?, ?, ?)
    `,
      [packageName, configJson, new Date().toISOString()]
    );
  }

  async getAppConfig(
    packageName: string
  ): Promise<import('../models/ConfigTypes').GooglePlayApp | null> {
    this.ensureInitialized();

    const results = await this.query<any>(
      'SELECT * FROM app_configs WHERE package_name = ?',
      [packageName]
    );

    if (results.length === 0) return null;

    try {
      return JSON.parse(results[0].config_json);
    } catch (error) {
      this.logger.error(
        `Failed to parse app config for ${packageName}:`,
        error
      );
      return null;
    }
  }

  async getAllAppConfigs(): Promise<
    Map<string, import('../models/ConfigTypes').GooglePlayApp>
  > {
    this.ensureInitialized();

    const results = await this.query<any>('SELECT * FROM app_configs');
    const configs = new Map<
      string,
      import('../models/ConfigTypes').GooglePlayApp
    >();

    for (const row of results) {
      try {
        const config = JSON.parse(row.config_json);
        configs.set(row.package_name, config);
      } catch (error) {
        this.logger.error(
          `Failed to parse app config for ${row.package_name}:`,
          error
        );
      }
    }

    return configs;
  }

  async deleteAppConfig(packageName: string): Promise<void> {
    this.ensureInitialized();
    await this.run('DELETE FROM app_configs WHERE package_name = ?', [
      packageName,
    ]);
  }

  async vacuum(): Promise<void> {
    this.ensureInitialized();
    await this.run('VACUUM');
  }

  // Helper methods
  private ensureDB(): void {
    if (!this.sqliteDb) {
      throw new Error('Database connection not initialized');
    }
  }

  private mapRoomMappingRow(row: any): RoomMappingRow {
    return {
      id: row.id,
      packageName: row.package_name,
      matrixRoomId: row.matrix_room_id,
      appName: row.app_name,
      roomType: row.room_type as 'reviews' | 'admin' | 'general',
      isPrimary: !!row.is_primary,
      config: row.config,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapMessageMappingRow(row: any): MessageMappingRow {
    return {
      id: row.id,
      googlePlayReviewId: row.google_play_review_id,
      matrixEventId: row.matrix_event_id,
      matrixRoomId: row.matrix_room_id,
      messageType: row.message_type as 'review' | 'reply' | 'notification',
      packageName: row.package_name,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapGooglePlayReviewRow(row: any): GooglePlayReviewRow {
    const result: GooglePlayReviewRow = {
      reviewId: row.review_id,
      packageName: row.package_name,
      authorName: row.author_name,
      starRating: row.star_rating,
      createdAt: new Date(row.created_at),
      lastModifiedAt: new Date(row.last_modified_at),
      hasReply: !!row.has_reply,
    };

    if (row.text) result.text = row.text;
    if (row.language_code) result.languageCode = row.language_code;
    if (row.device) result.device = row.device;
    if (row.android_os_version)
      result.androidOsVersion = row.android_os_version;
    if (row.app_version_code !== null)
      result.appVersionCode = row.app_version_code;
    if (row.app_version_name) result.appVersionName = row.app_version_name;
    if (row.developer_reply_text)
      result.developerReplyText = row.developer_reply_text;
    if (row.developer_reply_created_at)
      result.developerReplyCreatedAt = new Date(row.developer_reply_created_at);
    if (row.developer_reply_last_modified_at)
      result.developerReplyLastModifiedAt = new Date(
        row.developer_reply_last_modified_at
      );

    return result;
  }

  private mapMatrixMessageRow(row: any): MatrixMessageRow {
    return {
      eventId: row.event_id,
      roomId: row.room_id,
      senderId: row.sender_id,
      content: row.content,
      timestamp: new Date(row.timestamp),
      isBridgeMessage: !!row.is_bridge_message,
    };
  }

  private camelToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
