# Configuration Guide

This comprehensive guide covers all configuration options for the Matrix Google Play Bridge, including basic setup, advanced features, security settings, and production optimizations.

## Table of Contents

- [Configuration Overview](#configuration-overview)
- [Basic Configuration](#basic-configuration)
- [Advanced Configuration](#advanced-configuration)
- [Security Configuration](#security-configuration)
- [Production Configuration](#production-configuration)
- [Environment Variables](#environment-variables)
- [Configuration Validation](#configuration-validation)
- [Hot Configuration Reload](#hot-configuration-reload)
- [Troubleshooting](#troubleshooting)

## Configuration Overview

The Matrix Google Play Bridge uses two main configuration files:

1. **`config/config.yaml`** - Main bridge configuration with all operational settings
2. **`config/registration.yaml`** - Matrix Application Service registration file

### Configuration File Locations

- **Development**: `./config/config.yaml`
- **Production**: `/opt/matrix-googleplay-bridge/config/config.yaml`
- **Docker**: `/app/config/config.yaml` (mounted volume)
- **Custom Path**: Set via `CONFIG_PATH` environment variable

## Basic Configuration

### Step 1: Copy Configuration Templates

```bash
# Copy templates to create your configuration files
cp config/config.yaml.example config/config.yaml
cp config/registration.yaml.example config/registration.yaml
```

### Step 2: Generate Secure Tokens

Generate cryptographically secure tokens for bridge authentication:

```bash
# Method 1: Using OpenSSL (Linux/macOS)
openssl rand -hex 32

# Method 2: Using Node.js crypto
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Method 3: Using Python
python3 -c "import secrets; print(secrets.token_hex(32))"

# Method 4: Using PowerShell (Windows)
[System.Convert]::ToBase64String((1..32 | ForEach {Get-Random -Minimum 0 -Maximum 256}))
```

You need **two different tokens**:
- **Application Service Token**: For bridge ↔ homeserver authentication
- **Homeserver Token**: For homeserver ↔ bridge authentication

### Step 3: Basic config.yaml Configuration

```yaml
# Matrix Homeserver Configuration
homeserver:
  url: 'https://matrix.your-domain.com'  # Your Matrix homeserver URL
  domain: 'your-domain.com'              # Your Matrix domain

# Application Service Configuration
appservice:
  port: 8080                             # Port for bridge to listen on
  bind: '0.0.0.0'                       # Interface to bind to (0.0.0.0 for all interfaces)
  token: 'your-as-token-here'           # Application service token (generated above)
  id: 'googleplay-bridge'               # Unique bridge identifier
  botUsername: 'googleplay'             # Bot username (will be @googleplay:your-domain.com)

# Google Play API Configuration
googleplay:
  auth:
    keyFile: '/path/to/service-account-key.json'  # Path to Google Play service account key
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  
  # Global polling settings (can be overridden per-app)
  pollIntervalMs: 300000                 # 5 minutes between polls
  maxReviewsPerPoll: 100                # Maximum reviews to fetch per poll
  
  # Applications to monitor
  applications:
    - packageName: 'com.yourcompany.app' # Your app's package name
      matrixRoom: '!reviews:your-domain.com'  # Matrix room for reviews
      appName: 'Your App Name'           # Human-readable app name

# Database Configuration
database:
  type: 'sqlite'                         # 'sqlite' or 'postgresql'
  path: './data/bridge.db'              # SQLite database path

# Logging Configuration
logging:
  level: 'info'                          # 'error', 'warn', 'info', 'debug'
  enableFile: true                       # Enable file logging
  filePath: './logs/bridge.log'         # Log file path

# Version (automatically set)
version: '0.1.0'
```

### Step 4: Basic registration.yaml Configuration

```yaml
id: googleplay-bridge                    # Must match config.yaml appservice.id
url: 'http://localhost:8080'            # Bridge URL (accessible from homeserver)
as_token: 'your-as-token-here'          # Must match config.yaml appservice.token
hs_token: 'your-hs-token-here'          # Homeserver token (different from as_token)
sender_localpart: googleplay            # Must match config.yaml appservice.botUsername

# Namespace definitions
namespaces:
  users:
    - exclusive: true                    # Bridge has exclusive control
      regex: '@googleplay_.*'           # Pattern for virtual users
  aliases:
    - exclusive: true                    # Bridge has exclusive control
      regex: '#googleplay_.*'           # Pattern for room aliases
  rooms: []                             # No room namespace needed

rate_limited: false                     # Application services are not rate limited
protocols: ["googleplay"]              # Protocol identifier
```

## Advanced Configuration

### Multi-Application Configuration

Configure multiple Google Play applications with per-app settings:

```yaml
googleplay:
  auth:
    keyFile: '/path/to/service-account-key.json'
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  
  # Global defaults
  pollIntervalMs: 300000                 # 5 minutes
  maxReviewsPerPoll: 100
  lookbackDays: 7
  
  applications:
    # Production app with custom settings
    - packageName: 'com.yourcompany.mainapp'
      matrixRoom: '!mainapp-reviews:your-domain.com'
      appName: 'Your Main App'
      pollIntervalMs: 180000             # 3 minutes (more frequent)
      maxReviewsPerPoll: 150             # Higher limit
      lookbackDays: 14                   # Longer lookback
    
    # Beta app with standard settings
    - packageName: 'com.yourcompany.beta'
      matrixRoom: '!beta-reviews:your-domain.com'
      appName: 'Your Beta App'
      # Uses global defaults
    
    # Legacy app with minimal monitoring
    - packageName: 'com.yourcompany.legacy'
      matrixRoom: '!legacy-reviews:your-domain.com'
      appName: 'Legacy App'
      pollIntervalMs: 900000             # 15 minutes (less frequent)
      maxReviewsPerPoll: 50              # Lower limit
      lookbackDays: 3                    # Shorter lookback
```

### Advanced Authentication Methods

Multiple Google Play API authentication options:

```yaml
googleplay:
  auth:
    # Method 1: Service account key file (recommended)
    keyFile: '/secure/path/to/service-account-key.json'
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
    
    # Method 2: Inline service account credentials
    # clientEmail: 'service-account@project.iam.gserviceaccount.com'
    # privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n'
    # projectId: 'your-gcp-project-id'
    
    # Method 3: Environment variable pointing to credentials
    # keyFile: ${GOOGLE_APPLICATION_CREDENTIALS}
```

### Database Configuration Options

#### SQLite Configuration (Development/Small Scale)

```yaml
database:
  type: 'sqlite'
  path: './data/bridge.db'
  options:
    # SQLite-specific options
    foreign_keys: true                   # Enable foreign key constraints
    journal_mode: 'WAL'                 # Write-Ahead Logging for better performance
    synchronous: 'NORMAL'               # Balance between safety and performance
    cache_size: 10000                   # Cache size in pages
```

#### PostgreSQL Configuration (Production)

```yaml
database:
  type: 'postgresql'
  host: 'localhost'                     # Database host
  port: 5432                           # Database port
  database: 'matrix_googleplay_bridge' # Database name
  username: 'bridge_user'             # Database username
  password: 'secure_password'          # Database password
  
  # Connection pool settings
  poolMin: 2                           # Minimum connections in pool
  poolMax: 10                          # Maximum connections in pool
  
  # SSL configuration
  ssl: true                            # Enable SSL
  sslMode: 'require'                   # SSL mode: 'disable', 'require', 'verify-ca', 'verify-full'
  sslCert: '/path/to/client-cert.pem'  # Client certificate (optional)
  sslKey: '/path/to/client-key.pem'    # Client key (optional)
  sslRootCert: '/path/to/ca-cert.pem'  # CA certificate (optional)
  
  # Performance tuning
  connectionTimeout: 30000             # Connection timeout in ms
  idleTimeout: 60000                   # Idle connection timeout in ms
  
  # Migration settings
  migrationsTable: 'bridge_migrations' # Table name for migrations
  migrationsPath: './migrations'       # Path to migration files
```

### Monitoring and Health Configuration

```yaml
monitoring:
  enabled: true                        # Enable monitoring endpoints
  port: 9090                          # Monitoring port
  host: '0.0.0.0'                     # Monitoring interface
  
  # Feature toggles
  enableMetrics: true                  # Enable Prometheus metrics
  enableHealthCheck: true             # Enable health check endpoint
  requestLogging: true                # Log HTTP requests
  
  # Health check configuration
  healthChecks:
    googleplay:
      enabled: true                    # Test Google Play API connectivity
      timeout: 10000                   # Timeout in ms
      interval: 300000                 # Check interval in ms
    
    matrix:
      enabled: true                    # Test Matrix homeserver connectivity
      timeout: 5000                    # Timeout in ms
      interval: 60000                  # Check interval in ms
    
    database:
      enabled: true                    # Test database connectivity
      timeout: 5000                    # Timeout in ms
      interval: 60000                  # Check interval in ms
  
  # Metrics configuration
  metrics:
    prefix: 'matrix_googleplay_bridge_' # Metrics prefix
    collectDefaultMetrics: true       # Collect Node.js default metrics
    histogram:
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30]  # Custom histogram buckets
```

### Logging Configuration

```yaml
logging:
  level: 'info'                        # Log level: 'error', 'warn', 'info', 'debug'
  enableFile: true                     # Enable file logging
  enableConsole: true                  # Enable console logging
  
  # File logging configuration
  filePath: './logs/bridge.log'       # Log file path
  maxFiles: 30                         # Keep 30 log files
  maxSize: '100m'                      # Maximum size per file
  datePattern: 'YYYY-MM-DD'           # Daily rotation
  
  # Console logging configuration
  colorize: true                       # Colorize console output
  timestamp: true                      # Include timestamps
  
  # Component-specific logging
  components:
    bridge: 'info'                     # Bridge core logging
    googleplay: 'info'                 # Google Play API logging
    matrix: 'info'                     # Matrix integration logging
    database: 'warn'                   # Database logging
    http: 'info'                       # HTTP server logging
    security: 'warn'                   # Security-related logging
    audit: 'info'                      # Audit logging
  
  # Structured logging
  format: 'json'                       # 'json' or 'text'
  fields:
    service: 'matrix-googleplay-bridge'
    version: '0.1.0'
    environment: 'production'
```

## Security Configuration

### Administrative Access Control

```yaml
bridge:
  # Administrative users with full bridge access
  admins:
    - '@admin:your-domain.com'
    - '@devops:your-domain.com'
    - '@support-lead:your-domain.com'
  
  # Security settings
  security:
    enableAuditLogging: true           # Enable audit trail for all admin actions
    requireSecureCommands: true        # Require confirmation for dangerous commands
    maxCommandHistory: 1000            # Keep command history for auditing
    sessionTimeout: 3600000            # Admin session timeout (1 hour)
    
    # Rate limiting for commands
    commandRateLimit:
      window: 60000                    # 1 minute window
      max: 30                          # Maximum 30 commands per minute per user
```

### Input Validation and Sanitization

```yaml
security:
  inputValidation:
    # Maximum lengths for various inputs
    maxPackageNameLength: 100
    maxAppNameLength: 200
    maxReviewTextLength: 5000
    maxUserDisplayNameLength: 100
    maxRoomNameLength: 100
    
    # Content filtering
    enableContentFiltering: true       # Enable content filtering
    blockedPatterns:                   # Patterns to block/sanitize
      - '\\$\\{jndi:'                  # JNDI injection
      - '<script[^>]*>'                # XSS attempts
      - 'javascript:'                  # JavaScript URLs
      - '\\x00'                        # Null bytes
    
    # SQL injection protection
    enableSqlProtection: true          # Enable SQL injection protection
    allowedSqlChars: 'a-zA-Z0-9_.-'   # Allowed characters in SQL inputs
```

### API Security Settings

```yaml
security:
  api:
    # Rate limiting
    rateLimiting:
      enabled: true
      googleplay:
        requests: 100                  # Max requests per window
        windowMs: 60000               # 1 minute window
        delayAfter: 50                # Start delaying after 50 requests
        delayMs: 1000                 # Delay in ms
        maxDelayMs: 10000             # Maximum delay
        skipSuccessfulRequests: false  # Count all requests
      
      matrix:
        requests: 1000                # Higher limit for Matrix API
        windowMs: 60000               # 1 minute window
    
    # Circuit breaker settings
    circuitBreaker:
      enabled: true
      failureThreshold: 5            # Open after 5 failures
      resetTimeout: 60000            # Reset after 1 minute
      monitoringPeriod: 10000        # Monitor for 10 seconds
    
    # Request timeout settings
    timeouts:
      googleplay: 30000              # 30 seconds for Google Play API
      matrix: 10000                  # 10 seconds for Matrix API
      database: 5000                 # 5 seconds for database queries
```

## Production Configuration

### Production-Optimized config.yaml

```yaml
# Matrix Homeserver Configuration
homeserver:
  url: 'https://matrix.your-domain.com'
  domain: 'your-domain.com'

# Application Service Configuration
appservice:
  port: 8080
  bind: '127.0.0.1'                    # Bind to localhost only (use reverse proxy)
  token: ${AS_TOKEN}                   # Use environment variable
  id: 'googleplay-bridge'
  botUsername: 'googleplay'

# Google Play API Configuration
googleplay:
  auth:
    keyFile: ${GOOGLE_SERVICE_ACCOUNT_KEY_FILE}
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  
  # Production polling settings
  pollIntervalMs: 300000               # 5 minutes
  maxReviewsPerPoll: 100
  lookbackDays: 7
  
  # Retry configuration
  retryConfig:
    maxAttempts: 4                     # Maximum retry attempts
    baseDelay: 1000                    # Base delay in ms
    maxDelay: 60000                    # Maximum delay in ms
    exponentialBase: 2                 # Exponential backoff base
    jitter: true                       # Add random jitter
  
  applications:
    - packageName: ${APP_PACKAGE_NAME}
      matrixRoom: ${APP_MATRIX_ROOM}
      appName: ${APP_NAME}

# Production Database (PostgreSQL)
database:
  type: 'postgresql'
  host: ${DB_HOST:-localhost}
  port: ${DB_PORT:-5432}
  database: ${DB_NAME}
  username: ${DB_USER}
  password: ${DB_PASSWORD}
  ssl: true
  sslMode: 'require'
  poolMin: 5
  poolMax: 20
  connectionTimeout: 30000
  idleTimeout: 300000

# Production Monitoring
monitoring:
  enabled: true
  port: 9090
  host: '127.0.0.1'                    # Bind to localhost (use reverse proxy)
  enableMetrics: true
  enableHealthCheck: true
  requestLogging: true

# Production Logging
logging:
  level: 'info'                        # Don't use debug in production
  enableFile: true
  enableConsole: false                 # Disable console in production
  filePath: '/var/log/matrix-googleplay-bridge/bridge.log'
  format: 'json'                       # JSON for log aggregation
  maxFiles: 90                         # Keep 90 days of logs
  maxSize: '50m'
  datePattern: 'YYYY-MM-DD'

# Production Security
bridge:
  admins: ${BRIDGE_ADMINS}             # Comma-separated list
security:
  inputValidation:
    enableContentFiltering: true
  api:
    rateLimiting:
      enabled: true
    circuitBreaker:
      enabled: true
    timeouts:
      googleplay: 30000
      matrix: 10000
      database: 5000

# Feature toggles
features:
  categorization:
    enabled: true                      # Enable review categorization
    confidence_threshold: 0.7          # Minimum confidence for auto-categorization
  
  responseSuggestions:
    enabled: true                      # Enable response suggestions
    maxSuggestions: 3                  # Maximum suggestions to show
    confidence_threshold: 0.8          # Minimum confidence for suggestions
  
  messageTemplates:
    enabled: true                      # Enable message templating
    maxTemplates: 50                   # Maximum templates per category
  
  messageThreading:
    enabled: true                      # Enable Matrix threading
    maxThreadDepth: 10                 # Maximum thread depth
  
  auditLogging:
    enabled: true                      # Enable comprehensive audit logging
    retentionDays: 365                 # Keep audit logs for 1 year
    logLevel: 'info'                   # Audit log level

version: '0.1.0'
```

## Environment Variables

### Complete Environment Variable Reference

| Environment Variable | Configuration Path | Description | Required |
|---------------------|-------------------|-------------|----------|
| `CONFIG_PATH` | - | Path to config.yaml file | No |
| `NODE_ENV` | - | Node.js environment (production/development) | No |
| **Matrix Configuration** |
| `HOMESERVER_URL` | `homeserver.url` | Matrix homeserver URL | Yes |
| `HOMESERVER_DOMAIN` | `homeserver.domain` | Matrix domain | Yes |
| `AS_PORT` | `appservice.port` | Application service port | No |
| `AS_BIND` | `appservice.bind` | Bind interface | No |
| `AS_TOKEN` | `appservice.token` | Application service token | Yes |
| `AS_ID` | `appservice.id` | Application service ID | No |
| `BOT_USERNAME` | `appservice.botUsername` | Bot username | No |
| **Google Play Configuration** |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | `googleplay.auth.keyFile` | Service account key file path | Yes |
| `GOOGLE_CLIENT_EMAIL` | `googleplay.auth.clientEmail` | Service account email | No |
| `GOOGLE_PRIVATE_KEY` | `googleplay.auth.privateKey` | Service account private key | No |
| `GOOGLE_PROJECT_ID` | `googleplay.auth.projectId` | Google Cloud project ID | No |
| `APP_PACKAGE_NAME` | `googleplay.applications[0].packageName` | App package name | Yes |
| `APP_MATRIX_ROOM` | `googleplay.applications[0].matrixRoom` | Matrix room for reviews | Yes |
| `APP_NAME` | `googleplay.applications[0].appName` | App display name | No |
| `POLL_INTERVAL` | `googleplay.pollIntervalMs` | Polling interval in ms | No |
| `MAX_REVIEWS_PER_POLL` | `googleplay.maxReviewsPerPoll` | Max reviews per poll | No |
| **Database Configuration** |
| `DB_TYPE` | `database.type` | Database type (sqlite/postgresql) | No |
| `DB_PATH` | `database.path` | SQLite database path | No |
| `DB_HOST` | `database.host` | PostgreSQL host | No |
| `DB_PORT` | `database.port` | PostgreSQL port | No |
| `DB_NAME` | `database.database` | Database name | No |
| `DB_USER` | `database.username` | Database username | No |
| `DB_PASSWORD` | `database.password` | Database password | No |
| `DB_SSL` | `database.ssl` | Enable SSL (true/false) | No |
| **Monitoring Configuration** |
| `MONITORING_ENABLED` | `monitoring.enabled` | Enable monitoring (true/false) | No |
| `MONITORING_PORT` | `monitoring.port` | Monitoring port | No |
| `MONITORING_HOST` | `monitoring.host` | Monitoring host | No |
| `ENABLE_METRICS` | `monitoring.enableMetrics` | Enable metrics (true/false) | No |
| **Logging Configuration** |
| `LOG_LEVEL` | `logging.level` | Log level (error/warn/info/debug) | No |
| `LOG_FILE_PATH` | `logging.filePath` | Log file path | No |
| `LOG_FORMAT` | `logging.format` | Log format (json/text) | No |
| **Security Configuration** |
| `BRIDGE_ADMINS` | `bridge.admins` | Comma-separated admin list | No |
| `ENABLE_AUDIT_LOGGING` | `bridge.security.enableAuditLogging` | Enable audit logs (true/false) | No |

### Example Environment File (.env)

```bash
# Matrix Configuration
HOMESERVER_URL=https://matrix.your-domain.com
HOMESERVER_DOMAIN=your-domain.com
AS_TOKEN=your-secure-as-token-here
HS_TOKEN=your-secure-hs-token-here

# Google Play Configuration  
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/secure/path/to/service-account-key.json
APP_PACKAGE_NAME=com.yourcompany.app
APP_MATRIX_ROOM=!reviews:your-domain.com
APP_NAME=Your App Name

# Database Configuration (Production)
DB_TYPE=postgresql
DB_HOST=db.your-domain.com
DB_PORT=5432
DB_NAME=matrix_googleplay_bridge
DB_USER=bridge_user
DB_PASSWORD=your-secure-db-password
DB_SSL=true

# Monitoring
MONITORING_ENABLED=true
MONITORING_PORT=9090

# Logging
LOG_LEVEL=info
LOG_FILE_PATH=/var/log/matrix-googleplay-bridge/bridge.log

# Security
BRIDGE_ADMINS=@admin:your-domain.com,@devops:your-domain.com
ENABLE_AUDIT_LOGGING=true

# Node.js Environment
NODE_ENV=production
```

## Configuration Validation

The bridge automatically validates configuration on startup and provides detailed error messages for common issues.

### Built-in Validation Rules

1. **Required Fields**: All mandatory configuration fields must be present
2. **URL Validation**: Homeserver URLs must be valid HTTP(S) URLs
3. **Port Validation**: Ports must be between 1-65535 and available
4. **File Path Validation**: Service account key file must exist and be readable
5. **Database Validation**: Database credentials and connectivity
6. **Token Validation**: Tokens must be at least 32 characters long
7. **Application Validation**: Package names and Matrix rooms must be valid

### Manual Configuration Testing

```bash
# Test configuration without starting the bridge
npm run typecheck

# Validate specific configuration sections
node -e "const config = require('./dist/utils/Config'); console.log(config.validate())"

# Test database connectivity
node -e "const db = require('./dist/storage/DatabaseFactory'); db.testConnection()"

# Test Google Play API credentials
node -e "const gp = require('./dist/api/GooglePlayClient'); gp.testConnection()"
```

### Common Validation Errors

1. **Missing Configuration File**
   ```
   Error: Configuration file not found: ./config/config.yaml
   ```
   **Solution**: Copy `config.yaml.example` to `config.yaml`

2. **Invalid Homeserver URL**
   ```
   Error: Invalid URL for field: homeserver.url
   ```
   **Solution**: Ensure URL includes protocol (https://) and is properly formatted

3. **Service Account Key Not Found**
   ```
   Error: Google Play service account key file not found: /path/to/key.json
   ```
   **Solution**: Verify file path and permissions

4. **Database Connection Failed**
   ```
   Error: Unable to connect to database: Connection refused
   ```
   **Solution**: Check database server status, credentials, and network connectivity

## Hot Configuration Reload

The bridge supports reloading configuration without restarting the service using the `!reloadconfig` administrative command.

### Supported Hot-Reload Changes

- **Application Settings**: Add/remove apps, change polling intervals
- **Logging Configuration**: Change log levels, enable/disable file logging
- **Administrative Users**: Add/remove admin users
- **Feature Toggles**: Enable/disable features like categorization, suggestions
- **Monitoring Settings**: Change monitoring configuration
- **Security Settings**: Update rate limiting, input validation rules

### Hot-Reload Limitations

These settings require a full restart:
- **Database Configuration**: Database type, connection settings
- **Application Service Settings**: Port, bind address, tokens
- **Matrix Homeserver Settings**: URL, domain
- **Google Play Authentication**: Service account credentials

### Using Hot Configuration Reload

1. **Edit the configuration file**
   ```bash
   nano config/config.yaml
   ```

2. **Trigger reload via Matrix command**
   ```
   !reloadconfig
   ```

3. **Verify reload success**
   ```
   !status  # Check if new configuration is active
   ```

4. **Check logs for reload status**
   ```bash
   tail -f logs/bridge.log | grep "config"
   ```

## Troubleshooting

### Configuration Loading Issues

1. **YAML Syntax Errors**
   ```
   Error: bad indentation of a mapping entry
   ```
   **Solution**: Validate YAML syntax with online validators or `yamllint`

2. **Environment Variable Substitution**
   ```
   Error: Environment variable not found: ${MISSING_VAR}
   ```
   **Solution**: Set all required environment variables or provide defaults

3. **File Permission Issues**
   ```
   Error: EACCES: permission denied, open '/path/to/config.yaml'
   ```
   **Solution**: Check file permissions and ownership

### Google Play API Configuration Issues

1. **Invalid Service Account Key**
   ```
   Error: Error loading Google Play credentials: invalid_grant
   ```
   **Solution**: Regenerate service account key and update file

2. **Insufficient Permissions**
   ```
   Error: The current user does not have sufficient permissions
   ```
   **Solution**: Grant "View app information and download bulk reports" permission in Google Play Console

3. **API Not Enabled**
   ```
   Error: Google Play Developer API has not been used
   ```
   **Solution**: Enable Android Publisher API in Google Cloud Console

### Matrix Integration Issues

1. **Invalid Registration**
   ```
   Error: Application service not found
   ```
   **Solution**: Verify registration.yaml is properly configured in homeserver

2. **Token Mismatch**
   ```
   Error: Invalid access token
   ```
   **Solution**: Ensure as_token in registration.yaml matches appservice.token in config.yaml

3. **Network Connectivity**
   ```
   Error: connect ECONNREFUSED matrix.your-domain.com:443
   ```
   **Solution**: Check homeserver URL, DNS resolution, and firewall rules

### Database Configuration Issues

1. **SQLite Permission Issues**
   ```
   Error: SQLITE_CANTOPEN: unable to open database file
   ```
   **Solution**: Check directory permissions and disk space

2. **PostgreSQL Connection Issues**
   ```
   Error: connect ECONNREFUSED postgresql://localhost:5432
   ```
   **Solution**: Verify PostgreSQL service is running and accepting connections

3. **Schema Migration Issues**
   ```
   Error: relation "bridge_users" does not exist
   ```
   **Solution**: Run database migrations manually: `npm run db:migrate`

### Getting Additional Help

1. **Enable Debug Logging**
   ```yaml
   logging:
     level: 'debug'
   ```

2. **Check System Logs**
   ```bash
   # systemd service
   journalctl -u matrix-googleplay-bridge -f
   
   # Docker
   docker logs matrix-googleplay-bridge -f
   ```

3. **Test Individual Components**
   ```bash
   # Test Google Play API
   curl -X POST http://localhost:8080/test/googleplay
   
   # Test Matrix connectivity
   curl -X POST http://localhost:8080/test/matrix
   
   # Test health endpoint
   curl http://localhost:9090/health
   ```

4. **Community Support**
   - Join the Matrix room: `#matrix-googleplay-bridge:your-domain.com`
   - Check GitHub Issues: https://github.com/CDLProduction/matrix-googleplay-bridge/issues
   - Review documentation: [docs/](../)

---

This completes the comprehensive configuration guide. Your Matrix Google Play Bridge should now be properly configured for your specific environment and requirements.