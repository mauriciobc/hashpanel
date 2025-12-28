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
      
      // Reset stats for this batch
      this.processingStats = {
        totalProcessed: toots.length,
        validToots: 0,
        ignoredToots: 0,
        errors: 0
      };

      // Pipeline processing
      let processedToots = toots;
      
      // Step 1: Filter valid toots
      processedToots = this.filterValidToots(processedToots);
      logger.debug(`After filtering valid toots: ${processedToots.length}`);
      
      // Step 2: Remove ignored accounts
      processedToots = this.removeIgnoredAccounts(processedToots);
      logger.debug(`After removing ignored accounts: ${processedToots.length}`);
      
      // Step 3: Calculate relevance scores
      processedToots = this.calculateRelevanceScores(processedToots);
      logger.debug(`After calculating relevance: ${processedToots.length}`);
      
      // Step 4: Sort by relevance (descending)
      processedToots = this.sortByRelevance(processedToots);
      logger.debug(`After sorting by relevance: ${processedToots.length}`);
      
      // Step 5: Apply optional filters
      if (options.filterByDate) {
        processedToots = this.filterByDate(processedToots, options.filterByDate);
        logger.debug(`After filtering by date: ${processedToots.length}`);
      }
      
      if (options.limit) {
        processedToots = processedToots.slice(0, options.limit);
        logger.debug(`After applying limit: ${processedToots.length}`);
      }

      const duration = Date.now() - startTime;
      logger.info(`Completed processing toots`, {
        inputCount: toots.length,
        outputCount: processedToots.length,
        duration,
        stats: this.processingStats
      });

      loggers.performance('toot_processing', duration, {
        inputCount: toots.length,
        outputCount: processedToots.length
      });

      return processedToots;
      
    } catch (error) {
      loggers.error('Failed to process toots', error, { 
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
  filterValidToots(toots) {
    if (!Array.isArray(toots)) {
      throw new DataProcessingError('Input must be an array of toots', 'filter_valid');
    }

    const validToots = toots.filter(toot => {
      const isValid = this.isValidToot(toot);
      
      if (!isValid) {
        this.processingStats.errors++;
        logger.warn('Invalid toot filtered out', { 
          tootId: toot?.id, 
          accountId: toot?.account?.id 
        });
      } else {
        this.processingStats.validToots++;
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
      if (field in toot && (typeof toot[field] !== 'number' || toot[field] < 0)) {
        logger.debug(`Invalid numeric field: ${field}`, { 
          tootId: toot.id, 
          value: toot[field] 
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Remove toots from ignored accounts
   */
  removeIgnoredAccounts(toots) {
    const filteredToots = toots.filter(toot => {
      const isIgnored = IGNORED_ACCOUNTS.has(toot.account.username);
      
      if (isIgnored) {
        this.processingStats.ignoredToots++;
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
  calculateRelevanceScores(toots) {
    const scoredToots = toots.map(toot => {
      try {
        return this.relevanceCalculator.calculateRelevance(toot);
      } catch (error) {
        loggers.error(`Failed to calculate relevance for toot ${toot.id}`, error);
        this.processingStats.errors++;
        return null;
      }
    }).filter(Boolean); // Remove null results

    return scoredToots;
  }

  /**
   * Sort toots by relevance score (descending)
   */
  sortByRelevance(toots) {
    return toots.sort((a, b) => {
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
  filterByDate(toots, targetDate) {
    if (!targetDate) {
      throw new DataProcessingError('Target date is required for date filtering', 'filter_date');
    }

    // Ensure targetDate is in YYYY-MM-DD format
    const normalizedTargetDate = new Date(targetDate).toISOString().split('T')[0];
    
    const filteredToots = toots.filter(toot => {
      try {
        // Convert toot date to configured timezone
        const tootDate = moment(toot.created_at)
          .tz(config.server.timezone)
          .format('YYYY-MM-DD');
        return tootDate === normalizedTargetDate;
      } catch (error) {
        loggers.error(`Failed to parse date for toot ${toot.id}`, error);
        return false;
      }
    });

    logger.debug(`Filtered toots by date ${targetDate}: ${filteredToots.length} remaining`);
    
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