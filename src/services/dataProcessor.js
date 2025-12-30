import { logger, loggers } from '../utils/logger.js';
import { DataProcessingError } from '../errors/index.js';
import { IGNORED_ACCOUNTS } from '../constants/index.js';
import { RelevanceCalculator } from './relevanceCalculator.js';
import { appConfig as config } from '../config/index.js';
import moment from 'moment-timezone';

export class DataProcessor {
  constructor(relevanceCalculator = null) {
    this.relevanceCalculator = relevanceCalculator || new RelevanceCalculator();
    this.processingStats = {
      totalProcessed: 0,
      validToots: 0,
      ignoredToots: 0,
      errors: 0
    };
  }

  /**
   * Process toots through the complete pipeline
   */
  processToots(toots, options = {}) {
    const startTime = Date.now();
    
    try {
      logger.info(`Starting to process ${toots.length} toots`, { options });
      
      // Local stats object scoped to this invocation to avoid race conditions
      const localStats = {
        totalProcessed: toots.length,
        validToots: 0,
        ignoredToots: 0,
        errors: 0
      };

      // Pipeline processing
      let processedToots = toots;
      
      // Step 1: Filter valid toots
      processedToots = this.filterValidToots(processedToots, localStats);
      logger.debug(`After filtering valid toots: ${processedToots.length}`, { localStats });
      
      // Step 2: Remove ignored accounts
      processedToots = this.removeIgnoredAccounts(processedToots, localStats);
      logger.debug(`After removing ignored accounts: ${processedToots.length}`, { localStats });
      
      // Step 3: Calculate relevance scores
      processedToots = this.calculateRelevanceScores(processedToots, localStats);
      logger.debug(`After calculating relevance: ${processedToots.length}`, { localStats });
      
      // Step 4: Sort by relevance (descending)
      processedToots = this.sortByRelevance(processedToots);
      logger.debug(`After sorting by relevance: ${processedToots.length}`, { localStats });
      
      // Step 5: Apply optional filters
      if (options.filterByDate) {
        processedToots = this.filterByDate(processedToots, options.filterByDate, options.timezone);
        logger.debug(`After filtering by date: ${processedToots.length}`, { localStats });
      }
      
      if (options.timeframe) {
        processedToots = this.filterByTimeframe(processedToots, options.timeframe, options.timezone);
        logger.debug(`After filtering by timeframe: ${processedToots.length}`, { localStats });
      }
      
      if (options.limit) {
        processedToots = processedToots.slice(0, options.limit);
        logger.debug(`After applying limit: ${processedToots.length}`, { localStats });
      }

      const duration = Date.now() - startTime;
      logger.info(`Completed processing toots`, {
        inputCount: toots.length,
        outputCount: processedToots.length,
        duration,
        stats: localStats
      });

      loggers.performance('toot_processing', duration, {
        inputCount: toots.length,
        outputCount: processedToots.length
      });

      return processedToots;
      
    } catch (error) {
      logger.error('Failed to process toots', { 
        error,
        inputCount: toots.length, 
        options 
      });
      throw new DataProcessingError(
        `Toot processing failed: ${error.message}`,
        'pipeline_processing',
        { inputCount: toots.length, originalError: error.message }
      );
    }
  }

  /**
   * Filter out invalid toots
   */
  filterValidToots(toots, stats = null) {
    if (!Array.isArray(toots)) {
      throw new DataProcessingError('Input must be an array of toots', 'filter_valid');
    }

    const statsToUse = stats || this.processingStats;

    const validToots = toots.filter(toot => {
      const isValid = this.isValidToot(toot);
      
      if (!isValid) {
        statsToUse.errors++;
        logger.warn('Invalid toot filtered out', { 
          tootId: toot?.id, 
          accountId: toot?.account?.id 
        });
      } else {
        statsToUse.validToots++;
      }
      
      return isValid;
    });

    return validToots;
  }

