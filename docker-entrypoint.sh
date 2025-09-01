#!/bin/bash
# Docker entrypoint script for Matrix Google Play Bridge
# Provides initialization, health checks, and graceful startup

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT]${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] [WARN]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] [SUCCESS]${NC} $1"
}

# Configuration paths
CONFIG_PATH="${CONFIG_PATH:-/app/config/config.yaml}"
DEFAULT_CONFIG_PATH="/app/config/config.yaml.example"

# Initialize configuration if not exists
init_config() {
    log "Initializing configuration..."
    
    if [ ! -f "$CONFIG_PATH" ]; then
        log_warn "Configuration file not found at $CONFIG_PATH"
        
        if [ -f "$DEFAULT_CONFIG_PATH" ]; then
            log "Copying default configuration from $DEFAULT_CONFIG_PATH"
            cp "$DEFAULT_CONFIG_PATH" "$CONFIG_PATH"
        else
            log_error "No configuration file found and no default available!"
            exit 1
        fi
    fi
    
    log_success "Configuration initialized"
}

# Check required environment variables
check_environment() {
    log "Checking environment variables..."
    
    local required_vars=()
    local missing_vars=()
    
    # Add required environment variables based on deployment type
    if [ "$NODE_ENV" = "production" ]; then
        required_vars+=("DB_HOST" "DB_USER" "DB_NAME")
    fi
    
    # Check for missing variables
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -ne 0 ]; then
        log_error "Missing required environment variables: ${missing_vars[*]}"
        log_error "Please set these variables before starting the container"
        exit 1
    fi
    
    log_success "Environment variables checked"
}

# Wait for database to be ready
wait_for_database() {
    if [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ]; then
        log "Waiting for database at $DB_HOST:$DB_PORT..."
        
        local retries=30
        local count=0
        
        while [ $count -lt $retries ]; do
            if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
                log_success "Database is ready!"
                return 0
            fi
            
            count=$((count + 1))
            log "Database not ready, waiting... ($count/$retries)"
            sleep 2
        done
        
        log_error "Database failed to become ready after $retries attempts"
        exit 1
    fi
}

# Wait for external dependencies
wait_for_dependencies() {
    log "Checking external dependencies..."
    
    # Wait for database if configured
    wait_for_database
    
    # Add more dependency checks as needed
    # wait_for_redis
    # wait_for_matrix_server
    
    log_success "Dependencies are ready"
}

# Run database migrations
run_migrations() {
    if [ "$NODE_ENV" = "production" ] && [ -f "dist/scripts/migrate.js" ]; then
        log "Running database migrations..."
        
        if node dist/scripts/migrate.js; then
            log_success "Database migrations completed"
        else
            log_error "Database migrations failed"
            exit 1
        fi
    fi
}

# Create necessary directories
setup_directories() {
    log "Setting up directories..."
    
    local dirs=(
        "/var/log/googleplay-bridge"
        "/app/data"
        "/app/tmp"
    )
    
    for dir in "${dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            log "Created directory: $dir"
        fi
    done
    
    # Set proper permissions
    chown -R bridge:bridge /var/log/googleplay-bridge /app/data /app/tmp 2>/dev/null || true
    
    log_success "Directories setup completed"
}

# Health check function
health_check() {
    local health_url="http://localhost:9090/health"
    local retries=5
    local count=0
    
    while [ $count -lt $retries ]; do
        if curl -f -s "$health_url" > /dev/null 2>&1; then
            return 0
        fi
        
        count=$((count + 1))
        sleep 1
    done
    
    return 1
}

# Graceful shutdown handler
shutdown_handler() {
    log "Received shutdown signal, starting graceful shutdown..."
    
    if [ -n "$BRIDGE_PID" ]; then
        log "Stopping bridge process (PID: $BRIDGE_PID)..."
        kill -TERM "$BRIDGE_PID"
        
        # Wait for graceful shutdown
        local timeout=30
        local count=0
        
        while kill -0 "$BRIDGE_PID" 2>/dev/null && [ $count -lt $timeout ]; do
            count=$((count + 1))
            sleep 1
        done
        
        # Force kill if still running
        if kill -0 "$BRIDGE_PID" 2>/dev/null; then
            log_warn "Force killing bridge process..."
            kill -KILL "$BRIDGE_PID"
        fi
    fi
    
    log_success "Graceful shutdown completed"
    exit 0
}

# Setup signal handlers
setup_signal_handlers() {
    trap 'shutdown_handler' SIGTERM SIGINT SIGQUIT
}

# Main execution function
main() {
    log "Starting Matrix Google Play Bridge container..."
    log "Node.js version: $(node --version)"
    log "Environment: ${NODE_ENV:-development}"
    
    # Setup signal handlers for graceful shutdown
    setup_signal_handlers
    
    # Initialization steps
    check_environment
    init_config
    setup_directories
    wait_for_dependencies
    run_migrations
    
    log_success "Initialization completed successfully!"
    
    # Start the application
    if [ $# -eq 0 ]; then
        # Default command
        log "Starting bridge application..."
        node dist/app.js &
        BRIDGE_PID=$!
        
        # Wait for the application to start
        sleep 5
        
        if health_check; then
            log_success "Bridge application started successfully!"
        else
            log_error "Bridge application failed to start properly"
            exit 1
        fi
        
        # Wait for the process to finish
        wait $BRIDGE_PID
    else
        # Execute custom command
        log "Executing custom command: $*"
        exec "$@"
    fi
}

# Run main function
main "$@"