import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { moderateRateLimit } from '../../middleware/rateLimiter.js';
import { hashtagService } from '../../services/hashtagService.js';
import { ValidationError } from '../../errors/index.js';
import { logger } from '../../utils/logger.js';
import { HASHTAGS, getHashtagsForDay, getFirstHashtagForDay } from '../../constants/index.js';

const router = Router();
// Using singleton instance from service

/**
 * GET /api/hashtag/current
 * Get current day's hashtag
 */
router.get('/current', asyncHandler(async (req, res) => {
  const currentHashtag = hashtagService.getDailyHashtag();
  
  logger.info('Current hashtag requested', { hashtag: currentHashtag });
  
  res.json({
    hashtag: currentHashtag,
    date: new Date().toISOString(),
    dayOfWeek: new Date().getDay()
  });
}));

/**
 * GET /api/hashtag/:hashtag/stats
 * Get statistics for a specific hashtag
 */
router.get('/:hashtag/stats', moderateRateLimit, asyncHandler(async (req, res) => {
  const { hashtag } = req.params;
  const { timeframe = 'today' } = req.query;
  
  if (!hashtag) {
    throw new ValidationError('Hashtag is required');
  }
  
  // Validate timeframe parameter
  const validTimeframes = ['today', 'week', 'month', 'all'];
  if (!validTimeframes.includes(timeframe.toLowerCase())) {
    throw new ValidationError(`Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`);
  }
  
  // Normalize hashtag - remove # sign if present
  const normalizedHashtag = hashtag.replace(/^#/, '');
  const normalizedTimeframe = timeframe.toLowerCase();
  
  logger.info('Hashtag stats requested', { original: hashtag, normalized: normalizedHashtag, timeframe: normalizedTimeframe });
  
  try {
    // Limit to 3 pages for stats endpoint to improve response time (3 pages = ~120 toots)
    // This is enough for accurate statistics while keeping response time under 5 seconds
    const analysis = await hashtagService.analyzeHashtag(normalizedHashtag, { 
      maxPages: 3,
      timeframe: normalizedTimeframe 
    });
    
    const stats = {
      hashtag: normalizedHashtag,
      timeframe: normalizedTimeframe,
      summary: {
        tootCount: analysis.getTodayCount(),
        uniqueUsers: analysis.getUniqueUserCount(),
        weeklyTotal: analysis.getWeeklyTotal(),
        averageRelevance: analysis.getAverageRelevance()
      },
      engagement: analysis.getEngagementStats(),
      topToots: analysis.getTopToots(10).map(toot => ({
        id: toot.id,
        author: toot.account.username,
        content: toot.content.slice(0, 300) + (toot.content.length > 300 ? '...' : ''),
        favorites: toot.favourites_count,
        boosts: toot.reblogs_count,
        replies: toot.replies_count,
        relevance: toot.relevanceScore,
        createdAt: toot.created_at,
        link: toot.url,
        followers: toot.account.followers_count,
        media: toot.media_attachments || []
      })),
      mostActiveUsers: analysis.getMostActiveUsers(10),
      metadata: {
        generatedAt: analysis.createdAt,
        timezone: process.env.PREFERRED_TIMEZONE || 'America/Sao_Paulo'
      }
    };
    
    logger.info(`Successfully generated stats for hashtag: ${hashtag}`, {
      tootCount: stats.summary.tootCount,
      uniqueUsers: stats.summary.uniqueUsers
    });
    
    res.json(stats);
    
  } catch (error) {
    logger.error(`Failed to get stats for hashtag: ${hashtag}`, error);
    
    // Check if it's a not found error (hashtag doesn't exist)
    if (error.name === 'NotFoundError' || error.message?.includes('not found')) {
      return res.status(404).json({
        error: {
          message: `A hashtag #${hashtag} não foi encontrada ou não possui dados recentes.`,
          code: 'HASHTAG_NOT_FOUND',
          hashtag,
          suggestion: 'Tente outra hashtag ou aguarde novos posts.'
        }
      });
    }
    
    // Check if it's a rate limit error
    if (error.name === 'RateLimitError' || error.message?.includes('rate limit')) {
      return res.status(429).json({
        error: {
          message: 'Limite de requisições da API do Mastodon atingido. Aguarde alguns minutos.',
          code: 'RATE_LIMIT_EXCEEDED'
        }
      });
    }
    
    // Re-throw other errors to be handled by the main error handler
    throw error;
  }
}));

/**
 * GET /api/hashtag/:hashtag/timeline
 * Get timeline data for a hashtag
 */
router.get('/:hashtag/timeline', moderateRateLimit, asyncHandler(async (req, res) => {
  const { hashtag } = req.params;
  const { days = 7, limit = 50 } = req.query;
  
  if (!hashtag) {
    throw new ValidationError('Hashtag is required');
  }
  
  logger.info('Hashtag timeline requested', { hashtag, days, limit });
  
  try {
    const history = await hashtagService.getHashtagHistory(hashtag);
    const analysis = await hashtagService.analyzeHashtag(hashtag, { limit: parseInt(limit) });
    
    const timeline = history.slice(-parseInt(days)).map(day => ({
      date: day.day,
      uses: parseInt(day.uses) || 0,
      accounts: day.accounts || 0,
      averageRelevance: 0 // Would need to calculate from historical data
    }));
    
    // Calculate summary statistics with safe guards for empty timeline
    const totalUses = timeline.reduce((sum, day) => sum + day.uses, 0);
    const averageDaily = timeline.length === 0 ? 0 : Math.round(totalUses / timeline.length);
    const peakDay = timeline.length === 0 
      ? { date: null, uses: 0, accounts: 0, averageRelevance: 0 }
      : timeline.reduce((max, day) => day.uses > max.uses ? day : max, timeline[0]);
    const activeDays = timeline.filter(day => day.uses > 0).length;
    
    res.json({
      hashtag,
      period: `last ${days} days`,
      timeline,
      summary: {
        totalUses,
        averageDaily,
        peakDay,
        activeDays
      },
      recentActivity: {
        tootCount: analysis.getTodayCount(),
        uniqueUsers: analysis.getUniqueUserCount(),
        topToots: analysis.getTopToots(5).map(toot => ({
          id: toot.id,
          author: toot.account.username,
          relevance: toot.relevanceScore
        }))
      },
      generatedAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Failed to get timeline for hashtag: ${hashtag}`, error);
    throw error;
  }
}));

/**
 * GET /api/hashtag/:hashtag/analysis
 * Get detailed analysis for a hashtag
 */
router.get('/:hashtag/analysis', moderateRateLimit, asyncHandler(async (req, res) => {
  const { hashtag } = req.params;
  const { includeToots = false, limit = 100 } = req.query;
  
  if (!hashtag) {
    throw new ValidationError('Hashtag is required');
  }
  
  logger.info('Hashtag analysis requested', { hashtag, includeToots, limit });
  
  try {
    const analysis = await hashtagService.analyzeHashtag(hashtag, { 
      limit: parseInt(limit),
      includeAllToots: includeToots === 'true'
    });
    
    const response = analysis.toJSON();
    
    // Optionally include full toot data
    if (includeToots === 'true') {
      response.allToots = analysis.toots.map(toot => ({
        id: toot.id,
        author: toot.account.username,
        content: toot.content,
        favorites: toot.favourites_count,
        boosts: toot.reblogs_count,
        replies: toot.replies_count,
        relevance: toot.relevanceScore,
        createdAt: toot.created_at
      }));
    }
    
    res.json(response);
    
  } catch (error) {
    logger.error(`Failed to get analysis for hashtag: ${hashtag}`, error);
    throw error;
  }
}));

/**
 * GET /api/hashtag/:hashtag/users
 * Get most active users for a hashtag
 */
router.get('/:hashtag/users', moderateRateLimit, asyncHandler(async (req, res) => {
  const { hashtag } = req.params;
  const { limit = 20 } = req.query;
  
  if (!hashtag) {
    throw new ValidationError('Hashtag is required');
  }
  
  logger.info('Hashtag users requested', { hashtag, limit });
  
  try {
    const analysis = await hashtagService.analyzeHashtag(hashtag);
    const mostActiveUsers = analysis.getMostActiveUsers(parseInt(limit));
    
    // Enrich user data with additional metrics
    const enrichedUsers = mostActiveUsers.map(userData => {
      const userToots = analysis.toots.filter(toot => toot.account.username === userData.username);
      const totalFavorites = userToots.reduce((sum, toot) => sum + (toot.favourites_count || 0), 0);
      const totalBoosts = userToots.reduce((sum, toot) => sum + (toot.reblogs_count || 0), 0);
      const averageRelevance = userToots.length > 0 
        ? userToots.reduce((sum, toot) => sum + (toot.relevanceScore || 0), 0) / userToots.length 
        : 0;
      
      return {
        username: userData.username,
        postCount: userData.count,
        totalFavorites,
        totalBoosts,
        averageRelevance: Math.round(averageRelevance * 10) / 10,
        topPost: userToots.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))[0]?.id || null
      };
    });
    
    res.json({
      hashtag,
      users: enrichedUsers,
      totalUsers: enrichedUsers.length,
      generatedAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Failed to get users for hashtag: ${hashtag}`, error);
    throw error;
  }
}));

/**
 * GET /api/hashtag/daily
 * Get all daily hashtags
 */
router.get('/daily', asyncHandler(async (req, res) => {
  logger.info('Daily hashtags requested');
  
  try {
    // Defensive validation: ensure HASHTAGS is an array
    const safeHashtags = Array.isArray(HASHTAGS) ? HASHTAGS : [];
    
    const today = new Date().getDay();
    const currentHashtagEntry = safeHashtags[today];
    
    // Get current hashtag with safe fallback
    const currentHashtag = currentHashtagEntry 
      ? (getFirstHashtagForDay(currentHashtagEntry) || 'unknown')
      : 'unknown';
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    const dailySchedule = safeHashtags.map((hashtagEntry, dayIndex) => {
      // Get hashtags for day with defensive validation
      const hashtags = hashtagEntry 
        ? (getHashtagsForDay(hashtagEntry).filter(Boolean) || [])
        : [];
      
      // Use the first hashtag for display (backward compatibility) with fallback
      const displayHashtag = hashtags[0] || 'unknown';
      
      return {
        day: dayIndex,
        name: dayNames[dayIndex],
        hashtag: displayHashtag,
        hashtags: hashtags, // Include all hashtags for the day
        isToday: today === dayIndex
      };
    });
    
    res.json({
      dailySchedule,
      current: {
        day: today,
        hashtag: currentHashtag
      },
      generatedAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get daily hashtags', error);
    throw error;
  }
}));

export { router as hashtagRoutes };