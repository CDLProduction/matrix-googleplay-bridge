#!/bin/bash
# Matrix Google Play Bridge - Backup Script
# This script creates backups of the bridge database and configuration

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default configuration
BACKUP_DIR="${BACKUP_DIR:-/var/backups/matrix-googleplay-bridge}"
CONFIG_DIR="/etc/matrix-googleplay-bridge"
DATA_DIR="/var/lib/matrix-googleplay-bridge"
LOG_DIR="/var/log/matrix-googleplay-bridge"

# Database configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-matrix_googleplay_bridge}"
DB_USER="${DB_USER:-bridge_user}"

# Backup configuration
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPRESS_BACKUPS="${COMPRESS_BACKUPS:-true}"
ENCRYPT_BACKUPS="${ENCRYPT_BACKUPS:-false}"
BACKUP_PREFIX="matrix-googleplay-bridge"

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
    
    # Check if backup directory exists
    if [[ ! -d "$BACKUP_DIR" ]]; then
        log_info "Creating backup directory: $BACKUP_DIR"
        sudo mkdir -p "$BACKUP_DIR"
        sudo chmod 700 "$BACKUP_DIR"
    fi
    
    # Check required tools
    if [[ "$DB_TYPE" == "postgresql" ]] && ! command -v pg_dump >/dev/null 2>&1; then
        log_error "pg_dump is not available. Please install PostgreSQL client tools."
        exit 1
    fi
    
    if [[ "$COMPRESS_BACKUPS" == "true" ]] && ! command -v gzip >/dev/null 2>&1; then
        log_error "gzip is not available. Please install gzip or set COMPRESS_BACKUPS=false"
        exit 1
    fi
    
    if [[ "$ENCRYPT_BACKUPS" == "true" ]] && ! command -v gpg >/dev/null 2>&1; then
        log_error "gpg is not available. Please install gnupg or set ENCRYPT_BACKUPS=false"
        exit 1
    fi
    
    log_info "Prerequisites check passed"
}

# Detect database type from configuration
detect_database_type() {
    if [[ -f "$CONFIG_DIR/config.yaml" ]]; then
        # Try to detect database type from config
        if grep -q "type.*postgresql" "$CONFIG_DIR/config.yaml"; then
            DB_TYPE="postgresql"
        elif grep -q "type.*sqlite" "$CONFIG_DIR/config.yaml"; then
            DB_TYPE="sqlite"
            # Extract SQLite path
            SQLITE_PATH=$(grep -A 5 "type.*sqlite" "$CONFIG_DIR/config.yaml" | grep "path:" | sed 's/.*path: *//g' | tr -d '"' | tr -d "'")
        else
            log_warning "Could not detect database type from configuration"
            DB_TYPE="postgresql"  # Default assumption
        fi
    else
        log_warning "Configuration file not found, assuming PostgreSQL"
        DB_TYPE="postgresql"
    fi
    
    log_info "Detected database type: $DB_TYPE"
}

# Create timestamp
create_timestamp() {
    date +"%Y%m%d_%H%M%S"
}

# Backup PostgreSQL database
backup_postgresql() {
    local timestamp="$1"
    local backup_file="$BACKUP_DIR/${BACKUP_PREFIX}_db_${timestamp}.sql"
    
    log_step "Backing up PostgreSQL database..."
    
    # Set password from environment or prompt
    if [[ -z "$DB_PASSWORD" ]]; then
        log_error "DB_PASSWORD environment variable is required for PostgreSQL backup"
        exit 1
    fi
    
    export PGPASSWORD="$DB_PASSWORD"
    
    # Create database backup
    if pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        --verbose --clean --create --format=plain --encoding=UTF8 \
        --no-privileges --no-owner > "$backup_file" 2>/dev/null; then
        
        unset PGPASSWORD
        
        # Get backup size
        local backup_size=$(du -h "$backup_file" | cut -f1)
        log_success "PostgreSQL backup created: $backup_file ($backup_size)"
        
        # Compress if requested
        if [[ "$COMPRESS_BACKUPS" == "true" ]]; then
            gzip "$backup_file"
            backup_file="${backup_file}.gz"
            log_success "Backup compressed: $backup_file"
        fi
        
        # Encrypt if requested
        if [[ "$ENCRYPT_BACKUPS" == "true" ]] && [[ -n "$BACKUP_GPG_RECIPIENT" ]]; then
            gpg --trust-model always --encrypt -r "$BACKUP_GPG_RECIPIENT" "$backup_file"
            rm "$backup_file"
            backup_file="${backup_file}.gpg"
            log_success "Backup encrypted: $backup_file"
        fi
        
        echo "$backup_file"
    else
        unset PGPASSWORD
        log_error "PostgreSQL backup failed"
        return 1
    fi
}

