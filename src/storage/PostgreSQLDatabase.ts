import { Pool, PoolClient, PoolConfig } from 'pg';
import {
  BaseDatabase,
  DatabaseTransaction,
  RoomMappingRow,
  MessageMappingRow,
  GooglePlayReviewRow,
  MatrixMessageRow,
} from './Database';

/**
 * PostgreSQL-specific transaction implementation
 */
class PostgreSQLTransaction implements DatabaseTransaction {
  constructor(private transactionClient: PoolClient) {}

  async commit(): Promise<void> {
    await this.transactionClient.query('COMMIT');
    this.transactionClient.release();
  }

  async rollback(): Promise<void> {
    await this.transactionClient.query('ROLLBACK');
    this.transactionClient.release();
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.transactionClient.query(sql, params);
    return result.rows;
  }

  async run(
    sql: string,
    params?: any[]
  ): Promise<{ changes: number; lastID?: number }> {
    const result = await this.transactionClient.query(sql, params);
    return {
      changes: result.rowCount || 0,
      lastID: result.rows?.[0]?.id,
    };
  }
}

/**
 * PostgreSQL database implementation for the Matrix Google Play Bridge
 */
export class PostgreSQLDatabase extends BaseDatabase {
  private pgPool: Pool | null = null;
  private config: PoolConfig;

  constructor(config: PoolConfig) {
    super();
    this.config = {
      ...config,
      // Optimize connection pool settings
      max: config.max || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
    };
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info(
        `Initializing PostgreSQL database connection to ${this.config.host}:${this.config.port}`
      );

      this.pgPool = new Pool(this.config);

      // Test the connection
      const client = await this.pgPool.connect();
      await client.query('SELECT NOW()');
      client.release();

      // Set up connection pool event handlers
      this.pgPool.on('error', err => {
        this.logger.error(`PostgreSQL pool error: ${err.message}`);
      });

      this.pgPool.on('connect', () => {
        this.logger.debug('New PostgreSQL client connected');
      });

      this.pgPool.on('remove', () => {
        this.logger.debug('PostgreSQL client removed from pool');
      });

      this.isInitialized = true;
      this.logger.info('PostgreSQL database initialized successfully');
    } catch (error) {
      this.logger.error(
        `Failed to initialize PostgreSQL database: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
      this.isInitialized = false;
      this.logger.info('PostgreSQL database connection pool closed');
    }
  }

  async beginTransaction(): Promise<DatabaseTransaction> {
    this.ensurePool();
    const client = await this.pgPool!.connect();
    await client.query('BEGIN');
    return new PostgreSQLTransaction(client);
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    this.ensurePool();
    const result = await this.pgPool!.query(sql, params);
    return result.rows;
  }

  async run(
    sql: string,
    params?: any[]
  ): Promise<{ changes: number; lastID?: number }> {
    this.ensurePool();
    const result = await this.pgPool!.query(sql, params);
    return {
      changes: result.rowCount || 0,
      lastID: result.rows?.[0]?.id,
    };
  }

  // Override schema version methods for PostgreSQL-specific SQL
  override async getSchemaVersion(): Promise<number> {
    try {
      const result = await this.query<{ version: number }>(
        'SELECT version FROM schema_version ORDER BY id DESC LIMIT 1'
      );
      return result.length > 0 ? result[0]!.version : 0;
    } catch (error) {
      // Table doesn't exist yet, return 0
      this.logger.debug('Schema version table does not exist yet', { error });
      return 0;
    }
  }

  override async setSchemaVersion(version: number): Promise<void> {
    await this.run(
      `INSERT INTO schema_version (id, version, applied_at) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET version = $1, applied_at = $2`,
      [version, new Date().toISOString()]
    );
  }

  // Room mapping operations
  async createRoomMapping(
    mapping: Omit<RoomMappingRow, 'id'>
  ): Promise<RoomMappingRow> {
    this.ensureInitialized();
    const result = await this.query<{ id: number }>(
      `INSERT INTO room_mappings (package_name, matrix_room_id, app_name, room_type, is_primary, config, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        mapping.packageName,
        mapping.matrixRoomId,
        mapping.appName,
        mapping.roomType,
        mapping.isPrimary,
        mapping.config,
        mapping.createdAt.toISOString(),
        mapping.updatedAt.toISOString(),
      ]
    );

    const id = result[0]?.id;
    if (id === undefined) {
      throw new Error('Failed to create room mapping: no ID returned');
    }

    return {
      id,
      ...mapping,
    };
  }

