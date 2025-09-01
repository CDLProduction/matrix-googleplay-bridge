-- Matrix Google Play Bridge - Database Initialization Script
-- This script sets up the initial database structure for PostgreSQL

-- Create database user if not exists
DO $$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_user
      WHERE usename = 'bridge_user') THEN
      
      CREATE USER bridge_user;
   END IF;
END
$$;

-- Set password for bridge user (will be overridden by environment)
-- ALTER USER bridge_user WITH PASSWORD 'placeholder_password';

-- Grant necessary privileges
GRANT CONNECT ON DATABASE matrix_googleplay_bridge TO bridge_user;
GRANT USAGE ON SCHEMA public TO bridge_user;
GRANT CREATE ON SCHEMA public TO bridge_user;

-- Create extensions if available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bridge_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bridge_user;