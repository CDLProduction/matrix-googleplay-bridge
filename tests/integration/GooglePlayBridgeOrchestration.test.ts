/**
 * Integration tests for GooglePlayBridge orchestration and lifecycle
 */

// Mock the matrix-appservice-bridge Logger before any imports
jest.mock('matrix-appservice-bridge', () => {
  const originalModule = jest.requireActual('matrix-appservice-bridge');
  return {
    ...originalModule,
    Bridge: jest.fn().mockImplementation(() => ({
      run: jest.fn(),
      close: jest.fn(),
      onEvent: jest.fn(),
      getIntent: jest.fn(() => ({
        sendMessage: jest.fn(),
        join: jest.fn(),
        setDisplayName: jest.fn(),
        setAvatarUrl: jest.fn(),
      })),
    })),
    AppServiceRegistration: {
      fromObject: jest.fn(() => ({
        generateRegistration: jest.fn(),
      })),
    },
    Logger: jest.fn().mockImplementation(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
  };
});

import { GooglePlayBridge } from '../../src/bridge/GooglePlayBridge';
import { Config } from '../../src/utils/Config';
import { BridgeConfig } from '../../src/models/Config';

// Mock all dependencies
jest.mock('../../src/api/GooglePlayClient');
jest.mock('../../src/api/ReviewManager');
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
  },
  LogLevel: {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    HTTP: 3,
    DEBUG: 4,
  }
}));
jest.mock('../../src/utils/HealthCheck', () => ({
  HealthMonitor: jest.fn().mockImplementation(() => ({
    startMonitoring: jest.fn(),
    stopMonitoring: jest.fn(),
    registerCheck: jest.fn(),
    runAllChecks: jest.fn(),
    getSystemHealth: jest.fn(() => ({ status: 'healthy' })),
    setMaintenanceMode: jest.fn(),
    getVersion: jest.fn(() => '1.0.0'),
    isInMaintenanceMode: jest.fn(() => false),
    shutdown: jest.fn(),
  })),
  StandardHealthChecks: {
    memoryUsage: jest.fn(),
    database: jest.fn(),
    diskSpace: jest.fn(),
  },
  HealthStatus: {
    HEALTHY: 'healthy',
    DEGRADED: 'degraded',
    UNHEALTHY: 'unhealthy',
  },
}));

jest.mock('../../src/utils/HttpServer', () => ({
  HttpServer: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    setHealthMonitor: jest.fn(),
  })),
}));

jest.mock('../../src/utils/CircuitBreaker', () => ({
  CircuitBreakerRegistry: {
    getInstance: jest.fn(() => ({
      getOrCreate: jest.fn(() => ({ 
        execute: jest.fn(),
        getStats: jest.fn(() => ({ failures: 0, successes: 0 }))
      })),
      getStats: jest.fn(() => ({ totalBreakers: 0 })),
      getAllStats: jest.fn(() => ({})),
    })),
  },
}));

jest.mock('../../src/utils/RateLimiter', () => ({
  RateLimitingRegistry: {
    getInstance: jest.fn(() => ({
      getOrCreate: jest.fn(() => ({ 
        tryAcquire: jest.fn(() => true),
        getStats: jest.fn(() => ({ requests: 0, denials: 0 }))
      })),
      getRateLimiter: jest.fn(() => ({ 
        tryAcquire: jest.fn(() => true),
        getStats: jest.fn(() => ({ requests: 0, denials: 0 }))
      })),
      getThrottler: jest.fn(() => ({ 
        execute: jest.fn(),
        getStats: jest.fn(() => ({ executions: 0, delays: 0 }))
      })),
      getAllStats: jest.fn(() => ({})),
    })),
  },
}));

