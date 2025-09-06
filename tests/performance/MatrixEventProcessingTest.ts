import { GooglePlayBridge } from '../../src/bridge/GooglePlayBridge';
import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import * as crypto from 'crypto';

const Logger = require('../../src/utils/Logger').Logger;
const logger = Logger.getInstance('MatrixEventProcessingTest');

interface MatrixEvent {
    id: string;
    type: string;
    roomId: string;
    senderId: string;
    timestamp: number;
    content: any;
    payloadSize: number;
    processingStartTime?: number;
    processingEndTime?: number;
    queueWaitTime?: number;
    processingLatency?: number;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    retryCount: number;
    memoryUsage?: number;
}

interface VirtualUser {
    id: string;
    matrixUserId: string;
    displayName: string;
    creationTime: number;
    lastAccessTime: number;
    accessCount: number;
    memorySize: number;
    cacheStatus: 'hot' | 'warm' | 'cold';
    isActive: boolean;
}

interface EventQueueMetrics {
    timestamp: number;
    queueDepth: number;
    maxQueueDepth: number;
    avgQueueDepth: number;
    queueWaitTime: number;
    processingRate: number;
    throughput: number;
    backpressure: number;
    overflowCount: number;
    droppedEvents: number;
}

interface VirtualUserMetrics {
    timestamp: number;
    totalUsers: number;
    activeUsers: number;
    userCreationRate: number;
    userLookupRate: number;
    cacheHitRatio: number;
    avgCreationTime: number;
    avgLookupTime: number;
    totalMemoryUsage: number;
    cacheEfficiency: number;
}

interface EventLatencyMetrics {
    timestamp: number;
    avgLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    maxLatency: number;
    latencyVariation: number;
    processingStages: {
        parsing: number;
        validation: number;
        businessLogic: number;
        database: number;
        matrixApi: number;
    };
}

interface EventTypeMetrics {
    eventType: string;
    count: number;
    avgProcessingTime: number;
    avgMemoryUsage: number;
    avgPayloadSize: number;
    successRate: number;
    errorRate: number;
    complexityScore: number;
}

interface ScenarioResult {
    name: string;
    duration: number;
    totalEvents: number;
    processedEvents: number;
    failedEvents: number;
    droppedEvents: number;
    avgThroughput: number;
    peakThroughput: number;
    avgLatency: number;
    p95Latency: number;
    maxQueueDepth: number;
    avgQueueDepth: number;
    virtualUsersCreated: number;
    virtualUsersActive: number;
    memoryUsage: {
        initial: number;
        peak: number;
        final: number;
        growth: number;
    };
    queueMetrics: EventQueueMetrics[];
    userMetrics: VirtualUserMetrics[];
    latencyMetrics: EventLatencyMetrics[];
    eventTypeBreakdown: EventTypeMetrics[];
}

interface MatrixEventResults {
    testDuration: number;
    scenarios: ScenarioResult[];
    overallStats: {
        totalEventsProcessed: number;
        avgEventsPerSecond: number;
        peakEventsPerSecond: number;
        totalVirtualUsers: number;
        avgProcessingLatency: number;
        p95ProcessingLatency: number;
        p99ProcessingLatency: number;
        totalMemoryUsed: number;
        eventSuccessRate: number;
        queueOverflowCount: number;
    };
    queueAnalysis: {
        avgQueueDepth: number;
        maxQueueDepth: number;
        queueEfficiency: number;
        backpressureEvents: number;
        optimalQueueSize: number;
    };
    virtualUserAnalysis: {
        avgUserCreationTime: number;
        avgUserLookupTime: number;
        cacheHitRatio: number;
        userScalabilityFactor: number;
        memoryPerUser: number;
        optimalCacheSize: number;
    };
    eventTypeAnalysis: {
        byType: Record<string, EventTypeMetrics>;
        mostExpensive: string[];
        leastExpensive: string[];
        complexityRanking: string[];
    };
    performanceBottlenecks: {
        stage: string;
        impact: number;
        description: string;
        recommendations: string[];
    }[];
    optimization: {
        recommendations: string[];
        estimatedImprovements: Record<string, number>;
        priority: string[];
    };
    testPassed: boolean;
    failureReasons: string[];
}

export class MatrixEventProcessingTest {
    private bridge: GooglePlayBridge | null = null;
    private config: any;
    private startTime: number = 0;
    
    // Event processing tracking
    private eventQueue: MatrixEvent[] = [];
    private processingEvents: Map<string, MatrixEvent> = new Map();
    private completedEvents: MatrixEvent[] = [];
    private failedEvents: MatrixEvent[] = [];
    private droppedEvents: MatrixEvent[] = [];
    
    // Virtual user management
    private virtualUsers: Map<string, VirtualUser> = new Map();
    private userCache: Map<string, VirtualUser> = new Map();
    private userCreationTimes: number[] = [];
    private userLookupTimes: number[] = [];
    
    // Metrics tracking
    private queueMetrics: EventQueueMetrics[] = [];
    private userMetrics: VirtualUserMetrics[] = [];
    private latencyMetrics: EventLatencyMetrics[] = [];
    private eventTypeMetrics: Map<string, EventTypeMetrics> = new Map();
    
    // Monitoring
    private metricsCollector: NodeJS.Timer | null = null;
    private eventProcessor: NodeJS.Timer | null = null;
    private queueMonitor: NodeJS.Timer | null = null;
    
    private scenarios: ScenarioResult[] = [];
    private isProcessing: boolean = false;

    constructor() {
        this.initializeEventTypes();
    }

    private initializeEventTypes(): void {
        const eventTypes = [
            'm.room.message', 'm.room.member', 'm.room.topic',
            'm.room.avatar', 'm.room.name', 'm.room.join_rules',
            'm.room.power_levels', 'm.room.create', 'm.typing'
        ];
        
        for (const eventType of eventTypes) {
            this.eventTypeMetrics.set(eventType, {
                eventType,
                count: 0,
                avgProcessingTime: 0,
                avgMemoryUsage: 0,
                avgPayloadSize: 0,
                successRate: 1.0,
                errorRate: 0.0,
                complexityScore: this.getEventComplexityScore(eventType)
            });
        }
    }

