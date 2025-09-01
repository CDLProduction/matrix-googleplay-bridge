import { MatrixHandler, MatrixHandlerOptions } from '../../src/bridge/MatrixHandler';
import { Bridge, WeakEvent, Request } from 'matrix-appservice-bridge';
import { UserManager } from '../../src/models/User';
import { RoomManager } from '../../src/models/Room';
import { MessageManager, GooglePlayReview } from '../../src/models/Message';
import { Config } from '../../src/utils/Config';

// Mock all dependencies
jest.mock('matrix-appservice-bridge');
jest.mock('../../src/models/User');
jest.mock('../../src/models/Room');
jest.mock('../../src/models/Message');
jest.mock('../../src/utils/Config');
jest.mock('../../src/utils/Logger', () => ({
  Logger: {
    getInstance: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    })),
  },
}));

// Get the mocked logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const MockedLogger = require('../../src/utils/Logger').Logger;
MockedLogger.getInstance.mockReturnValue(mockLogger);

describe('MatrixHandler', () => {
  let matrixHandler: MatrixHandler;
  let mockBridge: jest.Mocked<Bridge>;
  let mockUserManager: jest.Mocked<UserManager>;
  let mockRoomManager: jest.Mocked<RoomManager>;
  let mockMessageManager: jest.Mocked<MessageManager>;
  let mockConfig: jest.Mocked<Config>;
  let mockIntent: any;

  beforeEach(() => {
    // Clear all mock calls
    jest.clearAllMocks();
    // Create mock instances
    mockBridge = {
      getIntent: jest.fn(),
    } as any;

    mockIntent = {
      join: jest.fn(),
      sendMessage: jest.fn(),
      getProfileInfo: jest.fn(),
    };

    mockBridge.getIntent.mockReturnValue(mockIntent);

    mockUserManager = {
      isManagedUser: jest.fn(),
      getMatrixUser: jest.fn(),
      getOrCreateMatrixUser: jest.fn(),
      cleanupInactiveUsers: jest.fn(),
      getAllMatrixUsers: jest.fn(),
    } as any;

    mockRoomManager = {
      registerMatrixRoom: jest.fn(),
      markRoomJoined: jest.fn(),
      getRoomMappingByRoomId: jest.fn(),
      canSendReply: jest.fn(),
      getRoomsForApp: jest.fn(),
      shouldForwardReview: jest.fn(),
      getRoomStats: jest.fn(),
    } as any;

    mockMessageManager = {
      storeMatrixMessage: jest.fn(),
      createMessageMapping: jest.fn(),
      getGooglePlayReview: jest.fn(),
      formatReviewForMatrix: jest.fn(),
      formatReplyConfirmation: jest.fn(),
      formatNotification: jest.fn(),
      getMessageStats: jest.fn(),
    } as any;

    mockConfig = {
      homeserver: {
        url: 'https://matrix.example.com',
        domain: 'example.com',
      },
      appservice: {
        botUsername: 'googleplay-bridge',
        port: 8090,
        bind: '0.0.0.0',
        id: 'googleplay-bridge',
        token: 'test-token',
      },
    } as any;

    const options: MatrixHandlerOptions = {
      bridge: mockBridge,
      userManager: mockUserManager,
      roomManager: mockRoomManager,
      messageManager: mockMessageManager,
      config: mockConfig,
    };

    matrixHandler = new MatrixHandler(options);
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      mockIntent.getProfileInfo.mockResolvedValue({ displayname: 'Bot' });

      await matrixHandler.initialize();

      expect(mockIntent.getProfileInfo).toHaveBeenCalledWith('@googleplay-bridge:example.com');
    });

    it('should handle bot registration errors gracefully', async () => {
      mockIntent.getProfileInfo.mockRejectedValue(new Error('Not found'));

      await expect(matrixHandler.initialize()).resolves.not.toThrow();
    });
  });

  describe('handleEvent', () => {
    const createMockRequest = (event: Partial<WeakEvent>): Request<WeakEvent> => {
      return {
        getData: () => event as WeakEvent,
      } as Request<WeakEvent>;
    };

    it('should skip events from bridge bot', async () => {
      const event = {
        type: 'm.room.message',
        sender: '@googleplay-bridge:example.com',
        room_id: '!test:example.com',
      };

      await matrixHandler.handleEvent(createMockRequest(event));

      expect(mockMessageManager.storeMatrixMessage).not.toHaveBeenCalled();
    });

    it('should handle room message events', async () => {
      const event = {
        type: 'm.room.message',
        sender: '@user:example.com',
        room_id: '!test:example.com',
        event_id: '$event123:example.com',
        content: {
          msgtype: 'm.text',
          body: 'Hello world',
        },
        origin_server_ts: 1234567890,
      };

      mockRoomManager.getRoomMappingByRoomId.mockResolvedValue({
        id: 'mapping-123',
        packageName: 'com.example.app',
        matrixRoomId: '!test:example.com',
        appName: 'Example App',
        roomType: 'reviews',
        config: {
          forwardReviews: true,
          allowReplies: true,
          minRatingToForward: 0,
          forwardUpdatesOnly: false,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockRoomManager.canSendReply.mockResolvedValue(true);

      await matrixHandler.handleEvent(createMockRequest(event));

      expect(mockMessageManager.storeMatrixMessage).toHaveBeenCalledWith({
        eventId: '$event123:example.com',
        roomId: '!test:example.com',
        senderId: '@user:example.com',
        content: event.content,
        timestamp: new Date(1234567890),
        isBridgeMessage: false,
      });
    });

    it('should handle member events for bot joins', async () => {
      const event = {
        type: 'm.room.member',
        sender: '@user:example.com',
        room_id: '!test:example.com',
        state_key: '@googleplay-bridge:example.com',
        content: {
          membership: 'join',
        },
      };

      await matrixHandler.handleEvent(createMockRequest(event));

      expect(mockRoomManager.markRoomJoined).toHaveBeenCalledWith('!test:example.com');
    });

    it('should handle bot invitations', async () => {
      const event = {
        type: 'm.room.member',
        sender: '@user:example.com',
        room_id: '!test:example.com',
        state_key: '@googleplay-bridge:example.com',
        content: {
          membership: 'invite',
        },
      };

      mockIntent.join.mockResolvedValue(undefined);
      mockMessageManager.formatNotification.mockReturnValue({
        msgtype: 'm.notice',
        body: 'Welcome message',
      });
      mockIntent.sendMessage.mockResolvedValue('$response:example.com');

      await matrixHandler.handleEvent(createMockRequest(event));

      expect(mockIntent.join).toHaveBeenCalledWith('!test:example.com');
      expect(mockIntent.sendMessage).toHaveBeenCalledWith(
        '!test:example.com',
        expect.objectContaining({ msgtype: 'm.notice' })
      );
    });

    it('should handle room creation events', async () => {
      const event = {
        type: 'm.room.create',
        sender: '@user:example.com',
        room_id: '!newroom:example.com',
        content: {}, // Required by enhanced validation
      };

      await matrixHandler.handleEvent(createMockRequest(event));

      expect(mockRoomManager.registerMatrixRoom).toHaveBeenCalledWith('!newroom:example.com');
    });

    it('should ignore unknown event types', async () => {
      const event = {
        type: 'm.room.unknown',
        sender: '@user:example.com',
        room_id: '!test:example.com',
      };

      await matrixHandler.handleEvent(createMockRequest(event));

      expect(mockMessageManager.storeMatrixMessage).not.toHaveBeenCalled();
    });
  });

  describe('onUserQuery', () => {
    it('should return user data for managed users', async () => {
      const userId = '@googleplay_review123:example.com';
      
      mockUserManager.isManagedUser.mockReturnValue(true);
      mockUserManager.getMatrixUser.mockReturnValue({
        userId,
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
        isVirtual: true,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });

      const result = await matrixHandler.onUserQuery(userId);

      expect(result).toEqual({
        name: 'Test User',
        avatar_url: 'https://example.com/avatar.jpg',
      });
    });

    it('should return null for unmanaged users', async () => {
      const userId = '@user:example.com';
      
      mockUserManager.isManagedUser.mockReturnValue(false);

      const result = await matrixHandler.onUserQuery(userId);

      expect(result).toBeNull();
    });

    it('should return default name for unknown managed users', async () => {
      const userId = '@googleplay_review123:example.com';
      
      mockUserManager.isManagedUser.mockReturnValue(true);
      mockUserManager.getMatrixUser.mockReturnValue(undefined);

      const result = await matrixHandler.onUserQuery(userId);

      expect(result).toEqual({
        name: 'Google Play User review123',
      });
    });

    it('should handle invalid user ID format', async () => {
      const userId = '@invalid:example.com';
      
      mockUserManager.isManagedUser.mockReturnValue(true);

      const result = await matrixHandler.onUserQuery(userId);

      expect(result).toBeNull();
    });
  });

  describe('onRoomQuery', () => {
    it('should return null for all room alias queries', async () => {
      const result = await matrixHandler.onRoomQuery('#test:example.com');

      expect(result).toBeNull();
    });
  });

  describe('sendMessageToRoom', () => {
    it('should send message successfully', async () => {
      const roomId = '!test:example.com';
      const content = { msgtype: 'm.text', body: 'Test message' };

      mockIntent.sendMessage.mockResolvedValue('$event123:example.com');

      const result = await matrixHandler.sendMessageToRoom(roomId, content);

      expect(mockIntent.sendMessage).toHaveBeenCalledWith(roomId, content);
      expect(result).toBe('$event123:example.com');
    });

    it('should handle send message errors', async () => {
      const roomId = '!test:example.com';
      const content = { msgtype: 'm.text', body: 'Test message' };

      mockIntent.sendMessage.mockRejectedValue(new Error('Send failed'));

      const result = await matrixHandler.sendMessageToRoom(roomId, content);

      expect(result).toBeNull();
    });

    it('should handle response object format', async () => {
      const roomId = '!test:example.com';
      const content = { msgtype: 'm.text', body: 'Test message' };

      mockIntent.sendMessage.mockResolvedValue({ event_id: '$event123:example.com' });

      const result = await matrixHandler.sendMessageToRoom(roomId, content);

      expect(result).toBe('$event123:example.com');
    });
  });

  describe('sendReviewToMatrix', () => {
    it('should send review to configured rooms', async () => {
      const reviewId = 'review-123';
      const packageName = 'com.example.app';

      const mockReview: GooglePlayReview = {
        reviewId,
        packageName,
        authorName: 'Test User',
        starRating: 5,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false,
      };

      const mockRooms = [
        {
          packageName,
          matrixRoomId: '!room1:example.com',
          appName: 'Example App',
          roomType: 'reviews' as const,
          config: {
            forwardReviews: true,
            allowReplies: true,
            minRatingToForward: 0,
            forwardUpdatesOnly: false,
          },
          isPrimary: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockMessageManager.getGooglePlayReview.mockReturnValue(mockReview);
      mockRoomManager.getRoomsForApp.mockResolvedValue(mockRooms);
      mockRoomManager.shouldForwardReview.mockResolvedValue(true);
      mockMessageManager.formatReviewForMatrix.mockReturnValue({
        msgtype: 'm.text',
        body: 'Review message',
      });
      mockIntent.sendMessage.mockResolvedValue('$event123:example.com');

      await matrixHandler.sendReviewToMatrix(reviewId, packageName);

      expect(mockMessageManager.getGooglePlayReview).toHaveBeenCalledWith(reviewId);
      expect(mockRoomManager.getRoomsForApp).toHaveBeenCalledWith(packageName);
      expect(mockIntent.sendMessage).toHaveBeenCalledWith('!room1:example.com', expect.any(Object));
      expect(mockMessageManager.createMessageMapping).toHaveBeenCalledWith(
        reviewId,
        '$event123:example.com',
        '!room1:example.com',
        'review',
        packageName
      );
    });

    it('should handle missing review', async () => {
      const reviewId = 'nonexistent';
      const packageName = 'com.example.app';

      mockMessageManager.getGooglePlayReview.mockReturnValue(undefined);

      await matrixHandler.sendReviewToMatrix(reviewId, packageName);

      expect(mockRoomManager.getRoomsForApp).not.toHaveBeenCalled();
    });

    it('should handle no configured rooms', async () => {
      const reviewId = 'review-123';
      const packageName = 'com.example.app';

      const mockReview: GooglePlayReview = {
        reviewId,
        packageName,
        authorName: 'Test User',
        starRating: 5,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false,
      };

      mockMessageManager.getGooglePlayReview.mockReturnValue(mockReview);
      mockRoomManager.getRoomsForApp.mockResolvedValue([]);

      await matrixHandler.sendReviewToMatrix(reviewId, packageName);

      expect(mockMessageManager.formatReviewForMatrix).not.toHaveBeenCalled();
    });

    it('should skip rooms that should not forward review', async () => {
      const reviewId = 'review-123';
      const packageName = 'com.example.app';

      const mockReview: GooglePlayReview = {
        reviewId,
        packageName,
        authorName: 'Test User',
        starRating: 2,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false,
      };

      const mockRooms = [
        {
          packageName,
          matrixRoomId: '!room1:example.com',
          appName: 'Example App',
          roomType: 'reviews' as const,
          config: {
            forwardReviews: true,
            allowReplies: true,
            minRatingToForward: 3,
            forwardUpdatesOnly: false,
          },
          isPrimary: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockMessageManager.getGooglePlayReview.mockReturnValue(mockReview);
      mockRoomManager.getRoomsForApp.mockResolvedValue(mockRooms);
      mockRoomManager.shouldForwardReview.mockResolvedValue(false);

      await matrixHandler.sendReviewToMatrix(reviewId, packageName);

      expect(mockIntent.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('createVirtualUser', () => {
    it('should create virtual user', async () => {
      const reviewId = 'review-123';
      const authorName = 'Test User';

      mockUserManager.getOrCreateMatrixUser.mockResolvedValue({
        userId: `@googleplay_${reviewId}:example.com`,
        displayName: authorName,
        isVirtual: true,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });

      await matrixHandler.createVirtualUser(reviewId, authorName);

      expect(mockUserManager.getOrCreateMatrixUser).toHaveBeenCalledWith(
        reviewId,
        authorName,
        'example.com'
      );
    });
  });

  describe('getBridgeStats', () => {
    it('should return bridge statistics', () => {
      mockRoomManager.getRoomStats.mockReturnValue({
        totalRooms: 5,
        bridgeJoinedRooms: 3,
        totalAppMappings: 2,
        totalRoomMappings: 4,
      });

      mockUserManager.getAllMatrixUsers.mockReturnValue([
        {
          userId: '@googleplay_123:example.com',
          displayName: 'User 1',
          isVirtual: true,
          createdAt: new Date(),
          lastActiveAt: new Date(),
        },
        {
          userId: '@googleplay_456:example.com',
          displayName: 'User 2',
          isVirtual: true,
          createdAt: new Date(),
          lastActiveAt: new Date(),
        },
      ]);

      mockMessageManager.getMessageStats.mockReturnValue({
        totalReviews: 10,
        reviewsWithReplies: 5,
        totalMappings: 8,
        totalMatrixMessages: 15,
      });

      const stats = matrixHandler.getBridgeStats();

      expect(stats).toEqual({
        connectedRooms: 3,
        virtualUsers: 2,
        messagesSent: 15,
      });
    });
  });

  describe('shutdown', () => {
    it('should cleanup resources on shutdown', async () => {
      await matrixHandler.shutdown();

      expect(mockUserManager.cleanupInactiveUsers).toHaveBeenCalled();
    });
  });
});