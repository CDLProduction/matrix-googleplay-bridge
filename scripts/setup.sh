#!/bin/bash
# Matrix Google Play Bridge - Initial Configuration Setup Script
# This script helps users configure the bridge after installation

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration paths
CONFIG_DIR="/etc/matrix-googleplay-bridge"
INSTALL_DIR="/opt/matrix-googleplay-bridge"
SECRETS_DIR="$CONFIG_DIR/secrets"

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

# Check if running as root
check_permissions() {
    if [[ $EUID -eq 0 ]]; then
        log_error "This script should not be run as root. Please run as a regular user with sudo privileges."
        exit 1
    fi
    
    # Check if user has sudo privileges
    if ! sudo -n true 2>/dev/null; then
        log_error "This script requires sudo privileges. Please ensure you can run sudo commands."
        exit 1
    fi
}

# Check if bridge is installed
check_installation() {
    if [[ ! -d "$INSTALL_DIR" ]]; then
        log_error "Matrix Google Play Bridge is not installed. Please run install.sh first."
        exit 1
    fi
    
    if [[ ! -d "$CONFIG_DIR" ]]; then
        log_error "Configuration directory not found. Installation may be incomplete."
        exit 1
    fi
    
    log_info "Bridge installation found at $INSTALL_DIR"
}

# Interactive configuration collection
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
    echo "You can generate these tokens or they can be auto-generated."
    echo ""
    
    read -p "Enter Application Service token (leave blank to auto-generate): " AS_TOKEN
    if [[ -z "$AS_TOKEN" ]]; then
        AS_TOKEN=$(openssl rand -hex 32)
        log_info "Generated Application Service token: $AS_TOKEN"
    fi
    
    read -p "Enter Homeserver token (leave blank to auto-generate): " HS_TOKEN
    if [[ -z "$HS_TOKEN" ]]; then
        HS_TOKEN=$(openssl rand -hex 32)
        log_info "Generated Homeserver token: $HS_TOKEN"
    fi
    
    # Bridge port
    read -p "Enter bridge port (default: 8080): " BRIDGE_PORT
    BRIDGE_PORT=${BRIDGE_PORT:-8080}
    
    # Bridge admins
    read -p "Enter bridge admin Matrix ID (e.g., @admin:example.com): " BRIDGE_ADMIN
    if [[ -z "$BRIDGE_ADMIN" ]]; then
        log_warning "No bridge admin specified. You can add this later in the configuration."
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
    echo "Please follow the guide at: $INSTALL_DIR/docs/setup/google-play-api.md"
    echo ""
    
    read -p "Enter path to your service account JSON key file: " SERVICE_ACCOUNT_PATH
    if [[ ! -f "$SERVICE_ACCOUNT_PATH" ]]; then
        log_error "Service account key file not found: $SERVICE_ACCOUNT_PATH"
        log_warning "You can continue setup and add this file later to: $SECRETS_DIR/service-account-key.json"
        SERVICE_ACCOUNT_PATH=""
    fi
}

# Collect database configuration
collect_database_config() {
    log_step "Database Configuration"
    echo ""
    
    echo "Choose database type:"
    echo "1) SQLite (recommended for small deployments)"
    echo "2) PostgreSQL (recommended for production)"
    echo ""
    
    read -p "Enter your choice (1 or 2): " DB_CHOICE
    
    case $DB_CHOICE in
        1)
            DB_TYPE="sqlite"
            DB_FILE="$INSTALL_DIR/data/bridge.db"
            log_info "Using SQLite database: $DB_FILE"
            ;;
        2)
            DB_TYPE="postgresql"
            read -p "PostgreSQL host (default: localhost): " DB_HOST
            DB_HOST=${DB_HOST:-localhost}
            
            read -p "PostgreSQL port (default: 5432): " DB_PORT
            DB_PORT=${DB_PORT:-5432}
            
            read -p "Database name (default: matrix_googleplay_bridge): " DB_NAME
            DB_NAME=${DB_NAME:-matrix_googleplay_bridge}
            
            read -p "Database user (default: bridge_user): " DB_USER
            DB_USER=${DB_USER:-bridge_user}
            
            read -s -p "Database password: " DB_PASSWORD
            echo ""
            
            if [[ -z "$DB_PASSWORD" ]]; then
                log_error "Database password is required for PostgreSQL"
                exit 1
            fi
            
            log_info "Using PostgreSQL database: $DB_HOST:$DB_PORT/$DB_NAME"
            ;;
        *)
            log_error "Invalid choice. Please select 1 or 2."
            exit 1
            ;;
    esac
}

