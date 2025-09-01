#!/bin/bash
# Matrix Google Play Bridge - Docker Installation Script
# This script automates the Docker-based installation of the bridge

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
INSTALL_DIR="/opt/matrix-googleplay-bridge-docker"
CONFIG_DIR="$INSTALL_DIR/config"
SECRETS_DIR="$INSTALL_DIR/secrets"
DATA_DIR="$INSTALL_DIR/data"
COMPOSE_PROJECT_NAME="googleplay-bridge"

# Docker requirements
MIN_DOCKER_VERSION="20.10.0"
MIN_COMPOSE_VERSION="2.0.0"

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
        log_error "This script should not be run as root. Please run as a regular user with docker privileges."
        exit 1
    fi
    
    # Check if user can run docker commands
    if ! docker info >/dev/null 2>&1; then
        log_error "Unable to connect to Docker daemon. Please ensure Docker is running and you have docker privileges."
        log_info "You may need to add your user to the docker group: sudo usermod -aG docker $USER"
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
            log_error "Unsupported Linux distribution. Please install Docker manually."
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        PACKAGE_MANAGER="brew"
    else
        log_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
    
    log_info "Detected OS: $OS"
}

# Version comparison function
version_ge() {
    [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# Check Docker installation
check_docker() {
    log_step "Checking Docker installation..."
    
    if command -v docker >/dev/null 2>&1; then
        DOCKER_VERSION=$(docker --version | sed 's/Docker version //g' | sed 's/,.*//')
        if version_ge "$DOCKER_VERSION" "$MIN_DOCKER_VERSION"; then
            log_success "Docker version $DOCKER_VERSION meets requirements"
            INSTALL_DOCKER=false
        else
            log_warning "Docker version $DOCKER_VERSION is below minimum required version $MIN_DOCKER_VERSION"
            INSTALL_DOCKER=true
        fi
    else
        log_warning "Docker not found"
        INSTALL_DOCKER=true
    fi
    
    # Check Docker Compose
    if command -v docker-compose >/dev/null 2>&1; then
        COMPOSE_VERSION=$(docker-compose --version | sed 's/.*version //g' | sed 's/,.*//' | sed 's/v//')
        if version_ge "$COMPOSE_VERSION" "$MIN_COMPOSE_VERSION"; then
            log_success "Docker Compose version $COMPOSE_VERSION meets requirements"
            INSTALL_COMPOSE=false
        else
            log_warning "Docker Compose version $COMPOSE_VERSION is below minimum required version $MIN_COMPOSE_VERSION"
            INSTALL_COMPOSE=true
        fi
    elif docker compose version >/dev/null 2>&1; then
        COMPOSE_VERSION=$(docker compose version --short)
        if version_ge "$COMPOSE_VERSION" "$MIN_COMPOSE_VERSION"; then
            log_success "Docker Compose (plugin) version $COMPOSE_VERSION meets requirements"
            INSTALL_COMPOSE=false
        else
            log_warning "Docker Compose (plugin) version $COMPOSE_VERSION is below minimum required version"
            INSTALL_COMPOSE=true
        fi
    else
        log_warning "Docker Compose not found"
        INSTALL_COMPOSE=true
    fi
}

# Install Docker
install_docker() {
    if [[ $INSTALL_DOCKER == true ]]; then
        log_step "Installing Docker..."
        
        case $OS in
            ubuntu)
                # Install Docker using official repository
                curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
                echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
                sudo apt-get update
                sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
                ;;
            centos|fedora)
                if [[ $OS == "centos" ]]; then
                    sudo yum install -y yum-utils
                    sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
                    sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
                else
                    sudo dnf -y install dnf-plugins-core
                    sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
                    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
                fi
                
                # Start and enable Docker
                sudo systemctl start docker
                sudo systemctl enable docker
                ;;
            macos)
                log_warning "Please install Docker Desktop for Mac from https://www.docker.com/products/docker-desktop/"
                log_warning "After installation, restart this script."
                exit 1
                ;;
        esac
        
        # Add user to docker group (Linux only)
        if [[ "$OS" != "macos" ]]; then
            sudo usermod -aG docker "$USER"
            log_warning "You have been added to the docker group. Please log out and back in for changes to take effect."
            log_warning "Alternatively, run: newgrp docker"
        fi
        
        log_success "Docker installed successfully"
    fi
    
    if [[ $INSTALL_COMPOSE == true ]] && [[ "$OS" != "macos" ]]; then
        # Docker Compose plugin should be installed with Docker CE
        log_success "Docker Compose plugin installed with Docker CE"
    fi
}

# Create installation directories
create_directories() {
    log_step "Creating installation directories..."
    
    # Create main installation directory
    if [[ ! -d "$INSTALL_DIR" ]]; then
        mkdir -p "$INSTALL_DIR"
        log_success "Created directory: $INSTALL_DIR"
    fi
    
    # Create subdirectories
    mkdir -p "$CONFIG_DIR" "$SECRETS_DIR" "$DATA_DIR"
    mkdir -p "$DATA_DIR"/{postgres,redis,bridge-data,bridge-logs}
    
    # Set appropriate permissions
    chmod 700 "$SECRETS_DIR"
    chmod 755 "$CONFIG_DIR" "$DATA_DIR"
    
    log_success "Created directories and set permissions"
}

