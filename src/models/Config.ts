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
  level?: 'error' | 'warn' | 'info' | 'http' | 'debug';
  enableFile?: boolean;
  filePath?: string;
  enableStructured?: boolean;
  maxFileSize?: number; // MB
  maxFiles?: number;
}

export interface MonitoringConfig {
  enabled?: boolean;
  port?: number;
  host?: string;
  enableMetrics?: boolean;
  enableHealthCheck?: boolean;
  requestLogging?: boolean;
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  resetTimeout?: number;
  monitoringPeriod?: number;
  successThreshold?: number;
}

export interface RateLimitingConfig {
  googlePlayApi?: {
    windowSizeMs?: number;
    maxRequests?: number;
  };
  matrixApi?: {
    windowSizeMs?: number;
    maxRequests?: number;
  };
  replyProcessing?: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  };
}

export interface BridgeConfig {
  homeserver: HomeserverConfig;
  appservice: AppserviceConfig;
  googleplay: GooglePlayConfig;
  database: DatabaseConfig;
  logging?: LoggingConfig;
  monitoring?: MonitoringConfig;
  circuitBreakers?: {
    googlePlayApi?: CircuitBreakerConfig;
    matrixApi?: CircuitBreakerConfig;
  };
  rateLimiting?: RateLimitingConfig;
  version?: string;
}
