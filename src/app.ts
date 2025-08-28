/**
 * Matrix Google Play Bridge - Application Entry Point
 * 
 * A Matrix Application Service that bridges Google Play Console reviews
 * and comments with Matrix chat rooms for customer support teams.
 */

import { GooglePlayBridge } from './bridge/GooglePlayBridge';
import { Config } from './utils/Config';
import { Logger, LogLevel } from './utils/Logger';

async function main(): Promise<void> {
  let logger = Logger.getInstance();
  
  try {
    logger.info('Starting Matrix Google Play Bridge...');

    // Load configuration
    const config = await Config.load();
    
    // Configure logger with config settings
    logger.configure({
      level: getLogLevelFromConfig(config),
      enableFile: config.logging?.enableFile || false,
      ...(config.logging?.filePath && { filePath: config.logging.filePath }),
      enableStructured: config.logging?.enableStructured !== false,
      enableColors: process.env.NODE_ENV !== 'production',
    });
    
    logger = logger.setComponent('Main');
    logger.info('Configuration loaded', {
      version: config.version,
      logging: config.logging,
      monitoring: config.monitoring,
    });
    
    // Initialize the bridge
    const bridge = new GooglePlayBridge(config);
    
    // Start the bridge
    await bridge.start();
    
    logger.info('Matrix Google Play Bridge started successfully', {
      healthEndpoint: config.monitoring?.enabled !== false ? 
        `http://${config.monitoring?.host || '0.0.0.0'}:${config.monitoring?.port || 9090}/health` : 
        'disabled',
      version: config.version,
    });
  } catch (error) {
    logger.error('Failed to start bridge', error);
    process.exit(1);
  }
}

function getLogLevelFromConfig(config: any): LogLevel {
  const level = config.logging?.level?.toLowerCase();
  
  switch (level) {
    case 'error': return LogLevel.ERROR;
    case 'warn': case 'warning': return LogLevel.WARN;
    case 'info': return LogLevel.INFO;
    case 'http': return LogLevel.HTTP;
    case 'debug': return LogLevel.DEBUG;
    default:
      return process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG;
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  const logger = Logger.getInstance();
  logger.info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  const logger = Logger.getInstance();
  logger.info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Start the application
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main };