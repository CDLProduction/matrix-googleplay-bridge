import { google, androidpublisher_v3 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { Logger } from '../utils/Logger';

export interface GooglePlayReviewData {
  reviewId: string;
  packageName: string;
  authorName: string;
  text?: string;
  starRating: number;
  createdAt: Date;
  lastModifiedAt: Date;
  developerComment?: {
    text: string;
    lastModified: Date;
  };
  hasReply: boolean;
}

export interface GooglePlayReviewsResponse {
  reviews: GooglePlayReviewData[];
  tokenPagination?: {
    nextPageToken?: string;
  };
}

export interface GooglePlayReplyRequest {
  replyText: string;
}

export interface GooglePlayClientConfig {
  keyFile?: string;
  keyFileContent?: string;
  clientEmail?: string;
  privateKey?: string;
  projectId?: string;
  scopes?: string[];
}

export interface ReviewListOptions {
  packageName: string;
  maxResults?: number;
  startIndex?: number;
  token?: string;
  translationLanguage?: string;
}

export interface ReplyOptions {
  packageName: string;
  reviewId: string;
  replyText: string;
}

export class GooglePlayAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'GooglePlayAPIError';
  }
}

export class GooglePlayAuthError extends GooglePlayAPIError {
  constructor(message: string, details?: any) {
    super(message, 401, 'AUTH_ERROR', details);
    this.name = 'GooglePlayAuthError';
  }
}

export class GooglePlayRateLimitError extends GooglePlayAPIError {
  constructor(message: string, retryAfter?: number, details?: any) {
    super(message, 429, 'RATE_LIMIT', { retryAfter, ...details });
    this.name = 'GooglePlayRateLimitError';
  }
}

/**
 * Google Play Console API client for managing app reviews and replies
 * Handles authentication, rate limiting, and error recovery
 */
export class GooglePlayClient {
  private androidPublisher: androidpublisher_v3.Androidpublisher;
  private auth: GoogleAuth;
  private logger: Logger;
  private isAuthenticated: boolean = false;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 100; // Minimum 100ms between requests

  constructor(config: GooglePlayClientConfig) {
    this.logger = Logger.getInstance();
    
    const authOptions: any = {};
    
    if (config.keyFile) {
      authOptions.keyFile = config.keyFile;
    } else if (config.keyFileContent) {
      authOptions.credentials = JSON.parse(config.keyFileContent);
    } else if (config.clientEmail && config.privateKey) {
      authOptions.credentials = {
        client_email: config.clientEmail,
        private_key: config.privateKey.replace(/\\n/g, '\n'),
      };
    }
    
    if (config.projectId) {
      authOptions.projectId = config.projectId;
    }
    
    authOptions.scopes = config.scopes || ['https://www.googleapis.com/auth/androidpublisher'];
    
    this.auth = new GoogleAuth(authOptions);

    this.androidPublisher = google.androidpublisher({
      version: 'v3',
      auth: this.auth,
    });
  }

  /**
   * Initialize the client and verify authentication
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Google Play API client...');
      
      // Test authentication by getting client info
      const authClient = await this.auth.getClient();
      if (!authClient) {
        throw new GooglePlayAuthError('Failed to obtain authentication client');
      }

      // Verify we can make a request (using a minimal API call)
      await this.auth.getAccessToken();
      
      this.isAuthenticated = true;
      this.logger.info('Google Play API client initialized successfully');
    } catch (error) {
      this.isAuthenticated = false;
      if (error instanceof Error) {
        throw new GooglePlayAuthError(
          `Failed to initialize Google Play API client: ${error.message}`,
          { originalError: error }
        );
      }
      throw error;
    }
  }

  /**
   * Check if the client is properly authenticated
   */
  isReady(): boolean {
    return this.isAuthenticated;
  }

