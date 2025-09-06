import { GooglePlayReviewRow } from '../../src/storage/Database';

export interface LoadTestScenario {
  name: string;
  description: string;
  appCount: number;
  reviewsPerPoll: number;
  pollIntervalMs: number;
  durationMs: number;
  concurrency: number;
}

export interface PerformanceMetrics {
  timestamp: number;
  memory: NodeJS.MemoryUsage;
  cpu: NodeJS.CpuUsage;
  throughput: {
    reviewsProcessed: number;
    messagesPerMinute: number;
    databaseOpsPerSecond: number;
  };
  latency: {
    reviewToMatrix: number[];  // Array for percentile calculations
    databaseQuery: number[];
    apiCall: number[];
  };
  errors: {
    apiFailures: number;
    databaseErrors: number;
    processingErrors: number;
  };
}

/**
 * Generates realistic mock review data for performance testing
 */
export class MockReviewGenerator {
  private reviewIdCounter = 0;
  private authorNames = [
    'Alex Johnson', 'Maria Garcia', 'David Chen', 'Sarah Wilson', 'Mike Brown',
    'Lisa Wang', 'James Miller', 'Anna Rodriguez', 'Tom Anderson', 'Emma Davis',
    'Chris Taylor', 'Sofia Martinez', 'Ryan Thompson', 'Maya Patel', 'Kevin Lee'
  ];
  
  private reviewTexts = [
    'Great app! Love the new features and smooth interface.',
    'Works well but could use better notifications.',
    'Amazing experience, highly recommend!',
    'App crashes sometimes, please fix.',
    'Perfect for my daily needs, very reliable.',
    'Good app but battery drain is noticeable.',
    'Excellent customer support and regular updates.',
    'Interface is confusing, needs improvement.',
    'Best app in this category, five stars!',
    'Slow loading times, otherwise decent.',
    'Love the latest update, much better performance.',
    'Missing some key features compared to competitors.',
    'Solid app, does what it promises.',
    'Too many ads, considering uninstalling.',
    'Outstanding quality and attention to detail.'
  ];
  
  private devices = [
    'Pixel 6', 'Samsung Galaxy S21', 'iPhone 13', 'OnePlus 9',
    'Xiaomi Mi 11', 'Huawei P40', 'Sony Xperia 1', 'LG V60'
  ];

  /**
   * Generate realistic review data for testing
   */
  generateReviews(count: number, packageName: string): GooglePlayReviewRow[] {
    const reviews: GooglePlayReviewRow[] = [];
    const now = new Date();
    
    for (let i = 0; i < count; i++) {
      const reviewId = `review_${packageName}_${this.reviewIdCounter++}`;
      const authorName = this.getRandomElement(this.authorNames);
      const text = this.getRandomElement(this.reviewTexts);
      const starRating = this.getWeightedStarRating();
      const device = this.getRandomElement(this.devices);
      
      // Create review timestamp within last 24 hours
      const createdAt = new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000);
      const lastModifiedAt = new Date(createdAt.getTime() + Math.random() * 60 * 60 * 1000);
      
      reviews.push({
        reviewId,
        packageName,
        authorName,
        text,
        starRating,
        languageCode: 'en',
        device,
        androidOsVersion: '12',
        appVersionCode: Math.floor(Math.random() * 100) + 1,
        appVersionName: `1.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 10)}`,
        createdAt,
        lastModifiedAt,
        hasReply: Math.random() < 0.3, // 30% have replies
        ...(Math.random() < 0.3 ? { 
          developerReplyText: 'Thank you for your feedback!',
          developerReplyCreatedAt: new Date(),
          developerReplyLastModifiedAt: new Date()
        } : {}),
      });
    }
    