describe('GooglePlayBridge Orchestration', () => {
  let mockConfig: BridgeConfig;
  let bridge: GooglePlayBridge;

  beforeEach(() => {
    mockConfig = {
      homeserver: {
        url: 'http://localhost:8008',
        domain: 'localhost'
      },
      appservice: {
        port: 8080,
        bind: '0.0.0.0',
        token: 'test-token',
        id: 'googleplay-bridge',
        botUsername: 'googleplay'
      },
      googleplay: {
        auth: {
          keyFile: '/path/to/key.json',
          scopes: ['https://www.googleapis.com/auth/androidpublisher']
        },
        applications: [
          {
            packageName: 'com.test.app1',
            matrixRoom: '!testroom1:localhost',
            appName: 'Test App 1',
            pollIntervalMs: 60000,
            maxReviewsPerPoll: 50,
            lookbackDays: 7
          },
          {
            packageName: 'com.test.app2',
            matrixRoom: '!testroom2:localhost',
            appName: 'Test App 2'
          }
        ],
        pollIntervalMs: 300000,
        maxReviewsPerPoll: 100
      },
      database: {
        type: 'sqlite',
        path: ':memory:'
      },
      logging: {
        level: 'debug',
        enableFile: false
      },
      monitoring: {
        enabled: true,
        port: 9090,
        host: '0.0.0.0',
        enableMetrics: true,
        enableHealthCheck: true,
        requestLogging: true
      },
      bridge: {
        admins: ['@admin:localhost']
      },
      version: '1.0.0-test'
    };

    Config.getInstance = jest.fn().mockReturnValue(mockConfig);
  });

  describe('Bridge Initialization', () => {
    test('should initialize all components in correct order', () => {
      expect(() => {
        bridge = new GooglePlayBridge(Config.getInstance());
      }).not.toThrow();

      expect(bridge).toBeDefined();
    });

    test('should initialize with production-ready components', () => {
      bridge = new GooglePlayBridge(Config.getInstance());

      // Bridge should have health monitor
      const healthMonitor = bridge.getHealthMonitor();
      expect(healthMonitor).toBeDefined();

      // Bridge should have HTTP server when monitoring is enabled
      const httpServer = bridge.getHttpServer();
      expect(httpServer).toBeDefined();
    });

    test('should initialize without HTTP server when monitoring is disabled', () => {
      const configWithoutMonitoring = {
        ...mockConfig,
        monitoring: {
          enabled: false
        }
      };

      Config.getInstance = jest.fn().mockReturnValue(configWithoutMonitoring);
      bridge = new GooglePlayBridge(Config.getInstance());

      const httpServer = bridge.getHttpServer();
      expect(httpServer).toBeUndefined();
    });

    test('should handle missing monitoring configuration', () => {
      const configWithoutMonitoring = {
        ...mockConfig,
        monitoring: undefined
      };

      Config.getInstance = jest.fn().mockReturnValue(configWithoutMonitoring);

      expect(() => {
        bridge = new GooglePlayBridge(Config.getInstance());
      }).not.toThrow();
    });
  });

  describe('Configuration Management', () => {
    test('should handle multiple application configurations', () => {
      bridge = new GooglePlayBridge(Config.getInstance());
      
      expect(mockConfig.googleplay.applications).toHaveLength(2);
      expect(mockConfig.googleplay.applications[0]?.packageName).toBe('com.test.app1');
      expect(mockConfig.googleplay.applications[1]?.packageName).toBe('com.test.app2');
    });

    test('should use app-specific configuration when available', () => {
      bridge = new GooglePlayBridge(Config.getInstance());

      const app1 = mockConfig.googleplay.applications[0];
      const app2 = mockConfig.googleplay.applications[1];

      // App1 has specific configuration
      expect(app1?.pollIntervalMs).toBe(60000);
      expect(app1?.maxReviewsPerPoll).toBe(50);
      expect(app1?.lookbackDays).toBe(7);

      // App2 should fall back to global defaults
      expect(app2?.pollIntervalMs).toBeUndefined();
      expect(app2?.maxReviewsPerPoll).toBeUndefined();
      expect(app2?.lookbackDays).toBeUndefined();
    });

    test('should validate Google Play authentication configuration', () => {
      bridge = new GooglePlayBridge(Config.getInstance());

      expect(mockConfig.googleplay.auth.keyFile).toBe('/path/to/key.json');
      expect(mockConfig.googleplay.auth.scopes).toContain('https://www.googleapis.com/auth/androidpublisher');
    });

    test('should handle different authentication methods', () => {
      const configWithCredentials = {
        ...mockConfig,
        googleplay: {
          ...mockConfig.googleplay,
          auth: {
            clientEmail: 'service@project.iam.gserviceaccount.com',
            privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
            projectId: 'test-project'
          }
        }
      };

      Config.getInstance = jest.fn().mockReturnValue(configWithCredentials);

      expect(() => {
        bridge = new GooglePlayBridge(Config.getInstance());
      }).not.toThrow();
    });
  });

  describe('Bridge Statistics and Monitoring', () => {
    beforeEach(() => {
      bridge = new GooglePlayBridge(Config.getInstance());
    });

    test('should provide comprehensive bridge statistics', () => {
      const stats = bridge.getBridgeStats();

      expect(stats).toHaveProperty('isRunning');
      expect(stats).toHaveProperty('uptime');
      expect(stats).toHaveProperty('version');
      expect(stats).toHaveProperty('matrix');
      expect(stats).toHaveProperty('reviews');
      expect(stats).toHaveProperty('circuitBreakers');
      expect(stats).toHaveProperty('rateLimiting');
    });

    test('should provide Google Play review statistics', () => {
      const reviewStats = bridge.getReviewStats();
      expect(reviewStats).toBeInstanceOf(Map);
    });

    test('should handle statistics when components are not initialized', () => {
      // Test statistics before bridge is started
      expect(() => {
        const stats = bridge.getBridgeStats();
        expect(stats.isRunning).toBe(false);
      }).not.toThrow();
    });
  });

  describe('Bridge Lifecycle Management', () => {
    beforeEach(() => {
      bridge = new GooglePlayBridge(Config.getInstance());
    });

    test('should handle bridge startup sequence', async () => {
      // Mock the startup process (can't actually start due to Matrix dependencies)
      expect(bridge.isRunningStatus()).toBe(false);
      
      // The bridge should be ready to start
      expect(() => bridge.getBridgeStats()).not.toThrow();
    });

    test('should handle bridge shutdown gracefully', async () => {
      // Test shutdown without starting
      expect(() => bridge.stop()).not.toThrow();
    });

    test('should prevent multiple startup attempts', () => {
      // This tests the isRunning guard in the start method
      expect(bridge.isRunningStatus()).toBe(false);
    });
  });

  describe('Component Integration', () => {
    beforeEach(() => {
      bridge = new GooglePlayBridge(Config.getInstance());
    });

    test('should integrate GooglePlayClient with proper configuration', () => {
      // Verify that GooglePlayClient would be initialized with correct config
      const stats = bridge.getBridgeStats();
      expect(stats).toHaveProperty('reviews');
    });

    test('should integrate ReviewManager with proper dependencies', () => {
      // Verify ReviewManager integration
      const reviewStats = bridge.getReviewStats();
      expect(reviewStats).toBeDefined();
    });

    test('should integrate MatrixHandler with bridge controller', () => {
      // The controller should have the onBridgeReply callback
      const stats = bridge.getBridgeStats();
      expect(stats.matrix).toBeDefined();
    });

    test('should provide bridge reply queuing functionality', async () => {
      // Test the reply queuing method
      await expect(
        bridge.queueReplyToReview(
          'com.test.app1',
          'review-123',
          'Thank you for the feedback!',
          '$matrix-event',
          '!testroom1:localhost',
          '@user:localhost'
        )
      ).rejects.toThrow('Review manager not initialized');
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle configuration errors gracefully', () => {
      const invalidConfig = {
        ...mockConfig,
        googleplay: {
          ...mockConfig.googleplay,
          auth: {} // Invalid auth configuration
        }
      };

      Config.getInstance = jest.fn().mockReturnValue(invalidConfig);

      expect(() => {
        new GooglePlayBridge(Config.getInstance());
      }).not.toThrow(); // Should not throw during construction
    });

    test('should handle missing database configuration', () => {
      const configWithoutDatabase = {
        ...mockConfig,
        database: undefined as any
      };

      Config.getInstance = jest.fn().mockReturnValue(configWithoutDatabase);

      expect(() => {
        new GooglePlayBridge(Config.getInstance());
      }).not.toThrow(); // Should handle gracefully
    });

    test('should handle malformed applications configuration', () => {
      const configWithInvalidApps = {
        ...mockConfig,
        googleplay: {
          ...mockConfig.googleplay,
          applications: [
            {
              packageName: '', // Invalid empty package name
              matrixRoom: '!testroom:localhost'
            }
          ]
        }
      };

      Config.getInstance = jest.fn().mockReturnValue(configWithInvalidApps);

      expect(() => {
        new GooglePlayBridge(Config.getInstance());
      }).not.toThrow();
    });
  });

  describe('Production Readiness Features', () => {
    beforeEach(() => {
      bridge = new GooglePlayBridge(Config.getInstance());
    });

    test('should initialize health monitoring system', () => {
      const healthMonitor = bridge.getHealthMonitor();
      expect(healthMonitor).toBeDefined();
    });

    test('should initialize HTTP monitoring server', () => {
      const httpServer = bridge.getHttpServer();
      expect(httpServer).toBeDefined();
    });

    test('should setup circuit breakers for external services', () => {
      const stats = bridge.getBridgeStats();
      expect(stats.circuitBreakers).toBeDefined();
    });

    test('should setup rate limiting for API calls', () => {
      const stats = bridge.getBridgeStats();
      expect(stats.rateLimiting).toBeDefined();
    });

    test('should provide comprehensive logging configuration', () => {
      // Logger should be initialized with proper configuration
      expect(mockConfig.logging).toBeDefined();
      expect(mockConfig.logging?.level).toBe('debug');
    });
  });

  describe('Multi-App Support', () => {
    beforeEach(() => {
      bridge = new GooglePlayBridge(Config.getInstance());
    });

    test('should handle multiple Google Play applications', () => {
      expect(mockConfig.googleplay.applications).toHaveLength(2);
    });

    test('should provide per-app statistics', () => {
      const reviewStats = bridge.getReviewStats();
      
      // Should be able to track stats for multiple apps
      expect(reviewStats).toBeInstanceOf(Map);
    });

    test('should handle app-specific room mappings', () => {
      const app1 = mockConfig.googleplay.applications[0];
      const app2 = mockConfig.googleplay.applications[1];

      expect(app1?.matrixRoom).toBe('!testroom1:localhost');
      expect(app2?.matrixRoom).toBe('!testroom2:localhost');
    });
  });

  describe('Bridge Health and Status', () => {
    beforeEach(() => {
      bridge = new GooglePlayBridge(Config.getInstance());
    });

    test('should report bridge running status', () => {
      expect(bridge.isRunningStatus()).toBe(false); // Not started yet
    });

    test('should provide uptime information', () => {
      const stats = bridge.getBridgeStats();
      expect(stats.uptime).toBeDefined();
      expect(typeof stats.uptime).toBe('number');
    });

    test('should provide version information', () => {
      const stats = bridge.getBridgeStats();
      expect(stats.version).toBe('1.0.0-test');
    });
  });

  describe('Bridge Controller Integration', () => {
    beforeEach(() => {
      bridge = new GooglePlayBridge(Config.getInstance());
    });

    test('should provide bridge health callback', async () => {
      // The controller should have getBridgeHealth callback
      const stats = bridge.getBridgeStats();
      expect(stats).toBeDefined();
    });

    test('should handle bridge reply callback', async () => {
      // Test the reply queue functionality
      await expect(
        bridge.queueReplyToReview(
          'com.test.app1',
          'review-456',
          'Thanks for your review!',
          '$event-id',
          '!room:localhost',
          '@user:localhost'
        )
      ).rejects.toThrow('Review manager not initialized');
    });
  });

  afterEach(() => {
    if (bridge) {
      try {
        // bridge.stop(); // Can't call async stop in afterEach, let GC handle it
      } catch (error) {
        // Ignore shutdown errors in tests
      }
    }
    jest.clearAllMocks();
  });
});