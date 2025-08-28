/**
 * Matrix Google Play Bridge - Application Entry Point
 * 
 * A Matrix Application Service that bridges Google Play Console reviews
 * and comments with Matrix chat rooms for customer support teams.
 */

import { GooglePlayBridge } from './bridge/GooglePlayBridge';
import { Config } from './utils/Config';
import { Logger } from './utils/Logger';

async function main(): Promise<void> {
  try {
    const logger = Logger.getInstance();
    logger.info('Starting Matrix Google Play Bridge...');

    // Load configuration
    const config = await Config.load();
    
    // Initialize the bridge
    const bridge = new GooglePlayBridge(config);
    
    // Start the bridge
    await bridge.start();
    
    logger.info('Matrix Google Play Bridge started successfully');
  } catch (error) {
    const logger = Logger.getInstance();
    logger.error('Failed to start bridge:', error);
    process.exit(1);
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