import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { moderateRateLimit } from '../../middleware/rateLimiter.js';
import { hashtagService } from '../../services/hashtagService.js';
import { ValidationError } from '../../errors/index.js';
import { logger } from '../../utils/logger.js';

const router = Router();
// Using singleton instance from service

/**
 * GET /api/dashboard/stats
 * Get comprehensive dashboard statistics
 */
router.get('/stats', moderateRateLimit, asyncHandler(async (req, res) => {
  const { timeframe = 'today', timezone: clientTimezone } = req.query;
  
  // Validate timeframe parameter type
  if (Array.isArray(timeframe)) {
    throw new ValidationError('Invalid timeframe. Must be a single value, not an array.', 'timeframe', timeframe);
  }
  
  if (typeof timeframe !== 'string') {
    throw new ValidationError(`Invalid timeframe. Must be a string, got ${typeof timeframe}.`, 'timeframe', timeframe);
  }
  
  // Validate timeframe value
  const validTimeframes = ['today', 'week', 'month', 'all'];
  const normalizedTimeframe = timeframe.toLowerCase();
  if (!validTimeframes.includes(normalizedTimeframe)) {
    throw new ValidationError(`Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`, 'timeframe', timeframe);
  }
  
  logger.info('Dashboard stats requested', { timeframe: normalizedTimeframe });
  
  try {
    // Get daily hashtag using client timezone
    const dailyHashtag = hashtagService.getDailyHashtag({ timezone: clientTimezone });
    
    // Get comprehensive analysis - limit to 3 pages for faster response time
    const analysis = await hashtagService.analyzeHashtag(dailyHashtag, { 
      maxPages: 3,
      timeframe: normalizedTimeframe,
      timezone: clientTimezone
    });
    
    const stats = {
      hashtag: dailyHashtag,
      timeframe: normalizedTimeframe,
      date: analysis.today,
      summary: {
        tootCount: analysis.getTodayCount(),
        uniqueUsers: analysis.getUniqueUserCount(),
        weeklyTotal: analysis.getWeeklyTotal(),
        averageRelevance: analysis.getAverageRelevance()
      },
      engagement: analysis.getEngagementStats(),
      topToots: analysis.getTopToots(5).map(toot => ({
        id: toot.id,
        author: toot.account.username,
        content: toot.content.slice(0, 200) + '...',
        favorites: toot.favourites_count,
        boosts: toot.reblogs_count,
        relevance: toot.relevanceScore,
        link: toot.url,
        followers: toot.account.followers_count,
        media: toot.media_attachments || []
      })),
      mostActiveUsers: analysis.getMostActiveUsers(5),
      metadata: {
        generatedAt: new Date().toISOString(),
        timezone: process.env.PREFERRED_TIMEZONE || 'America/Sao_Paulo'
      }
    };
    
    res.json(stats);
    
  } catch (error) {
    logger.error('Failed to get dashboard stats', error);
    throw error;
  }
}));

/**
 * GET /api/dashboard/summary
 * Get quick summary of current day's hashtag
 */
router.get('/summary', asyncHandler(async (req, res) => {
  const { timezone: clientTimezone } = req.query;
  
  // Get daily hashtag using client timezone
  const dailyHashtag = hashtagService.getDailyHashtag({ timezone: clientTimezone });
  
  logger.info('Dashboard summary requested', { hashtag: dailyHashtag });
  
  try {
    // Limit to 3 pages for faster response time
    const analysis = await hashtagService.analyzeHashtag(dailyHashtag, { 
      maxPages: 3,
      timezone: clientTimezone 
    });
    
    const topToots = analysis.getTopToots(1);
    const summary = {
      hashtag: dailyHashtag,
      date: analysis.today,
      hasActivity: analysis.hasTodayToots(),
      summary: {
        tootCount: analysis.getTodayCount(),
        uniqueUsers: analysis.getUniqueUserCount(),
        weeklyTotal: analysis.getWeeklyTotal()
      },
      topPost: topToots[0] ? {
        author: topToots[0].account.username,
        relevance: topToots[0].relevanceScore
      } : null,
      lastUpdated: new Date().toISOString()
    };
    
    res.json(summary);
    
  } catch (error) {
    logger.error('Failed to get dashboard summary', error);
    throw error;
  }
}));

/**
 * Validates and normalizes the days query parameter
 * @param {string|number|undefined} daysValue - Raw value from query string
 * @param {number} defaultValue - Default value to use if validation fails
 * @param {number} min - Minimum allowed value (default: 1)
 * @param {number} max - Maximum allowed value (default: 365)
 * @returns {number} Validated and clamped days value
 * @throws {ValidationError} If value is provided but clearly invalid
 */
