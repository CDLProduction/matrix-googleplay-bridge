# Docker Setup Guide for Matrix Google Play Bridge

This guide provides comprehensive instructions for running the Matrix Google Play Bridge using Docker, with support for both development and production environments.

## 🚀 Quick Start

### 🤖 Automated Installation (Recommended)

The fastest way to get started is using our automated installation scripts:

```bash
# Download and run the automated Docker installer
curl -fsSL https://raw.githubusercontent.com/CDLProduction/matrix-googleplay-bridge/main/scripts/docker-install.sh | bash

# Configure the bridge interactively
cd /opt/matrix-googleplay-bridge-docker
./scripts/docker-setup.sh

# Start the bridge
./docker-start.sh
```

### 📋 Manual Installation

If you prefer manual setup:

#### Development Environment

```bash
# Clone the repository
git clone https://github.com/CDLProduction/matrix-googleplay-bridge.git
cd matrix-googleplay-bridge

# Copy environment configuration
cp .env.example .env

# Edit configuration (required)
nano .env

# Start development environment
docker-compose -f docker/docker-compose.yml up -d

# View logs
docker-compose -f docker/docker-compose.yml logs -f bridge
```

#### Production Environment

```bash
# Start production environment
docker-compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d

# View status
docker-compose -f docker/docker-compose.yml ps
```

## 📁 Docker Architecture

### Multi-Stage Dockerfile

Our enhanced Dockerfile implements Context7 best practices with multiple optimized stages:

- **base**: Common setup and user creation
- **deps**: Production dependencies with cache optimization
- **dev-deps**: Development dependencies
- **builder**: TypeScript compilation with build tools
- **test**: Test execution stage (can be targeted separately)
- **development**: Hot-reload development environment
- **production**: Minimal runtime image

### Build Targets

```bash
# Development build
docker build --target development -t bridge:dev .

# Production build
docker build --target production -t bridge:prod .

# Test build
docker build --target test -t bridge:test .
```

## 🔧 Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Required for all environments
MATRIX_HOMESERVER_URL=https://matrix.your-domain.com
MATRIX_DOMAIN=your-domain.com
MATRIX_AS_TOKEN=your-application-service-token
MATRIX_HS_TOKEN=your-homeserver-token
GOOGLE_PLAY_PACKAGE_NAME=com.yourcompany.app

# Database (production)
DB_PASSWORD=your-secure-database-password
DB_NAME=matrix_googleplay_bridge
DB_USER=bridge_user

# Security
BRIDGE_ADMINS=@admin:your-domain.com
```

### Configuration Files

Place your configuration files in the appropriate directories:

```
config/
├── config.yaml              # Main bridge configuration
├── config.yaml.example      # Configuration template
└── registration.yaml        # Matrix AS registration

secrets/
└── service-account-key.json # Google Play API credentials
```

## 🏗️ Service Architecture

### Core Services

- **bridge**: Main Matrix Google Play Bridge application
- **postgres**: PostgreSQL database for persistent storage
- **redis**: Redis cache for performance optimization

### Infrastructure Services

- **nginx**: Reverse proxy and SSL termination for production deployments

### Development Tools

- **adminer**: Database management interface (dev only)
- **redis-commander**: Redis management interface (dev only)

## 🚦 Service Management

### Starting Services

```bash
# Development environment
docker-compose -f docker/docker-compose.yml up -d

# Production environment
docker-compose -f docker/docker-compose.yml -f docker-compose.yml -f docker-compose.prod.yml up -d

# Specific services only
docker-compose -f docker/docker-compose.yml up -d postgres redis bridge
```

### Viewing Logs

```bash
# All services
docker-compose -f docker/docker-compose.yml logs -f

# Specific service
docker-compose -f docker/docker-compose.yml logs -f bridge

# Last 100 lines
docker-compose -f docker/docker-compose.yml logs --tail=100 bridge
```

## 🤖 Docker Automation Scripts

The Matrix Google Play Bridge includes comprehensive automation scripts for Docker-based deployments:

### Installation Scripts

#### `scripts/docker-install.sh` - Automated Docker Installation

Fully automated installation script that:
- Detects your operating system (Ubuntu, CentOS, Fedora, macOS)
- Installs Docker and Docker Compose if needed
- Downloads the bridge source code
- Sets up directory structure
- Creates management scripts
- Builds Docker images
- Tests the installation

```bash
# Run automated installation
curl -fsSL https://raw.githubusercontent.com/CDLProduction/matrix-googleplay-bridge/main/scripts/docker-install.sh | bash

