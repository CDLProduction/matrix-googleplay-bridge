#!/bin/bash
# Matrix Google Play Bridge - Restore Script
# This script restores the bridge database and configuration from backups

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
INSTALL_DIR="/opt/matrix-googleplay-bridge"

# Database configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-matrix_googleplay_bridge}"
DB_USER="${DB_USER:-bridge_user}"

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
        log_error "Backup directory not found: $BACKUP_DIR"
        exit 1
    fi
    
    log_info "Prerequisites check passed"
}

# List available backups
list_backups() {
    log_step "Available backups in $BACKUP_DIR:"
    echo ""
    
    local backups_found=false
    
    # Group backups by timestamp
    local timestamps=$(find "$BACKUP_DIR" -name "matrix-googleplay-bridge_*" -type f | \
        sed 's/.*_\([0-9]\{8\}_[0-9]\{6\}\)\..*/\1/' | sort -u)
    
    if [[ -n "$timestamps" ]]; then
        for timestamp in $timestamps; do
            backups_found=true
            echo -e "${CYAN}Backup Set: $timestamp${NC}"
            
            # Find all files for this timestamp
            find "$BACKUP_DIR" -name "*_${timestamp}.*" -type f | while read file; do
                local size=$(du -h "$file" | cut -f1)
                local date=$(date -d "${timestamp:0:8} ${timestamp:9:2}:${timestamp:11:2}:${timestamp:13:2}" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "Unknown")
                echo -e "  ${BLUE}•${NC} $(basename "$file") - $size (Created: $date)"
            done
            echo ""
        done
    fi
    
    if [[ "$backups_found" == false ]]; then
        log_warning "No backups found in $BACKUP_DIR"
        return 1
    fi
    
    return 0
}

# Select backup to restore
select_backup() {
    local timestamps=$(find "$BACKUP_DIR" -name "matrix-googleplay-bridge_*" -type f | \
        sed 's/.*_\([0-9]\{8\}_[0-9]\{6\}\)\..*/\1/' | sort -u -r)
    
    if [[ -z "$timestamps" ]]; then
        log_error "No backups available for restore"
        exit 1
    fi
    
    echo "Available backup timestamps:"
    local i=1
    for timestamp in $timestamps; do
        local date=$(date -d "${timestamp:0:8} ${timestamp:9:2}:${timestamp:11:2}:${timestamp:13:2}" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "Unknown")
        echo "$i) $timestamp ($date)"
        ((i++))
    done
    echo ""
    
    read -p "Select backup to restore (1-$((i-1))): " selection
    
    if ! [[ "$selection" =~ ^[0-9]+$ ]] || [[ "$selection" -lt 1 ]] || [[ "$selection" -ge "$i" ]]; then
        log_error "Invalid selection"
        exit 1
    fi
    
    # Get selected timestamp
    SELECTED_TIMESTAMP=$(echo "$timestamps" | sed -n "${selection}p")
    log_info "Selected backup timestamp: $SELECTED_TIMESTAMP"
}

# Decrypt backup file if needed
decrypt_backup() {
    local encrypted_file="$1"
    local decrypted_file="${encrypted_file%.gpg}"
    
    if [[ "$encrypted_file" == *.gpg ]]; then
        log_step "Decrypting backup file..."
        if gpg --quiet --decrypt "$encrypted_file" > "$decrypted_file"; then
            log_success "Backup decrypted successfully"
            echo "$decrypted_file"
        else
            log_error "Failed to decrypt backup file"
            exit 1
        fi
    else
        echo "$encrypted_file"
    fi
}

# Decompress backup file if needed
decompress_backup() {
    local compressed_file="$1"
    local decompressed_file="${compressed_file%.gz}"
    
    if [[ "$compressed_file" == *.gz ]]; then
        log_step "Decompressing backup file..."
        if gunzip -k "$compressed_file"; then
            log_success "Backup decompressed successfully"
            echo "$decompressed_file"
        else
            log_error "Failed to decompress backup file"
            exit 1
        fi
    else
        echo "$compressed_file"
    fi
}

