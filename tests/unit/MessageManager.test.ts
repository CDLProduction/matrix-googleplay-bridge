import { MessageManager, GooglePlayReview, DefaultMessageFormatter } from '../../src/models/Message';

describe('MessageManager', () => {
  let messageManager: MessageManager;

  beforeEach(() => {
    messageManager = new MessageManager();
  });

  describe('storeGooglePlayReview', () => {
    it('should store a Google Play review', async () => {
      const review: GooglePlayReview = {
        reviewId: 'test-review-123',
        packageName: 'com.example.app',
        authorName: 'Test User',
        text: 'Great app!',
        starRating: 5,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false,
      };

      await messageManager.storeGooglePlayReview(review);
      const storedReview = messageManager.getGooglePlayReview('test-review-123');

      expect(storedReview).toEqual(review);
    });
  });

  describe('createMessageMapping', () => {
    it('should create a message mapping', async () => {
      const mapping = await messageManager.createMessageMapping(
        'review-123',
        '$event123:example.com',
        '!room:example.com',
        'review',
        'com.example.app'
      );

      expect(mapping.googlePlayReviewId).toBe('review-123');
      expect(mapping.matrixEventId).toBe('$event123:example.com');
      expect(mapping.matrixRoomId).toBe('!room:example.com');
      expect(mapping.messageType).toBe('review');
      expect(mapping.packageName).toBe('com.example.app');
    });

    it('should be retrievable by event ID', async () => {
      const originalMapping = await messageManager.createMessageMapping(
        'review-123',
        '$event123:example.com',
        '!room:example.com',
        'review',
        'com.example.app'
      );

      const retrieved = await messageManager.getMessageMappingByEventId('$event123:example.com');
      expect(retrieved).toEqual(originalMapping);
    });

    it('should be retrievable by review ID', async () => {
      const originalMapping = await messageManager.createMessageMapping(
        'review-123',
        '$event123:example.com',
        '!room:example.com',
        'review',
        'com.example.app'
      );

      const retrieved = await messageManager.getMessageMappingByReviewId('review-123');
      expect(retrieved).toEqual(originalMapping);
    });
  });

  describe('hasReviewBeenSent', () => {
    it('should return true for stored reviews', async () => {
      const review: GooglePlayReview = {
        reviewId: 'test-review-123',
        packageName: 'com.example.app',
        authorName: 'Test User',
        starRating: 5,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false,
      };

      await messageManager.storeGooglePlayReview(review);
      
      const hasBeenSent = await messageManager.hasReviewBeenSent('test-review-123');
      expect(hasBeenSent).toBe(true);
    });

    it('should return false for non-existent reviews', async () => {
      const hasBeenSent = await messageManager.hasReviewBeenSent('non-existent');
      expect(hasBeenSent).toBe(false);
    });
  });

  describe('getMessageStats', () => {
    it('should return correct statistics', async () => {
      // Add some test data
      const review1: GooglePlayReview = {
        reviewId: 'review-1',
        packageName: 'com.example.app',
        authorName: 'User 1',
        starRating: 5,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false,
      };

      const review2: GooglePlayReview = {
        reviewId: 'review-2',
        packageName: 'com.example.app',
        authorName: 'User 2',
        starRating: 3,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: true,
      };

      await messageManager.storeGooglePlayReview(review1);
      await messageManager.storeGooglePlayReview(review2);

      await messageManager.createMessageMapping(
        'review-1',
        '$event1:example.com',
        '!room:example.com',
        'review',
        'com.example.app'
      );

      const stats = messageManager.getMessageStats();

      expect(stats.totalReviews).toBe(2);
      expect(stats.reviewsWithReplies).toBe(1);
      expect(stats.totalMappings).toBe(1);
    });
  });
});

describe('DefaultMessageFormatter', () => {
  let formatter: DefaultMessageFormatter;

  beforeEach(() => {
    formatter = new DefaultMessageFormatter();
  });

  describe('formatReviewForMatrix', () => {
    it('should format a complete review', () => {
      const review: GooglePlayReview = {
        reviewId: 'test-review-123',
        packageName: 'com.example.app',
        authorName: 'John Doe',
        text: 'This is a great app! I love using it.',
        starRating: 5,
        device: 'Pixel 5',
        appVersionName: '1.2.3',
        createdAt: new Date('2023-01-01T12:00:00Z'),
        lastModifiedAt: new Date('2023-01-01T12:00:00Z'),
        hasReply: false,
      };

      const content = formatter.formatReviewForMatrix(review);

      expect(content.msgtype).toBe('m.text');
      expect(content.body).toContain('📱 New Google Play Review');
      expect(content.body).toContain('John Doe');
      expect(content.body).toContain('⭐⭐⭐⭐⭐');
      expect(content.body).toContain('This is a great app!');
      expect(content.body).toContain('Pixel 5');
      expect(content.body).toContain('v1.2.3');
      
      expect(content.formatted_body).toContain('<h3>📱 New Google Play Review');
      expect(content.formatted_body).toContain('<code>com.example.app</code>');
      expect(content.format).toBe('org.matrix.custom.html');
      
      // Check metadata
      expect((content as any)['dev.googleplay.review_id']).toBe('test-review-123');
      expect((content as any)['dev.googleplay.package_name']).toBe('com.example.app');
      expect((content as any)['dev.googleplay.rating']).toBe(5);
    });

    it('should handle review with no text', () => {
      const review: GooglePlayReview = {
        reviewId: 'test-review-123',
        packageName: 'com.example.app',
        authorName: 'John Doe',
        starRating: 3,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false,
      };

      const content = formatter.formatReviewForMatrix(review);

      expect(content.body).toContain('No review text provided.');
    });

    it('should handle different star ratings', () => {
      const review: GooglePlayReview = {
        reviewId: 'test-review-123',
        packageName: 'com.example.app',
        authorName: 'John Doe',
        starRating: 2,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        hasReply: false,
      };

      const content = formatter.formatReviewForMatrix(review);

      expect(content.body).toContain('⭐⭐☆☆☆');
    });
  });

  describe('formatReplyConfirmation', () => {
    it('should format successful reply', () => {
      const content = formatter.formatReplyConfirmation(true);

      expect(content.msgtype).toBe('m.notice');
      expect(content.body).toContain('✅ Reply sent successfully');
      expect(content.formatted_body).toContain('✅');
    });

    it('should format failed reply', () => {
      const content = formatter.formatReplyConfirmation(false, 'API Error');

      expect(content.msgtype).toBe('m.notice');
      expect(content.body).toContain('❌ Failed to send reply');
      expect(content.body).toContain('API Error');
    });
  });

  describe('formatErrorMessage', () => {
    it('should format error message', () => {
      const content = formatter.formatErrorMessage('Something went wrong');

      expect(content.msgtype).toBe('m.notice');
      expect(content.body).toContain('⚠️ Bridge Error: Something went wrong');
      expect(content.formatted_body).toContain('<code>Something went wrong</code>');
    });
  });

  describe('formatNotification', () => {
    it('should format notification message', () => {
      const content = formatter.formatNotification('Bridge connected successfully');

      expect(content.msgtype).toBe('m.notice');
      expect(content.body).toContain('ℹ️ Bridge connected successfully');
    });
  });
});