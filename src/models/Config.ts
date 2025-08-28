/**
 * Configuration interfaces for Matrix Google Play Bridge
 */

export interface HomeserverConfig {
  url: string;
  domain: string;
}

export interface AppserviceConfig {
  port: number;
  bind: string;
  token: string;
  id: string;
  botUsername: string;
}

export interface GooglePlayApp {
  packageName: string;
  matrixRoom: string;
  appName?: string;
}

export interface GooglePlayConfig {
  serviceAccountKeyPath: string;
  applications: GooglePlayApp[];
  pollIntervalMs: number;
}

export interface DatabaseConfig {
  type: 'sqlite' | 'postgresql';
  path?: string; // for SQLite
  host?: string; // for PostgreSQL
  port?: number; // for PostgreSQL
  username?: string; // for PostgreSQL
  password?: string; // for PostgreSQL
  database?: string; // for PostgreSQL
  ssl?: boolean; // for PostgreSQL
}

export interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  file?: string;
  console: boolean;
}

export interface BridgeConfig {
  homeserver: HomeserverConfig;
  appservice: AppserviceConfig;
  googleplay: GooglePlayConfig;
  database: DatabaseConfig;
  logging: LoggingConfig;
}
