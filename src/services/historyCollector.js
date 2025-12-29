import { databaseService } from './databaseService.js';
import { mastodonService } from './mastodon.js';
import { HASHTAGS, getHashtagsForDay } from '../constants/index.js';
import { logger, loggers } from '../utils/logger.js';
import moment from 'moment-timezone';
import { appConfig as config } from '../config/index.js';

/**
 * Service for collecting and storing hashtag history data
 */
export class HistoryCollector {
  constructor() {
    this.collectedCount = 0;
    this.errorCount = 0;
    this.skippedCount = 0;
  }

  /**
   * Collect history data for a single hashtag
   * @param {string} hashtag - Hashtag to collect data for
   * @param {string} date - Date in YYYY-MM-DD format (defaults to today)
   * @returns {Promise<boolean>} True if collected, false if skipped
   */
  async collectHashtagData(hashtag, date = null) {
    const targetDate = date || moment().tz(config.server.timezone).format('YYYY-MM-DD');

    try {
      // Check if we already have data for this date
      if (databaseService.hasDataForDate(hashtag, targetDate)) {
        logger.debug(`Skipping ${hashtag} for ${targetDate} - data already exists`);
        this.skippedCount++;
        return false;
      }

      logger.info(`Collecting history data for ${hashtag} on ${targetDate}`);

      // Fetch data from Mastodon API
      const history = await mastodonService.getHashtagUse(hashtag);

      if (!history || !Array.isArray(history) || history.length === 0) {
        logger.warn(`No history data found for ${hashtag}`);
        return false;
      }

      // Find data for the target date
      const dayData = history.find(day => day.day === targetDate);

      if (!dayData) {
        logger.warn(`No data found for ${hashtag} on ${targetDate}`);
        return false;
      }

      // Save to database
      databaseService.saveDailyHashtagData(hashtag, targetDate, {
        uses: dayData.uses || 0,
        accounts: dayData.accounts || 0
      });

      this.collectedCount++;
      logger.info(`Successfully collected data for ${hashtag} on ${targetDate}`, {
        uses: dayData.uses,
        accounts: dayData.accounts
      });

      return true;

    } catch (error) {
      this.errorCount++;
      loggers.error(`Failed to collect data for ${hashtag} on ${targetDate}`, error);
      
      // Don't throw - continue with other hashtags
      return false;
    }
  }

  /**
   * Collect history data for all configured hashtags
   * @param {string} date - Date in YYYY-MM-DD format (defaults to today)
   * @returns {Promise<Object>} Collection summary
   */
  async collectAllHashtags(date = null) {
    const targetDate = date || moment().tz(config.server.timezone).format('YYYY-MM-DD');
    
    logger.info(`Starting history collection for all hashtags on ${targetDate}`);

    // Reset counters
    this.collectedCount = 0;
    this.errorCount = 0;
    this.skippedCount = 0;

    // Get all unique hashtags from configuration
    const allHashtags = new Set();
    HASHTAGS.forEach(dayHashtags => {
      const hashtags = getHashtagsForDay(dayHashtags);
      hashtags.forEach(tag => allHashtags.add(tag));
    });

    const hashtagsArray = Array.from(allHashtags);
    logger.info(`Found ${hashtagsArray.length} unique hashtags to collect`);

    // Collect data for each hashtag
    // Process in batches to avoid overwhelming the API
    const batchSize = 3;
    for (let i = 0; i < hashtagsArray.length; i += batchSize) {
      const batch = hashtagsArray.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(hashtag => this.collectHashtagData(hashtag, targetDate))
      );

      // Small delay between batches to respect rate limits
      if (i + batchSize < hashtagsArray.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const summary = {
      date: targetDate,
      totalHashtags: hashtagsArray.length,
      collected: this.collectedCount,
      skipped: this.skippedCount,
      errors: this.errorCount,
      success: this.errorCount === 0
    };

    logger.info('History collection completed', summary);
    loggers.business('history_collection_completed', summary);

    return summary;
  }

  /**
   * Collect historical data for a date range
   * Useful for backfilling missing data
   * @param {string} startDate - Start date in YYYY-MM-DD format
   * @param {string} endDate - End date in YYYY-MM-DD format
   * @returns {Promise<Object>} Collection summary
   */
  async collectDateRange(startDate, endDate) {
    const start = moment.tz(startDate, config.server.timezone);
    const end = moment.tz(endDate, config.server.timezone);

    if (!start.isValid() || !end.isValid()) {
      throw new Error('Invalid date range provided');
    }

    if (start.isAfter(end)) {
      throw new Error('Start date must be before end date');
    }

    logger.info(`Collecting history data for date range: ${startDate} to ${endDate}`);

    const allSummaries = [];
    let currentDate = start.clone();

    while (currentDate.isSameOrBefore(end)) {
      const dateStr = currentDate.format('YYYY-MM-DD');
      logger.info(`Collecting data for ${dateStr}`);
      
      const summary = await this.collectAllHashtags(dateStr);
      allSummaries.push(summary);

      // Move to next day
      currentDate.add(1, 'day');

      // Delay between days to respect rate limits
      if (currentDate.isSameOrBefore(end)) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const totalSummary = {
      dateRange: { start: startDate, end: endDate },
      totalDays: allSummaries.length,
      totalCollected: allSummaries.reduce((sum, s) => sum + s.collected, 0),
      totalSkipped: allSummaries.reduce((sum, s) => sum + s.skipped, 0),
      totalErrors: allSummaries.reduce((sum, s) => sum + s.errors, 0),
      dailySummaries: allSummaries
    };

    logger.info('Date range collection completed', totalSummary);
    return totalSummary;
  }

  /**
   * Get collection statistics
   * @returns {Object} Statistics about recent collections
   */
  getStats() {
    return {
      lastRun: {
        collected: this.collectedCount,
        skipped: this.skippedCount,
        errors: this.errorCount
      }
    };
  }
}

// Export singleton instance
export const historyCollector = new HistoryCollector();
