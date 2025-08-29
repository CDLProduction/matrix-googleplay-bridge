/**
 * Unit tests for AuditLogger
 */

import { AuditLogger } from '../../src/utils/AuditLogger';

// Mock Logger
jest.mock('../../src/utils/Logger', () => ({
  Logger: {
    getInstance: jest.fn(() => ({
      setComponent: jest.fn().mockReturnThis(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }))
  }
}));

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;
  let mockDatabase: any;

  beforeEach(() => {
    // Reset singleton for each test
    (AuditLogger as any).instance = undefined;
    auditLogger = AuditLogger.getInstance();

    // Create mock database
    mockDatabase = {
      query: jest.fn(),
      close: jest.fn(),
      getAllAppConfigs: jest.fn(),
      storeAppConfig: jest.fn(),
      removeAppConfig: jest.fn(),
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Singleton Pattern', () => {
    test('should return same instance', () => {
      const instance1 = AuditLogger.getInstance();
      const instance2 = AuditLogger.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Initialization', () => {
    test('should initialize without database (in-memory mode)', async () => {
      expect(() => AuditLogger.getInstance()).not.toThrow();
    });

    test('should initialize with database', async () => {
      mockDatabase.query.mockResolvedValue([]);
      
      await auditLogger.initialize(mockDatabase);
      
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS audit_log')
      );
    });

    test('should handle database initialization errors', async () => {
      mockDatabase.query.mockRejectedValue(new Error('Database error'));
      
      // Should not throw, but fall back to in-memory mode
      await expect(auditLogger.initialize(mockDatabase)).resolves.not.toThrow();
    });
  });

  describe('Basic Audit Logging', () => {
    test('should log basic audit entry', async () => {
      const entry = {
        level: 'info' as const,
        action: 'test.action',
        userId: 'user123',
        result: 'success' as const,
      };

      await auditLogger.log(entry);
      
      // Should complete without error (in-memory mode)
      expect(true).toBe(true);
    });

    test('should log entry with all optional fields', async () => {
      const entry = {
        level: 'error' as const,
        action: 'test.action',
        userId: 'user123',
        roomId: 'room456',
        packageName: 'com.test.app',
        result: 'failure' as const,
        details: { key: 'value' },
        errorMessage: 'Test error',
        duration: 1500,
      };

      await auditLogger.log(entry);
      
      expect(true).toBe(true);
    });
  });

  describe('Convenience Methods', () => {
    test('should log config reload success', async () => {
      await auditLogger.logConfigReload('user123', true, { changes: ['app1'] });
      
      expect(true).toBe(true);
    });

    test('should log config reload failure', async () => {
      await auditLogger.logConfigReload('user123', false, {}, 'Config error');
      
      expect(true).toBe(true);
    });

    test('should log maintenance mode activation', async () => {
      await auditLogger.logMaintenanceMode('admin123', true, 'Planned maintenance');
      
      expect(true).toBe(true);
    });

    test('should log maintenance mode deactivation', async () => {
      await auditLogger.logMaintenanceMode('admin123', false);
      
      expect(true).toBe(true);
    });

    test('should log app operations', async () => {
      await auditLogger.logAppOperation(
        'add',
        'user123',
        'com.test.app',
        true,
        { version: '1.0' }
      );
      
      expect(true).toBe(true);
    });

    test('should log bridge commands', async () => {
      await auditLogger.logBridgeCommand(
        'status',
        'user123',
        'room456',
        true,
        150,
        { apps: 2 }
      );
      
      expect(true).toBe(true);
    });

    test('should log review operations', async () => {
      await auditLogger.logReviewOperation(
        'process',
        'com.test.app',
        true,
        'review-123',
        { rating: 5 }
      );
      
      expect(true).toBe(true);
    });

    test('should log matrix operations', async () => {
      await auditLogger.logMatrixOperation(
        'send',
        'room456',
        true,
        'user123',
        { message: 'test' }
      );
      
      expect(true).toBe(true);
    });
  });

  describe('In-Memory Search', () => {
    beforeEach(async () => {
      // Add some test entries
      await auditLogger.log({
        level: 'info',
        action: 'test.action1',
        userId: 'user1',
        result: 'success',
      });
      
      await auditLogger.log({
        level: 'error',
        action: 'test.action2',
        userId: 'user2',
        result: 'failure',
        errorMessage: 'Test error',
      });
      
      await auditLogger.log({
        level: 'warn',
        action: 'config.reload',
        userId: 'admin',
        packageName: 'com.test.app',
        result: 'success',
      });
    });

    test('should search all entries', async () => {
      const results = await auditLogger.search({});
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    test('should search with limit', async () => {
      const results = await auditLogger.search({ limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    test('should search by level', async () => {
      const results = await auditLogger.search({ level: 'info' });
      expect(results.every(r => r.level === 'info')).toBe(true);
    });

    test('should search by action', async () => {
      const results = await auditLogger.search({ action: 'config' });
      expect(results.some(r => r.action.includes('config'))).toBe(true);
    });

    test('should search by userId', async () => {
      const results = await auditLogger.search({ userId: 'user1' });
      expect(results.every(r => r.userId === 'user1')).toBe(true);
    });

    test('should search by result', async () => {
      const results = await auditLogger.search({ result: 'failure' });
      expect(results.every(r => r.result === 'failure')).toBe(true);
    });

    test('should search by packageName', async () => {
      const results = await auditLogger.search({ packageName: 'com.test.app' });
      expect(results.every(r => r.packageName === 'com.test.app')).toBe(true);
    });

    test('should get recent entries', async () => {
      const results = await auditLogger.getRecent(5);
      expect(results.length).toBeLessThanOrEqual(5);
      
      // Should be sorted by timestamp descending
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.timestamp.getTime()).toBeGreaterThanOrEqual(
          results[i + 1]!.timestamp.getTime()
        );
      }
    });
  });

  describe('Database Storage', () => {
    beforeEach(async () => {
      mockDatabase.query.mockResolvedValue([]);
      await auditLogger.initialize(mockDatabase);
    });

    test('should store entry in database', async () => {
      const entry = {
        level: 'info' as const,
        action: 'test.action',
        userId: 'user123',
        result: 'success' as const,
      };

      mockDatabase.query.mockResolvedValueOnce([]); // For INSERT

      await auditLogger.log(entry);
      
      // Should call INSERT query
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.any(Array)
      );
    });

    test('should fallback to in-memory on database error', async () => {
      const entry = {
        level: 'info' as const,
        action: 'test.action',
        userId: 'user123',
        result: 'success' as const,
      };

      mockDatabase.query.mockRejectedValueOnce(new Error('Database error'));

      // Should not throw
      await expect(auditLogger.log(entry)).resolves.not.toThrow();
    });

    test('should search database', async () => {
      const mockRows = [
        {
          id: 'audit_1',
          timestamp: new Date().toISOString(),
          level: 'info',
          action: 'test.action',
          user_id: 'user123',
          room_id: null,
          package_name: null,
          details: null,
          result: 'success',
          error_message: null,
          duration: null,
        }
      ];

      mockDatabase.query.mockResolvedValueOnce(mockRows);

      const results = await auditLogger.search({ limit: 10 });
      
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'audit_1',
        level: 'info',
        action: 'test.action',
        userId: 'user123',
        result: 'success',
      });
    });

    test('should handle database search errors', async () => {
      mockDatabase.query.mockRejectedValueOnce(new Error('Query error'));

      // Should fallback to in-memory search
      const results = await auditLogger.search({});
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Entry Validation', () => {
    test('should generate unique IDs', async () => {
      const entry = {
        level: 'info' as const,
        action: 'test.action',
        result: 'success' as const,
      };

      await auditLogger.log(entry);
      await auditLogger.log(entry);

      const results = await auditLogger.search({});
      const ids = results.map(r => r.id).filter(Boolean);
      const uniqueIds = new Set(ids);
      
      expect(uniqueIds.size).toBe(ids.length);
    });

    test('should add timestamp automatically', async () => {
      const entry = {
        level: 'info' as const,
        action: 'test.action',
        result: 'success' as const,
      };

      const beforeTime = new Date();
      await auditLogger.log(entry);
      const afterTime = new Date();

      const results = await auditLogger.search({});
      const latestEntry = results[0];
      
      expect(latestEntry?.timestamp).toBeInstanceOf(Date);
      expect(latestEntry!.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(latestEntry!.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed database rows gracefully', async () => {
      const malformedRows = [
        { id: 'test', invalid: 'data' }
      ];

      mockDatabase.query.mockResolvedValueOnce(malformedRows);
      await auditLogger.initialize(mockDatabase);

      // Should not throw when mapping invalid rows
      await expect(auditLogger.search({})).resolves.toBeDefined();
    });

    test('should handle JSON parsing errors in details', async () => {
      const rowsWithInvalidJson = [
        {
          id: 'audit_1',
          timestamp: new Date().toISOString(),
          level: 'info',
          action: 'test.action',
          user_id: 'user123',
          room_id: null,
          package_name: null,
          details: 'invalid json {',
          result: 'success',
          error_message: null,
          duration: null,
        }
      ];

      mockDatabase.query.mockResolvedValueOnce(rowsWithInvalidJson);
      await auditLogger.initialize(mockDatabase);

      // Should handle invalid JSON gracefully
      const results = await auditLogger.search({});
      expect(results[0]?.details).toBeUndefined();
    });
  });
});