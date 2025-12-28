import { mastodonService } from './mastodon.js';
import { dataProcessor } from './dataProcessor.js';
import { logger, loggers } from '../utils/logger.js';
import { appConfig as config } from '../config/index.js';
import { BusinessError, NotFoundError } from '../errors/index.js';
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
   */
  getDailyHashtag(date = null) {
    const targetDate = date ? new Date(date) : new Date();
    const dayOfWeek = targetDate.getDay();
    
    const hashtags = [
      'silentsunday',    // Sunday
      'segundaficha',     // Monday
      'tercinema',        // Tuesday
      'quartacapa',       // Wednesday
      'musiquinta',       // Thursday
      'sextaserie',       // Friday
      'caturday'          // Saturday
    ];
    
    const hashtag = hashtags[dayOfWeek];
    
    if (!hashtag) {
      throw new BusinessError(`No hashtag configured for day ${dayOfWeek}`);
    }
    
    return hashtag;
  }

  /**
   * Analyze hashtag usage and statistics
   */
  async analyzeHashtag(hashtag, options = {}) {
    if (!hashtag) {
      throw new BusinessError('Hashtag is required');
    }

    logger.info(`Starting hashtag analysis for: ${hashtag}`, { options });

    try {
      // Get today's date in the configured timezone
      const today = moment().tz(config.server.timezone).format('YYYY-MM-DD');
      
      // Fetch data in parallel
      const [allToots, hashtagHistory] = await Promise.all([
        this.fetchAllToots(hashtag, options),
        this.getHashtagHistory(hashtag)
      ]);

      // Process toots
      const processedToots = dataProcessor.processToots(allToots, {
        filterByDate: today,
        limit: options.limit
      });

      // Create analysis result
      const analysis = new HashtagAnalysis(hashtag, today, processedToots, hashtagHistory);
      
      logger.info(`Completed analysis for hashtag: ${hashtag}`, {
        totalToots: allToots.length,
        todayToots: processedToots.length,
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
   * Get trending tags
   */
  async getTrendingTags(limit = 10) {
    const cacheKey = `trending_tags_${limit}`;
    
    // Check cache first - Node-Cache handles TTL automatically
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug('Using cached trending tags');
      return cached;
    }

    try {
      const tags = await mastodonService.getTrendingTags(limit);
      
      // Cache the results - Node-Cache handles TTL
      this.cache.set(cacheKey, tags);

      return tags;
      
    } catch (error) {
      loggers.error('Failed to fetch trending tags', error);
      return [];
    }
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
  constructor(hashtag, today, toots, history) {
    this.hashtag = hashtag;
    this.today = today;
    this.toots = toots;
    this.history = history || [];
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
   * Get count of today's toots
   */
  getTodayCount() {
    if (this.history && this.history.length > 0) {
      return parseInt(this.history[0].uses) || 0;
    }
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