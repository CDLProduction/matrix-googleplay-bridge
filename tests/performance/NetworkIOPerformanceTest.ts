import { GooglePlayBridge } from '../../src/bridge/GooglePlayBridge';
import { MockReviewGenerator } from './MockReviewGenerator';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import { performance } from 'perf_hooks';

const Logger = require('../../src/utils/Logger').Logger;
const logger = Logger.getInstance('NetworkIOPerformanceTest');

interface NetworkMetrics {
    timestamp: number;
    bytesSent: number;
    bytesReceived: number;
    requestsCount: number;
    responsesCount: number;
    activeConnections: number;
    latencyMs: number;
    throughputMbps: number;
    errorCount: number;
    timeoutCount: number;
}

interface LatencyBucket {
    min: number;
    max: number;
    count: number;
    percentage: number;
}

interface NetworkScenarioResult {
    name: string;
    duration: number;
    metrics: NetworkMetrics[];
    latencyStats: {
        min: number;
        max: number;
        avg: number;
        p50: number;
        p75: number;
        p90: number;
        p95: number;
        p99: number;
        buckets: LatencyBucket[];
    };
    throughputStats: {
        min: number;
        max: number;
        avg: number;
        peak: number;
    };
    connectionStats: {
        total: number;
        reused: number;
        failed: number;
        reuseRate: number;
    };
    errorStats: {
        total: number;
        timeouts: number;
        connectionErrors: number;
        protocolErrors: number;
        errorRate: number;
    };
}

interface ConnectionInfo {
    id: string;
    startTime: number;
    endTime?: number;
    bytesTransferred: number;
    requestCount: number;
    errors: number;
    reused: boolean;
    protocol: string;
}

interface NetworkIOResults {
    testDuration: number;
    scenarios: NetworkScenarioResult[];
    overallStats: {
        totalBytesSent: number;
        totalBytesReceived: number;
        totalRequests: number;
        totalResponses: number;
        avgLatency: number;
        avgThroughput: number;
        peakThroughput: number;
        connectionReuseRate: number;
        errorRate: number;
        timeoutRate: number;
    };
    latencyDistribution: {
        percentiles: Record<string, number>;
        histogram: LatencyBucket[];
    };
    connectionPoolAnalysis: {
        efficiency: number;
        avgConnectionLifetime: number;
        connectionChurn: number;
        poolUtilization: number;
    };
    protocolAnalysis: {
        http: number;
        https: number;
        ws: number;
        overhead: number;
    };
    bottlenecks: {
        category: string;
        impact: string;
        recommendation: string;
    }[];
    optimization: {
        recommendations: string[];
        estimatedImprovement: number;
        priority: string[];
    };
    testPassed: boolean;
    failureReasons: string[];
}

export class NetworkIOPerformanceTest {
    private bridge: GooglePlayBridge | null = null;
    private mockGenerator: MockReviewGenerator;
    private config: any;
    private startTime: number = 0;
    private metrics: NetworkMetrics[] = [];
    private scenarios: NetworkScenarioResult[] = [];
    private connections: Map<string, ConnectionInfo> = new Map();
    private latencies: number[] = [];
    private throughputs: number[] = [];
    private bytesSent: number = 0;
    private bytesReceived: number = 0;
    private requestCount: number = 0;
    private responseCount: number = 0;
    private errorCount: number = 0;
    private timeoutCount: number = 0;
    private metricsCollector: NodeJS.Timer | null = null;
    private httpAgent: http.Agent | null = null;
    private httpsAgent: https.Agent | null = null;
    private activeRequests: Set<string> = new Set();
    private connectionPool: Map<string, net.Socket> = new Map();

    constructor() {
        this.mockGenerator = new MockReviewGenerator();
        this.initializeAgents();
    }

