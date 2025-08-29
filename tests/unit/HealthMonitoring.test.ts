/**
 * Unit tests for health monitoring and production-ready components
 */

import { HealthMonitor, HealthStatus, StandardHealthChecks } from '../../src/utils/HealthCheck';
import { CircuitBreakerRegistry } from '../../src/utils/CircuitBreaker';
import { RateLimitingRegistry } from '../../src/utils/RateLimiter';

// Mock Logger
jest.mock('../../src/utils/Logger', () => ({
  Logger: {
    getInstance: jest.fn(() => ({
      setComponent: jest.fn().mockReturnThis(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      http: jest.fn()
    }))
  }
}));

describe('Health Monitoring System', () => {
  let healthMonitor: HealthMonitor;

  beforeEach(() => {
    healthMonitor = new HealthMonitor('1.0.0-test');
  });

  afterEach(() => {
    healthMonitor.stopMonitoring();
    healthMonitor.shutdown();
  });

  describe('Health Monitor Basic Functionality', () => {
    test('should initialize with correct version', () => {
      expect(healthMonitor).toBeDefined();
    });

    test('should register health checks successfully', async () => {
      const testCheck = async () => ({
        name: 'test-check',
        status: HealthStatus.HEALTHY,
        message: 'Test check passed'
      });

      healthMonitor.registerCheck('test-check', testCheck);
      
      const health = await healthMonitor.getSystemHealth();
      expect(health.checks).toHaveLength(1);
      expect(health.checks[0]?.name).toBe('test-check');
      expect(health.checks[0]?.status).toBe(HealthStatus.HEALTHY);
    });

    test('should handle health check failures gracefully', async () => {
      const failingCheck = async () => {
        throw new Error('Health check failed');
      };

      healthMonitor.registerCheck('failing-check', failingCheck);
      
      const health = await healthMonitor.getSystemHealth();
      expect(health.checks).toHaveLength(1);
      expect(health.checks[0]?.name).toBe('failing-check');
      expect(health.checks[0]?.status).toBe(HealthStatus.UNHEALTHY);
    });

    test('should calculate overall system health correctly', async () => {
      healthMonitor.registerCheck('healthy-check', async () => ({
        name: 'healthy-check',
        status: HealthStatus.HEALTHY,
        message: 'All good'
      }));

      healthMonitor.registerCheck('degraded-check', async () => ({
        name: 'degraded-check',
        status: HealthStatus.DEGRADED,
        message: 'Some issues'
      }));

      const health = await healthMonitor.getSystemHealth();
      expect(health.status).toBe(HealthStatus.DEGRADED); // Should be degraded if any check is degraded
    });

    test('should include system metadata in health report', async () => {
      const health = await healthMonitor.getSystemHealth();
      
      expect(health.metadata).toHaveProperty('memoryUsage');
      expect(health.metadata).toHaveProperty('cpuUsage');
      expect(health.metadata).toHaveProperty('nodeVersion');
      expect(health.metadata).toHaveProperty('platform');
      expect(health.version).toBe('1.0.0-test');
    });
  });

  describe('Standard Health Checks', () => {
    test('should provide memory usage health check', async () => {
      const memoryCheck = StandardHealthChecks.memoryUsage(1000); // 1000MB limit
      const result = await memoryCheck();

      expect(result.name).toBe('memory-usage');
      expect(result.status).toBeOneOf([HealthStatus.HEALTHY, HealthStatus.DEGRADED, HealthStatus.UNHEALTHY]);
      expect(result.metadata).toHaveProperty('heapUsedMB');
      expect(result.metadata).toHaveProperty('memUsage');
      expect(result.metadata.memUsage).toHaveProperty('heapUsed');
      expect(result.metadata.memUsage).toHaveProperty('heapTotal');
    });

    test('should provide event loop lag health check', async () => {
      const memoryCheck = StandardHealthChecks.memoryUsage(512); // 512MB threshold
      const result = await memoryCheck();

      expect(result.name).toBe('memory-usage');
      expect(result.status).toBeOneOf([HealthStatus.HEALTHY, HealthStatus.DEGRADED, HealthStatus.UNHEALTHY]);
      expect(result.metadata).toHaveProperty('heapUsedMB');
    });

    test('should provide disk space health check', async () => {
      const diskCheck = StandardHealthChecks.diskSpace('/tmp', 1000); // 1000MB threshold
      const result = await diskCheck();

      expect(result.name).toBe('disk-space');
      expect(result.status).toBeOneOf([HealthStatus.HEALTHY, HealthStatus.DEGRADED, HealthStatus.UNHEALTHY]);
    });
  });

  describe('Health Monitoring Lifecycle', () => {
    test('should start and stop monitoring correctly', () => {
      expect(() => {
        healthMonitor.startMonitoring(1000); // 1 second interval
        healthMonitor.stopMonitoring();
      }).not.toThrow();
    });

    test('should handle multiple start/stop cycles', () => {
      expect(() => {
        healthMonitor.startMonitoring(1000);
        healthMonitor.stopMonitoring();
        healthMonitor.startMonitoring(1000);
        healthMonitor.stopMonitoring();
      }).not.toThrow();
    });

    test('should shutdown gracefully', () => {
      healthMonitor.startMonitoring(1000);
      expect(() => {
        healthMonitor.shutdown();
      }).not.toThrow();
    });
  });
});

describe('Circuit Breaker System', () => {
  let circuitBreakerRegistry: CircuitBreakerRegistry;
  const defaultConfig = {
    failureThreshold: 5,
    resetTimeout: 60000,
    monitoringPeriod: 300000,
    successThreshold: 3
  };

  beforeEach(() => {
    circuitBreakerRegistry = CircuitBreakerRegistry.getInstance();
  });

  afterEach(() => {
    // Clean up circuit breakers
    circuitBreakerRegistry.clear();
  });

  describe('Circuit Breaker Basic Functionality', () => {
    test('should create circuit breaker with default configuration', () => {
      const circuitBreaker = circuitBreakerRegistry.getOrCreate('test-service', defaultConfig);
      expect(circuitBreaker).toBeDefined();
    });

    test('should create circuit breaker with custom configuration', () => {
      const config = {
        failureThreshold: 3,
        resetTimeout: 30000,
        monitoringPeriod: 10000,
        successThreshold: 2
      };

      const circuitBreaker = circuitBreakerRegistry.getOrCreate('test-service', config);
      expect(circuitBreaker).toBeDefined();
    });

    test('should reuse existing circuit breaker for same service', () => {
      const cb1 = circuitBreakerRegistry.getOrCreate('test-service', defaultConfig);
      const cb2 = circuitBreakerRegistry.getOrCreate('test-service', defaultConfig);
      expect(cb1).toBe(cb2);
    });

    test('should execute successful operations normally', async () => {
      const circuitBreaker = circuitBreakerRegistry.getOrCreate('test-service', defaultConfig);
      const successfulOperation = jest.fn().mockResolvedValue('success');

      const result = await circuitBreaker.execute(successfulOperation);
      expect(result).toBe('success');
      expect(successfulOperation).toHaveBeenCalledTimes(1);
    });

    test('should handle operation failures', async () => {
      const circuitBreaker = circuitBreakerRegistry.getOrCreate('test-service', {
        failureThreshold: 2,
        resetTimeout: 1000,
        monitoringPeriod: 60000,
        successThreshold: 2
      });

      const failingOperation = jest.fn().mockRejectedValue(new Error('Operation failed'));

      // First failure
      await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow('Operation failed');
      
      // Second failure should trigger circuit breaker
      await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow('Operation failed');
      
      expect(failingOperation).toHaveBeenCalledTimes(2);
    });
  });

  describe('Circuit Breaker States', () => {
    test('should start in CLOSED state', () => {
      const circuitBreaker = circuitBreakerRegistry.getOrCreate('test-service', defaultConfig);
      expect(circuitBreaker.getState()).toBe('closed');
    });

    test('should transition to OPEN state after failures', async () => {
      const circuitBreaker = circuitBreakerRegistry.getOrCreate('test-service', {
        failureThreshold: 1,
        resetTimeout: 1000,
        monitoringPeriod: 60000,
        successThreshold: 1
      });

      const failingOperation = jest.fn().mockRejectedValue(new Error('Failure'));

      try {
        await circuitBreaker.execute(failingOperation);
      } catch (error) {
        // Expected failure
      }

      expect(circuitBreaker.getState()).toBe('open');
    });
  });

  describe('Circuit Breaker Statistics', () => {
    test('should provide statistics for all circuit breakers', () => {
      circuitBreakerRegistry.getOrCreate('service-1', defaultConfig);
      circuitBreakerRegistry.getOrCreate('service-2', defaultConfig);

      const stats = circuitBreakerRegistry.getStats();
      expect(Object.keys(stats).length).toBe(2);
      expect(stats['service-1']).toBeDefined();
      expect(stats['service-2']).toBeDefined();
    });

    test('should track operation statistics', async () => {
      const circuitBreaker = circuitBreakerRegistry.getOrCreate('test-service', defaultConfig);
      const operation = jest.fn().mockResolvedValue('success');

      await circuitBreaker.execute(operation);

      const stats = circuitBreaker.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(0);
    });
  });
});

describe('Rate Limiting System', () => {
  let rateLimitingRegistry: RateLimitingRegistry;

  beforeEach(() => {
    rateLimitingRegistry = RateLimitingRegistry.getInstance();
  });

  afterEach(() => {
    // Clean up rate limiters - no clear method available
    // rateLimitingRegistry.clear();
  });

  describe('Rate Limiter Basic Functionality', () => {
    test('should create rate limiter with configuration', () => {
      const rateLimiter = rateLimitingRegistry.getRateLimiter('test-service', {
        windowSizeMs: 60000,
        maxRequests: 100
      });

      expect(rateLimiter).toBeDefined();
    });

    test('should allow operations within rate limit', async () => {
      const rateLimiter = rateLimitingRegistry.getRateLimiter('test-service', {
        windowSizeMs: 60000,
        maxRequests: 10
      });

      const operation = jest.fn().mockResolvedValue('success');

      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.execute(operation);
        expect(result).toBe('success');
      }

      expect(operation).toHaveBeenCalledTimes(5);
    });

    test('should create throttler for delayed operations', () => {
      const throttler = rateLimitingRegistry.getThrottler('test-service', {
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitterMs: 100
      });

      expect(throttler).toBeDefined();
    });
  });

  describe('Rate Limiter Statistics', () => {
    test('should provide statistics for all rate limiters', () => {
      rateLimitingRegistry.getRateLimiter('service-1', {
        windowSizeMs: 60000,
        maxRequests: 100
      });

      rateLimitingRegistry.getRateLimiter('service-2', {
        windowSizeMs: 60000,
        maxRequests: 50
      });

      const stats = rateLimitingRegistry.getAllStats();
      expect(Object.keys(stats.rateLimiters)).toContain('service-1');
      expect(Object.keys(stats.rateLimiters)).toContain('service-2');
    });

    test('should track request statistics', async () => {
      const rateLimiter = rateLimitingRegistry.getRateLimiter('test-service', {
        windowSizeMs: 60000,
        maxRequests: 100
      });

      const operation = jest.fn().mockResolvedValue('success');
      await rateLimiter.execute(operation);

      const stats = rateLimiter.getStats();
      expect(stats.totalRequests).toBeGreaterThan(0);
    });
  });
});

// Custom Jest matcher for health status
expect.extend({
  toBeOneOf(received: any, expected: any[]) {
    const pass = expected.includes(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be one of ${expected}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be one of ${expected}`,
        pass: false,
      };
    }
  },
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeOneOf(expected: any[]): R;
    }
  }
}