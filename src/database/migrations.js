import { logger } from '../utils/logger.js';
import moment from 'moment-timezone';
import { appConfig as config } from '../config/index.js';

/**
 * Calculate ISO week number for a given date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {Object} Object with year, weekNumber, weekStart, weekEnd
 * @throws {Error} If dateString is invalid or date cannot be parsed
 */
export function getISOWeek(dateString) {
  // Validate dateString is a non-empty string
  if (!dateString || typeof dateString !== 'string' || dateString.trim() === '') {
    logger.error('getISOWeek: dateString is required and must be a non-empty string', { dateString });
    throw new Error(`Invalid dateString: must be a non-empty string, got: ${dateString}`);
  }

  // Validate and normalize timezone (fallback to UTC if not set or invalid)
  let timezone = config.server?.timezone;
  if (!timezone || !moment.tz.zone(timezone)) {
    logger.warn(`getISOWeek: Invalid timezone '${timezone}', defaulting to UTC`, { providedTimezone: timezone });
    timezone = 'UTC';
  }

  try {
    // Create moment object and validate it's valid
    const date = moment.tz(dateString, timezone);
    if (!date.isValid()) {
      logger.error('getISOWeek: Invalid date string', { dateString, timezone });
      throw new Error(`Invalid date string: "${dateString}" could not be parsed with timezone "${timezone}"`);
    }

    // Calculate ISO week values
    const year = date.isoWeekYear();
    const weekNumber = date.isoWeek();
    const weekStart = date.clone().startOf('isoWeek').format('YYYY-MM-DD');
    const weekEnd = date.clone().endOf('isoWeek').format('YYYY-MM-DD');
    
    return { year, weekNumber, weekStart, weekEnd };
  } catch (error) {
    // Re-throw validation errors as-is, wrap only unexpected errors
    if (error.message.includes('Invalid date string')) {
      throw error;
    }
    // Handle unexpected errors from moment operations
    logger.error('getISOWeek: Unexpected error processing date', { dateString, timezone, error });
    throw new Error(`Failed to calculate ISO week for date "${dateString}": ${error.message}`);
  }
}

/**
 * Run database migrations
 * @param {Database} db - SQLite database instance
 * @throws {Error} If migration fails
 */
export function runMigrations(db) {
  logger.info('Running database migrations...');

  let transactionActive = false;

  try {
    // Begin transaction
    db.exec('BEGIN TRANSACTION');
    transactionActive = true;
    logger.debug('Migration transaction started');

    // Create hashtag_history table and indexes
    db.exec(`
      CREATE TABLE IF NOT EXISTS hashtag_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hashtag TEXT NOT NULL,
        date TEXT NOT NULL,
        year INTEGER NOT NULL,
        week_number INTEGER NOT NULL,
        uses INTEGER DEFAULT 0,
        accounts INTEGER DEFAULT 0,
        collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(hashtag, date)
      );

      CREATE INDEX IF NOT EXISTS idx_hashtag_date ON hashtag_history(hashtag, date);
      CREATE INDEX IF NOT EXISTS idx_hashtag_year_week ON hashtag_history(hashtag, year, week_number);
      CREATE INDEX IF NOT EXISTS idx_date ON hashtag_history(date);
      CREATE INDEX IF NOT EXISTS idx_year ON hashtag_history(year);
    `);

    // Commit transaction
    db.exec('COMMIT');
    transactionActive = false;
    logger.debug('Migration transaction committed');

    logger.info('Database migrations completed successfully');
  } catch (error) {
    // Rollback on any error
    if (transactionActive) {
      try {
        db.exec('ROLLBACK');
        logger.debug('Migration transaction rolled back');
      } catch (rollbackError) {
        logger.error('Failed to rollback migration transaction', {
          originalError: error.message,
          rollbackError: rollbackError.message,
          stack: rollbackError.stack
        });
      }
    }

    // Log error with detailed context
    logger.error('Database migration failed', {
      error: error.message,
      stack: error.stack,
      name: error.name
    });

    // Rethrow to allow caller to handle
    throw new Error(`Migration failed: ${error.message}`);
  }
}
