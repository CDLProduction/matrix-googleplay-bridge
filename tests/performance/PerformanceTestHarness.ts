import { MockReviewGenerator, LoadTestScenario, PerformanceMetrics } from './MockReviewGenerator';
import { GooglePlayBridge } from '../../src/bridge/GooglePlayBridge';
import { Config } from '../../src/utils/Config';
import { Logger } from '../../src/utils/Logger';
import * as fs from 'fs';
import * as path from 'path';

export interface PerformanceTestResults {
  scenario: LoadTestScenario;
  startTime: Date;
  endTime: Date;
  duration: number;
  metrics: PerformanceMetrics[];
  summary: PerformanceSummary;
  success: boolean;
  errors: string[];
}

export interface PerformanceSummary {
  avgMemoryUsage: number;
  maxMemoryUsage: number;
  avgCpuUsage: number;
  maxCpuUsage: number;
  totalReviewsProcessed: number;
  avgThroughput: number;
  maxThroughput: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  errorRate: number;
  stabilityScore: number; // 0-100 based on memory stability and error rate
}

/**
 * Performance test harness for the Matrix Google Play Bridge
 */
export class PerformanceTestHarness {
  private logger: Logger;
  private mockGenerator: MockReviewGenerator;
  private testResults: PerformanceTestResults[] = [];
  private isRunning = false;
  private currentMetrics: PerformanceMetrics[] = [];
  
  constructor() {
    this.logger = Logger.getInstance();
    this.logger.setComponent('PerformanceTest');
    this.mockGenerator = new MockReviewGenerator();
  }

  /**
   * Execute a performance test scenario
   */
  async runLoadTest(scenario: LoadTestScenario): Promise<PerformanceTestResults> {
    if (this.isRunning) {
      throw new Error('Performance test already running');
    }

    this.logger.info(`Starting performance test: ${scenario.name}`);
    this.isRunning = true;
    this.currentMetrics = [];
    
    const startTime = new Date();
    const errors: string[] = [];
    let success = true;

    try {
      // Setup test configuration
      const testConfig = await this.createTestConfig(scenario);
      
      // Create bridge instance
      const bridge = new GooglePlayBridge(testConfig);
      
      // Setup monitoring
      const metricsCollector = this.startMetricsCollection();
      
      // Initialize mock data
      await this.setupMockData(scenario);
      
      // Start the bridge
      await bridge.start();
      
      // Run test for specified duration
      await this.runTestDuration(scenario.durationMs);
      
      // Stop monitoring
      clearInterval(metricsCollector);
      
      // Stop bridge
      await bridge.stop();
      
    } catch (error) {
      success = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);
      this.logger.error('Performance test failed:', error);
    } finally {
      this.isRunning = false;
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();
    
    const results: PerformanceTestResults = {
      scenario,
      startTime,
      endTime,
      duration,
      metrics: this.currentMetrics,
      summary: this.calculateSummary(this.currentMetrics),
      success,
      errors,
    };

    this.testResults.push(results);
    await this.saveTestResults(results);
    
    this.logger.info(`Performance test completed: ${scenario.name}`, {
      duration: `${duration}ms`,
      success,
      errorCount: errors.length,
    });

    return results;
  }

  /**
   * Run multiple test scenarios in sequence
   */
  async runTestSuite(scenarios: LoadTestScenario[]): Promise<PerformanceTestResults[]> {
    const results: PerformanceTestResults[] = [];
    
    for (const scenario of scenarios) {
      this.logger.info(`Running test suite scenario: ${scenario.name}`);
      
      try {
        const result = await this.runLoadTest(scenario);
        results.push(result);
        
        // Wait between tests to allow system recovery
        await this.sleep(30000); // 30 second break
        
      } catch (error) {
        this.logger.error(`Test suite scenario failed: ${scenario.name}`, error);
      }
    }
    
    await this.generateTestSuiteReport(results);
    return results;
  }