  /**
   * Check if a toot is valid
   */
  isValidToot(toot) {
    if (!toot || typeof toot !== 'object') {
      return false;
    }

    // Required fields
    const requiredFields = ['id', 'created_at', 'content'];
    for (const field of requiredFields) {
      if (!(field in toot)) {
        logger.debug(`Missing required field: ${field}`, { tootId: toot.id });
        return false;
      }
    }

    // Account validation
    if (!toot.account || typeof toot.account !== 'object') {
      logger.debug('Invalid or missing account', { tootId: toot.id });
      return false;
    }

    const requiredAccountFields = ['id', 'username'];
    for (const field of requiredAccountFields) {
      if (!(field in toot.account)) {
        logger.debug(`Missing required account field: ${field}`, { tootId: toot.id });
        return false;
      }
    }

    // Numeric fields validation
    const numericFields = ['favourites_count', 'reblogs_count'];
    for (const field of numericFields) {
      if (field in toot) {
        const value = toot[field];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          logger.debug(`Invalid numeric field: ${field}`, { 
            tootId: toot.id, 
            value: value 
          });
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Remove toots from ignored accounts
   */
  removeIgnoredAccounts(toots, stats = null) {
    const statsToUse = stats || this.processingStats;

    const filteredToots = toots.filter(toot => {
      const isIgnored = IGNORED_ACCOUNTS.has(toot.account.username);
      
      if (isIgnored) {
        statsToUse.ignoredToots++;
        logger.debug(`Removed toot from ignored account: ${toot.account.username}`, {
          tootId: toot.id
        });
      }
      
      return !isIgnored;
    });

    return filteredToots;
  }

  /**
   * Calculate relevance scores for all toots
   */
  calculateRelevanceScores(toots, stats = null) {
    const statsToUse = stats || this.processingStats;

    const scoredToots = toots.map(toot => {
      try {
        return this.relevanceCalculator.calculateRelevance(toot);
      } catch (error) {
        logger.error(`Failed to calculate relevance for toot ${toot.id}`, { error });
        statsToUse.errors++;
        return null;
      }
    }).filter(Boolean); // Remove null results

    return scoredToots;
  }

  /**
   * Sort toots by relevance score (descending)
   * @param {Array} toots - Array of toots to sort
   * @returns {Array} A new sorted array (does not mutate the input array)
   */
  sortByRelevance(toots) {
    return [...toots].sort((a, b) => {
      // Handle missing relevance scores
      const aScore = a.relevanceScore || 0;
      const bScore = b.relevanceScore || 0;
      
      // Sort descending (highest score first)
      return bScore - aScore;
    });
  }

  /**
   * Filter toots by date
   */
  filterByDate(toots, targetDate, clientTimezone = null) {
    if (!targetDate) {
      throw new DataProcessingError('Target date is required for date filtering', 'filter_date');
    }

    // Validate and normalize timezone - prefer client timezone if provided and valid
    let timezone = clientTimezone && moment.tz.zone(clientTimezone) ? clientTimezone : config.server.timezone;
    if (!timezone || !moment.tz.zone(timezone)) {
      logger.warn(`Invalid timezone '${timezone}', defaulting to UTC`, { 
        providedTimezone: timezone 
      });
      timezone = 'UTC';
    }

    // Ensure targetDate is in YYYY-MM-DD format
    const normalizedTargetDate = new Date(targetDate).toISOString().split('T')[0];
    
    const filteredToots = toots.filter(toot => {
      try {
        // Convert toot date to configured timezone
        const tootDate = moment(toot.created_at)
          .tz(timezone)
          .format('YYYY-MM-DD');
        return tootDate === normalizedTargetDate;
      } catch (error) {
        logger.error(`Failed to parse date for toot ${toot.id}`, { error });
        return false;
      }
    });

    logger.debug(`Filtered toots by date ${targetDate}: ${filteredToots.length} remaining`);
    
    return filteredToots;
  }

  /**
   * Filter toots by timeframe (today, week, month, all)
   */
  filterByTimeframe(toots, timeframe, clientTimezone = null) {
    if (!timeframe || timeframe === 'all') {
      return toots;
    }

    // Validate and normalize timezone - prefer client timezone if provided and valid
    let timezone = clientTimezone && moment.tz.zone(clientTimezone) ? clientTimezone : config.server.timezone;
    if (!timezone || !moment.tz.zone(timezone)) {
      logger.warn(`Invalid timezone '${timezone}', defaulting to UTC`, { 
        providedTimezone: timezone 
      });
      timezone = 'UTC';
    }

    const now = moment().tz(timezone);
    let cutoffDate;

    switch (timeframe.toLowerCase()) {
      case 'today':
        cutoffDate = now.clone().startOf('day');
        break;
      case 'week':
        cutoffDate = now.clone().subtract(7, 'days').startOf('day');
        break;
      case 'month':
        cutoffDate = now.clone().subtract(30, 'days').startOf('day');
        break;
      default:
        logger.warn(`Unknown timeframe: ${timeframe}, returning all toots`);
        return toots;
    }

    const filteredToots = toots.filter(toot => {
      try {
        const tootMoment = moment(toot.created_at).tz(timezone);
        return tootMoment.isSameOrAfter(cutoffDate);
      } catch (error) {
        logger.error(`Failed to parse date for toot ${toot.id}`, { error });
        return false;
      }
    });

    logger.debug(`Filtered toots by timeframe ${timeframe}: ${filteredToots.length} remaining`);
    
    return filteredToots;
  }

  /**
   * Get top N toots by relevance
   */
  getTopToots(toots, count = 5) {
    if (!Array.isArray(toots)) {
      throw new DataProcessingError('Input must be an array of toots', 'get_top');
    }

    if (count <= 0) {
      return [];
    }

    // Ensure toots are sorted by relevance first
    const sortedToots = this.sortByRelevance([...toots]);
    return sortedToots.slice(0, count);
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      ...this.processingStats,
      relevanceCalculator: this.relevanceCalculator.getConfig()
    };
  }

  /**
   * Reset processing statistics
   */
  resetStats() {
    this.processingStats = {
      totalProcessed: 0,
      validToots: 0,
      ignoredToots: 0,
      errors: 0
    };
  }

  /**
   * Validate toot data structure
   */
  static validateTootStructure(toot) {
    const errors = [];
    
    if (!toot || typeof toot !== 'object') {
      errors.push('Toot must be an object');
      return errors;
    }

    // Check required fields
    const requiredFields = ['id', 'created_at', 'content', 'account'];
    for (const field of requiredFields) {
      if (!(field in toot)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Check account structure
    if (toot.account) {
      const requiredAccountFields = ['id', 'username'];
      for (const field of requiredAccountFields) {
        if (!(field in toot.account)) {
          errors.push(`Missing required account field: ${field}`);
        }
      }
    }

    return errors;
  }
}

// Create singleton instance
export const dataProcessor = new DataProcessor();