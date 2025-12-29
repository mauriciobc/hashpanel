import { getDatabase } from '../database/index.js';
import { getISOWeek } from '../database/migrations.js';
import { logger } from '../utils/logger.js';
import moment from 'moment-timezone';
import { appConfig as config } from '../config/index.js';

/**
 * Service for hashtag history data persistence and retrieval
 */
export class DatabaseService {
  constructor() {
    this.db = getDatabase().getDatabase();
  }

  /**
   * Save daily hashtag data
   * @param {string} hashtag - Hashtag name
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {Object} data - Data object with uses and accounts
   * @returns {boolean} True if saved, false if already exists
   */
  saveDailyHashtagData(hashtag, date, data) {
    try {
      // Check if data already exists
      if (this.hasDataForDate(hashtag, date)) {
        logger.debug(`Data already exists for ${hashtag} on ${date}, skipping insert`);
        return false;
      }

      const { year, weekNumber } = getISOWeek(date);
      const uses = parseInt(data.uses) || 0;
      const accounts = parseInt(data.accounts) || 0;

      const stmt = this.db.prepare(`
        INSERT INTO hashtag_history 
        (hashtag, date, year, week_number, uses, accounts, collected_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run(hashtag, date, year, weekNumber, uses, accounts);
      
      logger.debug(`Saved daily data for ${hashtag} on ${date}`, { uses, accounts });
      return true;
    } catch (error) {
      logger.error(`Failed to save daily data for ${hashtag} on ${date}`, error);
      throw error;
    }
  }

  /**
   * Get weekly history for a specific hashtag
   * @param {string} hashtag - Hashtag name
   * @param {number} year - Year to query
   * @returns {Array} Array of weekly data objects
   */
  getWeeklyHistory(hashtag, year) {
    try {
      const stmt = this.db.prepare(`
        SELECT 
          week_number,
          MIN(date) as week_start,
          MAX(date) as week_end,
          SUM(uses) as total_uses,
          SUM(accounts) as total_accounts,
          AVG(uses) as daily_average,
          COUNT(*) as days_counted
        FROM hashtag_history
        WHERE hashtag = ? AND year = ?
        GROUP BY week_number
        ORDER BY week_number ASC
      `);

      const results = stmt.all(hashtag, year);
      
      return results.map(row => ({
        weekNumber: row.week_number,
        weekStart: row.week_start,
        weekEnd: row.week_end,
        totalUses: row.total_uses || 0,
        totalAccounts: row.total_accounts || 0,
        dailyAverage: Math.round((row.daily_average || 0) * 10) / 10,
        daysCounted: row.days_counted
      }));
    } catch (error) {
      logger.error(`Failed to get weekly history for ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Get weekly history for all hashtags
   * @param {number} year - Year to query
   * @returns {Object} Object with hashtag as key and weekly data as value
   */
  getAllHashtagsWeeklyHistory(year) {
    try {
      const stmt = this.db.prepare(`
        SELECT 
          hashtag,
          week_number,
          MIN(date) as week_start,
          MAX(date) as week_end,
          SUM(uses) as total_uses,
          SUM(accounts) as total_accounts,
          AVG(uses) as daily_average,
          COUNT(*) as days_counted
        FROM hashtag_history
        WHERE year = ?
        GROUP BY hashtag, week_number
        ORDER BY hashtag, week_number ASC
      `);

      const results = stmt.all(year);
      
      // Group by hashtag
      const grouped = {};
      results.forEach(row => {
        if (!grouped[row.hashtag]) {
          grouped[row.hashtag] = [];
        }
        grouped[row.hashtag].push({
          weekNumber: row.week_number,
          weekStart: row.week_start,
          weekEnd: row.week_end,
          totalUses: row.total_uses || 0,
          totalAccounts: row.total_accounts || 0,
          dailyAverage: Math.round((row.daily_average || 0) * 10) / 10,
          daysCounted: row.days_counted
        });
      });

      return grouped;
    } catch (error) {
      logger.error(`Failed to get all hashtags weekly history for year ${year}`, error);
      throw error;
    }
  }

  /**
   * Get daily history for a specific hashtag
   * @param {string} hashtag - Hashtag name
   * @param {string} startDate - Start date in YYYY-MM-DD format
   * @param {string} endDate - End date in YYYY-MM-DD format (optional)
   * @returns {Array} Array of daily data objects
   */
  getDailyHistory(hashtag, startDate, endDate = null) {
    try {
      let query = `
        SELECT 
          date,
          uses,
          accounts,
          year,
          week_number
        FROM hashtag_history
        WHERE hashtag = ? AND date >= ?
      `;
      const params = [hashtag, startDate];
      
      if (endDate) {
        query += ` AND date <= ?`;
        params.push(endDate);
      }
      
      query += ` ORDER BY date ASC`;
      
      const stmt = this.db.prepare(query);
      const results = stmt.all(...params);
      
      return results.map(row => ({
        date: row.date,
        uses: row.uses || 0,
        accounts: row.accounts || 0,
        year: row.year,
        weekNumber: row.week_number
      }));
    } catch (error) {
      logger.error(`Failed to get daily history for ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Get weekly history filtered by week number
   * @param {string} hashtag - Hashtag name
   * @param {number} year - Year to query
   * @param {number} weekNumber - Week number to filter (optional)
   * @returns {Array} Array of weekly data objects
   */
  getWeeklyHistoryByWeek(hashtag, year, weekNumber = null) {
    try {
      let query = `
        SELECT 
          week_number,
          MIN(date) as week_start,
          MAX(date) as week_end,
          SUM(uses) as total_uses,
          SUM(accounts) as total_accounts,
          AVG(uses) as daily_average,
          COUNT(*) as days_counted
        FROM hashtag_history
        WHERE hashtag = ? AND year = ?
      `;
      const params = [hashtag, year];
      
      if (weekNumber !== null) {
        query += ` AND week_number = ?`;
        params.push(weekNumber);
      }
      
      query += ` GROUP BY week_number ORDER BY week_number ASC`;
      
      const stmt = this.db.prepare(query);
      const results = stmt.all(...params);
      
      return results.map(row => ({
        weekNumber: row.week_number,
        weekStart: row.week_start,
        weekEnd: row.week_end,
        totalUses: row.total_uses || 0,
        totalAccounts: row.total_accounts || 0,
        dailyAverage: Math.round((row.daily_average || 0) * 10) / 10,
        daysCounted: row.days_counted
      }));
    } catch (error) {
      logger.error(`Failed to get weekly history by week for ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Get daily data for a specific date
   * @param {string} hashtag - Hashtag name
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Object|null} Daily data object or null
   */
  getDailyData(hashtag, date) {
    try {
      const stmt = this.db.prepare(`
        SELECT 
          date,
          uses,
          accounts,
          year,
          week_number
        FROM hashtag_history
        WHERE hashtag = ? AND date = ?
      `);

      const result = stmt.get(hashtag, date);
      
      if (!result) {
        return null;
      }
      
      return {
        date: result.date,
        uses: result.uses || 0,
        accounts: result.accounts || 0,
        year: result.year,
        weekNumber: result.week_number
      };
    } catch (error) {
      logger.error(`Failed to get daily data for ${hashtag} on ${date}`, error);
      throw error;
    }
  }

  /**
   * Get latest collection date for a hashtag
   * @param {string} hashtag - Hashtag name
   * @returns {string|null} Latest date in YYYY-MM-DD format or null
   */
  getLatestCollectionDate(hashtag) {
    try {
      const stmt = this.db.prepare(`
        SELECT MAX(date) as latest_date
        FROM hashtag_history
        WHERE hashtag = ?
      `);

      const result = stmt.get(hashtag);
      return result?.latest_date || null;
    } catch (error) {
      logger.error(`Failed to get latest collection date for ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Check if data exists for a specific date
   * @param {string} hashtag - Hashtag name
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {boolean} True if data exists
   * @throws {Error} Re-throws database errors to allow callers to distinguish "no data" from exceptions
   */
  hasDataForDate(hashtag, date) {
    try {
      const stmt = this.db.prepare(`
        SELECT 1
        FROM hashtag_history
        WHERE hashtag = ? AND date = ?
        LIMIT 1
      `);

      const result = stmt.get(hashtag, date);
      return result !== undefined;
    } catch (error) {
      logger.error(`Failed to check data existence for ${hashtag} on ${date}`, error);
      throw error;
    }
  }

  /**
   * Get date range of available data
   * @param {string} hashtag - Hashtag name (optional, null for all)
   * @returns {Object} Object with min and max dates
   */
  getDateRange(hashtag = null) {
    try {
      const baseQuery = `
        SELECT MIN(date) as min_date, MAX(date) as max_date
        FROM hashtag_history
      `;
      const whereClause = hashtag ? ' WHERE hashtag = ?' : '';
      const query = baseQuery + whereClause;
      
      const stmt = this.db.prepare(query);
      const result = hashtag ? stmt.get(hashtag) : stmt.get();
      
      return {
        minDate: result?.min_date || null,
        maxDate: result?.max_date || null
      };
    } catch (error) {
      logger.error('Failed to get date range', error);
      throw error;
    }
  }

  /**
   * Aggregate weekly data for a hashtag
   * Includes summary statistics
   * @param {string} hashtag - Hashtag name
   * @param {number} year - Year to query
   * @returns {Object} Object with weeklyData and summary
   */
  aggregateWeeklyData(hashtag, year) {
    const weeklyData = this.getWeeklyHistory(hashtag, year);
    
    if (weeklyData.length === 0) {
      return {
        hashtag,
        year,
        weeklyData: [],
        summary: {
          totalWeeks: 0,
          totalUses: 0,
          totalAccounts: 0,
          averageWeekly: 0,
          peakWeek: null
        }
      };
    }

    const totalUses = weeklyData.reduce((sum, week) => sum + week.totalUses, 0);
    const totalAccounts = weeklyData.reduce((sum, week) => sum + week.totalAccounts, 0);
    const averageWeekly = Math.round((totalUses / weeklyData.length) * 10) / 10;
    const peakWeek = weeklyData.reduce((max, week) => 
      week.totalUses > max.totalUses ? week : max, 
      weeklyData[0]
    );

    return {
      hashtag,
      year,
      weeklyData,
      summary: {
        totalWeeks: weeklyData.length,
        totalUses,
        totalAccounts,
        averageWeekly,
        peakWeek: {
          weekNumber: peakWeek.weekNumber,
          weekStart: peakWeek.weekStart,
          weekEnd: peakWeek.weekEnd,
          totalUses: peakWeek.totalUses,
          totalAccounts: peakWeek.totalAccounts
        }
      }
    };
  }

  /**
   * Delete old data (cleanup utility)
   * @param {number} daysToKeep - Number of days of data to keep
   * @returns {number} Number of records deleted
   */
  deleteOldData(daysToKeep = 365) {
    try {
      const cutoffDate = moment().tz(config.server.timezone)
        .subtract(daysToKeep, 'days')
        .format('YYYY-MM-DD');

      const stmt = this.db.prepare(`
        DELETE FROM hashtag_history
        WHERE date < ?
      `);

      const info = stmt.run(cutoffDate);
      logger.info(`Deleted ${info.changes} old records before ${cutoffDate}`);
      return info.changes;
    } catch (error) {
      logger.error('Failed to delete old data', error);
      throw error;
    }
  }
}

// Export singleton instance
export const databaseService = new DatabaseService();
