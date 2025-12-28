import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { heavyRateLimit } from '../../middleware/rateLimiter.js';
import { hashtagService } from '../../services/hashtagService.js';
import { logger } from '../../utils/logger.js';

const router = Router();
// Using singleton instance from service

/**
 * GET /api/dashboard/stats
 * Get comprehensive dashboard statistics
 */
router.get('/stats', heavyRateLimit, asyncHandler(async (req, res) => {
  const { timeframe = 'today' } = req.query;
  
  logger.info('Dashboard stats requested', { timeframe });
  
  try {
    // Get daily hashtag
    const dailyHashtag = hashtagService.getDailyHashtag();
    
    // Get comprehensive analysis - limit to 3 pages for faster response time
    const analysis = await hashtagService.analyzeHashtag(dailyHashtag, { maxPages: 3 });
    
    const stats = {
      hashtag: dailyHashtag,
      timeframe,
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
  const dailyHashtag = hashtagService.getDailyHashtag();
  
  logger.info('Dashboard summary requested', { hashtag: dailyHashtag });
  
  try {
    // Limit to 3 pages for faster response time
    const analysis = await hashtagService.analyzeHashtag(dailyHashtag, { maxPages: 3 });
    
    const summary = {
      hashtag: dailyHashtag,
      date: analysis.today,
      hasActivity: analysis.hasTodayToots(),
      summary: {
        tootCount: analysis.getTodayCount(),
        uniqueUsers: analysis.getUniqueUserCount(),
        weeklyTotal: analysis.getWeeklyTotal()
      },
      topPost: analysis.getTopToots(1)[0] ? {
        author: analysis.getTopToots(1)[0].account.username,
        relevance: analysis.getTopToots(1)[0].relevanceScore
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
 * GET /api/dashboard/timeline
 * Get timeline data for the past week
 */
router.get('/timeline', heavyRateLimit, asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;
  
  logger.info('Dashboard timeline requested', { days });
  
  try {
    const dailyHashtag = hashtagService.getDailyHashtag();
    const history = await hashtagService.getHashtagHistory(dailyHashtag);
    
    // Get the last N days of data
    const timeline = history.slice(-parseInt(days)).map(day => ({
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
router.get('/alerts', asyncHandler(async (req, res) => {
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
    
    // Check daily hashtag activity
    const dailyHashtag = hashtagService.getDailyHashtag();
    const analysis = await hashtagService.analyzeHashtag(dailyHashtag);
    
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