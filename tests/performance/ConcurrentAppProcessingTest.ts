import { GooglePlayBridge } from '../../src/bridge/GooglePlayBridge';
import { MockReviewGenerator } from './MockReviewGenerator';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import * as crypto from 'crypto';

const Logger = require('../../src/utils/Logger').Logger;
const logger = Logger.getInstance('ConcurrentAppProcessingTest');

interface ConcurrentOperation {
    id: string;
    appId: string;
    type: 'poll' | 'process' | 'message' | 'database';
    startTime: number;
    endTime?: number;
    status: 'running' | 'completed' | 'failed' | 'blocked';
    duration?: number;
    blockingTime?: number;
    dependencies: string[];
    resourcesUsed: string[];
    lockWaitTime?: number;
}

interface RaceCondition {
    id: string;
    timestamp: number;
    type: 'data_race' | 'resource_race' | 'state_race';
    operations: string[];
    resource: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    stackTrace?: string;
}

interface LockContention {
    lockId: string;
    timestamp: number;
    waitTime: number;
    holdTime: number;
    waitingOperations: string[];
    contendingOperations: string[];
    resource: string;
}

interface ConcurrencyMetrics {
    timestamp: number;
    activeConcurrentOps: number;
    maxConcurrentOps: number;
    avgConcurrentOps: number;
    lockContentionCount: number;
    avgLockWaitTime: number;
    raceConditionCount: number;
    resourceContentionScore: number;
    processingOverlapCount: number;
    duplicateProcessingCount: number;
}

interface ScenarioResult {
    name: string;
    duration: number;
    metrics: ConcurrencyMetrics[];
    operations: ConcurrentOperation[];
    raceConditions: RaceCondition[];
    lockContentions: LockContention[];
    concurrencyStats: {
        maxConcurrency: number;
        avgConcurrency: number;
        peakConcurrencyTime: number;
        totalOperations: number;
        successfulOperations: number;
        failedOperations: number;
        blockedOperations: number;
    };
    performanceImpact: {
        concurrencyOverhead: number;
        lockingOverhead: number;
        contentionPenalty: number;
        throughputDegradation: number;
    };
}

interface ConcurrentAppResults {
    testDuration: number;
    scenarios: ScenarioResult[];
    overallStats: {
        totalConcurrentOperations: number;
        maxObservedConcurrency: number;
        avgConcurrency: number;
        totalRaceConditions: number;
        totalLockContentions: number;
        avgLockWaitTime: number;
        duplicateProcessingRate: number;
        dataCorruptionCount: number;
    };
    raceConditionAnalysis: {
        byType: Record<string, number>;
        bySeverity: Record<string, number>;
        hotspots: string[];
        timeline: RaceCondition[];
    };
    lockContentionAnalysis: {
        mostContentedLocks: string[];
        avgWaitTimeByLock: Record<string, number>;
        contentionPatterns: string[];
        optimizationSuggestions: string[];
    };
    resourceContentionAnalysis: {
        memoryContention: number;
        cpuContention: number;
        ioContention: number;
        networkContention: number;
    };
    synchronizationAnalysis: {
        atomicOperationEfficiency: number;
        mutexEffectiveness: number;
        barrierSynchronization: number;
        overallSyncHealth: number;
    };
    dataConsistency: {
        transactionConsistency: number;
        referentialIntegrity: number;
        messageConsistency: number;
        stateConsistency: number;
    };
    optimization: {
        recommendations: string[];
        estimatedImprovements: Record<string, number>;
        priority: string[];
    };
    testPassed: boolean;
    failureReasons: string[];
}

export class ConcurrentAppProcessingTest {
    private bridge: GooglePlayBridge | null = null;
    private mockGenerator: MockReviewGenerator;
    private config: any;
    private startTime: number = 0;
    
    // Concurrency tracking
    private activeOperations: Map<string, ConcurrentOperation> = new Map();
    private completedOperations: ConcurrentOperation[] = [];
    private raceConditions: RaceCondition[] = [];
    private lockContentions: LockContention[] = [];
    private concurrencyMetrics: ConcurrencyMetrics[] = [];
    
    // Resource tracking
    private resourceLocks: Map<string, Set<string>> = new Map();
    private operationDependencies: Map<string, Set<string>> = new Map();
    private resourceAccess: Map<string, string[]> = new Map();
    
    // State tracking for race condition detection
    private appStates: Map<string, any> = new Map();
    private dataSnapshots: Map<string, any> = new Map();
    private processingQueues: Map<string, string[]> = new Map();
    
    // Monitoring
    private metricsCollector: NodeJS.Timer | null = null;
    private raceConditionDetector: NodeJS.Timer | null = null;
    private lockMonitor: NodeJS.Timer | null = null;
    
    private scenarios: ScenarioResult[] = [];

    constructor() {
        this.mockGenerator = new MockReviewGenerator();
        this.initializeLockSystem();
    }

    private initializeLockSystem(): void {
        // Initialize common resource locks
        this.resourceLocks.set('database', new Set());
        this.resourceLocks.set('api_client', new Set());
        this.resourceLocks.set('message_queue', new Set());
        this.resourceLocks.set('app_state', new Set());
        this.resourceLocks.set('file_system', new Set());
    }

