import { Logger } from './Logger';
import { DatabaseInterface } from '../storage/Database';

export interface AuditEntry {
  id?: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  action: string;
  userId?: string;
  roomId?: string;
  packageName?: string;
  details?: Record<string, any>;
  result: 'success' | 'failure';
  errorMessage?: string;
  duration?: number;
}

export interface AuditSearchOptions {
  startTime?: Date;
  endTime?: Date;
  level?: 'info' | 'warn' | 'error';
  action?: string;
  userId?: string;
  roomId?: string;
  packageName?: string;
  result?: 'success' | 'failure';
  limit?: number;
  offset?: number;
}

/**
 * Audit logging system for tracking all bridge operations
 */
export class AuditLogger {
  private static instance: AuditLogger;
  private readonly logger: Logger;
  private database?: DatabaseInterface;
  private entries: AuditEntry[] = []; // In-memory fallback

  private constructor() {
    this.logger = Logger.getInstance().setComponent('AuditLogger');
  }

  static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  /**
   * Initialize audit logger with database
   */
  async initialize(database: DatabaseInterface): Promise<void> {
    this.database = database;
    
    try {
      // Create audit log table if it doesn't exist
      await this.createAuditTable();
      this.logger.info('Audit logger initialized with database');
    } catch (error) {
      this.logger.error('Failed to initialize audit logger with database', { error });
      this.logger.warn('Audit logging will use in-memory storage only');
    }
  }

  /**
   * Log an audit entry
   */
  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
    const auditEntry: AuditEntry = {
      ...entry,
      timestamp: new Date(),
      id: this.generateId()
    };

    // Log to structured logger
    const logLevel = entry.level;
    const logMessage = `AUDIT: ${entry.action} - ${entry.result}`;
    const logContext = {
      action: entry.action,
      userId: entry.userId,
      roomId: entry.roomId,
      packageName: entry.packageName,
      result: entry.result,
      duration: entry.duration,
      details: entry.details,
      errorMessage: entry.errorMessage
    };

    switch (logLevel) {
      case 'error':
        this.logger.error(logMessage, logContext);
        break;
      case 'warn':
        this.logger.warn(logMessage, logContext);
        break;
      default:
        this.logger.info(logMessage, logContext);
        break;
    }

