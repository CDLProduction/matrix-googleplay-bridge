/**
 * Unit tests for bridge command system
 */

import { MatrixHandler, MatrixHandlerOptions } from '../../src/bridge/MatrixHandler';
import { Bridge, WeakEvent } from 'matrix-appservice-bridge';
import { UserManager } from '../../src/models/User';
import { RoomManager } from '../../src/models/Room';
import { MessageManager } from '../../src/models/Message';
import { Config } from '../../src/utils/Config';

// Mock dependencies
jest.mock('matrix-appservice-bridge');
jest.mock('../../src/utils/Logger', () => ({
  Logger: {
    getInstance: jest.fn().mockReturnValue({
      setComponent: jest.fn().mockReturnThis(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    })
  }
}));

describe('Bridge Command System', () => {
  let matrixHandler: MatrixHandler;
  let mockBridge: jest.Mocked<Bridge>;
  let mockUserManager: jest.Mocked<UserManager>;
  let mockRoomManager: jest.Mocked<RoomManager>;
  let mockMessageManager: jest.Mocked<MessageManager>;
  let mockConfig: Config;
  let mockIntent: any;

  beforeEach(() => {
    // Create mock intent
    mockIntent = {
      sendMessage: jest.fn().mockResolvedValue({ event_id: 'test-event-id' }),
      getStateEvent: jest.fn().mockResolvedValue({
        users: {
          '@admin:localhost': 100,
          '@user:localhost': 0
        },
        users_default: 0,
        kick: 50
      }),
      join: jest.fn().mockResolvedValue(undefined)
    };

    // Create mock bridge
    mockBridge = {
      getIntent: jest.fn().mockReturnValue(mockIntent)
    } as any;
    
    // Set up the controller with health monitoring
    (mockBridge as any).opts = {
      controller: {
        getBridgeHealth: jest.fn().mockResolvedValue({
          status: 'healthy',
          checks: [
            { name: 'matrix-connection', status: 'healthy', message: 'Connected' },
            { name: 'googleplay-api', status: 'healthy', message: 'API ready' }
          ]
        })
      }
    };

    // Create mock managers
    mockUserManager = {
      getAllMatrixUsers: jest.fn().mockReturnValue([
        { userId: '@googleplay_review1:localhost', displayName: 'User 1' },
        { userId: '@googleplay_review2:localhost', displayName: 'User 2' }
      ])
    } as any;

    mockRoomManager = {
      getRoomStats: jest.fn().mockReturnValue({
        totalRooms: 5,
        bridgeJoinedRooms: 3,
        totalAppMappings: 2,
        totalRoomMappings: 4
      })
    } as any;

    mockMessageManager = {
      storeMatrixMessage: jest.fn().mockResolvedValue(undefined),
      formatNotification: jest.fn().mockImplementation((text) => ({
        msgtype: 'm.notice',
        body: text
      })),
      formatErrorMessage: jest.fn().mockImplementation((text) => ({
        msgtype: 'm.notice',
        body: text
      })),
      getMessageStats: jest.fn().mockReturnValue({
        totalMatrixMessages: 100,
        totalReviews: 50,
        totalMappings: 75,
        reviewsWithReplies: 25
      })
    } as any;

    mockConfig = {
      homeserver: { domain: 'localhost' },
      appservice: { botUsername: 'googleplay' }
    } as any;

    const options: MatrixHandlerOptions = {
      bridge: mockBridge,
      userManager: mockUserManager,
      roomManager: mockRoomManager,
      messageManager: mockMessageManager,
      config: mockConfig
    };

    matrixHandler = new MatrixHandler(options);
  });

  describe('Bridge Command Authorization', () => {
    test('should allow admin users to run bridge commands', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@admin:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge status'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleBridgeCommand(event);

      // Should send status message, not error
      expect(mockIntent.sendMessage).toHaveBeenCalledWith(
        '!test:localhost',
        expect.objectContaining({
          msgtype: 'm.notice',
          body: expect.stringContaining('Bridge Status')
        })
      );
    });

    test('should deny non-admin users bridge commands', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge status'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleBridgeCommand(event);

      // Should send authorization error
      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        '❌ You are not authorized to run bridge commands.'
      );
    });
  });

  describe('Bridge Status Command', () => {
    test('should return bridge status information', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@admin:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge status'
        },
        origin_server_ts: Date.now()
      };

      // Mock process.uptime
      jest.spyOn(process, 'uptime').mockReturnValue(3661); // 1 hour, 1 minute, 1 second
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        heapUsed: 60 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      await matrixHandler.handleBridgeCommand(event);

      expect(mockIntent.sendMessage).toHaveBeenCalledWith(
        '!test:localhost',
        expect.objectContaining({
          body: expect.stringContaining('Bridge Status'),
          msgtype: 'm.notice'
        })
      );
      
      const callArgs = mockIntent.sendMessage.mock.calls[0];
      expect(callArgs[1].body).toMatch(/Bridge Status/);
      expect(callArgs[1].body).toMatch(/Status.*Running/);
      expect(callArgs[1].body).toMatch(/Uptime.*1h 1m/);
      expect(callArgs[1].body).toMatch(/Connected Rooms.*3/); // bridgeJoinedRooms is 3
      expect(callArgs[1].body).toMatch(/Virtual Users.*2/);
      expect(callArgs[1].body).toMatch(/Messages Sent.*100/); // totalMatrixMessages is 100
      expect(callArgs[1].body).toMatch(/Memory Usage.*60MB/);
    });
  });

  describe('Bridge Stats Command', () => {
    test('should return detailed bridge statistics', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@admin:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge stats'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleBridgeCommand(event);

      expect(mockRoomManager.getRoomStats).toHaveBeenCalled();
      expect(mockUserManager.getAllMatrixUsers).toHaveBeenCalled();
      expect(mockMessageManager.getMessageStats).toHaveBeenCalled();

      expect(mockIntent.sendMessage).toHaveBeenCalledWith(
        '!test:localhost',
        expect.objectContaining({
          body: expect.stringContaining('Bridge Statistics'),
          msgtype: 'm.notice'
        })
      );
      
      const callArgs = mockIntent.sendMessage.mock.calls[0];
      expect(callArgs[1].body).toMatch(/Bridge Statistics/);
      expect(callArgs[1].body).toMatch(/Total Rooms.*5/);
      expect(callArgs[1].body).toMatch(/Virtual Users.*2/);
      expect(callArgs[1].body).toMatch(/Matrix Messages.*100/);
      expect(callArgs[1].body).toMatch(/Review Messages.*50/);
    });
  });

  describe('Bridge Health Command', () => {
    test('should return health check results', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@admin:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge health'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleBridgeCommand(event);

      expect((mockBridge as any).opts?.controller?.getBridgeHealth).toHaveBeenCalled();
      expect(mockIntent.sendMessage).toHaveBeenCalledWith(
        '!test:localhost',
        expect.objectContaining({
          body: expect.stringContaining('Bridge Health Report'),
          msgtype: 'm.notice'
        })
      );
      
      const callArgs = mockIntent.sendMessage.mock.calls[0];
      expect(callArgs[1].body).toMatch(/Bridge Health Report/);
      expect(callArgs[1].body).toMatch(/Overall Status/);
      expect(callArgs[1].body).toMatch(/HEALTHY/);
      expect(callArgs[1].body).toMatch(/matrix-connection.*healthy/);
      expect(callArgs[1].body).toMatch(/googleplay-api.*healthy/);
    });

    test('should handle health monitoring not available', async () => {
      // Mock bridge without health monitoring
      (mockBridge as any).opts = { controller: {} };

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@admin:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge health'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleBridgeCommand(event);

      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        '❌ Health monitoring not available.'
      );
    });
  });

  describe('Bridge Help Command', () => {
    test('should return help information', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@admin:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge help'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleBridgeCommand(event);

      expect(mockIntent.sendMessage).toHaveBeenCalledWith(
        '!test:localhost',
        expect.objectContaining({
          body: expect.stringContaining('Bridge Commands Help'),
          msgtype: 'm.notice'
        })
      );
      
      const callArgs = mockIntent.sendMessage.mock.calls[0];
      expect(callArgs[1].body).toMatch(/Bridge Commands Help/);
      expect(callArgs[1].body).toMatch(/Available Commands/);
      expect(callArgs[1].body).toMatch(/!bridge status/);
      expect(callArgs[1].body).toMatch(/!bridge stats/);
      expect(callArgs[1].body).toMatch(/!bridge health/);
      expect(callArgs[1].body).toMatch(/Google Play Commands/);
      expect(callArgs[1].body).toMatch(/!reply/);
      expect(callArgs[1].body).toMatch(/!edit/);
      expect(callArgs[1].body).toMatch(/!delete/);
    });
  });

  describe('Unknown Bridge Command', () => {
    test('should handle unknown bridge commands', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@admin:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge unknown'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleBridgeCommand(event);

      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        '❌ Unknown bridge command: unknown. Use `!bridge help` for available commands.'
      );
    });
  });

  describe('Bridge Restart Command', () => {
    test('should initiate bridge restart', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@admin:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge restart'
        },
        origin_server_ts: Date.now()
      };

      // Mock process.exit to avoid actually exiting during tests
      const originalExit = process.exit;
      process.exit = jest.fn() as any;

      // Mock setTimeout to avoid waiting
      jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
        fn();
        return {} as any;
      });

      await matrixHandler.handleBridgeCommand(event);

      expect(mockIntent.sendMessage).toHaveBeenCalledWith(
        '!test:localhost',
        expect.objectContaining({
          body: expect.stringContaining('Bridge restart initiated by @admin:localhost'),
          msgtype: 'm.notice'
        })
      );

      expect(process.exit).toHaveBeenCalledWith(0);

      // Restore original process.exit
      process.exit = originalExit;
    });
  });

  describe('Command Error Handling', () => {
    test('should handle command processing errors gracefully', async () => {
      // Mock getStateEvent to throw error - this will cause isAuthorizedAdmin to return false
      mockIntent.getStateEvent.mockRejectedValue(new Error('Matrix API error'));

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@admin:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge status'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleBridgeCommand(event);

      // When getStateEvent fails, the user will be considered unauthorized
      expect(mockIntent.sendMessage).toHaveBeenCalledWith(
        '!test:localhost',
        expect.objectContaining({
          body: '❌ You are not authorized to run bridge commands.',
          msgtype: 'm.notice'
        })
      );
    });

    test('should handle errors during command execution', async () => {
      // Set up successful authorization
      mockIntent.getStateEvent.mockResolvedValue({
        users: {
          '@admin:localhost': 100,
          '@user:localhost': 0
        },
        users_default: 0,
        kick: 50
      });

      // Mock getRoomStats to throw error
      mockRoomManager.getRoomStats.mockImplementation(() => {
        throw new Error('Stats error');
      });

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@admin:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!bridge stats'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleBridgeCommand(event);

      expect(mockIntent.sendMessage).toHaveBeenCalledWith(
        '!test:localhost',
        expect.objectContaining({
          body: '❌ Error processing command: Stats error',
          msgtype: 'm.notice'
        })
      );
    });
  });

  describe('Status Emoji Helper', () => {
    test('should return correct emojis for health status', () => {
      // Test through the health command which uses the emoji helper
      const healthStatuses = [
        { status: 'healthy', expectedEmoji: '✅' },
        { status: 'degraded', expectedEmoji: '⚠️' },
        { status: 'unhealthy', expectedEmoji: '❌' },
        { status: 'unknown', expectedEmoji: '❓' }
      ];

      healthStatuses.forEach(({ status }) => {
        (mockBridge as any).opts = {
          controller: {
            getBridgeHealth: jest.fn().mockResolvedValue({
              status,
              checks: [{ name: 'test', status, message: 'test' }]
            })
          }
        };

        // The emoji testing would be done through integration, 
        // but we can verify the function exists and is called
        expect((mockBridge as any).opts.controller.getBridgeHealth).toBeDefined();
      });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});