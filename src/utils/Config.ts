import * as fs from 'fs';
import * as yaml from 'js-yaml';
import {
  BridgeConfig,
  DatabaseConfig,
  GooglePlayConfig,
  AppserviceConfig,
  HomeserverConfig,
  LoggingConfig,
} from '../models/Config';
import { Validator } from './Validator';

/**
 * Configuration management class for Matrix Google Play Bridge
 */
export class Config {
  private static instance: Config;
  private config: BridgeConfig;

  private constructor(config: BridgeConfig) {
    this.config = config;
  }

  /**
   * Load configuration from file and environment variables
   */
  static async load(configPath?: string): Promise<Config> {
    const finalConfigPath =
      configPath || process.env.CONFIG_PATH || './config/config.yaml';

    if (!fs.existsSync(finalConfigPath)) {
      throw new Error(`Configuration file not found: ${finalConfigPath}`);
    }

    try {
      const configContent = fs.readFileSync(finalConfigPath, 'utf8');
      const rawConfig = yaml.load(configContent) as any;

      // Apply environment variable overrides
      const config = Config.applyEnvironmentOverrides(rawConfig);

      // Validate configuration
      Config.validateConfig(config);

      Config.instance = new Config(config);
      return Config.instance;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load configuration: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get the singleton configuration instance
   */
  static getInstance(): Config {
    if (!Config.instance) {
      throw new Error('Configuration not loaded. Call Config.load() first.');
    }
    return Config.instance;
  }

  /**
   * Apply environment variable overrides to configuration
   */
  private static applyEnvironmentOverrides(config: any): BridgeConfig {
    // Homeserver overrides
    if (process.env.HOMESERVER_URL) {
      config.homeserver = config.homeserver || {};
      config.homeserver.url = process.env.HOMESERVER_URL;
    }
    if (process.env.HOMESERVER_DOMAIN) {
      config.homeserver = config.homeserver || {};
      config.homeserver.domain = process.env.HOMESERVER_DOMAIN;
    }

    // Appservice overrides
    if (process.env.AS_PORT) {
      config.appservice = config.appservice || {};
      config.appservice.port = parseInt(process.env.AS_PORT, 10);
    }
    if (process.env.AS_BIND) {
      config.appservice = config.appservice || {};
      config.appservice.bind = process.env.AS_BIND;
    }
    if (process.env.AS_TOKEN) {
      config.appservice = config.appservice || {};
      config.appservice.token = process.env.AS_TOKEN;
    }
    if (process.env.AS_ID) {
      config.appservice = config.appservice || {};
      config.appservice.id = process.env.AS_ID;
    }
    if (process.env.BOT_USERNAME) {
      config.appservice = config.appservice || {};
      config.appservice.botUsername = process.env.BOT_USERNAME;
    }

    // Google Play overrides
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
      config.googleplay = config.googleplay || { auth: {}, applications: [], pollIntervalMs: 300000 };
      config.googleplay.auth = config.googleplay.auth || {};
      config.googleplay.auth.keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    }
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_CONTENT) {
      config.googleplay = config.googleplay || { auth: {}, applications: [], pollIntervalMs: 300000 };
      config.googleplay.auth = config.googleplay.auth || {};
      config.googleplay.auth.keyFileContent = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_CONTENT;
    }
    if (process.env.GOOGLE_CLIENT_EMAIL) {
      config.googleplay = config.googleplay || { auth: {}, applications: [], pollIntervalMs: 300000 };
      config.googleplay.auth = config.googleplay.auth || {};
      config.googleplay.auth.clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    }
    if (process.env.GOOGLE_PRIVATE_KEY) {
      config.googleplay = config.googleplay || { auth: {}, applications: [], pollIntervalMs: 300000 };
      config.googleplay.auth = config.googleplay.auth || {};
      config.googleplay.auth.privateKey = process.env.GOOGLE_PRIVATE_KEY;
    }
    if (process.env.GOOGLE_PROJECT_ID) {
      config.googleplay = config.googleplay || { auth: {}, applications: [], pollIntervalMs: 300000 };
      config.googleplay.auth = config.googleplay.auth || {};
      config.googleplay.auth.projectId = process.env.GOOGLE_PROJECT_ID;
    }
    if (process.env.GOOGLE_POLL_INTERVAL) {
      config.googleplay = config.googleplay || { auth: {}, applications: [], pollIntervalMs: 300000 };
      config.googleplay.pollIntervalMs = parseInt(
        process.env.GOOGLE_POLL_INTERVAL,
        10
      );
    }

    // Database overrides
    if (process.env.DB_TYPE) {
      config.database = config.database || {};
      config.database.type = process.env.DB_TYPE as 'sqlite' | 'postgresql';
    }
    if (process.env.DB_PATH) {
      config.database = config.database || {};
      config.database.path = process.env.DB_PATH;
    }
    if (process.env.DB_HOST) {
      config.database = config.database || {};
      config.database.host = process.env.DB_HOST;
    }
    if (process.env.DB_PORT) {
      config.database = config.database || {};
      config.database.port = parseInt(process.env.DB_PORT, 10);
    }
    if (process.env.DB_USERNAME) {
      config.database = config.database || {};
      config.database.username = process.env.DB_USERNAME;
    }
    if (process.env.DB_PASSWORD) {
      config.database = config.database || {};
      config.database.password = process.env.DB_PASSWORD;
    }
    if (process.env.DB_DATABASE) {
      config.database = config.database || {};
      config.database.database = process.env.DB_DATABASE;
    }

    // Logging overrides
    if (process.env.LOG_LEVEL) {
      config.logging = config.logging || {};
      config.logging.level = process.env.LOG_LEVEL as
        | 'error'
        | 'warn'
        | 'info'
        | 'debug';
    }
    if (process.env.LOG_FILE) {
      config.logging = config.logging || {};
      config.logging.file = process.env.LOG_FILE;
    }
    if (process.env.LOG_CONSOLE !== undefined) {
      config.logging = config.logging || {};
      config.logging.console = process.env.LOG_CONSOLE === 'true';
    }

    return config;
  }

