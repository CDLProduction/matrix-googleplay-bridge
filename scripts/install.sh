#!/bin/bash
# Matrix Google Play Bridge - Automated Installation Script
# This script automates the installation process for the Matrix Google Play Bridge

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Installation configuration
INSTALL_DIR="/opt/matrix-googleplay-bridge"
SERVICE_USER="matrix-bridge"
CONFIG_DIR="/etc/matrix-googleplay-bridge"
LOG_DIR="/var/log/matrix-googleplay-bridge"
DATA_DIR="/var/lib/matrix-googleplay-bridge"

# System requirements
MIN_NODE_VERSION="18.0.0"
MIN_NPM_VERSION="8.0.0"

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
check_root() {
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

# Detect operating system
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt-get >/dev/null 2>&1; then
            OS="ubuntu"
            PACKAGE_MANAGER="apt-get"
        elif command -v yum >/dev/null 2>&1; then
            OS="centos"
            PACKAGE_MANAGER="yum"
        elif command -v dnf >/dev/null 2>&1; then
            OS="fedora"
            PACKAGE_MANAGER="dnf"
        else
            log_error "Unsupported Linux distribution. Please install manually."
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        if ! command -v brew >/dev/null 2>&1; then
            log_error "Homebrew is required on macOS. Please install it first."
            exit 1
        fi
        PACKAGE_MANAGER="brew"
    else
        log_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
    
    log_info "Detected OS: $OS"
}

# Check system requirements
check_requirements() {
    log_step "Checking system requirements..."
    
    # Check Node.js version
    if command -v node >/dev/null 2>&1; then
        NODE_VERSION=$(node --version | sed 's/v//')
        if ! version_ge "$NODE_VERSION" "$MIN_NODE_VERSION"; then
            log_warning "Node.js version $NODE_VERSION is below minimum required version $MIN_NODE_VERSION"
            INSTALL_NODE=true
        else
            log_success "Node.js version $NODE_VERSION meets requirements"
            INSTALL_NODE=false
        fi
    else
        log_warning "Node.js not found"
        INSTALL_NODE=true
    fi
    
    # Check npm version
    if command -v npm >/dev/null 2>&1; then
        NPM_VERSION=$(npm --version)
        if ! version_ge "$NPM_VERSION" "$MIN_NPM_VERSION"; then
            log_warning "npm version $NPM_VERSION is below minimum required version $MIN_NPM_VERSION"
            INSTALL_NPM=true
        else
            log_success "npm version $NPM_VERSION meets requirements"
            INSTALL_NPM=false
        fi
    else
        log_warning "npm not found"
        INSTALL_NPM=true
    fi
    
    # Check available disk space (minimum 1GB)
    AVAILABLE_SPACE=$(df / | awk 'NR==2 {print $4}')
    if [[ $AVAILABLE_SPACE -lt 1048576 ]]; then
        log_error "Insufficient disk space. At least 1GB free space required."
        exit 1
    fi
    
    # Check memory (minimum 1GB)
    TOTAL_MEMORY=$(free -m | awk 'NR==2{printf "%.0f", $2}')
    if [[ $TOTAL_MEMORY -lt 1024 ]]; then
        log_warning "System has less than 1GB RAM. Performance may be affected."
    fi
}

# Version comparison function
version_ge() {
    [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# Install system dependencies
install_system_dependencies() {
    log_step "Installing system dependencies..."
    
    case $OS in
        ubuntu)
            sudo apt-get update
            sudo apt-get install -y curl wget git build-essential python3 sqlite3 postgresql-client
            
            if [[ $INSTALL_NODE == true ]]; then
                log_info "Installing Node.js $MIN_NODE_VERSION..."
                curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
                sudo apt-get install -y nodejs
            fi
            ;;
        centos|fedora)
            if [[ $OS == "centos" ]]; then
                sudo yum update -y
                sudo yum install -y curl wget git gcc-c++ make python3 sqlite postgresql
            else
                sudo dnf update -y
                sudo dnf install -y curl wget git gcc-c++ make python3 sqlite postgresql
            fi
            
            if [[ $INSTALL_NODE == true ]]; then
                log_info "Installing Node.js $MIN_NODE_VERSION..."
                curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
                if [[ $OS == "centos" ]]; then
                    sudo yum install -y nodejs
                else
                    sudo dnf install -y nodejs
                fi
            fi
            ;;
        macos)
            if [[ $INSTALL_NODE == true ]]; then
                log_info "Installing Node.js $MIN_NODE_VERSION..."
                brew install node@18
                brew link node@18
            fi
            brew install git sqlite3 postgresql
            ;;
    esac
    
    log_success "System dependencies installed"
}