    return reviews;
  }

  /**
   * Generate review bursts simulating real-world patterns
   */
  generateReviewBurst(intensity: 'low' | 'medium' | 'high', packageName: string): GooglePlayReviewRow[] {
    const burstSizes = {
      low: { min: 3, max: 8 },
      medium: { min: 15, max: 40 },
      high: { min: 50, max: 120 }
    };
    
    const burst = burstSizes[intensity];
    const count = Math.floor(Math.random() * (burst.max - burst.min + 1)) + burst.min;
    
    return this.generateReviews(count, packageName);
  }

  /**
   * Generate time-distributed reviews over a period
   */
  generateTimeDistributedReviews(
    totalCount: number, 
    packageName: string, 
    periodHours: number = 24
  ): GooglePlayReviewRow[] {
    const reviews = this.generateReviews(totalCount, packageName);
    const periodMs = periodHours * 60 * 60 * 1000;
    const now = new Date();
    
    // Distribute reviews over the time period
    reviews.forEach((review, index) => {
      const timeOffset = (index / totalCount) * periodMs;
      review.createdAt = new Date(now.getTime() - periodMs + timeOffset);
      review.lastModifiedAt = new Date(review.createdAt.getTime() + Math.random() * 60 * 60 * 1000);
    });
    
    return reviews;
  }

  /**
   * Create realistic app configurations for testing
   */
  generateTestApps(count: number): Array<{
    packageName: string;
    appName: string;
    matrixRoom: string;
    pollIntervalMs: number;
    maxReviewsPerPoll: number;
  }> {
    const apps = [];
    
    for (let i = 1; i <= count; i++) {
      apps.push({
        packageName: `com.perftest.app${i}`,
        appName: `Performance Test App ${i}`,
        matrixRoom: `!test${i}:localhost`,
        pollIntervalMs: 60000 + Math.random() * 240000, // 1-5 minutes
        maxReviewsPerPoll: 20 + Math.floor(Math.random() * 80), // 20-100 reviews
      });
    }
    
    return apps;
  }

  private getRandomElement<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot get random element from empty array');
    }
    const index = Math.floor(Math.random() * array.length);
    const element = array[index];
    if (element === undefined) {
      throw new Error('Selected element is undefined');
    }
    return element;
  }

  private getWeightedStarRating(): number {
    // Realistic star rating distribution (higher ratings more common)
    const weights = [0.05, 0.05, 0.15, 0.25, 0.50]; // 1-5 stars
    const random = Math.random();
    let cumulative = 0;
    
    for (let i = 0; i < weights.length; i++) {
      const weight = weights[i];
      if (weight === undefined) continue;
      cumulative += weight;
      if (random <= cumulative) {
        return i + 1;
      }
    }
    
    return 5; // Default to 5 stars
  }
}

/**
 * Predefined load test scenarios
 */
export const LOAD_TEST_SCENARIOS: LoadTestScenario[] = [
  {
    name: 'baseline',
    description: 'Single app, light load baseline',
    appCount: 1,
    reviewsPerPoll: 10,
    pollIntervalMs: 300000, // 5 minutes
    durationMs: 30 * 60 * 1000, // 30 minutes
    concurrency: 1,
  },
  {
    name: 'typical-production',
    description: 'Multiple apps, moderate load',
    appCount: 5,
    reviewsPerPoll: 50,
    pollIntervalMs: 300000, // 5 minutes
    durationMs: 2 * 60 * 60 * 1000, // 2 hours
    concurrency: 5,
  },
  {
    name: 'high-load',
    description: 'Many apps, high review volume',
    appCount: 10,
    reviewsPerPoll: 100,
    pollIntervalMs: 120000, // 2 minutes
    durationMs: 60 * 60 * 1000, // 1 hour
    concurrency: 10,
  },
  {
    name: 'stress-test',
    description: 'Extreme load to find limits',
    appCount: 20,
    reviewsPerPoll: 150,
    pollIntervalMs: 60000, // 1 minute
    durationMs: 30 * 60 * 1000, // 30 minutes
    concurrency: 20,
  },
  {
    name: 'endurance',
    description: '24-hour stability test',
    appCount: 3,
    reviewsPerPoll: 25,
    pollIntervalMs: 600000, // 10 minutes
    durationMs: 24 * 60 * 60 * 1000, // 24 hours
    concurrency: 3,
  },
];