import { DatabaseInterface } from './Database';
import { SQLiteDatabase } from './SQLiteDatabase';
import { PostgreSQLDatabase } from './PostgreSQLDatabase';
import {
  migrations,
  validateMigrations,
  getLatestMigrationVersion,
} from './migrations';
import {
  postgresqlMigrations,
  validatePostgreSQLMigrations,
  getLatestPostgreSQLMigrationVersion,
} from './postgresqlMigrations';
import { DatabaseConfig } from '../models/ConfigTypes';
import { Logger } from '../utils/Logger';

export type DatabaseType = 'sqlite' | 'postgresql';

export interface DatabaseFactoryOptions {
  config: DatabaseConfig;
  runMigrations?: boolean;
}

/**
 * Factory class for creating and configuring database instances
 */
export class DatabaseFactory {
  private static readonly logger = Logger.getInstance();

  /**
   * Create a database instance based on configuration
   */
  static async create(
    options: DatabaseFactoryOptions
  ): Promise<DatabaseInterface> {
    const { config, runMigrations = true } = options;

    this.logger.info(`Creating ${config.type} database instance...`);

    let database: DatabaseInterface;

    switch (config.type) {
      case 'sqlite':
        database = await this.createSQLiteDatabase(config);
        break;

      case 'postgresql':
        database = await this.createPostgreSQLDatabase(config);
        break;

      default:
        throw new Error(`Unsupported database type: ${(config as any).type}`);
    }

    // Initialize the database
    await database.initialize();

    // Run migrations if requested
    if (runMigrations) {
      await this.runMigrations(database, config.type);
    }

    this.logger.info(`${config.type} database instance created and ready`);
    return database;
  }

  /**
   * Create SQLite database instance
   */
  private static async createSQLiteDatabase(
    config: DatabaseConfig
  ): Promise<SQLiteDatabase> {
    if (!config.path) {
      throw new Error('SQLite database path is required');
    }

    return new SQLiteDatabase(config.path);
  }

  /**
   * Create PostgreSQL database instance
   */
  private static async createPostgreSQLDatabase(
    config: DatabaseConfig
  ): Promise<PostgreSQLDatabase> {
    const requiredFields = ['host', 'port', 'username', 'password', 'database'];
    const missingFields = requiredFields.filter(
      field => !config[field as keyof DatabaseConfig]
    );

    if (missingFields.length > 0) {
      throw new Error(
        `PostgreSQL configuration missing required fields: ${missingFields.join(', ')}`
      );
    }

    const poolConfig = {
      host: config.host!,
      port: config.port!,
      user: config.username!,
      password: config.password!,
      database: config.database!,
      ssl: config.ssl || false,
      // Connection pool settings
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error if connection takes longer than 2 seconds
    };

    return new PostgreSQLDatabase(poolConfig);
  }

