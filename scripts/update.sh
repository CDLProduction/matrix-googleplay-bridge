#!/bin/bash
# Matrix Google Play Bridge - Update/Upgrade Script
# This script updates the bridge to the latest version

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/matrix-googleplay-bridge"
CONFIG_DIR="/etc/matrix-googleplay-bridge"
DATA_DIR="/var/lib/matrix-googleplay-bridge"
BACKUP_DIR="/var/backups/matrix-googleplay-bridge"
SERVICE_USER="matrix-bridge"
GITHUB_REPO="CDLProduction/matrix-googleplay-bridge"
TEMP_DIR="/tmp/matrix-googleplay-bridge-update"

# Update options
BACKUP_BEFORE_UPDATE="${BACKUP_BEFORE_UPDATE:-true}"
RESTART_SERVICE="${RESTART_SERVICE:-true}"
CHECK_DEPENDENCIES="${CHECK_DEPENDENCIES:-true}"
SKIP_TESTS="${SKIP_TESTS:-false}"

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
    # Check if running as root or with sudo
    if [[ $EUID -ne 0 ]] && ! sudo -n true 2>/dev/null; then
        log_error "This script requires root privileges or sudo access"
        exit 1
    fi
    
    # Check if bridge is installed
    if [[ ! -d "$INSTALL_DIR" ]]; then
        log_error "Matrix Google Play Bridge is not installed. Please run install.sh first."
        exit 1
    fi
    
    # Check required tools
    if ! command -v git >/dev/null 2>&1; then
        log_error "git is required but not installed"
        exit 1
    fi
    
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js is required but not installed"
        exit 1
    fi
    
    if ! command -v npm >/dev/null 2>&1; then
        log_error "npm is required but not installed"
        exit 1
    fi
    
    log_info "Prerequisites check passed"
}

# Get current version
get_current_version() {
    if [[ -f "$INSTALL_DIR/package.json" ]]; then
        CURRENT_VERSION=$(grep '"version"' "$INSTALL_DIR/package.json" | cut -d'"' -f4)
        log_info "Current version: $CURRENT_VERSION"
    else
        CURRENT_VERSION="unknown"
        log_warning "Could not determine current version"
    fi
}