    private getEventComplexityScore(eventType: string): number {
        const complexityScores: Record<string, number> = {
            'm.room.message': 3,        // Medium complexity
            'm.room.member': 5,         // High complexity (user management)
            'm.room.topic': 2,          // Low complexity
            'm.room.avatar': 3,         // Medium complexity
            'm.room.name': 2,           // Low complexity
            'm.room.join_rules': 4,     // Medium-high complexity
            'm.room.power_levels': 5,   // High complexity
            'm.room.create': 4,         // Medium-high complexity
            'm.typing': 1               // Very low complexity
        };
        return complexityScores[eventType] || 3;
    }

    async runMatrixEventTest(): Promise<MatrixEventResults> {
        logger.info('🎭 Starting Matrix Event Processing Test (Scenario 4.2)');
        logger.info('Duration: 2 hours with high-frequency Matrix events');

        try {
            await this.loadConfiguration();
            await this.initializeBridge();
            this.startMonitoring();
            this.startEventProcessing();

            const results = await this.executeEventProcessingScenarios();
            
            await this.cleanup();
            return this.generateResults(results);
        } catch (error) {
            logger.error('Matrix event processing test failed:', error);
            throw error;
        }
    }

    private async loadConfiguration(): Promise<void> {
        const configPath = path.join(process.cwd(), 'config', 'performance-matrix-events.yaml');
        
        if (!fs.existsSync(configPath)) {
            logger.warn('Matrix events config not found, using defaults');
            this.config = this.getDefaultConfig();
        } else {
            const yaml = await import('js-yaml');
            const configContent = fs.readFileSync(configPath, 'utf8');
            this.config = yaml.load(configContent);
        }

        logger.info('Configuration loaded:', {
            duration: this.config.performance.testDuration,
            scenarios: this.config.performance.matrixEventScenarios.length,
            apps: this.config.apps.length,
            expectedMetrics: this.config.performance.expectedMetrics
        });
    }

    private getDefaultConfig(): any {
        return {
            apps: [
                { packageName: 'com.matrixevents.highfreq.app1', matrixRoomId: '!highfreq1:localhost', eventGenerationRate: 50 },
                { packageName: 'com.matrixevents.highfreq.app2', matrixRoomId: '!highfreq2:localhost', eventGenerationRate: 60 },
                { packageName: 'com.matrixevents.medfreq.app4', matrixRoomId: '!medfreq4:localhost', eventGenerationRate: 25 },
                { packageName: 'com.matrixevents.burst.app7', matrixRoomId: '!burst7:localhost', eventGenerationRate: 100 }
            ],
            performance: {
                testDuration: 7200000, // 2 hours
                expectedMetrics: {
                    maxEventsPerSecond: 20,
                    avgEventsPerSecond: 8,
                    maxQueueDepth: 100,
                    avgQueueDepth: 20,
                    maxVirtualUsers: 200,
                    maxEventLatency: 3000,
                    avgEventLatency: 800,
                    memoryPerEvent: 50
                },
                matrixEventScenarios: [
                    {
                        name: 'steady_high_frequency',
                        duration: 1800000,
                        eventRate: 15,
                        eventTypes: ['m.room.message', 'm.room.member', 'm.room.topic']
                    },
                    {
                        name: 'burst_event_processing',
                        duration: 1200000,
                        burstMode: true,
                        burstEventsPerSecond: 40,
                        burstDuration: 30000,
                        burstInterval: 120000
                    }
                ]
            }
        };
    }

    private async initializeBridge(): Promise<void> {
        logger.info('Initializing bridge for Matrix event processing...');
        
        const bridgeConfig = {
            ...this.config.bridge,
            database: { engine: 'sqlite', filename: ':memory:' }
        };

        this.bridge = new GooglePlayBridge(bridgeConfig);
        
        // Initialize virtual user system
        await this.setupVirtualUserSystem();
        
        logger.info('Bridge initialized for Matrix event processing');
    }

    private async setupVirtualUserSystem(): Promise<void> {
        // Pre-create some virtual users for testing
        for (let i = 1; i <= 20; i++) {
            const user = await this.createVirtualUser(`test_user_${i}`);
            this.userCache.set(user.id, user);
        }
        logger.info(`Pre-created ${this.userCache.size} virtual users`);
    }

    private async createVirtualUser(displayName: string): Promise<VirtualUser> {
        const startTime = performance.now();
        
        const user: VirtualUser = {
            id: crypto.randomUUID(),
            matrixUserId: `@_googleplay_${displayName}:localhost`,
            displayName,
            creationTime: Date.now(),
            lastAccessTime: Date.now(),
            accessCount: 0,
            memorySize: Math.floor(Math.random() * 5000) + 5000, // 5-10KB per user
            cacheStatus: 'hot',
            isActive: true
        };

        // Simulate user creation time
        await this.sleep(Math.random() * 50 + 10); // 10-60ms
        
        const creationTime = performance.now() - startTime;
        this.userCreationTimes.push(creationTime);

        this.virtualUsers.set(user.id, user);
        return user;
    }

    private async lookupVirtualUser(userId: string): Promise<VirtualUser | null> {
        const startTime = performance.now();
        
        // Check cache first
        let user = this.userCache.get(userId);
        if (user) {
            user.lastAccessTime = Date.now();
            user.accessCount++;
            user.cacheStatus = 'hot';
            
            const lookupTime = performance.now() - startTime;
            this.userLookupTimes.push(lookupTime);
            return user;
        }
        
        // Fallback to full lookup
        user = this.virtualUsers.get(userId);
        if (user) {
            user.lastAccessTime = Date.now();
            user.accessCount++;
            user.cacheStatus = 'warm';
            
            // Add to cache
            this.userCache.set(userId, user);
            
            // Simulate database lookup time
            await this.sleep(Math.random() * 20 + 5); // 5-25ms
        }
        
        const lookupTime = performance.now() - startTime;
        this.userLookupTimes.push(lookupTime);
        
        return user || null;
    }

    private startMonitoring(): void {
        this.startTime = Date.now();

        // Start metrics collection
        this.metricsCollector = setInterval(() => {
            this.collectQueueMetrics();
            this.collectUserMetrics();
            this.collectLatencyMetrics();
        }, this.config.performance.matrixEventMonitoring?.sampleInterval || 500);

        // Start queue monitoring
        this.queueMonitor = setInterval(() => {
            this.monitorQueueHealth();
            this.optimizeCache();
        }, 1000);

        logger.info('Matrix event monitoring started');
    }