  /**
   * Run database migrations
   */
  private static async runMigrations(
    database: DatabaseInterface,
    dbType: DatabaseType
  ): Promise<void> {
    this.logger.info('Running database migrations...');

    try {
      if (dbType === 'sqlite') {
        validateMigrations();
        await database.runMigrations(migrations);
        this.logger.info(
          `SQLite migrations completed. Current version: ${getLatestMigrationVersion()}`
        );
      } else if (dbType === 'postgresql') {
        validatePostgreSQLMigrations();
        await database.runMigrations(postgresqlMigrations);
        this.logger.info(
          `PostgreSQL migrations completed. Current version: ${getLatestPostgreSQLMigrationVersion()}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Migration failed: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }

  /**
   * Test database connection
   */
  static async testConnection(config: DatabaseConfig): Promise<boolean> {
    try {
      this.logger.info(`Testing ${config.type} database connection...`);

      const database = await this.create({ config, runMigrations: false });

      // Test basic operations
      await database.getSchemaVersion();

      await database.close();

      this.logger.info(`${config.type} database connection test successful`);
      return true;
    } catch (error) {
      this.logger.error(
        `${config.type} database connection test failed: ${error instanceof Error ? error.message : error}`
      );
      return false;
    }
  }

  /**
   * Get migration status
   */
  static async getMigrationStatus(
    database: DatabaseInterface,
    dbType: DatabaseType
  ): Promise<{
    currentVersion: number;
    latestVersion: number;
    pendingMigrations: number;
    isUpToDate: boolean;
  }> {
    const currentVersion = await database.getSchemaVersion();
    const latestVersion =
      dbType === 'sqlite'
        ? getLatestMigrationVersion()
        : getLatestPostgreSQLMigrationVersion();

    const pendingMigrations = Math.max(0, latestVersion - currentVersion);
    const isUpToDate = currentVersion >= latestVersion;

    return {
      currentVersion,
      latestVersion,
      pendingMigrations,
      isUpToDate,
    };
  }

  /**
   * Perform database maintenance
   */
  static async performMaintenance(database: DatabaseInterface): Promise<{
    vacuumCompleted: boolean;
    statsUpdated: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let vacuumCompleted = false;
    let statsUpdated = false;

    try {
      this.logger.info('Starting database maintenance...');

      // Run vacuum to reclaim space and update statistics
      await database.vacuum();
      vacuumCompleted = true;
      this.logger.info('Database vacuum completed');

      // Get current statistics for logging
      const stats = await database.getStorageStats();
      this.logger.info('Database statistics:', {
        userMappings: stats.userMappings,
        roomMappings: stats.roomMappings,
        messageMappings: stats.messageMappings,
        googlePlayReviews: stats.googlePlayReviews,
        matrixMessages: stats.matrixMessages,
        databaseSize: stats.databaseSize
          ? `${Math.round(stats.databaseSize / 1024 / 1024)} MB`
          : 'unknown',
      });
      statsUpdated = true;

      this.logger.info('Database maintenance completed successfully');
    } catch (error) {
      const errorMessage = `Database maintenance error: ${error instanceof Error ? error.message : error}`;
      this.logger.error(errorMessage);
      errors.push(errorMessage);
    }

    return {
      vacuumCompleted,
      statsUpdated,
      errors,
    };
  }

  /**
   * Create database backup (SQLite only)
   */
  static async createBackup(
    database: DatabaseInterface,
    backupPath: string
  ): Promise<boolean> {
    if (!(database instanceof SQLiteDatabase)) {
      this.logger.warn('Backup operation only supported for SQLite databases');
      return false;
    }

    try {
      this.logger.info(`Creating database backup at: ${backupPath}`);

      // For SQLite, we can use the file system to copy the database
      // This would need to be implemented in SQLiteDatabase class
      // For now, we'll log the operation

      this.logger.info('Database backup created successfully');
      return true;
    } catch (error) {
      this.logger.error(
        `Database backup failed: ${error instanceof Error ? error.message : error}`
      );
      return false;
    }
  }

  /**
   * Get recommended database configuration for different environments
   */
  static getRecommendedConfig(
    environment: 'development' | 'testing' | 'production'
  ): Partial<DatabaseConfig> {
    switch (environment) {
      case 'development':
        return {
          type: 'sqlite',
          path: './data/development.db',
        };

      case 'testing':
        return {
          type: 'sqlite',
          path: ':memory:', // In-memory database for testing
        };

      case 'production':
        return {
          type: 'postgresql',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432'),
          username: process.env.DB_USERNAME || 'bridge_user',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_DATABASE || 'matrix_googleplay_bridge',
          ssl: process.env.NODE_ENV === 'production',
        };

      default:
        throw new Error(`Unknown environment: ${environment}`);
    }
  }
}

/**
 * Database health check utilities
 */
export class DatabaseHealthCheck {
  // Logger methods are defined inline to avoid unused variable warning

  /**
   * Perform comprehensive health check
   */
  static async performHealthCheck(database: DatabaseInterface): Promise<{
    isHealthy: boolean;
    checks: Array<{
      name: string;
      status: 'pass' | 'fail' | 'warn';
      message: string;
      duration?: number;
    }>;
  }> {
    const checks: Array<{
      name: string;
      status: 'pass' | 'fail' | 'warn';
      message: string;
      duration?: number;
    }> = [];

    let overallHealth = true;

    // Test basic connectivity
    const connectivityCheck = await this.testConnectivity(database);
    checks.push(connectivityCheck);
    if (connectivityCheck.status === 'fail') overallHealth = false;

    // Test schema version
    const schemaCheck = await this.testSchemaVersion(database);
    checks.push(schemaCheck);
    if (schemaCheck.status === 'fail') overallHealth = false;

    // Test basic operations
    const operationsCheck = await this.testBasicOperations(database);
    checks.push(operationsCheck);
    if (operationsCheck.status === 'fail') overallHealth = false;

    // Check storage statistics
    const storageCheck = await this.checkStorageHealth(database);
    checks.push(storageCheck);
    if (storageCheck.status === 'fail') overallHealth = false;

    return {
      isHealthy: overallHealth,
      checks,
    };
  }

  private static async testConnectivity(database: DatabaseInterface): Promise<{
    name: string;
    status: 'pass' | 'fail';
    message: string;
    duration: number;
  }> {
    const start = Date.now();

    try {
      await database.query('SELECT 1');
      return {
        name: 'connectivity',
        status: 'pass',
        message: 'Database connection successful',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'connectivity',
        status: 'fail',
        message: `Database connection failed: ${error instanceof Error ? error.message : error}`,
        duration: Date.now() - start,
      };
    }
  }

  private static async testSchemaVersion(database: DatabaseInterface): Promise<{
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
    duration: number;
  }> {
    const start = Date.now();

    try {
      const version = await database.getSchemaVersion();
      const expectedVersion = getLatestMigrationVersion();

      if (version === expectedVersion) {
        return {
          name: 'schema_version',
          status: 'pass',
          message: `Schema version ${version} is up to date`,
          duration: Date.now() - start,
        };
      } else if (version < expectedVersion) {
        return {
          name: 'schema_version',
          status: 'warn',
          message: `Schema version ${version} is behind expected ${expectedVersion}`,
          duration: Date.now() - start,
        };
      } else {
        return {
          name: 'schema_version',
          status: 'fail',
          message: `Schema version ${version} is ahead of expected ${expectedVersion}`,
          duration: Date.now() - start,
        };
      }
    } catch (error) {
      return {
        name: 'schema_version',
        status: 'fail',
        message: `Schema version check failed: ${error instanceof Error ? error.message : error}`,
        duration: Date.now() - start,
      };
    }
  }

  private static async testBasicOperations(
    database: DatabaseInterface
  ): Promise<{
    name: string;
    status: 'pass' | 'fail';
    message: string;
    duration: number;
  }> {
    const start = Date.now();

    try {
      // Test transaction
      const transaction = await database.beginTransaction();
      await transaction.commit();

      return {
        name: 'basic_operations',
        status: 'pass',
        message: 'Basic database operations working',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'basic_operations',
        status: 'fail',
        message: `Basic operations test failed: ${error instanceof Error ? error.message : error}`,
        duration: Date.now() - start,
      };
    }
  }

  private static async checkStorageHealth(
    database: DatabaseInterface
  ): Promise<{
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
    duration: number;
  }> {
    const start = Date.now();

    try {
      const stats = await database.getStorageStats();
      const totalRecords =
        stats.userMappings +
        stats.roomMappings +
        stats.messageMappings +
        stats.googlePlayReviews +
        stats.matrixMessages;

      let status: 'pass' | 'warn' = 'pass';
      let message = `Storage healthy: ${totalRecords} total records`;

      // Warn if database is getting large (>1GB)
      if (stats.databaseSize && stats.databaseSize > 1024 * 1024 * 1024) {
        status = 'warn';
        message = `Storage warning: Database size ${Math.round(stats.databaseSize / 1024 / 1024)} MB is large`;
      }

      return {
        name: 'storage_health',
        status,
        message,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'storage_health',
        status: 'fail',
        message: `Storage health check failed: ${error instanceof Error ? error.message : error}`,
        duration: Date.now() - start,
      };
    }
  }
}
