/**
 * Circuit Breaker pattern implementation for API resilience and fault tolerance
 */

import { Logger } from './Logger';

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  resetTimeout: number; // Time in ms before attempting reset
  monitoringPeriod: number; // Time window for failure counting in ms
  successThreshold: number; // Successes needed in half-open to close
  timeout?: number; // Request timeout in ms
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalRequests: number;
  lastFailureTime: Date | undefined;
  lastSuccessTime: Date | undefined;
  nextAttemptTime: Date | undefined;
  monitoringWindowStart: Date;
}

export interface CircuitBreakerOptions {
  name: string;
  config: CircuitBreakerConfig;
}

/**
 * Circuit Breaker implementation with monitoring and automatic recovery
 */
export class CircuitBreaker {
  private name: string;
  private config: CircuitBreakerConfig;
  private logger: Logger;

  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private totalRequests: number = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private nextAttemptTime?: Date;
  private monitoringWindowStart: Date = new Date();

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.config = {
      failureThreshold: options.config.failureThreshold ?? 5,
      resetTimeout: options.config.resetTimeout ?? 60000,
      monitoringPeriod: options.config.monitoringPeriod ?? 300000,
      successThreshold: options.config.successThreshold ?? 3,
      ...(options.config.timeout !== undefined && {
        timeout: options.config.timeout,
      }),
    };

    this.logger = Logger.getInstance().setComponent(
      `CircuitBreaker:${this.name}`
    );

    this.logger.debug('Circuit breaker initialized', {
      name: this.name,
      config: this.config,
    });
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return this.call(fn);
  }

  /**
   * Call a function through the circuit breaker
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    // Check if we should reset the monitoring window
    this.checkMonitoringWindow();

    // Check current state and decide whether to allow the call
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        this.logger.info(`Circuit breaker transitioning to HALF_OPEN`, {
          name: this.name,
          failureCount: this.failureCount,
        });
      } else {
        const error = new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.name}. Next attempt at: ${this.nextAttemptTime?.toISOString()}`,
          this.name,
          this.state
        );
        this.logger.debug(`Request rejected - circuit breaker OPEN`, {
          name: this.name,
          nextAttemptTime: this.nextAttemptTime,
        });
        throw error;
      }
    }

    try {
      // Execute the function with optional timeout
      const result = this.config.timeout
        ? await this.executeWithTimeout(fn, this.config.timeout)
        : await fn();

      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Circuit breaker timeout after ${timeout}ms`));
      }, timeout);

      fn()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successCount >= this.config.successThreshold) {
        this.reset();
        this.logger.info(`Circuit breaker closed after successful recovery`, {
          name: this.name,
          successCount: this.successCount,
        });
      }
    }

    this.logger.debug(`Circuit breaker success`, {
      name: this.name,
      state: this.state,
      successCount: this.successCount,
    });
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: any): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    this.logger.warn(`Circuit breaker failure`, {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      error: error instanceof Error ? error.message : String(error),
    });

    if (this.state === CircuitState.HALF_OPEN) {
      // Go back to OPEN state
      this.open();
      this.logger.warn(
        `Circuit breaker reopened due to failure in HALF_OPEN state`,
        {
          name: this.name,
          failureCount: this.failureCount,
        }
      );
    } else if (
      this.state === CircuitState.CLOSED &&
      this.failureCount >= this.config.failureThreshold
    ) {
      // Open the circuit
      this.open();
      this.logger.error(
        `Circuit breaker opened due to failure threshold exceeded`,
        {
          name: this.name,
          failureCount: this.failureCount,
          threshold: this.config.failureThreshold,
        }
      );
    }
  }

  /**
   * Open the circuit breaker
   */
  private open(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = new Date(Date.now() + this.config.resetTimeout);
  }

  /**
   * Reset the circuit breaker to closed state
   */
  private reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    delete this.lastFailureTime;
    delete this.nextAttemptTime;
    this.monitoringWindowStart = new Date();
  }

  /**
   * Check if we should attempt to reset from OPEN to HALF_OPEN
   */
  private shouldAttemptReset(): boolean {
    return this.nextAttemptTime
      ? Date.now() >= this.nextAttemptTime.getTime()
      : false;
  }

  /**
   * Check if monitoring window should be reset
   */
  private checkMonitoringWindow(): void {
    const now = Date.now();
    const windowElapsed = now - this.monitoringWindowStart.getTime();

    if (windowElapsed >= this.config.monitoringPeriod) {
      // Reset failure count and monitoring window
      if (this.state === CircuitState.CLOSED) {
        this.failureCount = 0;
        this.logger.debug(`Reset monitoring window`, {
          name: this.name,
          windowElapsed,
        });
      }
      this.monitoringWindowStart = new Date();
    }
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime,
      monitoringWindowStart: this.monitoringWindowStart,
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Force circuit breaker state (for testing/manual intervention)
   */
  setState(state: CircuitState): void {
    this.logger.warn(
      `Circuit breaker state manually changed from ${this.state} to ${state}`,
      {
        name: this.name,
      }
    );

    this.state = state;

    if (state === CircuitState.CLOSED) {
      this.reset();
    } else if (state === CircuitState.OPEN) {
      this.open();
    } else if (state === CircuitState.HALF_OPEN) {
      this.successCount = 0;
    }
  }

  /**
   * Check if circuit breaker is healthy
   */
  isHealthy(): boolean {
    return this.state !== CircuitState.OPEN;
  }
}

