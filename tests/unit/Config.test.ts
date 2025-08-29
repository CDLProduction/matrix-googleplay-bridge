import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../../src/utils/Config';

const testConfigDir = path.join(__dirname, '../fixtures/config');
const testConfigPath = path.join(testConfigDir, 'test-config.yaml');
const testServiceAccountPath = path.join(testConfigDir, 'test-service-account.json');

// Create test config directory and files before tests
beforeAll(() => {
  if (!fs.existsSync(testConfigDir)) {
    fs.mkdirSync(testConfigDir, { recursive: true });
  }

  // Create a minimal service account JSON file for testing
  fs.writeFileSync(testServiceAccountPath, JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    client_email: 'test@test-project.iam.gserviceaccount.com'
  }));

  // Create a test configuration file
  const testConfig = `
homeserver:
  url: "https://matrix.example.com"
  domain: "example.com"

appservice:
  port: 9000
  bind: "127.0.0.1"
  token: "test_token"
  id: "test_bridge"
  botUsername: "testbot"

googleplay:
  auth:
    keyFile: "${testServiceAccountPath}"
  pollIntervalMs: 300000
  applications:
    - packageName: "com.example.test"
      matrixRoom: "!test:example.com"
      appName: "Test App"

database:
  type: "sqlite"
  path: "./test.db"

logging:
  level: "info"
  console: true
`;

  fs.writeFileSync(testConfigPath, testConfig);
});

// Clean up after tests
afterAll(() => {
  if (fs.existsSync(testServiceAccountPath)) {
    fs.unlinkSync(testServiceAccountPath);
  }
  if (fs.existsSync(testConfigPath)) {
    fs.unlinkSync(testConfigPath);
  }
  if (fs.existsSync(testConfigDir)) {
    fs.rmdirSync(testConfigDir);
  }
});

describe('Config', () => {
  let config: Config;

  beforeEach(async () => {
    // Reset the singleton instance
    (Config as any).instance = undefined;
    config = await Config.load(testConfigPath);
  });

  it('should load configuration from YAML file', () => {
    expect(config.homeserver.url).toBe('https://matrix.example.com');
    expect(config.homeserver.domain).toBe('example.com');
    expect(config.appservice.port).toBe(9000);
    expect(config.appservice.token).toBe('test_token');
    expect(config.googleplay.applications).toHaveLength(1);
    expect(config.database.type).toBe('sqlite');
    expect(config.logging?.level).toBe('info');
  });

  it('should return singleton instance', () => {
    const instance1 = Config.getInstance();
    const instance2 = Config.getInstance();
    expect(instance1).toBe(instance2);
    expect(instance1).toBe(config);
  });

  it('should throw error when configuration file does not exist', async () => {
    (Config as any).instance = undefined;
    await expect(Config.load('./nonexistent.yaml')).rejects.toThrow('Configuration file not found');
  });

  it('should throw error when getting instance before loading', () => {
    (Config as any).instance = undefined;
    expect(() => Config.getInstance()).toThrow('Configuration not loaded');
  });

  it('should validate required fields', async () => {
    (Config as any).instance = undefined;
    
    const invalidConfig = `
homeserver:
  url: "https://matrix.example.com"
  # Missing domain
appservice:
  port: 9000
  bind: "127.0.0.1"
  token: "test_token"
  id: "test_bridge"
  botUsername: "testbot"
googleplay:
  auth:
    keyFile: "${testServiceAccountPath}"
  pollIntervalMs: 300000
  applications: []
database:
  type: "sqlite"
  path: "./test.db"
logging:
  level: "info"
  console: true
`;

    const invalidConfigPath = path.join(testConfigDir, 'invalid-config.yaml');
    fs.writeFileSync(invalidConfigPath, invalidConfig);

    await expect(Config.load(invalidConfigPath)).rejects.toThrow('Missing required field: homeserver.domain');

    fs.unlinkSync(invalidConfigPath);
  });

  it('should apply environment variable overrides', async () => {
    (Config as any).instance = undefined;
    
    // Set environment variables
    process.env.HOMESERVER_URL = 'https://override.example.com';
    process.env.AS_PORT = '9001';
    process.env.LOG_LEVEL = 'debug';

    const configWithEnv = await Config.load(testConfigPath);

    expect(configWithEnv.homeserver.url).toBe('https://override.example.com');
    expect(configWithEnv.appservice.port).toBe(9001);
    expect(configWithEnv.logging?.level).toBe('debug');

    // Clean up environment variables
    delete process.env.HOMESERVER_URL;
    delete process.env.AS_PORT;
    delete process.env.LOG_LEVEL;
  });

  it('should validate database configuration based on type', async () => {
    (Config as any).instance = undefined;

    const postgresConfig = `
homeserver:
  url: "https://matrix.example.com"
  domain: "example.com"
appservice:
  port: 9000
  bind: "127.0.0.1"
  token: "test_token"
  id: "test_bridge"
  botUsername: "testbot"
googleplay:
  auth:
    keyFile: "${testServiceAccountPath}"
  pollIntervalMs: 300000
  applications:
    - packageName: "com.example.test"
      matrixRoom: "!test:example.com"
database:
  type: "postgresql"
  # Missing required PostgreSQL fields
logging:
  level: "info"
  console: true
`;

    const postgresConfigPath = path.join(testConfigDir, 'postgres-config.yaml');
    fs.writeFileSync(postgresConfigPath, postgresConfig);

    await expect(Config.load(postgresConfigPath)).rejects.toThrow('Missing required field: database.host');

    fs.unlinkSync(postgresConfigPath);
  });
});