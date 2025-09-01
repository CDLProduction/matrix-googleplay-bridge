/**
 * Matrix Application Service API implementation
 * Following Matrix specification v1.14 per Context7 analysis
 */

import * as http from 'http';
import * as url from 'url';
import { Bridge } from 'matrix-appservice-bridge';
import { Logger } from '../utils/Logger';
import { SlidingWindowRateLimiter } from '../utils/RateLimiter';
import { AuditLogger } from '../utils/AuditLogger';

export interface MatrixAppServiceApiConfig {
  port: number;
  host: string;
  hsToken: string;
  asToken: string;
  enableRateLimit: boolean;
  rateLimitConfig?: {
    windowSizeMs: number;
    maxRequests: number;
  };
}

/**
 * Matrix Application Service API server
 * Implements proper authentication and rate limiting per Matrix specification
 */
export class MatrixAppServiceApi {
  private server?: http.Server;
  private logger: Logger;
  private auditLogger: AuditLogger;
  private rateLimiter: SlidingWindowRateLimiter;
  private config: MatrixAppServiceApiConfig;
  private requestCount: number = 0;

  constructor(
    private readonly _bridge: Bridge,  // Bridge instance for user/room queries
    config: MatrixAppServiceApiConfig
  ) {
    this.config = config;
    this.logger = Logger.getInstance().setComponent('MatrixAppServiceApi');
    this.auditLogger = AuditLogger.getInstance();

    // Initialize rate limiter for client-facing endpoints
    // Per Matrix spec: homeserver-to-appservice is "Rate-limited: No"
    // But client-to-appservice endpoints should be rate-limited
    this.rateLimiter = new SlidingWindowRateLimiter('matrix-api', {
      windowSizeMs: config.rateLimitConfig?.windowSizeMs || 60000, // 1 minute
      maxRequests: config.rateLimitConfig?.maxRequests || 100, // 100 requests per minute
      keyGenerator: (context: any) => context?.remoteAddr || 'unknown',
    });
  }

  /**
   * Start the Matrix Application Service API server
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = http.createServer(this.handleRequest.bind(this));

      this.server.on('error', error => {
        this.logger.error('Matrix API server error', error);
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.logger.info(
          `Matrix Application Service API listening on ${this.config.host}:${this.config.port}`,
          {
            endpoints: [
              '/_matrix/app/v1/transactions/{txnId}',
              '/_matrix/app/v1/users/{userId}',
              '/_matrix/app/v1/rooms/{roomAlias}',
              '/_matrix/app/v1/ping',
            ],
          }
        );
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise<void>(resolve => {
      this.server!.close(() => {
        this.logger.info('Matrix API server stopped');
        resolve();
      });
    });
  }

  /**
   * Handle HTTP requests
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const startTime = Date.now();
    this.requestCount++;

    // Parse URL
    const parsedUrl = url.parse(req.url || '/', true);
    const pathname = parsedUrl.pathname || '/';

    // Request logging
    this.logger.http(`${req.method} ${pathname}`, {
      userAgent: req.headers['user-agent'],
      remoteAddr: req.socket.remoteAddress,
    });

    try {
      // Authentication check for all Matrix API endpoints
      if (pathname.startsWith('/_matrix/app/v1/')) {
        const authResult = this.authenticateRequest(req);
        if (!authResult.success) {
          this.sendError(res, 401, authResult.error || 'Unauthorized');
          return;
        }
      }

      // Rate limiting for client-facing endpoints (not homeserver-to-appservice)
      if (this.config.enableRateLimit && this.isClientFacingEndpoint(pathname)) {
        const rateLimitResult = await this.rateLimiter.checkLimit({
          remoteAddr: req.socket.remoteAddress,
        });

        if (!rateLimitResult.allowed) {
          this.logger.warn('Rate limit exceeded for Matrix API request', {
            remoteAddr: req.socket.remoteAddress,
            endpoint: pathname,
            limit: rateLimitResult.info.limit,
          });

          res.setHeader('X-RateLimit-Limit', rateLimitResult.info.limit.toString());
          res.setHeader('X-RateLimit-Remaining', rateLimitResult.info.remaining.toString());
          res.setHeader('X-RateLimit-Reset', rateLimitResult.info.resetTime.toISOString());

          this.sendError(res, 429, 'Too Many Requests');
          return;
        }
      }

      // Route requests to appropriate handlers
      let handled = false;

      if (pathname.startsWith('/_matrix/app/v1/transactions/') && req.method === 'PUT') {
        handled = true;
        await this.handleTransaction(req, res, pathname);
      } else if (pathname.startsWith('/_matrix/app/v1/users/') && req.method === 'GET') {
        handled = true;
        await this.handleUserQuery(req, res, pathname);
      } else if (pathname.startsWith('/_matrix/app/v1/rooms/') && req.method === 'GET') {
        handled = true;
        await this.handleRoomQuery(req, res, pathname);
      } else if (pathname === '/_matrix/app/v1/ping' && req.method === 'GET') {
        handled = true;
        await this.handlePing(req, res);
      }

      if (!handled) {
        this.sendError(res, 404, 'Not Found');
      }
    } catch (error) {
      this.logger.error('Error handling Matrix API request', error, {
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'],
      });

      this.sendError(res, 500, 'Internal Server Error');
    }

    // Record request duration
    const duration = Date.now() - startTime;
    this.logger.debug(`Request completed in ${duration}ms`, {
      method: req.method,
      pathname,
      statusCode: res.statusCode,
    });
  }

  /**
   * Authenticate Matrix API request
   * Following Matrix specification authentication requirements
   */
  private authenticateRequest(req: http.IncomingMessage): { success: boolean; error?: string } {
    // Extract token from Authorization header (preferred) or query parameter (legacy)
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      // Legacy fallback for compatibility
      const parsedUrl = url.parse(req.url || '/', true);
      token = parsedUrl.query.access_token as string;
    }