# Download bridge source code
download_bridge() {
    log_step "Downloading Matrix Google Play Bridge..."
    
    # Clone repository to installation directory
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log_info "Repository already exists, updating..."
        cd "$INSTALL_DIR"
        git pull origin main
    else
        # Remove any existing files and clone fresh
        if [[ -d "$INSTALL_DIR" ]] && [[ "$(ls -A "$INSTALL_DIR" 2>/dev/null | wc -l)" -gt 0 ]]; then
            log_warning "Installation directory is not empty. Backing up existing files..."
            mv "$INSTALL_DIR" "${INSTALL_DIR}.backup.$(date +%s)"
            mkdir -p "$INSTALL_DIR"
        fi
        
        git clone https://github.com/CDLProduction/matrix-googleplay-bridge.git "$INSTALL_DIR"
    fi
    
    cd "$INSTALL_DIR"
    log_success "Bridge source code downloaded to: $INSTALL_DIR"
}

# Create environment configuration
create_environment_config() {
    log_step "Creating environment configuration..."
    
    # Copy example environment file if it doesn't exist
    if [[ ! -f "$INSTALL_DIR/.env" ]]; then
        cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
        log_success "Created .env file from template"
    else
        log_info ".env file already exists, skipping creation"
    fi
    
    # Set compose project name
    sed -i "s/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME/" "$INSTALL_DIR/.env" 2>/dev/null || \
        echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME" >> "$INSTALL_DIR/.env"
    
    log_success "Environment configuration created"
}

# Build Docker images
build_images() {
    log_step "Building Docker images..."
    
    cd "$INSTALL_DIR"
    
    # Build development image (default)
    if docker compose build bridge; then
        log_success "Docker images built successfully"
    else
        log_error "Failed to build Docker images"
        exit 1
    fi
}

# Create Docker management scripts
create_management_scripts() {
    log_step "Creating Docker management scripts..."
    
    # Create start script
    cat > "$INSTALL_DIR/docker-start.sh" <<'EOF'
#!/bin/bash
# Start Matrix Google Play Bridge Docker stack
cd "$(dirname "$0")"
docker compose up -d
echo "Bridge started. Check status with: docker compose ps"
echo "View logs with: docker compose logs -f bridge"
EOF
    chmod +x "$INSTALL_DIR/docker-start.sh"
    
    # Create stop script
    cat > "$INSTALL_DIR/docker-stop.sh" <<'EOF'
#!/bin/bash
# Stop Matrix Google Play Bridge Docker stack
cd "$(dirname "$0")"
docker compose down
echo "Bridge stopped."
EOF
    chmod +x "$INSTALL_DIR/docker-stop.sh"
    
    # Create logs script
    cat > "$INSTALL_DIR/docker-logs.sh" <<'EOF'
#!/bin/bash
# View Matrix Google Play Bridge logs
cd "$(dirname "$0")"
docker compose logs -f "${1:-bridge}"
EOF
    chmod +x "$INSTALL_DIR/docker-logs.sh"
    
    # Create restart script
    cat > "$INSTALL_DIR/docker-restart.sh" <<'EOF'
#!/bin/bash
# Restart Matrix Google Play Bridge
cd "$(dirname "$0")"
docker compose restart bridge
echo "Bridge restarted. View logs with: ./docker-logs.sh"
EOF
    chmod +x "$INSTALL_DIR/docker-restart.sh"
    
    # Create update script
    cat > "$INSTALL_DIR/docker-update.sh" <<'EOF'
#!/bin/bash
# Update Matrix Google Play Bridge
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
EOF
    chmod +x "$INSTALL_DIR/docker-update.sh"
    
    # Create backup script
    cat > "$INSTALL_DIR/docker-backup.sh" <<'EOF'
#!/bin/bash
# Backup Matrix Google Play Bridge data
set -e
cd "$(dirname "$0")"

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

mkdir -p "$BACKUP_DIR"

echo "Creating backup..."
docker compose exec -T postgres pg_dump -U bridge_user matrix_googleplay_bridge > "$BACKUP_DIR/database_$TIMESTAMP.sql"

# Backup configuration
tar -czf "$BACKUP_DIR/config_$TIMESTAMP.tar.gz" config/ secrets/ .env

echo "Backup created:"
echo "- Database: $BACKUP_DIR/database_$TIMESTAMP.sql"
echo "- Configuration: $BACKUP_DIR/config_$TIMESTAMP.tar.gz"
EOF
    chmod +x "$INSTALL_DIR/docker-backup.sh"
    
    log_success "Docker management scripts created"
}