  /**
   * Measure current system performance metrics
   */
  collectCurrentMetrics(): PerformanceMetrics {
    const cpuUsage = process.cpuUsage();
    const memoryUsage = process.memoryUsage();
    
    return {
      timestamp: Date.now(),
      memory: memoryUsage,
      cpu: cpuUsage,
      throughput: {
        reviewsProcessed: 0, // Will be updated by actual processing
        messagesPerMinute: 0,
        databaseOpsPerSecond: 0,
      },
      latency: {
        reviewToMatrix: [],
        databaseQuery: [],
        apiCall: [],
      },
      errors: {
        apiFailures: 0,
        databaseErrors: 0,
        processingErrors: 0,
      },
    };
  }

  /**
   * Generate comprehensive performance report
   */
  async generatePerformanceReport(): Promise<string> {
    if (this.testResults.length === 0) {
      return 'No performance test results available';
    }

    const report = [
      '# Performance Test Report',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Test Summary',
    ];

    for (const result of this.testResults) {
      report.push(`### ${result.scenario.name}`);
      report.push(`- **Status**: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
      report.push(`- **Duration**: ${Math.round(result.duration / 1000)}s`);
      report.push(`- **Max Memory**: ${Math.round(result.summary.maxMemoryUsage / 1024 / 1024)}MB`);
      report.push(`- **Avg CPU**: ${result.summary.avgCpuUsage.toFixed(2)}%`);
      report.push(`- **Throughput**: ${result.summary.avgThroughput.toFixed(2)} reviews/min`);
      report.push(`- **P95 Latency**: ${result.summary.p95Latency.toFixed(2)}ms`);
      report.push(`- **Error Rate**: ${(result.summary.errorRate * 100).toFixed(2)}%`);
      report.push(`- **Stability**: ${result.summary.stabilityScore}/100`);
      report.push('');
    }

    const reportContent = report.join('\n');
    const reportPath = path.join(__dirname, '../../logs/performance-report.md');
    
    // Ensure logs directory exists
    const logsDir = path.dirname(reportPath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, reportContent);
    this.logger.info(`Performance report saved: ${reportPath}`);
    
    return reportContent;
  }

  private async createTestConfig(scenario: LoadTestScenario): Promise<Config> {
    // Create performance test configuration
    const testApps = this.mockGenerator.generateTestApps(scenario.appCount);
    
    const configData = {
      version: '0.1.0-perf',
      homeserver: {
        url: 'http://localhost:8008',
        domain: 'localhost',
      },
      appservice: {
        port: 8080,
        bind: '127.0.0.1',
        token: 'perf-test-token',
        id: 'googleplay-bridge-perf',
        botUsername: 'googleplay-bot',
      },
      googleplay: {
        auth: {
          clientEmail: 'perf-test@test.iam.gserviceaccount.com',
          privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDU5Z8P2JrtFPRN\n-----END PRIVATE KEY-----\n',
          projectId: 'perf-test-project',
        },
        applications: testApps,
        pollIntervalMs: scenario.pollIntervalMs,
        maxReviewsPerPoll: scenario.reviewsPerPoll,
      },
      database: {
        type: 'sqlite',
        path: ':memory:', // Use in-memory database for performance tests
      },
      logging: {
        level: 'error', // Minimize logging overhead
        enableFile: false,
        enableStructured: false,
      },
      monitoring: {
        enabled: false, // Disable HTTP monitoring during tests
      },
    };

    // Create temporary config file
    const configPath = path.join(__dirname, 'temp-perf-config.yaml');
    const yaml = require('js-yaml');
    fs.writeFileSync(configPath, yaml.dump(configData));
    
    return await Config.load(configPath);
  }

  private startMetricsCollection(): NodeJS.Timeout {
    return setInterval(() => {
      const metrics = this.collectCurrentMetrics();
      this.currentMetrics.push(metrics);
    }, 5000); // Collect metrics every 5 seconds
  }

  private async setupMockData(scenario: LoadTestScenario): Promise<void> {
    // Generate initial review data for testing
    const testApps = this.mockGenerator.generateTestApps(scenario.appCount);
    
    for (const app of testApps) {
      const reviews = this.mockGenerator.generateReviews(scenario.reviewsPerPoll, app.packageName);
      this.logger.debug(`Generated ${reviews.length} reviews for ${app.packageName}`);
    }
  }

  private async runTestDuration(durationMs: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, durationMs);
    });
  }

  public calculateSummary(metrics: PerformanceMetrics[]): PerformanceSummary {
    if (metrics.length === 0) {
      return {
        avgMemoryUsage: 0,
        maxMemoryUsage: 0,
        avgCpuUsage: 0,
        maxCpuUsage: 0,
        totalReviewsProcessed: 0,
        avgThroughput: 0,
        maxThroughput: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        errorRate: 0,
        stabilityScore: 0,
      };
    }

    const memoryUsages = metrics.map(m => m.memory.rss);
    const cpuUsages = metrics.map(m => (m.cpu.user + m.cpu.system) / 1000000); // Convert to seconds
    const allLatencies = metrics.flatMap(m => m.latency.reviewToMatrix);
    
    return {
      avgMemoryUsage: memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length,
      maxMemoryUsage: Math.max(...memoryUsages),
      avgCpuUsage: cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length,
      maxCpuUsage: Math.max(...cpuUsages),
      totalReviewsProcessed: metrics.reduce((sum, m) => sum + m.throughput.reviewsProcessed, 0),
      avgThroughput: metrics.reduce((sum, m) => sum + m.throughput.reviewsProcessed, 0) / metrics.length,
      maxThroughput: Math.max(...metrics.map(m => m.throughput.reviewsProcessed)),
      p50Latency: this.calculatePercentile(allLatencies, 0.5),
      p95Latency: this.calculatePercentile(allLatencies, 0.95),
      p99Latency: this.calculatePercentile(allLatencies, 0.99),
      errorRate: this.calculateErrorRate(metrics),
      stabilityScore: this.calculateStabilityScore(metrics),
    };
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    const sorted = values.sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)] || 0;
  }

  private calculateErrorRate(metrics: PerformanceMetrics[]): number {
    const totalOperations = metrics.reduce((sum, m) => 
      sum + m.throughput.reviewsProcessed + m.throughput.databaseOpsPerSecond, 0
    );
    const totalErrors = metrics.reduce((sum, m) => 
      sum + m.errors.apiFailures + m.errors.databaseErrors + m.errors.processingErrors, 0
    );
    
    return totalOperations > 0 ? totalErrors / totalOperations : 0;
  }

  private calculateStabilityScore(metrics: PerformanceMetrics[]): number {
    if (metrics.length < 2) return 100;
    
    // Calculate memory stability (less variation = higher score)
    const memoryUsages = metrics.map(m => m.memory.rss);
    const memoryMean = memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length;
    const memoryStdDev = Math.sqrt(
      memoryUsages.reduce((sum, usage) => sum + Math.pow(usage - memoryMean, 2), 0) / memoryUsages.length
    );
    const memoryStability = Math.max(0, 100 - (memoryStdDev / memoryMean) * 100);
    
    // Calculate error stability (fewer errors = higher score)
    const errorRate = this.calculateErrorRate(metrics);
    const errorStability = Math.max(0, 100 - errorRate * 100);
    
    // Combined stability score
    return (memoryStability + errorStability) / 2;
  }

  private async saveTestResults(results: PerformanceTestResults): Promise<void> {
    const resultsDir = path.join(__dirname, '../../logs/performance');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    
    const filename = `${results.scenario.name}-${results.startTime.toISOString().split('T')[0]}.json`;
    const filepath = path.join(resultsDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
    this.logger.info(`Performance test results saved: ${filepath}`);
  }

  private async generateTestSuiteReport(results: PerformanceTestResults[]): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      totalTests: results.length,
      passedTests: results.filter(r => r.success).length,
      failedTests: results.filter(r => !r.success).length,
      results: results.map(r => ({
        scenario: r.scenario.name,
        success: r.success,
        duration: r.duration,
        summary: r.summary,
      })),
    };
    
    const reportPath = path.join(__dirname, '../../logs/performance-suite-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    this.logger.info('Performance test suite report generated', {
      reportPath,
      totalTests: report.totalTests,
      passedTests: report.passedTests,
      failedTests: report.failedTests,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}