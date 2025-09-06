import { GooglePlayBridge } from '../../src/bridge/GooglePlayBridge';
import { MockReviewGenerator } from './MockReviewGenerator';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { performance, PerformanceObserver } from 'perf_hooks';
import * as v8 from 'v8';

const Logger = require('../../src/utils/Logger').Logger;

const logger = Logger.getInstance('CPUUsagePatternsTest');

interface CPUMetrics {
    timestamp: number;
    cpuPercent: number;
    cpuTimes: NodeJS.CpuUsage;
    eventLoopLag: number;
    activeHandles: number;
    activeRequests: number;
    memoryUsage: NodeJS.MemoryUsage;
    threadCount?: number;
}

interface CPUSpike {
    timestamp: number;
    duration: number;
    peakUsage: number;
    avgUsage: number;
    cause?: string;
}

interface WorkloadPattern {
    name: string;
    duration: number;
    metrics: CPUMetrics[];
    spikes: CPUSpike[];
    avgCpu: number;
    maxCpu: number;
    eventLoopStats: {
        avg: number;
        max: number;
        p95: number;
        p99: number;
    };
}

interface FunctionProfile {
    name: string;
    selfTime: number;
    totalTime: number;
    callCount: number;
    percentCpu: number;
}

interface CPUBottleneck {
    category: string;
    functions: FunctionProfile[];
    totalCpuPercent: number;
    recommendations: string[];
}

interface CPUPatternsResults {
    testDuration: number;
    patterns: WorkloadPattern[];
    overallMetrics: {
        avgCpuUsage: number;
        maxCpuUsage: number;
        cpuEfficiency: number;
        coreUtilization: number;
        contextSwitches?: number;
    };
    spikes: {
        count: number;
        avgDuration: number;
        maxDuration: number;
        causes: Record<string, number>;
    };
    eventLoop: {
        avgLag: number;
        maxLag: number;
        blockingEvents: number;
        responsiveness: number;
    };
    hotFunctions: FunctionProfile[];
    bottlenecks: CPUBottleneck[];
    optimization: {
        recommendations: string[];
        potentialSavings: number;
        priority: string[];
    };
    testPassed: boolean;
    failureReasons: string[];
}

export class CPUUsagePatternsTest {
    private bridge: GooglePlayBridge | null = null;
    private mockGenerator: MockReviewGenerator;
    private config: any;
    private startTime: number = 0;
    private metrics: CPUMetrics[] = [];
    private patterns: WorkloadPattern[] = [];
    private spikes: CPUSpike[] = [];
    private profileData: any[] = [];
    private eventLoopMonitor: NodeJS.Timer | null = null;
    private metricsCollector: NodeJS.Timer | null = null;
    private lastCpuUsage: NodeJS.CpuUsage | null = null;
    private lastTimestamp: number = 0;
    private currentPattern: WorkloadPattern | null = null;
    private performanceObserver: PerformanceObserver | null = null;
    private functionProfiles: Map<string, FunctionProfile> = new Map();
    private bottlenecks: Map<string, CPUBottleneck> = new Map();

    constructor() {
        this.mockGenerator = new MockReviewGenerator();
        this.initializePerformanceObserver();
    }

    private initializePerformanceObserver(): void {
        this.performanceObserver = new PerformanceObserver((items) => {
            items.getEntries().forEach((entry) => {
                if (entry.entryType === 'function') {
                    this.updateFunctionProfile(entry.name, entry.duration);
                }
            });
        });
        this.performanceObserver.observe({ entryTypes: ['function', 'measure'] });
    }

    async runCPUPatternsTest(): Promise<CPUPatternsResults> {
        logger.info('🖥️ Starting CPU Usage Patterns Test (Scenario 3.2)');
        logger.info('Duration: 2 hours with various workload patterns');

        try {
            await this.loadConfiguration();
            await this.initializeBridge();
            this.startMonitoring();

            const results = await this.executeWorkloadPatterns();
            
            await this.cleanup();
            return this.generateResults(results);
        } catch (error) {
            logger.error('CPU patterns test failed:', error);
            throw error;
        }
    }

