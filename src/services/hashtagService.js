import { mastodonService } from './mastodon.js';
import { dataProcessor } from './dataProcessor.js';
import { logger, loggers } from '../utils/logger.js';
import { appConfig as config } from '../config/index.js';
import { BusinessError, NotFoundError } from '../errors/index.js';
import { HASHTAGS, getFirstHashtagForDay } from '../constants/index.js';
import moment from 'moment-timezone';
import NodeCache from 'node-cache';

export class HashtagService {
  constructor() {
    this.cache = new NodeCache({
      stdTTL: config.cache.ttlSeconds || 300,
      checkperiod: 60,
      useClones: false
    });
  }

  /**
   * Get the daily hashtag based on current date
   * Returns the first hashtag if multiple are configured for the day
   */
  getDailyHashtag(date = null) {
    const targetDate = date ? new Date(date) : new Date();
    const dayOfWeek = targetDate.getDay();
    
    const hashtagEntry = HASHTAGS[dayOfWeek];
    
    if (!hashtagEntry) {
      throw new BusinessError(`No hashtag configured for day ${dayOfWeek}`);
    }
    
    // Return first hashtag if multiple are configured
    return getFirstHashtagForDay(hashtagEntry);
  }

  /**
   * Analyze hashtag usage and statistics
   */
  async analyzeHashtag(hashtag, options = {}) {
    if (!hashtag) {
      throw new BusinessError('Hashtag is required');
    }

    const maxPages = options.maxPages || config.performance.maxApiPages;
    const timeframe = options.timeframe || 'today';

    // Validate and normalize timeframe parameter first
    const allowedTimeframes = ['today', 'week', 'month', 'all'];
    let normalizedTimeframe = timeframe;
    
    if (!allowedTimeframes.includes(normalizedTimeframe)) {
      logger.warn(`Invalid timeframe '${normalizedTimeframe}' provided, normalizing to 'all'`, {
        hashtag,
        invalidTimeframe: normalizedTimeframe,
        allowedTimeframes
      });
      normalizedTimeframe = 'all';
    }

    // Build cache key using normalized timeframe to prevent cache fragmentation
    const cacheKey = `analysis_${hashtag}_${maxPages}_${normalizedTimeframe}`;

    // Check analysis cache
    const cachedAnalysis = this.cache.get(cacheKey);
    if (cachedAnalysis) {
      logger.debug(`Using cached analysis for hashtag: ${hashtag}`, { timeframe: normalizedTimeframe, maxPages });
      return cachedAnalysis;
    }

    logger.info(`Starting hashtag analysis for: ${hashtag}`, { options });

    try {
      // Get today's date in the configured timezone
      const today = moment().tz(config.server.timezone).format('YYYY-MM-DD');
      
      // Determine filtering strategy based on timeframe
      const shouldFilterByDate = normalizedTimeframe === 'today';
      
      // Fetch data in parallel
      const [allToots, hashtagHistory] = await Promise.all([
        this.fetchAllToots(hashtag, options),
        this.getHashtagHistory(hashtag)
      ]);

      // Process toots with appropriate filtering
      const processOptions = {
        limit: options.limit
      };
      
      if (shouldFilterByDate) {
        // For 'today', use date filter for precision
        processOptions.filterByDate = today;
      } else if (normalizedTimeframe !== 'all') {
        // For 'week' or 'month', use timeframe filter
        processOptions.timeframe = normalizedTimeframe;
      }
      // For 'all', no date filtering

      const processedToots = dataProcessor.processToots(allToots, processOptions);

      // Create analysis result
      const analysis = new HashtagAnalysis(hashtag, today, processedToots, hashtagHistory, normalizedTimeframe);
      
      // Cache the result
      this.cache.set(cacheKey, analysis);

      logger.info(`Completed analysis for hashtag: ${hashtag}`, {
        totalToots: allToots.length,
        filteredToots: processedToots.length,
        timeframe: normalizedTimeframe,
        weeklyTotal: analysis.getWeeklyTotal()
      });

      return analysis;
      
    } catch (error) {
      loggers.error(`Failed to analyze hashtag: ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Fetch all toots for a hashtag
   */
  async fetchAllToots(hashtag, options = {}) {
    const cacheKey = `toots_${hashtag}_${moment().format('YYYY-MM-DD')}`;
    
    // Check cache first - Node-Cache handles TTL automatically
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug(`Using cached toots for hashtag: ${hashtag}`);
      return cached;
    }

    try {
      const toots = await mastodonService.fetchAllToots(
        hashtag, 
        options.maxPages || config.performance.maxApiPages
      );

      // Cache the results - Node-Cache handles TTL
      this.cache.set(cacheKey, toots);

      return toots;
      
    } catch (error) {
      loggers.error(`Failed to fetch toots for hashtag: ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Get hashtag usage history
   */
  async getHashtagHistory(hashtag) {
    try {
      const history = await mastodonService.getHashtagUse(hashtag);
      return history || [];
    } catch (error) {
      loggers.error(`Failed to get hashtag history for: ${hashtag}`, error);
      return [];
    }
  }

  /**
   * Get trending tags with pagination support
   * Returns { tags, totalCount } where totalCount is the real total from the API
   */
  async getTrendingTags(limit = 10, offset = 0) {
    const cacheKey = `trending_tags_all`;
    const totalCountCacheKey = `trending_tags_total`;
    
    // Check cache for total count first
    let totalCount = this.cache.get(totalCountCacheKey);
    let allTags = this.cache.get(cacheKey);
    
    // If we don't have cached data, fetch all tags (up to API max of 100) to get total
    if (totalCount === undefined || allTags === undefined) {
      try {
        // Fetch maximum allowed (100) to determine total count
        allTags = await mastodonService.getTrendingTags(100, 0);
        totalCount = allTags.length;
        
        // Cache both the tags and total count
        this.cache.set(cacheKey, allTags);
        this.cache.set(totalCountCacheKey, totalCount);
        
        logger.debug('Fetched and cached trending tags for total count', { totalCount });
      } catch (error) {
        loggers.error('Failed to fetch trending tags for total count', error);
        // If we can't get total, return empty and let caller handle fallback
        return { tags: [], totalCount: null };
      }
    } else {
      logger.debug('Using cached trending tags for pagination');
    }

    // Apply offset and limit to the cached/fetched tags
    const paginatedTags = allTags.slice(offset, offset + limit);

    return {
      tags: paginatedTags,
      totalCount: totalCount
    };
  }

  /**
   * Get hashtag statistics for today
   */
  async getTodayStats(hashtag) {
    const analysis = await this.analyzeHashtag(hashtag);
    
    return {
      hashtag,
      date: analysis.today,
      tootCount: analysis.getTodayCount(),
      uniqueUsers: analysis.getUniqueUserCount(),
      topToots: analysis.getTopToots(5),
      averageRelevance: analysis.getAverageRelevance()
    };
  }

  /**
   * Get weekly hashtag statistics
   */
  async getWeeklyStats(hashtag) {
    const history = await this.getHashtagHistory(hashtag);
    
    if (!history || history.length === 0) {
      throw new NotFoundError(`No history found for hashtag: ${hashtag}`);
    }

    // Get last 7 days of history
    const weeklyHistory = history.slice(-7);
    const totalUses = weeklyHistory.reduce((sum, day) => sum + (parseInt(day.uses) || 0), 0);
    
    return {
      hashtag,
      period: '7 days',
      totalUses,
      dailyAverage: Math.round(totalUses / weeklyHistory.length),
      history: weeklyHistory
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.flushAll();
    logger.info('Hashtag service cache cleared');
  }

  /**
   * Get service statistics
   */
  getStats() {
    const stats = this.cache.getStats();
    return {
      cacheSize: stats.keys,
      cacheTTL: config.cache.ttlSeconds,
      hits: stats.hits,
      misses: stats.misses,
      ksize: stats.ksize,
      vsize: stats.vsize
    };
  }
}

/**
 * Hashtag analysis result class
 */
export class HashtagAnalysis {
  constructor(hashtag, today, toots, history, timeframe = 'today') {
    this.hashtag = hashtag;
    this.today = today;
    this.toots = toots;
    this.history = history || [];
    this.timeframe = timeframe;
    this.createdAt = new Date();
    this._cachedStats = null;
  }

  /**
   * Calculate all statistics in a single pass
   */
  _calculateStats() {
    if (this._cachedStats) return this._cachedStats;

    const stats = {
      totalRelevance: 0,
      userCounts: {},
      engagement: {
        totalFavorites: 0,
        totalBoosts: 0,
        totalReplies: 0
      }
    };

    // Single pass through all toots
    this.toots.forEach(toot => {
      // Calculate relevance total
      stats.totalRelevance += toot.relevanceScore || 0;

      // Count user posts
      const username = toot.account.username;
      stats.userCounts[username] = (stats.userCounts[username] || 0) + 1;

      // Sum engagement metrics
      stats.engagement.totalFavorites += toot.favourites_count || 0;
      stats.engagement.totalBoosts += toot.reblogs_count || 0;
      stats.engagement.totalReplies += toot.replies_count || 0;
    });

    // Calculate derived stats
    const count = this.toots.length;
    stats.averageRelevance = count > 0 ? Math.round((stats.totalRelevance / count) * 10) / 10 : 0;
    stats.averageFavorites = count > 0 ? Math.round(stats.engagement.totalFavorites / count * 10) / 10 : 0;
    stats.averageBoosts = count > 0 ? Math.round(stats.engagement.totalBoosts / count * 10) / 10 : 0;
    stats.averageReplies = count > 0 ? Math.round(stats.engagement.totalReplies / count * 10) / 10 : 0;

    // Sort users by post count
    stats.mostActiveUsers = Object.entries(stats.userCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([username, count]) => ({ username, count }));

    this._cachedStats = stats;
    return stats;
  }

  /**
   * Check if there are toots from today
   */
  hasTodayToots() {
    return this.toots.length > 0;
  }

  /**
   * Get count of toots for the current timeframe
   */
  getTodayCount() {
    // For 'today' timeframe, use history if available for accuracy
    if (this.timeframe === 'today' && this.history && this.history.length > 0) {
      return parseInt(this.history[0].uses) || 0;
    }
    // For other timeframes or when history is not available, use filtered toots count
    return this.toots.length;
  }

  /**
   * Get unique user count
   */
  getUniqueUserCount() {
    if (this.history && this.history.length > 0 && this.history[0].accounts) {
      return parseInt(this.history[0].accounts) || 0;
    }
    const uniqueUsers = new Set(this.toots.map(toot => toot.account.username));
    return uniqueUsers.size;
  }

  /**
   * Get weekly total from history
   */
  getWeeklyTotal() {
    if (!this.history || this.history.length === 0) {
      return 0;
    }
    
    return this.history.reduce((sum, day) => sum + (parseInt(day.uses) || 0), 0);
  }

  /**
   * Get top toots by relevance
   * Note: toots are already sorted by relevance from dataProcessor.processToots
   */
  getTopToots(count = 5) {
    return this.toots.slice(0, count);
  }

  /**
   * Get average relevance score
   */
  getAverageRelevance() {
    if (this.toots.length === 0) {
      return 0;
    }
    const stats = this._calculateStats();
    return stats.averageRelevance;
  }

  /**
   * Get most active users
   */
  getMostActiveUsers(count = 5) {
    const stats = this._calculateStats();
    return stats.mostActiveUsers.slice(0, count);
  }

  /**
   * Get engagement statistics
   */
  getEngagementStats() {
    if (this.toots.length === 0) {
      return {
        totalFavorites: 0,
        totalBoosts: 0,
        totalReplies: 0,
        averageFavorites: 0,
        averageBoosts: 0,
        averageReplies: 0
      };
    }

    const stats = this._calculateStats();
    const engagement = stats.engagement;

    return {
      totalFavorites: engagement.totalFavorites,
      totalBoosts: engagement.totalBoosts,
      totalReplies: engagement.totalReplies,
      averageFavorites: stats.averageFavorites,
      averageBoosts: stats.averageBoosts,
      averageReplies: stats.averageReplies
    };
  }

  /**
   * Export analysis as JSON
   */
  toJSON() {
    return {
      hashtag: this.hashtag,
      today: this.today,
      summary: {
        tootCount: this.getTodayCount(),
        uniqueUsers: this.getUniqueUserCount(),
        weeklyTotal: this.getWeeklyTotal(),
        averageRelevance: this.getAverageRelevance()
      },
      topToots: this.getTopToots(5).map(toot => ({
        id: toot.id,
        username: toot.account.username,
        relevanceScore: toot.relevanceScore,
        favorites: toot.favourites_count,
        boosts: toot.reblogs_count
      })),
      mostActiveUsers: this.getMostActiveUsers(5),
      engagement: this.getEngagementStats(),
      createdAt: this.createdAt
    };
  }
}

// Export singleton instance for use across the application
export const hashtagService = new HashtagService();