    async runConcurrentAppTest(): Promise<ConcurrentAppResults> {
        logger.info('🔄 Starting Concurrent App Processing Test (Scenario 4.1)');
        logger.info('Duration: 90 minutes with multiple concurrency scenarios');

        try {
            await this.loadConfiguration();
            await this.initializeBridge();
            this.startMonitoring();

            const results = await this.executeConcurrencyScenarios();
            
            await this.cleanup();
            return this.generateResults(results);
        } catch (error) {
            logger.error('Concurrent app processing test failed:', error);
            throw error;
        }
    }

    private async loadConfiguration(): Promise<void> {
        const configPath = path.join(process.cwd(), 'config', 'performance-concurrent-apps.yaml');
        
        if (!fs.existsSync(configPath)) {
            logger.warn('Concurrent apps config not found, using defaults');
            this.config = this.getDefaultConfig();
        } else {
            const yaml = await import('js-yaml');
            const configContent = fs.readFileSync(configPath, 'utf8');
            this.config = yaml.load(configContent);
        }

        logger.info('Configuration loaded:', {
            duration: this.config.performance.testDuration,
            scenarios: this.config.performance.concurrencyScenarios.length,
            apps: this.config.apps.length,
            expectedMetrics: this.config.performance.expectedMetrics
        });
    }

    private getDefaultConfig(): any {
        return {
            apps: [
                { packageName: 'com.concurrent.app1', matrixRoomId: '!app1:localhost', priority: 'high' },
                { packageName: 'com.concurrent.app2', matrixRoomId: '!app2:localhost', priority: 'high' },
                { packageName: 'com.concurrent.app3', matrixRoomId: '!app3:localhost', priority: 'medium' },
                { packageName: 'com.concurrent.app4', matrixRoomId: '!app4:localhost', priority: 'medium' },
                { packageName: 'com.concurrent.app5', matrixRoomId: '!app5:localhost', priority: 'low' }
            ],
            performance: {
                testDuration: 5400000, // 90 minutes
                concurrencyMonitoring: { enabled: true, sampleInterval: 1000 },
                expectedMetrics: {
                    maxConcurrentPolls: 8,
                    maxConcurrentProcessing: 15,
                    avgConcurrentOperations: 5,
                    maxLockWaitTime: 100,
                    avgLockWaitTime: 10,
                    lockContentionRate: 0.05,
                    maxRaceConditions: 0,
                    dataCorruptionRate: 0,
                    duplicateProcessingRate: 0.01
                },
                concurrencyScenarios: [
                    {
                        name: 'simultaneous_polling_start',
                        duration: 900000,
                        syncedStart: true,
                        pollingAlignment: 'synchronized'
                    },
                    {
                        name: 'staggered_polling_intervals',
                        duration: 1200000,
                        syncedStart: false,
                        pollingAlignment: 'staggered',
                        staggerDelay: 5000
                    },
                    {
                        name: 'random_polling_chaos',
                        duration: 1200000,
                        syncedStart: false,
                        pollingAlignment: 'random',
                        randomIntervalRange: [10000, 90000]
                    }
                ]
            }
        };
    }

    private async initializeBridge(): Promise<void> {
        logger.info('Initializing bridge for concurrency testing...');
        
        const bridgeConfig = {
            ...this.config.bridge,
            database: { engine: 'sqlite', filename: ':memory:' }
        };

        this.bridge = new GooglePlayBridge(bridgeConfig);
        
        // Initialize with mock data for each app
        await this.setupMockEnvironment();
        
        logger.info('Bridge initialized for concurrency testing');
    }

    private async setupMockEnvironment(): Promise<void> {
        // Setup mock data for each app
        for (const app of this.config.apps) {
            await this.mockGenerator.generateReviews(app.packageName, 50);
            
            // Initialize app state tracking
            this.appStates.set(app.packageName, {
                lastPollTime: 0,
                isPolling: false,
                isProcessing: false,
                queueSize: 0,
                errorCount: 0
            });
            
            this.processingQueues.set(app.packageName, []);
        }
    }

    private startMonitoring(): void {
        this.startTime = Date.now();

        // Start concurrency metrics collection
        this.metricsCollector = setInterval(() => {
            this.collectConcurrencyMetrics();
        }, this.config.performance.concurrencyMonitoring?.sampleInterval || 1000);

        // Start race condition detection
        this.raceConditionDetector = setInterval(() => {
            this.detectRaceConditions();
        }, 500); // More frequent race condition checking

        // Start lock monitoring
        this.lockMonitor = setInterval(() => {
            this.monitorLockContention();
        }, 1000);

        logger.info('Concurrency monitoring started');
    }