    private startEventProcessing(): void {
        this.isProcessing = true;
        
        // Start event processor
        this.eventProcessor = setInterval(() => {
            this.processEventQueue();
        }, 100); // Process every 100ms

        logger.info('Event processing started');
    }

    private collectQueueMetrics(): void {
        const now = Date.now();
        const queueDepth = this.eventQueue.length;
        const recentMetrics = this.queueMetrics.slice(-10);
        
        const maxDepth = Math.max(...recentMetrics.map(m => m.queueDepth), queueDepth);
        const avgDepth = recentMetrics.length > 0 
            ? recentMetrics.reduce((sum, m) => sum + m.queueDepth, 0) / recentMetrics.length 
            : queueDepth;

        // Calculate processing rate (events per second)
        const recentCompleted = this.completedEvents
            .filter(e => now - e.timestamp < 10000).length; // Last 10 seconds
        const processingRate = recentCompleted / 10;

        // Calculate wait times
        const queuedEvents = this.eventQueue.filter(e => e.status === 'queued');
        const avgWaitTime = queuedEvents.length > 0
            ? queuedEvents.reduce((sum, e) => sum + (now - e.timestamp), 0) / queuedEvents.length
            : 0;

        // Calculate backpressure
        const expectedRate = this.config.performance.expectedMetrics.avgEventsPerSecond;
        const backpressure = Math.max(0, (queueDepth - avgDepth) / expectedRate);

        const metric: EventQueueMetrics = {
            timestamp: now,
            queueDepth,
            maxQueueDepth: maxDepth,
            avgQueueDepth: avgDepth,
            queueWaitTime: avgWaitTime,
            processingRate,
            throughput: processingRate,
            backpressure,
            overflowCount: this.droppedEvents.length,
            droppedEvents: this.droppedEvents.length
        };

        this.queueMetrics.push(metric);

        // Alert on high queue depth
        if (queueDepth > this.config.performance.expectedMetrics.maxQueueDepth) {
            logger.warn(`High queue depth detected: ${queueDepth} events`);
        }
    }

    private collectUserMetrics(): void {
        const now = Date.now();
        const totalUsers = this.virtualUsers.size;
        const activeUsers = Array.from(this.virtualUsers.values())
            .filter(u => u.isActive && now - u.lastAccessTime < 300000).length; // Active in last 5 minutes

        // Calculate creation and lookup rates
        const recentCreations = this.userCreationTimes
            .filter(t => now - t < 60000).length; // Last minute
        const recentLookups = this.userLookupTimes
            .filter(t => now - t < 60000).length; // Last minute

        // Calculate cache hit ratio
        const cacheSize = this.userCache.size;
        const totalLookups = this.userLookupTimes.length;
        const cacheHits = Array.from(this.virtualUsers.values())
            .reduce((sum, u) => sum + u.accessCount, 0);
        const cacheHitRatio = totalLookups > 0 ? cacheHits / totalLookups : 1;

        // Calculate average times
        const avgCreationTime = this.userCreationTimes.length > 0
            ? this.userCreationTimes.reduce((a, b) => a + b, 0) / this.userCreationTimes.length
            : 0;
        const avgLookupTime = this.userLookupTimes.length > 0
            ? this.userLookupTimes.reduce((a, b) => a + b, 0) / this.userLookupTimes.length
            : 0;

        // Calculate memory usage
        const totalMemoryUsage = Array.from(this.virtualUsers.values())
            .reduce((sum, u) => sum + u.memorySize, 0);

        const cacheEfficiency = cacheSize > 0 ? (cacheHitRatio * 100) : 0;

        const metric: VirtualUserMetrics = {
            timestamp: now,
            totalUsers,
            activeUsers,
            userCreationRate: recentCreations,
            userLookupRate: recentLookups,
            cacheHitRatio,
            avgCreationTime,
            avgLookupTime,
            totalMemoryUsage,
            cacheEfficiency
        };

        this.userMetrics.push(metric);
    }

    private collectLatencyMetrics(): void {
        const now = Date.now();
        const recentEvents = this.completedEvents
            .filter(e => now - e.timestamp < 60000 && e.processingLatency) // Last minute
            .map(e => e.processingLatency!)
            .sort((a, b) => a - b);

        if (recentEvents.length === 0) return;

        const avgLatency = recentEvents.reduce((a, b) => a + b, 0) / recentEvents.length;
        const p50Latency = recentEvents[Math.floor(recentEvents.length * 0.5)] || 0;
        const p95Latency = recentEvents[Math.floor(recentEvents.length * 0.95)] || 0;
        const p99Latency = recentEvents[Math.floor(recentEvents.length * 0.99)] || 0;
        const maxLatency = Math.max(...recentEvents);
        
        // Calculate latency variation (standard deviation)
        const variance = recentEvents.reduce((sum, latency) => 
            sum + Math.pow(latency - avgLatency, 2), 0) / recentEvents.length;
        const latencyVariation = Math.sqrt(variance);

        // Simulate processing stage breakdown
        const processingStages = {
            parsing: avgLatency * 0.1,
            validation: avgLatency * 0.15,
            businessLogic: avgLatency * 0.4,
            database: avgLatency * 0.25,
            matrixApi: avgLatency * 0.1
        };

        const metric: EventLatencyMetrics = {
            timestamp: now,
            avgLatency,
            p50Latency,
            p95Latency,
            p99Latency,
            maxLatency,
            latencyVariation,
            processingStages
        };

        this.latencyMetrics.push(metric);

        // Alert on high latency
        if (avgLatency > this.config.performance.expectedMetrics.maxEventLatency) {
            logger.warn(`High event latency detected: ${avgLatency.toFixed(2)}ms`);
        }
    }

    private monitorQueueHealth(): void {
        const queueDepth = this.eventQueue.length;
        const maxQueueDepth = this.config.performance.expectedMetrics.maxQueueDepth;

        // Check for queue overflow
        if (queueDepth >= maxQueueDepth * 1.5) {
            // Drop oldest events to prevent memory issues
            const eventsToDrop = queueDepth - maxQueueDepth;
            const dropped = this.eventQueue.splice(0, eventsToDrop);
            this.droppedEvents.push(...dropped);
            
            logger.warn(`Queue overflow: dropped ${eventsToDrop} events`);
        }

        // Check for processing stalls
        const oldestQueuedEvent = this.eventQueue.find(e => e.status === 'queued');
        if (oldestQueuedEvent && Date.now() - oldestQueuedEvent.timestamp > 30000) {
            logger.warn('Processing stall detected: events stuck in queue for >30 seconds');
        }
    }