# Create secrets directory
create_secrets_directory() {
    log_step "Creating secrets directory..."
    
    sudo mkdir -p "$SECRETS_DIR"
    sudo chmod 700 "$SECRETS_DIR"
    sudo chown root:root "$SECRETS_DIR"
    
    log_success "Secrets directory created at $SECRETS_DIR"
}

# Copy service account key
copy_service_account_key() {
    if [[ -n "$SERVICE_ACCOUNT_PATH" && -f "$SERVICE_ACCOUNT_PATH" ]]; then
        log_step "Copying service account key..."
        sudo cp "$SERVICE_ACCOUNT_PATH" "$SECRETS_DIR/service-account-key.json"
        sudo chmod 600 "$SECRETS_DIR/service-account-key.json"
        sudo chown root:root "$SECRETS_DIR/service-account-key.json"
        log_success "Service account key copied to $SECRETS_DIR/service-account-key.json"
    else
        log_warning "Service account key not provided. Please copy it manually to: $SECRETS_DIR/service-account-key.json"
    fi
}

# Generate main configuration file
generate_config_file() {
    log_step "Generating main configuration file..."
    
    # Create database configuration based on type
    if [[ "$DB_TYPE" == "sqlite" ]]; then
        DB_CONFIG="  type: sqlite
  path: '$DB_FILE'"
    else
        DB_CONFIG="  type: postgresql
  host: '$DB_HOST'
  port: $DB_PORT
  database: '$DB_NAME'
  username: '$DB_USER'
  password: '$DB_PASSWORD'
  ssl: false"
    fi
    
    # Generate config.yaml
    sudo tee "$CONFIG_DIR/config.yaml" > /dev/null <<EOF
# Matrix Google Play Bridge Configuration
# Generated by setup script on $(date)

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
  serviceAccountKeyPath: '$SECRETS_DIR/service-account-key.json'
  
# Database configuration
database:
$DB_CONFIG

# Bridge configuration
bridge:
  admins:
    - '$BRIDGE_ADMIN'
  displayName: 'Google Play Bridge'
  commandPrefix: '!'
  
# Logging configuration
logging:
  level: 'info'
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
    
    sudo chmod 600 "$CONFIG_DIR/config.yaml"
    sudo chown root:root "$CONFIG_DIR/config.yaml"
    
    log_success "Configuration file generated at $CONFIG_DIR/config.yaml"
}

# Generate Matrix registration file
generate_registration_file() {
    log_step "Generating Matrix registration file..."
    
    sudo tee "$CONFIG_DIR/registration.yaml" > /dev/null <<EOF
# Matrix Application Service Registration
# Generated by setup script on $(date)

id: matrix-googleplay-bridge
url: http://localhost:$BRIDGE_PORT
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
    
    sudo chmod 600 "$CONFIG_DIR/registration.yaml"
    sudo chown root:root "$CONFIG_DIR/registration.yaml"
    
    log_success "Registration file generated at $CONFIG_DIR/registration.yaml"
}

# Create data directories
create_data_directories() {
    log_step "Creating data directories..."
    
    if [[ "$DB_TYPE" == "sqlite" ]]; then
        sudo mkdir -p "$(dirname "$DB_FILE")"
        sudo chown matrix-bridge:matrix-bridge "$(dirname "$DB_FILE")"
    fi
    
    # Create log directory
    sudo mkdir -p "/var/log/matrix-googleplay-bridge"
    sudo chown matrix-bridge:matrix-bridge "/var/log/matrix-googleplay-bridge"
    
    log_success "Data directories created"
}