    private collectConcurrencyMetrics(): void {
        const now = Date.now();
        const activeOpsCount = this.activeOperations.size;
        const recentOps = Array.from(this.activeOperations.values())
            .filter(op => now - op.startTime < 10000); // Operations in last 10 seconds

        const avgConcurrentOps = recentOps.length > 0 
            ? recentOps.length 
            : activeOpsCount;

        const lockWaitTimes = this.lockContentions
            .filter(lc => now - lc.timestamp < 10000)
            .map(lc => lc.waitTime);
        
        const avgLockWaitTime = lockWaitTimes.length > 0
            ? lockWaitTimes.reduce((a, b) => a + b, 0) / lockWaitTimes.length
            : 0;

        const recentRaceConditions = this.raceConditions
            .filter(rc => now - rc.timestamp < 10000).length;

        // Calculate resource contention score
        const resourceContentionScore = this.calculateResourceContentionScore();

        // Count processing overlaps
        const processingOverlapCount = this.countProcessingOverlaps();

        // Count duplicate processing
        const duplicateProcessingCount = this.countDuplicateProcessing();

        const metric: ConcurrencyMetrics = {
            timestamp: now,
            activeConcurrentOps: activeOpsCount,
            maxConcurrentOps: Math.max(...this.concurrencyMetrics.map(m => m.activeConcurrentOps), activeOpsCount),
            avgConcurrentOps,
            lockContentionCount: this.lockContentions.filter(lc => now - lc.timestamp < 10000).length,
            avgLockWaitTime,
            raceConditionCount: recentRaceConditions,
            resourceContentionScore,
            processingOverlapCount,
            duplicateProcessingCount
        };

        this.concurrencyMetrics.push(metric);

        // Alert on high concurrency
        if (activeOpsCount > this.config.performance.expectedMetrics.maxConcurrentPolls) {
            logger.warn(`High concurrency detected: ${activeOpsCount} concurrent operations`);
        }

        // Alert on race conditions
        if (recentRaceConditions > 0) {
            logger.error(`Race conditions detected: ${recentRaceConditions} in last 10 seconds`);
        }
    }

    private detectRaceConditions(): void {
        // Data race detection
        this.detectDataRaces();
        
        // Resource race detection
        this.detectResourceRaces();
        
        // State race detection
        this.detectStateRaces();
    }

    private detectDataRaces(): void {
        const now = Date.now();
        
        // Check for concurrent database operations on same resources
        const dbOperations = Array.from(this.activeOperations.values())
            .filter(op => op.type === 'database' && op.status === 'running');

        for (let i = 0; i < dbOperations.length; i++) {
            for (let j = i + 1; j < dbOperations.length; j++) {
                const op1 = dbOperations[i];
                const op2 = dbOperations[j];

                // Check if operations access same resource
                const sharedResources = op1.resourcesUsed.filter(r => op2.resourcesUsed.includes(r));
                
                if (sharedResources.length > 0) {
                    this.reportRaceCondition({
                        id: `data_race_${crypto.randomUUID()}`,
                        timestamp: now,
                        type: 'data_race',
                        operations: [op1.id, op2.id],
                        resource: sharedResources[0],
                        severity: 'high',
                        description: `Concurrent database operations accessing ${sharedResources[0]}`
                    });
                }
            }
        }
    }

    private detectResourceRaces(): void {
        const now = Date.now();
        
        // Check for resource access conflicts
        const resourceEntries = Array.from(this.resourceLocks.entries());
        for (const [resource, accessors] of resourceEntries) {
            if (accessors.size > 1) {
                const operations = Array.from(accessors);
                this.reportRaceCondition({
                    id: `resource_race_${crypto.randomUUID()}`,
                    timestamp: now,
                    type: 'resource_race',
                    operations,
                    resource,
                    severity: 'medium',
                    description: `Multiple operations accessing resource ${resource} simultaneously`
                });
            }
        }
    }

    private detectStateRaces(): void {
        const now = Date.now();
        
        // Check for app state inconsistencies
        const stateEntries = Array.from(this.appStates.entries());
        for (const [appId, state] of stateEntries) {
            if (state.isPolling && state.isProcessing) {
                // Check for operations that should be mutually exclusive
                const conflictingOps = Array.from(this.activeOperations.values())
                    .filter(op => op.appId === appId && (op.type === 'poll' || op.type === 'process'));

                if (conflictingOps.length > 1) {
                    this.reportRaceCondition({
                        id: `state_race_${crypto.randomUUID()}`,
                        timestamp: now,
                        type: 'state_race',
                        operations: conflictingOps.map(op => op.id),
                        resource: `app_state_${appId}`,
                        severity: 'critical',
                        description: `Conflicting polling and processing operations for app ${appId}`
                    });
                }
            }
        }
    }

    private reportRaceCondition(raceCondition: RaceCondition): void {
        this.raceConditions.push(raceCondition);
        logger.error(`Race condition detected: ${raceCondition.description}`, {
            type: raceCondition.type,
            severity: raceCondition.severity,
            resource: raceCondition.resource,
            operations: raceCondition.operations
        });
    }

    private monitorLockContention(): void {
        const now = Date.now();
        
        // Monitor resource locks for contention
        const lockEntries = Array.from(this.resourceLocks.entries());
        for (const [resource, accessors] of lockEntries) {
            if (accessors.size > 1) {
                const operations = Array.from(accessors);
                const waitingOps = operations.slice(1); // All except first are waiting
                
                // Calculate wait times
                const waitTimes = waitingOps.map(opId => {
                    const op = this.activeOperations.get(opId);
                    return op ? now - op.startTime : 0;
                });

                const avgWaitTime = waitTimes.length > 0
                    ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
                    : 0;

                this.lockContentions.push({
                    lockId: `${resource}_${now}`,
                    timestamp: now,
                    waitTime: avgWaitTime,
                    holdTime: 0, // Will be updated when lock is released
                    waitingOperations: waitingOps,
                    contendingOperations: operations,
                    resource
                });
            }
        }
    }