  /**
   * Get reviews for a specific app package
   */
  async getReviews(options: ReviewListOptions): Promise<GooglePlayReviewsResponse> {
    this.ensureAuthenticated();
    await this.enforceRateLimit();

    try {
      this.logger.debug(`Fetching reviews for package: ${options.packageName}`);

      const requestParams: any = {
        packageName: options.packageName,
        maxResults: options.maxResults || 100,
        startIndex: options.startIndex || 0,
      };
      
      if (options.token) {
        requestParams.token = options.token;
      }
      
      if (options.translationLanguage) {
        requestParams.translationLanguage = options.translationLanguage;
      }

      const response = await this.androidPublisher.reviews.list(requestParams);

      if (!response.data) {
        return { reviews: [] };
      }

      const reviews: GooglePlayReviewData[] = (response.data.reviews || []).map((review: any) => {
        const comment = review.comments?.[0];
        const userComment = comment?.userComment;
        const developerComment = comment?.developerComment;

        const reviewResult: GooglePlayReviewData = {
          reviewId: review.reviewId || '',
          packageName: options.packageName,
          authorName: review.authorName || 'Anonymous',
          starRating: userComment?.starRating || 0,
          createdAt: new Date((parseInt(userComment?.lastModified?.seconds as string) || 0) * 1000),
          lastModifiedAt: new Date((parseInt(userComment?.lastModified?.seconds as string) || 0) * 1000),
          hasReply: !!developerComment,
        };
        
        if (userComment?.text) {
          reviewResult.text = userComment.text;
        }
        
        if (developerComment?.text) {
          reviewResult.developerComment = {
            text: developerComment.text,
            lastModified: new Date((parseInt(developerComment.lastModified?.seconds as string) || 0) * 1000),
          };
        }
        
        return reviewResult;
      });

      this.logger.debug(`Retrieved ${reviews.length} reviews for ${options.packageName}`);

      const result: GooglePlayReviewsResponse = {
        reviews,
      };
      
      if (response.data.tokenPagination?.nextPageToken) {
        result.tokenPagination = {
          nextPageToken: response.data.tokenPagination.nextPageToken,
        };
      }
      
      return result;
    } catch (error) {
      throw this.handleAPIError(error, 'getReviews');
    }
  }

  /**
   * Reply to a specific review
   */
  async replyToReview(options: ReplyOptions): Promise<void> {
    this.ensureAuthenticated();
    await this.enforceRateLimit();

    try {
      this.logger.debug(`Replying to review ${options.reviewId} for package: ${options.packageName}`);

      await this.androidPublisher.reviews.reply({
        packageName: options.packageName,
        reviewId: options.reviewId,
        requestBody: {
          replyText: options.replyText,
        },
      });

      this.logger.info(`Successfully replied to review ${options.reviewId}`);
    } catch (error) {
      throw this.handleAPIError(error, 'replyToReview');
    }
  }