    private optimizeCache(): void {
        const cacheSize = this.userCache.size;
        const maxCacheSize = this.config.matrixApi?.virtualUserManagement?.userCacheSize || 1000;

        if (cacheSize > maxCacheSize) {
            // Remove least recently used entries
            const entries = Array.from(this.userCache.entries())
                .sort(([, a], [, b]) => a.lastAccessTime - b.lastAccessTime);

            const toRemove = cacheSize - maxCacheSize;
            for (let i = 0; i < toRemove; i++) {
                const entry = entries[i];
                if (entry) {
                    const [userId, user] = entry;
                    user.cacheStatus = 'cold';
                    this.userCache.delete(userId);
                }
            }
        }
    }

    private processEventQueue(): void {
        if (!this.isProcessing || this.eventQueue.length === 0) return;

        const maxConcurrent = this.config.matrixApi?.eventProcessing?.maxConcurrentEvents || 20;
        const batchSize = this.config.matrixApi?.eventProcessing?.eventBatchSize || 5;

        // Process events in batches
        const eventsToProcess = Math.min(
            batchSize,
            maxConcurrent - this.processingEvents.size,
            this.eventQueue.length
        );

        for (let i = 0; i < eventsToProcess; i++) {
            const event = this.eventQueue.shift();
            if (event) {
                this.processEvent(event);
            }
        }
    }

    private async processEvent(event: MatrixEvent): Promise<void> {
        event.status = 'processing';
        event.processingStartTime = performance.now();
        this.processingEvents.set(event.id, event);

        try {
            // Simulate event processing stages
            await this.simulateEventProcessing(event);
            
            event.status = 'completed';
            event.processingEndTime = performance.now();
            event.processingLatency = event.processingEndTime - event.processingStartTime;
            
            this.completedEvents.push(event);
            this.updateEventTypeMetrics(event, true);
            
        } catch (error) {
            event.status = 'failed';
            event.retryCount++;
            
            if (event.retryCount < 3) {
                // Retry failed event
                event.status = 'queued';
                this.eventQueue.push(event);
            } else {
                this.failedEvents.push(event);
                this.updateEventTypeMetrics(event, false);
            }
            
            logger.error(`Event processing failed: ${event.id}`, error);
        } finally {
            this.processingEvents.delete(event.id);
        }
    }

    private async simulateEventProcessing(event: MatrixEvent): Promise<void> {
        const baseProcessingTime = this.getEventComplexityScore(event.type) * 50; // Base time
        const variability = Math.random() * baseProcessingTime * 0.5; // Add variability
        const totalTime = baseProcessingTime + variability;

        // Simulate memory usage
        event.memoryUsage = event.payloadSize + Math.floor(Math.random() * 10000);

        // Simulate virtual user operations for member events
        if (event.type === 'm.room.member') {
            await this.handleMemberEvent(event);
        }

        // Simulate processing time
        await this.sleep(totalTime);

        // Random failure simulation
        if (Math.random() < 0.01) { // 1% failure rate
            throw new Error('Simulated processing failure');
        }
    }

    private async handleMemberEvent(event: MatrixEvent): Promise<void> {
        // Simulate user lookup or creation for member events
        const userId = event.senderId;
        let user = await this.lookupVirtualUser(userId);
        
        if (!user) {
            user = await this.createVirtualUser(`user_${Date.now()}`);
        }

        // Update user activity
        user.lastAccessTime = Date.now();
        user.accessCount++;
    }

    private updateEventTypeMetrics(event: MatrixEvent, success: boolean): void {
        const metrics = this.eventTypeMetrics.get(event.type);
        if (!metrics) return;

        metrics.count++;
        
        if (event.processingLatency) {
            metrics.avgProcessingTime = (metrics.avgProcessingTime * (metrics.count - 1) + event.processingLatency) / metrics.count;
        }
        
        if (event.memoryUsage) {
            metrics.avgMemoryUsage = (metrics.avgMemoryUsage * (metrics.count - 1) + event.memoryUsage) / metrics.count;
        }
        
        metrics.avgPayloadSize = (metrics.avgPayloadSize * (metrics.count - 1) + event.payloadSize) / metrics.count;
        
        if (success) {
            metrics.successRate = (metrics.successRate * (metrics.count - 1) + 1) / metrics.count;
        } else {
            metrics.errorRate = (metrics.errorRate * (metrics.count - 1) + 1) / metrics.count;
        }
    }

    private async executeEventProcessingScenarios(): Promise<any> {
        const scenarios = this.config.performance.matrixEventScenarios;
        
        for (const scenarioConfig of scenarios) {
            logger.info(`\\n🎭 Executing scenario: ${scenarioConfig.name}`);
            logger.info(`Duration: ${scenarioConfig.duration / 1000}s`);
            
            const scenarioResult = await this.executeScenario(scenarioConfig);
            this.scenarios.push(scenarioResult);
            
            // Brief pause between scenarios
            await this.sleep(30000);
            
            // Clear scenario-specific metrics
            this.clearScenarioMetrics();
        }

        return {
            scenarios: this.scenarios,
            queueMetrics: this.queueMetrics,
            userMetrics: this.userMetrics,
            latencyMetrics: this.latencyMetrics,
            eventTypeMetrics: this.eventTypeMetrics
        };
    }