    private calculateResourceContentionScore(): number {
        // Score from 0-100 based on resource contention levels
        const memoryPressure = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal;
        const activeOpsRatio = this.activeOperations.size / 20; // Assuming 20 is max reasonable
        const lockContentionRatio = this.resourceLocks.size > 0 
            ? Array.from(this.resourceLocks.values()).filter(set => set.size > 1).length / this.resourceLocks.size
            : 0;

        return Math.min(100, (memoryPressure + activeOpsRatio + lockContentionRatio) * 33.33);
    }

    private countProcessingOverlaps(): number {
        const now = Date.now();
        let overlapCount = 0;
        
        // Count operations that are processing the same app simultaneously
        const processingOps = Array.from(this.activeOperations.values())
            .filter(op => op.type === 'process' && op.status === 'running');

        const appProcessingCount = new Map<string, number>();
        for (const op of processingOps) {
            appProcessingCount.set(op.appId, (appProcessingCount.get(op.appId) || 0) + 1);
        }

        for (const count of appProcessingCount.values()) {
            if (count > 1) {
                overlapCount += count - 1; // Overlaps = concurrent operations - 1
            }
        }

        return overlapCount;
    }

    private countDuplicateProcessing(): number {
        // Count operations that are processing the same data
        const recentOps = this.completedOperations
            .filter(op => Date.now() - op.startTime < 60000); // Last minute

        const dataProcessed = new Map<string, number>();
        for (const op of recentOps) {
            const key = `${op.appId}_${op.type}`;
            dataProcessed.set(key, (dataProcessed.get(key) || 0) + 1);
        }

        let duplicateCount = 0;
        for (const count of dataProcessed.values()) {
            if (count > 1) {
                duplicateCount += count - 1;
            }
        }

        return duplicateCount;
    }

    private async executeConcurrencyScenarios(): Promise<any> {
        const scenarios = this.config.performance.concurrencyScenarios;
        
        for (const scenarioConfig of scenarios) {
            logger.info(`\n🔄 Executing scenario: ${scenarioConfig.name}`);
            logger.info(`Duration: ${scenarioConfig.duration / 1000}s`);
            
            const scenarioResult = await this.executeScenario(scenarioConfig);
            this.scenarios.push(scenarioResult);
            
            // Brief pause between scenarios
            await this.sleep(10000);
            
            // Clear metrics between scenarios
            this.clearScenarioMetrics();
        }

        return {
            scenarios: this.scenarios,
            metrics: this.concurrencyMetrics,
            raceConditions: this.raceConditions,
            lockContentions: this.lockContentions
        };
    }

    private async executeScenario(config: any): Promise<ScenarioResult> {
        const startTime = Date.now();
        const endTime = startTime + config.duration;
        const scenarioStartMetricsCount = this.concurrencyMetrics.length;
        const scenarioStartOperations = this.completedOperations.length;
        const scenarioStartRaceConditions = this.raceConditions.length;
        const scenarioStartLockContentions = this.lockContentions.length;

        try {
            switch (config.name) {
                case 'simultaneous_polling_start':
                    await this.executeSimultaneousPolling(config, endTime);
                    break;
                case 'staggered_polling_intervals':
                    await this.executeStaggeredPolling(config, endTime);
                    break;
                case 'peak_concurrency_stress':
                    await this.executePeakConcurrencyStress(config, endTime);
                    break;
                case 'random_polling_chaos':
                    await this.executeRandomPollingChaos(config, endTime);
                    break;
                case 'resource_contention_simulation':
                    await this.executeResourceContentionSimulation(config, endTime);
                    break;
                case 'concurrent_failure_recovery':
                    await this.executeConcurrentFailureRecovery(config, endTime);
                    break;
                default:
                    await this.executeGenericConcurrencyScenario(config, endTime);
            }
        } catch (error) {
            logger.error(`Scenario ${config.name} failed:`, error);
        }

        // Calculate scenario statistics
        return this.calculateScenarioStats(
            config.name,
            config.duration,
            scenarioStartMetricsCount,
            scenarioStartOperations,
            scenarioStartRaceConditions,
            scenarioStartLockContentions
        );
    }

    private async executeSimultaneousPolling(config: any, endTime: number): Promise<void> {
        logger.info('🚀 Starting simultaneous polling for all apps');

        while (Date.now() < endTime) {
            // Start all apps polling simultaneously
            const pollingOperations = [];
            
            for (const app of this.config.apps) {
                pollingOperations.push(this.startConcurrentOperation(
                    app.packageName,
                    'poll',
                    ['database', 'api_client']
                ));
            }

            // Wait for all polls to complete
            await Promise.all(pollingOperations);
            
            // Process results concurrently
            const processingOperations = [];
            
            for (const app of this.config.apps) {
                processingOperations.push(this.startConcurrentOperation(
                    app.packageName,
                    'process',
                    ['database', 'message_queue']
                ));
            }

            await Promise.all(processingOperations);
            
            // Wait before next cycle
            await this.sleep(30000); // 30 seconds between cycles
        }
    }

    private async executeStaggeredPolling(config: any, endTime: number): Promise<void> {
        logger.info('⏱️  Starting staggered polling with delays');
        
        const staggerDelay = config.staggerDelay || 5000;
        let appIndex = 0;

        while (Date.now() < endTime) {
            // Stagger app polling
            for (const app of this.config.apps) {
                if (Date.now() >= endTime) break;
                
                // Start polling for this app
                const pollingOp = this.startConcurrentOperation(
                    app.packageName,
                    'poll',
                    ['database', 'api_client']
                );

                // Stagger delay
                await this.sleep(staggerDelay);
                
                // Process results while next app starts polling
                const processingOp = this.startConcurrentOperation(
                    app.packageName,
                    'process',
                    ['database', 'message_queue']
                );

                appIndex++;
            }
            
            // Wait for completion of current cycle
            await this.sleep(10000);
        }
    }