# Prepare backup file (decrypt and decompress)
prepare_backup_file() {
    local backup_file="$1"
    
    # Decrypt if needed
    backup_file=$(decrypt_backup "$backup_file")
    
    # Decompress if needed
    backup_file=$(decompress_backup "$backup_file")
    
    echo "$backup_file"
}

# Restore PostgreSQL database
restore_postgresql() {
    local backup_file="$1"
    
    log_step "Restoring PostgreSQL database from: $(basename "$backup_file")"
    
    # Check if database exists and ask for confirmation
    export PGPASSWORD="$DB_PASSWORD"
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c '\q' 2>/dev/null; then
        log_warning "Database $DB_NAME already exists. This will overwrite existing data!"
        read -p "Are you sure you want to continue? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Restore cancelled"
            exit 0
        fi
    fi
    
    # Restore database
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$backup_file" 2>/dev/null; then
        unset PGPASSWORD
        log_success "PostgreSQL database restored successfully"
    else
        unset PGPASSWORD
        log_error "Failed to restore PostgreSQL database"
        return 1
    fi
}

# Restore SQLite database
restore_sqlite() {
    local backup_file="$1"
    local sqlite_path="$2"
    
    log_step "Restoring SQLite database from: $(basename "$backup_file")"
    
    # Check if database exists and ask for confirmation
    if [[ -f "$sqlite_path" ]]; then
        log_warning "SQLite database $sqlite_path already exists. This will overwrite existing data!"
        read -p "Are you sure you want to continue? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Restore cancelled"
            exit 0
        fi
        
        # Backup existing database
        local backup_existing="${sqlite_path}.backup.$(date +%s)"
        sudo mv "$sqlite_path" "$backup_existing"
        log_info "Existing database backed up to: $backup_existing"
    fi
    
    # Create directory if needed
    sudo mkdir -p "$(dirname "$sqlite_path")"
    
    # Copy restored database
    if sudo cp "$backup_file" "$sqlite_path"; then
        sudo chown matrix-bridge:matrix-bridge "$sqlite_path"
        sudo chmod 660 "$sqlite_path"
        log_success "SQLite database restored successfully"
    else
        log_error "Failed to restore SQLite database"
        return 1
    fi
}