# Get latest version from GitHub
get_latest_version() {
    log_step "Checking for latest version..."
    
    if command -v curl >/dev/null 2>&1; then
        LATEST_VERSION=$(curl -s "https://api.github.com/repos/$GITHUB_REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4 | sed 's/^v//')
    elif command -v wget >/dev/null 2>&1; then
        LATEST_VERSION=$(wget -qO- "https://api.github.com/repos/$GITHUB_REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4 | sed 's/^v//')
    else
        log_error "Neither curl nor wget is available. Cannot check for updates."
        exit 1
    fi
    
    if [[ -z "$LATEST_VERSION" ]]; then
        log_warning "Could not determine latest version from GitHub"
        LATEST_VERSION="main"
    else
        log_info "Latest version: $LATEST_VERSION"
    fi
}

# Compare versions
compare_versions() {
    if [[ "$CURRENT_VERSION" == "unknown" ]] || [[ "$LATEST_VERSION" == "main" ]]; then
        return 0  # Force update if version is unknown or using main branch
    fi
    
    # Simple version comparison (assumes semantic versioning)
    if [[ "$(printf '%s\n' "$LATEST_VERSION" "$CURRENT_VERSION" | sort -V | head -n1)" = "$CURRENT_VERSION" ]] && [[ "$CURRENT_VERSION" != "$LATEST_VERSION" ]]; then
        return 0  # Update available
    else
        return 1  # No update needed
    fi
}

# Create backup before update
create_backup() {
    if [[ "$BACKUP_BEFORE_UPDATE" == "true" ]]; then
        log_step "Creating backup before update..."
        
        # Use the backup script if available
        if [[ -f "$INSTALL_DIR/scripts/backup.sh" ]]; then
            "$INSTALL_DIR/scripts/backup.sh"
        else
            # Simple manual backup
            local timestamp=$(date +"%Y%m%d_%H%M%S")
            local backup_file="$BACKUP_DIR/pre-update-backup-${timestamp}.tar.gz"
            
            sudo mkdir -p "$BACKUP_DIR"
            sudo tar -czf "$backup_file" \
                --exclude='node_modules' \
                --exclude='dist' \
                --exclude='.git' \
                -C "$(dirname "$INSTALL_DIR")" "$(basename "$INSTALL_DIR")" \
                -C "$(dirname "$CONFIG_DIR")" "$(basename "$CONFIG_DIR")" 2>/dev/null || true
            
            log_success "Backup created: $backup_file"
        fi
    else
        log_info "Skipping backup (BACKUP_BEFORE_UPDATE=false)"
    fi
}

# Stop bridge service
stop_service() {
    if systemctl is-active --quiet matrix-googleplay-bridge 2>/dev/null; then
        log_step "Stopping bridge service..."
        sudo systemctl stop matrix-googleplay-bridge
        SERVICE_WAS_RUNNING=true
        log_success "Service stopped"
    else
        SERVICE_WAS_RUNNING=false
        log_info "Service was not running"
    fi
}

# Download latest version
download_update() {
    log_step "Downloading latest version..."
    
    # Clean up any existing temp directory
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    
    # Clone or download the repository
    if [[ "$LATEST_VERSION" == "main" ]]; then
        git clone "https://github.com/$GITHUB_REPO.git" "$TEMP_DIR"
    else
        # Download specific release
        local release_url="https://github.com/$GITHUB_REPO/archive/refs/tags/v${LATEST_VERSION}.tar.gz"
        if command -v curl >/dev/null 2>&1; then
            curl -L "$release_url" | tar -xz -C "$TEMP_DIR" --strip-components=1
        elif command -v wget >/dev/null 2>&1; then
            wget -qO- "$release_url" | tar -xz -C "$TEMP_DIR" --strip-components=1
        fi
    fi
    
    if [[ ! -f "$TEMP_DIR/package.json" ]]; then
        log_error "Failed to download update. package.json not found in downloaded files."
        exit 1
    fi
    
    log_success "Update downloaded to: $TEMP_DIR"
}

# Check for breaking changes
check_breaking_changes() {
    log_step "Checking for breaking changes..."
    
    local breaking_changes=false
    
    # Check Node.js version compatibility
    local required_node=$(grep '"node"' "$TEMP_DIR/package.json" | cut -d'"' -f4 | sed 's/[^0-9.]//g' | cut -d'.' -f1)
    local current_node=$(node -v | sed 's/v//g' | cut -d'.' -f1)
    
    if [[ -n "$required_node" ]] && [[ "$current_node" -lt "$required_node" ]]; then
        log_warning "Node.js version $required_node or higher is required (current: $current_node)"
        breaking_changes=true
    fi
    
    # Check for configuration changes
    if [[ -f "$TEMP_DIR/CHANGELOG.md" ]]; then
        if grep -q "BREAKING" "$TEMP_DIR/CHANGELOG.md" 2>/dev/null; then
            log_warning "Breaking changes detected in CHANGELOG.md"
            breaking_changes=true
        fi
    fi
    
    if [[ "$breaking_changes" == true ]]; then
        log_warning "Breaking changes detected!"
        read -p "Do you want to continue with the update? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Update cancelled"
            exit 0
        fi
    fi
}

# Install dependencies
install_dependencies() {
    if [[ "$CHECK_DEPENDENCIES" == "true" ]]; then
        log_step "Installing/updating dependencies..."
        
        cd "$TEMP_DIR"
        
        # Install production dependencies
        npm ci --only=production --silent
        
        log_success "Dependencies installed"
    else
        log_info "Skipping dependency check (CHECK_DEPENDENCIES=false)"
    fi
}

# Build application
build_application() {
    log_step "Building application..."
    
    cd "$TEMP_DIR"
    
    # Build the TypeScript code
    if npm run build --silent; then
        log_success "Application built successfully"
    else
        log_error "Build failed"
        exit 1
    fi
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == "false" ]]; then
        log_step "Running tests..."
        
        cd "$TEMP_DIR"
        
        # Install dev dependencies for testing
        npm install --silent
        
        # Run test suite
        if npm test --silent; then
            log_success "All tests passed"
        else
            log_warning "Some tests failed"
            read -p "Do you want to continue with the update despite test failures? [y/N] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Update cancelled due to test failures"
                exit 1
            fi
        fi
    else
        log_info "Skipping tests (SKIP_TESTS=true)"
    fi
}

# Update bridge installation
update_installation() {
    log_step "Updating bridge installation..."
    
    # Preserve configuration and data
    sudo cp -r "$CONFIG_DIR" "$TEMP_DIR/config.backup" 2>/dev/null || true
    if [[ -d "$DATA_DIR" ]]; then
        sudo cp -r "$DATA_DIR" "$TEMP_DIR/data.backup" 2>/dev/null || true
    fi
    
    # Replace application files
    sudo rsync -av --delete \
        --exclude='config.backup' \
        --exclude='data.backup' \
        --exclude='.git' \
        "$TEMP_DIR/" "$INSTALL_DIR/"
    
    # Restore preserved files
    if [[ -d "$TEMP_DIR/config.backup" ]]; then
        sudo rm -rf "$CONFIG_DIR"
        sudo mv "$TEMP_DIR/config.backup" "$CONFIG_DIR"
    fi
    
    if [[ -d "$TEMP_DIR/data.backup" ]]; then
        sudo rm -rf "$DATA_DIR"
        sudo mv "$TEMP_DIR/data.backup" "$DATA_DIR"
    fi
    
    # Set proper ownership
    sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    log_success "Installation updated"
}

# Run database migrations
run_migrations() {
    log_step "Running database migrations..."
    
    cd "$INSTALL_DIR"
    
    # Check if migration script exists
    if [[ -f "scripts/migrate.js" ]] || npm run migrate --silent >/dev/null 2>&1; then
        if sudo -u "$SERVICE_USER" npm run migrate --silent; then
            log_success "Database migrations completed"
        else
            log_warning "Database migrations failed or not needed"
        fi
    else
        log_info "No database migrations to run"
    fi
}