    private async executePeakConcurrencyStress(config: any, endTime: number): Promise<void> {
        logger.info('💥 Starting peak concurrency stress test');
        
        const pollingInterval = config.pollingInterval || 15000;

        while (Date.now() < endTime) {
            const operations = [];
            
            // Start maximum concurrent operations
            for (const app of this.config.apps) {
                // Concurrent polling
                operations.push(this.startConcurrentOperation(
                    app.packageName,
                    'poll',
                    ['database', 'api_client']
                ));
                
                // Concurrent processing
                operations.push(this.startConcurrentOperation(
                    app.packageName,
                    'process',
                    ['database', 'message_queue', 'app_state']
                ));
                
                // Concurrent messaging
                operations.push(this.startConcurrentOperation(
                    app.packageName,
                    'message',
                    ['message_queue', 'api_client']
                ));
            }

            // Let operations run concurrently
            await Promise.allSettled(operations);
            
            await this.sleep(pollingInterval);
        }
    }

    private async executeRandomPollingChaos(config: any, endTime: number): Promise<void> {
        logger.info('🎲 Starting random polling chaos test');
        
        const [minInterval, maxInterval] = config.randomIntervalRange || [10000, 90000];

        // Start random polling for each app
        const appPromises = this.config.apps.map(app => 
            this.randomAppPolling(app, endTime, minInterval, maxInterval)
        );

        await Promise.all(appPromises);
    }

    private async randomAppPolling(app: any, endTime: number, minInterval: number, maxInterval: number): Promise<void> {
        while (Date.now() < endTime) {
            // Random interval
            const interval = Math.random() * (maxInterval - minInterval) + minInterval;
            
            // Start operations with random resource usage
            const resources = this.getRandomResources();
            
            const operations = [
                this.startConcurrentOperation(app.packageName, 'poll', resources),
                this.startConcurrentOperation(app.packageName, 'process', resources)
            ];

            await Promise.allSettled(operations);
            await this.sleep(interval);
        }
    }

    private async executeResourceContentionSimulation(config: any, endTime: number): Promise<void> {
        logger.info('⚔️  Starting resource contention simulation');
        
        while (Date.now() < endTime) {
            const operations = [];
            
            // Force resource contention by using same resources
            const sharedResources = ['database', 'message_queue'];
            
            for (const app of this.config.apps) {
                operations.push(
                    this.startConcurrentOperation(app.packageName, 'poll', sharedResources),
                    this.startConcurrentOperation(app.packageName, 'process', sharedResources),
                    this.startConcurrentOperation(app.packageName, 'database', sharedResources)
                );
            }

            await Promise.allSettled(operations);
            await this.sleep(20000);
        }
    }

    private async executeConcurrentFailureRecovery(config: any, endTime: number): Promise<void> {
        logger.info('🔥 Starting concurrent failure recovery test');
        
        const failureRate = config.failureRate || 0.1;

        while (Date.now() < endTime) {
            const operations = [];
            
            for (const app of this.config.apps) {
                // Some operations will fail randomly
                const shouldFail = Math.random() < failureRate;
                
                operations.push(this.startConcurrentOperation(
                    app.packageName,
                    'poll',
                    ['database', 'api_client'],
                    shouldFail
                ));
            }

            await Promise.allSettled(operations);
            await this.sleep(30000);
        }
    }

    private async executeGenericConcurrencyScenario(config: any, endTime: number): Promise<void> {
        logger.info(`🔧 Starting generic concurrency scenario: ${config.name}`);
        
        while (Date.now() < endTime) {
            const operations = [];
            
            for (const app of this.config.apps) {
                operations.push(this.startConcurrentOperation(
                    app.packageName,
                    'poll',
                    ['database', 'api_client']
                ));
            }

            await Promise.allSettled(operations);
            await this.sleep(60000);
        }
    }

    private async startConcurrentOperation(
        appId: string,
        type: 'poll' | 'process' | 'message' | 'database',
        resources: string[],
        shouldFail: boolean = false
    ): Promise<void> {
        const operationId = `${type}_${appId}_${Date.now()}_${Math.random()}`;
        const startTime = performance.now();

        // Create operation record
        const operation: ConcurrentOperation = {
            id: operationId,
            appId,
            type,
            startTime,
            status: 'running',
            dependencies: [],
            resourcesUsed: resources,
            lockWaitTime: 0
        };

        // Acquire resource locks
        const lockAcquireStart = performance.now();
        await this.acquireResourceLocks(operationId, resources);
        operation.lockWaitTime = performance.now() - lockAcquireStart;

        this.activeOperations.set(operationId, operation);

        try {
            // Update app state
            const appState = this.appStates.get(appId) || {};
            if (type === 'poll') appState.isPolling = true;
            if (type === 'process') appState.isProcessing = true;
            this.appStates.set(appId, appState);

            // Simulate operation
            await this.simulateOperation(type, appId, shouldFail);

            // Mark as completed
            operation.endTime = performance.now();
            operation.duration = operation.endTime - operation.startTime;
            operation.status = 'completed';

        } catch (error) {
            operation.status = 'failed';
            logger.error(`Operation ${operationId} failed:`, error);
        } finally {
            // Release resource locks
            await this.releaseResourceLocks(operationId, resources);

            // Update app state
            const appState = this.appStates.get(appId) || {};
            if (type === 'poll') appState.isPolling = false;
            if (type === 'process') appState.isProcessing = false;
            this.appStates.set(appId, appState);

            // Move to completed operations
            this.activeOperations.delete(operationId);
            this.completedOperations.push(operation);
        }
    }

