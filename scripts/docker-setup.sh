#!/bin/bash
# Matrix Google Play Bridge - Docker Configuration Setup Script
# This script helps configure the Docker-based installation

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default paths
INSTALL_DIR="/opt/matrix-googleplay-bridge-docker"
CONFIG_DIR="$INSTALL_DIR/config"
SECRETS_DIR="$INSTALL_DIR/secrets"
ENV_FILE="$INSTALL_DIR/.env"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${PURPLE}[STEP]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    # Check if Docker is available
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed. Please run docker-install.sh first."
        exit 1
    fi
    
    # Check if Docker Compose is available
    if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
        log_error "Docker Compose is not available. Please run docker-install.sh first."
        exit 1
    fi
    
    # Check if bridge is installed
    if [[ ! -d "$INSTALL_DIR" ]] || [[ ! -f "$INSTALL_DIR/docker/docker-compose.yml" ]]; then
        log_error "Matrix Google Play Bridge Docker installation not found."
        log_error "Please run docker-install.sh first."
        exit 1
    fi
    
    # Check if already in install directory
    if [[ "$(pwd)" != "$INSTALL_DIR" ]]; then
        log_info "Changing to installation directory: $INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    
    log_info "Prerequisites check passed"
}

# Generate random secure passwords
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
}

# Generate secure tokens
generate_token() {
    openssl rand -hex 32
}

# Collect Matrix configuration
collect_matrix_config() {
    log_step "Matrix Homeserver Configuration"
    echo ""
    
    # Matrix homeserver URL
    read -p "Enter your Matrix homeserver URL (e.g., https://matrix.example.com): " MATRIX_URL
    if [[ -z "$MATRIX_URL" ]]; then
        log_error "Matrix homeserver URL is required"
        exit 1
    fi
    
    # Matrix domain
    read -p "Enter your Matrix domain (e.g., example.com): " MATRIX_DOMAIN
    if [[ -z "$MATRIX_DOMAIN" ]]; then
        log_error "Matrix domain is required"
        exit 1
    fi
    
    # Generate tokens if not provided
    echo ""
    echo -e "${YELLOW}Matrix Application Service Tokens${NC}"
    echo "You can provide your own tokens or they will be auto-generated."
    echo ""
    
    read -p "Enter Application Service token (leave blank to auto-generate): " AS_TOKEN
    if [[ -z "$AS_TOKEN" ]]; then
        AS_TOKEN=$(generate_token)
        log_info "Generated Application Service token: $AS_TOKEN"
    fi
    
    read -p "Enter Homeserver token (leave blank to auto-generate): " HS_TOKEN
    if [[ -z "$HS_TOKEN" ]]; then
        HS_TOKEN=$(generate_token)
        log_info "Generated Homeserver token: $HS_TOKEN"
    fi
    
    # Bridge port
    read -p "Enter bridge port (default: 8080): " BRIDGE_PORT
    BRIDGE_PORT=${BRIDGE_PORT:-8080}
    
    # Bridge admins
    read -p "Enter bridge admin Matrix ID (e.g., @admin:example.com): " BRIDGE_ADMIN
    if [[ -z "$BRIDGE_ADMIN" ]]; then
        log_warning "No bridge admin specified. Using default."
        BRIDGE_ADMIN="@admin:$MATRIX_DOMAIN"
    fi
}

# Collect Google Play configuration
collect_google_play_config() {
    log_step "Google Play Console Configuration"
    echo ""
    
    # Package name
    read -p "Enter your app's package name (e.g., com.example.app): " PACKAGE_NAME
    if [[ -z "$PACKAGE_NAME" ]]; then
        log_error "Package name is required"
        exit 1
    fi
    
    # Service account key
    echo ""
    echo -e "${YELLOW}Google Play Service Account Setup${NC}"
    echo "You need a service account JSON key file for Google Play API access."
    echo "Please follow the guide at: docs/setup/google-play-api.md"
    echo ""
    
    read -p "Enter path to your service account JSON key file: " SERVICE_ACCOUNT_PATH
    if [[ ! -f "$SERVICE_ACCOUNT_PATH" ]]; then
        log_warning "Service account key file not found: $SERVICE_ACCOUNT_PATH"
        log_warning "You can continue setup and add this file later to: $SECRETS_DIR/service-account-key.json"
        SERVICE_ACCOUNT_PATH=""
    fi
}