  async getRoomMappingByRoomId(
    matrixRoomId: string
  ): Promise<RoomMappingRow | null> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM room_mappings WHERE matrix_room_id = $1',
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
      'SELECT * FROM room_mappings WHERE package_name = $1 ORDER BY is_primary DESC, created_at ASC',
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
    let paramIndex = 1;

    if (updates.appName !== undefined) {
      setClause.push(`app_name = $${paramIndex++}`);
      params.push(updates.appName);
    }
    if (updates.roomType !== undefined) {
      setClause.push(`room_type = $${paramIndex++}`);
      params.push(updates.roomType);
    }
    if (updates.isPrimary !== undefined) {
      setClause.push(`is_primary = $${paramIndex++}`);
      params.push(updates.isPrimary);
    }
    if (updates.config !== undefined) {
      setClause.push(`config = $${paramIndex++}`);
      params.push(updates.config);
    }
    if (updates.updatedAt !== undefined) {
      setClause.push(`updated_at = $${paramIndex++}`);
      params.push(updates.updatedAt.toISOString());
    }

    if (setClause.length === 0) return;

    params.push(id);
    await this.run(
      `UPDATE room_mappings SET ${setClause.join(', ')} WHERE id = $${paramIndex}`,
      params
    );
  }

  async deleteRoomMapping(id: number): Promise<void> {
    this.ensureInitialized();
    await this.run('DELETE FROM room_mappings WHERE id = $1', [id]);
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
    const result = await this.query<{ id: number }>(
      `INSERT INTO message_mappings (google_play_review_id, matrix_event_id, matrix_room_id, message_type, package_name, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
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

    const id = result[0]?.id;
    if (id === undefined) {
      throw new Error('Failed to create message mapping: no ID returned');
    }

    return {
      id,
      ...mapping,
    };
  }

  async getMessageMappingByEventId(
    matrixEventId: string
  ): Promise<MessageMappingRow | null> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM message_mappings WHERE matrix_event_id = $1',
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
      'SELECT * FROM message_mappings WHERE google_play_review_id = $1 ORDER BY created_at ASC',
      [reviewId]
    );

    return results.map(row => this.mapMessageMappingRow(row));
  }

  async deleteMessageMapping(id: number): Promise<void> {
    this.ensureInitialized();
    await this.run('DELETE FROM message_mappings WHERE id = $1', [id]);
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
      `INSERT INTO google_play_reviews (
        review_id, package_name, author_name, text, star_rating, 
        language_code, device, android_os_version, app_version_code, app_version_name,
        created_at, last_modified_at, has_reply, 
        developer_reply_text, developer_reply_created_at, developer_reply_last_modified_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (review_id) DO UPDATE SET
        package_name = EXCLUDED.package_name,
        author_name = EXCLUDED.author_name,
        text = EXCLUDED.text,
        star_rating = EXCLUDED.star_rating,
        language_code = EXCLUDED.language_code,
        device = EXCLUDED.device,
        android_os_version = EXCLUDED.android_os_version,
        app_version_code = EXCLUDED.app_version_code,
        app_version_name = EXCLUDED.app_version_name,
        created_at = EXCLUDED.created_at,
        last_modified_at = EXCLUDED.last_modified_at,
        has_reply = EXCLUDED.has_reply,
        developer_reply_text = EXCLUDED.developer_reply_text,
        developer_reply_created_at = EXCLUDED.developer_reply_created_at,
        developer_reply_last_modified_at = EXCLUDED.developer_reply_last_modified_at`,
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
        review.hasReply,
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
      'SELECT * FROM google_play_reviews WHERE review_id = $1',
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
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && key !== 'reviewId') {
        const columnName = this.camelToSnakeCase(key);
        setClause.push(`${columnName} = $${paramIndex++}`);

        if (value instanceof Date) {
          params.push(value.toISOString());
        } else {
          params.push(value);
        }
      }
    });

    if (setClause.length === 0) return;

    params.push(reviewId);
    await this.run(
      `UPDATE google_play_reviews SET ${setClause.join(', ')} WHERE review_id = $${paramIndex}`,
      params
    );
  }

  async getReviewsForPackage(
    packageName: string,
    limit?: number
  ): Promise<GooglePlayReviewRow[]> {
    this.ensureInitialized();
    const sql = limit
      ? 'SELECT * FROM google_play_reviews WHERE package_name = $1 ORDER BY last_modified_at DESC LIMIT $2'
      : 'SELECT * FROM google_play_reviews WHERE package_name = $1 ORDER BY last_modified_at DESC';

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
      ? 'SELECT * FROM google_play_reviews WHERE last_modified_at >= $1 AND package_name = $2 ORDER BY last_modified_at DESC'
      : 'SELECT * FROM google_play_reviews WHERE last_modified_at >= $1 ORDER BY last_modified_at DESC';

    const params = packageName
      ? [since.toISOString(), packageName]
      : [since.toISOString()];
    const results = await this.query<any>(sql, params);

    return results.map(row => this.mapGooglePlayReviewRow(row));
  }

  async deleteGooglePlayReview(reviewId: string): Promise<void> {
    this.ensureInitialized();
    await this.run('DELETE FROM google_play_reviews WHERE review_id = $1', [
      reviewId,
    ]);
  }

  // Matrix message operations
  async storeMatrixMessage(message: MatrixMessageRow): Promise<void> {
    this.ensureInitialized();
    await this.run(
      `INSERT INTO matrix_messages (event_id, room_id, sender_id, content, timestamp, is_bridge_message) 
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id) DO UPDATE SET
       room_id = EXCLUDED.room_id,
       sender_id = EXCLUDED.sender_id,
       content = EXCLUDED.content,
       timestamp = EXCLUDED.timestamp,
       is_bridge_message = EXCLUDED.is_bridge_message`,
      [
        message.eventId,
        message.roomId,
        message.senderId,
        message.content,
        message.timestamp.toISOString(),
        message.isBridgeMessage,
      ]
    );
  }

  async getMatrixMessage(eventId: string): Promise<MatrixMessageRow | null> {
    this.ensureInitialized();
    const results = await this.query<any>(
      'SELECT * FROM matrix_messages WHERE event_id = $1',
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
      ? 'SELECT * FROM matrix_messages WHERE room_id = $1 ORDER BY timestamp DESC LIMIT $2'
      : 'SELECT * FROM matrix_messages WHERE room_id = $1 ORDER BY timestamp DESC';

    const params = limit ? [roomId, limit] : [roomId];
    const results = await this.query<any>(sql, params);

    return results.map(row => this.mapMatrixMessageRow(row));
  }

  async deleteMatrixMessage(eventId: string): Promise<void> {
    this.ensureInitialized();
    await this.run('DELETE FROM matrix_messages WHERE event_id = $1', [
      eventId,
    ]);
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
      this.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM user_mappings'
      ),
      this.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM room_mappings'
      ),
      this.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM message_mappings'
      ),
      this.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM google_play_reviews'
      ),
      this.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM matrix_messages'
      ),
      this.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM app_configs'
      ),
      this.query<{ size: string }>(
        'SELECT pg_database_size(current_database()) as size'
      ),
    ]);

    return {
      userMappings: parseInt(userMappings[0]?.count || '0'),
      roomMappings: parseInt(roomMappings[0]?.count || '0'),
      messageMappings: parseInt(messageMappings[0]?.count || '0'),
      googlePlayReviews: parseInt(googlePlayReviews[0]?.count || '0'),
      matrixMessages: parseInt(matrixMessages[0]?.count || '0'),
      appConfigs: parseInt(appConfigs[0]?.count || '0'),
      databaseSize: parseInt(dbSize[0]?.size || '0'),
    };
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
      INSERT INTO app_configs (package_name, config_json, updated_at) 
      VALUES ($1, $2, $3)
      ON CONFLICT (package_name) 
      DO UPDATE SET config_json = $2, updated_at = $3
    `,
      [packageName, configJson, new Date().toISOString()]
    );
  }

  async getAppConfig(
    packageName: string
  ): Promise<import('../models/ConfigTypes').GooglePlayApp | null> {
    this.ensureInitialized();

    const results = await this.query<any>(
      'SELECT * FROM app_configs WHERE package_name = $1',
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
    await this.run('DELETE FROM app_configs WHERE package_name = $1', [
      packageName,
    ]);
  }

  async vacuum(): Promise<void> {
    this.ensureInitialized();
    await this.run('VACUUM ANALYZE');
  }

  // Helper methods
  private ensurePool(): void {
    if (!this.pgPool) {
      throw new Error('Database connection pool not initialized');
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
