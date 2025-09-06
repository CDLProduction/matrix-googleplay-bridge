#!/usr/bin/env ts-node

/**
 * Performance Test Runner
 * 
 * Usage:
 *   npm run perf:test                    # Run all scenarios
 *   npm run perf:test baseline           # Run specific scenario
 *   npm run perf:test stress-test        # Run stress test
 *   npm run perf:report                  # Generate report only
 */

import { PerformanceTestHarness } from './PerformanceTestHarness';
import { LOAD_TEST_SCENARIOS, LoadTestScenario } from './MockReviewGenerator';
import { Logger } from '../../src/utils/Logger';
import { TypicalProductionTest } from './TypicalProductionTest';
import { HighLoadTest } from './HighLoadTest';
import { StressTest } from './StressTest';
import { DatabaseSQLiteTest } from './DatabaseSQLiteTest';
import { DatabasePostgreSQLTest } from './DatabasePostgreSQLTest';
import { MemoryLeakDetectionTest } from './MemoryLeakDetectionTest';
import { CPUUsagePatternsTest } from './CPUUsagePatternsTest';
import { NetworkIOPerformanceTest } from './NetworkIOPerformanceTest';
import { ConcurrentAppProcessingTest } from './ConcurrentAppProcessingTest';
import { MatrixEventProcessingTest } from './MatrixEventProcessingTest';

async function main() {
  const logger = Logger.getInstance();
  logger.setComponent('PerformanceRunner');
  
  const args = process.argv.slice(2);
  const command = args[0];
  const scenarioName = args[1];
  
  logger.info('Starting performance test runner', { command, scenarioName });
  
  const harness = new PerformanceTestHarness();
  
  try {
    switch (command) {
      case 'test':
        await runPerformanceTests(harness, scenarioName);
        break;
        
      case 'report':
        await generateReport(harness);
        break;
        
      case 'quick':
        await runQuickTest(harness);
        break;
        
      case 'endurance':
        await runEnduranceTest(harness);
        break;
        
      default:
        await runAllTests(harness);
        break;
    }
  } catch (error) {
    logger.error('Performance test runner failed:', error);
    process.exit(1);
  }
}

