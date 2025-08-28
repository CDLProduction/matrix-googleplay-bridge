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
  pollIntervalMs?: number;
  maxReviewsPerPoll?: number;
  lookbackDays?: number;
}

export interface GooglePlayAuthConfig {
  // Option 1: Service Account Key File
  keyFile?: string;
  
  // Option 2: Service Account Key Content (JSON string)
  keyFileContent?: string;
  
  // Option 3: Individual credentials
  clientEmail?: string;
  privateKey?: string;
  projectId?: string;
  
  // OAuth2 scopes (optional)
  scopes?: string[];
}

export interface GooglePlayConfig {
  auth: GooglePlayAuthConfig;
  applications: GooglePlayApp[];
  pollIntervalMs: number;
  maxReviewsPerPoll?: number;
  rateLimitDelayMs?: number;
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
