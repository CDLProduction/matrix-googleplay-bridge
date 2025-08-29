/**
 * Integration tests for Phase 3.2: Matrix to Google Play flow
 */

import { MatrixHandler, MatrixHandlerOptions } from '../../src/bridge/MatrixHandler';
import { Bridge, WeakEvent } from 'matrix-appservice-bridge';
import { UserManager } from '../../src/models/User';
import { RoomManager } from '../../src/models/Room';
import { MessageManager, GooglePlayReview } from '../../src/models/Message';
import { Config } from '../../src/utils/Config';

// Mock dependencies
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
  }
}));

describe('Phase 3.2: Matrix to Google Play Flow', () => {
  let matrixHandler: MatrixHandler;
  let mockBridge: jest.Mocked<Bridge>;
  let mockUserManager: jest.Mocked<UserManager>;
  let mockRoomManager: jest.Mocked<RoomManager>;
  let mockMessageManager: jest.Mocked<MessageManager>;
  let mockConfig: Config;
  let mockIntent: any;
  let mockBridgeReplyHandler: jest.Mock;

  const mockReview: GooglePlayReview = {
    reviewId: 'review-123',
    packageName: 'com.test.app',
    authorName: 'Test User',
    text: 'Great app!',
    starRating: 5,
    createdAt: new Date('2023-01-01T12:00:00Z'),
    lastModifiedAt: new Date('2023-01-01T12:00:00Z'),
    hasReply: false
  };

  beforeEach(() => {
    mockBridgeReplyHandler = jest.fn().mockResolvedValue(undefined);

    // Create mock intent
    mockIntent = {
      sendMessage: jest.fn().mockResolvedValue({ event_id: 'test-event-id' }),
      getStateEvent: jest.fn().mockResolvedValue({
        users: { '@admin:localhost': 100 },
        users_default: 0,
        kick: 50
      })
    };

    // Create mock bridge with reply handler
    mockBridge = {
      getIntent: jest.fn().mockReturnValue(mockIntent),
      opts: {
        controller: {
          onBridgeReply: mockBridgeReplyHandler
        }
      }
    } as any;

    // Create mock managers
    mockUserManager = {
      getAllMatrixUsers: jest.fn().mockReturnValue([])
    } as any;

    mockRoomManager = {
      getRoomMappingByRoomId: jest.fn().mockResolvedValue({
        packageName: 'com.test.app',
        matrixRoomId: '!test:localhost',
        appName: 'Test App',
        roomType: 'reviews'
      }),
      canSendReply: jest.fn().mockResolvedValue(true)
    } as any;

    mockMessageManager = {
      storeMatrixMessage: jest.fn().mockResolvedValue(undefined),
      getGooglePlayReview: jest.fn().mockReturnValue(mockReview),
      createMessageMapping: jest.fn().mockResolvedValue(undefined),
      getMessageMappingByMatrixEventId: jest.fn().mockReturnValue({
        googlePlayReviewId: 'review-123',
        matrixEventId: '$original-event',
        matrixRoomId: '!test:localhost',
        messageType: 'review',
        packageName: 'com.test.app',
        createdAt: new Date()
      }),
      getMessageMappingsByRoom: jest.fn().mockReturnValue([
        {
          googlePlayReviewId: 'review-123',
          matrixEventId: '$recent-event',
          matrixRoomId: '!test:localhost',
          messageType: 'review',
          packageName: 'com.test.app',
          createdAt: new Date()
        }
      ]),
      formatNotification: jest.fn().mockImplementation((text) => ({
        msgtype: 'm.notice',
        body: text
      })),
      formatErrorMessage: jest.fn().mockImplementation((text) => ({
        msgtype: 'm.notice',
        body: text
      }))
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

  describe('Message Event Processing', () => {
    test('should filter and store Matrix messages correctly', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'reply: Thanks for the feedback!'
        },
        origin_server_ts: Date.now()
      };

      // This is testing the private handleRoomMessage method through handleEvent
      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.storeMatrixMessage).toHaveBeenCalledWith({
        eventId: '$test-event',
        roomId: '!test:localhost',
        senderId: '@user:localhost',
        content: event.content,
        timestamp: expect.any(Date),
        isBridgeMessage: false
      });
    });

    test('should ignore messages from bridge bot', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@googleplay:localhost', // Bot user
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'Bot message'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      // Should not store bot messages
      expect(mockMessageManager.storeMatrixMessage).not.toHaveBeenCalled();
    });

    test('should ignore messages in unmapped rooms', async () => {
      mockRoomManager.getRoomMappingByRoomId.mockResolvedValue(undefined);

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!unmapped:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'reply: Test message'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockBridgeReplyHandler).not.toHaveBeenCalled();
    });

    test('should ignore messages in rooms without reply permission', async () => {
      mockRoomManager.canSendReply.mockResolvedValue(false);

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'reply: Test message'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockBridgeReplyHandler).not.toHaveBeenCalled();
    });
  });

  describe('Reply Format Detection and Processing', () => {
    test('should handle thread reply format', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'Thanks for the great review!',
          'm.relates_to': {
            'm.in_reply_to': {
              'event_id': '$original-event'
            }
          }
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.getMessageMappingByMatrixEventId).toHaveBeenCalledWith('$original-event');
      expect(mockBridgeReplyHandler).toHaveBeenCalledWith(
        'com.test.app',
        'review-123',
        'Thanks for the great review!',
        '$test-event',
        '!test:localhost',
        '@user:localhost'
      );
    });

    test('should handle command reply format', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!reply review-123 Thanks for the feedback!'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockBridgeReplyHandler).toHaveBeenCalledWith(
        'com.test.app',
        'review-123',
        'Thanks for the feedback!', // extractReplyText extracts only the reply text
        '$test-event',
        '!test:localhost',
        '@user:localhost'
      );
    });

    test('should handle simple prefix reply format', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'reply: Thanks for using our app!'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.getMessageMappingsByRoom).toHaveBeenCalledWith('!test:localhost');
      expect(mockBridgeReplyHandler).toHaveBeenCalledWith(
        'com.test.app',
        'review-123',
        'Thanks for using our app!', // extractReplyText extracts only the reply text
        '$test-event',
        '!test:localhost',
        '@user:localhost'
      );
    });

    test('should ignore messages that do not match reply formats', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'Just a regular message'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockBridgeReplyHandler).not.toHaveBeenCalled();
    });
  });

  describe('Reply Validation and Error Handling', () => {
    test('should validate review exists before processing reply', async () => {
      mockMessageManager.getGooglePlayReview.mockReturnValue(undefined);

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!reply nonexistent-review Thanks!'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
      expect(mockBridgeReplyHandler).not.toHaveBeenCalled();
    });

    test('should validate package name matches before processing reply', async () => {
      const differentPackageReview = {
        ...mockReview,
        packageName: 'com.different.app'
      };
      mockMessageManager.getGooglePlayReview.mockReturnValue(differentPackageReview);

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!reply review-123 Thanks!'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('different app')
      );
      expect(mockBridgeReplyHandler).not.toHaveBeenCalled();
    });

    test('should prevent duplicate replies to same review', async () => {
      const reviewWithReply = { ...mockReview, hasReply: true };
      mockMessageManager.getGooglePlayReview.mockReturnValue(reviewWithReply);

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'reply: Thanks for the review!'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('already has a reply')
      );
      expect(mockBridgeReplyHandler).not.toHaveBeenCalled();
    });

    test('should validate reply text length', async () => {
      const longReply = 'x'.repeat(400); // Exceeds 350 character limit

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: `reply: ${longReply}`
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('too long')
      );
      expect(mockBridgeReplyHandler).not.toHaveBeenCalled();
    });

    test('should reject empty reply text', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'reply: '
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('empty or invalid')
      );
      expect(mockBridgeReplyHandler).not.toHaveBeenCalled();
    });
  });

  describe('Edit and Delete Commands', () => {
    test('should handle edit command for existing replies', async () => {
      const reviewWithReply = { ...mockReview, hasReply: true };
      mockMessageManager.getGooglePlayReview.mockReturnValue(reviewWithReply);

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!edit review-123 Updated reply text'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockBridgeReplyHandler).toHaveBeenCalledWith(
        'com.test.app',
        'review-123',
        'Updated reply text',
        '$test-event',
        '!test:localhost',
        '@user:localhost'
      );
    });

    test('should prevent editing non-existent replies', async () => {
      const reviewWithoutReply = { ...mockReview, hasReply: false };
      mockMessageManager.getGooglePlayReview.mockReturnValue(reviewWithoutReply);

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!edit review-123 Updated text'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('no reply to edit')
      );
      expect(mockBridgeReplyHandler).not.toHaveBeenCalled();
    });

    test('should handle delete command for existing replies', async () => {
      const reviewWithReply = { ...mockReview, hasReply: true };
      mockMessageManager.getGooglePlayReview.mockReturnValue(reviewWithReply);

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!delete review-123'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockBridgeReplyHandler).toHaveBeenCalledWith(
        'com.test.app',
        'review-123',
        '', // Empty text for deletion
        '$test-event',
        '!test:localhost',
        '@user:localhost'
      );
    });

    test('should prevent deleting non-existent replies', async () => {
      const reviewWithoutReply = { ...mockReview, hasReply: false };
      mockMessageManager.getGooglePlayReview.mockReturnValue(reviewWithoutReply);

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!delete review-123'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('no reply to delete')
      );
      expect(mockBridgeReplyHandler).not.toHaveBeenCalled();
    });
  });

  describe('Status Command', () => {
    test('should handle status command for specific reviews', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!status review-123'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.getGooglePlayReview).toHaveBeenCalledWith('review-123');
      expect(mockIntent.sendMessage).toHaveBeenCalledWith(
        '!test:localhost',
        expect.objectContaining({
          body: expect.stringMatching(/Review Status.*review-123.*App.*com\.test\.app.*Rating.*5\/5.*Author.*Test User/s)
        })
      );
    });

    test('should handle status command for non-existent reviews', async () => {
      mockMessageManager.getGooglePlayReview.mockReturnValue(undefined);

      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: '!status nonexistent-review'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.formatErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
    });
  });

  describe('Message Processing Flow Integration', () => {
    test('should create message mappings for successful replies', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'reply: Thank you for the feedback!'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.createMessageMapping).toHaveBeenCalledWith(
        'review-123',
        '$test-event',
        '!test:localhost',
        'reply',
        'com.test.app'
      );
    });

    test('should send status notifications during processing', async () => {
      const event: WeakEvent = {
        type: 'm.room.message',
        room_id: '!test:localhost',
        sender: '@user:localhost',
        event_id: '$test-event',
        content: {
          msgtype: 'm.text',
          body: 'reply: Processing this reply!'
        },
        origin_server_ts: Date.now()
      };

      await matrixHandler.handleEvent({ getData: () => event } as any);

      expect(mockMessageManager.formatNotification).toHaveBeenCalledWith(
        expect.stringContaining('Sending reply to review')
      );
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});