# Test database connection
test_database_connection() {
    if [[ "$DB_TYPE" == "postgresql" ]]; then
        log_step "Testing database connection..."
        
        export PGPASSWORD="$DB_PASSWORD"
        if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c '\q' 2>/dev/null; then
            log_success "Database connection successful"
        else
            log_warning "Could not connect to database. Please verify your database configuration."
            log_info "You can test the connection manually with:"
            log_info "psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
        fi
        unset PGPASSWORD
    fi
}

# Display setup summary
display_setup_summary() {
    log_success "Bridge configuration completed successfully!"
    
    echo ""
    echo -e "${CYAN}=== Configuration Summary ===${NC}"
    echo -e "${BLUE}Matrix Homeserver:${NC} $MATRIX_URL"
    echo -e "${BLUE}Matrix Domain:${NC} $MATRIX_DOMAIN"
    echo -e "${BLUE}Bridge Port:${NC} $BRIDGE_PORT"
    echo -e "${BLUE}Package Name:${NC} $PACKAGE_NAME"
    echo -e "${BLUE}Database Type:${NC} $DB_TYPE"
    echo -e "${BLUE}Bridge Admin:${NC} $BRIDGE_ADMIN"
    echo ""
    
    echo -e "${CYAN}=== Next Steps ===${NC}"
    echo -e "${YELLOW}1.${NC} Add registration to your Matrix homeserver:"
    echo -e "   Copy $CONFIG_DIR/registration.yaml"
    echo -e "   Add it to your homeserver's app_service_config_files configuration"
    echo -e "   Restart your Matrix homeserver"
    echo ""
    
    if [[ -z "$SERVICE_ACCOUNT_PATH" ]]; then
        echo -e "${YELLOW}2.${NC} Add Google Play service account key:"
        echo -e "   Copy your service-account-key.json to $SECRETS_DIR/"
        echo -e "   Set permissions: sudo chmod 600 $SECRETS_DIR/service-account-key.json"
        echo ""
    fi
    
    echo -e "${YELLOW}3.${NC} Start the bridge service:"
    echo -e "   sudo systemctl start matrix-googleplay-bridge"
    echo -e "   sudo systemctl enable matrix-googleplay-bridge"
    echo ""
    
    echo -e "${YELLOW}4.${NC} Check service status:"
    echo -e "   sudo systemctl status matrix-googleplay-bridge"
    echo -e "   sudo journalctl -u matrix-googleplay-bridge -f"
    echo ""
    
    echo -e "${YELLOW}5.${NC} Test the bridge:"
    echo -e "   Send a message to the bridge bot: @_googleplay_bot:$MATRIX_DOMAIN"
    echo -e "   Use the !help command to see available commands"
    echo ""
    
    echo -e "${CYAN}=== Configuration Files ===${NC}"
    echo -e "${BLUE}Main Config:${NC} $CONFIG_DIR/config.yaml"
    echo -e "${BLUE}Registration:${NC} $CONFIG_DIR/registration.yaml"
    echo -e "${BLUE}Service Account:${NC} $SECRETS_DIR/service-account-key.json"
    echo ""
    
    echo -e "${CYAN}=== Documentation ===${NC}"
    echo -e "${BLUE}Installation Guide:${NC} $INSTALL_DIR/docs/setup/installation.md"
    echo -e "${BLUE}Configuration Guide:${NC} $INSTALL_DIR/docs/setup/configuration.md"
    echo -e "${BLUE}Troubleshooting:${NC} $INSTALL_DIR/docs/troubleshooting.md"
    echo ""
    
    log_warning "Remember to restart your Matrix homeserver after adding the registration file!"
}

# Main setup function
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Matrix Google Play Bridge Setup${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    echo -e "${YELLOW}This script will help you configure the Matrix Google Play Bridge.${NC}"
    echo -e "${YELLOW}Make sure you have already run the install.sh script.${NC}"
    echo ""
    
    read -p "Do you want to continue with the setup? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Setup cancelled"
        exit 0
    fi
    
    # Run setup steps
    check_permissions
    check_installation
    collect_matrix_config
    collect_google_play_config
    collect_database_config
    create_secrets_directory
    copy_service_account_key
    generate_config_file
    generate_registration_file
    create_data_directories
    test_database_connection
    display_setup_summary
}

# Handle script interruption
trap 'echo -e "\n${RED}Setup interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"