    private initializeAgents(): void {
        // Initialize HTTP agents with connection pooling
        this.httpAgent = new http.Agent({
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 50,
            maxFreeSockets: 10
        });

        this.httpsAgent = new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 50,
            maxFreeSockets: 10
        });
    }

    async runNetworkIOTest(): Promise<NetworkIOResults> {
        logger.info('🌐 Starting Network I/O Performance Test (Scenario 3.3)');
        logger.info('Duration: 1 hour with various network conditions');

        try {
            await this.loadConfiguration();
            await this.initializeBridge();
            this.startMonitoring();

            const results = await this.executeNetworkScenarios();
            
            await this.cleanup();
            return this.generateResults(results);
        } catch (error) {
            logger.error('Network I/O test failed:', error);
            throw error;
        }
    }

    private async loadConfiguration(): Promise<void> {
        const configPath = path.join(process.cwd(), 'config', 'performance-network-io.yaml');
        
        if (!fs.existsSync(configPath)) {
            logger.warn('Network I/O config not found, using defaults');
            this.config = this.getDefaultConfig();
        } else {
            const yaml = await import('js-yaml');
            const configContent = fs.readFileSync(configPath, 'utf8');
            this.config = yaml.load(configContent);
        }

        logger.info('Configuration loaded:', {
            duration: this.config.performance.testDuration,
            scenarios: this.config.performance.networkScenarios.length,
            expectedMetrics: this.config.performance.expectedMetrics
        });
    }

    private getDefaultConfig(): any {
        return {
            performance: {
                testDuration: 3600000, // 1 hour
                networkMonitoring: {
                    enabled: true,
                    captureInterval: 1000
                },
                expectedMetrics: {
                    avgLatencyMs: 50,
                    p95LatencyMs: 200,
                    p99LatencyMs: 500,
                    maxLatencyMs: 2000,
                    minThroughputMbps: 10,
                    avgThroughputMbps: 50,
                    maxConcurrentConnections: 100,
                    connectionReuseRate: 0.8,
                    errorRate: 0.01,
                    timeoutRate: 0.001
                },
                networkScenarios: [
                    {
                        name: 'normal_conditions',
                        duration: 900000,
                        requestRate: 50,
                        payloadSize: 'medium'
                    },
                    {
                        name: 'high_latency',
                        duration: 600000,
                        latency: 500,
                        requestRate: 30,
                        payloadSize: 'medium'
                    },
                    {
                        name: 'limited_bandwidth',
                        duration: 600000,
                        bandwidth: '1mbps',
                        requestRate: 20,
                        payloadSize: 'large'
                    }
                ]
            }
        };
    }

    private async initializeBridge(): Promise<void> {
        logger.info('Initializing bridge for network testing...');
        
        const bridgeConfig = {
            ...this.config.bridge,
            database: { engine: 'sqlite', filename: ':memory:' }
        };

        this.bridge = new GooglePlayBridge(bridgeConfig);
        
        // Initialize with mock data
        await this.setupMockEnvironment();
        
        logger.info('Bridge initialized with mock environment');
    }

    private async setupMockEnvironment(): Promise<void> {
        // Setup mock apps and reviews
        if (this.config.apps) {
            for (const app of this.config.apps) {
                await this.mockGenerator.generateReviews(app.packageName, 50);
            }
        }
    }

    private startMonitoring(): void {
        this.startTime = Date.now();

        // Start metrics collection
        this.metricsCollector = setInterval(() => {
            this.collectMetrics();
        }, this.config.performance.networkMonitoring?.captureInterval || 1000);

        // Monitor connection pool
        this.startConnectionMonitoring();

        logger.info('Network monitoring started');
    }

    private startConnectionMonitoring(): void {
        // Track HTTP agent connections
        if (this.httpAgent) {
            const originalCreateConnection = this.httpAgent.createConnection;
            this.httpAgent.createConnection = (options, callback) => {
                const socket = originalCreateConnection.call(this.httpAgent, options, callback);
                this.trackConnection(socket as net.Socket, 'http');
                return socket;
            };
        }

        // Track HTTPS agent connections
        if (this.httpsAgent) {
            const originalCreateConnection = this.httpsAgent.createConnection;
            this.httpsAgent.createConnection = (options, callback) => {
                const socket = originalCreateConnection.call(this.httpsAgent, options, callback);
                this.trackConnection(socket as net.Socket, 'https');
                return socket;
            };
        }
    }

    private trackConnection(socket: net.Socket, protocol: string): void {
        const connectionId = `${protocol}-${Date.now()}-${Math.random()}`;
        
        const connectionInfo: ConnectionInfo = {
            id: connectionId,
            startTime: Date.now(),
            bytesTransferred: 0,
            requestCount: 0,
            errors: 0,
            reused: false,
            protocol
        };

        this.connections.set(connectionId, connectionInfo);
        this.connectionPool.set(connectionId, socket);

        // Track socket events
        socket.on('data', (chunk) => {
            connectionInfo.bytesTransferred += chunk.length;
            this.bytesReceived += chunk.length;
        });

        socket.on('close', () => {
            connectionInfo.endTime = Date.now();
            this.connectionPool.delete(connectionId);
        });

        socket.on('error', () => {
            connectionInfo.errors++;
            this.errorCount++;
        });
    }

    private collectMetrics(): void {
        const now = Date.now();
        const elapsedSeconds = (now - this.startTime) / 1000;

        // Calculate current throughput
        const throughputMbps = elapsedSeconds > 0 
            ? ((this.bytesSent + this.bytesReceived) * 8) / (elapsedSeconds * 1000000)
            : 0;

        // Calculate average latency
        const avgLatency = this.latencies.length > 0
            ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
            : 0;

        const metric: NetworkMetrics = {
            timestamp: now,
            bytesSent: this.bytesSent,
            bytesReceived: this.bytesReceived,
            requestsCount: this.requestCount,
            responsesCount: this.responseCount,
            activeConnections: this.connectionPool.size,
            latencyMs: avgLatency,
            throughputMbps,
            errorCount: this.errorCount,
            timeoutCount: this.timeoutCount
        };

        this.metrics.push(metric);
        this.throughputs.push(throughputMbps);

        // Log if thresholds are exceeded
        if (avgLatency > this.config.performance.expectedMetrics.maxLatencyMs) {
            logger.warn(`High latency detected: ${avgLatency.toFixed(2)}ms`);
        }

        if (throughputMbps < this.config.performance.expectedMetrics.minThroughputMbps) {
            logger.warn(`Low throughput detected: ${throughputMbps.toFixed(2)} Mbps`);
        }
    }

    private async executeNetworkScenarios(): Promise<any> {
        const scenarios = this.config.performance.networkScenarios;
        
        for (const scenarioConfig of scenarios) {
            logger.info(`\n🔄 Executing scenario: ${scenarioConfig.name}`);
            logger.info(`Duration: ${scenarioConfig.duration / 1000}s`);
            
            const scenarioResult = await this.executeScenario(scenarioConfig);
            this.scenarios.push(scenarioResult);
            
            // Brief pause between scenarios
            await this.sleep(5000);
        }

        return {
            scenarios: this.scenarios,
            metrics: this.metrics
        };
    }

    private async executeScenario(config: any): Promise<NetworkScenarioResult> {
        const startTime = Date.now();
        const endTime = startTime + config.duration;
        const scenarioMetrics: NetworkMetrics[] = [];
        const scenarioLatencies: number[] = [];
        const scenarioConnections = new Map<string, ConnectionInfo>();

        // Apply network conditions if specified
        await this.applyNetworkConditions(config);

        // Execute scenario workload
        switch (config.name) {
            case 'normal_conditions':
                await this.executeNormalConditions(config, endTime, scenarioMetrics, scenarioLatencies);
                break;
            case 'high_latency':
                await this.executeHighLatency(config, endTime, scenarioMetrics, scenarioLatencies);
                break;
            case 'limited_bandwidth':
                await this.executeLimitedBandwidth(config, endTime, scenarioMetrics, scenarioLatencies);
                break;
            case 'packet_loss':
                await this.executePacketLoss(config, endTime, scenarioMetrics, scenarioLatencies);
                break;
            case 'network_congestion':
                await this.executeNetworkCongestion(config, endTime, scenarioMetrics, scenarioLatencies);
                break;
            case 'burst_traffic':
                await this.executeBurstTraffic(config, endTime, scenarioMetrics, scenarioLatencies);
                break;
            default:
                await this.executeGenericScenario(config, endTime, scenarioMetrics, scenarioLatencies);
        }

        // Calculate scenario statistics
        return this.calculateScenarioStats(config.name, config.duration, scenarioMetrics, scenarioLatencies);
    }

    private async applyNetworkConditions(config: any): Promise<void> {
        // In a real implementation, this would configure network conditions
        // For testing, we simulate conditions through delays and artificial constraints
        
        if (config.latency) {
            logger.info(`Applying latency: ${config.latency}ms`);
        }
        
        if (config.bandwidth) {
            logger.info(`Applying bandwidth limit: ${config.bandwidth}`);
        }
        
        if (config.packetLoss) {
            logger.info(`Applying packet loss: ${config.packetLoss}%`);
        }
    }

    private async executeNormalConditions(
        config: any, 
        endTime: number,
        metrics: NetworkMetrics[],
        latencies: number[]
    ): Promise<void> {
        const requestInterval = 1000 / (config.requestRate || 50);
        
        while (Date.now() < endTime) {
            const requests = [];
            
            // Generate parallel requests
            for (let i = 0; i < 5; i++) {
                requests.push(this.simulateNetworkRequest('medium', latencies));
            }
            
            await Promise.all(requests);
            await this.sleep(requestInterval);
            
            // Collect scenario-specific metrics
            this.collectScenarioMetrics(metrics);
        }
    }

    private async executeHighLatency(
        config: any,
        endTime: number,
        metrics: NetworkMetrics[],
        latencies: number[]
    ): Promise<void> {
        const baseLatency = config.latency || 500;
        const requestInterval = 1000 / (config.requestRate || 30);
        
        while (Date.now() < endTime) {
            // Simulate high latency requests
            await this.simulateNetworkRequest('medium', latencies, baseLatency);
            await this.sleep(requestInterval);
            
            this.collectScenarioMetrics(metrics);
        }
    }

    private async executeLimitedBandwidth(
        config: any,
        endTime: number,
        metrics: NetworkMetrics[],
        latencies: number[]
    ): Promise<void> {
        const requestInterval = 1000 / (config.requestRate || 20);
        const bandwidth = this.parseBandwidth(config.bandwidth || '1mbps');
        
        while (Date.now() < endTime) {
            // Simulate bandwidth-limited transfers
            const payloadSize = this.getPayloadSize('large');
            const transferTime = (payloadSize * 8) / bandwidth * 1000; // ms
            
            await this.simulateNetworkRequest('large', latencies, transferTime);
            await this.sleep(requestInterval);
            
            this.collectScenarioMetrics(metrics);
        }
    }

    private async executePacketLoss(
        config: any,
        endTime: number,
        metrics: NetworkMetrics[],
        latencies: number[]
    ): Promise<void> {
        const packetLossRate = (config.packetLoss || 5) / 100;
        const requestInterval = 1000 / (config.requestRate || 40);
        
        while (Date.now() < endTime) {
            // Simulate packet loss through random failures
            if (Math.random() < packetLossRate) {
                this.errorCount++;
                await this.simulateFailedRequest();
            } else {
                await this.simulateNetworkRequest('medium', latencies);
            }
            
            await this.sleep(requestInterval);
            this.collectScenarioMetrics(metrics);
        }
    }

    private async executeNetworkCongestion(
        config: any,
        endTime: number,
        metrics: NetworkMetrics[],
        latencies: number[]
    ): Promise<void> {
        const requestInterval = 1000 / (config.requestRate || 60);
        
        while (Date.now() < endTime) {
            // Simulate congestion with variable delays and concurrent requests
            const concurrentRequests = Math.floor(Math.random() * 10) + 5;
            const requests = [];
            
            for (let i = 0; i < concurrentRequests; i++) {
                const delay = 200 + Math.random() * 300; // Variable delay
                requests.push(this.simulateNetworkRequest('mixed', latencies, delay));
            }
            
            await Promise.race([
                Promise.all(requests),
                this.timeout(5000) // Some requests may timeout
            ]).catch(() => {
                this.timeoutCount++;
            });
            
            await this.sleep(requestInterval);
            this.collectScenarioMetrics(metrics);
        }
    }

    private async executeBurstTraffic(
        config: any,
        endTime: number,
        metrics: NetworkMetrics[],
        latencies: number[]
    ): Promise<void> {
        const burstSize = config.burstSize || 500;
        const burstInterval = config.burstInterval || 30000;
        const idleInterval = config.idleInterval || 30000;
        
        while (Date.now() < endTime) {
            // Burst phase
            logger.info(`📈 Traffic burst: ${burstSize} requests`);
            const burstRequests = [];
            
            for (let i = 0; i < burstSize; i++) {
                burstRequests.push(this.simulateNetworkRequest('mixed', latencies));
            }
            
            await Promise.all(burstRequests);
            this.collectScenarioMetrics(metrics);
            
            // Idle phase
            logger.info(`📉 Idle period: ${idleInterval / 1000}s`);
            await this.sleep(Math.min(idleInterval, endTime - Date.now()));
        }
    }

    private async executeGenericScenario(
        config: any,
        endTime: number,
        metrics: NetworkMetrics[],
        latencies: number[]
    ): Promise<void> {
        const requestInterval = 1000 / (config.requestRate || 30);
        
        while (Date.now() < endTime) {
            await this.simulateNetworkRequest(config.payloadSize || 'medium', latencies);
            await this.sleep(requestInterval);
            this.collectScenarioMetrics(metrics);
        }
    }

    private async simulateNetworkRequest(
        payloadSize: string,
        latencies: number[],
        additionalDelay: number = 0
    ): Promise<void> {
        const requestId = `req-${Date.now()}-${Math.random()}`;
        this.activeRequests.add(requestId);
        this.requestCount++;

        const startTime = performance.now();
        
        try {
            // Simulate payload creation
            const payload = this.generatePayload(payloadSize);
            this.bytesSent += payload.length;

            // Simulate network delay
            const baseLatency = 10 + Math.random() * 40;
            const totalLatency = baseLatency + additionalDelay;
            await this.sleep(totalLatency);

            // Simulate response
            const responseSize = this.getResponseSize(payloadSize);
            this.bytesReceived += responseSize;
            this.responseCount++;

            const endTime = performance.now();
            const latency = endTime - startTime;
            
            latencies.push(latency);
            this.latencies.push(latency);

            // Track connection reuse
            if (Math.random() < 0.8) { // 80% connection reuse
                this.trackConnectionReuse();
            }
        } catch (error) {
            this.errorCount++;
            logger.error('Request failed:', error);
        } finally {
            this.activeRequests.delete(requestId);
        }
    }

    private async simulateFailedRequest(): Promise<void> {
        this.requestCount++;
        await this.sleep(100);
        this.errorCount++;
    }

    private generatePayload(size: string): Buffer {
        const sizes = this.config.performance?.payloadSizes || {
            small: { text: 100 },
            medium: { text: 1000 },
            large: { text: 10000 },
            huge: { text: 100000 }
        };

        const payloadSize = sizes[size]?.text || 1000;
        return Buffer.alloc(payloadSize, 'a');
    }

    private getPayloadSize(size: string): number {
        const sizes = this.config.performance?.payloadSizes || {
            small: { text: 100 },
            medium: { text: 1000 },
            large: { text: 10000 },
            huge: { text: 100000 }
        };

        return sizes[size]?.text || 1000;
    }

    private getResponseSize(requestSize: string): number {
        // Response is typically larger than request
        const multiplier = 1.5 + Math.random();
        return Math.floor(this.getPayloadSize(requestSize) * multiplier);
    }

    private trackConnectionReuse(): void {
        // Find a random existing connection to mark as reused
        const connections = Array.from(this.connections.values());
        if (connections.length > 0) {
            const connection = connections[Math.floor(Math.random() * connections.length)];
            connection.reused = true;
            connection.requestCount++;
        }
    }

    private collectScenarioMetrics(metrics: NetworkMetrics[]): void {
        const currentMetric = this.metrics[this.metrics.length - 1];
        if (currentMetric) {
            metrics.push({ ...currentMetric });
        }
    }

    private parseBandwidth(bandwidth: string): number {
        // Parse bandwidth string to bits per second
        const match = bandwidth.match(/(\d+)(mbps|kbps|gbps)/i);
        if (!match) return 1000000; // Default 1 Mbps

        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        switch (unit) {
            case 'kbps': return value * 1000;
            case 'mbps': return value * 1000000;
            case 'gbps': return value * 1000000000;
            default: return value * 1000000;
        }
    }

    private calculateScenarioStats(
        name: string,
        duration: number,
        metrics: NetworkMetrics[],
        latencies: number[]
    ): NetworkScenarioResult {
        // Calculate latency statistics
        const sortedLatencies = [...latencies].sort((a, b) => a - b);
        const latencyStats = {
            min: Math.min(...latencies),
            max: Math.max(...latencies),
            avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
            p50: this.getPercentile(sortedLatencies, 50),
            p75: this.getPercentile(sortedLatencies, 75),
            p90: this.getPercentile(sortedLatencies, 90),
            p95: this.getPercentile(sortedLatencies, 95),
            p99: this.getPercentile(sortedLatencies, 99),
            buckets: this.createLatencyBuckets(latencies)
        };

        // Calculate throughput statistics
        const throughputs = metrics.map(m => m.throughputMbps);
        const throughputStats = {
            min: Math.min(...throughputs),
            max: Math.max(...throughputs),
            avg: throughputs.reduce((a, b) => a + b, 0) / throughputs.length,
            peak: Math.max(...throughputs)
        };

        // Calculate connection statistics
        const connections = Array.from(this.connections.values());
        const reusedConnections = connections.filter(c => c.reused).length;
        const failedConnections = connections.filter(c => c.errors > 0).length;
        
        const connectionStats = {
            total: connections.length,
            reused: reusedConnections,
            failed: failedConnections,
            reuseRate: connections.length > 0 ? reusedConnections / connections.length : 0
        };

        // Calculate error statistics
        const totalRequests = metrics[metrics.length - 1]?.requestsCount || 0;
        const totalErrors = metrics[metrics.length - 1]?.errorCount || 0;
        const totalTimeouts = metrics[metrics.length - 1]?.timeoutCount || 0;
        
        const errorStats = {
            total: totalErrors,
            timeouts: totalTimeouts,
            connectionErrors: failedConnections,
            protocolErrors: totalErrors - totalTimeouts - failedConnections,
            errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0
        };

        return {
            name,
            duration,
            metrics,
            latencyStats,
            throughputStats,
            connectionStats,
            errorStats
        };
    }

    private getPercentile(sortedArray: number[], percentile: number): number {
        if (sortedArray.length === 0) return 0;
        const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
        return sortedArray[Math.max(0, index)];
    }

    private createLatencyBuckets(latencies: number[]): LatencyBucket[] {
        const bucketRanges = this.config.performance?.analysis?.latencyAnalysis?.buckets || 
                           [10, 25, 50, 100, 200, 500, 1000, 2000, 5000];
        
        const buckets: LatencyBucket[] = [];
        let previousMax = 0;

        for (const max of bucketRanges) {
            const count = latencies.filter(l => l > previousMax && l <= max).length;
            buckets.push({
                min: previousMax,
                max,
                count,
                percentage: (count / latencies.length) * 100
            });
            previousMax = max;
        }

        // Add bucket for values above the highest range
        const count = latencies.filter(l => l > previousMax).length;
        if (count > 0) {
            buckets.push({
                min: previousMax,
                max: Infinity,
                count,
                percentage: (count / latencies.length) * 100
            });
        }

        return buckets;
    }

    private analyzeConnectionPool(): any {
        const connections = Array.from(this.connections.values());
        const completedConnections = connections.filter(c => c.endTime);
        
        const lifetimes = completedConnections.map(c => 
            (c.endTime || Date.now()) - c.startTime
        );
        
        const avgLifetime = lifetimes.length > 0
            ? lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length
            : 0;

        const reuseRate = connections.length > 0
            ? connections.filter(c => c.reused).length / connections.length
            : 0;

        const poolSize = this.config.performance?.connectionPool?.maxSize || 20;
        const utilization = this.connectionPool.size / poolSize;

        // Calculate connection churn (new connections per minute)
        const testDuration = (Date.now() - this.startTime) / 60000; // minutes
        const churn = connections.length / testDuration;

        return {
            efficiency: reuseRate,
            avgConnectionLifetime: avgLifetime,
            connectionChurn: churn,
            poolUtilization: utilization
        };
    }

    private analyzeProtocols(): any {
        const connections = Array.from(this.connections.values());
        const total = connections.length || 1;

        const httpCount = connections.filter(c => c.protocol === 'http').length;
        const httpsCount = connections.filter(c => c.protocol === 'https').length;
        
        // Calculate protocol overhead (HTTPS vs HTTP)
        const overhead = httpsCount > 0 ? (httpsCount / total) * 0.1 : 0; // Assume 10% overhead for HTTPS

        return {
            http: (httpCount / total) * 100,
            https: (httpsCount / total) * 100,
            ws: 0, // WebSocket not implemented in this simulation
            overhead: overhead * 100
        };
    }

    private identifyBottlenecks(): any[] {
        const bottlenecks = [];
        const avgLatency = this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
        const avgThroughput = this.throughputs.reduce((a, b) => a + b, 0) / this.throughputs.length;
        const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;

        if (avgLatency > this.config.performance.expectedMetrics.avgLatencyMs * 2) {
            bottlenecks.push({
                category: 'Latency',
                impact: 'High',
                recommendation: 'Implement request caching and optimize API calls'
            });
        }

        if (avgThroughput < this.config.performance.expectedMetrics.minThroughputMbps) {
            bottlenecks.push({
                category: 'Throughput',
                impact: 'High',
                recommendation: 'Enable compression and implement request batching'
            });
        }

        if (this.connectionPool.size > this.config.performance.expectedMetrics.maxConcurrentConnections) {
            bottlenecks.push({
                category: 'Connection Pool',
                impact: 'Medium',
                recommendation: 'Increase connection pool size and implement connection reuse'
            });
        }

        if (errorRate > this.config.performance.expectedMetrics.errorRate) {
            bottlenecks.push({
                category: 'Error Rate',
                impact: 'High',
                recommendation: 'Implement retry logic with exponential backoff'
            });
        }

        return bottlenecks;
    }

    private generateOptimizationRecommendations(): any {
        const recommendations: string[] = [];
        const avgLatency = this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
        const connectionReuseRate = this.analyzeConnectionPool().efficiency;

        if (avgLatency > 100) {
            recommendations.push('HIGH PRIORITY: Implement response caching to reduce API latency');
            recommendations.push('HIGH PRIORITY: Use CDN for static content delivery');
        }

        if (connectionReuseRate < 0.7) {
            recommendations.push('MEDIUM PRIORITY: Improve connection pooling configuration');
            recommendations.push('MEDIUM PRIORITY: Implement HTTP/2 for multiplexing');
        }

        if (this.timeoutCount > 10) {
            recommendations.push('HIGH PRIORITY: Increase timeout values for slow network conditions');
            recommendations.push('MEDIUM PRIORITY: Implement circuit breaker pattern');
        }

        const estimatedImprovement = Math.min(
            50,
            (avgLatency > 100 ? 20 : 0) +
            (connectionReuseRate < 0.7 ? 15 : 0) +
            (this.timeoutCount > 10 ? 15 : 0)
        );

        return {
            recommendations,
            estimatedImprovement,
            priority: recommendations
                .filter(r => r.includes('HIGH PRIORITY'))
                .map(r => r.replace('HIGH PRIORITY: ', ''))
        };
    }

    private generateResults(data: any): NetworkIOResults {
        const avgLatency = this.latencies.length > 0
            ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
            : 0;

        const avgThroughput = this.throughputs.length > 0
            ? this.throughputs.reduce((a, b) => a + b, 0) / this.throughputs.length
            : 0;

        const peakThroughput = this.throughputs.length > 0
            ? Math.max(...this.throughputs)
            : 0;

        const connectionReuseRate = this.analyzeConnectionPool().efficiency;
        const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;
        const timeoutRate = this.requestCount > 0 ? this.timeoutCount / this.requestCount : 0;

        // Create latency distribution
        const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
        const percentiles: Record<string, number> = {};
        
        for (const p of [50, 75, 90, 95, 99, 99.9]) {
            percentiles[`p${p}`] = this.getPercentile(sortedLatencies, p);
        }

        // Determine test pass/fail
        const failureReasons: string[] = [];
        const expectedMetrics = this.config.performance.expectedMetrics;

        if (avgLatency > expectedMetrics.avgLatencyMs) {
            failureReasons.push(`Average latency ${avgLatency.toFixed(2)}ms exceeds threshold ${expectedMetrics.avgLatencyMs}ms`);
        }

        if (percentiles.p95 > expectedMetrics.p95LatencyMs) {
            failureReasons.push(`P95 latency ${percentiles.p95.toFixed(2)}ms exceeds threshold ${expectedMetrics.p95LatencyMs}ms`);
        }

        if (avgThroughput < expectedMetrics.minThroughputMbps) {
            failureReasons.push(`Average throughput ${avgThroughput.toFixed(2)} Mbps below minimum ${expectedMetrics.minThroughputMbps} Mbps`);
        }

        if (connectionReuseRate < expectedMetrics.connectionReuseRate) {
            failureReasons.push(`Connection reuse rate ${(connectionReuseRate * 100).toFixed(2)}% below threshold ${(expectedMetrics.connectionReuseRate * 100)}%`);
        }

        if (errorRate > expectedMetrics.errorRate) {
            failureReasons.push(`Error rate ${(errorRate * 100).toFixed(2)}% exceeds threshold ${(expectedMetrics.errorRate * 100)}%`);
        }

        return {
            testDuration: Date.now() - this.startTime,
            scenarios: this.scenarios,
            overallStats: {
                totalBytesSent: this.bytesSent,
                totalBytesReceived: this.bytesReceived,
                totalRequests: this.requestCount,
                totalResponses: this.responseCount,
                avgLatency,
                avgThroughput,
                peakThroughput,
                connectionReuseRate,
                errorRate,
                timeoutRate
            },
            latencyDistribution: {
                percentiles,
                histogram: this.createLatencyBuckets(this.latencies)
            },
            connectionPoolAnalysis: this.analyzeConnectionPool(),
            protocolAnalysis: this.analyzeProtocols(),
            bottlenecks: this.identifyBottlenecks(),
            optimization: this.generateOptimizationRecommendations(),
            testPassed: failureReasons.length === 0,
            failureReasons
        };
    }

    private async cleanup(): Promise<void> {
        logger.info('Cleaning up network I/O test...');

        if (this.metricsCollector) {
            clearInterval(this.metricsCollector as any);
        }

        if (this.httpAgent) {
            this.httpAgent.destroy();
        }

        if (this.httpsAgent) {
            this.httpsAgent.destroy();
        }

        // Close all active connections
        const sockets = Array.from(this.connectionPool.values());
        for (const socket of sockets) {
            socket.destroy();
        }

        if (this.bridge) {
            this.bridge = null;
        }

        // Clear data structures
        this.metrics = [];
        this.scenarios = [];
        this.connections.clear();
        this.connectionPool.clear();
        this.activeRequests.clear();
        this.latencies = [];
        this.throughputs = [];

        logger.info('Cleanup completed');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private timeout(ms: number): Promise<never> {
        return new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), ms)
        );
    }
}

// Export for use in performance runner
export default NetworkIOPerformanceTest;