    // Store in database if available
    if (this.database) {
      try {
        await this.storeEntry(auditEntry);
      } catch (error) {
        this.logger.error('Failed to store audit entry in database', { error, entry: auditEntry });
        // Fallback to in-memory storage
        this.storeInMemory(auditEntry);
      }
    } else {
      // Fallback to in-memory storage
      this.storeInMemory(auditEntry);
    }
  }

  /**
   * Search audit entries
   */
  async search(options: AuditSearchOptions = {}): Promise<AuditEntry[]> {
    if (this.database) {
      try {
        return await this.searchDatabase(options);
      } catch (error) {
        this.logger.error('Failed to search audit entries in database', { error });
        // Fallback to in-memory search
        return this.searchInMemory(options);
      }
    } else {
      return this.searchInMemory(options);
    }
  }

  /**
   * Get recent audit entries (convenience method)
   */
  async getRecent(limit: number = 50): Promise<AuditEntry[]> {
    return this.search({ 
      limit,
      endTime: new Date(),
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
    });
  }

  // Convenience methods for common audit actions
  async logConfigReload(userId: string, success: boolean, details?: any, error?: string): Promise<void> {
    await this.log({
      level: success ? 'info' : 'error',
      action: 'config.reload',
      userId,
      result: success ? 'success' : 'failure',
      details,
      ...(error && { errorMessage: error })
    });
  }

  async logMaintenanceMode(userId: string, enabled: boolean, reason?: string): Promise<void> {
    await this.log({
      level: 'warn',
      action: enabled ? 'maintenance.enable' : 'maintenance.disable',
      userId,
      result: 'success',
      details: { enabled, reason }
    });
  }

  async logAppOperation(
    action: string,
    userId: string,
    packageName: string,
    success: boolean,
    details?: any,
    error?: string
  ): Promise<void> {
    await this.log({
      level: success ? 'info' : 'error',
      action: `app.${action}`,
      userId,
      packageName,
      result: success ? 'success' : 'failure',
      details,
      ...(error && { errorMessage: error })
    });
  }

  async logBridgeCommand(
    command: string,
    userId: string,
    roomId: string,
    success: boolean,
    duration?: number,
    details?: any,
    error?: string
  ): Promise<void> {
    await this.log({
      level: success ? 'info' : 'error',
      action: `command.${command}`,
      userId,
      roomId,
      result: success ? 'success' : 'failure',
      ...(duration !== undefined && { duration }),
      details,
      ...(error && { errorMessage: error })
    });
  }

  async logReviewOperation(
    action: string,
    packageName: string,
    success: boolean,
    reviewId?: string,
    details?: any,
    error?: string
  ): Promise<void> {
    await this.log({
      level: success ? 'info' : 'error',
      action: `review.${action}`,
      packageName,
      result: success ? 'success' : 'failure',
      details: { ...details, reviewId },
      ...(error && { errorMessage: error })
    });
  }

  async logMatrixOperation(
    action: string,
    roomId: string,
    success: boolean,
    userId?: string,
    details?: any,
    error?: string
  ): Promise<void> {
    await this.log({
      level: success ? 'info' : 'error',
      action: `matrix.${action}`,
      ...(userId && { userId }),
      roomId,
      result: success ? 'success' : 'failure',
      details,
      ...(error && { errorMessage: error })
    });
  }

  // Private methods
  private async createAuditTable(): Promise<void> {
    if (!this.database) return;

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp DATETIME NOT NULL,
        level TEXT NOT NULL,
        action TEXT NOT NULL,
        user_id TEXT,
        room_id TEXT,
        package_name TEXT,
        details TEXT,
        result TEXT NOT NULL,
        error_message TEXT,
        duration INTEGER
      );
    `;

    await this.database.query(createTableQuery);

    // Create indexes for common queries
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)',
      'CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_audit_package_name ON audit_log(package_name)',
      'CREATE INDEX IF NOT EXISTS idx_audit_result ON audit_log(result)'
    ];

    for (const indexQuery of indexes) {
      await this.database.query(indexQuery);
    }
  }

  private async storeEntry(entry: AuditEntry): Promise<void> {
    if (!this.database) return;

    const query = `
      INSERT INTO audit_log (id, timestamp, level, action, user_id, room_id, package_name, details, result, error_message, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      entry.id,
      entry.timestamp.toISOString(),
      entry.level,
      entry.action,
      entry.userId,
      entry.roomId,
      entry.packageName,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.result,
      entry.errorMessage,
      entry.duration
    ];

    await this.database.query(query, params);
  }

  private storeInMemory(entry: AuditEntry): void {
    this.entries.push(entry);
    
    // Keep only recent entries in memory (limit to 1000)
    if (this.entries.length > 1000) {
      this.entries = this.entries.slice(-1000);
    }
  }

  private async searchDatabase(options: AuditSearchOptions): Promise<AuditEntry[]> {
    if (!this.database) return [];

    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params: any[] = [];

    if (options.startTime) {
      query += ' AND timestamp >= ?';
      params.push(options.startTime.toISOString());
    }

    if (options.endTime) {
      query += ' AND timestamp <= ?';
      params.push(options.endTime.toISOString());
    }

    if (options.level) {
      query += ' AND level = ?';
      params.push(options.level);
    }

    if (options.action) {
      query += ' AND action LIKE ?';
      params.push(`%${options.action}%`);
    }

    if (options.userId) {
      query += ' AND user_id = ?';
      params.push(options.userId);
    }

    if (options.roomId) {
      query += ' AND room_id = ?';
      params.push(options.roomId);
    }

    if (options.packageName) {
      query += ' AND package_name = ?';
      params.push(options.packageName);
    }

    if (options.result) {
      query += ' AND result = ?';
      params.push(options.result);
    }

    query += ' ORDER BY timestamp DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = await this.database.query(query, params);
    return rows.map(this.mapRowToEntry);
  }

  private searchInMemory(options: AuditSearchOptions): AuditEntry[] {
    let filtered = [...this.entries];

    if (options.startTime) {
      filtered = filtered.filter(e => e.timestamp >= options.startTime!);
    }

    if (options.endTime) {
      filtered = filtered.filter(e => e.timestamp <= options.endTime!);
    }

    if (options.level) {
      filtered = filtered.filter(e => e.level === options.level);
    }

    if (options.action) {
      filtered = filtered.filter(e => e.action.includes(options.action!));
    }

    if (options.userId) {
      filtered = filtered.filter(e => e.userId === options.userId);
    }

    if (options.roomId) {
      filtered = filtered.filter(e => e.roomId === options.roomId);
    }

    if (options.packageName) {
      filtered = filtered.filter(e => e.packageName === options.packageName);
    }

    if (options.result) {
      filtered = filtered.filter(e => e.result === options.result);
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options.offset) {
      filtered = filtered.slice(options.offset);
    }

    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  private mapRowToEntry(row: any): AuditEntry {
    return {
      id: row.id,
      timestamp: new Date(row.timestamp),
      level: row.level,
      action: row.action,
      userId: row.user_id,
      roomId: row.room_id,
      packageName: row.package_name,
      details: row.details ? JSON.parse(row.details) : undefined,
      result: row.result,
      errorMessage: row.error_message,
      duration: row.duration
    };
  }

  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}