# Collect database configuration
collect_database_config() {
    log_step "Database Configuration"
    echo ""
    
    echo "The Docker setup uses PostgreSQL by default."
    echo "Database credentials will be auto-generated for security."
    echo ""
    
    # Generate database credentials
    DB_PASSWORD=$(generate_password)
    DB_NAME="matrix_googleplay_bridge"
    DB_USER="bridge_user"
    
    log_info "Database configuration:"
    log_info "  Database Name: $DB_NAME"
    log_info "  Database User: $DB_USER"
    log_info "  Database Password: [auto-generated]"
}

# Collect additional configuration
collect_additional_config() {
    log_step "Additional Configuration"
    echo ""
    
    # Environment
    read -p "Select environment (development/production) [development]: " NODE_ENV
    NODE_ENV=${NODE_ENV:-development}
    
    # Log level
    read -p "Select log level (debug/info/warn/error) [info]: " LOG_LEVEL
    LOG_LEVEL=${LOG_LEVEL:-info}
    
    # Enable development tools
    if [[ "$NODE_ENV" == "development" ]]; then
        ENABLE_DEV_TOOLS="true"
        log_info "Development tools (Adminer, Redis Commander) will be enabled"
    else
        ENABLE_DEV_TOOLS="false"
        log_info "Development tools will be disabled for production"
    fi
    
    # Redis password
    REDIS_PASSWORD=$(generate_password)
    
    # Compose project name
    read -p "Enter Docker Compose project name [googleplay-bridge]: " COMPOSE_PROJECT_NAME
    COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-googleplay-bridge}
}

# Update environment file
update_environment_file() {
    log_step "Updating environment configuration..."
    
    # Backup existing .env file
    if [[ -f "$ENV_FILE" ]]; then
        cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%s)"
        log_info "Backed up existing .env file"
    fi
    
    # Create new .env file
    cat > "$ENV_FILE" <<EOF
# Matrix Google Play Bridge Docker Configuration
# Generated by docker-setup.sh on $(date)

# =====================================================
# Environment Configuration
# =====================================================
NODE_ENV=$NODE_ENV
LOG_LEVEL=$LOG_LEVEL
BUILD_TARGET=${NODE_ENV}

# =====================================================
# Docker Compose Configuration
# =====================================================
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME

# =====================================================
# Matrix Configuration
# =====================================================
MATRIX_HOMESERVER_URL=$MATRIX_URL
MATRIX_DOMAIN=$MATRIX_DOMAIN
MATRIX_AS_TOKEN=$AS_TOKEN
MATRIX_HS_TOKEN=$HS_TOKEN

# =====================================================
# Bridge Configuration
# =====================================================
BRIDGE_PORT=$BRIDGE_PORT
MONITORING_PORT=9090
BRIDGE_ADMINS=$BRIDGE_ADMIN

# =====================================================
# Google Play Configuration
# =====================================================
GOOGLE_PLAY_PACKAGE_NAME=$PACKAGE_NAME
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/service-account-key.json

# =====================================================
# Database Configuration
# =====================================================
DB_HOST=postgres
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_SSL=false

# =====================================================
# Redis Configuration
# =====================================================
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$REDIS_PASSWORD

# =====================================================
# Port Configuration
# =====================================================
DB_HOST_PORT=5432
REDIS_HOST_PORT=6379
HTTP_PORT=80
HTTPS_PORT=443

# Development Tools (only used in development)
ADMINER_PORT=8081
REDIS_COMMANDER_PORT=8082
REDIS_COMMANDER_USER=admin
REDIS_COMMANDER_PASSWORD=admin

# =====================================================
# Resource Limits
# =====================================================
BRIDGE_MEMORY_LIMIT=512M
DB_MEMORY_LIMIT=256M
REDIS_MEMORY_LIMIT=128M

# =====================================================
# Health Check Configuration
# =====================================================
HEALTH_CHECK_INTERVAL=30s
HEALTH_CHECK_TIMEOUT=10s
HEALTH_CHECK_RETRIES=3

# =====================================================
# Monitoring Configuration
# =====================================================
ENABLE_METRICS=true
MONITORING_ENABLED=true
EOF
    
    log_success "Environment file updated: $ENV_FILE"
}