    private async loadConfiguration(): Promise<void> {
        const configPath = path.join(process.cwd(), 'config', 'performance-cpu-patterns.yaml');
        
        if (!fs.existsSync(configPath)) {
            logger.warn('CPU patterns config not found, using defaults', {});
            this.config = this.getDefaultConfig();
        } else {
            const yaml = await import('js-yaml');
            const configContent = fs.readFileSync(configPath, 'utf8');
            this.config = yaml.load(configContent);
        }

        logger.info('Configuration loaded:', {
            duration: this.config.performance.testDuration,
            patterns: this.config.performance.workloadPatterns.length,
            cpuThresholds: this.config.performance.expectedMetrics
        });
    }

    private getDefaultConfig(): any {
        return {
            performance: {
                testDuration: 7200000, // 2 hours
                cpuProfiling: {
                    enabled: true,
                    sampleInterval: 100,
                    profileDuration: 60000,
                    captureInterval: 300000
                },
                expectedMetrics: {
                    avgCpuUsagePercent: 30,
                    maxCpuUsagePercent: 80,
                    spikeThreshold: 60,
                    maxSpikeDuration: 5000,
                    maxSpikesPerHour: 10,
                    maxEventLoopLag: 100,
                    avgEventLoopLag: 20
                },
                workloadPatterns: [
                    {
                        name: 'steady_state',
                        duration: 1800000,
                        reviewsPerMinute: 10,
                        messagesPerMinute: 20,
                        concurrentUsers: 5
                    },
                    {
                        name: 'peak_load',
                        duration: 900000,
                        reviewsPerMinute: 50,
                        messagesPerMinute: 100,
                        concurrentUsers: 20
                    },
                    {
                        name: 'burst_traffic',
                        duration: 600000,
                        burstSize: 100,
                        burstInterval: 60000,
                        baselineLoad: 5
                    }
                ]
            }
        };
    }