# Test Docker installation
test_installation() {
    log_step "Testing Docker installation..."
    
    cd "$INSTALL_DIR"
    
    # Start the stack in background
    if docker compose up -d; then
        log_success "Docker stack started successfully"
        
        # Wait for services to be ready
        log_info "Waiting for services to start..."
        sleep 10
        
        # Check service status
        if docker compose ps | grep -q "Up"; then
            log_success "Services are running"
            
            # Test database connectivity
            if docker compose exec -T postgres pg_isready -U bridge_user >/dev/null 2>&1; then
                log_success "Database is ready"
            else
                log_warning "Database is not ready yet"
            fi
            
            # Stop the test stack
            docker compose down
            log_info "Test completed, services stopped"
        else
            log_error "Services failed to start properly"
            docker compose logs
            exit 1
        fi
    else
        log_error "Failed to start Docker stack"
        exit 1
    fi
}

# Display installation summary
display_summary() {
    log_success "Docker installation completed successfully!"
    
    echo ""
    echo -e "${CYAN}=== Installation Summary ===${NC}"
    echo -e "${BLUE}Installation Directory:${NC} $INSTALL_DIR"
    echo -e "${BLUE}Configuration:${NC} $INSTALL_DIR/config/"
    echo -e "${BLUE}Secrets:${NC} $INSTALL_DIR/secrets/"
    echo -e "${BLUE}Data:${NC} $INSTALL_DIR/data/"
    echo -e "${BLUE}Environment File:${NC} $INSTALL_DIR/.env"
    echo ""
    
    echo -e "${CYAN}=== Docker Management Commands ===${NC}"
    echo -e "${BLUE}Start Bridge:${NC} cd $INSTALL_DIR && ./docker-start.sh"
    echo -e "${BLUE}Stop Bridge:${NC} cd $INSTALL_DIR && ./docker-stop.sh"
    echo -e "${BLUE}View Logs:${NC} cd $INSTALL_DIR && ./docker-logs.sh"
    echo -e "${BLUE}Restart:${NC} cd $INSTALL_DIR && ./docker-restart.sh"
    echo -e "${BLUE}Update:${NC} cd $INSTALL_DIR && ./docker-update.sh"
    echo -e "${BLUE}Backup:${NC} cd $INSTALL_DIR && ./docker-backup.sh"
    echo ""
    
    echo -e "${CYAN}=== Alternative Docker Compose Commands ===${NC}"
    echo -e "${BLUE}Start Services:${NC} docker compose up -d"
    echo -e "${BLUE}Stop Services:${NC} docker compose down"
    echo -e "${BLUE}View Logs:${NC} docker compose logs -f bridge"
    echo -e "${BLUE}Check Status:${NC} docker compose ps"
    echo ""
    
    echo -e "${CYAN}=== Next Steps ===${NC}"
    echo -e "${YELLOW}1.${NC} Configure the bridge:"
    echo -e "   cd $INSTALL_DIR"
    echo -e "   nano .env"
    echo -e "   nano config/config.yaml"
    echo ""
    echo -e "${YELLOW}2.${NC} Add your Google Play service account key:"
    echo -e "   cp your-service-account-key.json $INSTALL_DIR/secrets/service-account-key.json"
    echo ""
    echo -e "${YELLOW}3.${NC} Start the bridge:"
    echo -e "   cd $INSTALL_DIR && ./docker-start.sh"
    echo ""
    echo -e "${YELLOW}4.${NC} Check the logs:"
    echo -e "   cd $INSTALL_DIR && ./docker-logs.sh"
    echo ""
    echo -e "${YELLOW}5.${NC} Access management interfaces:"
    echo -e "   Bridge Health: http://localhost:9090/health"
    echo -e "   Database Admin: http://localhost:8081 (dev only)"
    echo ""
    
    echo -e "${CYAN}=== Documentation ===${NC}"
    echo -e "${BLUE}Docker Guide:${NC} $INSTALL_DIR/DOCKER_README.md"
    echo -e "${BLUE}Setup Guide:${NC} $INSTALL_DIR/docs/setup/installation.md"
    echo -e "${BLUE}Configuration:${NC} $INSTALL_DIR/docs/setup/configuration.md"
    echo -e "${BLUE}Troubleshooting:${NC} $INSTALL_DIR/docs/troubleshooting.md"
    echo ""
}

# Main installation function
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Matrix Google Play Bridge Docker Setup${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    # Check if running interactively
    if [[ ! -t 0 ]]; then
        log_error "This script must be run interactively"
        exit 1
    fi
    
    # Confirm installation
    echo -e "${YELLOW}This script will install the Matrix Google Play Bridge using Docker.${NC}"
    echo -e "${YELLOW}Installation directory: $INSTALL_DIR${NC}"
    echo ""
    read -p "Do you want to continue? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Installation cancelled"
        exit 0
    fi
    
    # Run installation steps
    detect_os
    check_root
    check_docker
    install_docker
    create_directories
    download_bridge
    create_environment_config
    build_images
    create_management_scripts
    test_installation
    display_summary
}

# Handle script interruption
trap 'echo -e "\n${RED}Installation interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"