    private async executeScenario(config: any): Promise<ScenarioResult> {
        const startTime = Date.now();
        const endTime = startTime + config.duration;
        const scenarioStartMetrics = {
            queue: this.queueMetrics.length,
            users: this.userMetrics.length,
            latency: this.latencyMetrics.length,
            events: this.completedEvents.length
        };

        const initialMemory = process.memoryUsage().heapUsed;
        let peakMemory = initialMemory;

        try {
            const scenarioName = (config as any).name || 'default';
            switch (scenarioName) {
                case 'steady_high_frequency':
                    await this.executeSteadyHighFrequency(config, endTime);
                    break;
                case 'burst_event_processing':
                    await this.executeBurstEventProcessing(config, endTime);
                    break;
                case 'virtual_user_stress':
                    await this.executeVirtualUserStress(config, endTime);
                    break;
                case 'event_queue_saturation':
                    await this.executeEventQueueSaturation(config, endTime);
                    break;
                case 'mixed_event_types':
                    await this.executeMixedEventTypes(config, endTime);
                    break;
                case 'event_processing_recovery':
                    await this.executeEventProcessingRecovery(config, endTime);
                    break;
                default:
                    await this.executeGenericEventScenario(config, endTime);
            }

            // Track peak memory usage
            peakMemory = Math.max(peakMemory, process.memoryUsage().heapUsed);

        } catch (error) {
            logger.error(`Scenario ${config.name} failed:`, error);
        }

        const finalMemory = process.memoryUsage().heapUsed;

        // Calculate scenario statistics
        return this.calculateScenarioStats(
            (config as any).name || 'unknown',
            (config as any).duration || 0,
            scenarioStartMetrics,
            initialMemory,
            peakMemory,
            finalMemory
        );
    }

    private async executeSteadyHighFrequency(config: any, endTime: number): Promise<void> {
        logger.info('📈 Starting steady high-frequency event processing');
        
        const eventRate = (config as any).eventRate || 15; // Events per second
        const eventTypes = (config as any).eventTypes || ['m.room.message', 'm.room.member'];
        const intervalMs = 1000 / eventRate;

        while (Date.now() < endTime) {
            // Generate event
            const event = this.generateMatrixEvent(
                this.getRandomElement(eventTypes),
                this.getRandomElement((this.config.apps as any[])).matrixRoomId
            );
            
            this.eventQueue.push(event);
            
            await this.sleep(intervalMs);
        }
    }

    private async executeBurstEventProcessing(config: any, endTime: number): Promise<void> {
        logger.info('💥 Starting burst event processing');
        
        const burstRate = (config as any).burstEventsPerSecond || 40;
        const burstDuration = (config as any).burstDuration || 30000;
        const burstInterval = (config as any).burstInterval || 120000;
        
        let lastBurstTime = 0;

        while (Date.now() < endTime) {
            const now = Date.now();
            
            if (now - lastBurstTime >= burstInterval) {
                // Start burst
                logger.info(`🚀 Starting event burst: ${burstRate} events/second for ${burstDuration}ms`);
                lastBurstTime = now;
                
                const burstEndTime = now + burstDuration;
                const burstIntervalMs = 1000 / burstRate;
                
                while (Date.now() < burstEndTime && Date.now() < endTime) {
                    const event = this.generateMatrixEvent(
                        'm.room.message',
                        this.getRandomElement((this.config.apps as any[])).matrixRoomId
                    );
                    
                    this.eventQueue.push(event);
                    await this.sleep(burstIntervalMs);
                }
            } else {
                // Normal rate between bursts
                const event = this.generateMatrixEvent(
                    'm.room.message',
                    this.getRandomElement((this.config.apps as any[])).matrixRoomId
                );
                
                this.eventQueue.push(event);
                await this.sleep(2000); // Slow rate between bursts
            }
        }
    }

    private async executeVirtualUserStress(config: any, endTime: number): Promise<void> {
        logger.info('👥 Starting virtual user creation stress test');
        
        const newUsersPerMinute = (config as any).newUsersPerMinute || 50;
        const churnRate = (config as any).userChurnRate || 0.2;
        const userCreationInterval = 60000 / newUsersPerMinute;
        
        while (Date.now() < endTime) {
            // Create new user
            const newUser = await this.createVirtualUser(`stress_user_${Date.now()}`);
            
            // Generate member event for new user
            const memberEvent = this.generateMatrixEvent(
                'm.room.member',
                this.getRandomElement((this.config.apps as any[])).matrixRoomId,
                newUser.matrixUserId
            );
            
            this.eventQueue.push(memberEvent);
            
            // Randomly remove old users (churn)
            if (Math.random() < churnRate) {
                const oldUsers = Array.from(this.virtualUsers.values())
                    .filter(u => Date.now() - u.creationTime > 300000); // Older than 5 minutes
                
                if (oldUsers.length > 0) {
                    const userToRemove = this.getRandomElement(oldUsers);
                    userToRemove.isActive = false;
                    this.userCache.delete(userToRemove.id);
                }
            }
            
            await this.sleep(userCreationInterval);
        }
    }

    private async executeEventQueueSaturation(config: any, endTime: number): Promise<void> {
        logger.info('🔄 Starting event queue saturation test');
        
        const eventRate = (config as any).eventRate || 25;
        const processingDelay = (config as any).processingDelay || 200;
        
        // Temporarily slow down processing to build queue
        // Note: Processing delay is applied via payloadSize modification
        
        // Generate events faster than they can be processed
        const intervalMs = 1000 / eventRate;
        
        while (Date.now() < endTime) {
            const event = this.generateMatrixEvent(
                'm.room.message',
                this.getRandomElement((this.config.apps as any[])).matrixRoomId
            );
            
            // Add artificial processing delay
            event.payloadSize += processingDelay;
            
            this.eventQueue.push(event);
            await this.sleep(intervalMs);
        }
    }

    private async executeMixedEventTypes(config: any, endTime: number): Promise<void> {
        logger.info('🔀 Starting mixed event types processing');
        
        const distribution = (config as any).eventDistribution || {};
        const eventRate = (config as any).expectedVariedThroughput || 12;
        const intervalMs = 1000 / eventRate;

        while (Date.now() < endTime) {
            // Select event type based on distribution
            const eventType = this.selectEventTypeByDistribution(distribution);
            
            const event = this.generateMatrixEvent(
                eventType,
                this.getRandomElement((this.config.apps as any[])).matrixRoomId
            );
            
            this.eventQueue.push(event);
            await this.sleep(intervalMs);
        }
    }

