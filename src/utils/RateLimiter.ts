/**
 * Rate limiting and request throttling implementation
 */

import { Logger } from './Logger';

export interface RateLimiterConfig {
  windowSizeMs: number;    // Time window in milliseconds
  maxRequests: number;     // Maximum requests per window
  keyGenerator?: (context: any) => string;  // Custom key generation
  skipSuccessfulRequests?: boolean;         // Only count failed requests
  skipRequestsWithResult?: (result: any) => boolean;  // Skip based on result
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: Date;
  totalHits: number;
}

export interface RateLimitResult {
  allowed: boolean;
  info: RateLimitInfo;
}

/**
 * Token bucket rate limiter implementation
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume tokens from the bucket
   */
  consume(tokens: number = 1): boolean {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    
    return false;
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * Sliding window rate limiter
 */
export class SlidingWindowRateLimiter {
  private windows: Map<string, number[]> = new Map();
  private config: RateLimiterConfig;
  private logger: Logger;
  private name: string;

  constructor(name: string, config: RateLimiterConfig) {
    this.name = name;
    this.config = {
      keyGenerator: (context: any) => context?.key || 'default',
      skipSuccessfulRequests: false,
      ...config,
    };
    this.logger = Logger.getInstance().setComponent(`RateLimiter:${name}`);
    
    // Cleanup old windows periodically
    setInterval(() => this.cleanup(), this.config.windowSizeMs);
  }

  /**
   * Check if request is allowed and record it
   */
  async checkLimit(context?: any): Promise<RateLimitResult> {
    const key = this.config.keyGenerator!(context);
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;
    
    // Get or create window for this key
    let requests = this.windows.get(key) || [];
    
    // Remove old requests outside the window
    requests = requests.filter(timestamp => timestamp > windowStart);
    
    // Check if we can allow this request
    const allowed = requests.length < this.config.maxRequests;
    
    if (allowed) {
      requests.push(now);
      this.windows.set(key, requests);
    }
    
    const info: RateLimitInfo = {
      limit: this.config.maxRequests,
      remaining: Math.max(0, this.config.maxRequests - requests.length),
      resetTime: new Date(now + this.config.windowSizeMs),
      totalHits: requests.length,
    };
    
    if (!allowed) {
      this.logger.warn(`Rate limit exceeded`, {
        name: this.name,
        key,
        limit: this.config.maxRequests,
        current: requests.length,
        windowSizeMs: this.config.windowSizeMs,
      });
    }
    
    return { allowed, info };
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>, context?: any): Promise<T> {
    const result = await this.checkLimit(context);
    
    if (!result.allowed) {
      throw new RateLimitError(
        `Rate limit exceeded for ${this.name}. Limit: ${result.info.limit}, Reset: ${result.info.resetTime.toISOString()}`,
        result.info
      );
    }
    
    try {
      const fnResult = await fn();
      
      // Post-process based on result
      if (this.config.skipRequestsWithResult?.(fnResult)) {
        // Remove the request from the count if it should be skipped
        const key = this.config.keyGenerator!(context);
        const requests = this.windows.get(key) || [];
        if (requests.length > 0) {
          requests.pop(); // Remove the most recent request
          this.windows.set(key, requests);
        }
      }
      
      return fnResult;
      
    } catch (error) {
      // Handle failed requests
      if (!this.config.skipSuccessfulRequests) {
        // Keep the request in the count since we count all requests
      }
      throw error;
    }
  }

  /**
   * Get current rate limit info for a key
   */
  getInfo(context?: any): RateLimitInfo {
    const key = this.config.keyGenerator!(context);
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;
    
    const requests = (this.windows.get(key) || []).filter(timestamp => timestamp > windowStart);
    
    return {
      limit: this.config.maxRequests,
      remaining: Math.max(0, this.config.maxRequests - requests.length),
      resetTime: new Date(now + this.config.windowSizeMs),
      totalHits: requests.length,
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  reset(context?: any): void {
    const key = this.config.keyGenerator!(context);
    this.windows.delete(key);
    this.logger.info(`Rate limit reset for key: ${key}`, { name: this.name });
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.windows.clear();
    this.logger.info(`All rate limits reset`, { name: this.name });
  }

  /**
   * Get statistics
   */
  getStats(): {
    name: string;
    totalKeys: number;
    totalRequests: number;
    config: RateLimiterConfig;
  } {
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;
    let totalRequests = 0;
    
    for (const requests of this.windows.values()) {
      totalRequests += requests.filter(timestamp => timestamp > windowStart).length;
    }
    
    return {
      name: this.name,
      totalKeys: this.windows.size,
      totalRequests,
      config: this.config,
    };
  }

  /**
   * Cleanup old windows
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;
    let cleanedKeys = 0;
    
    for (const [key, requests] of this.windows.entries()) {
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      
      if (validRequests.length === 0) {
        this.windows.delete(key);
        cleanedKeys++;
      } else if (validRequests.length !== requests.length) {
        this.windows.set(key, validRequests);
      }
    }
    
    if (cleanedKeys > 0) {
      this.logger.debug(`Cleaned up ${cleanedKeys} empty rate limit windows`, { name: this.name });
    }
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends Error {
  public readonly rateLimitInfo: RateLimitInfo;

  constructor(message: string, rateLimitInfo: RateLimitInfo) {
    super(message);
    this.name = 'RateLimitError';
    this.rateLimitInfo = rateLimitInfo;
  }
}

/**
 * Request throttling with exponential backoff
 */
export class Throttler {
  private delays: Map<string, number> = new Map();
  private attempts: Map<string, number> = new Map();
  private logger: Logger;
  private name: string;
  
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly backoffMultiplier: number;
  private readonly jitterMs: number;

  constructor(name: string, options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    jitterMs?: number;
  } = {}) {
    this.name = name;
    this.baseDelayMs = options.baseDelayMs || 1000;
    this.maxDelayMs = options.maxDelayMs || 30000;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.jitterMs = options.jitterMs || 100;
    this.logger = Logger.getInstance().setComponent(`Throttler:${name}`);
  }

  /**
   * Execute function with exponential backoff throttling
   */
  async execute<T>(key: string, fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Apply delay if this is a retry
        if (attempt > 0) {
          const delay = this.calculateDelay(key, attempt);
          this.logger.debug(`Throttling request`, {
            name: this.name,
            key,
            attempt,
            delayMs: delay,
          });
          await this.sleep(delay);
        }
        
        // Execute the function
        const result = await fn();
        
        // Reset on success
        this.reset(key);
        return result;
        
      } catch (error) {
        lastError = error;
        this.recordFailure(key);
        
        this.logger.warn(`Throttled request failed`, {
          name: this.name,
          key,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        
        // Don't retry on the last attempt
        if (attempt === maxRetries) {
          break;
        }
      }
    }
    
    throw new ThrottleError(
      `Throttled request failed after ${maxRetries + 1} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      key,
      maxRetries + 1,
      lastError
    );
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(key: string, attempt: number): number {
    const baseDelay = this.baseDelayMs * Math.pow(this.backoffMultiplier, attempt - 1);
    const jitter = Math.random() * this.jitterMs;
    const delay = Math.min(baseDelay + jitter, this.maxDelayMs);
    
    return Math.round(delay);
  }

  /**
   * Record a failure for exponential backoff calculation
   */
  private recordFailure(key: string): void {
    const currentAttempts = this.attempts.get(key) || 0;
    this.attempts.set(key, currentAttempts + 1);
  }

  /**
   * Reset throttling for a key
   */
  reset(key: string): void {
    this.delays.delete(key);
    this.attempts.delete(key);
  }

  /**
   * Reset all throttling
   */
  resetAll(): void {
    this.delays.clear();
    this.attempts.clear();
    this.logger.info(`All throttling reset`, { name: this.name });
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get throttling statistics
   */
  getStats(): {
    name: string;
    activeKeys: number;
    totalAttempts: number;
  } {
    let totalAttempts = 0;
    for (const attempts of this.attempts.values()) {
      totalAttempts += attempts;
    }
    
    return {
      name: this.name,
      activeKeys: this.attempts.size,
      totalAttempts,
    };
  }
}

/**
 * Throttle error
 */
export class ThrottleError extends Error {
  public readonly key: string;
  public readonly attempts: number;
  public readonly originalError: any;

  constructor(message: string, key: string, attempts: number, originalError: any) {
    super(message);
    this.name = 'ThrottleError';
    this.key = key;
    this.attempts = attempts;
    this.originalError = originalError;
  }
}

/**
 * Combined rate limiter and throttler registry
 */
export class RateLimitingRegistry {
  private static instance: RateLimitingRegistry;
  private rateLimiters: Map<string, SlidingWindowRateLimiter> = new Map();
  private throttlers: Map<string, Throttler> = new Map();
  private tokenBuckets: Map<string, TokenBucket> = new Map();
  private logger: Logger;

  private constructor() {
    this.logger = Logger.getInstance().setComponent('RateLimitingRegistry');
  }

  static getInstance(): RateLimitingRegistry {
    if (!RateLimitingRegistry.instance) {
      RateLimitingRegistry.instance = new RateLimitingRegistry();
    }
    return RateLimitingRegistry.instance;
  }

  /**
   * Get or create a rate limiter
   */
  getRateLimiter(name: string, config: RateLimiterConfig): SlidingWindowRateLimiter {
    let limiter = this.rateLimiters.get(name);
    
    if (!limiter) {
      limiter = new SlidingWindowRateLimiter(name, config);
      this.rateLimiters.set(name, limiter);
      this.logger.info(`Created rate limiter: ${name}`, { config });
    }
    
    return limiter;
  }

  /**
   * Get or create a throttler
   */
  getThrottler(name: string, options?: Parameters<typeof Throttler.prototype.constructor>[1]): Throttler {
    let throttler = this.throttlers.get(name);
    
    if (!throttler) {
      throttler = new Throttler(name, options);
      this.throttlers.set(name, throttler);
      this.logger.info(`Created throttler: ${name}`, { options });
    }
    
    return throttler;
  }

  /**
   * Get or create a token bucket
   */
  getTokenBucket(name: string, capacity: number, refillRate: number): TokenBucket {
    let bucket = this.tokenBuckets.get(name);
    
    if (!bucket) {
      bucket = new TokenBucket(capacity, refillRate);
      this.tokenBuckets.set(name, bucket);
      this.logger.info(`Created token bucket: ${name}`, { capacity, refillRate });
    }
    
    return bucket;
  }

  /**
   * Get all statistics
   */
  getAllStats(): {
    rateLimiters: Record<string, any>;
    throttlers: Record<string, any>;
    tokenBuckets: Record<string, { tokens: number }>;
  } {
    const rateLimiters: Record<string, any> = {};
    const throttlers: Record<string, any> = {};
    const tokenBuckets: Record<string, { tokens: number }> = {};
    
    for (const [name, limiter] of this.rateLimiters) {
      rateLimiters[name] = limiter.getStats();
    }
    
    for (const [name, throttler] of this.throttlers) {
      throttlers[name] = throttler.getStats();
    }
    
    for (const [name, bucket] of this.tokenBuckets) {
      tokenBuckets[name] = { tokens: bucket.getTokens() };
    }
    
    return { rateLimiters, throttlers, tokenBuckets };
  }
}