async function runPerformanceTests(harness: PerformanceTestHarness, scenarioName?: string): Promise<void> {
  const logger = Logger.getInstance();
  
  if (scenarioName) {
    // Special handling for specific test implementations
    if (scenarioName === 'typical-production') {
      logger.info('Running typical production test with specialized implementation');
      const typicalProductionTest = new TypicalProductionTest();
      const result = await typicalProductionTest.runTypicalProductionTest();
      
      if (result.success) {
        logger.info('✅ Typical production test completed successfully');
      } else {
        logger.error('❌ Typical production test failed', { errors: result.errors });
      }
      return;
    }
    
    if (scenarioName === 'high-load') {
      logger.info('Running high load test with specialized implementation');
      logger.warn('⚠️  High load test - monitor system resources carefully');
      const highLoadTest = new HighLoadTest();
      const result = await highLoadTest.runHighLoadTest();
      
      if (result.success) {
        logger.info('✅ High load test completed successfully');
      } else {
        logger.error('❌ High load test failed', { errors: result.errors });
      }
      return;
    }
    
    if (scenarioName === 'stress-test') {
      logger.info('Running stress test with specialized implementation');
      logger.warn('🔥 EXTREME STRESS TEST - This will push the system beyond capacity');
      logger.warn('⚠️  Monitor system resources and be prepared to stop if necessary');
      const stressTest = new StressTest();
      const result = await stressTest.runStressTest();
      
      if (result.success) {
        logger.info('✅ Stress test completed - check breaking point analysis');
      } else {
        logger.error('❌ Stress test failed', { errors: result.errors });
      }
      return;
    }
    
    if (scenarioName === 'database-sqlite') {
      logger.info('Running SQLite database performance test with specialized implementation');
      logger.warn('🗄️  Database Performance Test - High-frequency operations on SQLite');
      logger.info('Focus: WAL mode efficiency, query performance, file I/O optimization');
      const dbSQLiteTest = new DatabaseSQLiteTest();
      const result = await dbSQLiteTest.runDatabaseSQLiteTest();
      
      if (result.success) {
        logger.info('✅ SQLite database performance test completed successfully');
      } else {
        logger.error('❌ SQLite database performance test failed', { errors: result.errors });
      }
      return;
    }
    
    if (scenarioName === 'database-postgresql') {
      logger.info('Running PostgreSQL database performance test with specialized implementation');
      logger.warn('🐘 Database Performance Test - Production concurrent load on PostgreSQL');
      logger.info('Focus: Connection pool efficiency, complex queries, transaction optimization');
      const dbPostgreSQLTest = new DatabasePostgreSQLTest();
      const result = await dbPostgreSQLTest.runDatabasePostgreSQLTest();
      
      if (result.success) {
        logger.info('✅ PostgreSQL database performance test completed successfully');
      } else {
        logger.error('❌ PostgreSQL database performance test failed', { errors: result.errors });
      }
      return;
    }
    
    if (scenarioName === 'memory-leak-detection') {
      logger.info('Running Memory Leak Detection test with specialized implementation');
      logger.warn('🧠 LONG-TERM ENDURANCE TEST - 24-hour continuous operation');
      logger.warn('⚠️  This test will run for 24 hours - ensure system stability');
      logger.info('Focus: Memory growth patterns, GC efficiency, heap snapshot analysis');
      const memoryLeakTest = new MemoryLeakDetectionTest();
      const result = await memoryLeakTest.runMemoryLeakDetectionTest();
      
      if (result.success) {
        logger.info('✅ Memory leak detection test completed successfully');
        logger.info(`📊 Final stability rating: ${result.stabilityRating}`);
      } else {
        logger.error('❌ Memory leak detection test failed', { errors: result.errors });
      }
      return;
    }
    
    if (scenarioName === 'cpu-patterns') {
      logger.info('Running CPU Usage Patterns test with specialized implementation');
      logger.warn('🖥️  CPU PROFILING TEST - 2-hour workload pattern analysis');
      logger.info('Focus: CPU usage patterns, event loop lag, function profiling, bottleneck detection');
      const cpuPatternsTest = new CPUUsagePatternsTest();
      const result = await cpuPatternsTest.runCPUPatternsTest();
      
      if (result.testPassed) {
        logger.info('✅ CPU patterns test completed successfully');
        logger.info(`📊 Average CPU: ${result.overallMetrics.avgCpuUsage.toFixed(2)}%`);
        logger.info(`📈 Peak CPU: ${result.overallMetrics.maxCpuUsage.toFixed(2)}%`);
        logger.info(`⚡ CPU Efficiency: ${result.overallMetrics.cpuEfficiency.toFixed(2)}%`);
      } else {
        logger.error('❌ CPU patterns test failed', { reasons: result.failureReasons });
      }
      return;
    }
    
    if (scenarioName === 'network-io') {
      logger.info('Running Network I/O Performance test with specialized implementation');
      logger.warn('🌐 NETWORK I/O TEST - 1-hour network conditions analysis');
      logger.info('Focus: Latency, throughput, connection pooling, protocol optimization');
      const networkIOTest = new NetworkIOPerformanceTest();
      const result = await networkIOTest.runNetworkIOTest();
      
      if (result.testPassed) {
        logger.info('✅ Network I/O test completed successfully');
        logger.info(`📊 Average Latency: ${result.overallStats.avgLatency.toFixed(2)}ms`);
        logger.info(`📈 Average Throughput: ${result.overallStats.avgThroughput.toFixed(2)} Mbps`);
        logger.info(`🔗 Connection Reuse: ${(result.overallStats.connectionReuseRate * 100).toFixed(2)}%`);
      } else {
        logger.error('❌ Network I/O test failed', { reasons: result.failureReasons });
      }
      return;
    }
    
    if (scenarioName === 'concurrent-apps') {
      logger.info('Running Concurrent App Processing test with specialized implementation');
      logger.warn('🔄 CONCURRENCY TEST - 90-minute concurrent app processing analysis');
      logger.info('Focus: Race conditions, lock contention, resource conflicts, synchronization');
      const concurrentAppTest = new ConcurrentAppProcessingTest();
      const result = await concurrentAppTest.runConcurrentAppTest();
      
      if (result.testPassed) {
        logger.info('✅ Concurrent app processing test completed successfully');
        logger.info(`📊 Max Concurrency: ${result.overallStats.maxObservedConcurrency}`);
        logger.info(`⚡ Average Concurrency: ${result.overallStats.avgConcurrency.toFixed(2)}`);
        logger.info(`🔒 Race Conditions: ${result.overallStats.totalRaceConditions}`);
        logger.info(`⏱️  Lock Contentions: ${result.overallStats.totalLockContentions}`);
      } else {
        logger.error('❌ Concurrent app processing test failed', { reasons: result.failureReasons });
      }
      return;
    }
    
    if (scenarioName === 'matrix-events') {
      logger.info('Running Matrix Event Processing test with specialized implementation');
      logger.warn('🎭 MATRIX EVENT TEST - 2-hour high-frequency Matrix events analysis');
      logger.info('Focus: Event queue processing, virtual user management, processing latency, throughput');
      const matrixEventTest = new MatrixEventProcessingTest();
      const result = await matrixEventTest.runMatrixEventTest();
      
      if (result.testPassed) {
        logger.info('✅ Matrix event processing test completed successfully');
        logger.info(`📊 Events Processed: ${result.overallStats.totalEventsProcessed}`);
        logger.info(`⚡ Average Throughput: ${result.overallStats.avgEventsPerSecond.toFixed(2)} events/s`);
        logger.info(`📈 Peak Throughput: ${result.overallStats.peakEventsPerSecond.toFixed(2)} events/s`);
        logger.info(`👥 Virtual Users: ${result.overallStats.totalVirtualUsers}`);
        logger.info(`⏱️  Avg Latency: ${result.overallStats.avgProcessingLatency.toFixed(2)}ms`);
        logger.info(`🔄 Queue Efficiency: ${result.queueAnalysis.queueEfficiency.toFixed(2)}%`);
        logger.info(`💾 Cache Hit Ratio: ${(result.virtualUserAnalysis.cacheHitRatio * 100).toFixed(2)}%`);
      } else {
        logger.error('❌ Matrix event processing test failed', { reasons: result.failureReasons });
      }
      return;
    }
    
    // Run generic scenario
    const scenario = LOAD_TEST_SCENARIOS.find(s => s.name === scenarioName);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioName}`);
    }
    
    logger.info(`Running single performance test: ${scenario.name}`);
    const result = await harness.runLoadTest(scenario);
    
    if (result.success) {
      logger.info('✅ Performance test completed successfully');
    } else {
      logger.error('❌ Performance test failed', { errors: result.errors });
    }
  } else {
    // Run all scenarios
    await runAllTests(harness);
  }
  
  await harness.generatePerformanceReport();
}

async function runAllTests(harness: PerformanceTestHarness): Promise<void> {
  const logger = Logger.getInstance();
  
  logger.info('Running complete performance test suite');
  
  // Run tests in order of increasing load
  const orderedScenarios = [
    'baseline',
    'typical-production', 
    'high-load',
    'stress-test'
  ];
  
  const scenarios = orderedScenarios
    .map(name => LOAD_TEST_SCENARIOS.find(s => s.name === name))
    .filter((scenario): scenario is LoadTestScenario => scenario !== undefined);
  
  const results = await harness.runTestSuite(scenarios);
  
  // Report summary
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  logger.info('Performance test suite completed', {
    totalTests: results.length,
    passed,
    failed,
    successRate: `${Math.round(passed / results.length * 100)}%`
  });
  
  if (failed > 0) {
    logger.warn('Some performance tests failed - check logs for details');
  }
}

async function runQuickTest(harness: PerformanceTestHarness): Promise<void> {
  const logger = Logger.getInstance();
  
  logger.info('Running quick performance validation');
  
  // Create a shorter version of baseline test
  const quickScenario: LoadTestScenario = {
    name: 'quick-validation',
    description: 'Quick performance validation test',
    appCount: 1,
    reviewsPerPoll: 5,
    pollIntervalMs: 60000, // 1 minute
    durationMs: 5 * 60 * 1000, // 5 minutes
    concurrency: 1,
  };
  
  const result = await harness.runLoadTest(quickScenario);
  
  if (result.success) {
    logger.info('✅ Quick performance test passed');
    logger.info('Performance summary:', {
      maxMemoryMB: Math.round(result.summary.maxMemoryUsage / 1024 / 1024),
      avgThroughput: result.summary.avgThroughput.toFixed(2),
      p95LatencyMs: result.summary.p95Latency.toFixed(2),
      stabilityScore: result.summary.stabilityScore
    });
  } else {
    logger.error('❌ Quick performance test failed', { errors: result.errors });
  }
  
  await harness.generatePerformanceReport();
}

async function runEnduranceTest(harness: PerformanceTestHarness): Promise<void> {
  const logger = Logger.getInstance();
  
  logger.info('Running 24-hour endurance test');
  logger.warn('This test will run for 24 hours - make sure system is ready');
  
  const enduranceScenario = LOAD_TEST_SCENARIOS.find(s => s.name === 'endurance');
  if (!enduranceScenario) {
    throw new Error('Endurance scenario not found');
  }
  
  const result = await harness.runLoadTest(enduranceScenario);
  
  if (result.success) {
    logger.info('✅ 24-hour endurance test completed successfully');
    logger.info('Stability metrics:', {
      stabilityScore: result.summary.stabilityScore,
      memoryLeakDetected: result.summary.maxMemoryUsage > result.summary.avgMemoryUsage * 2,
      avgMemoryMB: Math.round(result.summary.avgMemoryUsage / 1024 / 1024),
      maxMemoryMB: Math.round(result.summary.maxMemoryUsage / 1024 / 1024),
    });
  } else {
    logger.error('❌ Endurance test failed', { errors: result.errors });
  }
  
  await harness.generatePerformanceReport();
}

async function generateReport(harness: PerformanceTestHarness): Promise<void> {
  const logger = Logger.getInstance();
  
  logger.info('Generating performance test report');
  const report = await harness.generatePerformanceReport();
  
  console.log('\n' + '='.repeat(80));
  console.log('PERFORMANCE TEST REPORT');
  console.log('='.repeat(80));
  console.log(report);
  console.log('='.repeat(80));
}

function printUsage(): void {
  console.log(`
Performance Test Runner Usage:

  npm run perf:test                    # Run all performance test scenarios
  npm run perf:baseline                # Run baseline performance test (1.1)
  npm run perf:medium                  # Run typical production load test (1.2)
  npm run perf:high                    # Run high load peak usage test (1.3)
  npm run perf:test stress-test        # Run stress test (1.4)
  npm run perf:quick                   # Run quick validation test (5 min)
  npm run perf:endurance               # Run 24-hour endurance test
  npm run perf:report                  # Generate performance report only

Available Scenarios:
${LOAD_TEST_SCENARIOS.map(s => `  - ${s.name}: ${s.description}`).join('\n')}

Examples:
  npm run perf:test quick              # Quick 5-minute validation
  npm run perf:test stress-test        # Find performance limits
  npm run perf:test endurance          # 24-hour stability test
`);
}

// Handle command line execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }
  
  main().catch(error => {
    console.error('Performance test runner failed:', error);
    process.exit(1);
  });
}