/**
 * Circuit breaker error
 */
export class CircuitBreakerError extends Error {
  public readonly circuitBreakerName: string;
  public readonly circuitState: CircuitState;

  constructor(
    message: string,
    circuitBreakerName: string,
    circuitState: CircuitState
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.circuitBreakerName = circuitBreakerName;
    this.circuitState = circuitState;
  }
}

/**
 * Circuit breaker factory and registry
 */
export class CircuitBreakerRegistry {
  private static instance: CircuitBreakerRegistry;
  private breakers: Map<string, CircuitBreaker> = new Map();
  private logger: Logger;

  private constructor() {
    this.logger = Logger.getInstance().setComponent('CircuitBreakerRegistry');
  }

  static getInstance(): CircuitBreakerRegistry {
    if (!CircuitBreakerRegistry.instance) {
      CircuitBreakerRegistry.instance = new CircuitBreakerRegistry();
    }
    return CircuitBreakerRegistry.instance;
  }

  /**
   * Get or create a circuit breaker
   */
  getOrCreate(name: string, config: CircuitBreakerConfig): CircuitBreaker {
    let breaker = this.breakers.get(name);

    if (!breaker) {
      breaker = new CircuitBreaker({ name, config });
      this.breakers.set(name, breaker);
      this.logger.info(`Created circuit breaker: ${name}`, { config });
    }

    return breaker;
  }

  /**
   * Get circuit breaker by name
   */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Get all circuit breakers
   */
  getAll(): CircuitBreaker[] {
    return Array.from(this.breakers.values());
  }

  /**
   * Get registry statistics
   */
  getStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};

    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }

    return stats;
  }

  /**
   * Remove circuit breaker
   */
  remove(name: string): boolean {
    const removed = this.breakers.delete(name);
    if (removed) {
      this.logger.info(`Removed circuit breaker: ${name}`);
    }
    return removed;
  }

  /**
   * Clear all circuit breakers
   */
  clear(): void {
    this.breakers.clear();
    this.logger.info('Cleared all circuit breakers');
  }
}

/**
 * Decorator for adding circuit breaker to class methods
 */
export function circuitBreaker(name: string, config: CircuitBreakerConfig) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const registry = CircuitBreakerRegistry.getInstance();

    descriptor.value = async function (...args: any[]) {
      const breaker = registry.getOrCreate(name, config);
      return breaker.execute(() => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}
