import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  HTTP = 3,
  DEBUG = 4,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  metadata?: any;
  requestId?: string;
  userId?: string;
  packageName?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  filePath?: string;
  maxFileSize?: number; // MB
  maxFiles?: number;
  enableStructured: boolean;
  enableColors: boolean;
}

/**
 * Production-ready logger with structured logging, file rotation, and contextual information
 */
export class Logger {
  private static instance: Logger;
  private config: LoggerConfig;
  private currentLogFile?: string;
  private logStream?: fs.WriteStream;
  private requestId?: string;
  private component: string = 'Bridge';

  private readonly colors = {
    ERROR: '\x1b[31m',   // Red
    WARN: '\x1b[33m',    // Yellow
    INFO: '\x1b[32m',    // Green
    HTTP: '\x1b[36m',    // Cyan
    DEBUG: '\x1b[37m',   // White
    RESET: '\x1b[0m',    // Reset
  };

  private constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: LogLevel.INFO,
      enableConsole: true,
      enableFile: false,
      maxFileSize: 10, // 10MB
      maxFiles: 5,
      enableStructured: true,
      enableColors: true,
      ...config,
    };

    if (this.config.enableFile && this.config.filePath) {
      this.initializeFileLogging();
    }
  }

  static getInstance(config?: Partial<LoggerConfig>): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  /**
   * Configure logger settings
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (this.config.enableFile && this.config.filePath && !this.logStream) {
      this.initializeFileLogging();
    } else if (!this.config.enableFile && this.logStream) {
      this.logStream.end();
      this.logStream = undefined;
    }
  }

  /**
   * Set the component name for log entries
   */
  setComponent(component: string): Logger {
    this.component = component;
    return this;
  }

  /**
   * Set request ID for request tracing
   */
  setRequestId(requestId: string): Logger {
    this.requestId = requestId;
    return this;
  }

  /**
   * Create a child logger with additional context
   */
  child(context: { component?: string; requestId?: string; userId?: string; packageName?: string }): Logger {
    const childLogger = Object.create(this);
    if (context.component) childLogger.component = context.component;
    if (context.requestId) childLogger.requestId = context.requestId;
    if (context.userId) childLogger.userId = context.userId;
    if (context.packageName) childLogger.packageName = context.packageName;
    return childLogger;
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | any, metadata?: any): void {
    this.log(LogLevel.ERROR, message, { error, ...metadata });
  }

  /**
   * Log a warning message
   */
  warn(message: string, metadata?: any): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * Log an info message
   */
  info(message: string, metadata?: any): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Log an HTTP request/response
   */
  http(message: string, metadata?: any): void {
    this.log(LogLevel.HTTP, message, metadata);
  }

  /**
   * Log a debug message
   */
  debug(message: string, metadata?: any): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  /**
   * Log a performance metric
   */
  metric(name: string, value: number, unit: string = 'ms', metadata?: any): void {
    this.log(LogLevel.INFO, `METRIC: ${name}`, {
      metricName: name,
      value,
      unit,
      ...metadata,
    });
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, metadata?: any): void {
    if (level > this.config.level) {
      return;
    }

    const levelName = LogLevel[level];
    const timestamp = new Date().toISOString();
    
    const logEntry: LogEntry = {
      timestamp,
      level: levelName,
      component: this.component,
      message,
    };

    // Add contextual information
    if (this.requestId) logEntry.requestId = this.requestId;
    if ((this as any).userId) logEntry.userId = (this as any).userId;
    if ((this as any).packageName) logEntry.packageName = (this as any).packageName;
    if (metadata) logEntry.metadata = metadata;

    // Console logging
    if (this.config.enableConsole) {
      this.logToConsole(logEntry);
    }

    // File logging
    if (this.config.enableFile && this.logStream) {
      this.logToFile(logEntry);
    }
  }

  /**
   * Log to console with optional colors
   */
  private logToConsole(entry: LogEntry): void {
    if (this.config.enableStructured) {
      const output = JSON.stringify(entry);
      console.log(output);
    } else {
      const color = this.config.enableColors ? this.colors[entry.level as keyof typeof this.colors] : '';
      const reset = this.config.enableColors ? this.colors.RESET : '';
      
      let logLine = `${color}[${entry.level}] ${entry.timestamp} [${entry.component}] ${entry.message}${reset}`;
      
      if (entry.requestId) {
        logLine += ` [req:${entry.requestId}]`;
      }
      
      console.log(logLine);
      
      if (entry.metadata) {
        console.log('  Metadata:', entry.metadata);
      }
    }
  }

  /**
   * Log to file as structured JSON
   */
  private logToFile(entry: LogEntry): void {
    if (!this.logStream) return;
    
    const logLine = JSON.stringify(entry) + '\n';
    this.logStream.write(logLine);
    
    // Check file size and rotate if necessary
    this.checkFileRotation();
  }

  /**
   * Initialize file logging
   */
  private initializeFileLogging(): void {
    if (!this.config.filePath) return;
    
    try {
      const logDir = path.dirname(this.config.filePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      this.currentLogFile = this.config.filePath;
      this.logStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
      
      this.logStream.on('error', (error) => {
        console.error('Logger: Failed to write to log file:', error);
      });
      
    } catch (error) {
      console.error('Logger: Failed to initialize file logging:', error);
    }
  }

  /**
   * Check if log file needs rotation
   */
  private checkFileRotation(): void {
    if (!this.currentLogFile || !this.config.filePath) return;
    
    try {
      const stats = fs.statSync(this.currentLogFile);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > (this.config.maxFileSize || 10)) {
        this.rotateLogFile();
      }
    } catch (error) {
      // File might not exist yet, ignore
    }
  }

  /**
   * Rotate log files
   */
  private rotateLogFile(): void {
    if (!this.currentLogFile || !this.config.filePath) return;
    
    try {
      // Close current stream
      if (this.logStream) {
        this.logStream.end();
      }
      
      const baseName = this.config.filePath.replace(/\.log$/, '');
      const maxFiles = this.config.maxFiles || 5;
      
      // Rotate existing files
      for (let i = maxFiles - 1; i > 0; i--) {
        const oldFile = `${baseName}.${i}.log`;
        const newFile = `${baseName}.${i + 1}.log`;
        
        if (fs.existsSync(oldFile)) {
          if (i === maxFiles - 1) {
            fs.unlinkSync(oldFile); // Delete oldest file
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }
      
      // Move current log to .1
      if (fs.existsSync(this.config.filePath)) {
        fs.renameSync(this.config.filePath, `${baseName}.1.log`);
      }
      
      // Create new log stream
      this.initializeFileLogging();
      
    } catch (error) {
      console.error('Logger: Failed to rotate log file:', error);
    }
  }

  /**
   * Flush and close log streams
   */
  async close(): Promise<void> {
    if (this.logStream) {
      return new Promise<void>((resolve) => {
        this.logStream!.end(() => {
          resolve();
        });
      });
    }
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Check if level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean {
    return level <= this.config.level;
  }
}
