import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import { appConfig as config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { runMigrations } from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Database service for SQLite
 * Provides connection and basic database operations
 */
export class DatabaseService {
  constructor() {
    // Get database path from environment or use default
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'hashpanel.db');
    
    // Ensure data directory exists (synchronous for constructor)
    const dbDir = path.dirname(dbPath);
    try {
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
    } catch (error) {
      logger.warn(`Could not create database directory: ${dbDir}`, error);
    }

    this.db = new Database(dbPath);
    this.dbPath = dbPath;
    
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
    
    logger.info('Database connection established', { path: dbPath });
  }

  /**
   * Get database instance
   */
  getDatabase() {
    return this.db;
  }

  /**
   * Get database path
   */
  getPath() {
    return this.dbPath;
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      logger.info('Database connection closed');
    }
  }

  /**
   * Run a migration
   */
  migrate() {
    try {
      runMigrations(this.db);
      logger.info('Database migrations completed');
    } catch (error) {
      logger.error('Failed to run migrations', error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  getStats() {
    try {
      const stats = this.db.prepare(`
        SELECT 
          COUNT(*) as total_records,
          COUNT(DISTINCT hashtag) as unique_hashtags,
          MIN(date) as oldest_date,
          MAX(date) as newest_date
        FROM hashtag_history
      `).get();

      return {
        connected: true,
        path: this.dbPath,
        ...stats
      };
    } catch (error) {
      logger.error('Failed to get database stats', error);
      return {
        connected: true,
        path: this.dbPath,
        error: error.message
      };
    }
  }

  /**
   * Check if database is healthy
   */
  healthCheck() {
    try {
      this.db.prepare('SELECT 1').get();
      return { status: 'healthy', connected: true };
    } catch (error) {
      logger.error('Database health check failed', error);
      return { status: 'unhealthy', connected: false, error: error.message };
    }
  }
}

// Singleton instance
let dbInstance = null;

/**
 * Get database instance (singleton)
 */
export function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseService();
    // Run migrations on first connection
    dbInstance.migrate();
  }
  return dbInstance;
}

// Export singleton instance
export const database = getDatabase();