    private async initializeBridge(): Promise<void> {
        logger.info('Initializing bridge for CPU testing...');
        
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
                await this.mockGenerator.generateReviews(app.packageName, 100);
            }
        }
    }

    private startMonitoring(): void {
        this.startTime = Date.now();
        this.lastTimestamp = this.startTime;
        this.lastCpuUsage = process.cpuUsage();

        // Start metrics collection
        this.metricsCollector = setInterval(() => {
            this.collectMetrics();
        }, 1000); // Collect every second

        // Start event loop monitoring
        this.startEventLoopMonitoring();

        // Start CPU profiling if enabled
        if (this.config.performance.cpuProfiling?.enabled) {
            this.startCPUProfiling();
        }

        logger.info('Monitoring started');
    }

    private startEventLoopMonitoring(): void {
        let lastCheck = Date.now();
        
        this.eventLoopMonitor = setInterval(() => {
            const now = Date.now();
            const lag = now - lastCheck - 100; // Expected 100ms interval
            
            if (lag > 0) {
                const currentMetric = this.metrics[this.metrics.length - 1];
                if (currentMetric) {
                    currentMetric.eventLoopLag = lag;
                }

                if (lag > this.config.performance.expectedMetrics.eventLoopBlockingThreshold) {
                    logger.warn(`Event loop blocked for ${lag}ms`);
                }
            }
            
            lastCheck = now;
        }, 100);
    }

    private collectMetrics(): void {
        const now = Date.now();
        const currentCpuUsage = process.cpuUsage();
        const memUsage = process.memoryUsage();

        // Calculate CPU percentage
        let cpuPercent = 0;
        if (this.lastCpuUsage) {
            const userDiff = currentCpuUsage.user - this.lastCpuUsage.user;
            const systemDiff = currentCpuUsage.system - this.lastCpuUsage.system;
            const timeDiff = (now - this.lastTimestamp) * 1000; // Convert to microseconds
            
            cpuPercent = ((userDiff + systemDiff) / timeDiff) * 100;
        }

        const metric: CPUMetrics = {
            timestamp: now,
            cpuPercent,
            cpuTimes: currentCpuUsage,
            eventLoopLag: 0,
            activeHandles: (process as any)._getActiveHandles?.()?.length || 0,
            activeRequests: (process as any)._getActiveRequests?.()?.length || 0,
            memoryUsage: memUsage
        };

        this.metrics.push(metric);

        // Track current pattern metrics
        if (this.currentPattern) {
            this.currentPattern.metrics.push(metric);
        }

        // Detect CPU spikes
        this.detectCPUSpike(metric);

        // Update for next iteration
        this.lastCpuUsage = currentCpuUsage;
        this.lastTimestamp = now;

        // Log high CPU usage
        if (cpuPercent > this.config.performance.expectedMetrics.maxCpuUsagePercent) {
            logger.warn(`High CPU usage detected: ${cpuPercent.toFixed(2)}%`);
        }
    }

    private detectCPUSpike(metric: CPUMetrics): void {
        const threshold = this.config.performance.expectedMetrics.spikeThreshold;
        
        if (metric.cpuPercent > threshold) {
            // Check if this is part of an ongoing spike
            const lastSpike = this.spikes[this.spikes.length - 1];
            
            if (lastSpike && 
                metric.timestamp - lastSpike.timestamp < 10000) { // Within 10 seconds
                // Update ongoing spike
                lastSpike.duration = metric.timestamp - lastSpike.timestamp;
                lastSpike.peakUsage = Math.max(lastSpike.peakUsage, metric.cpuPercent);
                lastSpike.avgUsage = (lastSpike.avgUsage + metric.cpuPercent) / 2;
            } else {
                // New spike
                this.spikes.push({
                    timestamp: metric.timestamp,
                    duration: 0,
                    peakUsage: metric.cpuPercent,
                    avgUsage: metric.cpuPercent,
                    cause: this.identifySpikeCause(metric)
                });
            }
        }
    }

    private identifySpikeCause(metric: CPUMetrics): string {
        // Analyze various factors to identify spike cause
        if (metric.activeRequests > 50) return 'high_request_load';
        if (metric.memoryUsage.heapUsed > metric.memoryUsage.heapTotal * 0.9) return 'memory_pressure';
        if (metric.eventLoopLag > 100) return 'event_loop_blocking';
        if (this.currentPattern?.name === 'burst_traffic') return 'traffic_burst';
        if (this.currentPattern?.name === 'peak_load') return 'peak_load';
        
        return 'unknown';
    }

    private async executeWorkloadPatterns(): Promise<any> {
        const patterns = this.config.performance.workloadPatterns;
        
        for (const patternConfig of patterns) {
            logger.info(`\n📊 Executing pattern: ${patternConfig.name}`);
            logger.info(`Duration: ${patternConfig.duration / 1000}s`);
            
            this.currentPattern = {
                name: patternConfig.name,
                duration: patternConfig.duration,
                metrics: [],
                spikes: [],
                avgCpu: 0,
                maxCpu: 0,
                eventLoopStats: {
                    avg: 0,
                    max: 0,
                    p95: 0,
                    p99: 0
                }
            };

            await this.executePattern(patternConfig);
            
            // Calculate pattern statistics
            this.calculatePatternStats(this.currentPattern);
            this.patterns.push(this.currentPattern);
            
            // Brief pause between patterns
            await this.sleep(5000);
        }

        return {
            patterns: this.patterns,
            metrics: this.metrics,
            spikes: this.spikes
        };
    }

    private async executePattern(config: any): Promise<void> {
        const startTime = Date.now();
        const endTime = startTime + config.duration;

        switch (config.name) {
            case 'steady_state':
                await this.executeSteadyState(config, endTime);
                break;
            case 'peak_load':
                await this.executePeakLoad(config, endTime);
                break;
            case 'burst_traffic':
                await this.executeBurstTraffic(config, endTime);
                break;
            case 'gradual_ramp':
                await this.executeGradualRamp(config, endTime);
                break;
            case 'idle_periods':
                await this.executeIdlePeriods(config, endTime);
                break;
            case 'mixed_workload':
                await this.executeMixedWorkload(config, endTime);
                break;
            default:
                logger.warn(`Unknown pattern: ${config.name}`);
        }
    }

    private async executeSteadyState(config: any, endTime: number): Promise<void> {
        const reviewInterval = 60000 / config.reviewsPerMinute;
        const messageInterval = 60000 / config.messagesPerMinute;

        const reviewTimer = setInterval(async () => {
            if (Date.now() >= endTime) {
                clearInterval(reviewTimer);
                return;
            }
            await this.simulateReviewProcessing();
        }, reviewInterval);

        const messageTimer = setInterval(async () => {
            if (Date.now() >= endTime) {
                clearInterval(messageTimer);
                return;
            }
            await this.simulateMessageProcessing();
        }, messageInterval);

        // Wait for pattern completion
        while (Date.now() < endTime) {
            await this.sleep(1000);
            this.logPatternProgress(config.name, endTime);
        }

        clearInterval(reviewTimer);
        clearInterval(messageTimer);
    }

    private async executePeakLoad(config: any, endTime: number): Promise<void> {
        const tasks: Promise<void>[] = [];

        // Generate high concurrent load
        for (let i = 0; i < config.concurrentUsers; i++) {
            tasks.push(this.simulateUserActivity(endTime, {
                reviewsPerMinute: config.reviewsPerMinute / config.concurrentUsers,
                messagesPerMinute: config.messagesPerMinute / config.concurrentUsers
            }));
        }

        await Promise.all(tasks);
    }

    private async executeBurstTraffic(config: any, endTime: number): Promise<void> {
        while (Date.now() < endTime) {
            // Burst phase
            logger.info(`🚀 Traffic burst: ${config.burstSize} operations`);
            const burstTasks = [];
            
            for (let i = 0; i < config.burstSize; i++) {
                if (i % 2 === 0) {
                    burstTasks.push(this.simulateReviewProcessing());
                } else {
                    burstTasks.push(this.simulateMessageProcessing());
                }
            }
            
            await Promise.all(burstTasks);
            
            // Idle phase
            await this.sleep(config.burstInterval);
            
            // Baseline load during idle
            for (let i = 0; i < config.baselineLoad; i++) {
                await this.simulateMessageProcessing();
            }
        }
    }

    private async executeGradualRamp(config: any, endTime: number): Promise<void> {
        const stepDuration = config.duration / config.rampSteps;
        const loadIncrement = (config.endLoad - config.startLoad) / config.rampSteps;
        let currentLoad = config.startLoad;

        for (let step = 0; step < config.rampSteps && Date.now() < endTime; step++) {
            logger.info(`📈 Ramp step ${step + 1}/${config.rampSteps}: Load = ${currentLoad}`);
            
            const stepEndTime = Date.now() + stepDuration;
            
            while (Date.now() < stepEndTime) {
                const tasks = [];
                for (let i = 0; i < currentLoad; i++) {
                    tasks.push(this.simulateRandomOperation());
                }
                await Promise.all(tasks);
                await this.sleep(1000);
            }
            
            currentLoad += loadIncrement;
        }
    }

    private async executeIdlePeriods(config: any, endTime: number): Promise<void> {
        while (Date.now() < endTime) {
            // Active period
            logger.info(`⚡ Active period: ${config.activeMinutes} minutes`);
            const activeEndTime = Date.now() + (config.activeMinutes * 60000);
            
            while (Date.now() < activeEndTime && Date.now() < endTime) {
                const tasks = [];
                for (let i = 0; i < config.activeLoad; i++) {
                    tasks.push(this.simulateRandomOperation());
                }
                await Promise.all(tasks);
                await this.sleep(1000);
            }
            
            // Idle period
            logger.info(`😴 Idle period: ${config.idleMinutes} minutes`);
            const remainingTime = endTime - Date.now();
        if (remainingTime > 0) {
            await this.sleep(Math.min(config.idleMinutes * 60000, remainingTime));
        }
        }
    }

    private async executeMixedWorkload(config: any, endTime: number): Promise<void> {
        const totalOps = config.smallMessages + config.largeMessages + 
                        config.apiCalls + config.databaseOps;
        const opsInterval = config.duration / totalOps;

        while (Date.now() < endTime) {
            const operation = this.selectRandomOperation(config);
            await this.executeOperation(operation);
            await this.sleep(opsInterval);
        }
    }

    private selectRandomOperation(config: any): string {
        const rand = Math.random() * 100;
        const distribution = {
            smallMessages: config.smallMessages,
            largeMessages: config.largeMessages,
            apiCalls: config.apiCalls,
            databaseOps: config.databaseOps
        };

        let cumulative = 0;
        for (const [op, weight] of Object.entries(distribution)) {
            cumulative += weight as number;
            if (rand < cumulative) return op;
        }
        
        return 'smallMessages';
    }

    private async executeOperation(operation: string): Promise<void> {
        performance.mark(`${operation}-start`);
        
        switch (operation) {
            case 'smallMessages':
                await this.simulateSmallMessage();
                break;
            case 'largeMessages':
                await this.simulateLargeMessage();
                break;
            case 'apiCalls':
                await this.simulateAPICall();
                break;
            case 'databaseOps':
                await this.simulateDatabaseOperation();
                break;
        }
        
        performance.mark(`${operation}-end`);
        performance.measure(operation, `${operation}-start`, `${operation}-end`);
    }

    private async simulateUserActivity(endTime: number, config: any): Promise<void> {
        while (Date.now() < endTime) {
            if (Math.random() < 0.7) {
                await this.simulateReviewProcessing();
            } else {
                await this.simulateMessageProcessing();
            }
            
            await this.sleep(60000 / (config.reviewsPerMinute + config.messagesPerMinute));
        }
    }

    private async simulateReviewProcessing(): Promise<void> {
        performance.mark('review-processing-start');
        
        // Simulate CPU-intensive review processing
        const reviews = await this.mockGenerator.generateReviews('com.test.app', 1);
        const review = reviews[0];
        if (!review || !review.text) {
            return;
        }
        
        // Simulate text processing
        const processed = await this.processText(review.text);
        
        // Simulate sentiment analysis
        const sentiment = this.analyzeSentiment(processed);
        
        // Simulate database write
        await this.simulateDatabaseWrite({ review, sentiment });
        
        performance.mark('review-processing-end');
        performance.measure('review-processing', 'review-processing-start', 'review-processing-end');
    }

    private async simulateMessageProcessing(): Promise<void> {
        performance.mark('message-processing-start');
        
        // Simulate message handling
        const message = this.generateMockMessage();
        
        // Simulate encryption
        const encrypted = this.simulateEncryption(message);
        
        // Simulate Matrix event creation
        const event = this.createMatrixEvent(encrypted);
        
        // Simulate sending
        await this.simulateSend(event);
        
        performance.mark('message-processing-end');
        performance.measure('message-processing', 'message-processing-start', 'message-processing-end');
    }

    private async simulateRandomOperation(): Promise<void> {
        const operations = [
            () => this.simulateReviewProcessing(),
            () => this.simulateMessageProcessing(),
            () => this.simulateAPICall(),
            () => this.simulateDatabaseOperation(),
            () => this.simulateCacheOperation()
        ];
        
        const operation = operations[Math.floor(Math.random() * operations.length)];
        await operation();
    }

    private async simulateSmallMessage(): Promise<void> {
        const text = 'a'.repeat(Math.floor(Math.random() * 100));
        await this.processText(text);
    }

    private async simulateLargeMessage(): Promise<void> {
        const text = 'a'.repeat(Math.floor(Math.random() * 10000) + 5000);
        await this.processText(text);
        
        // Simulate attachment processing
        for (let i = 0; i < 1000000; i++) {
            Math.sqrt(i);
        }
    }

    private async simulateAPICall(): Promise<void> {
        performance.mark('api-call-start');
        
        // Simulate network delay
        await this.sleep(Math.random() * 100 + 50);
        
        // Simulate JSON parsing
        const data = JSON.stringify({ data: 'a'.repeat(1000) });
        JSON.parse(data);
        
        performance.mark('api-call-end');
        performance.measure('api-call', 'api-call-start', 'api-call-end');
    }

    private async simulateDatabaseOperation(): Promise<void> {
        performance.mark('db-operation-start');
        
        // Simulate query execution
        await this.sleep(Math.random() * 50 + 10);
        
        // Simulate result processing
        const results = Array(100).fill(null).map(() => ({
            id: Math.random(),
            data: 'a'.repeat(100)
        }));
        
        results.forEach(r => JSON.stringify(r));
        
        performance.mark('db-operation-end');
        performance.measure('db-operation', 'db-operation-start', 'db-operation-end');
    }

    private async simulateCacheOperation(): Promise<void> {
        const key = `cache-${Math.random()}`;
        const value = 'a'.repeat(Math.floor(Math.random() * 1000));
        
        // Simulate cache read/write
        const cache = new Map();
        cache.set(key, value);
        cache.get(key);
        cache.delete(key);
    }

    private async simulateDatabaseWrite(data: any): Promise<void> {
        // Simulate database write with serialization
        const serialized = JSON.stringify(data);
        await this.sleep(10);
        return JSON.parse(serialized);
    }

    private async simulateSend(data: any): Promise<void> {
        // Simulate network send
        await this.sleep(Math.random() * 20 + 5);
    }

    private processText(text: string): string {
        // Simulate CPU-intensive text processing
        let processed = text;
        
        // Simulate tokenization
        const words = processed.split(' ');
        
        // Simulate normalization
        processed = words.map(w => w.toLowerCase()).join(' ');
        
        // Simulate regex operations
        processed = processed.replace(/[^a-z0-9\s]/gi, '');
        
        // CPU burn for simulation
        for (let i = 0; i < 10000; i++) {
            Math.sqrt(i);
        }
        
        return processed;
    }

    private analyzeSentiment(text: string): number {
        // Simulate sentiment analysis
        let score = 0;
        
        // Simulate word scoring
        const words = text.split(' ');
        for (const word of words) {
            score += word.length * Math.random();
        }
        
        // CPU burn for simulation
        for (let i = 0; i < 50000; i++) {
            Math.sin(i) * Math.cos(i);
        }
        
        return score / words.length;
    }

    private simulateEncryption(data: string): string {
        // Simulate CPU-intensive encryption
        let encrypted = '';
        
        for (let i = 0; i < data.length; i++) {
            encrypted += String.fromCharCode(data.charCodeAt(i) ^ 42);
            
            // CPU burn
            for (let j = 0; j < 100; j++) {
                Math.sqrt(j);
            }
        }
        
        return encrypted;
    }

    private createMatrixEvent(data: any): any {
        return {
            type: 'm.room.message',
            content: {
                msgtype: 'm.text',
                body: data
            },
            timestamp: Date.now()
        };
    }

    private generateMockMessage(): string {
        const lengths = [50, 200, 500];
        const length = lengths[Math.floor(Math.random() * lengths.length)];
        return 'a'.repeat(length);
    }

    private calculatePatternStats(pattern: WorkloadPattern): void {
        if (pattern.metrics.length === 0) return;

        // Calculate CPU stats
        const cpuValues = pattern.metrics.map(m => m.cpuPercent);
        pattern.avgCpu = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
        pattern.maxCpu = Math.max(...cpuValues);

        // Calculate event loop stats
        const lagValues = pattern.metrics
            .map(m => m.eventLoopLag)
            .filter(lag => lag > 0)
            .sort((a, b) => a - b);

        if (lagValues.length > 0) {
            pattern.eventLoopStats.avg = lagValues.reduce((a, b) => a + b, 0) / lagValues.length;
            pattern.eventLoopStats.max = Math.max(...lagValues);
            pattern.eventLoopStats.p95 = lagValues[Math.floor(lagValues.length * 0.95)];
            pattern.eventLoopStats.p99 = lagValues[Math.floor(lagValues.length * 0.99)];
        }

        // Filter spikes for this pattern
        const patternStartTime = pattern.metrics[0].timestamp;
        const patternEndTime = pattern.metrics[pattern.metrics.length - 1].timestamp;
        
        pattern.spikes = this.spikes.filter(spike => 
            spike.timestamp >= patternStartTime && 
            spike.timestamp <= patternEndTime
        );

        logger.info(`Pattern ${pattern.name} stats:`, {
            avgCpu: `${pattern.avgCpu.toFixed(2)}%`,
            maxCpu: `${pattern.maxCpu.toFixed(2)}%`,
            spikes: pattern.spikes.length,
            avgEventLoopLag: `${pattern.eventLoopStats.avg.toFixed(2)}ms`
        });
    }

    private logPatternProgress(patternName: string, endTime: number): void {
        const remaining = Math.floor((endTime - Date.now()) / 1000);
        if (remaining % 30 === 0 && remaining > 0) {
            const lastMetric = this.metrics[this.metrics.length - 1];
            logger.info(`Pattern ${patternName} - ${remaining}s remaining`, {
                currentCPU: `${lastMetric?.cpuPercent.toFixed(2)}%`,
                eventLoopLag: `${lastMetric?.eventLoopLag}ms`
            });
        }
    }

    private startCPUProfiling(): void {
        const profileInterval = this.config.performance.cpuProfiling.captureInterval;
        
        setInterval(() => {
            this.captureProfile();
        }, profileInterval);
    }

    private async captureProfile(): Promise<void> {
        try {
            const profile = v8.getHeapStatistics();
            this.profileData.push({
                timestamp: Date.now(),
                heap: profile,
                cpu: process.cpuUsage()
            });

            // Keep only recent profiles
            const maxProfiles = this.config.performance.cpuProfiling.maxProfiles;
            if (this.profileData.length > maxProfiles) {
                this.profileData.shift();
            }
        } catch (error) {
            logger.error('Failed to capture profile:', error);
        }
    }

    private updateFunctionProfile(name: string, duration: number): void {
        const profile = this.functionProfiles.get(name) || {
            name,
            selfTime: 0,
            totalTime: 0,
            callCount: 0,
            percentCpu: 0
        };

        profile.totalTime += duration;
        profile.selfTime += duration; // Simplified - would need call stack for accurate self time
        profile.callCount++;

        this.functionProfiles.set(name, profile);
    }

    private analyzeCPUBottlenecks(): void {
        const categories = this.config.performance.analysis?.bottleneckDetection?.categories || [
            'message_processing',
            'api_calls',
            'database_operations'
        ];

        for (const category of categories) {
            const functions = Array.from(this.functionProfiles.values())
                .filter(f => f.name.includes(category.replace('_', '-')))
                .sort((a, b) => b.totalTime - a.totalTime)
                .slice(0, 10);

            if (functions.length > 0) {
                const totalCpu = functions.reduce((sum, f) => sum + f.totalTime, 0);
                const totalTestTime = Date.now() - this.startTime;
                const percentCpu = (totalCpu / totalTestTime) * 100;

                this.bottlenecks.set(category, {
                    category,
                    functions,
                    totalCpuPercent: percentCpu,
                    recommendations: this.generateBottleneckRecommendations(category, functions)
                });
            }
        }
    }

    private generateBottleneckRecommendations(category: string, functions: FunctionProfile[]): string[] {
        const recommendations: string[] = [];

        if (category === 'message_processing' && functions[0].totalTime > 1000) {
            recommendations.push('Consider implementing message batching to reduce processing overhead');
            recommendations.push('Enable message compression for large payloads');
        }

        if (category === 'api_calls' && functions[0].callCount > 100) {
            recommendations.push('Implement API response caching to reduce redundant calls');
            recommendations.push('Use connection pooling for API clients');
        }

        if (category === 'database_operations') {
            recommendations.push('Add database query result caching');
            recommendations.push('Optimize database queries with proper indexing');
            recommendations.push('Consider using prepared statements');
        }

        return recommendations;
    }

    private generateOptimizationRecommendations(): string[] {
        const recommendations: string[] = [];
        const avgCpu = this.metrics.reduce((sum, m) => sum + m.cpuPercent, 0) / this.metrics.length;

        if (avgCpu > 50) {
            recommendations.push('HIGH PRIORITY: Implement worker threads for CPU-intensive operations');
            recommendations.push('HIGH PRIORITY: Add caching layer to reduce computation');
        }

        if (this.spikes.length > 20) {
            recommendations.push('MEDIUM PRIORITY: Implement request throttling to prevent CPU spikes');
            recommendations.push('MEDIUM PRIORITY: Add circuit breakers for resource-intensive operations');
        }

        const avgEventLoopLag = this.metrics
            .map(m => m.eventLoopLag)
            .reduce((a, b) => a + b, 0) / this.metrics.length;

        if (avgEventLoopLag > 50) {
            recommendations.push('HIGH PRIORITY: Optimize synchronous operations blocking event loop');
            recommendations.push('MEDIUM PRIORITY: Implement async/await patterns consistently');
        }

        // Check for memory-related CPU usage
        const memoryPressureMetrics = this.metrics.filter(m => 
            m.memoryUsage.heapUsed > m.memoryUsage.heapTotal * 0.8
        );

        if (memoryPressureMetrics.length > 10) {
            recommendations.push('MEDIUM PRIORITY: Memory pressure causing increased GC activity');
            recommendations.push('Optimize memory usage to reduce GC overhead');
        }

        return recommendations;
    }

    private calculatePotentialSavings(): number {
        const avgCpu = this.metrics.reduce((sum, m) => sum + m.cpuPercent, 0) / this.metrics.length;
        const targetCpu = this.config.performance.expectedMetrics.avgCpuUsagePercent;
        
        if (avgCpu > targetCpu) {
            return ((avgCpu - targetCpu) / avgCpu) * 100;
        }
        
        return 0;
    }

    private generateResults(data: any): CPUPatternsResults {
        this.analyzeCPUBottlenecks();
        
        const avgCpu = this.metrics.reduce((sum, m) => sum + m.cpuPercent, 0) / this.metrics.length;
        const maxCpu = Math.max(...this.metrics.map(m => m.cpuPercent));
        
        const eventLoopLags = this.metrics
            .map(m => m.eventLoopLag)
            .filter(lag => lag > 0);
        
        const avgEventLoopLag = eventLoopLags.length > 0 
            ? eventLoopLags.reduce((a, b) => a + b, 0) / eventLoopLags.length 
            : 0;
        
        const maxEventLoopLag = eventLoopLags.length > 0 
            ? Math.max(...eventLoopLags) 
            : 0;

        const blockingEvents = eventLoopLags.filter(lag => 
            lag > this.config.performance.expectedMetrics.eventLoopBlockingThreshold
        ).length;

        // Calculate spike statistics
        const spikeDurations = this.spikes.map(s => s.duration);
        const avgSpikeDuration = spikeDurations.length > 0
            ? spikeDurations.reduce((a, b) => a + b, 0) / spikeDurations.length
            : 0;
        
        const maxSpikeDuration = spikeDurations.length > 0
            ? Math.max(...spikeDurations)
            : 0;

        const spikeCauses: Record<string, number> = {};
        for (const spike of this.spikes) {
            if (spike.cause) {
                spikeCauses[spike.cause] = (spikeCauses[spike.cause] || 0) + 1;
            }
        }

        // Get top CPU consuming functions
        const hotFunctions = Array.from(this.functionProfiles.values())
            .sort((a, b) => b.totalTime - a.totalTime)
            .slice(0, 20)
            .map(f => ({
                ...f,
                percentCpu: (f.totalTime / (Date.now() - this.startTime)) * 100
            }));

        // Determine test pass/fail
        const failureReasons: string[] = [];
        const expectedMetrics = this.config.performance.expectedMetrics;

        if (avgCpu > expectedMetrics.avgCpuUsagePercent) {
            failureReasons.push(`Average CPU usage ${avgCpu.toFixed(2)}% exceeds threshold ${expectedMetrics.avgCpuUsagePercent}%`);
        }

        if (maxCpu > expectedMetrics.maxCpuUsagePercent) {
            failureReasons.push(`Peak CPU usage ${maxCpu.toFixed(2)}% exceeds threshold ${expectedMetrics.maxCpuUsagePercent}%`);
        }

        if (this.spikes.length > expectedMetrics.maxSpikesPerHour * 2) { // 2 hours test
            failureReasons.push(`Too many CPU spikes: ${this.spikes.length} (max: ${expectedMetrics.maxSpikesPerHour * 2})`);
        }

        if (avgEventLoopLag > expectedMetrics.avgEventLoopLag) {
            failureReasons.push(`Average event loop lag ${avgEventLoopLag.toFixed(2)}ms exceeds threshold ${expectedMetrics.avgEventLoopLag}ms`);
        }

        const cpuEfficiency = 100 - (blockingEvents / this.metrics.length * 100);
        const coreUtilization = Math.min(os.cpus().length, Math.ceil(avgCpu / 100));

        const recommendations = this.generateOptimizationRecommendations();
        const potentialSavings = this.calculatePotentialSavings();

        return {
            testDuration: Date.now() - this.startTime,
            patterns: this.patterns,
            overallMetrics: {
                avgCpuUsage: avgCpu,
                maxCpuUsage: maxCpu,
                cpuEfficiency,
                coreUtilization
            },
            spikes: {
                count: this.spikes.length,
                avgDuration: avgSpikeDuration,
                maxDuration: maxSpikeDuration,
                causes: spikeCauses
            },
            eventLoop: {
                avgLag: avgEventLoopLag,
                maxLag: maxEventLoopLag,
                blockingEvents,
                responsiveness: 100 - (blockingEvents / this.metrics.length * 100)
            },
            hotFunctions,
            bottlenecks: Array.from(this.bottlenecks.values()),
            optimization: {
                recommendations,
                potentialSavings,
                priority: recommendations.filter(r => r.includes('HIGH PRIORITY')).map(r => r.replace('HIGH PRIORITY: ', ''))
            },
            testPassed: failureReasons.length === 0,
            failureReasons
        };
    }

    private async cleanup(): Promise<void> {
        logger.info('Cleaning up CPU patterns test...');

        if (this.eventLoopMonitor) {
            clearInterval(this.eventLoopMonitor as any);
        }

        if (this.metricsCollector) {
            clearInterval(this.metricsCollector as any);
        }

        if (this.performanceObserver) {
            this.performanceObserver.disconnect();
        }

        if (this.bridge) {
            // Cleanup bridge resources
            this.bridge = null;
        }

        // Clear large data structures
        this.metrics = [];
        this.patterns = [];
        this.spikes = [];
        this.profileData = [];
        this.functionProfiles.clear();
        this.bottlenecks.clear();

        logger.info('Cleanup completed');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export for use in performance runner
export default CPUUsagePatternsTest;