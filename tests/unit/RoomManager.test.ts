import { RoomManager } from '../../src/models/Room';

describe('RoomManager', () => {
  let roomManager: RoomManager;

  beforeEach(() => {
    roomManager = new RoomManager();
  });

  describe('registerMatrixRoom', () => {
    it('should register a new room', async () => {
      const roomId = '!test:example.com';
      const name = 'Test Room';
      const topic = 'Test room topic';

      const room = await roomManager.registerMatrixRoom(roomId, name, topic);

      expect(room.roomId).toBe(roomId);
      expect(room.name).toBe(name);
      expect(room.topic).toBe(topic);
      expect(room.isBridgeJoined).toBe(false);
      expect(room.createdAt).toBeDefined();
    });

    it('should update existing room', async () => {
      const roomId = '!test:example.com';
      const name1 = 'Test Room 1';
      const name2 = 'Test Room 2';

      // Create room first
      await roomManager.registerMatrixRoom(roomId, name1);
      
      // Update the same room
      const updatedRoom = await roomManager.registerMatrixRoom(roomId, name2);

      expect(updatedRoom.name).toBe(name2);
    });
  });

  describe('createAppRoomMapping', () => {
    it('should create app room mapping', async () => {
      const packageName = 'com.example.app';
      const appName = 'Example App';
      const roomId = '!test:example.com';

      const appRoom = await roomManager.createAppRoomMapping(
        packageName,
        appName,
        roomId,
        true
      );

      expect(appRoom.packageName).toBe(packageName);
      expect(appRoom.appName).toBe(appName);
      expect(appRoom.matrixRoomId).toBe(roomId);
      expect(appRoom.isPrimary).toBe(true);
    });

    it('should update existing mapping', async () => {
      const packageName = 'com.example.app';
      const appName1 = 'Example App 1';
      const appName2 = 'Example App 2';
      const roomId = '!test:example.com';

      // Create mapping first
      await roomManager.createAppRoomMapping(packageName, appName1, roomId);
      
      // Update the same mapping
      const updatedMapping = await roomManager.createAppRoomMapping(packageName, appName2, roomId);

      expect(updatedMapping.appName).toBe(appName2);
    });
  });

  describe('createRoomMapping', () => {
    it('should create room mapping with default config', async () => {
      const packageName = 'com.example.app';
      const roomId = '!test:example.com';
      const appName = 'Example App';

      const mapping = await roomManager.createRoomMapping(
        packageName,
        roomId,
        appName
      );

      expect(mapping.packageName).toBe(packageName);
      expect(mapping.matrixRoomId).toBe(roomId);
      expect(mapping.appName).toBe(appName);
      expect(mapping.roomType).toBe('reviews');
      expect(mapping.config.forwardReviews).toBe(true);
      expect(mapping.config.allowReplies).toBe(true);
      expect(mapping.config.minRatingToForward).toBe(0);
    });

    it('should create room mapping with custom config', async () => {
      const packageName = 'com.example.app';
      const roomId = '!test:example.com';
      const appName = 'Example App';
      const customConfig = {
        forwardReviews: false,
        minRatingToForward: 3,
      };

      const mapping = await roomManager.createRoomMapping(
        packageName,
        roomId,
        appName,
        'admin',
        customConfig
      );

      expect(mapping.roomType).toBe('admin');
      expect(mapping.config.forwardReviews).toBe(false);
      expect(mapping.config.minRatingToForward).toBe(3);
      expect(mapping.config.allowReplies).toBe(true); // Should keep default
    });
  });

  describe('shouldForwardReview', () => {
    beforeEach(async () => {
      // Set up a room mapping for testing
      await roomManager.createRoomMapping(
        'com.example.app',
        '!test:example.com',
        'Example App',
        'reviews',
        { minRatingToForward: 3 }
      );
    });

    it('should forward high-rated reviews', async () => {
      const shouldForward = await roomManager.shouldForwardReview(
        'com.example.app',
        '!test:example.com',
        4
      );
      expect(shouldForward).toBe(true);
    });

    it('should not forward low-rated reviews when threshold set', async () => {
      const shouldForward = await roomManager.shouldForwardReview(
        'com.example.app',
        '!test:example.com',
        2
      );
      expect(shouldForward).toBe(false);
    });

    it('should forward reviews with no rating when no rating provided', async () => {
      const shouldForward = await roomManager.shouldForwardReview(
        'com.example.app',
        '!test:example.com'
      );
      expect(shouldForward).toBe(true);
    });

    it('should not forward to unmapped rooms', async () => {
      const shouldForward = await roomManager.shouldForwardReview(
        'com.example.app',
        '!unmapped:example.com',
        5
      );
      expect(shouldForward).toBe(false);
    });
  });

  describe('canSendReply', () => {
    it('should return true for rooms that allow replies', async () => {
      await roomManager.createRoomMapping(
        'com.example.app',
        '!test:example.com',
        'Example App',
        'reviews',
        { allowReplies: true }
      );

      const canReply = await roomManager.canSendReply('!test:example.com');
      expect(canReply).toBe(true);
    });

    it('should return false for rooms that do not allow replies', async () => {
      await roomManager.createRoomMapping(
        'com.example.app',
        '!test:example.com',
        'Example App',
        'reviews',
        { allowReplies: false }
      );

      const canReply = await roomManager.canSendReply('!test:example.com');
      expect(canReply).toBe(false);
    });

    it('should return false for unmapped rooms', async () => {
      const canReply = await roomManager.canSendReply('!unmapped:example.com');
      expect(canReply).toBe(false);
    });
  });

  describe('getPrimaryRoomForApp', () => {
    it('should return primary room for app', async () => {
      const packageName = 'com.example.app';
      const roomId = '!primary:example.com';
      
      await roomManager.createAppRoomMapping(packageName, 'App', roomId, true);
      
      const primaryRoom = await roomManager.getPrimaryRoomForApp(packageName);
      
      expect(primaryRoom?.matrixRoomId).toBe(roomId);
      expect(primaryRoom?.isPrimary).toBe(true);
    });

    it('should return undefined for app with no rooms', async () => {
      const primaryRoom = await roomManager.getPrimaryRoomForApp('com.nonexistent.app');
      expect(primaryRoom).toBeUndefined();
    });
  });

  describe('getRoomStats', () => {
    it('should return correct statistics', async () => {
      // Create some rooms and mappings
      await roomManager.registerMatrixRoom('!room1:example.com');
      await roomManager.registerMatrixRoom('!room2:example.com');
      await roomManager.markRoomJoined('!room1:example.com');
      
      await roomManager.createAppRoomMapping('com.app1', 'App 1', '!room1:example.com');
      await roomManager.createRoomMapping('com.app1', '!room1:example.com', 'App 1');

      const stats = roomManager.getRoomStats();

      expect(stats.totalRooms).toBe(2);
      expect(stats.bridgeJoinedRooms).toBe(1);
      expect(stats.totalAppMappings).toBe(1);
      expect(stats.totalRoomMappings).toBe(1);
    });
  });

  describe('updateRoomMappingConfig', () => {
    it('should update room mapping configuration', async () => {
      const roomId = '!test:example.com';
      
      // Create initial mapping
      await roomManager.createRoomMapping('com.example.app', roomId, 'App');
      
      // Update configuration
      const success = await roomManager.updateRoomMappingConfig(roomId, {
        minRatingToForward: 4,
        forwardReviews: false,
      });

      expect(success).toBe(true);

      // Verify updates
      const mapping = await roomManager.getRoomMappingByRoomId(roomId);
      expect(mapping?.config.minRatingToForward).toBe(4);
      expect(mapping?.config.forwardReviews).toBe(false);
    });

    it('should return false for non-existent room', async () => {
      const success = await roomManager.updateRoomMappingConfig('!nonexistent:example.com', {
        minRatingToForward: 4,
      });

      expect(success).toBe(false);
    });
  });
});