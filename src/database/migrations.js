import { logger } from '../utils/logger.js';
import moment from 'moment-timezone';
import { appConfig as config } from '../config/index.js';

/**
 * Calculate ISO week number for a given date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {Object} Object with year, weekNumber, weekStart, weekEnd
 */
export function getISOWeek(dateString) {
  const date = moment.tz(dateString, config.server.timezone);
  const year = date.isoWeekYear();
  const weekNumber = date.isoWeek();
  const weekStart = date.clone().startOf('isoWeek').format('YYYY-MM-DD');
  const weekEnd = date.clone().endOf('isoWeek').format('YYYY-MM-DD');
  
  return { year, weekNumber, weekStart, weekEnd };
}

/**
 * Run database migrations
 * @param {Database} db - SQLite database instance
 */
export function runMigrations(db) {
  logger.info('Running database migrations...');

  // Create hashtag_history table
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

  logger.info('Database migrations completed successfully');
}