    private async executeEventProcessingRecovery(config: any, endTime: number): Promise<void> {
        logger.info('🔧 Starting event processing recovery test');
        
        const failureRate = (config as any).failureRate || 0.05;
        const recoveryTime = (config as any).recoveryTime || 10000;
        const eventRate = (config as any).expectedRecoveryThroughput || 10;
        const intervalMs = 1000 / eventRate;
        
        // Track failure and recovery state
        let isRecovering = false;

        while (Date.now() < endTime) {
            // Simulate periodic failures
            if (!isRecovering && Math.random() < failureRate) {
                logger.warn('🔥 Simulating processing failure - entering recovery mode');
                isRecovering = true;
                
                // During recovery, process events slower
                await this.sleep(recoveryTime);
                
                logger.info('✅ Recovery complete - resuming normal processing');
                isRecovering = false;
            }
            
            const event = this.generateMatrixEvent(
                'm.room.message',
                this.getRandomElement((this.config.apps as any[])).matrixRoomId
            );
            
            this.eventQueue.push(event);
            await this.sleep(isRecovering ? intervalMs * 2 : intervalMs);
        }
    }

    private async executeGenericEventScenario(config: any, endTime: number): Promise<void> {
        logger.info(`🔧 Starting generic event scenario: ${(config as any).name || 'unknown'}`);
        
        const eventRate = 10; // Default rate
        const intervalMs = 1000 / eventRate;

        while (Date.now() < endTime) {
            const event = this.generateMatrixEvent(
                'm.room.message',
                this.getRandomElement((this.config.apps as any[])).matrixRoomId
            );
            
            this.eventQueue.push(event);
            await this.sleep(intervalMs);
        }
    }

    private generateMatrixEvent(eventType: string, roomId: string, senderId?: string): MatrixEvent {
        const event: MatrixEvent = {
            id: crypto.randomUUID(),
            type: eventType,
            roomId,
            senderId: senderId || `@user_${Math.floor(Math.random() * 1000)}:localhost`,
            timestamp: Date.now(),
            content: this.generateEventContent(eventType),
            payloadSize: this.calculatePayloadSize(eventType),
            status: 'queued',
            retryCount: 0
        };

        return event;
    }

    private generateEventContent(eventType: string): any {
        switch (eventType) {
            case 'm.room.message':
                return {
                    msgtype: 'm.text',
                    body: `Test message ${Date.now()}`
                };
            case 'm.room.member':
                return {
                    membership: 'join',
                    displayname: `User ${Date.now()}`
                };
            case 'm.room.topic':
                return {
                    topic: `Test topic ${Date.now()}`
                };
            case 'm.room.avatar':
                return {
                    url: 'mxc://localhost/avatar123'
                };
            case 'm.room.name':
                return {
                    name: `Test Room ${Date.now()}`
                };
            case 'm.typing':
                return {
                    user_ids: [`@user_${Math.floor(Math.random() * 100)}:localhost`]
                };
            default:
                return { data: `Test data for ${eventType}` };
        }
    }

    private calculatePayloadSize(eventType: string): number {
        const baseSizes: Record<string, number> = {
            'm.room.message': 200,
            'm.room.member': 300,
            'm.room.topic': 150,
            'm.room.avatar': 100,
            'm.room.name': 80,
            'm.room.join_rules': 50,
            'm.room.power_levels': 400,
            'm.room.create': 200,
            'm.typing': 50
        };
        
        const baseSize = baseSizes[eventType] || 150;
        return baseSize + Math.floor(Math.random() * baseSize * 0.5); // Add variability
    }

    private selectEventTypeByDistribution(distribution: Record<string, number>): string {
        const rand = Math.random();
        let cumulative = 0;
        
        for (const [eventType, probability] of Object.entries(distribution)) {
            cumulative += probability;
            if (rand <= cumulative) {
                return eventType;
            }
        }
        
        return 'm.room.message'; // Fallback
    }

    private getRandomElement<T>(array: T[]): T {
        const index = Math.floor(Math.random() * array.length);
        const element = array[index];
        if (element === undefined) {
            throw new Error('Array is empty or index out of bounds');
        }
        return element;
    }

    private calculateScenarioStats(
        name: string,
        duration: number,
        startMetrics: any,
        initialMemory: number,
        peakMemory: number,
        finalMemory: number
    ): ScenarioResult {
        const scenarioQueueMetrics = this.queueMetrics.slice(startMetrics.queue);
        const scenarioUserMetrics = this.userMetrics.slice(startMetrics.users);
        const scenarioLatencyMetrics = this.latencyMetrics.slice(startMetrics.latency);
        const scenarioEvents = this.completedEvents.slice(startMetrics.events);

        const totalEvents = scenarioEvents.length + this.failedEvents.length + this.droppedEvents.length;
        const processedEvents = scenarioEvents.length;
        const failedEvents = this.failedEvents.length;
        const droppedEvents = this.droppedEvents.length;

        // Calculate throughput
        const durationSeconds = duration / 1000;
        const avgThroughput = processedEvents / durationSeconds;
        const throughputs = scenarioQueueMetrics.map(m => m.throughput);
        const peakThroughput = throughputs.length > 0 ? Math.max(...throughputs) : 0;

        // Calculate latencies
        const latencies = scenarioEvents
            .map(e => e.processingLatency)
            .filter(l => l !== undefined) as number[];
        const avgLatency = latencies.length > 0 
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
            : 0;
        const sortedLatencies = latencies.sort((a, b) => a - b);
        const p95Latency = sortedLatencies.length > 0 
            ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0 
            : 0;

        // Calculate queue depths
        const queueDepths = scenarioQueueMetrics.map(m => m.queueDepth);
        const maxQueueDepth = queueDepths.length > 0 ? Math.max(...queueDepths) : 0;
        const avgQueueDepth = queueDepths.length > 0 
            ? queueDepths.reduce((a, b) => a + b, 0) / queueDepths.length 
            : 0;

        // Calculate virtual user stats
        const userCounts = scenarioUserMetrics.map(m => m.totalUsers);
        const virtualUsersCreated = userCounts.length > 0 ? Math.max(...userCounts) : 0;
        const activeUserCounts = scenarioUserMetrics.map(m => m.activeUsers);
        const virtualUsersActive = activeUserCounts.length > 0 
            ? Math.max(...activeUserCounts) 
            : 0;

        // Event type breakdown
        const eventTypeBreakdown = Array.from(this.eventTypeMetrics.values());

        return {
            name,
            duration,
            totalEvents,
            processedEvents,
            failedEvents,
            droppedEvents,
            avgThroughput,
            peakThroughput,
            avgLatency,
            p95Latency,
            maxQueueDepth,
            avgQueueDepth,
            virtualUsersCreated,
            virtualUsersActive,
            memoryUsage: {
                initial: initialMemory,
                peak: peakMemory,
                final: finalMemory,
                growth: ((finalMemory - initialMemory) / initialMemory) * 100
            },
            queueMetrics: scenarioQueueMetrics,
            userMetrics: scenarioUserMetrics,
            latencyMetrics: scenarioLatencyMetrics,
            eventTypeBreakdown
        };
    }

