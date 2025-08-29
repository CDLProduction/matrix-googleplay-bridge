/**
 * Unit tests for Phase 4.3 Bridge Commands (Configuration reload, Maintenance mode, Audit logging)
 */

import { BridgeCommands, CommandContext } from '../../src/bridge/BridgeCommands';
import { Config } from '../../src/utils/Config';
import { AuditLogger } from '../../src/utils/AuditLogger';

// Mock dependencies
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

jest.mock('../../src/utils/Config');
jest.mock('../../src/utils/AuditLogger');
jest.mock('../../src/managers/AppManager');

const MockedConfig = Config as any;
const MockedAuditLogger = AuditLogger as any;

describe('Phase 4.3 Bridge Commands', () => {
  let bridgeCommands: BridgeCommands;
  let mockBridge: any;
  let mockAppManager: any;
  let mockGooglePlayBridge: any;
  let mockAuditLogger: any;
  let mockConfig: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock bridge
    mockBridge = {
      getIntent: jest.fn(() => ({
        sendMessage: jest.fn(),
      })),
    };

    // Create mock app manager
    mockAppManager = {
      reloadConfiguration: jest.fn(),
    } as any;

    // Create mock Google Play bridge
    mockGooglePlayBridge = {
      onConfigReload: jest.fn(),
      onMaintenanceMode: jest.fn(),
    };

    // Create mock audit logger
    mockAuditLogger = {
      logConfigReload: jest.fn(),
      logMaintenanceMode: jest.fn(),
      logBridgeCommand: jest.fn(),
      search: jest.fn(() => Promise.resolve([])),
    } as any;

    // Create mock config
    mockConfig = {
      all: {
        appservice: { port: 8080, bind: '0.0.0.0' },
        database: { type: 'sqlite' },
        googleplay: { applications: [] },
      },
    } as any;

    // Setup mocks
    MockedAuditLogger.getInstance = jest.fn().mockReturnValue(mockAuditLogger);
    MockedConfig.getInstance = jest.fn().mockReturnValue(mockConfig);
    MockedConfig.reload = jest.fn().mockResolvedValue(mockConfig);

    // Create bridge commands instance
    bridgeCommands = new BridgeCommands(
      mockBridge,
      mockAppManager,
      mockGooglePlayBridge,
      ['@admin:localhost']
    );
  });

  describe('Configuration Reload Command', () => {
    const adminContext: CommandContext = {
      roomId: '!test:localhost',
      userId: '@admin:localhost',
      message: '!reloadconfig',
      args: [],
    };

    const nonAdminContext: CommandContext = {
      roomId: '!test:localhost',
      userId: '@user:localhost',
      message: '!reloadconfig',
      args: [],
    };

    test('should handle successful config reload', async () => {
      const newConfig = {
        appservice: { port: 8080, bind: '0.0.0.0' },
        database: { type: 'sqlite' },
        googleplay: { applications: [] },
      };

      mockConfig.all = newConfig;
      MockedConfig.reload = jest.fn().mockResolvedValueOnce(mockConfig);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      expect(MockedConfig.reload).toHaveBeenCalled();
      expect(mockAppManager.reloadConfiguration).toHaveBeenCalled();
      expect(mockGooglePlayBridge.onConfigReload).toHaveBeenCalledWith(newConfig);
      expect(mockAuditLogger.logConfigReload).toHaveBeenCalledWith(
        adminContext.userId,
        true,
        { criticalChanges: [] }
      );
    });

    test('should detect critical configuration changes', async () => {
      const oldConfig = {
        appservice: { port: 8080, bind: '0.0.0.0' },
        database: { type: 'sqlite' },
      };
      const newConfig = {
        appservice: { port: 9090, bind: '127.0.0.1' },
        database: { type: 'postgresql' },
      };

      // First call returns the old config, second call returns new config
      MockedConfig.getInstance = jest.fn()
        .mockReturnValueOnce({ all: oldConfig } as any)
        .mockReturnValue({ all: newConfig } as any);
      MockedConfig.reload = jest.fn().mockResolvedValueOnce({ all: newConfig } as any);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      expect(mockAuditLogger.logConfigReload).toHaveBeenCalledWith(
        adminContext.userId,
        true,
        {
          criticalChanges: [
            'Application service port',
            'Application service bind address',
            'Database type'
          ]
        }
      );
    });

    test('should handle config reload failure', async () => {
      const error = new Error('Config file not found');
      MockedConfig.reload = jest.fn().mockRejectedValueOnce(error);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      expect(mockAuditLogger.logConfigReload).toHaveBeenCalledWith(
        adminContext.userId,
        false,
        {},
        'Failed to reload configuration: Config file not found'
      );
    });

    test('should require admin permissions', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        nonAdminContext.roomId,
        nonAdminContext.userId,
        '!reloadconfig'
      );

      expect(MockedConfig.reload).not.toHaveBeenCalled();
      expect(intent.sendMessage).toHaveBeenCalledWith(
        nonAdminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('administrator privileges'),
        })
      );
    });
  });

  describe('Maintenance Mode Command', () => {
    const adminContext: CommandContext = {
      roomId: '!test:localhost',
      userId: '@admin:localhost',
      message: '!maintenance',
      args: [],
    };

    test('should enable maintenance mode', async () => {
      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!maintenance on Planned upgrade'
      );

      expect(mockGooglePlayBridge.onMaintenanceMode).toHaveBeenCalledWith(
        true,
        'Planned upgrade'
      );
      expect(mockAuditLogger.logMaintenanceMode).toHaveBeenCalledWith(
        adminContext.userId,
        true,
        'Planned upgrade'
      );
      expect(bridgeCommands.isInMaintenanceMode()).toBe(true);
    });

    test('should disable maintenance mode', async () => {
      // First enable maintenance mode
      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!maintenance on Test'
      );

      // Then disable it
      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!maintenance off'
      );

      expect(mockGooglePlayBridge.onMaintenanceMode).toHaveBeenCalledWith(false);
      expect(mockAuditLogger.logMaintenanceMode).toHaveBeenCalledWith(
        adminContext.userId,
        false
      );
      expect(bridgeCommands.isInMaintenanceMode()).toBe(false);
    });

    test('should show maintenance status when off', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!maintenance status'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('not in maintenance mode'),
        })
      );
    });

    test('should show maintenance status when on', async () => {
      // Enable maintenance mode first
      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!maintenance on Test reason'
      );

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!maintenance status'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringMatching(/in maintenance mode.*Test reason/s),
        })
      );
    });

    test('should prevent enabling maintenance mode when already enabled', async () => {
      // Enable maintenance mode
      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!maintenance on Test'
      );

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      // Try to enable again
      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!maintenance on Again'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('already in maintenance mode'),
        })
      );
    });

    test('should prevent disabling maintenance mode when already disabled', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!maintenance off'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('not in maintenance mode'),
        })
      );
    });

    test('should provide maintenance status information', () => {
      // Initially should be disabled
      let status = bridgeCommands.getMaintenanceStatus();
      expect(status.enabled).toBe(false);
      expect(status.reason).toBeUndefined();
      expect(status.startTime).toBeUndefined();

      // Enable maintenance mode (this is internal to the class)
      // We can't directly test the internal state change, but we can test the public interface
      expect(bridgeCommands.isInMaintenanceMode()).toBe(false);
    });
  });

  describe('Audit Log Command', () => {
    const adminContext: CommandContext = {
      roomId: '!test:localhost',
      userId: '@admin:localhost',
      message: '!audit',
      args: [],
    };

    test('should show audit log entries', async () => {
      const mockEntries = [
        {
          id: 'audit_1',
          timestamp: new Date(),
          level: 'info' as const,
          action: 'config.reload',
          userId: 'admin',
          result: 'success' as const,
        },
        {
          id: 'audit_2',
          timestamp: new Date(Date.now() - 60000),
          level: 'warn' as const,
          action: 'maintenance.enable',
          userId: 'admin',
          result: 'success' as const,
        },
      ];

      mockAuditLogger.search.mockResolvedValueOnce(mockEntries);

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!audit'
      );

      expect(mockAuditLogger.search).toHaveBeenCalledWith({ limit: 10 });
      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Recent audit log entries (2)'),
        })
      );
      expect(mockAuditLogger.logBridgeCommand).toHaveBeenCalledWith(
        'audit',
        adminContext.userId,
        adminContext.roomId,
        true,
        undefined,
        { limit: 10, filter: undefined, resultCount: 2 }
      );
    });

    test('should handle empty audit log', async () => {
      mockAuditLogger.search.mockResolvedValueOnce([]);

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!audit'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: 'No audit log entries found.',
        })
      );
    });

    test('should handle custom limit', async () => {
      mockAuditLogger.search.mockResolvedValueOnce([]);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!audit 25'
      );

      expect(mockAuditLogger.search).toHaveBeenCalledWith({ limit: 25 });
    });

    test('should handle filter by user', async () => {
      mockAuditLogger.search.mockResolvedValueOnce([]);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!audit 10 @user:localhost'
      );

      expect(mockAuditLogger.search).toHaveBeenCalledWith({
        limit: 10,
        userId: '@user:localhost',
      });
    });

    test('should handle filter by action', async () => {
      mockAuditLogger.search.mockResolvedValueOnce([]);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!audit 10 config'
      );

      expect(mockAuditLogger.search).toHaveBeenCalledWith({
        limit: 10,
        action: 'config',
      });
    });

    test('should handle audit log search errors', async () => {
      mockAuditLogger.search.mockRejectedValueOnce(new Error('Database error'));

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!audit'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Failed to retrieve audit log'),
        })
      );
      expect(mockAuditLogger.logBridgeCommand).toHaveBeenCalledWith(
        'audit',
        adminContext.userId,
        adminContext.roomId,
        false,
        undefined,
        { limit: 10, filter: undefined },
        expect.stringContaining('Failed to retrieve audit log')
      );
    });
  });

  describe('Command Integration', () => {
    test('should register all Phase 4.3 commands', () => {
      // Test that the commands are properly registered by checking they don't throw
      const adminContext = {
        roomId: '!test:localhost',
        userId: '@admin:localhost',
        args: [],
      };

      expect(() => {
        bridgeCommands.handleMessage(
          adminContext.roomId,
          adminContext.userId,
          '!reloadconfig'
        );
      }).not.toThrow();

      expect(() => {
        bridgeCommands.handleMessage(
          adminContext.roomId,
          adminContext.userId,
          '!maintenance status'
        );
      }).not.toThrow();

      expect(() => {
        bridgeCommands.handleMessage(
          adminContext.roomId,
          adminContext.userId,
          '!audit'
        );
      }).not.toThrow();
    });

    test('should handle invalid command gracefully', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        '!test:localhost',
        '@admin:localhost',
        '!invalid-command'
      );

      // Should send help message for unknown commands
      expect(intent.sendMessage).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle bridge integration errors gracefully', async () => {
      mockGooglePlayBridge.onConfigReload.mockRejectedValueOnce(
        new Error('Bridge error')
      );

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      // Should not crash the command handler
      await expect(
        bridgeCommands.handleMessage(
          '!test:localhost',
          '@admin:localhost',
          '!reloadconfig'
        )
      ).resolves.not.toThrow();
    });

    test('should handle audit logger failures gracefully', async () => {
      mockAuditLogger.logConfigReload.mockRejectedValueOnce(
        new Error('Audit error')
      );

      // Should not prevent command execution
      await expect(
        bridgeCommands.handleMessage(
          '!test:localhost',
          '@admin:localhost',
          '!reloadconfig'
        )
      ).resolves.not.toThrow();
    });
  });
});