#!/bin/bash
# Matrix Google Play Bridge - Database Setup Script
# This script sets up the database for the bridge

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
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-matrix_googleplay_bridge}"
DB_USER="${DB_USER:-bridge_user}"
DB_ADMIN_USER="${DB_ADMIN_USER:-postgres}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Check if PostgreSQL tools are available
check_postgresql_tools() {
    if ! command -v psql >/dev/null 2>&1; then
        log_error "psql is not installed. Please install PostgreSQL client tools."
        exit 1
    fi
    
    if ! command -v createdb >/dev/null 2>&1; then
        log_error "createdb is not installed. Please install PostgreSQL client tools."
        exit 1
    fi
    
    log_info "PostgreSQL tools found"
}

# Test database connection
test_connection() {
    local user="$1"
    local database="$2"
    
    export PGPASSWORD="$DB_PASSWORD"
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$user" -d "$database" -c '\q' 2>/dev/null; then
        unset PGPASSWORD
        return 0
    else
        unset PGPASSWORD
        return 1
    fi
}

# Create database
create_database() {
    log_step "Creating database: $DB_NAME"
    
    # Check if database already exists
    export PGPASSWORD="$DB_ADMIN_PASSWORD"
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
        log_warning "Database $DB_NAME already exists"
    else
        createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -O "$DB_USER" "$DB_NAME"
        log_success "Database $DB_NAME created successfully"
    fi
    unset PGPASSWORD
}

# Create database user
create_user() {
    log_step "Creating database user: $DB_USER"
    
    export PGPASSWORD="$DB_ADMIN_PASSWORD"
    
    # Check if user already exists
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d postgres -tAc "SELECT 1 FROM pg_user WHERE usename='$DB_USER'" | grep -q 1; then
        log_warning "User $DB_USER already exists"
    else
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
        log_success "User $DB_USER created successfully"
    fi
    
    # Grant necessary privileges
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" -c "GRANT CONNECT ON DATABASE $DB_NAME TO $DB_USER;"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" -c "GRANT USAGE ON SCHEMA public TO $DB_USER;"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" -c "GRANT CREATE ON SCHEMA public TO $DB_USER;"
    
    unset PGPASSWORD
    log_success "User privileges granted"
}

# Run database initialization scripts
run_init_scripts() {
    log_step "Running database initialization scripts..."
    
    export PGPASSWORD="$DB_ADMIN_PASSWORD"
    
    # Run init-db.sql
    if [[ -f "$SCRIPT_DIR/init-db.sql" ]]; then
        log_info "Running init-db.sql..."
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" -f "$SCRIPT_DIR/init-db.sql"
        log_success "Database initialization completed"
    else
        log_warning "init-db.sql not found, skipping..."
    fi
    
    # Run init-tables.sql  
    if [[ -f "$SCRIPT_DIR/init-tables.sql" ]]; then
        log_info "Running init-tables.sql..."
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d "$DB_NAME" -f "$SCRIPT_DIR/init-tables.sql"
        log_success "Table initialization completed"
    else
        log_warning "init-tables.sql not found, skipping..."
    fi
    
    unset PGPASSWORD
}

# Set up SQLite database (alternative)
setup_sqlite() {
    log_step "Setting up SQLite database..."
    
    local db_file="$1"
    local db_dir=$(dirname "$db_file")
    
    # Create directory if it doesn't exist
    sudo mkdir -p "$db_dir"
    sudo chown matrix-bridge:matrix-bridge "$db_dir"
    
    # Create empty database file
    sudo touch "$db_file"
    sudo chown matrix-bridge:matrix-bridge "$db_file"
    sudo chmod 660 "$db_file"
    
    log_success "SQLite database created at: $db_file"
    log_info "The bridge will automatically create tables on first run"
}

# Verify database setup
verify_setup() {
    log_step "Verifying database setup..."
    
    if test_connection "$DB_USER" "$DB_NAME"; then
        log_success "Database connection verified"
        
        # Check if tables exist
        export PGPASSWORD="$DB_PASSWORD"
        local table_count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
        unset PGPASSWORD
        
        if [[ "$table_count" -gt 0 ]]; then
            log_success "Found $table_count tables in database"
        else
            log_warning "No tables found in database. Tables will be created on first bridge run."
        fi
    else
        log_error "Database connection failed"
        exit 1
    fi
}

# Display connection info
display_info() {
    echo ""
    echo -e "${CYAN}=== Database Setup Complete ===${NC}"
    echo -e "${BLUE}Host:${NC} $DB_HOST"
    echo -e "${BLUE}Port:${NC} $DB_PORT"
    echo -e "${BLUE}Database:${NC} $DB_NAME"
    echo -e "${BLUE}User:${NC} $DB_USER"
    echo ""
    
    echo -e "${CYAN}=== Connection Test ===${NC}"
    echo -e "${BLUE}Test command:${NC} psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
    echo ""
    
    echo -e "${CYAN}=== Next Steps ===${NC}"
    echo -e "${YELLOW}1.${NC} Update your bridge configuration to use this database"
    echo -e "${YELLOW}2.${NC} Start the bridge service"
    echo -e "${YELLOW}3.${NC} Check the bridge logs for any database-related issues"
    echo ""
}

# Main function
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Matrix Google Play Bridge DB Setup${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    # Check arguments
    if [[ $# -eq 0 ]]; then
        echo "Usage: $0 <postgresql|sqlite> [options]"
        echo ""
        echo "PostgreSQL setup:"
        echo "  $0 postgresql"
        echo ""
        echo "SQLite setup:"
        echo "  $0 sqlite [database_file_path]"
        echo ""
        echo "Environment variables for PostgreSQL:"
        echo "  DB_HOST (default: localhost)"
        echo "  DB_PORT (default: 5432)"
        echo "  DB_NAME (default: matrix_googleplay_bridge)"
        echo "  DB_USER (default: bridge_user)"
        echo "  DB_PASSWORD (required)"
        echo "  DB_ADMIN_USER (default: postgres)"
        echo "  DB_ADMIN_PASSWORD (required)"
        echo ""
        exit 1
    fi
    
    local db_type="$1"
    
    case "$db_type" in
        postgresql|postgres)
            # Validate required environment variables
            if [[ -z "$DB_PASSWORD" ]]; then
                log_error "DB_PASSWORD environment variable is required"
                exit 1
            fi
            
            if [[ -z "$DB_ADMIN_PASSWORD" ]]; then
                log_error "DB_ADMIN_PASSWORD environment variable is required"
                exit 1
            fi
            
            log_info "Setting up PostgreSQL database..."
            check_postgresql_tools
            create_user
            create_database
            run_init_scripts
            verify_setup
            display_info
            ;;
        sqlite)
            local db_file="$2"
            if [[ -z "$db_file" ]]; then
                db_file="/opt/matrix-googleplay-bridge/data/bridge.db"
            fi
            
            log_info "Setting up SQLite database at: $db_file"
            setup_sqlite "$db_file"
            ;;
        *)
            log_error "Invalid database type: $db_type"
            log_error "Supported types: postgresql, sqlite"
            exit 1
            ;;
    esac
}

# Handle script interruption
trap 'echo -e "\n${RED}Setup interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"