# Create system user and directories
create_user_and_directories() {
    log_step "Creating system user and directories..."
    
    # Create service user
    if ! id "$SERVICE_USER" >/dev/null 2>&1; then
        sudo useradd -r -s /bin/false -d "$INSTALL_DIR" -c "Matrix Google Play Bridge" "$SERVICE_USER"
        log_success "Created user: $SERVICE_USER"
    else
        log_info "User $SERVICE_USER already exists"
    fi
    
    # Create directories
    sudo mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$LOG_DIR" "$DATA_DIR"
    sudo mkdir -p "$DATA_DIR"/{database,backups,tmp}
    
    # Set ownership and permissions
    sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$LOG_DIR" "$DATA_DIR"
    sudo chown -R root:root "$CONFIG_DIR"
    sudo chmod 750 "$INSTALL_DIR" "$LOG_DIR" "$DATA_DIR"
    sudo chmod 755 "$CONFIG_DIR"
    
    log_success "Created directories and set permissions"
}

# Download and install bridge
install_bridge() {
    log_step "Downloading and installing Matrix Google Play Bridge..."
    
    # Clone repository to temporary directory
    TEMP_DIR=$(mktemp -d)
    git clone https://github.com/CDLProduction/matrix-googleplay-bridge.git "$TEMP_DIR"
    
    # Copy files to install directory
    sudo cp -r "$TEMP_DIR"/* "$INSTALL_DIR/"
    sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    # Install npm dependencies
    cd "$INSTALL_DIR"
    sudo -u "$SERVICE_USER" npm ci --only=production
    
    # Build the application
    sudo -u "$SERVICE_USER" npm run build
    
    # Clean up
    rm -rf "$TEMP_DIR"
    
    log_success "Bridge installed successfully"
}

# Install systemd service
install_systemd_service() {
    if [[ $OS != "macos" ]]; then
        log_step "Installing systemd service..."
        
        sudo tee /etc/systemd/system/matrix-googleplay-bridge.service > /dev/null <<EOF
[Unit]
Description=Matrix Google Play Bridge
Documentation=https://github.com/CDLProduction/matrix-googleplay-bridge
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node dist/app.js
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=matrix-googleplay-bridge

# Security settings
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$LOG_DIR $DATA_DIR $CONFIG_DIR
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native

# Environment
Environment=NODE_ENV=production
Environment=CONFIG_PATH=$CONFIG_DIR/config.yaml

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF
        
        sudo systemctl daemon-reload
        sudo systemctl enable matrix-googleplay-bridge
        
        log_success "Systemd service installed and enabled"
    else
        log_info "Skipping systemd service installation on macOS"
    fi
}

# Create configuration files
create_configuration() {
    log_step "Creating configuration files..."
    
    # Copy example configurations
    sudo cp "$INSTALL_DIR/config/config.yaml.example" "$CONFIG_DIR/config.yaml"
    sudo cp "$INSTALL_DIR/config/registration.yaml.example" "$CONFIG_DIR/registration.yaml"
    
    # Set permissions
    sudo chmod 600 "$CONFIG_DIR/config.yaml" "$CONFIG_DIR/registration.yaml"
    sudo chown root:root "$CONFIG_DIR/config.yaml" "$CONFIG_DIR/registration.yaml"
    
    log_success "Configuration files created"
    log_warning "Please edit $CONFIG_DIR/config.yaml and $CONFIG_DIR/registration.yaml before starting the service"
}

# Create log rotation
setup_log_rotation() {
    if [[ $OS != "macos" ]]; then
        log_step "Setting up log rotation..."
        
        sudo tee /etc/logrotate.d/matrix-googleplay-bridge > /dev/null <<EOF
$LOG_DIR/*.log {
    weekly
    rotate 4
    compress
    delaycompress
    missingok
    notifempty
    create 644 $SERVICE_USER $SERVICE_USER
    postrotate
        systemctl reload matrix-googleplay-bridge
    endscript
}
EOF
        
        log_success "Log rotation configured"
    fi
}

# Display installation summary
display_summary() {
    log_success "Matrix Google Play Bridge installation completed!"
    
    echo ""
    echo -e "${CYAN}=== Installation Summary ===${NC}"
    echo -e "${BLUE}Install Directory:${NC} $INSTALL_DIR"
    echo -e "${BLUE}Configuration:${NC} $CONFIG_DIR"
    echo -e "${BLUE}Logs:${NC} $LOG_DIR"
    echo -e "${BLUE}Data:${NC} $DATA_DIR"
    echo -e "${BLUE}Service User:${NC} $SERVICE_USER"
    echo ""
    
    echo -e "${CYAN}=== Next Steps ===${NC}"
    echo -e "${YELLOW}1.${NC} Configure the bridge:"
    echo -e "   sudo nano $CONFIG_DIR/config.yaml"
    echo -e "   sudo nano $CONFIG_DIR/registration.yaml"
    echo ""
    echo -e "${YELLOW}2.${NC} Set up Google Play API credentials:"
    echo -e "   Place your service-account-key.json in $CONFIG_DIR/secrets/"
    echo ""
    echo -e "${YELLOW}3.${NC} Configure Matrix homeserver:"
    echo -e "   Add registration.yaml to your Matrix homeserver configuration"
    echo ""
    if [[ $OS != "macos" ]]; then
        echo -e "${YELLOW}4.${NC} Start the service:"
        echo -e "   sudo systemctl start matrix-googleplay-bridge"
        echo -e "   sudo systemctl status matrix-googleplay-bridge"
        echo ""
        echo -e "${YELLOW}5.${NC} View logs:"
        echo -e "   sudo journalctl -u matrix-googleplay-bridge -f"
    else
        echo -e "${YELLOW}4.${NC} Start the bridge manually:"
        echo -e "   cd $INSTALL_DIR && NODE_ENV=production node dist/app.js"
    fi
    echo ""
    
    echo -e "${CYAN}=== Documentation ===${NC}"
    echo -e "${BLUE}Setup Guide:${NC} $INSTALL_DIR/docs/setup/installation.md"
    echo -e "${BLUE}Configuration:${NC} $INSTALL_DIR/docs/setup/configuration.md"
    echo -e "${BLUE}Troubleshooting:${NC} $INSTALL_DIR/docs/troubleshooting.md"
    echo -e "${BLUE}Docker Setup:${NC} $INSTALL_DIR/DOCKER_README.md"
    echo ""
    
    log_warning "Remember to configure your firewall to allow the bridge port (default: 8080)"
}

# Main installation function
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Matrix Google Play Bridge Installer${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    # Check if running interactively
    if [[ ! -t 0 ]]; then
        log_error "This script must be run interactively"
        exit 1
    fi
    
    # Confirm installation
    echo -e "${YELLOW}This script will install the Matrix Google Play Bridge on your system.${NC}"
    echo -e "${YELLOW}Installation directory: $INSTALL_DIR${NC}"
    echo ""
    read -p "Do you want to continue? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Installation cancelled"
        exit 0
    fi
    
    # Run installation steps
    check_root
    detect_os
    check_requirements
    install_system_dependencies
    create_user_and_directories
    install_bridge
    install_systemd_service
    create_configuration
    setup_log_rotation
    display_summary
}

# Handle script interruption
trap 'echo -e "\n${RED}Installation interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"