  /**
   * Validate the loaded configuration
   */
  private static validateConfig(config: any): void {
    const validator = new Validator();

    // Validate required sections
    if (!config.homeserver) {
      throw new Error('Missing required configuration section: homeserver');
    }
    if (!config.appservice) {
      throw new Error('Missing required configuration section: appservice');
    }
    if (!config.googleplay) {
      throw new Error('Missing required configuration section: googleplay');
    }
    if (!config.database) {
      throw new Error('Missing required configuration section: database');
    }
    if (!config.logging) {
      throw new Error('Missing required configuration section: logging');
    }

    // Validate homeserver
    validator.validateRequired(config.homeserver.url, 'homeserver.url');
    validator.validateRequired(config.homeserver.domain, 'homeserver.domain');
    validator.validateUrl(config.homeserver.url, 'homeserver.url');

    // Validate appservice
    validator.validateRequired(config.appservice.port, 'appservice.port');
    validator.validateRequired(config.appservice.bind, 'appservice.bind');
    validator.validateRequired(config.appservice.token, 'appservice.token');
    validator.validateRequired(config.appservice.id, 'appservice.id');
    validator.validateRequired(
      config.appservice.botUsername,
      'appservice.botUsername'
    );
    validator.validatePort(config.appservice.port, 'appservice.port');

    // Validate Google Play
    validator.validateRequired(config.googleplay.auth, 'googleplay.auth');
    validator.validateRequired(
      config.googleplay.applications,
      'googleplay.applications'
    );
    validator.validateArray(
      config.googleplay.applications,
      'googleplay.applications'
    );

    // Validate Google Play authentication - at least one method must be provided
    const auth = config.googleplay.auth;
    const hasKeyFile = auth.keyFile && fs.existsSync(auth.keyFile);
    const hasKeyContent = auth.keyFileContent;
    const hasIndividualCreds = auth.clientEmail && auth.privateKey;

    if (!hasKeyFile && !hasKeyContent && !hasIndividualCreds) {
      throw new Error(
        'Google Play authentication configuration incomplete. Provide one of: ' +
        '1) keyFile (path to service account JSON), ' +
        '2) keyFileContent (service account JSON as string), or ' +
        '3) clientEmail + privateKey (individual credentials)'
      );
    }

    if (auth.keyFile && !fs.existsSync(auth.keyFile)) {
      throw new Error(
        `Google Play service account key file not found: ${auth.keyFile}`
      );
    }

    if (hasIndividualCreds && (!auth.clientEmail || !auth.privateKey)) {
      throw new Error(
        'When using individual credentials, both clientEmail and privateKey are required'
      );
    }

    // Validate Google Play applications
    for (let i = 0; i < config.googleplay.applications.length; i++) {
      const app = config.googleplay.applications[i];
      validator.validateRequired(
        app.packageName,
        `googleplay.applications[${i}].packageName`
      );
      validator.validateRequired(
        app.matrixRoom,
        `googleplay.applications[${i}].matrixRoom`
      );
    }

    // Validate database
    validator.validateRequired(config.database.type, 'database.type');
    if (!['sqlite', 'postgresql'].includes(config.database.type)) {
      throw new Error('database.type must be either "sqlite" or "postgresql"');
    }

    if (config.database.type === 'sqlite') {
      validator.validateRequired(config.database.path, 'database.path');
    } else if (config.database.type === 'postgresql') {
      validator.validateRequired(config.database.host, 'database.host');
      validator.validateRequired(config.database.port, 'database.port');
      validator.validateRequired(config.database.username, 'database.username');
      validator.validateRequired(config.database.password, 'database.password');
      validator.validateRequired(config.database.database, 'database.database');
      validator.validatePort(config.database.port, 'database.port');
    }

    // Validate logging
    validator.validateRequired(config.logging.level, 'logging.level');
    if (!['error', 'warn', 'info', 'debug'].includes(config.logging.level)) {
      throw new Error('logging.level must be one of: error, warn, info, debug');
    }
  }

  // Getter methods
  get homeserver(): HomeserverConfig {
    return this.config.homeserver;
  }

  get appservice(): AppserviceConfig {
    return this.config.appservice;
  }

  get googleplay(): GooglePlayConfig {
    return this.config.googleplay;
  }

  get database(): DatabaseConfig {
    return this.config.database;
  }

  get logging(): LoggingConfig | undefined {
    return this.config.logging;
  }
  
  get monitoring(): MonitoringConfig | undefined {
    return this.config.monitoring;
  }
  
  get version(): string | undefined {
    return this.config.version;
  }

  get all(): BridgeConfig {
    return this.config;
  }
}
