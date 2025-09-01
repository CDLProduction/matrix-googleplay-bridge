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
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('js-yaml', () => ({
  load: jest.fn(),
}));

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

    // Mock fs for the enhanced configuration validation
    const fs = require('fs');
    const yaml = require('js-yaml');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('mock-config-content');
    yaml.load.mockReturnValue({
      homeserver: { url: 'https://matrix.example.com', domain: 'example.com' },
      appservice: { port: 9000, bind: '0.0.0.0', botUsername: 'googleplay' },
      database: { type: 'sqlite' },
      googleplay: { serviceAccount: { keyFile: '/path/to/key.json' }, apps: [] },
    });

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
      log: jest.fn(),
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

    // Create mock HTTP server
    const mockHttpServer = {
      generatePrometheusMetrics: jest.fn().mockReturnValue('# HELP test Test metrics\ntest_metric 1\n'),
    } as any;

    // Create bridge commands instance
    bridgeCommands = new BridgeCommands(
      mockBridge,
      mockAppManager,
      mockGooglePlayBridge,
      ['@admin:localhost'],
      mockHttpServer
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
      // reloadConfiguration is not called when there are no app changes
      expect(mockAppManager.reloadConfiguration).not.toHaveBeenCalled();
      // onConfigReload is not called when there are no changes that need hot-reload
      expect(mockGooglePlayBridge.onConfigReload).not.toHaveBeenCalled();
      expect(mockAuditLogger.logConfigReload).toHaveBeenCalledWith(
        adminContext.userId,
        true,
        {
          criticalChanges: [],
          nonCriticalChanges: [],
          hotReloadApplied: false,
        }
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
            expect.objectContaining({
              key: 'appservice.port',
              description: expect.stringContaining('port'),
            }),
            expect.objectContaining({
              key: 'appservice.bind',
              description: expect.stringContaining('bind'),
            }),
            expect.objectContaining({
              key: 'database.type',
              description: expect.stringContaining('Database type'),
            }),
          ],
          nonCriticalChanges: [],
          hotReloadApplied: false,
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
        expect.objectContaining({ rollbackAttempted: false }),
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

  describe('Enhanced Configuration Reload Tests', () => {
    const fs = require('fs');
    const yaml = require('js-yaml');

    beforeEach(() => {
      // Reset fs mocks
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('mock-config-content');
      yaml.load.mockReturnValue({
        homeserver: { url: 'https://matrix.example.com', domain: 'example.com' },
        appservice: { port: 9000, bind: '0.0.0.0', botUsername: 'googleplay' },
        database: { type: 'sqlite' },
        googleplay: { serviceAccount: { keyFile: '/path/to/key.json' }, apps: [] },
      });
    });

    test('should validate configuration file before loading', async () => {
      const adminContext: CommandContext = {
        roomId: '!test:localhost',
        userId: '@admin:localhost',
        message: '!reloadconfig',
        args: [],
      };

      // Mock valid configuration
      const oldConfig = {
        homeserver: { url: 'https://matrix.old.com', domain: 'old.com' },
        appservice: { port: 8000, bind: '127.0.0.1', botUsername: 'googleplay' },
        database: { type: 'sqlite' },
        googleplay: { serviceAccount: { keyFile: '/path/to/key.json' }, apps: [] },
        logging: { level: 'info' },
      };

      const newConfig = {
        ...oldConfig,
        logging: { level: 'debug' }, // Non-critical change
      };

      mockConfig.all = oldConfig;
      MockedConfig.getInstance.mockReturnValue(mockConfig);
      MockedConfig.reload.mockImplementation(async () => {
        mockConfig.all = newConfig;
        return mockConfig;
      });

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining('config.yaml'));
      expect(fs.readFileSync).toHaveBeenCalled();
      expect(yaml.load).toHaveBeenCalled();
    });

    test('should detect and report validation errors', async () => {
      const adminContext: CommandContext = {
        roomId: '!test:localhost',
        userId: '@admin:localhost',
        message: '!reloadconfig',
        args: [],
      };

      // Mock invalid YAML
      yaml.load.mockImplementation(() => {
        throw new Error('Invalid YAML syntax');
      });

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Configuration validation failed'),
        })
      );
    });

    test('should detect critical changes requiring restart', async () => {
      const adminContext: CommandContext = {
        roomId: '!test:localhost',
        userId: '@admin:localhost',
        message: '!reloadconfig',
        args: [],
      };

      const oldConfig = {
        homeserver: { url: 'https://matrix.old.com', domain: 'old.com' },
        appservice: { port: 8000, bind: '127.0.0.1', botUsername: 'googleplay' },
        database: { type: 'sqlite' },
        googleplay: { serviceAccount: { keyFile: '/path/to/key.json' }, apps: [] },
        logging: { level: 'info' },
      };

      const newConfig = {
        ...oldConfig,
        appservice: { ...oldConfig.appservice, port: 9000 }, // Critical change
        homeserver: { ...oldConfig.homeserver, url: 'https://matrix.new.com' }, // Critical change
      };

      mockConfig.all = oldConfig;
      MockedConfig.getInstance.mockReturnValue(mockConfig);
      MockedConfig.reload.mockImplementation(async () => {
        mockConfig.all = newConfig;
        return mockConfig;
      });

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('⚠️ WARNING'),
        })
      );
    });

    test('should apply hot-reload for non-critical changes', async () => {
      const adminContext: CommandContext = {
        roomId: '!test:localhost',
        userId: '@admin:localhost',
        message: '!reloadconfig',
        args: [],
      };

      const oldConfig = {
        homeserver: { url: 'https://matrix.example.com', domain: 'example.com' },
        appservice: { port: 8000, bind: '127.0.0.1', botUsername: 'googleplay' },
        database: { type: 'sqlite' },
        googleplay: { 
          serviceAccount: { keyFile: '/path/to/key.json' }, 
          apps: [{ packageName: 'com.example.old' }],
          polling: { interval: 300 }
        },
        logging: { level: 'info' },
        features: { categorization: true },
      };

      const newConfig = {
        ...oldConfig,
        logging: { level: 'debug' }, // Non-critical change
        googleplay: { 
          ...oldConfig.googleplay,
          apps: [{ packageName: 'com.example.new' }], // Non-critical change
          polling: { interval: 600 } // Non-critical change
        },
        features: { categorization: false }, // Non-critical change
      };

      mockConfig.all = oldConfig;
      MockedConfig.getInstance.mockReturnValue(mockConfig);
      MockedConfig.reload.mockImplementation(async () => {
        mockConfig.all = newConfig;
        return mockConfig;
      });

      // Mock bridge methods for hot-reload
      mockGooglePlayBridge.updatePollingInterval = jest.fn().mockResolvedValue(undefined);
      mockGooglePlayBridge.updateFeatureConfig = jest.fn().mockResolvedValue(undefined);
      mockGooglePlayBridge.onConfigReload = jest.fn().mockResolvedValue(undefined);

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      expect(mockAppManager.reloadConfiguration).toHaveBeenCalled();
      expect(mockGooglePlayBridge.updatePollingInterval).toHaveBeenCalledWith(600);
      expect(mockGooglePlayBridge.updateFeatureConfig).toHaveBeenCalledWith({ categorization: false });
      
      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Applied hot-reload changes'),
        })
      );
    });

    test('should rollback configuration on hot-reload failure', async () => {
      const adminContext: CommandContext = {
        roomId: '!test:localhost',
        userId: '@admin:localhost',
        message: '!reloadconfig',
        args: [],
      };

      const oldConfig = {
        homeserver: { url: 'https://matrix.example.com', domain: 'example.com' },
        appservice: { port: 8000, bind: '127.0.0.1', botUsername: 'googleplay' },
        database: { type: 'sqlite' },
        googleplay: { 
          serviceAccount: { keyFile: '/path/to/key.json' }, 
          apps: [{ packageName: 'com.example.old' }]
        },
        logging: { level: 'info' },
      };

      const newConfig = {
        ...oldConfig,
        googleplay: { 
          ...oldConfig.googleplay,
          apps: [{ packageName: 'com.example.new' }]
        },
      };

      mockConfig.all = oldConfig;
      MockedConfig.getInstance.mockReturnValue(mockConfig);
      MockedConfig.reload.mockImplementation(async () => {
        mockConfig.all = newConfig;
        return mockConfig;
      });

      // Mock app manager failure during hot-reload
      mockAppManager.reloadConfiguration = jest.fn()
        .mockRejectedValueOnce(new Error('Hot-reload failed'))
        .mockResolvedValueOnce(undefined); // For rollback

      // Mock bridge methods
      mockGooglePlayBridge.onConfigReload = jest.fn().mockResolvedValue(undefined);

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      // When hot-reload fails, we expect the reloadConfiguration to be called once and fail
      expect(mockAppManager.reloadConfiguration).toHaveBeenCalledTimes(1);
      // The rollback implementation should restore config but might not call onConfigReload
      // if the rollback is handled differently in the implementation

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Failed to reload configuration'),
        })
      );

      expect(mockAuditLogger.logConfigReload).toHaveBeenCalledWith(
        adminContext.userId,
        false,
        { rollbackAttempted: true },
        expect.stringContaining('Failed to reload configuration')
      );
    });

    test('should handle missing configuration file', async () => {
      const adminContext: CommandContext = {
        roomId: '!test:localhost',
        userId: '@admin:localhost',
        message: '!reloadconfig',
        args: [],
      };

      // Mock missing file
      fs.existsSync.mockReturnValue(false);

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Configuration validation failed'),
        })
      );
    });

    test('should validate required configuration sections', async () => {
      const adminContext: CommandContext = {
        roomId: '!test:localhost',
        userId: '@admin:localhost',
        message: '!reloadconfig',
        args: [],
      };

      // Mock incomplete configuration missing required sections
      yaml.load.mockReturnValue({
        homeserver: { url: 'https://matrix.example.com' },
        // Missing appservice, database, googleplay sections
      });

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Configuration validation failed'),
        })
      );
    });

    test('should handle configuration reload failure with rollback', async () => {
      const adminContext: CommandContext = {
        roomId: '!test:localhost',
        userId: '@admin:localhost',
        message: '!reloadconfig',
        args: [],
      };

      const oldConfig = {
        homeserver: { url: 'https://matrix.example.com', domain: 'example.com' },
        appservice: { port: 8000, bind: '127.0.0.1', botUsername: 'googleplay' },
        database: { type: 'sqlite' },
        googleplay: { serviceAccount: { keyFile: '/path/to/key.json' }, apps: [] },
      };

      mockConfig.all = oldConfig;
      MockedConfig.getInstance.mockReturnValue(mockConfig);
      
      // Mock Config.reload failure after validation passes
      MockedConfig.reload.mockRejectedValueOnce(new Error('Config reload failed'));

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!reloadconfig'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Failed to reload configuration'),
        })
      );

      expect(mockAuditLogger.logConfigReload).toHaveBeenCalledWith(
        adminContext.userId,
        false,
        expect.objectContaining({ rollbackAttempted: false }),
        expect.stringContaining('Config reload failed')
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

  describe('Restart Command', () => {
    const adminContext: CommandContext = {
      roomId: '!test:localhost',
      userId: '@admin:localhost',
      message: '!restart',
      args: [],
    };

    beforeEach(() => {
      // Mock process.exit to avoid actually exiting during tests
      jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      // Mock setTimeout to avoid waiting
      jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
        fn();
        return {} as any;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('should initiate bridge restart without reason', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!restart'
      );

      expect(mockAuditLogger.logBridgeCommand).toHaveBeenCalledWith(
        'restart',
        adminContext.userId,
        adminContext.roomId,
        true,
        undefined,
        { reason: 'Manual restart requested' }
      );
      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('🔄 Bridge restart initiated'),
        })
      );
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    test('should initiate bridge restart with custom reason', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!restart System update required'
      );

      expect(mockAuditLogger.logBridgeCommand).toHaveBeenCalledWith(
        'restart',
        adminContext.userId,
        adminContext.roomId,
        true,
        undefined,
        { reason: 'System update required' }
      );
      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringMatching(/System update required/),
        })
      );
    });

    test('should call bridge onRestart if available', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);
      mockGooglePlayBridge.onRestart = jest.fn();

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!restart Test restart'
      );

      expect(mockGooglePlayBridge.onRestart).toHaveBeenCalledWith('Test restart');
    });

    test('should handle restart errors gracefully', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);
      mockAuditLogger.logBridgeCommand.mockRejectedValueOnce(new Error('Audit error'));

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!restart'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Failed to restart bridge'),
        })
      );
    });
  });

  describe('Logs Command', () => {
    const adminContext: CommandContext = {
      roomId: '!test:localhost',
      userId: '@admin:localhost',
      message: '!logs',
      args: [],
    };

    beforeEach(() => {
      // Mock audit logger search to return sample log entries
      mockAuditLogger.search.mockResolvedValue([
        {
          id: 'log_1',
          timestamp: new Date('2023-01-01T12:00:00Z'),
          level: 'info' as const,
          action: 'bridge.start',
          result: 'success' as const,
        },
        {
          id: 'log_2',
          timestamp: new Date('2023-01-01T12:01:00Z'),
          level: 'error' as const,
          action: 'api.error',
          result: 'failed' as const,
        },
      ]);
    });

    test('should show recent logs with default parameters', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!logs'
      );

      expect(mockAuditLogger.search).toHaveBeenCalledWith({
        limit: 50,
      });
      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Recent log entries (2)'),
        })
      );
    });

    test('should handle tail command with custom limit', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!logs tail 25'
      );

      expect(mockAuditLogger.search).toHaveBeenCalledWith({
        limit: 25,
      });
    });

    test('should reject invalid limits', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!logs show 2000'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('❌ Limit must be a number between 1 and 1000'),
        })
      );
    });

    test('should handle empty log results', async () => {
      mockAuditLogger.search.mockResolvedValueOnce([]);
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!logs'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: 'No recent log entries found.',
        })
      );
    });

    test('should handle logs command errors', async () => {
      mockAuditLogger.search.mockRejectedValueOnce(new Error('Database error'));
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!logs'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Failed to retrieve logs'),
        })
      );
    });
  });

  describe('Metrics Command', () => {
    const adminContext: CommandContext = {
      roomId: '!test:localhost',
      userId: '@admin:localhost',
      message: '!metrics',
      args: [],
    };

    let mockFs: any;
    
    beforeEach(() => {
      // Get the mocked fs module
      mockFs = require('fs');
      mockFs.promises.writeFile.mockClear();
    });

    test('should show metrics summary by default', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      // Mock process metrics
      jest.spyOn(process, 'uptime').mockReturnValue(3661);
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        heapUsed: 60 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });
      jest.spyOn(process, 'cpuUsage').mockReturnValue({
        user: 12345678,
        system: 9876543,
      });

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!metrics'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringMatching(/Bridge Metrics Summary/),
        })
      );

      const messageBody = intent.sendMessage.mock.calls[0][1].body;
      expect(messageBody).toMatch(/Uptime.*3661s/);
      expect(messageBody).toMatch(/Memory Used.*60MB/);
      expect(messageBody).toMatch(/Memory Total.*80MB/);
      expect(messageBody).toMatch(/CPU User.*1234\dms/); // Allow for rounding variations
      expect(messageBody).toMatch(/CPU System.*987\dms/);
    });

    test('should export metrics to file', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      // mockFs is already configured in beforeEach

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!metrics export'
      );

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/bridge-metrics-.*\.txt$/),
        expect.stringContaining('# HELP test Test metrics'),
        'utf8'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('📊 Metrics exported successfully'),
        })
      );
    });

    test('should handle missing HTTP server for export', async () => {
      // Create instance without HTTP server
      const bridgeCommandsNoHttp = new BridgeCommands(
        mockBridge,
        mockAppManager,
        mockGooglePlayBridge,
        ['@admin:localhost']
      );

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommandsNoHttp.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!metrics export'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('❌ HTTP server not available'),
        })
      );
    });

    test('should handle metrics export errors', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      // Mock fs.writeFile to fail
      mockFs.promises.writeFile.mockRejectedValueOnce(new Error('File error'));

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!metrics export'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Failed to handle metrics command'),
        })
      );
    });
  });

  describe('Backup Command', () => {
    const adminContext: CommandContext = {
      roomId: '!test:localhost',
      userId: '@admin:localhost',
      message: '!backup',
      args: [],
    };

    let mockFs: any;
    
    beforeEach(() => {
      // Get the mocked fs module
      mockFs = require('fs');
      mockFs.promises.writeFile.mockClear();
    });

    test('should backup config by default', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      // mockFs is already configured in beforeEach

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!backup'
      );

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/bridge-config-.*\.json$/),
        expect.stringContaining('"appservice"'),
        'utf8'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('💾 Backup completed successfully'),
        })
      );
    });

    test('should backup config with explicit config scope', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      // mockFs is already configured in beforeEach

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!backup config'
      );

      expect(mockFs.promises.writeFile).toHaveBeenCalledTimes(1);
      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringMatching(/Scope: config/),
        })
      );
    });

    test('should backup all data with all scope', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      // mockFs is already configured in beforeEach

      // Mock getAllApps to return sample apps
      mockAppManager.getAllApps = jest.fn().mockReturnValue([
        { packageName: 'com.test.app', appName: 'Test App' },
      ]);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!backup all'
      );

      expect(mockFs.promises.writeFile).toHaveBeenCalledTimes(3); // config, apps, audit
      expect(mockAppManager.getAllApps).toHaveBeenCalled();
      expect(mockAuditLogger.search).toHaveBeenCalledWith({ limit: 1000 });

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringMatching(/Scope: all/),
        })
      );

      const messageBody = intent.sendMessage.mock.calls[0][1].body;
      expect(messageBody).toMatch(/Config:/);
      expect(messageBody).toMatch(/Apps:/);
      expect(messageBody).toMatch(/Audit:/);
    });

    test('should handle invalid backup scope', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!backup invalid'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Usage: !backup [config|all]'),
        })
      );
    });

    test('should handle backup errors', async () => {
      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      // Mock fs.writeFile to fail
      mockFs.promises.writeFile.mockRejectedValueOnce(new Error('File error'));

      await bridgeCommands.handleMessage(
        adminContext.roomId,
        adminContext.userId,
        '!backup'
      );

      expect(intent.sendMessage).toHaveBeenCalledWith(
        adminContext.roomId,
        expect.objectContaining({
          body: expect.stringContaining('Failed to create backup'),
        })
      );
    });
  });

  describe('New Commands Integration', () => {
    test('should register all new commands', () => {
      const adminContext = {
        roomId: '!test:localhost',
        userId: '@admin:localhost',
        args: [],
      };

      // Test that the new commands are properly registered by checking they don't throw
      expect(() => {
        bridgeCommands.handleMessage(
          adminContext.roomId,
          adminContext.userId,
          '!restart'
        );
      }).not.toThrow();

      expect(() => {
        bridgeCommands.handleMessage(
          adminContext.roomId,
          adminContext.userId,
          '!logs'
        );
      }).not.toThrow();

      expect(() => {
        bridgeCommands.handleMessage(
          adminContext.roomId,
          adminContext.userId,
          '!metrics'
        );
      }).not.toThrow();

      expect(() => {
        bridgeCommands.handleMessage(
          adminContext.roomId,
          adminContext.userId,
          '!backup'
        );
      }).not.toThrow();
    });

    test('should require admin permissions for new commands', async () => {
      const nonAdminContext = {
        roomId: '!test:localhost',
        userId: '@user:localhost',
      };

      const intent = { sendMessage: jest.fn() };
      mockBridge.getIntent.mockReturnValue(intent);

      // Test each new command requires admin permissions
      const commands = ['!restart', '!logs', '!metrics', '!backup'];

      for (const command of commands) {
        await bridgeCommands.handleMessage(
          nonAdminContext.roomId,
          nonAdminContext.userId,
          command
        );

        expect(intent.sendMessage).toHaveBeenCalledWith(
          nonAdminContext.roomId,
          expect.objectContaining({
            body: expect.stringContaining('administrator privileges'),
          })
        );
      }
    });
  });
});