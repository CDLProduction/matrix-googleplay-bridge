#!/bin/bash
# Matrix Google Play Bridge - Docker Management Script
# This script provides comprehensive management of the Docker-based bridge

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
BACKUP_DIR="$INSTALL_DIR/backups"
LOGS_DIR="$INSTALL_DIR/logs"

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

# Check if in correct directory
check_directory() {
    if [[ ! -f "docker/docker-compose.yml" ]]; then
        if [[ -f "$INSTALL_DIR/docker/docker-compose.yml" ]]; then
            cd "$INSTALL_DIR"
            log_info "Changed to installation directory: $INSTALL_DIR"
        else
            log_error "Docker Compose file not found. Please run from the bridge installation directory."
            exit 1
        fi
    fi
}

# Get container status
get_container_status() {
    local service="$1"
    docker compose ps -q "$service" 2>/dev/null | xargs -r docker inspect -f '{{.State.Status}}' 2>/dev/null || echo "not found"
}

# Check if service is running
is_service_running() {
    local service="$1"
    local status=$(get_container_status "$service")
    [[ "$status" == "running" ]]
}

# Start services
start_services() {
    log_step "Starting Matrix Google Play Bridge services..."
    
    local services=("$@")
    if [[ ${#services[@]} -eq 0 ]]; then
        # Start all services
        docker compose up -d
        log_success "All services started"
    else
        # Start specific services
        docker compose up -d "${services[@]}"
        log_success "Started services: ${services[*]}"
    fi
    
    # Show status
    show_status
}

# Stop services
stop_services() {
    log_step "Stopping Matrix Google Play Bridge services..."
    
    local services=("$@")
    if [[ ${#services[@]} -eq 0 ]]; then
        # Stop all services
        docker compose down
        log_success "All services stopped"
    else
        # Stop specific services
        docker compose stop "${services[@]}"
        log_success "Stopped services: ${services[*]}"
    fi
}

# Restart services
restart_services() {
    log_step "Restarting Matrix Google Play Bridge services..."
    
    local services=("$@")
    if [[ ${#services[@]} -eq 0 ]]; then
        # Restart all services
        docker compose restart
        log_success "All services restarted"
    else
        # Restart specific services
        docker compose restart "${services[@]}"
        log_success "Restarted services: ${services[*]}"
    fi
    
    # Show status
    show_status
}

# Show service status
show_status() {
    log_step "Service Status:"
    echo ""
    
    # Get detailed status
    docker compose ps
    echo ""
    
    # Check individual service health
    local services=("bridge" "postgres" "redis" "nginx")
    
    for service in "${services[@]}"; do
        local status=$(get_container_status "$service")
        case "$status" in
            "running")
                echo -e "${GREEN}✓${NC} $service: Running"
                ;;
            "exited")
                echo -e "${RED}✗${NC} $service: Stopped"
                ;;
            "restarting")
                echo -e "${YELLOW}⟳${NC} $service: Restarting"
                ;;
            "not found")
                echo -e "${BLUE}○${NC} $service: Not deployed"
                ;;
            *)
                echo -e "${YELLOW}?${NC} $service: $status"
                ;;
        esac
    done
    echo ""
    
    # Show resource usage
    if command -v docker >/dev/null 2>&1; then
        echo "Resource Usage:"
        docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>/dev/null | head -5
        echo ""
    fi
}

# View logs
view_logs() {
    local service="${1:-bridge}"
    local tail_lines="${2:-100}"
    local follow="${3:-false}"
    
    log_info "Viewing logs for service: $service"
    
    if [[ "$follow" == "true" ]]; then
        docker compose logs -f --tail="$tail_lines" "$service"
    else
        docker compose logs --tail="$tail_lines" "$service"
    fi
}

# Execute command in container
exec_command() {
    local service="$1"
    shift
    local command=("$@")
    
    if [[ ${#command[@]} -eq 0 ]]; then
        # Interactive shell
        docker compose exec "$service" sh
    else
        # Execute specific command
        docker compose exec "$service" "${command[@]}"
    fi
}

# Health check
health_check() {
    log_step "Performing health checks..."
    echo ""
    
    local healthy=true
    
    # Check bridge health endpoint
    if is_service_running "bridge"; then
        if curl -sf http://localhost:9090/health >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Bridge health endpoint: OK"
        else
            echo -e "${RED}✗${NC} Bridge health endpoint: Failed"
            healthy=false
        fi
        
        # Check bridge metrics
        if curl -sf http://localhost:9090/metrics >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Bridge metrics endpoint: OK"
        else
            echo -e "${YELLOW}⚠${NC} Bridge metrics endpoint: Warning"
        fi
    else
        echo -e "${RED}✗${NC} Bridge service: Not running"
        healthy=false
    fi
    
    # Check database
    if is_service_running "postgres"; then
        if docker compose exec -T postgres pg_isready -U bridge_user >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} PostgreSQL database: OK"
        else
            echo -e "${RED}✗${NC} PostgreSQL database: Failed"
            healthy=false
        fi
    else
        echo -e "${RED}✗${NC} PostgreSQL service: Not running"
        healthy=false
    fi
    
    # Check Redis
    if is_service_running "redis"; then
        if docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Redis cache: OK"
        else
            echo -e "${YELLOW}⚠${NC} Redis cache: Warning"
        fi
    else
        echo -e "${BLUE}○${NC} Redis service: Not running (optional)"
    fi
    
    # Check disk space
    local disk_usage=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    if [[ $disk_usage -lt 90 ]]; then
        echo -e "${GREEN}✓${NC} Disk space: ${disk_usage}% used"
    elif [[ $disk_usage -lt 95 ]]; then
        echo -e "${YELLOW}⚠${NC} Disk space: ${disk_usage}% used (Warning)"
    else
        echo -e "${RED}✗${NC} Disk space: ${disk_usage}% used (Critical)"
        healthy=false
    fi
    
    echo ""
    
    if [[ "$healthy" == true ]]; then
        log_success "Health check passed"
        return 0
    else
        log_warning "Health check found issues"
        return 1
    fi
}

# Create backup
create_backup() {
    log_step "Creating backup..."
    
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local backup_name="${1:-backup_$timestamp}"
    
    # Ensure backup directory exists
    mkdir -p "$BACKUP_DIR"
    
    # Stop bridge temporarily for consistent backup
    local bridge_was_running=false
    if is_service_running "bridge"; then
        log_info "Stopping bridge for consistent backup..."
        docker compose stop bridge
        bridge_was_running=true
    fi
    
    # Backup database
    if is_service_running "postgres"; then
        log_info "Backing up PostgreSQL database..."
        docker compose exec -T postgres pg_dump -U bridge_user matrix_googleplay_bridge > "$BACKUP_DIR/${backup_name}_database.sql"
        local db_size=$(du -h "$BACKUP_DIR/${backup_name}_database.sql" | cut -f1)
        log_success "Database backup created: ${backup_name}_database.sql ($db_size)"
    else
        log_warning "PostgreSQL not running, skipping database backup"
    fi
    
    # Backup configuration and secrets
    log_info "Backing up configuration..."
    tar -czf "$BACKUP_DIR/${backup_name}_config.tar.gz" config/ secrets/ .env 2>/dev/null || true
    local config_size=$(du -h "$BACKUP_DIR/${backup_name}_config.tar.gz" | cut -f1 2>/dev/null || echo "0")
    log_success "Configuration backup created: ${backup_name}_config.tar.gz ($config_size)"
    
    # Backup application data if it exists
    if [[ -d "data" ]]; then
        log_info "Backing up application data..."
        tar -czf "$BACKUP_DIR/${backup_name}_data.tar.gz" data/ 2>/dev/null || true
        local data_size=$(du -h "$BACKUP_DIR/${backup_name}_data.tar.gz" | cut -f1 2>/dev/null || echo "0")
        log_success "Data backup created: ${backup_name}_data.tar.gz ($data_size)"
    fi
    
    # Create backup manifest
    cat > "$BACKUP_DIR/${backup_name}_manifest.txt" <<EOF
Matrix Google Play Bridge Docker Backup
========================================

Backup Name: $backup_name
Backup Date: $(date)
Backup Location: $BACKUP_DIR

Files:
EOF
    
    for file in "$BACKUP_DIR"/${backup_name}_*; do
        if [[ -f "$file" && "$file" != *"manifest.txt" ]]; then
            local size=$(du -h "$file" | cut -f1)
            local checksum=$(sha256sum "$file" | cut -d' ' -f1)
            echo "- $(basename "$file") (Size: $size, SHA256: $checksum)" >> "$BACKUP_DIR/${backup_name}_manifest.txt"
        fi
    done
    
    # Restart bridge if it was running
    if [[ "$bridge_was_running" == true ]]; then
        log_info "Restarting bridge..."
        docker compose start bridge
    fi
    
    log_success "Backup completed: $backup_name"
    log_info "Backup manifest: $BACKUP_DIR/${backup_name}_manifest.txt"
}

# List backups
list_backups() {
    log_step "Available backups:"
    echo ""
    
    if [[ ! -d "$BACKUP_DIR" ]] || [[ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
        log_info "No backups found"
        return 0
    fi
    
    # Group backups by name
    local backup_names=$(find "$BACKUP_DIR" -name "*_manifest.txt" | sed 's/_manifest.txt$//' | sort -r)
    
    for manifest in $backup_names; do
        local backup_name=$(basename "$manifest")
        if [[ -f "${manifest}_manifest.txt" ]]; then
            echo -e "${CYAN}$backup_name${NC}"
            cat "${manifest}_manifest.txt" | grep -E "^(Backup Date|Files|^-)" | sed 's/^/  /'
            echo ""
        fi
    done
}

# Update bridge
update_bridge() {
    log_step "Updating Matrix Google Play Bridge..."
    
    # Create backup before update
    log_info "Creating pre-update backup..."
    create_backup "pre-update-$(date +%Y%m%d_%H%M%S)"
    
    # Stop services
    log_info "Stopping services..."
    docker compose down
    
    # Pull latest code
    log_info "Pulling latest code..."
    git pull origin main
    
    # Rebuild images
    log_info "Rebuilding Docker images..."
    docker compose build bridge
    
    # Start services
    log_info "Starting services..."
    docker compose up -d
    
    # Wait and check health
    log_info "Waiting for services to start..."
    sleep 10
    
    if health_check >/dev/null 2>&1; then
        log_success "Update completed successfully"
    else
        log_warning "Update completed but health check failed"
        log_warning "Check logs with: $0 logs"
    fi
}

# Clean up old containers and images
cleanup() {
    log_step "Cleaning up Docker resources..."
    
    # Remove stopped containers
    local stopped_containers=$(docker ps -aq --filter "status=exited" 2>/dev/null || true)
    if [[ -n "$stopped_containers" ]]; then
        docker rm $stopped_containers
        log_info "Removed stopped containers"
    fi
    
    # Remove dangling images
    local dangling_images=$(docker images -qf "dangling=true" 2>/dev/null || true)
    if [[ -n "$dangling_images" ]]; then
        docker rmi $dangling_images
        log_info "Removed dangling images"
    fi
    
    # Clean up build cache
    docker builder prune -f >/dev/null 2>&1 || true
    
    log_success "Cleanup completed"
}

# Monitor services
monitor() {
    log_info "Starting service monitor (Press Ctrl+C to stop)..."
    echo ""
    
    while true; do
        clear
        echo -e "${CYAN}Matrix Google Play Bridge - Live Monitor${NC}"
        echo -e "${CYAN}======================================${NC}"
        echo ""
        
        # Show current time
        echo -e "${BLUE}Current Time:${NC} $(date)"
        echo ""
        
        # Show service status
        show_status
        
        # Show recent logs (last 5 lines)
        echo -e "${BLUE}Recent Bridge Logs:${NC}"
        docker compose logs --tail=5 bridge 2>/dev/null | tail -5 || echo "No logs available"
        echo ""
        
        # Wait 30 seconds
        for i in {30..1}; do
            echo -ne "\rRefreshing in $i seconds... (Ctrl+C to stop)"
            sleep 1
        done
        echo ""
    done
}

# Show usage information
show_usage() {
    cat <<EOF
Matrix Google Play Bridge Docker Management Script

Usage: $0 <command> [arguments]

Commands:
  start [services...]     Start services (all if no services specified)
  stop [services...]      Stop services (all if no services specified)
  restart [services...]   Restart services (all if no services specified)
  status                  Show service status and resource usage
  logs [service] [lines]  Show logs (default: bridge, 100 lines)
  follow [service]        Follow logs in real-time
  exec <service> [cmd]    Execute command in service container
  health                  Perform health checks
  backup [name]           Create backup with optional name
  list-backups           List all available backups
  update                  Update bridge to latest version
  cleanup                 Clean up old Docker resources
  monitor                 Monitor services in real-time
  help                    Show this help message

Examples:
  $0 start                # Start all services
  $0 start bridge         # Start only bridge service
  $0 logs bridge 50       # Show last 50 lines of bridge logs
  $0 follow bridge        # Follow bridge logs in real-time
  $0 exec bridge bash     # Open shell in bridge container
  $0 backup my-backup     # Create backup named 'my-backup'
  $0 health               # Check service health
  $0 monitor              # Start live monitoring

Services: bridge, postgres, redis, nginx, adminer, redis-commander
EOF
}

# Main function
main() {
    local command="$1"
    shift 2>/dev/null || true
    
    # Check if we're in the right directory
    check_directory
    
    case "$command" in
        start)
            start_services "$@"
            ;;
        stop)
            stop_services "$@"
            ;;
        restart)
            restart_services "$@"
            ;;
        status)
            show_status
            ;;
        logs)
            view_logs "$1" "${2:-100}" false
            ;;
        follow)
            view_logs "${1:-bridge}" 100 true
            ;;
        exec)
            local service="$1"
            shift 2>/dev/null || true
            exec_command "$service" "$@"
            ;;
        health)
            health_check
            ;;
        backup)
            create_backup "$1"
            ;;
        list-backups)
            list_backups
            ;;
        update)
            update_bridge
            ;;
        cleanup)
            cleanup
            ;;
        monitor)
            monitor
            ;;
        help|--help|-h)
            show_usage
            ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Handle script interruption
trap 'echo -e "\n${RED}Operation interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"