    private async acquireResourceLocks(operationId: string, resources: string[]): Promise<void> {
        for (const resource of resources) {
            const lockSet = this.resourceLocks.get(resource) || new Set();
            lockSet.add(operationId);
            this.resourceLocks.set(resource, lockSet);

            // Track resource access
            const accessors: string[] = this.resourceAccess.get(resource) || [];
            accessors.push(operationId);
            this.resourceAccess.set(resource, accessors);
        }
    }

    private async releaseResourceLocks(operationId: string, resources: string[]): Promise<void> {
        for (const resource of resources) {
            const lockSet = this.resourceLocks.get(resource);
            if (lockSet) {
                lockSet.delete(operationId);
                this.resourceLocks.set(resource, lockSet);
            }
        }
    }

    private async simulateOperation(type: string, appId: string, shouldFail: boolean): Promise<void> {
        // Simulate different operation types
        const baseDuration = this.getOperationBaseDuration(type);
        const duration = baseDuration + (Math.random() * baseDuration * 0.5); // Add variability

        if (shouldFail && Math.random() < 0.5) {
            await this.sleep(duration * 0.3); // Partial execution before failure
            throw new Error(`Simulated failure in ${type} operation for ${appId}`);
        }

        // Simulate work with resource access
        await this.sleep(duration);

        // Simulate data operations that could cause races
        if (type === 'process') {
            await this.simulateDataProcessing(appId);
        } else if (type === 'database') {
            await this.simulateDatabaseOperation(appId);
        }
    }

    private getOperationBaseDuration(type: string): number {
        const durations = {
            poll: 200,
            process: 150,
            message: 100,
            database: 50
        };
        return durations[type] || 100;
    }

    private async simulateDataProcessing(appId: string): Promise<void> {
        // Simulate processing that could lead to race conditions
        const queue = this.processingQueues.get(appId) || [];
        
        // Add items to queue
        for (let i = 0; i < 5; i++) {
            queue.push(`item_${Date.now()}_${i}`);
        }
        
        // Process items (potential race condition here)
        await this.sleep(50);
        queue.splice(0, 3); // Remove processed items
        
        this.processingQueues.set(appId, queue);
    }

    private async simulateDatabaseOperation(appId: string): Promise<void> {
        // Simulate database operations that could cause data races
        const snapshot = this.dataSnapshots.get(appId) || { counter: 0, lastUpdate: Date.now() };
        
        // Read-modify-write operation (race condition potential)
        await this.sleep(10);
        snapshot.counter++;
        snapshot.lastUpdate = Date.now();
        
        await this.sleep(10);
        this.dataSnapshots.set(appId, snapshot);
    }

    private getRandomResources(): string[] {
        const allResources = ['database', 'api_client', 'message_queue', 'app_state', 'file_system'];
        const count = Math.floor(Math.random() * 3) + 1; // 1-3 resources
        const resources = [];
        
        for (let i = 0; i < count; i++) {
            const resource = allResources[Math.floor(Math.random() * allResources.length)];
            if (!resources.includes(resource)) {
                resources.push(resource);
            }
        }
        
        return resources;
    }

    private calculateScenarioStats(
        name: string,
        duration: number,
        startMetricsIndex: number,
        startOperationsIndex: number,
        startRaceConditionsIndex: number,
        startLockContentionsIndex: number
    ): ScenarioResult {
        const scenarioMetrics = this.concurrencyMetrics.slice(startMetricsIndex);
        const scenarioOperations = this.completedOperations.slice(startOperationsIndex);
        const scenarioRaceConditions = this.raceConditions.slice(startRaceConditionsIndex);
        const scenarioLockContentions = this.lockContentions.slice(startLockContentionsIndex);

        // Calculate concurrency statistics
        const concurrencies = scenarioMetrics.map(m => m.activeConcurrentOps);
        const maxConcurrency = Math.max(...concurrencies, 0);
        const avgConcurrency = concurrencies.length > 0
            ? concurrencies.reduce((a, b) => a + b, 0) / concurrencies.length
            : 0;

        // Find peak concurrency time
        const peakMetric = scenarioMetrics.find(m => m.activeConcurrentOps === maxConcurrency);
        const peakConcurrencyTime = peakMetric ? peakMetric.timestamp : Date.now();

        // Count operation statuses
        const totalOperations = scenarioOperations.length;
        const successfulOperations = scenarioOperations.filter(op => op.status === 'completed').length;
        const failedOperations = scenarioOperations.filter(op => op.status === 'failed').length;
        const blockedOperations = scenarioOperations.filter(op => op.status === 'blocked').length;

        // Calculate performance impact
        const avgOperationDuration = scenarioOperations.length > 0
            ? scenarioOperations.reduce((sum, op) => sum + (op.duration || 0), 0) / scenarioOperations.length
            : 0;

        const avgLockWaitTime = scenarioOperations.length > 0
            ? scenarioOperations.reduce((sum, op) => sum + (op.lockWaitTime || 0), 0) / scenarioOperations.length
            : 0;

        const concurrencyOverhead = avgLockWaitTime / avgOperationDuration * 100 || 0;
        const lockingOverhead = scenarioLockContentions.length / totalOperations * 100 || 0;
        const contentionPenalty = scenarioRaceConditions.length / totalOperations * 100 || 0;
        const throughputDegradation = failedOperations / totalOperations * 100 || 0;

        return {
            name,
            duration,
            metrics: scenarioMetrics,
            operations: scenarioOperations,
            raceConditions: scenarioRaceConditions,
            lockContentions: scenarioLockContentions,
            concurrencyStats: {
                maxConcurrency,
                avgConcurrency,
                peakConcurrencyTime,
                totalOperations,
                successfulOperations,
                failedOperations,
                blockedOperations
            },
            performanceImpact: {
                concurrencyOverhead,
                lockingOverhead,
                contentionPenalty,
                throughputDegradation
            }
        };
    }