# Backup SQLite database
backup_sqlite() {
    local timestamp="$1"
    local backup_file="$BACKUP_DIR/${BACKUP_PREFIX}_db_${timestamp}.db"
    
    log_step "Backing up SQLite database..."
    
    if [[ ! -f "$SQLITE_PATH" ]]; then
        log_error "SQLite database file not found: $SQLITE_PATH"
        return 1
    fi
    
    # Copy SQLite database file
    if cp "$SQLITE_PATH" "$backup_file"; then
        # Get backup size
        local backup_size=$(du -h "$backup_file" | cut -f1)
        log_success "SQLite backup created: $backup_file ($backup_size)"
        
        # Compress if requested
        if [[ "$COMPRESS_BACKUPS" == "true" ]]; then
            gzip "$backup_file"
            backup_file="${backup_file}.gz"
            log_success "Backup compressed: $backup_file"
        fi
        
        # Encrypt if requested
        if [[ "$ENCRYPT_BACKUPS" == "true" ]] && [[ -n "$BACKUP_GPG_RECIPIENT" ]]; then
            gpg --trust-model always --encrypt -r "$BACKUP_GPG_RECIPIENT" "$backup_file"
            rm "$backup_file"
            backup_file="${backup_file}.gpg"
            log_success "Backup encrypted: $backup_file"
        fi
        
        echo "$backup_file"
    else
        log_error "SQLite backup failed"
        return 1
    fi
}

# Backup configuration files
backup_configuration() {
    local timestamp="$1"
    local config_backup="$BACKUP_DIR/${BACKUP_PREFIX}_config_${timestamp}.tar"
    
    log_step "Backing up configuration files..."
    
    # Create tar archive of configuration directory
    if tar -cf "$config_backup" -C "$(dirname "$CONFIG_DIR")" "$(basename "$CONFIG_DIR")" 2>/dev/null; then
        local backup_size=$(du -h "$config_backup" | cut -f1)
        log_success "Configuration backup created: $config_backup ($backup_size)"
        
        # Compress if requested
        if [[ "$COMPRESS_BACKUPS" == "true" ]]; then
            gzip "$config_backup"
            config_backup="${config_backup}.gz"
            log_success "Configuration backup compressed: $config_backup"
        fi
        
        # Encrypt if requested (configuration contains sensitive data)
        if [[ "$ENCRYPT_BACKUPS" == "true" ]] && [[ -n "$BACKUP_GPG_RECIPIENT" ]]; then
            gpg --trust-model always --encrypt -r "$BACKUP_GPG_RECIPIENT" "$config_backup"
            rm "$config_backup"
            config_backup="${config_backup}.gpg"
            log_success "Configuration backup encrypted: $config_backup"
        fi
        
        echo "$config_backup"
    else
        log_error "Configuration backup failed"
        return 1
    fi
}

# Backup application data
backup_data() {
    local timestamp="$1"
    
    if [[ -d "$DATA_DIR" ]]; then
        local data_backup="$BACKUP_DIR/${BACKUP_PREFIX}_data_${timestamp}.tar"
        
        log_step "Backing up application data..."
        
        # Create tar archive of data directory
        if tar -cf "$data_backup" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")" 2>/dev/null; then
            local backup_size=$(du -h "$data_backup" | cut -f1)
            log_success "Data backup created: $data_backup ($backup_size)"
            
            # Compress if requested
            if [[ "$COMPRESS_BACKUPS" == "true" ]]; then
                gzip "$data_backup"
                data_backup="${data_backup}.gz"
                log_success "Data backup compressed: $data_backup"
            fi
            
            echo "$data_backup"
        else
            log_error "Data backup failed"
            return 1
        fi
    else
        log_info "Data directory not found, skipping data backup"
    fi
}

# Clean old backups
cleanup_old_backups() {
    log_step "Cleaning up backups older than $RETENTION_DAYS days..."
    
    local deleted_count=0
    
    # Find and delete old backup files
    while IFS= read -r -d '' file; do
        rm "$file"
        ((deleted_count++))
        log_info "Deleted old backup: $(basename "$file")"
    done < <(find "$BACKUP_DIR" -name "${BACKUP_PREFIX}_*" -type f -mtime +$RETENTION_DAYS -print0 2>/dev/null)
    
    if [[ $deleted_count -gt 0 ]]; then
        log_success "Deleted $deleted_count old backup files"
    else
        log_info "No old backup files to delete"
    fi
}

