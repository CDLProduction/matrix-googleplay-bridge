/**
 * HTTP server for health checks, metrics, and monitoring endpoints
 */

import * as http from 'http';
import * as url from 'url';
import { Logger } from './Logger';
import { HealthMonitor, HealthStatus } from './HealthCheck';

export interface HttpServerConfig {
  port: number;
  host: string;
  enableMetrics: boolean;
  enableHealthCheck: boolean;
  enableDocs: boolean;
  corsEnabled: boolean;
  requestLogging: boolean;
}

export interface MetricValue {
  name: string;
  value: number;
  labels?: Record<string, string>;
  help?: string;
  type?: 'counter' | 'gauge' | 'histogram';
}

/**
 * HTTP server for monitoring, health checks, and metrics collection
 */
export class HttpServer {
  private server?: http.Server;
  private logger: Logger;
  private config: HttpServerConfig;
  private healthMonitor?: HealthMonitor;
  private metrics: Map<string, MetricValue> = new Map();
  private startTime: Date;
  private requestCount: number = 0;

  constructor(config: Partial<HttpServerConfig> = {}) {
    this.config = {
      port: 9090,
      host: '0.0.0.0',
      enableMetrics: true,
      enableHealthCheck: true,
      enableDocs: true,
      corsEnabled: true,
      requestLogging: true,
      ...config,
    };

    this.logger = Logger.getInstance().setComponent('HttpServer');
    this.startTime = new Date();
  }