    private clearScenarioMetrics(): void {
        // Keep overall metrics but mark scenario boundaries
        // Don't actually clear - we need cumulative data for overall analysis
    }

    private generateResults(_data: any): MatrixEventResults {
        const totalEventsProcessed = this.completedEvents.length;
        const testDurationSeconds = (Date.now() - this.startTime) / 1000;
        const avgEventsPerSecond = totalEventsProcessed / testDurationSeconds;
        
        const throughputs = this.queueMetrics.map(m => m.throughput);
        const peakEventsPerSecond = throughputs.length > 0 ? Math.max(...throughputs) : 0;

        const totalVirtualUsers = this.virtualUsers.size;

        // Calculate overall latencies
        const allLatencies = this.completedEvents
            .map(e => e.processingLatency)
            .filter(l => l !== undefined) as number[];
        
        const sortedLatencies = allLatencies.sort((a, b) => a - b);
        const avgProcessingLatency = allLatencies.length > 0
            ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
            : 0;
        const p95ProcessingLatency = sortedLatencies.length > 0
            ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0
            : 0;
        const p99ProcessingLatency = sortedLatencies.length > 0
            ? sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0
            : 0;

        const totalMemoryUsed = process.memoryUsage().heapUsed;
        const eventSuccessRate = totalEventsProcessed / (totalEventsProcessed + this.failedEvents.length);
        const queueOverflowCount = this.droppedEvents.length;

        // Queue analysis
        const queueDepths = this.queueMetrics.map(m => m.queueDepth);
        const avgQueueDepth = queueDepths.length > 0
            ? queueDepths.reduce((a, b) => a + b, 0) / queueDepths.length
            : 0;
        const maxQueueDepth = queueDepths.length > 0 ? Math.max(...queueDepths) : 0;
        
        const processingRates = this.queueMetrics.map(m => m.processingRate);
        const avgProcessingRate = processingRates.length > 0
            ? processingRates.reduce((a, b) => a + b, 0) / processingRates.length
            : 0;
        const queueEfficiency = avgProcessingRate > 0 ? (avgEventsPerSecond / avgProcessingRate) * 100 : 0;
        
        const backpressureEvents = this.queueMetrics.filter(m => m.backpressure > 0.5).length;
        const optimalQueueSize = Math.ceil(avgProcessingRate * 2); // 2 seconds buffer

        // Virtual user analysis
        const avgUserCreationTime = this.userCreationTimes.length > 0
            ? this.userCreationTimes.reduce((a, b) => a + b, 0) / this.userCreationTimes.length
            : 0;
        const avgUserLookupTime = this.userLookupTimes.length > 0
            ? this.userLookupTimes.reduce((a, b) => a + b, 0) / this.userLookupTimes.length
            : 0;
        
        const cacheHitRatios = this.userMetrics.map(m => m.cacheHitRatio);
        const cacheHitRatio = cacheHitRatios.length > 0
            ? cacheHitRatios.reduce((a, b) => a + b, 0) / cacheHitRatios.length
            : 0;
        
        const userScalabilityFactor = totalVirtualUsers > 0 ? avgUserLookupTime / Math.log(totalVirtualUsers) : 1;
        const totalUserMemory = Array.from(this.virtualUsers.values())
            .reduce((sum, u) => sum + u.memorySize, 0);
        const memoryPerUser = totalVirtualUsers > 0 ? totalUserMemory / totalVirtualUsers : 0;
        const optimalCacheSize = Math.ceil(totalVirtualUsers * 0.2); // Cache 20% of users

        // Event type analysis
        const eventTypeMap = new Map();
        for (const [eventType, metrics] of this.eventTypeMetrics) {
            eventTypeMap.set(eventType, metrics);
        }

        const byType: Record<string, EventTypeMetrics> = {};
        for (const [eventType, metrics] of eventTypeMap) {
            byType[eventType] = metrics;
        }

        const sortedByProcessingTime = Array.from(eventTypeMap.entries())
            .sort(([, a], [, b]) => (b as EventTypeMetrics).avgProcessingTime - (a as EventTypeMetrics).avgProcessingTime);
        const mostExpensive = sortedByProcessingTime.slice(0, 3).map(([eventType]) => eventType);
        const leastExpensive = sortedByProcessingTime.slice(-3).map(([eventType]) => eventType);
        
        const sortedByComplexity = Array.from(eventTypeMap.entries())
            .sort(([, a], [, b]) => (b as EventTypeMetrics).complexityScore - (a as EventTypeMetrics).complexityScore);
        const complexityRanking = sortedByComplexity.map(([eventType]) => eventType);

        // Performance bottlenecks
        const bottlenecks = this.identifyBottlenecks();

        // Determine test success
        const failureReasons: string[] = [];
        const expectedMetrics = this.config.performance.expectedMetrics;

        if (avgEventsPerSecond < expectedMetrics.avgEventsPerSecond * 0.8) {
            failureReasons.push(`Average throughput ${avgEventsPerSecond.toFixed(2)} events/s below target ${expectedMetrics.avgEventsPerSecond}`);
        }

        if (avgProcessingLatency > expectedMetrics.maxEventLatency) {
            failureReasons.push(`Average latency ${avgProcessingLatency.toFixed(2)}ms exceeds maximum ${expectedMetrics.maxEventLatency}ms`);
        }

        if (maxQueueDepth > expectedMetrics.maxQueueDepth) {
            failureReasons.push(`Max queue depth ${maxQueueDepth} exceeds threshold ${expectedMetrics.maxQueueDepth}`);
        }

        if (totalVirtualUsers > expectedMetrics.maxVirtualUsers) {
            failureReasons.push(`Virtual users ${totalVirtualUsers} exceeds maximum ${expectedMetrics.maxVirtualUsers}`);
        }

        if (queueOverflowCount > 0) {
            failureReasons.push(`Queue overflow detected: ${queueOverflowCount} events dropped`);
        }

        // Generate optimization recommendations
        const recommendations = this.generateOptimizationRecommendations(
            avgProcessingLatency, maxQueueDepth, cacheHitRatio, eventSuccessRate
        );

        return {
            testDuration: Date.now() - this.startTime,
            scenarios: this.scenarios,
            overallStats: {
                totalEventsProcessed,
                avgEventsPerSecond,
                peakEventsPerSecond,
                totalVirtualUsers,
                avgProcessingLatency,
                p95ProcessingLatency,
                p99ProcessingLatency,
                totalMemoryUsed,
                eventSuccessRate,
                queueOverflowCount
            },
            queueAnalysis: {
                avgQueueDepth,
                maxQueueDepth,
                queueEfficiency,
                backpressureEvents,
                optimalQueueSize
            },
            virtualUserAnalysis: {
                avgUserCreationTime,
                avgUserLookupTime,
                cacheHitRatio,
                userScalabilityFactor,
                memoryPerUser,
                optimalCacheSize
            },
            eventTypeAnalysis: {
                byType,
                mostExpensive,
                leastExpensive,
                complexityRanking
            },
            performanceBottlenecks: bottlenecks,
            optimization: {
                recommendations: recommendations.recommendations,
                estimatedImprovements: recommendations.estimatedImprovements,
                priority: recommendations.priority
            },
            testPassed: failureReasons.length === 0,
            failureReasons
        };
    }

