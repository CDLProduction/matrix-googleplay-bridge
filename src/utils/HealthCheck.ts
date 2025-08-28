/**
 * Health check and status monitoring system for production readiness
 */

import { Logger } from './Logger';

export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  duration: number;
  timestamp: Date;
  metadata?: any;
}

export interface SystemHealth {
  status: HealthStatus;
  uptime: number;
  timestamp: Date;
  version: string;
  checks: HealthCheckResult[];
  metadata: {
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
    nodeVersion: string;
    platform: string;
  };
}

export type HealthCheckFunction = () => Promise<Omit<HealthCheckResult, 'duration' | 'timestamp'>>;

/**
 * Health monitoring system with customizable checks and alerting
 */
export class HealthMonitor {
  private logger: Logger;
  private checks: Map<string, HealthCheckFunction> = new Map();
  private lastResults: Map<string, HealthCheckResult> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private startTime: Date;
  private version: string;
  private checkTimeout: number = 5000; // 5 seconds

  constructor(version: string = '1.0.0') {
    this.logger = Logger.getInstance().setComponent('HealthMonitor');
    this.startTime = new Date();
    this.version = version;
  }

  /**
   * Register a health check
   */
  registerCheck(name: string, checkFn: HealthCheckFunction): void {
    this.checks.set(name, checkFn);
    this.logger.debug(`Registered health check: ${name}`);
  }

  /**
   * Remove a health check
   */
  unregisterCheck(name: string): void {
    this.checks.delete(name);
    this.lastResults.delete(name);
    this.logger.debug(`Unregistered health check: ${name}`);
  }

  /**
   * Run a specific health check
   */
  async runCheck(name: string): Promise<HealthCheckResult | null> {
    const checkFn = this.checks.get(name);
    if (!checkFn) {
      this.logger.warn(`Health check not found: ${name}`);
      return null;
    }

    const startTime = Date.now();
    let result: HealthCheckResult;

    try {
      // Run check with timeout
      const checkPromise = checkFn();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), this.checkTimeout);
      });

      const checkResult = await Promise.race([checkPromise, timeoutPromise]);

      result = {
        ...checkResult,
        name,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };

    } catch (error) {
      result = {
        name,
        status: HealthStatus.UNHEALTHY,
        message: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
        timestamp: new Date(),
        metadata: { error },
      };

      this.logger.error(`Health check failed: ${name}`, error);
    }

    this.lastResults.set(name, result);
    return result;
  }

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<HealthCheckResult[]> {
    const checkNames = Array.from(this.checks.keys());
    const results = await Promise.all(
      checkNames.map(name => this.runCheck(name))
    );

    return results.filter((result): result is HealthCheckResult => result !== null);
  }

  /**
   * Get overall system health status
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const checks = await this.runAllChecks();
    
    // Determine overall status
    let status = HealthStatus.HEALTHY;
    const unhealthyCount = checks.filter(c => c.status === HealthStatus.UNHEALTHY).length;
    const degradedCount = checks.filter(c => c.status === HealthStatus.DEGRADED).length;

    if (unhealthyCount > 0) {
      status = HealthStatus.UNHEALTHY;
    } else if (degradedCount > 0) {
      status = HealthStatus.DEGRADED;
    }

    // Get system metrics
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = Date.now() - this.startTime.getTime();

    return {
      status,
      uptime,
      timestamp: new Date(),
      version: this.version,
      checks,
      metadata: {
        memoryUsage,
        cpuUsage,
        nodeVersion: process.version,
        platform: process.platform,
      },
    };
  }

  /**
   * Get cached health check results (doesn't run checks)
   */
  getCachedHealth(): SystemHealth {
    const checks = Array.from(this.lastResults.values());
    
    let status = HealthStatus.HEALTHY;
    const unhealthyCount = checks.filter(c => c.status === HealthStatus.UNHEALTHY).length;
    const degradedCount = checks.filter(c => c.status === HealthStatus.DEGRADED).length;

    if (unhealthyCount > 0) {
      status = HealthStatus.UNHEALTHY;
    } else if (degradedCount > 0) {
      status = HealthStatus.DEGRADED;
    }

    const uptime = Date.now() - this.startTime.getTime();

    return {
      status,
      uptime,
      timestamp: new Date(),
      version: this.version,
      checks,
      metadata: {
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        nodeVersion: process.version,
        platform: process.platform,
      },
    };
  }

  /**
   * Start periodic health monitoring
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.logger.info(`Starting health monitoring (interval: ${intervalMs}ms)`);

    this.monitoringInterval = setInterval(async () => {
      try {
        const health = await this.getSystemHealth();
        
        // Log health status changes
        if (health.status !== HealthStatus.HEALTHY) {
          this.logger.warn(`System health: ${health.status}`, {
            unhealthyChecks: health.checks.filter(c => c.status === HealthStatus.UNHEALTHY).map(c => c.name),
            degradedChecks: health.checks.filter(c => c.status === HealthStatus.DEGRADED).map(c => c.name),
          });
        } else {
          this.logger.debug('System health: healthy');
        }

        // Log performance metrics
        this.logSystemMetrics(health.metadata);

      } catch (error) {
        this.logger.error('Error during health monitoring', error);
      }
    }, intervalMs);
  }

  /**
   * Stop periodic health monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      this.logger.info('Stopped health monitoring');
    }
  }

  /**
   * Set health check timeout
   */
  setTimeout(timeoutMs: number): void {
    this.checkTimeout = timeoutMs;
  }

  /**
   * Get health check names
   */
  getCheckNames(): string[] {
    return Array.from(this.checks.keys());
  }

  /**
   * Log system performance metrics
   */
  private logSystemMetrics(metadata: SystemHealth['metadata']): void {
    const { memoryUsage, cpuUsage } = metadata;
    
    // Memory metrics
    this.logger.metric('memory.used', Math.round(memoryUsage.heapUsed / 1024 / 1024), 'MB');
    this.logger.metric('memory.total', Math.round(memoryUsage.heapTotal / 1024 / 1024), 'MB');
    this.logger.metric('memory.external', Math.round(memoryUsage.external / 1024 / 1024), 'MB');
    
    // CPU metrics
    this.logger.metric('cpu.user', cpuUsage.user, 'microseconds');
    this.logger.metric('cpu.system', cpuUsage.system, 'microseconds');
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    this.stopMonitoring();
    this.checks.clear();
    this.lastResults.clear();
    this.logger.info('Health monitor shutdown complete');
  }
}