  /**
   * Set health monitor instance
   */
  setHealthMonitor(healthMonitor: HealthMonitor): void {
    this.healthMonitor = healthMonitor;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = http.createServer(this.handleRequest.bind(this));

      this.server.on('error', error => {
        this.logger.error('HTTP server error', error);
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.logger.info(
          `HTTP server listening on ${this.config.host}:${this.config.port}`,
          {
            endpoints: this.getAvailableEndpoints(),
          }
        );
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise<void>(resolve => {
      this.server!.close(() => {
        this.logger.info('HTTP server stopped');
        resolve();
      });
    });
  }

  /**
   * Record a metric value
   */
  recordMetric(
    name: string,
    value: number,
    labels?: Record<string, string>,
    options?: {
      help?: string;
      type?: MetricValue['type'];
    }
  ): void {
    const metricKey = labels
      ? `${name}{${this.serializeLabels(labels)}}`
      : name;

    this.metrics.set(metricKey, {
      name,
      value,
      ...(labels && { labels }),
      ...(options?.help && { help: options.help }),
      type: options?.type || 'gauge',
    });
  }

  /**
   * Increment a counter metric
   */
  incrementCounter(
    name: string,
    labels?: Record<string, string>,
    increment: number = 1
  ): void {
    const metricKey = labels
      ? `${name}{${this.serializeLabels(labels)}}`
      : name;
    const existing = this.metrics.get(metricKey);

    this.recordMetric(name, (existing?.value || 0) + increment, labels, {
      type: 'counter',
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
    if (this.config.requestLogging) {
      this.logger.http(`${req.method} ${pathname}`, {
        userAgent: req.headers['user-agent'],
        remoteAddr: req.socket.remoteAddress,
      });
    }

    // CORS headers
    if (this.config.corsEnabled) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
      );
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // Route requests
      let handled = false;

      if (pathname === '/' && this.config.enableDocs) {
        handled = true;
        await this.handleRoot(req, res);
      } else if (pathname === '/health' && this.config.enableHealthCheck) {
        handled = true;
        await this.handleHealth(req, res);
      } else if (
        pathname === '/health/ready' &&
        this.config.enableHealthCheck
      ) {
        handled = true;
        await this.handleReadiness(req, res);
      } else if (pathname === '/health/live' && this.config.enableHealthCheck) {
        handled = true;
        await this.handleLiveness(req, res);
      } else if (pathname === '/metrics' && this.config.enableMetrics) {
        handled = true;
        await this.handleMetrics(req, res);
      } else if (pathname === '/status') {
        handled = true;
        await this.handleStatus(req, res);
      }

      if (!handled) {
        this.send404(res);
      }
    } catch (error) {
      this.logger.error('Error handling HTTP request', error, {
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'],
      });

      this.sendError(res, 500, 'Internal Server Error');
    }

    // Record request metrics
    const duration = Date.now() - startTime;
    this.recordMetric('http_request_duration_ms', duration, {
      method: req.method || 'UNKNOWN',
      status: res.statusCode.toString(),
      endpoint: pathname,
    });

    this.incrementCounter('http_requests_total', {
      method: req.method || 'UNKNOWN',
      status: res.statusCode.toString(),
    });
  }

  /**
   * Handle root endpoint (documentation)
   */
  private async handleRoot(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const endpoints = this.getAvailableEndpoints();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Matrix Google Play Bridge - Monitoring</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 2em; }
        .endpoint { background: #f5f5f5; padding: 0.5em; margin: 0.5em 0; border-radius: 4px; }
        .status-healthy { color: green; font-weight: bold; }
        .status-degraded { color: orange; font-weight: bold; }
        .status-unhealthy { color: red; font-weight: bold; }
    </style>
</head>
<body>
    <h1>Matrix Google Play Bridge - Monitoring</h1>
    
    <h2>Available Endpoints</h2>
    ${endpoints.map(ep => `<div class="endpoint"><strong>${ep.path}</strong> - ${ep.description}</div>`).join('')}
    
    <h2>System Information</h2>
    <ul>
        <li><strong>Version:</strong> ${this.healthMonitor?.getCachedHealth().version || 'Unknown'}</li>
        <li><strong>Uptime:</strong> ${Math.round((Date.now() - this.startTime.getTime()) / 1000)}s</li>
        <li><strong>Node Version:</strong> ${process.version}</li>
        <li><strong>Platform:</strong> ${process.platform}</li>
        <li><strong>Total Requests:</strong> ${this.requestCount}</li>
    </ul>
    
    <h2>Quick Status</h2>
    <div id="status">Loading...</div>
    
    <script>
        fetch('/health')
            .then(res => res.json())
            .then(data => {
                const statusEl = document.getElementById('status');
                const statusClass = 'status-' + data.status;
                statusEl.innerHTML = '<span class="' + statusClass + '">' + data.status.toUpperCase() + '</span>';
            })
            .catch(() => {
                document.getElementById('status').innerHTML = '<span class="status-unhealthy">ERROR</span>';
            });
    </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
  }

  /**
   * Handle health endpoint
   */
  private async handleHealth(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (!this.healthMonitor) {
      this.sendError(res, 503, 'Health monitor not configured');
      return;
    }

    try {
      const health = await this.healthMonitor.getSystemHealth();
      const statusCode =
        health.status === HealthStatus.HEALTHY
          ? 200
          : health.status === HealthStatus.DEGRADED
            ? 200
            : 503;

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(statusCode);
      res.end(JSON.stringify(health, null, 2));
    } catch (error) {
      this.logger.error('Error getting system health', error);
      this.sendError(res, 500, 'Health check failed');
    }
  }

  /**
   * Handle readiness check (for Kubernetes)
   */
  private async handleReadiness(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (!this.healthMonitor) {
      this.sendError(res, 503, 'Not ready - health monitor not configured');
      return;
    }

    try {
      const health = await this.healthMonitor.getSystemHealth();
      const isReady = health.status !== HealthStatus.UNHEALTHY;

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(isReady ? 200 : 503);
      res.end(
        JSON.stringify({
          status: isReady ? 'ready' : 'not ready',
          checks: health.checks.map(c => ({
            name: c.name,
            status: c.status,
            message: c.message,
          })),
        })
      );
    } catch (error) {
      this.logger.error('Error in readiness check', error);
      this.sendError(res, 500, 'Readiness check failed');
    }
  }

  /**
   * Handle liveness check (for Kubernetes)
   */
  private async handleLiveness(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Simple liveness check - if we can respond, we're alive
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - this.startTime.getTime(),
      })
    );
  }

  /**
   * Handle metrics endpoint (Prometheus format)
   */
  private async handleMetrics(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      // Update runtime metrics
      this.updateRuntimeMetrics();

      // Generate Prometheus format
      const prometheus = this.generatePrometheusMetrics();

      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.writeHead(200);
      res.end(prometheus);
    } catch (error) {
      this.logger.error('Error generating metrics', error);
      this.sendError(res, 500, 'Metrics generation failed');
    }
  }

  /**
   * Handle status endpoint
   */
  private async handleStatus(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const status = {
      service: 'matrix-googleplay-bridge',
      version: this.healthMonitor?.getCachedHealth().version || 'Unknown',
      uptime: Date.now() - this.startTime.getTime(),
      timestamp: new Date().toISOString(),
      requests: {
        total: this.requestCount,
        rate:
          this.requestCount /
          ((Date.now() - this.startTime.getTime()) / 1000 / 60), // per minute
      },
      memory: process.memoryUsage(),
      health: this.healthMonitor
        ? this.healthMonitor.getCachedHealth().status
        : 'unknown',
    };

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(status, null, 2));
  }

  /**
   * Update runtime metrics
   */
  private updateRuntimeMetrics(): void {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    this.recordMetric(
      'nodejs_memory_heap_used_bytes',
      memUsage.heapUsed,
      {},
      { help: 'Heap memory used in bytes' }
    );
    this.recordMetric(
      'nodejs_memory_heap_total_bytes',
      memUsage.heapTotal,
      {},
      { help: 'Total heap memory in bytes' }
    );
    this.recordMetric(
      'nodejs_memory_external_bytes',
      memUsage.external,
      {},
      { help: 'External memory in bytes' }
    );
    this.recordMetric(
      'nodejs_memory_rss_bytes',
      memUsage.rss,
      {},
      { help: 'Resident set size in bytes' }
    );

    this.recordMetric(
      'process_cpu_user_seconds_total',
      cpuUsage.user / 1000000,
      {},
      { help: 'User CPU time in seconds', type: 'counter' }
    );
    this.recordMetric(
      'process_cpu_system_seconds_total',
      cpuUsage.system / 1000000,
      {},
      { help: 'System CPU time in seconds', type: 'counter' }
    );

    this.recordMetric(
      'process_uptime_seconds',
      (Date.now() - this.startTime.getTime()) / 1000,
      {},
      { help: 'Process uptime in seconds' }
    );
  }

  /**
   * Generate Prometheus format metrics
   */
  public generatePrometheusMetrics(): string {
    const lines: string[] = [];
    const processedMetrics = new Set<string>();

    for (const [_key, metric] of this.metrics) {
      // Add help text (once per metric name)
      if (metric.help && !processedMetrics.has(metric.name)) {
        lines.push(`# HELP ${metric.name} ${metric.help}`);
        processedMetrics.add(metric.name);
      }

      // Add type (once per metric name)
      if (metric.type && !processedMetrics.has(`${metric.name}_type`)) {
        lines.push(`# TYPE ${metric.name} ${metric.type}`);
        processedMetrics.add(`${metric.name}_type`);
      }

      // Add metric value
      const labelStr = metric.labels
        ? `{${this.serializeLabels(metric.labels)}}`
        : '';
      lines.push(`${metric.name}${labelStr} ${metric.value}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Serialize labels for Prometheus format
   */
  private serializeLabels(labels: Record<string, string>): string {
    return Object.entries(labels)
      .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
      .join(',');
  }

  /**
   * Get available endpoints
   */
  private getAvailableEndpoints(): Array<{
    path: string;
    description: string;
  }> {
    const endpoints = [];

    if (this.config.enableDocs) {
      endpoints.push({ path: '/', description: 'This documentation page' });
    }

    if (this.config.enableHealthCheck) {
      endpoints.push(
        {
          path: '/health',
          description: 'Complete health check with all tests',
        },
        { path: '/health/ready', description: 'Readiness probe (Kubernetes)' },
        { path: '/health/live', description: 'Liveness probe (Kubernetes)' }
      );
    }

    if (this.config.enableMetrics) {
      endpoints.push({ path: '/metrics', description: 'Prometheus metrics' });
    }

    endpoints.push({
      path: '/status',
      description: 'Service status and runtime information',
    });

    return endpoints;
  }

  /**
   * Send 404 response
   */
  private send404(res: http.ServerResponse): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    res.end(
      JSON.stringify({
        error: 'Not Found',
        message: 'The requested endpoint was not found',
        availableEndpoints: this.getAvailableEndpoints().map(ep => ep.path),
      })
    );
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
        error: http.STATUS_CODES[statusCode] || 'Unknown Error',
        message,
        timestamp: new Date().toISOString(),
      })
    );
  }
}
