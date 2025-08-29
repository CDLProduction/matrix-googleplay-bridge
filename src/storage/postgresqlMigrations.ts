import { Migration, DatabaseInterface } from './Database';

/**
 * PostgreSQL-specific database migrations
 * These migrations use PostgreSQL-specific syntax and features
 */

export const postgresqlMigrations: Migration[] = [
  {
    version: 1,
    description: 'Create schema_version table',
    up: async (db: DatabaseInterface) => {
      await db.run(`
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY,
          version INTEGER NOT NULL,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TABLE schema_version');
    },
  },

  {
    version: 2,
    description: 'Create user_mappings table',
    up: async (db: DatabaseInterface) => {
      await db.run(`
        CREATE TABLE user_mappings (
          id SERIAL PRIMARY KEY,
          review_id TEXT NOT NULL UNIQUE,
          matrix_user_id TEXT NOT NULL UNIQUE,
          author_name TEXT NOT NULL,
          package_name TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_active_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          
          CONSTRAINT unique_review_id UNIQUE (review_id),
          CONSTRAINT unique_matrix_user_id UNIQUE (matrix_user_id)
        )
      `);

      // Create indexes for common queries
      await db.run(
        'CREATE INDEX idx_user_mappings_review_id ON user_mappings(review_id)'
      );
      await db.run(
        'CREATE INDEX idx_user_mappings_matrix_user_id ON user_mappings(matrix_user_id)'
      );
      await db.run(
        'CREATE INDEX idx_user_mappings_package_name ON user_mappings(package_name)'
      );
      await db.run(
        'CREATE INDEX idx_user_mappings_last_active ON user_mappings(last_active_at)'
      );
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TABLE user_mappings');
    },
  },

  {
    version: 3,
    description: 'Create room_mappings table',
    up: async (db: DatabaseInterface) => {
      // Create ENUM type for room types
      await db.run(`
        DO $$ BEGIN
          CREATE TYPE room_type_enum AS ENUM ('reviews', 'admin', 'general');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);

      await db.run(`
        CREATE TABLE room_mappings (
          id SERIAL PRIMARY KEY,
          package_name TEXT NOT NULL,
          matrix_room_id TEXT NOT NULL UNIQUE,
          app_name TEXT NOT NULL,
          room_type room_type_enum NOT NULL DEFAULT 'reviews',
          is_primary BOOLEAN NOT NULL DEFAULT FALSE,
          config JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          
          CONSTRAINT unique_matrix_room_id UNIQUE (matrix_room_id)
        )
      `);

      // Create indexes for common queries
      await db.run(
        'CREATE INDEX idx_room_mappings_package_name ON room_mappings(package_name)'
      );
      await db.run(
        'CREATE INDEX idx_room_mappings_matrix_room_id ON room_mappings(matrix_room_id)'
      );
      await db.run(
        'CREATE INDEX idx_room_mappings_room_type ON room_mappings(room_type)'
      );
      await db.run(
        'CREATE INDEX idx_room_mappings_is_primary ON room_mappings(is_primary)'
      );
      await db.run(
        'CREATE INDEX idx_room_mappings_config_gin ON room_mappings USING GIN (config)'
      );
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TABLE room_mappings');
      await db.run('DROP TYPE IF EXISTS room_type_enum');
    },
  },

  {
    version: 4,
    description: 'Create message_mappings table',
    up: async (db: DatabaseInterface) => {
      // Create ENUM type for message types
      await db.run(`
        DO $$ BEGIN
          CREATE TYPE message_type_enum AS ENUM ('review', 'reply', 'notification');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);

      await db.run(`
        CREATE TABLE message_mappings (
          id SERIAL PRIMARY KEY,
          google_play_review_id TEXT NOT NULL,
          matrix_event_id TEXT NOT NULL UNIQUE,
          matrix_room_id TEXT NOT NULL,
          message_type message_type_enum NOT NULL,
          package_name TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          
          CONSTRAINT unique_matrix_event_id UNIQUE (matrix_event_id),
          FOREIGN KEY (matrix_room_id) REFERENCES room_mappings(matrix_room_id) ON DELETE CASCADE
        )
      `);

      // Create indexes for common queries
      await db.run(
        'CREATE INDEX idx_message_mappings_review_id ON message_mappings(google_play_review_id)'
      );
      await db.run(
        'CREATE INDEX idx_message_mappings_matrix_event_id ON message_mappings(matrix_event_id)'
      );
      await db.run(
        'CREATE INDEX idx_message_mappings_matrix_room_id ON message_mappings(matrix_room_id)'
      );
      await db.run(
        'CREATE INDEX idx_message_mappings_package_name ON message_mappings(package_name)'
      );
      await db.run(
        'CREATE INDEX idx_message_mappings_message_type ON message_mappings(message_type)'
      );
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TABLE message_mappings');
      await db.run('DROP TYPE IF EXISTS message_type_enum');
    },
  },

  {
    version: 5,
    description: 'Create google_play_reviews table',
    up: async (db: DatabaseInterface) => {
      await db.run(`
        CREATE TABLE google_play_reviews (
          review_id TEXT PRIMARY KEY,
          package_name TEXT NOT NULL,
          author_name TEXT NOT NULL,
          text TEXT,
          star_rating INTEGER NOT NULL CHECK (star_rating >= 1 AND star_rating <= 5),
          language_code TEXT,
          device TEXT,
          android_os_version TEXT,
          app_version_code INTEGER,
          app_version_name TEXT,
          created_at TIMESTAMP NOT NULL,
          last_modified_at TIMESTAMP NOT NULL,
          has_reply BOOLEAN NOT NULL DEFAULT FALSE,
          developer_reply_text TEXT,
          developer_reply_created_at TIMESTAMP,
          developer_reply_last_modified_at TIMESTAMP
        )
      `);

      // Create indexes for common queries
      await db.run(
        'CREATE INDEX idx_google_play_reviews_package_name ON google_play_reviews(package_name)'
      );
      await db.run(
        'CREATE INDEX idx_google_play_reviews_last_modified ON google_play_reviews(last_modified_at)'
      );
      await db.run(
        'CREATE INDEX idx_google_play_reviews_star_rating ON google_play_reviews(star_rating)'
      );
      await db.run(
        'CREATE INDEX idx_google_play_reviews_has_reply ON google_play_reviews(has_reply)'
      );
      await db.run(
        'CREATE INDEX idx_google_play_reviews_created_at ON google_play_reviews(created_at)'
      );

      // Full-text search index on review text
      await db.run(
        "CREATE INDEX idx_google_play_reviews_text_search ON google_play_reviews USING GIN (to_tsvector('english', text))"
      );
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TABLE google_play_reviews');
    },
  },

  {
    version: 6,
    description: 'Create matrix_messages table',
    up: async (db: DatabaseInterface) => {
      await db.run(`
        CREATE TABLE matrix_messages (
          event_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          content JSONB NOT NULL,
          timestamp TIMESTAMP NOT NULL,
          is_bridge_message BOOLEAN NOT NULL DEFAULT FALSE,
          
          FOREIGN KEY (room_id) REFERENCES room_mappings(matrix_room_id) ON DELETE CASCADE
        )
      `);

      // Create indexes for common queries
      await db.run(
        'CREATE INDEX idx_matrix_messages_room_id ON matrix_messages(room_id)'
      );
      await db.run(
        'CREATE INDEX idx_matrix_messages_sender_id ON matrix_messages(sender_id)'
      );
      await db.run(
        'CREATE INDEX idx_matrix_messages_timestamp ON matrix_messages(timestamp)'
      );
      await db.run(
        'CREATE INDEX idx_matrix_messages_is_bridge ON matrix_messages(is_bridge_message)'
      );
      await db.run(
        'CREATE INDEX idx_matrix_messages_content_gin ON matrix_messages USING GIN (content)'
      );
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TABLE matrix_messages');
    },
  },

  {
    version: 7,
    description: 'Add composite indexes for performance optimization',
    up: async (db: DatabaseInterface) => {
      // Composite indexes for common query patterns
      await db.run(
        'CREATE INDEX idx_user_mappings_package_active ON user_mappings(package_name, last_active_at)'
      );
      await db.run(
        'CREATE INDEX idx_room_mappings_package_primary ON room_mappings(package_name, is_primary, room_type)'
      );
      await db.run(
        'CREATE INDEX idx_message_mappings_room_type ON message_mappings(matrix_room_id, message_type, created_at)'
      );
      await db.run(
        'CREATE INDEX idx_google_play_reviews_package_modified ON google_play_reviews(package_name, last_modified_at)'
      );
      await db.run(
        'CREATE INDEX idx_matrix_messages_room_timestamp ON matrix_messages(room_id, timestamp)'
      );
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP INDEX idx_user_mappings_package_active');
      await db.run('DROP INDEX idx_room_mappings_package_primary');
      await db.run('DROP INDEX idx_message_mappings_room_type');
      await db.run('DROP INDEX idx_google_play_reviews_package_modified');
      await db.run('DROP INDEX idx_matrix_messages_room_timestamp');
    },
  },

  {
    version: 8,
    description: 'Add triggers for automatic timestamp updates',
    up: async (db: DatabaseInterface) => {
      // Function to update timestamps
      await db.run(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
        END;
        $$ language 'plpgsql'
      `);

      // Auto-update updated_at timestamps
      await db.run(`
        CREATE TRIGGER update_room_mappings_updated_at 
        BEFORE UPDATE ON room_mappings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
      `);

      await db.run(`
        CREATE TRIGGER update_message_mappings_updated_at 
        BEFORE UPDATE ON message_mappings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
      `);

      // Auto-update last_active_at for user_mappings
      await db.run(`
        CREATE OR REPLACE FUNCTION update_user_last_active()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.last_active_at = CURRENT_TIMESTAMP;
          RETURN NEW;
        END;
        $$ language 'plpgsql'
      `);

      await db.run(`
        CREATE TRIGGER update_user_mappings_last_active 
        BEFORE UPDATE OF author_name ON user_mappings
        FOR EACH ROW EXECUTE FUNCTION update_user_last_active()
      `);
    },
    down: async (db: DatabaseInterface) => {
      await db.run(
        'DROP TRIGGER update_room_mappings_updated_at ON room_mappings'
      );
      await db.run(
        'DROP TRIGGER update_message_mappings_updated_at ON message_mappings'
      );
      await db.run(
        'DROP TRIGGER update_user_mappings_last_active ON user_mappings'
      );
      await db.run('DROP FUNCTION update_updated_at_column()');
      await db.run('DROP FUNCTION update_user_last_active()');
    },
  },

  {
    version: 9,
    description: 'Create views for common queries',
    up: async (db: DatabaseInterface) => {
      // View for active room mappings with configuration
      await db.run(`
        CREATE VIEW active_room_mappings AS
        SELECT 
          rm.*,
          COUNT(mm.id) as message_count,
          MAX(mm.created_at) as last_message_at
        FROM room_mappings rm
        LEFT JOIN message_mappings mm ON rm.matrix_room_id = mm.matrix_room_id
        GROUP BY rm.id
        ORDER BY rm.package_name, rm.is_primary DESC
      `);

      // View for recent reviews with reply status
      await db.run(`
        CREATE VIEW recent_reviews AS
        SELECT 
          gpr.*,
          rm.app_name,
          rm.matrix_room_id,
          COUNT(mm.id) as bridge_message_count
        FROM google_play_reviews gpr
        LEFT JOIN room_mappings rm ON gpr.package_name = rm.package_name AND rm.is_primary = TRUE
        LEFT JOIN message_mappings mm ON gpr.review_id = mm.google_play_review_id
        GROUP BY gpr.review_id, rm.app_name, rm.matrix_room_id
        ORDER BY gpr.last_modified_at DESC
      `);

      // View for user activity summary
      await db.run(`
        CREATE VIEW user_activity_summary AS
        SELECT 
          um.*,
          COUNT(mm.id) as total_messages,
          MAX(mm.created_at) as last_message_at
        FROM user_mappings um
        LEFT JOIN message_mappings mm ON um.review_id = mm.google_play_review_id
        GROUP BY um.id
        ORDER BY um.last_active_at DESC
      `);
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP VIEW active_room_mappings');
      await db.run('DROP VIEW recent_reviews');
      await db.run('DROP VIEW user_activity_summary');
    },
  },

  {
    version: 10,
    description: 'Add cleanup and maintenance procedures',
    up: async (db: DatabaseInterface) => {
      // Create maintenance_log table
      await db.run(`
        CREATE TABLE maintenance_log (
          id SERIAL PRIMARY KEY,
          operation_type TEXT NOT NULL,
          operation_details TEXT,
          records_affected INTEGER DEFAULT 0,
          executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          duration_ms INTEGER,
          status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'partial'))
        )
      `);

      await db.run(
        'CREATE INDEX idx_maintenance_log_executed_at ON maintenance_log(executed_at)'
      );
      await db.run(
        'CREATE INDEX idx_maintenance_log_operation_type ON maintenance_log(operation_type)'
      );

      // Create stored procedures for maintenance operations
      await db.run(`
        CREATE OR REPLACE FUNCTION cleanup_old_matrix_messages(days_old INTEGER DEFAULT 30)
        RETURNS INTEGER AS $$
        DECLARE
          deleted_count INTEGER;
        BEGIN
          DELETE FROM matrix_messages 
          WHERE timestamp < CURRENT_TIMESTAMP - INTERVAL '1 day' * days_old;
          
          GET DIAGNOSTICS deleted_count = ROW_COUNT;
          
          INSERT INTO maintenance_log (operation_type, operation_details, records_affected, status)
          VALUES ('cleanup_messages', 'Deleted messages older than ' || days_old || ' days', deleted_count, 'success');
          
          RETURN deleted_count;
        END;
        $$ LANGUAGE plpgsql
      `);

      await db.run(`
        CREATE OR REPLACE FUNCTION cleanup_inactive_users(days_inactive INTEGER DEFAULT 90)
        RETURNS INTEGER AS $$
        DECLARE
          deleted_count INTEGER;
        BEGIN
          DELETE FROM user_mappings 
          WHERE last_active_at < CURRENT_TIMESTAMP - INTERVAL '1 day' * days_inactive;
          
          GET DIAGNOSTICS deleted_count = ROW_COUNT;
          
          INSERT INTO maintenance_log (operation_type, operation_details, records_affected, status)
          VALUES ('cleanup_users', 'Deleted users inactive for more than ' || days_inactive || ' days', deleted_count, 'success');
          
          RETURN deleted_count;
        END;
        $$ LANGUAGE plpgsql
      `);

      await db.run(`
        CREATE OR REPLACE FUNCTION cleanup_orphaned_mappings()
        RETURNS INTEGER AS $$
        DECLARE
          deleted_count INTEGER;
        BEGIN
          DELETE FROM message_mappings 
          WHERE google_play_review_id NOT IN (SELECT review_id FROM google_play_reviews);
          
          GET DIAGNOSTICS deleted_count = ROW_COUNT;
          
          INSERT INTO maintenance_log (operation_type, operation_details, records_affected, status)
          VALUES ('cleanup_orphans', 'Deleted orphaned message mappings', deleted_count, 'success');
          
          RETURN deleted_count;
        END;
        $$ LANGUAGE plpgsql
      `);
    },
    down: async (db: DatabaseInterface) => {
      await db.run(
        'DROP FUNCTION IF EXISTS cleanup_old_matrix_messages(INTEGER)'
      );
      await db.run('DROP FUNCTION IF EXISTS cleanup_inactive_users(INTEGER)');
      await db.run('DROP FUNCTION IF EXISTS cleanup_orphaned_mappings()');
      await db.run('DROP TABLE maintenance_log');
    },
  },

  {
    version: 11,
    description: 'Add partitioning for large tables (optional)',
    up: async (db: DatabaseInterface) => {
      // This migration sets up partitioning for large tables
      // This is optional and only beneficial for high-volume deployments

      // Partition matrix_messages by month
      await db.run(`
        -- Enable partition-wise joins (PostgreSQL 11+)
        SET enable_partitionwise_join = on;
        SET enable_partitionwise_aggregate = on;
      `);

      // Create a partitioned version of matrix_messages (for new installations)
      // Existing installations would need a more complex migration
      await db.run(`
        CREATE TABLE matrix_messages_partitioned (
          event_id TEXT,
          room_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          content JSONB NOT NULL,
          timestamp TIMESTAMP NOT NULL,
          is_bridge_message BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY (event_id, timestamp)
        ) PARTITION BY RANGE (timestamp)
      `);

      // Create initial partitions for the current and next month
      const currentDate = new Date();
      const nextMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        1
      );
      const monthAfter = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 2,
        1
      );

      await db.run(`
        CREATE TABLE matrix_messages_${currentDate.getFullYear()}_${(currentDate.getMonth() + 1).toString().padStart(2, '0')} 
        PARTITION OF matrix_messages_partitioned
        FOR VALUES FROM ('${currentDate.toISOString().substring(0, 7)}-01') TO ('${nextMonth.toISOString().substring(0, 7)}-01')
      `);

      await db.run(`
        CREATE TABLE matrix_messages_${nextMonth.getFullYear()}_${(nextMonth.getMonth() + 1).toString().padStart(2, '0')} 
        PARTITION OF matrix_messages_partitioned
        FOR VALUES FROM ('${nextMonth.toISOString().substring(0, 7)}-01') TO ('${monthAfter.toISOString().substring(0, 7)}-01')
      `);
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TABLE IF EXISTS matrix_messages_partitioned CASCADE');
    },
  },
];

