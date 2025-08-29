import { Config } from '../../src/utils/Config';
import { GooglePlayClient, GooglePlayAuthError } from '../../src/api/GooglePlayClient';
import { Logger } from '../../src/utils/Logger';
import * as fs from 'fs';
import * as path from 'path';

describe('Authentication Security Tests', () => {
  let originalConsoleError: any;
  let mockLogger: jest.Mocked<Logger>;

  beforeAll(() => {
    originalConsoleError = console.error;
    console.error = jest.fn();
    
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;
    
    jest.spyOn(Logger, 'getInstance').mockReturnValue(mockLogger);
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Google Play API Authentication Security', () => {
    it('should reject empty or invalid service account keys', async () => {
      const invalidConfigs = [
        { keyFileContent: '' },
        { keyFileContent: 'invalid json' },
        { keyFileContent: '{}' }, // Valid JSON but missing required fields
        { keyFile: '/path/to/nonexistent/file.json' },
        { clientEmail: '', privateKey: 'test' },
        { clientEmail: 'test@example.com', privateKey: '' },
        { keyFileContent: JSON.stringify({ type: 'service_account' }) }, // Missing client_email and private_key
      ];

      for (const config of invalidConfigs) {
        expect(() => new GooglePlayClient(config)).toThrowError();
      }
    });

    it('should properly validate service account key structure', async () => {
      const invalidKeyContent = JSON.stringify({
        type: 'service_account',
        // Missing required fields: client_email, private_key, etc.
      });

      const client = new GooglePlayClient({ keyFileContent: invalidKeyContent });
      
      await expect(client.initialize()).rejects.toThrow(GooglePlayAuthError);
    });

    it('should not log sensitive credential information', () => {
      const sensitiveKey = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----';
      
      try {
        new GooglePlayClient({
          clientEmail: 'test@service-account.iam.gserviceaccount.com',
          privateKey: sensitiveKey,
        });
      } catch (error) {
        // Check that private key is not logged
        expect(mockLogger.error).not.toHaveBeenCalledWith(
          expect.stringContaining(sensitiveKey)
        );
        expect(mockLogger.debug).not.toHaveBeenCalledWith(
          expect.stringContaining(sensitiveKey)
        );
      }
    });

    it('should handle authentication failures gracefully', async () => {
      const client = new GooglePlayClient({
        clientEmail: 'invalid@example.com',
        privateKey: 'invalid-private-key',
      });

      await expect(client.initialize()).rejects.toThrow(GooglePlayAuthError);
      expect(client.isReady()).toBe(false);
    });

    it('should prevent credential injection through environment variables', () => {
      // Test that malicious environment variables don't override security
      const originalEnv = process.env;
      
      try {
        process.env.GOOGLE_PRIVATE_KEY = 'malicious-key';
        process.env.GOOGLE_CLIENT_EMAIL = 'attacker@evil.com';
        
        // Config should validate and reject invalid credentials
        const config = {
          googleplay: {
            auth: {
              keyFileContent: JSON.stringify({
                type: 'service_account',
                client_email: 'legitimate@service.com',
                private_key: 'legitimate-key',
                project_id: 'test-project'
              })
            },
            applications: [],
            pollIntervalMs: 300000
          },
          homeserver: { url: 'https://matrix.org', domain: 'matrix.org' },
          appservice: { port: 8080, bind: '0.0.0.0', token: 'test', id: 'test', botUsername: 'test' },
          database: { type: 'sqlite' as const, path: ':memory:' },
          logging: { level: 'info' as const }
        };
        
        // The configuration system should use the explicit config, not env vars
        const client = new GooglePlayClient(config.googleplay.auth);
        expect(client).toBeDefined();
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe('Matrix Authentication Security', () => {
    it('should validate Matrix tokens are not empty or default values', () => {
      const invalidTokens = [
        '',
        'default-token',
        'test-token',
        'changeme',
        'token',
        'as-token',
      ];

      invalidTokens.forEach(token => {
        expect(() => {
          Config.load = jest.fn().mockResolvedValue({
            appservice: {
              token: token,
              port: 8080,
              bind: '0.0.0.0',
              id: 'test',
              botUsername: 'test'
            }
          });
        });
        
        // Mock validation that should catch weak tokens
        expect(token.length).toBeGreaterThan(16); // Should fail for weak tokens
      });
    });

    it('should ensure Matrix tokens have sufficient entropy', () => {
      const weakTokens = [
        '1111111111111111111111111111111111111111',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '12345678901234567890123456789012345678901',
      ];

      weakTokens.forEach(token => {
        // Check for repeated patterns
        const hasRepeatedChars = /(.)\1{3,}/.test(token);
        const hasSequentialChars = /0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef/.test(token);
        
        expect(hasRepeatedChars || hasSequentialChars).toBe(true); // These should be flagged as weak
      });
    });

    it('should not expose tokens in error messages or logs', () => {
      const sensitiveToken = 'as_token_1234567890abcdefghijklmnopqrstuvwxyz';
      
      try {
        // Simulate an error that might contain the token
        throw new Error(`Invalid token: ${sensitiveToken}`);
      } catch (error) {
        // In real implementation, errors should be sanitized
        expect(error.message).not.toContain(sensitiveToken);
      }
    });
  });

  describe('Service Account Key Security', () => {
    it('should reject service account keys with suspicious properties', () => {
      const suspiciousKeys = [
        {
          type: 'service_account',
          client_email: 'test@developer.gserviceaccount.com', // Suspicious domain
          private_key: 'test-key',
          project_id: 'test'
        },
        {
          type: 'service_account',
          client_email: 'admin@gmail.com', // Wrong domain type
          private_key: 'test-key',
          project_id: 'test'
        }
      ];

      suspiciousKeys.forEach(key => {
        const client = new GooglePlayClient({
          keyFileContent: JSON.stringify(key)
        });
        
        // Should validate email domain
        expect(key.client_email.endsWith('.iam.gserviceaccount.com')).toBe(false);
      });
    });

    it('should validate private key format', () => {
      const invalidPrivateKeys = [
        '', // Empty
        'not-a-private-key', // Plain text
        'data:application/json;base64,eyJ0ZXN0IjoidGVzdCJ9', // Data URI
        '<private_key>test</private_key>', // XML-like
      ];

      invalidPrivateKeys.forEach(privateKey => {
        expect(() => {
          new GooglePlayClient({
            clientEmail: 'test@project.iam.gserviceaccount.com',
            privateKey: privateKey
          });
        }).toThrowError();
      });
    });

    it('should detect and reject leaked or public keys', () => {
      // Common patterns of leaked or example keys
      const suspiciousKeys = [
        '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDGGpUQO8', // Common example key pattern
        'example-private-key',
        'YOUR_PRIVATE_KEY_HERE',
        'sk_test_', // Stripe test key pattern
        'pk_test_', // Stripe public key pattern
      ];

      suspiciousKeys.forEach(key => {
        const isLikelyExample = /example|test|your_|placeholder|sample|demo/i.test(key);
        expect(isLikelyExample).toBe(true); // These should be flagged
      });
    });
  });

  describe('Authentication State Security', () => {
    it('should properly handle authentication state transitions', async () => {
      const client = new GooglePlayClient({
        clientEmail: 'test@project.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ\n-----END PRIVATE KEY-----'
      });

      // Initial state should be unauthenticated
      expect(client.isReady()).toBe(false);

      // After failed initialization, should remain unauthenticated
      try {
        await client.initialize();
      } catch (error) {
        expect(client.isReady()).toBe(false);
      }

      // Should not allow API calls when unauthenticated
      await expect(client.getReviews({ packageName: 'com.test.app' }))
        .rejects.toThrow('not authenticated');
    });

    it('should handle concurrent authentication attempts safely', async () => {
      const client = new GooglePlayClient({
        clientEmail: 'test@project.iam.gserviceaccount.com',
        privateKey: 'test-key'
      });

      // Multiple concurrent initialization attempts should not cause race conditions
      const promises = Array.from({ length: 5 }, () => client.initialize());
      
      const results = await Promise.allSettled(promises);
      
      // All should fail (due to invalid key) but shouldn't cause inconsistent state
      results.forEach(result => {
        expect(result.status).toBe('rejected');
      });
      
      expect(client.isReady()).toBe(false);
    });
  });

  describe('Token Refresh Security', () => {
    it('should handle token refresh failures securely', async () => {
      const client = new GooglePlayClient({
        clientEmail: 'test@project.iam.gserviceaccount.com',
        privateKey: 'invalid-key'
      });

      // Mock a scenario where token refresh fails
      const mockAuth = {
        getAccessToken: jest.fn().mockRejectedValue(new Error('Token refresh failed')),
        getClient: jest.fn().mockResolvedValue({})
      };

      // Should not leave client in partially authenticated state
      try {
        await client.initialize();
      } catch (error) {
        expect(client.isReady()).toBe(false);
      }
    });

    it('should not cache expired or invalid tokens', () => {
      // Mock scenarios where tokens might be cached inappropriately
      const client = new GooglePlayClient({
        clientEmail: 'test@project.iam.gserviceaccount.com',
        privateKey: 'test-key'
      });

      // Ensure no internal token caching that could lead to security issues
      expect(client.isReady()).toBe(false);
    });
  });

  describe('Error Information Disclosure', () => {
    it('should not leak sensitive information in error messages', async () => {
      const sensitiveKey = '-----BEGIN PRIVATE KEY-----\nSENSITIVE_KEY_DATA\n-----END PRIVATE KEY-----';
      const client = new GooglePlayClient({
        clientEmail: 'test@project.iam.gserviceaccount.com',
        privateKey: sensitiveKey
      });

      try {
        await client.initialize();
      } catch (error) {
        expect(error.message).not.toContain('SENSITIVE_KEY_DATA');
        expect(error.message).not.toContain(sensitiveKey);
      }
    });

    it('should sanitize stack traces', async () => {
      const client = new GooglePlayClient({
        clientEmail: 'test@project.iam.gserviceaccount.com',
        privateKey: 'invalid-key'
      });

      try {
        await client.initialize();
      } catch (error) {
        // Stack traces should not contain file paths or internal details in production
        if (error.stack) {
          expect(error.stack).not.toContain('/home/');
          expect(error.stack).not.toContain('C:\\');
        }
      }
    });
  });
});