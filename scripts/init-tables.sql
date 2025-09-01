-- Matrix Google Play Bridge - Table Initialization Script
-- This script creates the necessary tables for the bridge

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table - Virtual Matrix users for Google Play reviewers
CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    matrix_user_id VARCHAR(255) NOT NULL UNIQUE,
    reviewer_name VARCHAR(255),
    google_play_reviewer_id VARCHAR(255),
    display_name VARCHAR(255),
    avatar_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true
);

-- Create indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_matrix_user_id ON users(matrix_user_id);
CREATE INDEX IF NOT EXISTS idx_users_google_play_reviewer_id ON users(google_play_reviewer_id);
CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users(last_activity);

-- Rooms table - Matrix rooms for Google Play apps
CREATE TABLE IF NOT EXISTS rooms (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    room_id VARCHAR(255) NOT NULL UNIQUE,
    app_package_name VARCHAR(255) NOT NULL,
    app_name VARCHAR(255),
    room_alias VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    configuration JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for rooms table
CREATE INDEX IF NOT EXISTS idx_rooms_room_id ON rooms(room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_app_package_name ON rooms(app_package_name);
CREATE INDEX IF NOT EXISTS idx_rooms_room_alias ON rooms(room_alias);

-- Messages table - Bridge messages and review data
CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    matrix_event_id VARCHAR(255) UNIQUE,
    room_id VARCHAR(255) NOT NULL,
    sender_user_id VARCHAR(255) NOT NULL,
    google_play_review_id VARCHAR(255),
    message_type VARCHAR(50) NOT NULL DEFAULT 'review',
    content TEXT NOT NULL,
    formatted_content TEXT,
    reply_to_event_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    processing_status VARCHAR(50) DEFAULT 'pending'
);

-- Create indexes for messages table
CREATE INDEX IF NOT EXISTS idx_messages_matrix_event_id ON messages(matrix_event_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_google_play_review_id ON messages(google_play_review_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_processing_status ON messages(processing_status);

-- Reviews table - Google Play review data cache
CREATE TABLE IF NOT EXISTS reviews (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    review_id VARCHAR(255) NOT NULL UNIQUE,
    app_package_name VARCHAR(255) NOT NULL,
    reviewer_name VARCHAR(255),
    review_text TEXT,
    star_rating INTEGER,
    reviewer_language VARCHAR(10),
    device_model VARCHAR(255),
    android_version INTEGER,
    app_version_code INTEGER,
    app_version_name VARCHAR(50),
    thumbs_up_count INTEGER DEFAULT 0,
    thumbs_down_count INTEGER DEFAULT 0,
    review_created_at TIMESTAMP WITH TIME ZONE,
    review_modified_at TIMESTAMP WITH TIME ZONE,
    developer_reply_text TEXT,
    developer_reply_created_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processing_status VARCHAR(50) DEFAULT 'pending',
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for reviews table
CREATE INDEX IF NOT EXISTS idx_reviews_review_id ON reviews(review_id);
CREATE INDEX IF NOT EXISTS idx_reviews_app_package_name ON reviews(app_package_name);
CREATE INDEX IF NOT EXISTS idx_reviews_review_created_at ON reviews(review_created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_processing_status ON reviews(processing_status);
CREATE INDEX IF NOT EXISTS idx_reviews_star_rating ON reviews(star_rating);

-- Apps table - Multi-app configuration and state
CREATE TABLE IF NOT EXISTS apps (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    package_name VARCHAR(255) NOT NULL UNIQUE,
    app_name VARCHAR(255),
    room_id VARCHAR(255),
    is_enabled BOOLEAN DEFAULT true,
    polling_interval INTEGER DEFAULT 300000,
    last_poll_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    configuration JSONB DEFAULT '{}'::jsonb,
    statistics JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for apps table
CREATE INDEX IF NOT EXISTS idx_apps_package_name ON apps(package_name);
CREATE INDEX IF NOT EXISTS idx_apps_room_id ON apps(room_id);
CREATE INDEX IF NOT EXISTS idx_apps_is_enabled ON apps(is_enabled);
CREATE INDEX IF NOT EXISTS idx_apps_last_poll_time ON apps(last_poll_time);

-- Audit log table - Security and administrative audit trail
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    user_id VARCHAR(255),
    room_id VARCHAR(255),
    action VARCHAR(255) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT,
    success BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    session_id VARCHAR(255)
);

-- Create indexes for audit_logs table
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_success ON audit_logs(success);

-- Configuration table - Dynamic configuration storage
CREATE TABLE IF NOT EXISTS bridge_config (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    config_key VARCHAR(255) NOT NULL UNIQUE,
    config_value JSONB NOT NULL,
    config_type VARCHAR(50) DEFAULT 'user',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255)
);

-- Create indexes for bridge_config table
CREATE INDEX IF NOT EXISTS idx_bridge_config_key ON bridge_config(config_key);
CREATE INDEX IF NOT EXISTS idx_bridge_config_type ON bridge_config(config_type);

-- Health check table - Service health monitoring
CREATE TABLE IF NOT EXISTS health_checks (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    component VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    response_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for health_checks table
CREATE INDEX IF NOT EXISTS idx_health_checks_component ON health_checks(component);
CREATE INDEX IF NOT EXISTS idx_health_checks_status ON health_checks(status);
CREATE INDEX IF NOT EXISTS idx_health_checks_created_at ON health_checks(created_at);

-- Create functions for updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at columns
DO $$
BEGIN
    -- Users table trigger
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN
        CREATE TRIGGER update_users_updated_at 
            BEFORE UPDATE ON users 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    
    -- Rooms table trigger
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_rooms_updated_at') THEN
        CREATE TRIGGER update_rooms_updated_at 
            BEFORE UPDATE ON rooms 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    
    -- Messages table trigger
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_messages_updated_at') THEN
        CREATE TRIGGER update_messages_updated_at 
            BEFORE UPDATE ON messages 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    
    -- Reviews table trigger
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_reviews_updated_at') THEN
        CREATE TRIGGER update_reviews_updated_at 
            BEFORE UPDATE ON reviews 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    
    -- Apps table trigger
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_apps_updated_at') THEN
        CREATE TRIGGER update_apps_updated_at 
            BEFORE UPDATE ON apps 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    
    -- Bridge config table trigger
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_bridge_config_updated_at') THEN
        CREATE TRIGGER update_bridge_config_updated_at 
            BEFORE UPDATE ON bridge_config 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END
$$;