    private clearScenarioMetrics(): void {
        // Keep overall metrics but mark scenario boundaries
        // Don't actually clear - we need cumulative data for overall analysis
    }

    private analyzeRaceConditions(): any {
        const byType: Record<string, number> = {};
        const bySeverity: Record<string, number> = {};
        const hotspots: string[] = [];

        for (const rc of this.raceConditions) {
            byType[rc.type] = (byType[rc.type] || 0) + 1;
            bySeverity[rc.severity] = (bySeverity[rc.severity] || 0) + 1;
        }

        // Identify hotspots (most frequently accessed resources with race conditions)
        const resourceCounts = new Map<string, number>();
        for (const rc of this.raceConditions) {
            resourceCounts.set(rc.resource, (resourceCounts.get(rc.resource) || 0) + 1);
        }

        const sortedResources = Array.from(resourceCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([resource]) => resource);

        return {
            byType,
            bySeverity,
            hotspots: sortedResources,
            timeline: this.raceConditions.slice().sort((a, b) => a.timestamp - b.timestamp)
        };
    }

    private analyzeLockContentions(): any {
        // Find most contended locks
        const lockCounts = new Map<string, number>();
        const lockWaitTimes = new Map<string, number[]>();

        for (const lc of this.lockContentions) {
            lockCounts.set(lc.resource, (lockCounts.get(lc.resource) || 0) + 1);
            
            const waitTimes = lockWaitTimes.get(lc.resource) || [];
            waitTimes.push(lc.waitTime);
            lockWaitTimes.set(lc.resource, waitTimes);
        }

        const mostContentedLocks = Array.from(lockCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([resource]) => resource);

        const avgWaitTimeByLock: Record<string, number> = {};
        for (const [resource, waitTimes] of lockWaitTimes.entries()) {
            avgWaitTimeByLock[resource] = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
        }

        const contentionPatterns = this.identifyContentionPatterns();
        const optimizationSuggestions = this.generateLockOptimizations();

        return {
            mostContentedLocks,
            avgWaitTimeByLock,
            contentionPatterns,
            optimizationSuggestions
        };
    }

    private identifyContentionPatterns(): string[] {
        const patterns: string[] = [];

        // Check for recurring contention patterns
        const timeWindows = this.groupContentionsByTimeWindow(60000); // 1-minute windows
        
        for (const window of timeWindows) {
            if (window.contentions.length > 5) {
                patterns.push(`High contention period: ${new Date(window.startTime).toISOString()}`);
            }
        }

        return patterns;
    }

    private groupContentionsByTimeWindow(windowSize: number): any[] {
        const windows: any[] = [];
        const startTime = this.startTime;
        const endTime = Date.now();

        for (let time = startTime; time < endTime; time += windowSize) {
            const windowContentions = this.lockContentions.filter(lc => 
                lc.timestamp >= time && lc.timestamp < time + windowSize
            );

            windows.push({
                startTime: time,
                endTime: time + windowSize,
                contentions: windowContentions
            });
        }

        return windows;
    }