# Restore configuration files
restore_configuration() {
    local backup_file="$1"
    
    log_step "Restoring configuration from: $(basename "$backup_file")"
    
    # Check if configuration exists and ask for confirmation
    if [[ -d "$CONFIG_DIR" ]] && [[ "$(ls -A "$CONFIG_DIR" 2>/dev/null)" ]]; then
        log_warning "Configuration directory $CONFIG_DIR already exists with files. This will overwrite existing configuration!"
        read -p "Are you sure you want to continue? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Configuration restore cancelled"
            return 0
        fi
        
        # Backup existing configuration
        local backup_existing="${CONFIG_DIR}.backup.$(date +%s)"
        sudo mv "$CONFIG_DIR" "$backup_existing"
        log_info "Existing configuration backed up to: $backup_existing"
    fi
    
    # Create parent directory
    sudo mkdir -p "$(dirname "$CONFIG_DIR")"
    
    # Extract configuration backup
    if sudo tar -xf "$backup_file" -C "$(dirname "$CONFIG_DIR")"; then
        # Set proper permissions
        sudo chmod -R 600 "$CONFIG_DIR"/*
        sudo chmod 755 "$CONFIG_DIR"
        sudo chown -R root:root "$CONFIG_DIR"
        
        log_success "Configuration restored successfully"
    else
        log_error "Failed to restore configuration"
        return 1
    fi
}

# Restore application data
restore_data() {
    local backup_file="$1"
    
    log_step "Restoring application data from: $(basename "$backup_file")"
    
    # Check if data directory exists and ask for confirmation
    if [[ -d "$DATA_DIR" ]] && [[ "$(ls -A "$DATA_DIR" 2>/dev/null)" ]]; then
        log_warning "Data directory $DATA_DIR already exists with files. This will overwrite existing data!"
        read -p "Are you sure you want to continue? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Data restore cancelled"
            return 0
        fi
        
        # Backup existing data
        local backup_existing="${DATA_DIR}.backup.$(date +%s)"
        sudo mv "$DATA_DIR" "$backup_existing"
        log_info "Existing data backed up to: $backup_existing"
    fi
    
    # Create parent directory
    sudo mkdir -p "$(dirname "$DATA_DIR")"
    
    # Extract data backup
    if sudo tar -xf "$backup_file" -C "$(dirname "$DATA_DIR")"; then
        # Set proper permissions
        sudo chown -R matrix-bridge:matrix-bridge "$DATA_DIR"
        sudo chmod -R 755 "$DATA_DIR"
        
        log_success "Application data restored successfully"
    else
        log_error "Failed to restore application data"
        return 1
    fi
}

# Verify restore
verify_restore() {
    log_step "Verifying restore..."
    
    local issues=0
    
    # Check configuration
    if [[ ! -f "$CONFIG_DIR/config.yaml" ]]; then
        log_warning "Main configuration file not found"
        ((issues++))
    else
        log_success "Main configuration file found"
    fi
    
    if [[ ! -f "$CONFIG_DIR/registration.yaml" ]]; then
        log_warning "Registration file not found"
        ((issues++))
    else
        log_success "Registration file found"
    fi
    
    # Check database connectivity
    if [[ -f "$CONFIG_DIR/config.yaml" ]]; then
        if grep -q "type.*postgresql" "$CONFIG_DIR/config.yaml"; then
            export PGPASSWORD="$DB_PASSWORD"
            if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c '\q' 2>/dev/null; then
                unset PGPASSWORD
                log_success "PostgreSQL database connection verified"
            else
                unset PGPASSWORD
                log_warning "PostgreSQL database connection failed"
                ((issues++))
            fi
        elif grep -q "type.*sqlite" "$CONFIG_DIR/config.yaml"; then
            local sqlite_path=$(grep -A 5 "type.*sqlite" "$CONFIG_DIR/config.yaml" | grep "path:" | sed 's/.*path: *//g' | tr -d '"' | tr -d "'")
            if [[ -f "$sqlite_path" ]]; then
                log_success "SQLite database file found"
            else
                log_warning "SQLite database file not found: $sqlite_path"
                ((issues++))
            fi
        fi
    fi
    
    if [[ $issues -eq 0 ]]; then
        log_success "Restore verification completed successfully"
    else
        log_warning "Restore verification found $issues issues"
    fi
    
    return $issues
}

# Display restore summary
display_restore_summary() {
    echo ""
    echo -e "${CYAN}=== Restore Summary ===${NC}"
    echo -e "${BLUE}Restore Date:${NC} $(date)"
    echo -e "${BLUE}Backup Timestamp:${NC} $SELECTED_TIMESTAMP"
    echo -e "${BLUE}Backup Directory:${NC} $BACKUP_DIR"
    echo ""
    
    echo -e "${CYAN}=== Next Steps ===${NC}"
    echo -e "${YELLOW}1.${NC} Review restored configuration files:"
    echo -e "   $CONFIG_DIR/config.yaml"
    echo -e "   $CONFIG_DIR/registration.yaml"
    echo ""
    echo -e "${YELLOW}2.${NC} Update database credentials if needed"
    echo ""
    echo -e "${YELLOW}3.${NC} Start the bridge service:"
    echo -e "   sudo systemctl start matrix-googleplay-bridge"
    echo ""
    echo -e "${YELLOW}4.${NC} Check service status and logs:"
    echo -e "   sudo systemctl status matrix-googleplay-bridge"
    echo -e "   sudo journalctl -u matrix-googleplay-bridge -f"
    echo ""
    echo -e "${YELLOW}5.${NC} Test bridge functionality"
    echo ""
}