# Create configuration files
create_config_files() {
    log_step "Creating configuration files..."
    
    # Ensure config directory exists
    mkdir -p "$CONFIG_DIR"
    
    # Create main configuration file
    cat > "$CONFIG_DIR/config.yaml" <<EOF
# Matrix Google Play Bridge Configuration
# Generated by docker-setup.sh on $(date)

# Matrix homeserver configuration
matrix:
  homeserverUrl: '$MATRIX_URL'
  domain: '$MATRIX_DOMAIN'
  
# Application service configuration  
appservice:
  address: 'http://localhost'
  port: $BRIDGE_PORT
  botUsername: '_googleplay_bot'
  
# Google Play Console configuration
googlePlay:
  packageName: '$PACKAGE_NAME'
  serviceAccountKeyPath: '/app/secrets/service-account-key.json'
  
# Database configuration
database:
  type: postgresql
  host: 'postgres'
  port: 5432
  database: '$DB_NAME'
  username: '$DB_USER'
  password: '$DB_PASSWORD'
  ssl: false

# Bridge configuration
bridge:
  admins:
    - '$BRIDGE_ADMIN'
  displayName: 'Google Play Bridge'
  commandPrefix: '!'
  
# Logging configuration
logging:
  level: '$LOG_LEVEL'
  maxFiles: 10
  maxSize: '10m'
  
# Feature configuration
features:
  categorization:
    enabled: true
  responseSuggestions:
    enabled: true
  messageTemplating:
    enabled: true
  messageThreading:
    enabled: true
    
# Monitoring configuration
monitoring:
  enabled: true
  port: 9090
  healthCheck:
    enabled: true
    interval: 30000
    
# Security configuration
security:
  auditLogging:
    enabled: true
  rateLimiting:
    enabled: true
    requests: 100
    window: 3600000
EOF
    
    # Create Matrix registration file
    cat > "$CONFIG_DIR/registration.yaml" <<EOF
# Matrix Application Service Registration
# Generated by docker-setup.sh on $(date)

id: matrix-googleplay-bridge
url: http://bridge:$BRIDGE_PORT
as_token: '$AS_TOKEN'
hs_token: '$HS_TOKEN'
sender_localpart: _googleplay_bot

namespaces:
  users:
    - exclusive: true
      regex: '@_googleplay_.*'
  aliases:
    - exclusive: true
      regex: '#_googleplay_.*'
  rooms: []

rate_limited: false
protocols:
  - googleplay

# MSC2409 support for ephemeral events
de.sorunome.msc2409.push_ephemeral: true
EOF
    
    log_success "Configuration files created in: $CONFIG_DIR"
}

# Copy service account key
copy_service_account_key() {
    if [[ -n "$SERVICE_ACCOUNT_PATH" && -f "$SERVICE_ACCOUNT_PATH" ]]; then
        log_step "Copying service account key..."
        
        # Ensure secrets directory exists
        mkdir -p "$SECRETS_DIR"
        chmod 700 "$SECRETS_DIR"
        
        cp "$SERVICE_ACCOUNT_PATH" "$SECRETS_DIR/service-account-key.json"
        chmod 600 "$SECRETS_DIR/service-account-key.json"
        
        log_success "Service account key copied to: $SECRETS_DIR/service-account-key.json"
    else
        log_warning "Service account key not provided."
        log_warning "Please copy it manually to: $SECRETS_DIR/service-account-key.json"
        
        # Ensure secrets directory exists for future use
        mkdir -p "$SECRETS_DIR"
        chmod 700 "$SECRETS_DIR"
    fi
}

# Create Docker Compose override for development
create_compose_override() {
    if [[ "$NODE_ENV" == "development" ]]; then
        log_step "Creating development Docker Compose override..."
        
        cat > "$INSTALL_DIR/docker-compose.override.yml" <<EOF
# Development overrides for Matrix Google Play Bridge
version: '3.8'

services:
  # Enable development tools
  adminer:
    profiles:
      - dev

  redis-commander:
    profiles:
      - dev

  # Development-specific bridge configuration
  bridge:
    environment:
      NODE_ENV: development
    volumes:
      # Enable hot reload for development
      - ./src:/app/src:ro
    profiles:
      - ""  # Always enabled
EOF
        
        log_success "Development override created: docker-compose.override.yml"
    else
        # Remove override file if it exists
        if [[ -f "$INSTALL_DIR/docker-compose.override.yml" ]]; then
            rm "$INSTALL_DIR/docker-compose.override.yml"
            log_info "Removed development override for production setup"
        fi
    fi
}

# Test configuration
test_configuration() {
    log_step "Testing configuration..."
    
    # Validate Docker Compose configuration
    if docker compose config >/dev/null 2>&1; then
        log_success "Docker Compose configuration is valid"
    else
        log_error "Docker Compose configuration validation failed"
        exit 1
    fi
    
    # Check if required files exist
    local config_valid=true
    
    if [[ ! -f "$ENV_FILE" ]]; then
        log_error "Environment file not found: $ENV_FILE"
        config_valid=false
    fi
    
    if [[ ! -f "$CONFIG_DIR/config.yaml" ]]; then
        log_error "Configuration file not found: $CONFIG_DIR/config.yaml"
        config_valid=false
    fi
    
    if [[ ! -f "$CONFIG_DIR/registration.yaml" ]]; then
        log_error "Registration file not found: $CONFIG_DIR/registration.yaml"
        config_valid=false
    fi
    
    if [[ "$config_valid" == true ]]; then
        log_success "Configuration validation passed"
    else
        log_error "Configuration validation failed"
        exit 1
    fi
}

