# Installation Guide

This comprehensive guide will walk you through installing and setting up the Matrix Google Play Bridge from scratch. Choose the installation method that best fits your environment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation Methods](#installation-methods)
  - [Method 1: Standalone Installation](#method-1-standalone-installation)
  - [Method 2: Docker Installation](#method-2-docker-installation)
  - [Method 3: Docker Compose (Recommended)](#method-3-docker-compose-recommended)
- [Post-Installation Setup](#post-installation-setup)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before installing the bridge, ensure you have the following prerequisites:

### System Requirements

- **Operating System**: Linux (Ubuntu 20.04+, CentOS 8+, Debian 11+), macOS 10.15+, or Windows 10+ with WSL2
- **Node.js**: Version 18.0.0 or higher
- **npm**: Version 8.0.0 or higher
- **Memory**: Minimum 1GB RAM, recommended 2GB+ for production
- **Disk Space**: Minimum 500MB free space
- **Network**: Internet access for Google Play API and Matrix homeserver connectivity

### External Services

1. **Matrix Homeserver**
   - Synapse 1.50.0+ (recommended) with admin access
   - Element Web or compatible Matrix client
   - Ability to add application service registrations

2. **Google Play Console Account**
   - Active Google Play Console account with published apps
   - Google Cloud Platform project with Android Publisher API enabled
   - Service account with appropriate permissions

3. **Database** (Production)
   - PostgreSQL 12+ (recommended for production)
   - SQLite 3.x (suitable for development/testing)

## Installation Methods

### Method 1: Standalone Installation

This method installs the bridge directly on your system using Node.js and npm.

#### Step 1: System Preparation

**Ubuntu/Debian:**
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# Install Git and other dependencies
sudo apt-get install -y git sqlite3 postgresql-client curl

# Verify Node.js version
node --version  # Should be v18.0.0 or higher
npm --version   # Should be 8.0.0 or higher
```

**CentOS/RHEL/Fedora:**
```bash
# Update system packages
sudo dnf update -y

# Install Node.js 18.x
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs npm gcc-c++ make

# Install Git and other dependencies
sudo dnf install -y git sqlite postgresql curl

# Verify Node.js version
node --version  # Should be v18.0.0 or higher
npm --version   # Should be 8.0.0 or higher
```

**macOS:**
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@18

# Install other dependencies
brew install git sqlite3 postgresql

# Verify Node.js version
node --version  # Should be v18.0.0 or higher
npm --version   # Should be 8.0.0 or higher
```

#### Step 2: Download and Install Bridge

```bash
# Clone the repository
git clone https://github.com/CDLProduction/matrix-googleplay-bridge.git
cd matrix-googleplay-bridge

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Verify installation
npm test  # Should show 423/423 tests passing
```

#### Step 3: Create Bridge User (Linux)

```bash
# Create dedicated user for the bridge
sudo useradd -r -s /bin/false -d /opt/matrix-googleplay-bridge matrix-bridge

# Create directories
sudo mkdir -p /opt/matrix-googleplay-bridge/{config,logs,data}

# Copy bridge files
sudo cp -r . /opt/matrix-googleplay-bridge/
sudo chown -R matrix-bridge:matrix-bridge /opt/matrix-googleplay-bridge

# Set proper permissions
sudo chmod 750 /opt/matrix-googleplay-bridge
sudo chmod 640 /opt/matrix-googleplay-bridge/config/*
```

### Method 2: Docker Installation

This method uses Docker to run the bridge in a containerized environment.

#### Step 1: Install Docker

**Ubuntu/Debian:**
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Add current user to docker group
sudo usermod -aG docker $USER

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Log out and log back in for group changes to take effect
```

**CentOS/RHEL/Fedora:**
```bash
# Install Docker
sudo dnf install -y docker
sudo systemctl start docker
sudo systemctl enable docker

# Add current user to docker group
sudo usermod -aG docker $USER
```

#### Step 2: Build Docker Image

```bash
# Clone the repository
git clone https://github.com/CDLProduction/matrix-googleplay-bridge.git
cd matrix-googleplay-bridge

# Build production Docker image
npm run docker:build

# Or build development image
npm run docker:dev

# Verify image was built
docker images | grep matrix-googleplay-bridge
```

#### Step 3: Run Container

```bash
# Create data directory
mkdir -p ./data/{config,logs,database}

# Copy configuration templates
cp config/config.yaml.example ./data/config/config.yaml
cp config/registration.yaml.example ./data/config/registration.yaml

# Edit configuration files
nano ./data/config/config.yaml
nano ./data/config/registration.yaml

# Run the container
docker run -d \
  --name matrix-googleplay-bridge \
  --restart unless-stopped \
  -p 8080:8080 \
  -p 9090:9090 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/data/config:/app/config \
  matrix-googleplay-bridge:latest
```

### Method 3: Docker Compose (Recommended)

This method provides a complete stack including the bridge, database, and monitoring.

#### Step 1: Prepare Environment

```bash
# Clone the repository
git clone https://github.com/CDLProduction/matrix-googleplay-bridge.git
cd matrix-googleplay-bridge

# Create environment file
cp docker-compose.production.yml docker-compose.yml
cp .env.example .env

# Edit environment variables
nano .env
```

#### Step 2: Configure Environment Variables

Edit the `.env` file with your specific configuration:

```bash
# Matrix Configuration
MATRIX_HOMESERVER_URL=https://matrix.your-domain.com
MATRIX_DOMAIN=your-domain.com
MATRIX_AS_TOKEN=your-unique-as-token-here
MATRIX_HS_TOKEN=your-unique-hs-token-here

# Google Play Configuration
GOOGLE_PLAY_KEY_FILE=/app/config/service-account-key.json
GOOGLE_PLAY_PACKAGE_NAME=com.yourcompany.app
GOOGLE_PLAY_MATRIX_ROOM=!reviews:your-domain.com

# Database Configuration
POSTGRES_DB=matrix_googleplay_bridge
POSTGRES_USER=bridge_user
POSTGRES_PASSWORD=secure_random_password_here

# Security Configuration
BRIDGE_ADMINS=@admin:your-domain.com

# Monitoring Configuration
MONITORING_ENABLED=true
PROMETHEUS_PORT=9090
```

#### Step 3: Deploy with Docker Compose

```bash
# Create necessary directories
mkdir -p ./data/{config,logs,database,prometheus}

# Copy configuration files
cp config/config.yaml.example ./data/config/config.yaml
cp config/registration.yaml.example ./data/config/registration.yaml
cp monitoring/prometheus.yml ./data/prometheus/

# Start the stack
docker-compose up -d

# Check status
docker-compose ps
```

## Post-Installation Setup

### Step 1: Configure the Bridge

1. **Edit Configuration Files**

   Edit `config/config.yaml`:
   ```yaml
   homeserver:
     url: 'https://matrix.your-domain.com'
     domain: 'your-domain.com'

   appservice:
     port: 8080
     bind: '0.0.0.0'
     token: 'your-unique-as-token-here'
     id: 'googleplay-bridge'
     botUsername: 'googleplay'

   googleplay:
     auth:
       keyFile: '/path/to/service-account-key.json'
       scopes: ['https://www.googleapis.com/auth/androidpublisher']
     applications:
       - packageName: 'com.yourcompany.app'
         matrixRoom: '!reviews:your-domain.com'
         appName: 'Your App Name'
   ```

   Edit `config/registration.yaml`:
   ```yaml
   id: googleplay-bridge
   url: 'http://localhost:8080'
   as_token: 'your-unique-as-token-here'
   hs_token: 'your-unique-hs-token-here'
   sender_localpart: googleplay
   namespaces:
     users:
       - exclusive: true
         regex: '@googleplay_.*'
     aliases:
       - exclusive: true
         regex: '#googleplay_.*'
   ```

### Step 2: Set Up Google Play API

Follow the detailed [Google Play API Setup Guide](google-play-api.md) to:
1. Create a Google Cloud Platform project
2. Enable the Android Publisher API
3. Create a service account and download the key file
4. Grant necessary permissions in Google Play Console

### Step 3: Register with Matrix Homeserver

1. **Copy registration file to Synapse**
   ```bash
   sudo cp config/registration.yaml /etc/matrix-synapse/appservices/
   sudo chown matrix-synapse:matrix-synapse /etc/matrix-synapse/appservices/registration.yaml
   ```

2. **Update Synapse configuration**
   
   Edit `/etc/matrix-synapse/homeserver.yaml`:
   ```yaml
   app_service_config_files:
     - /etc/matrix-synapse/appservices/registration.yaml
   ```

3. **Restart Synapse**
   ```bash
   sudo systemctl restart matrix-synapse
   ```

### Step 4: Create systemd Service (Standalone Installation)

Create `/etc/systemd/system/matrix-googleplay-bridge.service`:

```ini
[Unit]
Description=Matrix Google Play Bridge
After=network.target postgresql.service

[Service]
Type=simple
User=matrix-bridge
Group=matrix-bridge
WorkingDirectory=/opt/matrix-googleplay-bridge
ExecStart=/usr/bin/node dist/app.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

# Security settings
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/matrix-googleplay-bridge/data /opt/matrix-googleplay-bridge/logs

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable matrix-googleplay-bridge
sudo systemctl start matrix-googleplay-bridge
```

## Verification

### Step 1: Check Service Status

**Standalone Installation:**
```bash
# Check systemd service
sudo systemctl status matrix-googleplay-bridge

# Check logs
journalctl -u matrix-googleplay-bridge -f
```

**Docker Installation:**
```bash
# Check container status
docker ps | grep matrix-googleplay-bridge

# Check logs
docker logs matrix-googleplay-bridge -f
```

**Docker Compose:**
```bash
# Check all services
docker-compose ps

# Check bridge logs
docker-compose logs bridge -f
```

### Step 2: Verify Health Endpoints

```bash
# Check bridge health
curl http://localhost:9090/health

# Expected response:
# {
#   "status": "healthy",
#   "uptime": 12345,
#   "version": "0.1.0",
#   "components": {
#     "database": "healthy",
#     "googleplay": "healthy",
#     "matrix": "healthy"
#   }
# }

# Check metrics (if enabled)
curl http://localhost:9090/metrics
```

### Step 3: Test Matrix Integration

1. **Create a test room**
   ```
   /createroom #googleplay-test:your-domain.com
   ```

2. **Invite the bridge bot**
   ```
   /invite @googleplay:your-domain.com
   ```

3. **Test bridge commands**
   ```
   !help
   !ping  
   !status
   ```

4. **Expected response from `!help`:**
   ```
   Matrix Google Play Bridge - Administrative Commands
   
   Core Commands:
   • !help - Show this help message
   • !ping - Test bridge connectivity  
   • !status - Display bridge status
   • !stats - Show detailed statistics
   
   [... additional commands listed ...]
   ```

### Step 4: Test Google Play Integration

```bash
# Test Google Play API connectivity
curl -X POST http://localhost:8080/test-googleplay \
  -H "Authorization: Bearer your-hs-token" \
  -H "Content-Type: application/json" \
  -d '{"packageName": "com.yourcompany.app"}'

# Expected response:
# {"status": "success", "message": "Google Play API connection successful"}
```

## Troubleshooting

### Common Issues

1. **Node.js Version Error**
   ```
   Error: Requires Node.js 18.0.0 or higher
   ```
   **Solution:** Update Node.js to version 18 or higher using your package manager or nvm.

2. **Permission Denied Errors**
   ```
   EACCES: permission denied
   ```
   **Solution:** Check file permissions and ensure the bridge user has proper access to configuration files and data directories.

3. **Google Play API Authentication Error**
   ```
   Error: Failed to authenticate with Google Play API
   ```
   **Solution:** Verify service account key file path and permissions. Follow the [Google Play API Setup Guide](google-play-api.md).

4. **Matrix Homeserver Connection Error**
   ```
   Error: Failed to connect to Matrix homeserver
   ```
   **Solution:** Check homeserver URL, tokens, and network connectivity. Verify registration file is properly configured.

5. **Database Connection Error**
   ```
   Error: Unable to connect to database
   ```
   **Solution:** Verify database configuration, credentials, and that the database service is running.

### Log Analysis

**View detailed logs:**
```bash
# Standalone installation
tail -f /opt/matrix-googleplay-bridge/logs/bridge.log

# Docker
docker logs matrix-googleplay-bridge --tail 100 -f

# Docker Compose
docker-compose logs bridge --tail 100 -f
```

**Enable debug logging:**
Edit `config/config.yaml`:
```yaml
logging:
  level: 'debug'
  enableFile: true
```

### Getting Help

If you encounter issues during installation:

1. **Check the [Troubleshooting Guide](../troubleshooting.md)**
2. **Review logs for error messages**
3. **Verify all prerequisites are met**
4. **Test each component individually**
5. **Search existing [GitHub Issues](https://github.com/CDLProduction/matrix-googleplay-bridge/issues)**
6. **Create a new issue with detailed error logs and system information**

## Next Steps

After successful installation:

1. **[Configure the Bridge](configuration.md)** - Detailed configuration guide
2. **[Set up Google Play API](google-play-api.md)** - Google Play Console integration  
3. **[Configure Applications](configuration.md#application-configuration)** - Add your apps to the bridge
4. **[Set up Monitoring](../monitoring.md)** - Production monitoring and alerting
5. **[Review Security Settings](../security.md)** - Security hardening recommendations

## Production Considerations

For production deployments:

1. **Use PostgreSQL** instead of SQLite for better performance and reliability
2. **Set up SSL/TLS** termination with nginx or similar reverse proxy
3. **Configure monitoring** with Prometheus and Grafana
4. **Set up backup procedures** for configuration and database
5. **Implement log rotation** to prevent disk space issues
6. **Configure firewall rules** to restrict network access appropriately
7. **Set up automated updates** with proper testing procedures

---

This completes the installation process. Your Matrix Google Play Bridge should now be ready to handle Google Play reviews and Matrix messages bidirectionally.