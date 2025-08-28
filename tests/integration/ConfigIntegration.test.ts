/**
 * Integration test to verify the complete configuration system works end-to-end
 */

import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../../src/utils/Config';

const testDir = path.join(__dirname, '../fixtures/integration');
const testConfigPath = path.join(testDir, 'integration-config.yaml');
const testServiceAccountPath = path.join(testDir, 'service-account.json');

describe('Config Integration', () => {
  beforeAll(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create service account file
    const serviceAccount = {
      type: 'service_account',
      project_id: 'test-project',
      client_email: 'test@test-project.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
    };
    fs.writeFileSync(testServiceAccountPath, JSON.stringify(serviceAccount, null, 2));

    // Create comprehensive configuration file
    const configContent = `
# Complete configuration for integration testing
homeserver:
  url: "https://matrix.integration-test.com"
  domain: "integration-test.com"

appservice:
  port: 9001
  bind: "0.0.0.0"
  token: "integration_test_token_123456789"
  id: "googleplay_integration_bridge"
  botUsername: "integrationbot"

googleplay:
  auth:
    keyFile: "${testServiceAccountPath.replace(/\\/g, '/')}"
  pollIntervalMs: 600000
  applications:
    - packageName: "com.integration.test.app1"
      matrixRoom: "!room1:integration-test.com"
      appName: "Integration Test App 1"
    - packageName: "com.integration.test.app2"
      matrixRoom: "!room2:integration-test.com"
      appName: "Integration Test App 2"

database:
  type: "postgresql"
  host: "localhost"
  port: 5432
  username: "integration_user"
  password: "integration_password"
  database: "integration_bridge_db"
  ssl: true

logging:
  level: "debug"
  file: "/var/log/integration-bridge.log"
  console: false
`;

    fs.writeFileSync(testConfigPath, configContent);
  });

  afterAll(() => {
    // Clean up test files
    if (fs.existsSync(testServiceAccountPath)) {
      fs.unlinkSync(testServiceAccountPath);
    }
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir);
    }
  });

  it('should load and validate a complete configuration', async () => {
    // Reset singleton
    (Config as any).instance = undefined;

    const config = await Config.load(testConfigPath);

    // Verify homeserver config
    expect(config.homeserver.url).toBe('https://matrix.integration-test.com');
    expect(config.homeserver.domain).toBe('integration-test.com');

    // Verify appservice config
    expect(config.appservice.port).toBe(9001);
    expect(config.appservice.bind).toBe('0.0.0.0');
    expect(config.appservice.token).toBe('integration_test_token_123456789');
    expect(config.appservice.id).toBe('googleplay_integration_bridge');
    expect(config.appservice.botUsername).toBe('integrationbot');

    // Verify Google Play config
    expect(config.googleplay.auth.keyFile).toBe(testServiceAccountPath.replace(/\\/g, '/'));
    expect(config.googleplay.pollIntervalMs).toBe(600000);
    expect(config.googleplay.applications).toHaveLength(2);
    expect(config.googleplay.applications[0]?.packageName).toBe('com.integration.test.app1');
    expect(config.googleplay.applications[0]?.matrixRoom).toBe('!room1:integration-test.com');
    expect(config.googleplay.applications[1]?.appName).toBe('Integration Test App 2');

    // Verify database config
    expect(config.database.type).toBe('postgresql');
    expect(config.database.host).toBe('localhost');
    expect(config.database.port).toBe(5432);
    expect(config.database.username).toBe('integration_user');
    expect(config.database.password).toBe('integration_password');
    expect(config.database.database).toBe('integration_bridge_db');
    expect(config.database.ssl).toBe(true);

    // Verify logging config
    expect(config.logging.level).toBe('debug');
    expect(config.logging.file).toBe('/var/log/integration-bridge.log');
    expect(config.logging.console).toBe(false);
  });

  it('should apply environment variable overrides correctly', async () => {
    // Reset singleton
    (Config as any).instance = undefined;

    // Set environment variables
    const originalValues: Record<string, string | undefined> = {};
    const envOverrides = {
      HOMESERVER_URL: 'https://env.matrix.com',
      AS_PORT: '8888',
      BOT_USERNAME: 'envbot',
      GOOGLE_POLL_INTERVAL: '900000',
      DB_HOST: 'env-db-host',
      LOG_LEVEL: 'error',
      LOG_CONSOLE: 'true',
    };

    // Save original values and set test values
    Object.entries(envOverrides).forEach(([key, value]) => {
      originalValues[key] = process.env[key];
      process.env[key] = value;
    });

    try {
      const config = await Config.load(testConfigPath);

      // Verify environment overrides were applied
      expect(config.homeserver.url).toBe('https://env.matrix.com');
      expect(config.appservice.port).toBe(8888);
      expect(config.appservice.botUsername).toBe('envbot');
      expect(config.googleplay.pollIntervalMs).toBe(900000);
      expect(config.database.host).toBe('env-db-host');
      expect(config.logging.level).toBe('error');
      expect(config.logging.console).toBe(true);

      // Verify non-overridden values remain from config file
      expect(config.homeserver.domain).toBe('integration-test.com');
      expect(config.appservice.token).toBe('integration_test_token_123456789');
    } finally {
      // Restore original environment variables
      Object.entries(originalValues).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
    }
  });

  it('should provide singleton access after loading', () => {
    const instance1 = Config.getInstance();
    const instance2 = Config.getInstance();
    
    expect(instance1).toBe(instance2);
    expect(instance1.homeserver.domain).toBe('integration-test.com');
  });

  it('should validate PostgreSQL database configuration', async () => {
    const config = Config.getInstance();
    
    expect(config.database.type).toBe('postgresql');
    expect(config.database.host).toBeDefined();
    expect(config.database.port).toBeDefined();
    expect(config.database.username).toBeDefined();
    expect(config.database.password).toBeDefined();
    expect(config.database.database).toBeDefined();
  });
});