# Start bridge service
start_service() {
    if [[ "$RESTART_SERVICE" == "true" ]] && [[ "$SERVICE_WAS_RUNNING" == true ]]; then
        log_step "Starting bridge service..."
        
        sudo systemctl start matrix-googleplay-bridge
        
        # Wait a moment and check if service started successfully
        sleep 3
        if systemctl is-active --quiet matrix-googleplay-bridge; then
            log_success "Service started successfully"
        else
            log_error "Service failed to start. Check logs: journalctl -u matrix-googleplay-bridge"
            exit 1
        fi
    elif [[ "$SERVICE_WAS_RUNNING" == true ]]; then
        log_info "Service restart skipped (RESTART_SERVICE=false)"
        log_warning "Remember to manually restart the service: sudo systemctl start matrix-googleplay-bridge"
    fi
}

# Verify update
verify_update() {
    log_step "Verifying update..."
    
    # Check if new version is correctly installed
    if [[ -f "$INSTALL_DIR/package.json" ]]; then
        local installed_version=$(grep '"version"' "$INSTALL_DIR/package.json" | cut -d'"' -f4)
        log_info "Installed version: $installed_version"
        
        if [[ "$installed_version" == "$LATEST_VERSION" ]]; then
            log_success "Update verification successful"
        else
            log_warning "Version mismatch. Expected: $LATEST_VERSION, Found: $installed_version"
        fi
    else
        log_error "Update verification failed - package.json not found"
        return 1
    fi
    
    # Check if service is healthy (if it was running)
    if [[ "$SERVICE_WAS_RUNNING" == true ]] && [[ "$RESTART_SERVICE" == "true" ]]; then
        sleep 5  # Give service time to start up
        
        if systemctl is-active --quiet matrix-googleplay-bridge; then
            log_success "Service is running and healthy"
        else
            log_warning "Service is not running properly"
            return 1
        fi
    fi
}

# Cleanup
cleanup() {
    log_step "Cleaning up temporary files..."
    
    rm -rf "$TEMP_DIR"
    
    log_success "Cleanup completed"
}

# Display update summary
display_update_summary() {
    echo ""
    echo -e "${CYAN}=== Update Summary ===${NC}"
    echo -e "${BLUE}Previous Version:${NC} $CURRENT_VERSION"
    echo -e "${BLUE}Updated Version:${NC} $LATEST_VERSION"
    echo -e "${BLUE}Update Date:${NC} $(date)"
    echo -e "${BLUE}Installation Directory:${NC} $INSTALL_DIR"
    echo ""
    
    if [[ "$SERVICE_WAS_RUNNING" == true ]] && [[ "$RESTART_SERVICE" == "true" ]]; then
        echo -e "${CYAN}=== Service Status ===${NC}"
        echo -e "${BLUE}Status:${NC} $(systemctl is-active matrix-googleplay-bridge 2>/dev/null || echo 'inactive')"
        echo ""
    fi
    
    echo -e "${CYAN}=== Next Steps ===${NC}"
    echo -e "${YELLOW}1.${NC} Check service logs: sudo journalctl -u matrix-googleplay-bridge -f"
    echo -e "${YELLOW}2.${NC} Verify bridge functionality"
    echo -e "${YELLOW}3.${NC} Review any breaking changes in CHANGELOG.md"
    
    if [[ "$BACKUP_BEFORE_UPDATE" == "true" ]]; then
        echo -e "${YELLOW}4.${NC} Remove old backups if update is successful"
    fi
    echo ""
}

# Main update function
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Matrix Google Play Bridge Update${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --no-backup)
                BACKUP_BEFORE_UPDATE=false
                shift
                ;;
            --no-restart)
                RESTART_SERVICE=false
                shift
                ;;
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --force)
                FORCE_UPDATE=true
                shift
                ;;
            --help)
                echo "Usage: $0 [options]"
                echo ""
                echo "Options:"
                echo "  --no-backup    Skip backup before update"
                echo "  --no-restart   Don't restart service after update"
                echo "  --skip-tests   Skip running tests"
                echo "  --force        Force update even if already up-to-date"
                echo "  --help         Show this help message"
                echo ""
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    # Run update process
    check_prerequisites
    get_current_version
    get_latest_version
    
    # Check if update is needed
    if ! compare_versions && [[ "$FORCE_UPDATE" != "true" ]]; then
        log_success "Bridge is already up-to-date (version $CURRENT_VERSION)"
        exit 0
    fi
    
    log_info "Update available: $CURRENT_VERSION -> $LATEST_VERSION"
    
    # Confirm update
    read -p "Do you want to proceed with the update? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        log_info "Update cancelled"
        exit 0
    fi
    
    # Execute update steps
    create_backup
    stop_service
    download_update
    check_breaking_changes
    install_dependencies
    build_application
    run_tests
    update_installation
    run_migrations
    start_service
    verify_update
    cleanup
    display_update_summary
    
    log_success "Update completed successfully!"
}

# Handle script interruption
trap 'echo -e "\n${RED}Update interrupted${NC}"; cleanup 2>/dev/null || true; exit 1' INT TERM

# Run main function
main "$@"