# Main restore function
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Matrix Google Play Bridge Restore${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    # Check arguments
    if [[ $# -eq 1 ]] && [[ "$1" == "--list" ]]; then
        check_prerequisites
        list_backups
        exit 0
    fi
    
    # Check prerequisites
    check_prerequisites
    
    # List and select backup
    if ! list_backups; then
        exit 1
    fi
    
    select_backup
    
    # Confirm restore operation
    echo ""
    log_warning "This operation will restore the Matrix Google Play Bridge from backup timestamp: $SELECTED_TIMESTAMP"
    log_warning "This may overwrite existing configuration and data!"
    echo ""
    read -p "Are you sure you want to continue with the restore? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Restore cancelled"
        exit 0
    fi
    
    # Stop bridge service if running
    if systemctl is-active --quiet matrix-googleplay-bridge 2>/dev/null; then
        log_step "Stopping bridge service for restore..."
        sudo systemctl stop matrix-googleplay-bridge
        local service_was_running=true
    else
        local service_was_running=false
    fi
    
    # Find backup files for selected timestamp
    local db_backup=$(find "$BACKUP_DIR" -name "*_db_${SELECTED_TIMESTAMP}.*" -type f | head -1)
    local config_backup=$(find "$BACKUP_DIR" -name "*_config_${SELECTED_TIMESTAMP}.*" -type f | head -1)
    local data_backup=$(find "$BACKUP_DIR" -name "*_data_${SELECTED_TIMESTAMP}.*" -type f | head -1)
    
    # Restore database
    if [[ -n "$db_backup" ]]; then
        prepared_db_backup=$(prepare_backup_file "$db_backup")
        
        # Determine database type from backup file extension
        if [[ "$prepared_db_backup" == *.sql ]]; then
            restore_postgresql "$prepared_db_backup"
        elif [[ "$prepared_db_backup" == *.db ]]; then
            # Try to get SQLite path from config if available
            local sqlite_path="/opt/matrix-googleplay-bridge/data/bridge.db"
            if [[ -f "$CONFIG_DIR/config.yaml" ]]; then
                local config_sqlite_path=$(grep -A 5 "type.*sqlite" "$CONFIG_DIR/config.yaml" | grep "path:" | sed 's/.*path: *//g' | tr -d '"' | tr -d "'" 2>/dev/null)
                if [[ -n "$config_sqlite_path" ]]; then
                    sqlite_path="$config_sqlite_path"
                fi
            fi
            restore_sqlite "$prepared_db_backup" "$sqlite_path"
        fi
        
        # Cleanup temporary files
        [[ "$prepared_db_backup" != "$db_backup" ]] && rm -f "$prepared_db_backup"
    else
        log_warning "No database backup found for timestamp $SELECTED_TIMESTAMP"
    fi
    
    # Restore configuration
    if [[ -n "$config_backup" ]]; then
        prepared_config_backup=$(prepare_backup_file "$config_backup")
        restore_configuration "$prepared_config_backup"
        
        # Cleanup temporary files
        [[ "$prepared_config_backup" != "$config_backup" ]] && rm -f "$prepared_config_backup"
    else
        log_warning "No configuration backup found for timestamp $SELECTED_TIMESTAMP"
    fi
    
    # Restore data
    if [[ -n "$data_backup" ]]; then
        prepared_data_backup=$(prepare_backup_file "$data_backup")
        restore_data "$prepared_data_backup"
        
        # Cleanup temporary files
        [[ "$prepared_data_backup" != "$data_backup" ]] && rm -f "$prepared_data_backup"
    else
        log_info "No data backup found for timestamp $SELECTED_TIMESTAMP"
    fi
    
    # Verify restore
    verify_restore
    
    # Restart service if it was running
    if [[ "$service_was_running" == true ]]; then
        log_step "Starting bridge service..."
        sudo systemctl start matrix-googleplay-bridge
        sleep 3
        
        if systemctl is-active --quiet matrix-googleplay-bridge; then
            log_success "Bridge service started successfully"
        else
            log_warning "Bridge service failed to start. Check logs: journalctl -u matrix-googleplay-bridge"
        fi
    fi
    
    display_restore_summary
    log_success "Restore process completed!"
}

# Handle script interruption
trap 'echo -e "\n${RED}Restore interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"