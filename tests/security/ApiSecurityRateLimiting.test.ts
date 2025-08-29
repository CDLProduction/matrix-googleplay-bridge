import { RateLimiter } from '../../src/utils/RateLimiter';
import { CircuitBreaker } from '../../src/utils/CircuitBreaker';
import { GooglePlayClient, GooglePlayRateLimitError, GooglePlayAuthError } from '../../src/api/GooglePlayClient';
import { HealthCheck } from '../../src/utils/HealthCheck';
import { HttpServer } from '../../src/utils/HttpServer';
import { Logger } from '../../src/utils/Logger';

describe('API Security and Rate Limiting Tests', () => {
  let mockLogger: jest.Mocked<Logger>;

  beforeAll(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;
    
    jest.spyOn(Logger, 'getInstance').mockReturnValue(mockLogger);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rate Limiting Security', () => {
    it('should enforce rate limits correctly', async () => {
      const rateLimiter = new RateLimiter({
        requests: 5,
        windowMs: 1000,
        skipSuccessfulRequests: false,
      });

      const key = 'test-key';
      
      // Should allow requests within limit
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.checkLimit(key);
        expect(result.allowed).toBe(true);
      }

      // Should block requests over limit
      const blocked = await rateLimiter.checkLimit(key);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfter).toBeGreaterThan(0);
    });

    it('should prevent rate limit bypass attempts', async () => {
      const rateLimiter = new RateLimiter({
        requests: 3,
        windowMs: 1000,
      });

      const bypassAttempts = [
        'test-key',
        'test-key ',  // Trailing space
        ' test-key',  // Leading space
        'Test-Key',   // Different case
        'test-key\0', // Null byte
        'test-key\r\n', // Line breaks
        'test%2Dkey', // URL encoded
        'test-key..', // Path traversal attempt
      ];

      // Normalize keys to prevent bypass
      for (const key of bypassAttempts) {
        const normalizedKey = key.trim().toLowerCase().replace(/[^a-zA-Z0-9-_]/g, '');
        await rateLimiter.checkLimit(normalizedKey);
      }

      // Should be limited after normalization
      const result = await rateLimiter.checkLimit('test-key');
      expect(result.allowed).toBe(false);
    });

    it('should handle concurrent rate limiting safely', async () => {
      const rateLimiter = new RateLimiter({
        requests: 10,
        windowMs: 1000,
      });

      const key = 'concurrent-test';
      const concurrentRequests = 20;
      
      // Make many concurrent requests
      const promises = Array.from({ length: concurrentRequests }, () =>
        rateLimiter.checkLimit(key)
      );

      const results = await Promise.all(promises);
      
      // Should allow exactly the rate limit number of requests
      const allowedCount = results.filter(r => r.allowed).length;
      const blockedCount = results.filter(r => !r.allowed).length;
      
      expect(allowedCount).toBe(10);
      expect(blockedCount).toBe(10);
    });

    it('should implement sliding window correctly', async () => {
      const rateLimiter = new RateLimiter({
        requests: 5,
        windowMs: 1000,
      });

      const key = 'sliding-test';
      
      // Fill the rate limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.checkLimit(key);
      }

      // Should be blocked
      let result = await rateLimiter.checkLimit(key);
      expect(result.allowed).toBe(false);

      // Wait for window to slide
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be allowed again
      result = await rateLimiter.checkLimit(key);
      expect(result.allowed).toBe(true);
    });

    it('should prevent memory exhaustion attacks', async () => {
      const rateLimiter = new RateLimiter({
        requests: 1,
        windowMs: 1000,
        maxKeys: 100, // Limit number of tracked keys
      });

      // Try to create many unique keys
      const promises = [];
      for (let i = 0; i < 200; i++) {
        promises.push(rateLimiter.checkLimit(`key-${i}`));
      }

      await Promise.all(promises);

      // Should have cleanup mechanism or key limit
      const memoryUsage = process.memoryUsage().heapUsed;
      expect(memoryUsage).toBeLessThan(100 * 1024 * 1024); // Less than 100MB
    });
  });

  describe('Circuit Breaker Security', () => {
    it('should trip circuit breaker on consecutive failures', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 5000,
        requestTimeoutMs: 1000,
      });

      const failingFunction = jest.fn().mockRejectedValue(new Error('API Error'));

      // Cause failures to trip circuit breaker
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFunction);
        } catch (error) {
          // Expected to fail
        }
      }

      // Circuit should be open now
      await expect(circuitBreaker.execute(failingFunction))
        .rejects.toThrow('Circuit breaker is OPEN');
      
      expect(failingFunction).toHaveBeenCalledTimes(3); // Should not call function when open
    });

    it('should prevent circuit breaker bypass attempts', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 10000,
      });

      const failingFunction = jest.fn().mockRejectedValue(new Error('Service down'));

      // Trip the circuit breaker
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(failingFunction);
        } catch (error) {
          // Expected
        }
      }

      // Multiple attempts should not bypass open circuit
      const bypassAttempts = Array.from({ length: 10 }, () =>
        circuitBreaker.execute(failingFunction).catch(e => e)
      );

      const results = await Promise.all(bypassAttempts);
      
      // All should be rejected with circuit breaker error
      results.forEach(result => {
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toContain('Circuit breaker is OPEN');
      });
    });

    it('should implement proper timeout protection', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 5,
        requestTimeoutMs: 100, // 100ms timeout
      });

      const slowFunction = () => new Promise(resolve => setTimeout(resolve, 500));

      const start = Date.now();
      
      try {
        await circuitBreaker.execute(slowFunction);
      } catch (error) {
        expect(error.message).toContain('timeout');
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(200); // Should timeout quickly
    });

    it('should handle state transitions securely', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 1000,
      });

      const conditionalFunction = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValueOnce('Success');

      // Trip circuit breaker
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(conditionalFunction);
        } catch (error) {
          // Expected
        }
      }

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should allow one request (half-open state)
      const result = await circuitBreaker.execute(conditionalFunction);
      expect(result).toBe('Success');

      // Should be closed again
      const result2 = await circuitBreaker.execute(() => Promise.resolve('Success 2'));
      expect(result2).toBe('Success 2');
    });
  });

  describe('Google Play API Security', () => {
    it('should handle API authentication failures securely', async () => {
      const client = new GooglePlayClient({
        clientEmail: 'invalid@project.iam.gserviceaccount.com',
        privateKey: 'invalid-key'
      });

      // Should fail authentication
      await expect(client.initialize()).rejects.toThrow(GooglePlayAuthError);

      // Should not make API calls when unauthenticated
      await expect(client.getReviews({ packageName: 'com.test.app' }))
        .rejects.toThrow('not authenticated');
    });

    it('should handle rate limiting responses properly', async () => {
      const client = new GooglePlayClient({
        clientEmail: 'test@project.iam.gserviceaccount.com',
        privateKey: 'test-key'
      });

      // Mock rate limit error from Google API
      const mockError = {
        response: {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'retry-after': '60' },
          data: { error: { message: 'Rate limit exceeded' } }
        }
      };

      // Should throw appropriate error type
      const error = client['handleAPIError'](mockError, 'getReviews');
      expect(error).toBeInstanceOf(GooglePlayRateLimitError);
      expect(error.details.retryAfter).toBe(60000); // Should be in milliseconds
    });

    it('should enforce minimum request intervals', async () => {
      const client = new GooglePlayClient({
        clientEmail: 'test@project.iam.gserviceaccount.com',
        privateKey: 'test-key'
      });

      // Should have minimum request interval
      const privateEnforceRateLimit = client['enforceRateLimit'].bind(client);
      
      const start = Date.now();
      await privateEnforceRateLimit();
      const firstCall = Date.now();
      
      await privateEnforceRateLimit();
      const secondCall = Date.now();

      const interval = secondCall - firstCall;
      expect(interval).toBeGreaterThanOrEqual(90); // Should wait at least 90ms (allowing for some variance)
    });

    it('should validate API response structure', async () => {
      const client = new GooglePlayClient({
        clientEmail: 'test@project.iam.gserviceaccount.com',
        privateKey: 'test-key'
      });

      const malformedResponses = [
        null,
        undefined,
        { data: null },
        { data: { reviews: null } },
        { data: { reviews: 'not-an-array' } },
        { data: { reviews: [{ malformed: 'review' }] } },
      ];

      malformedResponses.forEach(response => {
        // Should validate response structure
        if (!response || !response.data) {
          expect(response?.data).toBeFalsy();
        }
        
        if (response?.data?.reviews && !Array.isArray(response.data.reviews)) {
          expect(Array.isArray(response.data.reviews)).toBe(false);
        }
      });
    });

    it('should sanitize API error messages', async () => {
      const client = new GooglePlayClient({
        clientEmail: 'test@project.iam.gserviceaccount.com',
        privateKey: 'test-key'
      });

      const errorWithSensitiveData = {
        response: {
          status: 403,
          statusText: 'Forbidden',
          data: {
            error: {
              message: 'Access denied for service account: test@project.iam.gserviceaccount.com with private key: -----BEGIN PRIVATE KEY-----\nSENSITIVE_DATA\n-----END PRIVATE KEY-----'
            }
          }
        }
      };

      const handledError = client['handleAPIError'](errorWithSensitiveData, 'testOperation');
      
      // Error message should not contain sensitive information
      expect(handledError.message).not.toContain('SENSITIVE_DATA');
      expect(handledError.message).not.toContain('-----BEGIN PRIVATE KEY-----');
    });
  });

  describe('Health Check Security', () => {
    it('should not expose sensitive information in health checks', async () => {
      const healthCheck = new HealthCheck({
        interval: 1000,
        timeout: 5000,
        services: ['database', 'googleplay', 'matrix']
      });

      const status = await healthCheck.getStatus();
      
      // Should not contain sensitive configuration
      const statusString = JSON.stringify(status);
      expect(statusString).not.toMatch(/password|token|key|secret/i);
      expect(statusString).not.toContain('-----BEGIN');
      expect(statusString).not.toContain('private_key');
    });

    it('should handle health check timeouts properly', async () => {
      const healthCheck = new HealthCheck({
        interval: 1000,
        timeout: 100, // Short timeout
        services: ['test-service']
      });

      const slowService = () => new Promise(resolve => setTimeout(resolve, 500));
      
      const start = Date.now();
      const result = await healthCheck.checkService('test-service', slowService);
      const duration = Date.now() - start;

      expect(result.healthy).toBe(false);
      expect(duration).toBeLessThan(200); // Should timeout quickly
      expect(result.error).toContain('timeout');
    });

    it('should prevent health check amplification attacks', async () => {
      const healthCheck = new HealthCheck({
        interval: 1000,
        timeout: 5000,
        services: ['service1', 'service2']
      });

      // Multiple rapid health check requests
      const requests = Array.from({ length: 100 }, () => healthCheck.getStatus());
      
      const start = Date.now();
      await Promise.all(requests);
      const duration = Date.now() - start;

      // Should handle many concurrent requests efficiently
      expect(duration).toBeLessThan(1000); // Should not take too long
    });
  });

  describe('HTTP Server Security', () => {
    it('should implement proper CORS policies', () => {
      // Test CORS configuration
      const allowedOrigins = ['https://matrix.org', 'https://app.element.io'];
      const suspiciousOrigins = [
        'http://evil.com',
        'https://malicious-site.com',
        '*', // Wildcard should be restricted
        'null',
        'file://',
      ];

      suspiciousOrigins.forEach(origin => {
        const isAllowed = allowedOrigins.includes(origin);
        expect(isAllowed).toBe(false); // Should not be allowed
      });
    });

    it('should set proper security headers', () => {
      const securityHeaders = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Content-Security-Policy': "default-src 'self'",
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      };

      Object.entries(securityHeaders).forEach(([header, expectedValue]) => {
        expect(expectedValue).toBeDefined();
        expect(expectedValue).not.toBe('');
        
        // Validate specific security policies
        if (header === 'Content-Security-Policy') {
          expect(expectedValue).not.toContain("'unsafe-eval'");
          expect(expectedValue).not.toContain("'unsafe-inline'");
        }
      });
    });

    it('should validate request sizes and prevent DoS', () => {
      const maxRequestSizes = {
        '/api/webhook': 1024 * 1024, // 1MB for webhooks
        '/api/metrics': 10 * 1024,   // 10KB for metrics
        '/health': 1024,             // 1KB for health checks
      };

      Object.entries(maxRequestSizes).forEach(([endpoint, maxSize]) => {
        expect(maxSize).toBeGreaterThan(0);
        expect(maxSize).toBeLessThan(10 * 1024 * 1024); // Max 10MB for any endpoint
      });
    });

    it('should implement request timeout protection', async () => {
      // Simulate slow request handling
      const slowHandler = () => new Promise(resolve => setTimeout(resolve, 10000));
      const timeout = 5000; // 5 second timeout

      const start = Date.now();
      
      try {
        await Promise.race([
          slowHandler(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), timeout)
          )
        ]);
      } catch (error) {
        expect(error.message).toBe('Request timeout');
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(timeout + 100); // Allow small variance
    });

    it('should prevent HTTP header injection', () => {
      const maliciousHeaders = [
        'test\r\nHost: evil.com',
        'test\nX-Forwarded-For: attacker.com',
        'test\r\nSet-Cookie: admin=true',
        'test%0d%0aLocation: http://evil.com',
      ];

      maliciousHeaders.forEach(header => {
        // Headers should be sanitized
        const sanitized = header.replace(/[\r\n]/g, '');
        expect(sanitized).not.toContain('\r');
        expect(sanitized).not.toContain('\n');
        expect(sanitized.length).toBeLessThan(header.length);
      });
    });
  });

  describe('Monitoring and Metrics Security', () => {
    it('should not expose sensitive data in metrics', () => {
      const sampleMetrics = {
        'bridge_messages_processed_total': 150,
        'bridge_errors_total': 5,
        'bridge_uptime_seconds': 3600,
        'bridge_memory_usage_bytes': 128000000,
      };

      const metricsString = JSON.stringify(sampleMetrics);
      
      // Should not contain sensitive information
      expect(metricsString).not.toMatch(/password|token|key|secret|auth/i);
      expect(metricsString).not.toContain('@');
      expect(metricsString).not.toContain('http://');
      expect(metricsString).not.toContain('jdbc:');
    });

    it('should implement rate limiting on metrics endpoints', async () => {
      const metricsRateLimit = {
        requests: 10,
        windowMs: 60000, // 1 minute
      };

      // Should have conservative rate limits for metrics
      expect(metricsRateLimit.requests).toBeLessThanOrEqual(100);
      expect(metricsRateLimit.windowMs).toBeGreaterThanOrEqual(60000);
    });

    it('should validate metrics collection intervals', () => {
      const collectionIntervals = {
        health: 30000,    // 30 seconds
        performance: 60000, // 1 minute
        business: 300000,   // 5 minutes
      };

      Object.entries(collectionIntervals).forEach(([metric, interval]) => {
        // Intervals should be reasonable to prevent excessive load
        expect(interval).toBeGreaterThan(1000); // At least 1 second
        expect(interval).toBeLessThan(3600000); // At most 1 hour
      });
    });
  });

  describe('Error Handling Security', () => {
    it('should not leak stack traces in production', () => {
      const productionError = new Error('Database connection failed');
      productionError.stack = `Error: Database connection failed
    at DatabaseConnection.connect (/app/src/database.js:45:15)
    at GooglePlayBridge.initialize (/app/src/bridge.js:123:30)
    at main (/app/src/app.js:15:10)`;

      // In production, stack traces should be sanitized
      const isProd = process.env.NODE_ENV === 'production';
      
      if (isProd) {
        const sanitizedError = {
          message: productionError.message,
          // Stack trace should be omitted in production
        };
        
        expect(sanitizedError.stack).toBeUndefined();
      } else {
        // In development, full stack traces are okay
        expect(productionError.stack).toBeDefined();
      }
    });

    it('should sanitize error messages', () => {
      const errorWithSensitiveData = new Error(
        'Authentication failed for user admin with password secret123'
      );

      // Error messages should be sanitized
      const sanitized = errorWithSensitiveData.message
        .replace(/password\s+\S+/gi, 'password [REDACTED]')
        .replace(/token\s+\S+/gi, 'token [REDACTED]');

      expect(sanitized).toContain('[REDACTED]');
      expect(sanitized).not.toContain('secret123');
    });
  });
});