/**
 * Get all PostgreSQL migrations up to a specific version
 */
export function getPostgreSQLMigrationsUpTo(version: number): Migration[] {
  return postgresqlMigrations.filter(m => m.version <= version);
}

/**
 * Get the latest PostgreSQL migration version
 */
export function getLatestPostgreSQLMigrationVersion(): number {
  return Math.max(...postgresqlMigrations.map(m => m.version));
}

/**
 * Validate PostgreSQL migration sequence
 */
export function validatePostgreSQLMigrations(): void {
  const versions = postgresqlMigrations
    .map(m => m.version)
    .sort((a, b) => a - b);

  for (let i = 0; i < versions.length; i++) {
    if (i === 0 && versions[i] !== 1) {
      throw new Error('First migration must be version 1');
    }
    if (i > 0 && versions[i] !== versions[i - 1]! + 1) {
      throw new Error(
        `Migration version gap detected: expected ${versions[i - 1]! + 1}, got ${versions[i]}`
      );
    }
  }

  // Check for duplicate descriptions
  const descriptions = postgresqlMigrations.map(m => m.description);
  const uniqueDescriptions = new Set(descriptions);
  if (descriptions.length !== uniqueDescriptions.size) {
    throw new Error('Duplicate migration descriptions found');
  }
}