  /**
   * Get a specific review by ID
   */
  async getReview(packageName: string, reviewId: string): Promise<GooglePlayReviewData | null> {
    this.ensureAuthenticated();
    await this.enforceRateLimit();

    try {
      this.logger.debug(`Fetching review ${reviewId} for package: ${packageName}`);

      const response = await this.androidPublisher.reviews.get({
        packageName,
        reviewId,
        translationLanguage: 'en', // Default to English
      });

      if (!response.data) {
        return null;
      }

      const review = response.data;
      const comment = review.comments?.[0];
      const userComment = comment?.userComment;
      const developerComment = comment?.developerComment;

      const singleReviewResult: GooglePlayReviewData = {
        reviewId: review.reviewId || '',
        packageName,
        authorName: review.authorName || 'Anonymous',
        starRating: userComment?.starRating || 0,
        createdAt: new Date((parseInt(userComment?.lastModified?.seconds as string) || 0) * 1000),
        lastModifiedAt: new Date((parseInt(userComment?.lastModified?.seconds as string) || 0) * 1000),
        hasReply: !!developerComment,
      };
      
      if (userComment?.text) {
        singleReviewResult.text = userComment.text;
      }
      
      if (developerComment?.text) {
        singleReviewResult.developerComment = {
          text: developerComment.text,
          lastModified: new Date((parseInt(developerComment.lastModified?.seconds as string) || 0) * 1000),
        };
      }
      
      return singleReviewResult;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        this.logger.debug(`Review ${reviewId} not found for package ${packageName}`);
        return null;
      }
      throw this.handleAPIError(error, 'getReview');
    }
  }

  /**
   * Get reviews modified since a specific date (for polling)
   */
  async getRecentReviews(
    packageName: string, 
    since: Date,
    maxResults: number = 100
  ): Promise<GooglePlayReviewData[]> {
    this.logger.debug(`Fetching reviews modified since ${since.toISOString()} for ${packageName}`);

    const allReviews: GooglePlayReviewData[] = [];
    let token: string | undefined;
    let hasMore = true;

    while (hasMore && allReviews.length < maxResults) {
      const requestOptions: ReviewListOptions = {
        packageName,
        maxResults: Math.min(100, maxResults - allReviews.length),
      };
      
      if (token) {
        requestOptions.token = token;
      }

      const response = await this.getReviews(requestOptions);

      // Filter reviews modified since the specified date
      const recentReviews = response.reviews.filter(
        review => review.lastModifiedAt >= since
      );

      allReviews.push(...recentReviews);

      // If we got fewer recent reviews than total reviews, we've gone past our date range
      if (recentReviews.length < response.reviews.length) {
        hasMore = false;
      } else {
        token = response.tokenPagination?.nextPageToken;
        hasMore = !!token;
      }
    }

    this.logger.debug(`Found ${allReviews.length} recent reviews for ${packageName}`);
    return allReviews;
  }

  /**
   * Test API connectivity and permissions
   */
  async testConnection(packageName: string): Promise<boolean> {
    try {
      this.logger.debug(`Testing connection for package: ${packageName}`);
      
      // Try to get just one review to test connectivity
      await this.getReviews({
        packageName,
        maxResults: 1,
      });
      
      this.logger.info(`Connection test successful for package: ${packageName}`);
      return true;
    } catch (error) {
      this.logger.error(`Connection test failed for package ${packageName}: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  /**
   * Gracefully shutdown the client
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Google Play API client...');
    this.isAuthenticated = false;
  }

  /**
   * Ensure the client is authenticated before making requests
   */
  private ensureAuthenticated(): void {
    if (!this.isAuthenticated) {
      throw new GooglePlayAuthError('Google Play API client is not authenticated. Call initialize() first.');
    }
  }

  /**
   * Enforce rate limiting between API requests
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Handle and classify API errors
   */
  private handleAPIError(error: any, operation: string): GooglePlayAPIError {
    this.logger.error(`Google Play API error in ${operation}:`, error);

    if (error?.response) {
      const status = error.response.status;
      const statusText = error.response.statusText || 'Unknown error';
      const data = error.response.data;

      switch (status) {
        case 401:
          return new GooglePlayAuthError(
            `Authentication failed: ${statusText}`,
            { status, data }
          );
        
        case 403:
          return new GooglePlayAuthError(
            `Access forbidden: ${statusText}. Check API permissions and app access.`,
            { status, data }
          );
        
        case 429:
          const retryAfter = error.response.headers?.['retry-after'];
          return new GooglePlayRateLimitError(
            `Rate limit exceeded: ${statusText}`,
            retryAfter ? parseInt(retryAfter) * 1000 : 60000,
            { status, data }
          );
        
        case 404:
          return new GooglePlayAPIError(
            `Resource not found: ${statusText}`,
            status,
            'NOT_FOUND',
            { status, data }
          );
        
        default:
          return new GooglePlayAPIError(
            `API error: ${statusText}`,
            status,
            'API_ERROR',
            { status, data }
          );
      }
    }

    if (error instanceof Error) {
      return new GooglePlayAPIError(
        `Network or client error: ${error.message}`,
        undefined,
        'CLIENT_ERROR',
        { originalError: error }
      );
    }

    return new GooglePlayAPIError(
      `Unknown error in ${operation}`,
      undefined,
      'UNKNOWN_ERROR',
      { originalError: error }
    );
  }

  /**
   * Check if an error is a 404 Not Found error
   */
  private isNotFoundError(error: any): boolean {
    return error?.response?.status === 404;
  }
}