/**
 * Standard health check implementations
 */
export class StandardHealthChecks {
  
  /**
   * Memory usage health check
   */
  static memoryUsage(maxHeapUsedMB: number = 512): HealthCheckFunction {
    return async () => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
      
      let status = HealthStatus.HEALTHY;
      let message = `Memory usage: ${Math.round(heapUsedMB)}MB`;
      
      if (heapUsedMB > maxHeapUsedMB * 0.9) {
        status = HealthStatus.UNHEALTHY;
        message += ` (exceeds ${maxHeapUsedMB}MB limit)`;
      } else if (heapUsedMB > maxHeapUsedMB * 0.7) {
        status = HealthStatus.DEGRADED;
        message += ` (high usage)`;
      }
      
      return {
        name: 'memory-usage',
        status,
        message,
        metadata: { heapUsedMB, maxHeapUsedMB, memUsage },
      };
    };
  }

  /**
   * Database connection health check
   */
  static database(connectionTest: () => Promise<boolean>): HealthCheckFunction {
    return async () => {
      try {
        const isConnected = await connectionTest();
        
        return {
          name: 'database',
          status: isConnected ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
          message: isConnected ? 'Database connection OK' : 'Database connection failed',
        };
      } catch (error) {
        return {
          name: 'database',
          status: HealthStatus.UNHEALTHY,
          message: `Database error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          metadata: { error },
        };
      }
    };
  }

  /**
   * HTTP endpoint health check
   */
  static httpEndpoint(url: string, timeout: number = 5000): HealthCheckFunction {
    return async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(url, { 
          signal: controller.signal,
          method: 'GET',
        });
        
        clearTimeout(timeoutId);
        
        return {
          name: 'http-endpoint',
          status: response.ok ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
          message: `HTTP ${response.status} ${response.statusText}`,
          metadata: { url, status: response.status, statusText: response.statusText },
        };
      } catch (error) {
        return {
          name: 'http-endpoint',
          status: HealthStatus.UNHEALTHY,
          message: `HTTP endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          metadata: { url, error },
        };
      }
    };
  }

  /**
   * Disk space health check
   */
  static diskSpace(path: string, minFreeMB: number = 1000): HealthCheckFunction {
    return async () => {
      try {
        const { promisify } = require('util');
        const { statvfs } = require('fs');
        const statvfsAsync = promisify(statvfs);
        
        const stats = await statvfsAsync(path);
        const freeMB = (stats.f_bavail * stats.f_frsize) / 1024 / 1024;
        
        let status = HealthStatus.HEALTHY;
        let message = `Free disk space: ${Math.round(freeMB)}MB`;
        
        if (freeMB < minFreeMB) {
          status = HealthStatus.UNHEALTHY;
          message += ` (below ${minFreeMB}MB minimum)`;
        } else if (freeMB < minFreeMB * 2) {
          status = HealthStatus.DEGRADED;
          message += ` (low disk space)`;
        }
        
        return {
          name: 'disk-space',
          status,
          message,
          metadata: { path, freeMB, minFreeMB },
        };
      } catch (error) {
        // Fallback if statvfs is not available
        return {
          name: 'disk-space',
          status: HealthStatus.HEALTHY,
          message: 'Disk space check not available on this platform',
          metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    };
  }
}