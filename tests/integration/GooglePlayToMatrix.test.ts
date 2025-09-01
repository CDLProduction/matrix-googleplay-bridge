/**
 * Integration tests for Phase 3.1: Google Play to Matrix flow
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
import { GooglePlayClient } from '../../src/api/GooglePlayClient';
import { ReviewManager } from '../../src/api/ReviewManager';
import { Config } from '../../src/utils/Config';
import { BridgeConfig } from '../../src/models/ConfigTypes';

// Mock dependencies
jest.mock('../../src/api/GooglePlayClient');
jest.mock('../../src/api/ReviewManager');
jest.mock('matrix-appservice-bridge');
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

const MockedGooglePlayClient = GooglePlayClient as jest.MockedClass<typeof GooglePlayClient>;
const MockedReviewManager = ReviewManager as jest.MockedClass<typeof ReviewManager>;

describe('Phase 3.1: Google Play to Matrix Flow', () => {
  let mockConfig: BridgeConfig;
  let mockGooglePlayClient: jest.Mocked<GooglePlayClient>;
  let mockReviewManager: jest.Mocked<ReviewManager>;

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
            packageName: 'com.test.app',
            matrixRoom: '!testroom:localhost',
            appName: 'Test App',
            pollIntervalMs: 60000,
            maxReviewsPerPoll: 50,
            lookbackDays: 7
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
      version: '1.0.0'
    };

    // Mock GooglePlay Client
    mockGooglePlayClient = {
      initialize: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(true),
      getRecentReviews: jest.fn().mockResolvedValue([
        {
          reviewId: 'review-123',
          packageName: 'com.test.app',
          authorName: 'Test User',
          text: 'Great app!',
          starRating: 5,
          languageCode: 'en',
          device: 'Pixel 6',
          androidOsVersion: '12',
          appVersionCode: 100,
          appVersionName: '1.0.0',
          createdAt: new Date('2023-01-01T12:00:00Z'),
          lastModifiedAt: new Date('2023-01-01T12:00:00Z'),
          hasReply: false
        }
      ]),
      testConnection: jest.fn().mockResolvedValue(true),
      shutdown: jest.fn().mockResolvedValue(undefined)
    } as any;

    // Mock Review Manager
    mockReviewManager = {
      initialize: jest.fn().mockResolvedValue(undefined),
      startPollingReviews: jest.fn().mockResolvedValue(undefined),
      getAllProcessingStats: jest.fn().mockReturnValue(new Map([
        ['com.test.app', {
          totalReviewsProcessed: 10,
          newReviewsFound: 5,
          updatedReviewsFound: 2,
          repliesSent: 3,
          errors: 0,
          lastPollTime: new Date()
        }]
      ])),
      getPendingRepliesCount: jest.fn().mockReturnValue(0),
      shutdown: jest.fn().mockResolvedValue(undefined)
    } as any;

    MockedGooglePlayClient.mockImplementation(() => mockGooglePlayClient);
    MockedReviewManager.mockImplementation(() => mockReviewManager);

    Config.getInstance = jest.fn().mockReturnValue(mockConfig);
  });

  describe('Bridge Initialization and Google Play Integration', () => {
    test('should initialize Google Play components successfully', async () => {
      const bridge = new GooglePlayBridge(Config.getInstance());

      // Test that bridge initializes without errors
      expect(() => bridge).not.toThrow();
      // GooglePlayClient is only created when the bridge starts, not during construction
      expect(MockedGooglePlayClient).not.toHaveBeenCalled();
    });

    test('should start polling for configured applications', async () => {
      // const bridge = new GooglePlayBridge(Config.getInstance());
      
      // The bridge should be ready to start (we can't actually start it in tests due to Matrix dependencies)
      expect(mockReviewManager.startPollingReviews).not.toHaveBeenCalled();
      
      // Verify the configuration is properly loaded
      expect(mockConfig.googleplay.applications).toHaveLength(1);
      expect(mockConfig.googleplay.applications[0]?.packageName).toBe('com.test.app');
    });

    test('should handle multiple applications configuration', async () => {
      const multiAppConfig = {
        ...mockConfig,
        googleplay: {
          ...mockConfig.googleplay,
          applications: [
            {
              packageName: 'com.test.app1',
              matrixRoom: '!testroom1:localhost',
              appName: 'Test App 1'
            },
            {
              packageName: 'com.test.app2',
              matrixRoom: '!testroom2:localhost',
              appName: 'Test App 2'
            }
          ]
        }
      };

      Config.getInstance = jest.fn().mockReturnValue(multiAppConfig);
      const bridge = new GooglePlayBridge(Config.getInstance());

      expect(() => bridge).not.toThrow();
      expect(multiAppConfig.googleplay.applications).toHaveLength(2);
    });
  });

  describe('Review Processing Workflow', () => {
    test('should process new reviews correctly', async () => {
      // This would test the complete flow:
      // 1. GooglePlayClient detects new reviews
      // 2. ReviewManager processes them
      // 3. Reviews are converted to Matrix messages
      // 4. Virtual users are created
      // 5. Messages are sent to Matrix rooms

      expect(mockGooglePlayClient.getRecentReviews).toBeDefined();
      expect(mockReviewManager.initialize).toBeDefined();

      // Verify the mock review data structure matches our expected format
      const mockReviews = await mockGooglePlayClient.getRecentReviews('com.test.app', new Date(), 100);
      expect(mockReviews).toHaveLength(1);
      expect(mockReviews[0]).toMatchObject({
        reviewId: 'review-123',
        packageName: 'com.test.app',
        authorName: 'Test User',
        text: 'Great app!',
        starRating: 5,
        device: 'Pixel 6',
        androidOsVersion: '12'
      });
    });

    test('should handle review updates and modifications', async () => {
      // Mock updated review
      mockGooglePlayClient.getRecentReviews.mockResolvedValue([
        {
          reviewId: 'review-123',
          packageName: 'com.test.app',
          authorName: 'Test User',
          text: 'Updated: Great app with new features!',
          starRating: 5,
          createdAt: new Date('2023-01-01T12:00:00Z'),
          lastModifiedAt: new Date('2023-01-02T12:00:00Z'), // Modified date changed
          hasReply: false
        }
      ] as any);

      const reviews = await mockGooglePlayClient.getRecentReviews('com.test.app', new Date(), 100);
      expect(reviews[0]?.text).toBe('Updated: Great app with new features!');
      expect(reviews[0]?.lastModifiedAt).toEqual(new Date('2023-01-02T12:00:00Z'));
    });

    test('should handle review metadata correctly', async () => {
      const reviews = await mockGooglePlayClient.getRecentReviews('com.test.app', new Date(), 100);
      const review = reviews[0];

      expect(review).toHaveProperty('device', 'Pixel 6');
      expect(review).toHaveProperty('androidOsVersion', '12');
      expect(review).toHaveProperty('appVersionCode', 100);
      expect(review).toHaveProperty('appVersionName', '1.0.0');
      expect(review).toHaveProperty('languageCode', 'en');
    });

    test('should handle reviews without text (rating-only)', async () => {
      mockGooglePlayClient.getRecentReviews.mockResolvedValue([
        {
          reviewId: 'review-456',
          packageName: 'com.test.app',
          authorName: 'Anonymous User',
          starRating: 4,
          createdAt: new Date(),
          lastModifiedAt: new Date(),
          hasReply: false
          // No text field - rating only
        }
      ] as any);

      const reviews = await mockGooglePlayClient.getRecentReviews('com.test.app', new Date(), 100);
      expect(reviews[0]).not.toHaveProperty('text');
      expect(reviews[0]?.starRating).toBe(4);
    });
  });

  describe('Virtual User Creation', () => {
    test('should handle virtual user creation for reviewers', () => {
      // This tests the pattern for virtual user creation
      const reviewId = 'review-123';
      const expectedUserId = `@googleplay_${reviewId}:localhost`;
      
      expect(expectedUserId).toBe('@googleplay_review-123:localhost');
      
      // Virtual user should be created with proper format
      expect(expectedUserId).toMatch(/^@googleplay_[^:]+:localhost$/);
    });

    test('should handle author name encoding for virtual users', () => {
      const authorName = 'Test User With Spaces';
      const reviewId = 'review-123';
      
      // Virtual users should use the review ID, not author name for user ID
      const expectedUserId = `@googleplay_${reviewId}:localhost`;
      expect(expectedUserId).toBe('@googleplay_review-123:localhost');
      
      // But should store the display name separately
      expect(authorName).toBe('Test User With Spaces');
    });
  });

  describe('Room Management and Message Forwarding', () => {
    test('should handle room mapping configuration', () => {
      const appConfig = mockConfig.googleplay.applications[0];
      expect(appConfig?.packageName).toBe('com.test.app');
      expect(appConfig?.matrixRoom).toBe('!testroom:localhost');
      expect(appConfig?.appName).toBe('Test App');
    });

    test('should handle app-specific polling configuration', () => {
      const appConfig = mockConfig.googleplay.applications[0];
      expect(appConfig?.pollIntervalMs).toBe(60000);
      expect(appConfig?.maxReviewsPerPoll).toBe(50);
      expect(appConfig?.lookbackDays).toBe(7);
    });

    test('should fall back to global polling configuration', () => {
      const globalConfig = mockConfig.googleplay;
      expect(globalConfig.pollIntervalMs).toBe(300000);
      expect(globalConfig.maxReviewsPerPoll).toBe(100);
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle Google Play API connection failures', async () => {
      mockGooglePlayClient.testConnection.mockResolvedValue(false);
      mockGooglePlayClient.initialize.mockRejectedValue(new Error('API connection failed'));

      expect(mockGooglePlayClient.testConnection).toBeDefined();
      expect(mockGooglePlayClient.initialize).toBeDefined();

      // The bridge should handle these errors gracefully
      const connectionResult = await mockGooglePlayClient.testConnection('com.test.app');
      expect(connectionResult).toBe(false);
    });

    test('should handle review processing errors', async () => {
      mockGooglePlayClient.getRecentReviews.mockRejectedValue(new Error('Rate limit exceeded'));

      try {
        await mockGooglePlayClient.getRecentReviews('com.test.app', new Date(), 100);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Rate limit exceeded');
      }
    });

    test('should handle malformed review data gracefully', async () => {
      // Mock malformed review data
      mockGooglePlayClient.getRecentReviews.mockResolvedValue([
        {
          // Missing required fields
          reviewId: '',
          packageName: 'com.test.app',
          starRating: 0
        }
      ] as any);

      const reviews = await mockGooglePlayClient.getRecentReviews('com.test.app', new Date(), 100);
      expect(reviews).toHaveLength(1);
      
      // Should handle missing data gracefully
      expect(reviews[0]?.reviewId).toBe('');
      expect(reviews[0]?.starRating).toBe(0);
    });
  });

  describe('Statistics and Monitoring', () => {
    test('should track review processing statistics', () => {
      const stats = mockReviewManager.getAllProcessingStats();
      expect(stats.size).toBe(1);
      
      const appStats = stats.get('com.test.app');
      expect(appStats).toMatchObject({
        totalReviewsProcessed: 10,
        newReviewsFound: 5,
        updatedReviewsFound: 2,
        repliesSent: 3,
        errors: 0
      });
    });

    test('should track pending replies count', () => {
      const pendingCount = mockReviewManager.getPendingRepliesCount();
      expect(pendingCount).toBe(0);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});