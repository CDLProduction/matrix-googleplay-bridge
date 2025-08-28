import { UserManager } from '../../src/models/User';

describe('UserManager', () => {
  let userManager: UserManager;

  beforeEach(() => {
    userManager = new UserManager();
  });

  describe('getOrCreateMatrixUser', () => {
    it('should create a new Matrix user', async () => {
      const reviewId = 'test-review-123';
      const authorName = 'Test User';
      const domain = 'example.com';

      const user = await userManager.getOrCreateMatrixUser(reviewId, authorName, domain);

      expect(user.userId).toBe(`@googleplay_${reviewId}:${domain}`);
      expect(user.displayName).toBe(authorName);
      expect(user.isVirtual).toBe(true);
      expect(user.createdAt).toBeDefined();
      expect(user.lastActiveAt).toBeDefined();
    });

    it('should return existing user and update lastActiveAt', async () => {
      const reviewId = 'test-review-123';
      const authorName = 'Test User';
      const domain = 'example.com';

      // Create user first
      const user1 = await userManager.getOrCreateMatrixUser(reviewId, authorName, domain);
      const firstActiveTime = user1.lastActiveAt;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Get same user again
      const user2 = await userManager.getOrCreateMatrixUser(reviewId, authorName, domain);

      expect(user1.userId).toBe(user2.userId);
      expect(user2.lastActiveAt.getTime()).toBeGreaterThan(firstActiveTime.getTime());
    });

    it('should handle empty author name', async () => {
      const reviewId = 'test-review-123';
      const authorName = '';
      const domain = 'example.com';

      const user = await userManager.getOrCreateMatrixUser(reviewId, authorName, domain);

      expect(user.displayName).toBe(`Google Play User ${reviewId}`);
    });
  });

  describe('createUserMapping', () => {
    it('should create a user mapping', async () => {
      const mapping = await userManager.createUserMapping(
        'review-123',
        '@googleplay_review-123:example.com',
        'Test User',
        'com.example.app'
      );

      expect(mapping.googlePlayReviewId).toBe('review-123');
      expect(mapping.matrixUserId).toBe('@googleplay_review-123:example.com');
      expect(mapping.authorName).toBe('Test User');
      expect(mapping.packageName).toBe('com.example.app');
      expect(mapping.createdAt).toBeDefined();
    });

    it('should be retrievable by review ID', async () => {
      const originalMapping = await userManager.createUserMapping(
        'review-123',
        '@googleplay_review-123:example.com',
        'Test User',
        'com.example.app'
      );

      const retrievedMapping = await userManager.getUserMappingByReviewId('review-123');

      expect(retrievedMapping).toEqual(originalMapping);
    });

    it('should be retrievable by Matrix user ID', async () => {
      const originalMapping = await userManager.createUserMapping(
        'review-123',
        '@googleplay_review-123:example.com',
        'Test User',
        'com.example.app'
      );

      const retrievedMapping = await userManager.getUserMappingByMatrixUserId(
        '@googleplay_review-123:example.com'
      );

      expect(retrievedMapping).toEqual(originalMapping);
    });
  });

  describe('isManagedUser', () => {
    it('should return true for Google Play users', () => {
      const userId = '@googleplay_123:example.com';
      expect(userManager.isManagedUser(userId)).toBe(true);
    });

    it('should return false for regular users', () => {
      const userId = '@user:example.com';
      expect(userManager.isManagedUser(userId)).toBe(false);
    });
  });

  describe('cleanupInactiveUsers', () => {
    it('should remove inactive virtual users', () => {
      // This test would need to be more complex to properly test cleanup
      // For now, just verify the method doesn't throw
      expect(() => userManager.cleanupInactiveUsers(1000)).not.toThrow();
    });
  });

  describe('getAllMatrixUsers', () => {
    it('should return empty array initially', () => {
      expect(userManager.getAllMatrixUsers()).toEqual([]);
    });

    it('should return all created users', async () => {
      await userManager.getOrCreateMatrixUser('review-1', 'User 1', 'example.com');
      await userManager.getOrCreateMatrixUser('review-2', 'User 2', 'example.com');

      const users = userManager.getAllMatrixUsers();
      expect(users).toHaveLength(2);
    });
  });
});