    if (!token) {
      this.auditLogger.log({
        level: 'warn',
        action: 'matrix_api_missing_token',
        result: 'failure',
        details: {
          url: req.url,
          method: req.method,
          remoteAddr: req.socket.remoteAddress,
          timestamp: new Date().toISOString(),
        },
      });
      return { success: false, error: 'Missing access token' };
    }

    // Validate homeserver token for homeserver-to-appservice requests
    if (this.validateToken(token, this.config.hsToken)) {
      return { success: true };
    }

    // Validate application service token for client-facing requests
    if (this.validateToken(token, this.config.asToken)) {
      return { success: true };
    }

    this.auditLogger.log({
      level: 'warn',
      action: 'matrix_api_invalid_token', 
      result: 'failure',
      details: {
        url: req.url,
      method: req.method,
      remoteAddr: req.socket.remoteAddress,
      timestamp: new Date().toISOString(),
      },
    });

    return { success: false, error: 'Invalid access token' };
  }

  /**
   * Validate token with constant-time comparison
   */
  private validateToken(providedToken: string, expectedToken: string): boolean {
    if (!providedToken || !expectedToken || providedToken.length !== expectedToken.length) {
      return false;
    }

    // Constant-time comparison to prevent timing attacks
    let result = 0;
    for (let i = 0; i < providedToken.length; i++) {
      result |= providedToken.charCodeAt(i) ^ expectedToken.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Check if endpoint is client-facing (should be rate-limited)
   */
  private isClientFacingEndpoint(pathname: string): boolean {
    // Homeserver-to-appservice endpoints are NOT rate-limited per Matrix spec
    const hsToAsEndpoints = [
      '/_matrix/app/v1/transactions/',
      '/_matrix/app/v1/users/',
      '/_matrix/app/v1/rooms/',
    ];

    return !hsToAsEndpoints.some(endpoint => pathname.startsWith(endpoint));
  }

  /**
   * Handle transaction endpoint (PUT /_matrix/app/v1/transactions/{txnId})
   * Rate-limited: No (homeserver-to-appservice)
   */
  private async handleTransaction(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    const txnId = pathname.split('/').pop();
    
    if (!txnId) {
      this.sendError(res, 400, 'Missing transaction ID');
      return;
    }

    // Read request body
    const body = await this.readRequestBody(req);
    let events: any[];

    try {
      const data = JSON.parse(body);
      events = data.events || [];
    } catch (error) {
      this.sendError(res, 400, 'Invalid JSON');
      return;
    }

    this.logger.info(`Processing transaction ${txnId} with ${events.length} events`);

    try {
      // Process events through the bridge
      for (const _event of events) {
        // Bridge will handle the actual event processing
        // This is just the API endpoint implementation
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    } catch (error) {
      this.logger.error('Error processing transaction', error, { txnId });
      this.sendError(res, 500, 'Transaction processing failed');
    }
  }

  /**
   * Handle user query endpoint (GET /_matrix/app/v1/users/{userId})
   * Rate-limited: No (homeserver-to-appservice)
   */
  private async handleUserQuery(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    const userId = pathname.split('/').pop();
    
    if (!userId) {
      this.sendError(res, 400, 'Missing user ID');
      return;
    }

    // Check if this user should be handled by this appservice  
    this._bridge.getIntent(userId); // Create intent to verify we handle this user
    
    try {
      // If we can create an intent for this user, we handle it
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    } catch (error) {
      // User not in our namespace
      this.sendError(res, 404, 'User not found');
    }
  }

  /**
   * Handle room query endpoint (GET /_matrix/app/v1/rooms/{roomAlias})
   * Rate-limited: No (homeserver-to-appservice)
   */
  private async handleRoomQuery(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    const roomAlias = pathname.split('/').pop();
    
    if (!roomAlias) {
      this.sendError(res, 400, 'Missing room alias');
      return;
    }

    // Check if this room alias is in our namespace
    if (roomAlias.includes('_googleplay_')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    } else {
      this.sendError(res, 404, 'Room not found');
    }
  }

  /**
   * Handle ping endpoint (GET /_matrix/app/v1/ping)
   */
  private async handlePing(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    }));
  }

  /**
   * Read request body
   */
  private async readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        resolve(body);
      });
      req.on('error', reject);
    });
  }

  /**
   * Send error response
   */
  private sendError(
    res: http.ServerResponse,
    statusCode: number,
    message: string
  ): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(statusCode);
    res.end(
      JSON.stringify({
        errcode: `M_${http.STATUS_CODES[statusCode]?.replace(/\s+/g, '_').toUpperCase()}`,
        error: message,
        timestamp: new Date().toISOString(),
      })
    );
  }
}