# Or download and run locally
wget https://raw.githubusercontent.com/CDLProduction/matrix-googleplay-bridge/main/scripts/docker-install.sh
chmod +x docker-install.sh
./docker-install.sh
```

#### `scripts/docker-setup.sh` - Interactive Configuration

Interactive setup wizard that:
- Collects Matrix homeserver configuration
- Sets up Google Play API credentials
- Configures database settings
- Generates secure passwords and tokens
- Creates configuration files
- Sets up development/production environments

```bash
cd /opt/matrix-googleplay-bridge-docker
./scripts/docker-setup.sh
```

### Management Scripts

#### `scripts/docker-manage.sh` - Comprehensive Management Tool

Unified management script providing:

```bash
# Service management
./scripts/docker-manage.sh start [service...]      # Start services
./scripts/docker-manage.sh stop [service...]       # Stop services
./scripts/docker-manage.sh restart [service...]    # Restart services
./scripts/docker-manage.sh status                  # Show status and resource usage

# Monitoring and logs
./scripts/docker-manage.sh logs [service] [lines]  # View logs
./scripts/docker-manage.sh follow [service]        # Follow logs in real-time
./scripts/docker-manage.sh health                  # Perform health checks
./scripts/docker-manage.sh monitor                 # Live monitoring dashboard

# Container operations
./scripts/docker-manage.sh exec <service> [cmd]    # Execute commands in containers

# Backup and maintenance
./scripts/docker-manage.sh backup [name]           # Create backups
./scripts/docker-manage.sh list-backups            # List available backups
./scripts/docker-manage.sh update                  # Update to latest version
./scripts/docker-manage.sh cleanup                 # Clean up Docker resources
```

### Generated Management Scripts

The installation process creates convenient wrapper scripts:

#### `docker-start.sh`
```bash
#!/bin/bash
# Quick start script
cd "$(dirname "$0")"
docker compose up -d
echo "Bridge started. Check status with: docker compose ps"
```

#### `docker-stop.sh`
```bash
#!/bin/bash  
# Quick stop script
cd "$(dirname "$0")"
docker compose down
echo "Bridge stopped."
```

#### `docker-logs.sh`
```bash
#!/bin/bash
# Quick logs viewer
cd "$(dirname "$0")"
docker compose logs -f "${1:-bridge}"
```

#### `docker-restart.sh`
```bash
#!/bin/bash
# Quick restart script
cd "$(dirname "$0")"
docker compose restart bridge
echo "Bridge restarted. View logs with: ./docker-logs.sh"
```

#### `docker-update.sh`
```bash
#!/bin/bash
# Quick update script
set -e
cd "$(dirname "$0")"
echo "Stopping bridge..."
docker compose down
echo "Pulling latest code..."
git pull origin main
echo "Rebuilding images..."
docker compose build bridge
echo "Starting bridge..."
docker compose up -d
echo "Update complete. View logs with: ./docker-logs.sh"
```

#### `docker-backup.sh`
```bash
#!/bin/bash
# Quick backup script
set -e
cd "$(dirname "$0")"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"
echo "Creating backup..."
docker compose exec -T postgres pg_dump -U bridge_user matrix_googleplay_bridge > "$BACKUP_DIR/database_$TIMESTAMP.sql"
tar -czf "$BACKUP_DIR/config_$TIMESTAMP.tar.gz" config/ secrets/ .env
echo "Backup created in $BACKUP_DIR/"
```

### Automation Features

- **Automated Installation**: Complete Docker and bridge setup in one command
- **Interactive Configuration**: Guided setup with input validation and secure defaults
- **Service Health Monitoring**: Built-in health checks and monitoring
- **Automated Backups**: Database and configuration backup with manifest files
- **One-Click Updates**: Automated updates with pre-update backups
- **Resource Cleanup**: Automated Docker resource management
- **Live Monitoring**: Real-time service monitoring dashboard
- **Cross-Platform Support**: Ubuntu, CentOS, Fedora, and macOS support

## 🔍 Monitoring and Health Checks

### Built-in Health Endpoints

The bridge provides lightweight monitoring without external dependencies:

```bash
# Health check endpoint
curl http://localhost:9090/health

# Basic metrics endpoint  
curl http://localhost:9090/metrics

# Application statistics
curl http://localhost:9090/stats
```

### Service Health Monitoring

```bash
# Check all services status
docker-compose -f docker/docker-compose.yml ps