function validateDaysParameter(daysValue, defaultValue = 7, min = 1, max = 365) {
  // If undefined or null, use default
  if (daysValue === undefined || daysValue === null || daysValue === '') {
    return defaultValue;
  }
  
  // Parse the value
  const parsed = Number(daysValue);
  
  // Check if parsing resulted in NaN (clearly invalid input)
  if (isNaN(parsed)) {
    throw new ValidationError(
      `Invalid days parameter: "${daysValue}". Must be a valid number.`,
      'days',
      daysValue
    );
  }
  
  // Check if it's a finite integer
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ValidationError(
      `Invalid days parameter: "${daysValue}". Must be a finite integer.`,
      'days',
      daysValue
    );
  }
  
  // Clamp to acceptable range
  const clamped = Math.max(min, Math.min(max, parsed));
  
  // If value was provided but needed clamping, log a warning
  if (clamped !== parsed) {
    logger.warn('Days parameter clamped to valid range', {
      original: parsed,
      clamped,
      min,
      max
    });
  }
  
  return clamped;
}

/**
 * GET /api/dashboard/timeline
 * Get timeline data for the past week
 */
router.get('/timeline', moderateRateLimit, asyncHandler(async (req, res) => {
  const { timezone: clientTimezone } = req.query;
  const days = validateDaysParameter(req.query.days, 7, 1, 365);
  
  logger.info('Dashboard timeline requested', { days });
  
  try {
    // Get daily hashtag using client timezone
    const dailyHashtag = hashtagService.getDailyHashtag({ timezone: clientTimezone });
    const history = await hashtagService.getHashtagHistory(dailyHashtag);
    
    // Get the last N days of data
    const timeline = history.slice(-days).map(day => ({
      date: day.day,
      uses: parseInt(day.uses) || 0,
      accounts: day.accounts || 0
    }));
    
    res.json({
      hashtag: dailyHashtag,
      period: `last ${days} days`,
      timeline,
      totalUses: timeline.reduce((sum, day) => sum + day.uses, 0),
      generatedAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get dashboard timeline', error);
    throw error;
  }
}));

/**
 * GET /api/dashboard/performance
 * Get system performance metrics
 */
router.get('/performance', asyncHandler(async (req, res) => {
  logger.info('Dashboard performance requested');
  
  try {
    const performance = {
      system: {
        uptime: process.uptime(),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024)
        },
        cpu: process.cpuUsage(),
        nodeVersion: process.version
      },
      services: {
        hashtag: hashtagService.getStats(),
        mastodon: 'unknown' // Would be populated by mastodonService.getStats()
      },
      cache: {
        hashtagService: hashtagService.getStats().cacheSize
      },
      timestamp: new Date().toISOString()
    };
    
    res.json(performance);
    
  } catch (error) {
    logger.error('Failed to get dashboard performance', error);
    throw error;
  }
}));

/**
 * GET /api/dashboard/alerts
 * Get system alerts and warnings
 */
router.get('/alerts', moderateRateLimit, asyncHandler(async (req, res) => {
  logger.info('Dashboard alerts requested');
  
  try {
    const alerts = [];
    
    // Check memory usage
    const memoryUsage = process.memoryUsage();
    const memoryPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    
    if (memoryPercent > 80) {
      alerts.push({
        type: 'warning',
        category: 'memory',
        message: `High memory usage: ${memoryPercent.toFixed(1)}%`,
        timestamp: new Date().toISOString(),
        severity: memoryPercent > 90 ? 'critical' : 'warning'
      });
    }
    
    // Check daily hashtag activity using client timezone
    const { timezone: clientTimezone } = req.query;
    const dailyHashtag = hashtagService.getDailyHashtag({ timezone: clientTimezone });
    const analysis = await hashtagService.analyzeHashtag(dailyHashtag, { 
      maxPages: 3,
      timezone: clientTimezone 
    });
    
    if (!analysis.hasTodayToots()) {
      alerts.push({
        type: 'info',
        category: 'activity',
        message: `No activity for today's hashtag: #${dailyHashtag}`,
        timestamp: new Date().toISOString(),
        severity: 'info'
      });
    }
    
    // Check cache size
    const cacheStats = hashtagService.getStats();
    if (cacheStats.cacheSize > 100) {
      alerts.push({
        type: 'warning',
        category: 'cache',
        message: `Large cache size: ${cacheStats.cacheSize} items`,
        timestamp: new Date().toISOString(),
        severity: 'warning'
      });
    }
    
    res.json({
      alerts,
      count: alerts.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get dashboard alerts', error);
    throw error;
  }
}));

export { router as dashboardRoutes };