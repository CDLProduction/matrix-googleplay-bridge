# Matrix Google Play Bridge

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-423%2F423%20Passing-brightgreen.svg)](./tests/)
[![Security](https://img.shields.io/badge/Security-OWASP%20Top%2010%20Compliant-green.svg)](./docs/SECURITY_ASSESSMENT_REPORT.md)

A production-ready, enterprise-grade Matrix Application Service that creates a **bidirectional bridge** between Google Play Console reviews and Matrix chat rooms. Designed for Android development teams and customer support organizations using Matrix as their primary communication platform.

## 🚀 Key Features

### 📱 **Core Bridge Functionality**
- **Bidirectional Communication**: Google Play reviews ↔ Matrix messages with full two-way sync
- **Real-time Review Processing**: Automated polling with 7-day lookback window and configurable intervals
- **Virtual User System**: Creates Matrix users for each Google Play reviewer with proper isolation
- **Multi-App Support**: Handle multiple Google Play applications simultaneously with per-app configuration
- **Rich Message Formatting**: HTML support, star ratings, device metadata, and review threading

### 🛡️ **Enterprise Security & Reliability**
- **OWASP Top 10 Compliant**: Comprehensive security testing with 155+ security test scenarios
- **Input Validation**: Protection against injection attacks (SQL, XSS, command injection, path traversal)
- **Circuit Breakers & Rate Limiting**: Fault tolerance with automatic recovery mechanisms
- **Health Monitoring**: Real-time system health checks with lightweight metrics support
- **Audit Logging**: Complete audit trails for all administrative operations with database support
- **Authentication Security**: Service account validation, token security, secure configuration management

### 🎛️ **Advanced Administrative Features**
- **25+ Bridge Commands**: Complete administrative interface via Matrix chat
- **Configuration Hot-Reload**: Update configuration without service restart (`!reloadconfig`)
- **Maintenance Mode**: Controlled service maintenance with graceful degradation (`!maintenance`)
- **Statistics & Monitoring**: Real-time bridge statistics, review processing metrics, system health
- **User & Room Management**: Dynamic user/room management, permissions, cross-app routing

### 📊 **Intelligent Review Processing**
- **Review Categorization**: 14 automatic categories (Bug Reports, Feature Requests, etc.) with sentiment analysis
- **Response Suggestions**: 12+ intelligent response templates with confidence scoring
- **Message Templating**: Advanced templating system with versioning, analytics, and search
- **Message Threading**: Matrix-compliant threading for organized review conversations
- **Reply Queue Management**: Retry logic with exponential backoff for failed Google Play API calls

### 🏗️ **Production-Ready Infrastructure**
- **Database Support**: SQLite (development) and PostgreSQL (production) with migrations
- **Docker Support**: Production and development containers with multi-stage builds
- **Health Endpoints**: `/health`, `/metrics`, `/stats` for monitoring integration
- **Graceful Shutdown**: Proper resource cleanup and pending operation completion
- **Horizontal Scaling**: Multi-instance support with shared state management

## 📸 Live Demo

```
🔍 New Google Play Review Detected:
┌─────────────────────────────────────────────────────────────┐
│ ⭐⭐⭐⭐⭐ Great App! (5 stars)                               │
│ 👤 John Doe • 📱 Pixel 6 Pro • Android 13 • App v2.1.0    │
│ 🕐 2 hours ago                                              │
│                                                             │
│ "Love the new dark mode feature! The app is much faster    │
│ now and the UI improvements are fantastic. Keep up the     │
│ great work!"                                                │
│                                                             │
│ 🏷️ Category: Positive Feedback                              │
│ 💡 Suggested Response: "Thank you for the positive feedback! │
│    We're thrilled you're enjoying the new features..."      │
└─────────────────────────────────────────────────────────────┘

Support Team Reply:
> Thank you John! We're so glad you love the dark mode. 
> Our team worked hard on those performance improvements. 
> Stay tuned for more exciting updates coming soon! 🚀

✅ Reply sent to Google Play Store successfully
```

## 📋 Prerequisites

Before installing the Matrix Google Play Bridge, ensure you have:

- **Node.js** 18.0.0 or higher
- **Matrix homeserver** (Synapse recommended) with admin access
- **Google Play Console** account with API access
- **Database**: SQLite (included) or PostgreSQL for production
- **Operating System**: Linux, macOS, or Windows (Linux recommended for production)

## 🚀 Installation Methods

Choose your preferred installation method:

### 🖥️ **Method 1: Native System Installation** (Recommended for Development)

Perfect for development environments and users who want full control over their system.

#### Step 1: Automated Installation

```bash
# Download and run the automated installer
curl -fsSL https://raw.githubusercontent.com/CDLProduction/matrix-googleplay-bridge/main/scripts/install.sh | bash

# Or download and run locally for more control
wget https://raw.githubusercontent.com/CDLProduction/matrix-googleplay-bridge/main/scripts/install.sh
chmod +x install.sh
./install.sh
```

**What the installer does:**
- Detects your operating system (Ubuntu, CentOS, Fedora, macOS)
- Installs Node.js 18+ and npm if not present
- Downloads and compiles the bridge source code
- Creates system directories and sets permissions
- Installs and configures systemd service
- Sets up log rotation and backup systems

#### Step 2: Interactive Configuration

```bash
# Navigate to installation directory
cd /opt/matrix-googleplay-bridge

# Run the configuration wizard
sudo ./scripts/setup.sh
```

**Configuration wizard will collect:**
- Matrix homeserver URL and domain
- Application Service tokens (auto-generated)
- Google Play API credentials
- Database configuration (SQLite or PostgreSQL)
- Administrative user settings

#### Step 3: Google Play API Setup

1. **Create a Google Cloud Project**:
   ```bash
   # Go to Google Cloud Console
   # https://console.cloud.google.com/
   ```

2. **Enable Android Publisher API**:
   ```bash
   # In your project, go to APIs & Services > Library
   # Search for "Google Play Android Developer API"
   # Click "Enable"
   ```

3. **Create Service Account**:
   ```bash
   # Go to IAM & Admin > Service Accounts
   # Click "Create Service Account"
   # Name: matrix-googleplay-bridge
   # Download JSON key file
   ```

4. **Grant Play Console Access**:
   ```bash
   # Go to Google Play Console > Users & Permissions
   # Click "Add User"
   # Email: [service-account-email]@[project-id].iam.gserviceaccount.com
   # Grant "View app information and download reports" permission
   ```

5. **Configure the Bridge**:
   ```bash
   # Copy your service account key
   sudo cp ~/Downloads/service-account-key.json /opt/matrix-googleplay-bridge/secrets/
   sudo chown bridge:bridge /opt/matrix-googleplay-bridge/secrets/service-account-key.json
   sudo chmod 600 /opt/matrix-googleplay-bridge/secrets/service-account-key.json
   ```

#### Step 4: Matrix Homeserver Registration

1. **Copy Registration File**:
   ```bash
   # Copy the generated registration file to your Synapse config directory
   sudo cp /opt/matrix-googleplay-bridge/config/registration.yaml /etc/matrix-synapse/
   ```

2. **Update Synapse Configuration**:
   ```yaml
   # Add to /etc/matrix-synapse/homeserver.yaml
   app_service_config_files:
     - /etc/matrix-synapse/registration.yaml
   ```

3. **Restart Synapse**:
   ```bash
   sudo systemctl restart matrix-synapse
   ```

#### Step 5: Start and Verify

```bash
# Start the bridge
sudo systemctl start matrix-googleplay-bridge
sudo systemctl enable matrix-googleplay-bridge

# Check status
sudo systemctl status matrix-googleplay-bridge

# View logs
sudo journalctl -f -u matrix-googleplay-bridge

# Check health
curl http://localhost:9090/health
```

#### Step 6: Test the Bridge

1. **Create a test room**:
   ```bash
   # In your Matrix client, create a room like #support:yourdomain.com
   ```

2. **Invite the bridge bot**:
   ```bash
   # Invite @googleplaybot:yourdomain.com to your room
   ```

3. **Test bridge commands**:
   ```bash
   # In the Matrix room, type:
   !help
   !status
   !apps
   ```

### 🐳 **Method 2: Docker Installation** (Recommended for Production)

Perfect for production deployments with containerized infrastructure.

#### Step 1: Automated Docker Installation

```bash
# Download and run the automated Docker installer
curl -fsSL https://raw.githubusercontent.com/CDLProduction/matrix-googleplay-bridge/main/scripts/docker-install.sh | bash

# Or download and run locally
wget https://raw.githubusercontent.com/CDLProduction/matrix-googleplay-bridge/main/scripts/docker-install.sh
chmod +x docker-install.sh
./docker-install.sh
```

**What the Docker installer does:**
- Detects your OS and installs Docker + Docker Compose if needed
- Downloads the bridge source code to `/opt/matrix-googleplay-bridge-docker`
- Builds optimized Docker images using multi-stage builds
- Creates management scripts for easy operation
- Sets up proper directory structure and permissions

#### Step 2: Interactive Docker Configuration

```bash
# Navigate to Docker installation directory
cd /opt/matrix-googleplay-bridge-docker

# Run the Docker configuration wizard
./scripts/docker-setup.sh
```

**Docker configuration wizard provides:**
- Environment variable configuration (.env file)
- Matrix homeserver setup
- Google Play API credential management
- Database configuration (PostgreSQL for production)
- SSL/TLS certificate setup options
- Development vs production environment selection

#### Step 3: Google Play API Setup (Same as Native)

Follow the same Google Play API setup steps as in the Native installation method above.

#### Step 4: Configure Environment Variables

The Docker setup creates a comprehensive `.env` file:

```bash
# Matrix Configuration
MATRIX_HOMESERVER_URL=https://matrix.yourdomain.com
MATRIX_DOMAIN=yourdomain.com
MATRIX_AS_TOKEN=your-generated-as-token
MATRIX_HS_TOKEN=your-generated-hs-token

# Google Play Configuration
GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_FILE=/app/secrets/service-account-key.json
GOOGLE_PLAY_POLL_INTERVAL_MS=300000

# Database Configuration (Production PostgreSQL)
DB_TYPE=postgresql
DB_HOST=postgres
DB_PORT=5432
DB_NAME=matrix_googleplay_bridge
DB_USER=bridge_user
DB_PASSWORD=secure-generated-password

# Application Configuration
BRIDGE_PORT=9000
HEALTH_PORT=9090
LOG_LEVEL=info

# Security
BRIDGE_ADMINS=@admin:yourdomain.com
```

#### Step 5: Start Docker Stack

```bash
# Start all services (bridge, database, monitoring)
./docker-start.sh

# Or using docker-compose directly
docker compose up -d

# Check service status
docker compose ps

# View logs
./docker-logs.sh
# or
docker compose logs -f bridge
```

#### Step 6: Docker Management Commands

The Docker installation provides comprehensive management tools:

```bash
# Service Management
./docker-start.sh              # Start all services
./docker-stop.sh               # Stop all services  
./docker-restart.sh            # Restart bridge service
./docker-logs.sh [service]     # View logs

# Advanced Management (using docker-manage.sh)
./scripts/docker-manage.sh start          # Start services
./scripts/docker-manage.sh stop           # Stop services  
./scripts/docker-manage.sh status         # Show detailed status
./scripts/docker-manage.sh health         # Run health checks
./scripts/docker-manage.sh monitor        # Live monitoring dashboard

# Backup and Maintenance
./docker-backup.sh                        # Create backup
./scripts/docker-manage.sh backup [name]  # Named backup
./scripts/docker-manage.sh list-backups   # List all backups
./docker-update.sh                        # Update to latest version
./scripts/docker-manage.sh cleanup        # Clean up Docker resources

# Development and Debugging
./scripts/docker-manage.sh logs bridge 100    # Last 100 log lines
./scripts/docker-manage.sh follow bridge      # Follow logs live
./scripts/docker-manage.sh exec bridge bash   # Shell access
```

#### Step 7: Production Deployment (Docker)

For production environments, use the production override:

```bash
# Start with production configuration
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d

# Production features include:
# - Resource limits and reservations
# - SSL/TLS termination via Nginx
# - Enhanced security configurations  
# - Automated backups and monitoring
# - Health checks and restart policies
```

## ⚙️ Configuration Reference

### Basic Configuration (`config/config.yaml`)

```yaml
# Matrix Homeserver Configuration
homeserver:
  url: 'https://matrix.yourdomain.com'
  domain: 'yourdomain.com'

# Application Service Configuration  
appservice:
  port: 9000
  bind: '0.0.0.0'
  token: 'your-unique-as-token-here'
  id: 'googleplay_bridge'
  botUsername: 'googleplaybot'

# Google Play API Configuration
googleplay:
  auth:
    keyFile: '/path/to/service-account-key.json'
    # Alternative: keyFileContent: '{"type": "service_account", ...}'
  pollIntervalMs: 300000  # 5 minutes
  
  # Multiple app support
  applications:
    - packageName: 'com.yourcompany.app1'
      matrixRoom: '!app1-reviews:yourdomain.com'
      appName: 'Your App Name'
      
    - packageName: 'com.yourcompany.app2'
      matrixRoom: '!app2-reviews:yourdomain.com'
      appName: 'Your Second App'

# Database Configuration
database:
  type: 'postgresql'  # or 'sqlite'
  host: 'localhost'
  port: 5432
  database: 'matrix_googleplay_bridge'
  username: 'bridge_user'
  password: 'secure_password'

# Logging Configuration
logging:
  level: 'info'
  file: './logs/bridge.log'
  console: true
```

### Environment Variable Overrides

All configuration can be overridden with environment variables:

```bash
# Matrix Configuration
export MATRIX_HOMESERVER_URL="https://matrix.yourdomain.com"
export MATRIX_DOMAIN="yourdomain.com"
export MATRIX_AS_TOKEN="your-as-token"
export MATRIX_HS_TOKEN="your-hs-token"

# Google Play Configuration  
export GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_FILE="/path/to/key.json"
export GOOGLE_PLAY_POLL_INTERVAL_MS="300000"

# Database Configuration
export DB_TYPE="postgresql"
export DB_HOST="localhost"
export DB_PORT="5432"
export DB_USERNAME="bridge_user"
export DB_PASSWORD="secure_password"
export DB_DATABASE="matrix_googleplay_bridge"
```

## 💬 Administrative Commands

The bridge supports 25+ administrative commands for complete system management:

### Core Commands
- `!help` - Show available commands and usage
- `!ping` - Test bridge connectivity
- `!status` - Display bridge status and health
- `!stats` - Show detailed statistics and metrics
- `!version` - Display bridge version information

### Application Management
- `!apps` - List all configured applications
- `!addapp <package> <room> [name]` - Add new application
- `!removeapp <package>` - Remove application
- `!enableapp <package>` - Enable application polling
- `!disableapp <package>` - Disable application polling

### System Administration  
- `!reloadconfig` - Reload configuration without restart
- `!maintenance on/off/status` - Control maintenance mode
- `!rooms` - List active bridge rooms
- `!users` - Show virtual user statistics
- `!logs [level] [count]` - View recent log entries

### Advanced Features
- `!categorize <text>` - Test review categorization
- `!suggest <text>` - Get response suggestions
- `!templates [category]` - View message templates
- `!threads` - Show threading statistics

### Example Usage

```bash
# In your Matrix room with the bridge bot:

# Check bridge status
!status
# Output: Bridge Status: Running ✅
#         Uptime: 2 days, 14 hours
#         Active Apps: 3
#         Processed Reviews: 145
#         Health: All systems operational

# Add a new app
!addapp com.example.newapp !newapp-support:yourdomain.com "New App Name"
# Output: ✅ Application added successfully
#         Package: com.example.newapp
#         Room: !newapp-support:yourdomain.com
#         Polling: Enabled

# Test review categorization
!categorize "The app crashes when I try to login"
# Output: 🏷️ Category: Bug Report (Confidence: 92%)
#         🔥 Urgency: High
#         💡 Suggested Response: "Thank you for reporting this issue..."

# Get response suggestions
!suggest "Great app but needs dark mode"
# Output: 💡 Response Suggestions:
#         1. "Thank you for the feedback! Dark mode is on our roadmap..." (85%)
#         2. "We appreciate your suggestion! We're exploring..." (78%)
#         3. "Thanks for the positive review! We're always looking..." (65%)
```

## 🔧 Management and Maintenance

### Native System Management

```bash
# Service Management
sudo systemctl start matrix-googleplay-bridge
sudo systemctl stop matrix-googleplay-bridge
sudo systemctl restart matrix-googleplay-bridge
sudo systemctl status matrix-googleplay-bridge

# View Logs
sudo journalctl -f -u matrix-googleplay-bridge
sudo journalctl -u matrix-googleplay-bridge --since "1 hour ago"

# Configuration Management
sudo nano /opt/matrix-googleplay-bridge/config/config.yaml
sudo systemctl reload matrix-googleplay-bridge  # Hot reload

# Backup Management
sudo /opt/matrix-googleplay-bridge/scripts/backup.sh
sudo /opt/matrix-googleplay-bridge/scripts/backup.sh daily-backup
sudo /opt/matrix-googleplay-bridge/scripts/restore.sh backup-20241201-120000

# Update Management
sudo /opt/matrix-googleplay-bridge/scripts/update.sh
# Automatically: backs up, updates code, migrates database, restarts service
```

### Docker Management

```bash
# Service Management
./docker-start.sh
./docker-stop.sh  
./docker-restart.sh
./scripts/docker-manage.sh status

# Advanced Management
./scripts/docker-manage.sh start bridge postgres    # Start specific services
./scripts/docker-manage.sh health                   # Health checks
./scripts/docker-manage.sh monitor                  # Live monitoring

# Logs and Debugging
./docker-logs.sh bridge
./scripts/docker-manage.sh follow bridge           # Follow logs
./scripts/docker-manage.sh exec bridge bash        # Shell access

# Backup and Restore
./docker-backup.sh
./scripts/docker-manage.sh backup production-backup
./scripts/docker-manage.sh list-backups

# Updates and Maintenance
./docker-update.sh
./scripts/docker-manage.sh update                  # Update with backup
./scripts/docker-manage.sh cleanup                 # Clean up resources
```

## 🏗️ Architecture Overview

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Google Play    │    │  Matrix Google  │    │   Matrix        │
│  Console API    │◄──►│  Play Bridge    │◄──►│   Homeserver    │
│                 │    │                 │    │                 │
│ • Reviews API   │    │ • Review Mgmt   │    │ • Room Mgmt     │
│ • Reply API     │    │ • User Mgmt     │    │ • User Mgmt     │
│ • Auth API      │    │ • Message Fmt   │    │ • Event Stream  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Database      │
                    │                 │
                    │ • User Maps     │
                    │ • Room Maps     │
                    │ • Message Store │
                    │ • Audit Logs    │
                    └─────────────────┘
```

### Core Components

- **GooglePlayBridge**: Main orchestration class managing the bridge lifecycle
- **MatrixHandler**: Matrix event processing and user management  
- **GooglePlayClient**: Google Play Console API integration with OAuth2/Service Account auth
- **ReviewManager**: Review polling, processing, and reply management with retry logic
- **AppManager**: Multi-application lifecycle management with per-app configuration
- **BridgeCommands**: Administrative command system with 25+ commands
- **MessageManager**: Message formatting, storage, and threading with HTML support
- **UserManager**: Virtual user creation and management for Google Play reviewers
- **RoomManager**: Room mapping and permission management

### Features Architecture

- **ReviewCategorization**: 14 categories with sentiment analysis and urgency scoring
- **ResponseSuggestions**: 12+ intelligent response templates with confidence scoring
- **MessageTemplates**: Advanced templating system with versioning and analytics
- **MessageThreading**: Matrix-compliant threading for organized conversations
- **AuditLogger**: Comprehensive audit trail system with database persistence

## 📊 Monitoring and Health Checks

### Built-in Health Endpoints

```bash
# Health check endpoint
curl http://localhost:9090/health
# Output: {
#   "status": "healthy",
#   "uptime": "2d 14h 23m",
#   "database": "connected",
#   "matrix": "connected",
#   "googleplay": "authenticated"
# }

# Basic metrics endpoint  
curl http://localhost:9090/metrics
# Output: {
#   "reviews_processed": 145,
#   "replies_sent": 67,
#   "active_apps": 3,
#   "virtual_users": 89,
#   "uptime_seconds": 223380
# }

# Application statistics
curl http://localhost:9090/stats
# Output: Detailed bridge statistics including per-app metrics
```

### System Monitoring

```bash
# Native System Monitoring
sudo systemctl is-active matrix-googleplay-bridge
sudo journalctl -u matrix-googleplay-bridge --since "10 minutes ago"

# Docker Monitoring  
docker compose ps                           # Service status
docker compose logs -f bridge              # Live logs
./scripts/docker-manage.sh monitor         # Live dashboard
./scripts/docker-manage.sh health          # Health checks
```

## 🧪 Testing and Quality

### Comprehensive Test Suite
- **423 Total Tests** - 100% passing with complete coverage
- **155 Security Tests** - OWASP Top 10 compliant security validation
- **72 Integration Tests** - End-to-end bridge functionality testing  
- **196 Unit Tests** - Component-level functionality validation

### Running Tests

```bash
# Native System Testing
npm test                    # All tests
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report
npm run test:security      # Security tests only

# Docker Testing
./scripts/docker-manage.sh exec bridge npm test
./scripts/docker-manage.sh exec bridge npm run test:security
```

### Security Features
- **Authentication Security**: Service account validation, token security
- **Input Validation**: SQL injection, XSS, command injection protection
- **API Security**: Rate limiting, circuit breakers, request validation
- **Configuration Security**: Secrets management, environment validation
- **Audit Logging**: Real-time security event logging and compliance support

## 🔍 Troubleshooting

### Common Issues and Solutions

#### 1. Bridge Won't Start

```bash
# Check logs for errors
# Native:
sudo journalctl -u matrix-googleplay-bridge --since "5 minutes ago"

# Docker:
./docker-logs.sh bridge

# Common fixes:
# - Check configuration file syntax
# - Verify Google Play API credentials
# - Ensure Matrix homeserver is accessible
# - Check database connectivity
```

#### 2. Google Play API Authentication Failed

```bash
# Verify service account key file
ls -la /path/to/service-account-key.json

# Test API access manually
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.yourapp/reviews"

# Check Google Cloud Console:
# - API is enabled
# - Service account has correct permissions
# - Play Console user is added with service account email
```

#### 3. Matrix Connection Issues

```bash
# Test Matrix homeserver connectivity
curl https://matrix.yourdomain.com/_matrix/client/versions

# Verify registration file
cat /etc/matrix-synapse/registration.yaml

# Check Synapse logs
sudo journalctl -u matrix-synapse | grep "googleplay"

# Test bridge bot can be invited
# In Matrix client: /invite @googleplaybot:yourdomain.com
```

#### 4. Database Connection Problems

```bash
# SQLite issues
ls -la ./data/bridge.db
sqlite3 ./data/bridge.db ".tables"

# PostgreSQL issues  
docker compose exec postgres pg_isready -U bridge_user
docker compose exec postgres psql -U bridge_user -d matrix_googleplay_bridge -c "SELECT version();"
```

#### 5. Docker Container Issues

```bash
# Check container status
docker compose ps

# Examine container logs
docker compose logs bridge
docker compose logs postgres

# Test container connectivity
./scripts/docker-manage.sh health

# Resource usage
docker stats
```

### Performance Optimization

```bash
# Monitor resource usage
# Native:
top -p $(pgrep -f matrix-googleplay-bridge)

# Docker:
docker stats

# Optimize configuration:
# - Increase pollIntervalMs for fewer API calls
# - Adjust database connection pool size
# - Configure log rotation to prevent disk issues
# - Use PostgreSQL for production (better performance than SQLite)
```

### Debug Mode

```bash
# Enable debug logging
# Native:
sudo sed -i 's/level: "info"/level: "debug"/' /opt/matrix-googleplay-bridge/config/config.yaml
sudo systemctl reload matrix-googleplay-bridge

# Docker:
# Edit .env file: LOG_LEVEL=debug
docker compose restart bridge

# View debug logs
./scripts/docker-manage.sh logs bridge | grep DEBUG
```

## 📖 Documentation

### Complete Documentation Suite
- **[Installation Guide](docs/setup/installation.md)** - Detailed installation instructions
- **[Configuration Guide](docs/setup/configuration.md)** - Complete configuration reference  
- **[Google Play API Setup](docs/setup/google-play-api.md)** - Google Play Console integration
- **[Docker Setup Guide](DOCKER_README.md)** - Comprehensive Docker deployment guide
- **[Troubleshooting Guide](docs/troubleshooting.md)** - Common issues and solutions
- **[API Documentation](docs/api/README.md)** - Developer API reference
- **[Security Assessment](docs/SECURITY_ASSESSMENT_REPORT.md)** - Security analysis and recommendations

## 🛡️ Security

### Security Features
- **OWASP Top 10 Compliant**: Comprehensive protection against web application vulnerabilities
- **Input Validation**: Protection against injection attacks and malicious input
- **Secure Configuration**: Environment variable validation and secrets management
- **Audit Logging**: Complete audit trails with tamper-proof logging
- **Authentication Security**: Service account validation and token security
- **Network Security**: TLS encryption, secure API communication

### Security Reporting
- **Security Assessment Report**: Complete security analysis available in [docs/SECURITY_ASSESSMENT_REPORT.md](docs/SECURITY_ASSESSMENT_REPORT.md)
- **Vulnerability Disclosure**: Report security issues to [security@yourdomain.com](mailto:security@yourdomain.com)
- **Security Updates**: Regular security updates and dependency monitoring

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with tests
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

### Code Standards
- **TypeScript**: Strict mode with full type safety
- **Testing**: Maintain 100% test coverage for new features
- **Security**: Follow security best practices and OWASP guidelines
- **Documentation**: Update documentation for new features

## 📊 Project Statistics

### Project Metrics
- **16,000+ Lines of Code** across 55+ TypeScript files
- **423 Tests** with 100% pass rate and comprehensive coverage
- **25+ Administrative Commands** for complete system management
- **14 Review Categories** with intelligent classification
- **12+ Response Templates** with confidence scoring
- **Multi-App Support** with per-app configuration and isolation

### Performance Characteristics
- **Sub-second Response Times** for Matrix message processing
- **Configurable Polling Intervals** (default: 5 minutes) with 7-day lookback
- **Rate Limiting Compliant** with Google Play API quotas
- **Circuit Breaker Protection** for API failures and recovery
- **Graceful Degradation** with maintenance mode support

## 📝 License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

## 🙋 Support & Community

### Getting Help
- **Documentation**: Comprehensive guides in the [docs/](docs/) directory
- **Issues**: Report bugs and request features on [GitHub Issues](https://github.com/CDLProduction/matrix-googleplay-bridge/issues)
- **Matrix Room**: Join our support room at `#matrix-googleplay-bridge:yourdomain.com`
- **Email Support**: Contact us at [support@yourdomain.com](mailto:support@yourdomain.com)

### Quick Support Commands

```bash
# Generate support information automatically
# Native:
sudo /opt/matrix-googleplay-bridge/scripts/support-info.sh

# Docker:
./scripts/docker-manage.sh status
./scripts/docker-manage.sh health
curl http://localhost:9090/health
```

### Community
- **Matrix Community**: Active community support and discussions
- **Regular Updates**: Continuous development with regular releases
- **Enterprise Support**: Commercial support available for production deployments
- **Contributing**: Welcome contributions from the Matrix and Android development communities

---

**Built with ❤️ for the Matrix and Android development communities**

*Matrix Google Play Bridge - Bridging customer feedback with team collaboration*