# Create backup manifest
create_backup_manifest() {
    local timestamp="$1"
    local manifest_file="$BACKUP_DIR/${BACKUP_PREFIX}_manifest_${timestamp}.txt"
    
    shift  # Remove timestamp from arguments
    local backup_files=("$@")
    
    log_step "Creating backup manifest..."
    
    cat > "$manifest_file" <<EOF
Matrix Google Play Bridge Backup Manifest
==========================================

Backup Date: $(date)
Backup Type: Full System Backup
Database Type: $DB_TYPE
Retention Period: $RETENTION_DAYS days
Compression: $COMPRESS_BACKUPS
Encryption: $ENCRYPT_BACKUPS

Backup Files:
EOF
    
    for file in "${backup_files[@]}"; do
        if [[ -f "$file" ]]; then
            local size=$(du -h "$file" | cut -f1)
            local checksum=$(sha256sum "$file" | cut -d' ' -f1)
            echo "- $(basename "$file") (Size: $size, SHA256: $checksum)" >> "$manifest_file"
        fi
    done
    
    echo "" >> "$manifest_file"
    echo "System Information:" >> "$manifest_file"
    echo "- Hostname: $(hostname)" >> "$manifest_file"
    echo "- OS: $(uname -a)" >> "$manifest_file"
    echo "- Bridge Version: $(cat /opt/matrix-googleplay-bridge/package.json | grep '"version"' | cut -d'"' -f4 2>/dev/null || echo "Unknown")" >> "$manifest_file"
    
    log_success "Backup manifest created: $manifest_file"
}

# Display backup summary
display_backup_summary() {
    local timestamp="$1"
    shift
    local backup_files=("$@")
    
    echo ""
    echo -e "${CYAN}=== Backup Summary ===${NC}"
    echo -e "${BLUE}Backup Date:${NC} $(date)"
    echo -e "${BLUE}Backup Directory:${NC} $BACKUP_DIR"
    echo -e "${BLUE}Database Type:${NC} $DB_TYPE"
    echo -e "${BLUE}Compression:${NC} $COMPRESS_BACKUPS"
    echo -e "${BLUE}Encryption:${NC} $ENCRYPT_BACKUPS"
    echo ""
    
    echo -e "${CYAN}=== Backup Files ===${NC}"
    local total_size=0
    for file in "${backup_files[@]}"; do
        if [[ -f "$file" ]]; then
            local size_bytes=$(stat -c%s "$file" 2>/dev/null || echo 0)
            local size_human=$(du -h "$file" | cut -f1)
            total_size=$((total_size + size_bytes))
            echo -e "${BLUE}✓${NC} $(basename "$file") - $size_human"
        fi
    done
    
    local total_size_human=$(numfmt --to=iec $total_size 2>/dev/null || echo "${total_size} bytes")
    echo -e "${BLUE}Total Size:${NC} $total_size_human"
    echo ""
    
    echo -e "${CYAN}=== Next Steps ===${NC}"
    echo -e "${YELLOW}•${NC} Verify backup integrity using the manifest file"
    echo -e "${YELLOW}•${NC} Store backups in a secure, off-site location"
    echo -e "${YELLOW}•${NC} Test backup restoration periodically"
    echo -e "${YELLOW}•${NC} Review backup retention policy ($RETENTION_DAYS days)"
    echo ""
}

# Main backup function
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Matrix Google Play Bridge Backup${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    local timestamp=$(create_timestamp)
    local backup_files=()
    
    # Check prerequisites
    check_prerequisites
    detect_database_type
    
    log_info "Starting backup process with timestamp: $timestamp"
    
    # Stop bridge service temporarily for consistent backup
    if systemctl is-active --quiet matrix-googleplay-bridge 2>/dev/null; then
        log_step "Stopping bridge service for consistent backup..."
        sudo systemctl stop matrix-googleplay-bridge
        local service_was_running=true
    else
        local service_was_running=false
    fi
    
    # Perform backups
    if [[ "$DB_TYPE" == "postgresql" ]]; then
        if db_backup=$(backup_postgresql "$timestamp"); then
            backup_files+=("$db_backup")
        fi
    elif [[ "$DB_TYPE" == "sqlite" ]]; then
        if db_backup=$(backup_sqlite "$timestamp"); then
            backup_files+=("$db_backup")
        fi
    fi
    
    if config_backup=$(backup_configuration "$timestamp"); then
        backup_files+=("$config_backup")
    fi
    
    if data_backup=$(backup_data "$timestamp"); then
        backup_files+=("$data_backup")
    fi
    
    # Restart bridge service if it was running
    if [[ "$service_was_running" == true ]]; then
        log_step "Restarting bridge service..."
        sudo systemctl start matrix-googleplay-bridge
        log_success "Bridge service restarted"
    fi
    
    # Create manifest and cleanup
    create_backup_manifest "$timestamp" "${backup_files[@]}"
    cleanup_old_backups
    display_backup_summary "$timestamp" "${backup_files[@]}"
    
    log_success "Backup process completed successfully!"
}

# Handle script interruption
trap 'echo -e "\n${RED}Backup interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"