# View service logs
docker-compose -f docker/docker-compose.yml logs -f bridge
```

## 🔒 Security Best Practices

### Production Deployment

1. **Use HTTPS**: Configure SSL certificates in nginx configuration
2. **Secure Database**: Use strong passwords and enable SSL connections
3. **Network Security**: Restrict access to monitoring endpoints
4. **Secrets Management**: Never commit secrets to version control
5. **Resource Limits**: Configure appropriate CPU/memory limits

### Access Control

```bash
# Restrict Prometheus metrics access
# Edit nginx/conf.d/bridge.conf to add IP restrictions

# Example:
location /metrics {
    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    allow 192.168.0.0/16;
    deny all;
    proxy_pass http://bridge_monitoring/metrics;
}
```

## 🛠️ Troubleshooting

### Common Issues

1. **Port Conflicts**
   ```bash
   # Check what's using ports
   lsof -i :8080
   lsof -i :9090
   
   # Change ports in .env file
   BRIDGE_PORT=8081
   MONITORING_PORT=9091
   ```

2. **Database Connection Issues**
   ```bash
   # Check database logs
   docker-compose -f docker/docker-compose.yml logs postgres
   
   # Test connection
   docker-compose -f docker/docker-compose.yml exec bridge curl postgres:5432
   ```

3. **Memory Issues**
   ```bash
   # Check resource usage
   docker stats
   
   # Adjust limits in docker-compose.yml or .env
   BRIDGE_MEMORY_LIMIT=1024
   ```

### Debug Mode

```bash
# Run bridge in debug mode
docker-compose -f docker/docker-compose.yml exec bridge npm run dev

# View detailed logs
docker-compose -f docker/docker-compose.yml logs -f bridge | grep -E "(ERROR|WARN|DEBUG)"
```

### Container Access

```bash
# Access bridge container shell
docker-compose -f docker/docker-compose.yml exec bridge sh

# Access database
docker-compose -f docker/docker-compose.yml exec postgres psql -U bridge_user -d matrix_googleplay_bridge

# Access Redis
docker-compose -f docker/docker-compose.yml exec redis redis-cli
```

## 📦 Volume Management

### Data Persistence

Persistent volumes are created for:
- `postgres_data`: Database files
- `redis_data`: Redis persistence
- `bridge_data`: Bridge application data
- `bridge_logs`: Application logs
- `prometheus_data`: Metrics data
- `grafana_data`: Grafana dashboards and settings

### Backup and Restore

```bash
# Backup database
docker-compose -f docker/docker-compose.yml exec postgres pg_dump -U bridge_user matrix_googleplay_bridge > backup.sql

# Restore database
docker-compose -f docker/docker-compose.yml exec -T postgres psql -U bridge_user matrix_googleplay_bridge < backup.sql

# Backup volumes
docker run --rm -v googleplay-bridge_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz -C /data .
```

## 🔄 Updates and Maintenance

### Updating the Bridge

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose -f docker/docker-compose.yml build bridge
docker-compose -f docker/docker-compose.yml up -d bridge

# Check health
curl http://localhost:9090/health
```

### Database Migrations

```bash
# Run migrations
docker-compose -f docker/docker-compose.yml exec bridge npm run migrate

# Check migration status  
docker-compose -f docker/docker-compose.yml exec bridge npm run migrate:status
```

## 📊 Performance Optimization

### Resource Allocation

Adjust resources based on your needs:

```yaml
# In docker-compose.yml
deploy:
  resources:
    limits:
      memory: 1G      # Adjust based on review volume
      cpus: '1.0'     # Adjust based on app count
    reservations:
      memory: 512M
      cpus: '0.5'
```

### Resource Monitoring

```bash
# Real-time resource monitoring
docker stats

# Service-specific monitoring
docker-compose -f docker/docker-compose.yml exec bridge top
docker-compose -f docker/docker-compose.yml exec postgres top
```

## 🆘 Support

For issues with the Docker setup:

1. Check the [Troubleshooting Guide](docs/troubleshooting.md)
2. Review container logs: `docker-compose -f docker/docker-compose.yml logs -f`
3. Verify configuration: `docker-compose -f docker/docker-compose.yml config`
4. Test health endpoints: `curl http://localhost:9090/health`
5. Open an issue with logs and configuration details

---

This Docker setup provides a production-ready, scalable environment for the Matrix Google Play Bridge with essential infrastructure services and lightweight monitoring capabilities.