# Display setup summary
display_setup_summary() {
    log_success "Docker setup completed successfully!"
    
    echo ""
    echo -e "${CYAN}=== Configuration Summary ===${NC}"
    echo -e "${BLUE}Environment:${NC} $NODE_ENV"
    echo -e "${BLUE}Matrix Homeserver:${NC} $MATRIX_URL"
    echo -e "${BLUE}Matrix Domain:${NC} $MATRIX_DOMAIN"
    echo -e "${BLUE}Bridge Port:${NC} $BRIDGE_PORT"
    echo -e "${BLUE}Package Name:${NC} $PACKAGE_NAME"
    echo -e "${BLUE}Bridge Admin:${NC} $BRIDGE_ADMIN"
    echo -e "${BLUE}Compose Project:${NC} $COMPOSE_PROJECT_NAME"
    echo ""
    
    echo -e "${CYAN}=== Configuration Files ===${NC}"
    echo -e "${BLUE}Environment:${NC} $ENV_FILE"
    echo -e "${BLUE}Bridge Config:${NC} $CONFIG_DIR/config.yaml"
    echo -e "${BLUE}Matrix Registration:${NC} $CONFIG_DIR/registration.yaml"
    echo -e "${BLUE}Service Account Key:${NC} $SECRETS_DIR/service-account-key.json"
    echo ""
    
    echo -e "${CYAN}=== Next Steps ===${NC}"
    echo -e "${YELLOW}1.${NC} Add registration to your Matrix homeserver:"
    echo -e "   Copy $CONFIG_DIR/registration.yaml"
    echo -e "   Add to your homeserver's app_service_config_files"
    echo -e "   Restart your Matrix homeserver"
    echo ""
    
    if [[ -z "$SERVICE_ACCOUNT_PATH" ]]; then
        echo -e "${YELLOW}2.${NC} Add Google Play service account key:"
        echo -e "   Copy your service-account-key.json to $SECRETS_DIR/"
        echo ""
    fi
    
    echo -e "${YELLOW}3.${NC} Start the bridge:"
    echo -e "   ./docker-start.sh"
    echo -e "   # or: docker compose up -d"
    echo ""
    
    echo -e "${YELLOW}4.${NC} Check service status:"
    echo -e "   docker compose ps"
    echo -e "   ./docker-logs.sh"
    echo ""
    
    echo -e "${YELLOW}5.${NC} Access management interfaces:"
    echo -e "   Bridge Health: http://localhost:9090/health"
    if [[ "$NODE_ENV" == "development" ]]; then
        echo -e "   Database Admin: http://localhost:8081"
        echo -e "   Redis Commander: http://localhost:8082"
    fi
    echo ""
    
    echo -e "${CYAN}=== Quick Start Commands ===${NC}"
    echo -e "${BLUE}Start Bridge:${NC} ./docker-start.sh"
    echo -e "${BLUE}Stop Bridge:${NC} ./docker-stop.sh"
    echo -e "${BLUE}View Logs:${NC} ./docker-logs.sh"
    echo -e "${BLUE}Restart:${NC} ./docker-restart.sh"
    echo -e "${BLUE}Update:${NC} ./docker-update.sh"
    echo -e "${BLUE}Backup:${NC} ./docker-backup.sh"
    echo ""
    
    log_warning "Remember to restart your Matrix homeserver after adding the registration file!"
}

# Main setup function
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Matrix Google Play Bridge Docker Setup${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    echo -e "${YELLOW}This script will configure the Matrix Google Play Bridge Docker installation.${NC}"
    echo -e "${YELLOW}Make sure you have already run docker-install.sh.${NC}"
    echo ""
    
    read -p "Do you want to continue with the setup? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Setup cancelled"
        exit 0
    fi
    
    # Run setup steps
    check_prerequisites
    collect_matrix_config
    collect_google_play_config
    collect_database_config
    collect_additional_config
    update_environment_file
    create_config_files
    copy_service_account_key
    create_compose_override
    test_configuration
    display_setup_summary
}

# Handle script interruption
trap 'echo -e "\n${RED}Setup interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"