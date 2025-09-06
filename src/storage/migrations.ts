import { Migration, DatabaseInterface } from './Database';

/**
 * Database migrations for Matrix Google Play Bridge
 * Each migration should be atomic and reversible when possible
 */

export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Create schema_version table',
    up: async (db: DatabaseInterface) => {
      await db.run(`
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY,
          version INTEGER NOT NULL,
          applied_at TEXT NOT NULL
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
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          review_id TEXT NOT NULL UNIQUE,
          matrix_user_id TEXT NOT NULL UNIQUE,
          author_name TEXT NOT NULL,
          package_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_active_at TEXT NOT NULL,
          
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
      await db.run(`
        CREATE TABLE room_mappings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          package_name TEXT NOT NULL,
          matrix_room_id TEXT NOT NULL UNIQUE,
          app_name TEXT NOT NULL,
          room_type TEXT NOT NULL CHECK (room_type IN ('reviews', 'admin', 'general')),
          is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
          config TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          
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
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TABLE room_mappings');
    },
  },

  {
    version: 4,
    description: 'Create message_mappings table',
    up: async (db: DatabaseInterface) => {
      await db.run(`
        CREATE TABLE message_mappings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          google_play_review_id TEXT NOT NULL,
          matrix_event_id TEXT NOT NULL UNIQUE,
          matrix_room_id TEXT NOT NULL,
          message_type TEXT NOT NULL CHECK (message_type IN ('review', 'reply', 'notification')),
          package_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          
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
          created_at TEXT NOT NULL,
          last_modified_at TEXT NOT NULL,
          has_reply INTEGER NOT NULL DEFAULT 0 CHECK (has_reply IN (0, 1)),
          developer_reply_text TEXT,
          developer_reply_created_at TEXT,
          developer_reply_last_modified_at TEXT
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
          content TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          is_bridge_message INTEGER NOT NULL DEFAULT 0 CHECK (is_bridge_message IN (0, 1)),
          
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
      // Auto-update updated_at timestamps
      await db.run(`
        CREATE TRIGGER update_room_mappings_updated_at 
        AFTER UPDATE ON room_mappings
        BEGIN
          UPDATE room_mappings SET updated_at = datetime('now') WHERE id = NEW.id;
        END
      `);

      await db.run(`
        CREATE TRIGGER update_message_mappings_updated_at 
        AFTER UPDATE ON message_mappings
        BEGIN
          UPDATE message_mappings SET updated_at = datetime('now') WHERE id = NEW.id;
        END
      `);

      // Auto-update last_active_at for user_mappings when they're referenced
      await db.run(`
        CREATE TRIGGER update_user_mappings_last_active 
        AFTER UPDATE OF author_name ON user_mappings
        BEGIN
          UPDATE user_mappings SET last_active_at = datetime('now') WHERE id = NEW.id;
        END
      `);
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TRIGGER update_room_mappings_updated_at');
      await db.run('DROP TRIGGER update_message_mappings_updated_at');
      await db.run('DROP TRIGGER update_user_mappings_last_active');
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
        LEFT JOIN room_mappings rm ON gpr.package_name = rm.package_name AND rm.is_primary = 1
        LEFT JOIN message_mappings mm ON gpr.review_id = mm.google_play_review_id
        GROUP BY gpr.review_id
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
      // This migration doesn't create tables but documents maintenance procedures
      // These would be implemented as scheduled tasks or manual operations:

      // 1. Cleanup old Matrix messages (older than 30 days):
      //    DELETE FROM matrix_messages WHERE timestamp < datetime('now', '-30 days');

      // 2. Cleanup inactive user mappings (no activity in 90 days):
      //    DELETE FROM user_mappings WHERE last_active_at < datetime('now', '-90 days');

      // 3. Cleanup orphaned message mappings:
      //    DELETE FROM message_mappings WHERE google_play_review_id NOT IN (SELECT review_id FROM google_play_reviews);

      // 4. Vacuum database monthly:
      //    VACUUM;

      // 5. Update statistics:
      //    ANALYZE;

      // For now, we'll create a maintenance_log table to track cleanup operations
      await db.run(`
        CREATE TABLE maintenance_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          operation_type TEXT NOT NULL,
          operation_details TEXT,
          records_affected INTEGER DEFAULT 0,
          executed_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TABLE maintenance_log');
    },
  },

  {
    version: 11,
    description: 'Create app_configs table for multi-app support',
    up: async (db: DatabaseInterface) => {
      await db.run(`
        CREATE TABLE app_configs (
          package_name TEXT PRIMARY KEY,
          config_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Create indexes for common queries
      await db.run(
        'CREATE INDEX idx_app_configs_updated_at ON app_configs(updated_at)'
      );

      // Create trigger for auto-updating updated_at
      await db.run(`
        CREATE TRIGGER update_app_configs_updated_at 
        AFTER UPDATE ON app_configs
        BEGIN
          UPDATE app_configs SET updated_at = datetime('now') WHERE package_name = NEW.package_name;
        END
      `);
    },
    down: async (db: DatabaseInterface) => {
      await db.run('DROP TRIGGER update_app_configs_updated_at');
      await db.run('DROP TABLE app_configs');
    },
  },
];

/**
 * Get all migrations up to a specific version
 */
export function getMigrationsUpTo(version: number): Migration[] {
  return migrations.filter(m => m.version <= version);
}

/**
 * Get the latest migration version
 */
export function getLatestMigrationVersion(): number {
  return Math.max(...migrations.map(m => m.version));
}

/**
 * Validate migration sequence
 */
export function validateMigrations(): void {
  const versions = migrations.map(m => m.version).sort((a, b) => a - b);

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
  const descriptions = migrations.map(m => m.description);
  const uniqueDescriptions = new Set(descriptions);
  if (descriptions.length !== uniqueDescriptions.size) {
    throw new Error('Duplicate migration descriptions found');
  }
}