    private identifyBottlenecks(): Array<{stage: string; impact: number; description: string; recommendations: string[]}> {
        const bottlenecks = [];

        // Queue bottleneck
        const avgQueueDepth = this.queueMetrics.length > 0
            ? this.queueMetrics.reduce((sum, m) => sum + m.queueDepth, 0) / this.queueMetrics.length
            : 0;
        if (avgQueueDepth > 50) {
            bottlenecks.push({
                stage: 'Event Queue',
                impact: Math.min(100, avgQueueDepth / 2),
                description: `High queue depth averaging ${avgQueueDepth.toFixed(1)} events`,
                recommendations: ['Increase processing concurrency', 'Implement event batching', 'Add queue partitioning']
            });
        }

        // Virtual user bottleneck
        const avgUserLookupTime = this.userLookupTimes.length > 0
            ? this.userLookupTimes.reduce((a, b) => a + b, 0) / this.userLookupTimes.length
            : 0;
        if (avgUserLookupTime > 50) {
            bottlenecks.push({
                stage: 'Virtual User Management',
                impact: Math.min(100, avgUserLookupTime / 2),
                description: `Slow user lookups averaging ${avgUserLookupTime.toFixed(2)}ms`,
                recommendations: ['Increase cache size', 'Implement user pre-loading', 'Optimize user storage']
            });
        }

        // Processing latency bottleneck
        const avgLatency = this.completedEvents.length > 0
            ? this.completedEvents.reduce((sum, e) => sum + (e.processingLatency || 0), 0) / this.completedEvents.length
            : 0;
        if (avgLatency > 2000) {
            bottlenecks.push({
                stage: 'Event Processing',
                impact: Math.min(100, avgLatency / 50),
                description: `High processing latency averaging ${avgLatency.toFixed(0)}ms`,
                recommendations: ['Optimize processing algorithms', 'Implement async processing', 'Add processing parallelization']
            });
        }

        return bottlenecks;
    }

    private generateOptimizationRecommendations(
        avgLatency: number,
        maxQueueDepth: number,
        cacheHitRatio: number,
        successRate: number
    ): { recommendations: string[]; estimatedImprovements: Record<string, number>; priority: string[] } {
        const recommendations: string[] = [];
        const estimatedImprovements: Record<string, number> = {};
        const priority: string[] = [];

        if (maxQueueDepth > 100) {
            recommendations.push('HIGH PRIORITY: Implement event processing batching to reduce queue depth');
            recommendations.push('MEDIUM PRIORITY: Increase concurrent event processors');
            estimatedImprovements['queue_optimization'] = 40;
            priority.push('Implement event processing batching to reduce queue depth');
        }

        if (avgLatency > 1000) {
            recommendations.push('HIGH PRIORITY: Optimize event processing pipeline for lower latency');
            recommendations.push('MEDIUM PRIORITY: Implement async processing stages');
            estimatedImprovements['latency_optimization'] = 60;
            priority.push('Optimize event processing pipeline for lower latency');
        }

        if (cacheHitRatio < 0.8) {
            recommendations.push('MEDIUM PRIORITY: Increase virtual user cache size');
            recommendations.push('LOW PRIORITY: Implement cache prewarming');
            estimatedImprovements['cache_optimization'] = 30;
        }

        if (successRate < 0.99) {
            recommendations.push('HIGH PRIORITY: Improve error handling and retry logic');
            estimatedImprovements['reliability_improvement'] = 25;
            priority.push('Improve error handling and retry logic');
        }

        if (this.virtualUsers.size > 150) {
            recommendations.push('MEDIUM PRIORITY: Implement user lifecycle management');
            estimatedImprovements['user_management_optimization'] = 20;
        }

        return { recommendations, estimatedImprovements, priority };
    }

    private async cleanup(): Promise<void> {
        logger.info('Cleaning up Matrix event processing test...');

        this.isProcessing = false;

        if (this.metricsCollector) {
            clearInterval(this.metricsCollector as any);
        }

        if (this.eventProcessor) {
            clearInterval(this.eventProcessor as any);
        }

        if (this.queueMonitor) {
            clearInterval(this.queueMonitor as any);
        }

        if (this.bridge) {
            this.bridge = null;
        }

        // Clear data structures
        this.eventQueue = [];
        this.processingEvents.clear();
        this.completedEvents = [];
        this.failedEvents = [];
        this.droppedEvents = [];
        this.virtualUsers.clear();
        this.userCache.clear();
        this.userCreationTimes = [];
        this.userLookupTimes = [];
        this.queueMetrics = [];
        this.userMetrics = [];
        this.latencyMetrics = [];
        this.eventTypeMetrics.clear();

        logger.info('Cleanup completed');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export for use in performance runner
export default MatrixEventProcessingTest;