    private generateLockOptimizations(): string[] {
        const suggestions: string[] = [];

        // Analyze lock usage patterns
        const highContentionLocks = this.lockContentions
            .reduce((acc, lc) => {
                acc[lc.resource] = (acc[lc.resource] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

        for (const [resource, count] of Object.entries(highContentionLocks)) {
            if (count > 10) {
                suggestions.push(`HIGH PRIORITY: Implement lock-free algorithms for ${resource}`);
                suggestions.push(`MEDIUM PRIORITY: Consider read-write locks for ${resource}`);
            }
        }

        if (this.raceConditions.length > 0) {
            suggestions.push('HIGH PRIORITY: Implement atomic operations for shared data');
            suggestions.push('HIGH PRIORITY: Add synchronization barriers for critical sections');
        }

        return suggestions;
    }

    private generateResults(data: any): ConcurrentAppResults {
        const totalOperations = this.completedOperations.length;
        const concurrencies = this.concurrencyMetrics.map(m => m.activeConcurrentOps);
        const maxObservedConcurrency = Math.max(...concurrencies, 0);
        const avgConcurrency = concurrencies.length > 0
            ? concurrencies.reduce((a, b) => a + b, 0) / concurrencies.length
            : 0;

        const duplicateProcessingRate = totalOperations > 0
            ? this.countDuplicateProcessing() / totalOperations
            : 0;

        const avgLockWaitTime = this.lockContentions.length > 0
            ? this.lockContentions.reduce((sum, lc) => sum + lc.waitTime, 0) / this.lockContentions.length
            : 0;

        // Determine test success
        const failureReasons: string[] = [];
        const expectedMetrics = this.config.performance.expectedMetrics;

        if (maxObservedConcurrency > expectedMetrics.maxConcurrentPolls) {
            failureReasons.push(`Max concurrency ${maxObservedConcurrency} exceeds threshold ${expectedMetrics.maxConcurrentPolls}`);
        }

        if (this.raceConditions.length > expectedMetrics.maxRaceConditions) {
            failureReasons.push(`Race conditions detected: ${this.raceConditions.length} (max: ${expectedMetrics.maxRaceConditions})`);
        }

        if (avgLockWaitTime > expectedMetrics.maxLockWaitTime) {
            failureReasons.push(`Average lock wait time ${avgLockWaitTime.toFixed(2)}ms exceeds threshold ${expectedMetrics.maxLockWaitTime}ms`);
        }

        if (duplicateProcessingRate > expectedMetrics.duplicateProcessingRate) {
            failureReasons.push(`Duplicate processing rate ${(duplicateProcessingRate * 100).toFixed(2)}% exceeds threshold ${(expectedMetrics.duplicateProcessingRate * 100)}%`);
        }

        // Generate optimization recommendations
        const recommendations: string[] = [];
        const estimatedImprovements: Record<string, number> = {};

        if (this.raceConditions.length > 0) {
            recommendations.push('HIGH PRIORITY: Implement proper synchronization for shared resources');
            estimatedImprovements['race_condition_elimination'] = 90;
        }

        if (avgLockWaitTime > 50) {
            recommendations.push('MEDIUM PRIORITY: Optimize lock granularity and duration');
            estimatedImprovements['lock_optimization'] = 60;
        }

        if (maxObservedConcurrency > 15) {
            recommendations.push('MEDIUM PRIORITY: Implement backpressure mechanisms');
            estimatedImprovements['concurrency_control'] = 40;
        }

        return {
            testDuration: Date.now() - this.startTime,
            scenarios: this.scenarios,
            overallStats: {
                totalConcurrentOperations: totalOperations,
                maxObservedConcurrency,
                avgConcurrency,
                totalRaceConditions: this.raceConditions.length,
                totalLockContentions: this.lockContentions.length,
                avgLockWaitTime,
                duplicateProcessingRate,
                dataCorruptionCount: this.raceConditions.filter(rc => rc.type === 'data_race').length
            },
            raceConditionAnalysis: this.analyzeRaceConditions(),
            lockContentionAnalysis: this.analyzeLockContentions(),
            resourceContentionAnalysis: {
                memoryContention: this.calculateResourceContentionScore() * 0.3,
                cpuContention: this.calculateResourceContentionScore() * 0.25,
                ioContention: this.calculateResourceContentionScore() * 0.25,
                networkContention: this.calculateResourceContentionScore() * 0.2
            },
            synchronizationAnalysis: {
                atomicOperationEfficiency: Math.max(0, 100 - this.raceConditions.length * 10),
                mutexEffectiveness: Math.max(0, 100 - this.lockContentions.length),
                barrierSynchronization: 90, // Simulated
                overallSyncHealth: Math.max(0, 100 - (this.raceConditions.length * 5) - (this.lockContentions.length * 2))
            },
            dataConsistency: {
                transactionConsistency: Math.max(0, 100 - this.raceConditions.filter(rc => rc.type === 'data_race').length * 20),
                referentialIntegrity: 95, // Simulated
                messageConsistency: Math.max(0, 100 - duplicateProcessingRate * 100),
                stateConsistency: Math.max(0, 100 - this.raceConditions.filter(rc => rc.type === 'state_race').length * 15)
            },
            optimization: {
                recommendations,
                estimatedImprovements,
                priority: recommendations.filter(r => r.includes('HIGH PRIORITY')).map(r => r.replace('HIGH PRIORITY: ', ''))
            },
            testPassed: failureReasons.length === 0,
            failureReasons
        };
    }

    private async cleanup(): Promise<void> {
        logger.info('Cleaning up concurrent app processing test...');

        if (this.metricsCollector) {
            clearInterval(this.metricsCollector as any);
        }

        if (this.raceConditionDetector) {
            clearInterval(this.raceConditionDetector as any);
        }

        if (this.lockMonitor) {
            clearInterval(this.lockMonitor as any);
        }

        if (this.bridge) {
            this.bridge = null;
        }

        // Clear data structures
        this.activeOperations.clear();
        this.completedOperations = [];
        this.raceConditions = [];
        this.lockContentions = [];
        this.concurrencyMetrics = [];
        this.resourceLocks.clear();
        this.operationDependencies.clear();
        this.resourceAccess.clear();
        this.appStates.clear();
        this.dataSnapshots.clear();
        this.processingQueues.clear();

        logger.info('Cleanup completed');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export for use in performance runner
export default ConcurrentAppProcessingTest;