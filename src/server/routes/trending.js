import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { ValidationError } from '../../errors/index.js';
import { hashtagService } from '../../services/hashtagService.js';
import { logger } from '../../utils/logger.js';

const router = Router();
// Using singleton instance from service

// Maximum limit allowed (based on API constraints)
const MAX_LIMIT = 100;

/**
 * Validate and sanitize pagination parameters
 * @param {string|undefined} limitValue - Raw limit value from query
 * @param {string|undefined} offsetValue - Raw offset value from query
 * @returns {{limit: number, offset: number}} - Sanitized pagination values
 */
function validatePaginationParams(limitValue, offsetValue) {
  // Default values
  let limit = 10;
  let offset = 0;
  
  // Validate and parse limit
  if (limitValue !== undefined && limitValue !== null && limitValue !== '') {
    // Check if it matches numeric pattern
    if (/^\d+$/.test(String(limitValue))) {
      const parsed = parseInt(limitValue, 10);
      if (Number.isFinite(parsed) && parsed >= 1) {
        limit = Math.min(parsed, MAX_LIMIT); // Clamp to max limit
      }
    }
  }
  
  // Validate and parse offset
  if (offsetValue !== undefined && offsetValue !== null && offsetValue !== '') {
    // Check if it matches numeric pattern
    if (/^\d+$/.test(String(offsetValue))) {
      const parsed = parseInt(offsetValue, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        offset = parsed;
      }
    }
  }
  
  return { limit, offset };
}

/**
 * GET /api/trending
 * Get trending tags
 */
router.get('/', asyncHandler(async (req, res) => {
  const { limit, offset } = validatePaginationParams(req.query.limit, req.query.offset);
  
  logger.info('Trending tags requested', { limit, offset });
  
  try {
    const result = await hashtagService.getTrendingTags(limit, offset);
    const { tags: trendingTags, totalCount } = result;
    
    const enrichedTags = trendingTags.map((tag, index) => ({
      rank: offset + index + 1,
      name: tag.name,
      url: tag.url,
      history: tag.history || [],
      currentUses: tag.history?.[0]?.uses || 0,
      accounts: tag.history?.[0]?.accounts || 0,
      trendDirection: getTrendDirection(tag.history),
      weekTotal: tag.history?.reduce((sum, day) => sum + (parseInt(day.uses) || 0), 0) || 0
    }));
    
    // Calculate pagination metadata
    // Use totalCount from service if available, otherwise fallback to enrichedTags.length
    const total = totalCount !== null ? totalCount : enrichedTags.length;
    const hasMore = totalCount !== null 
      ? offset + limit < totalCount
      : enrichedTags.length === limit;
    
    res.json({
      tags: enrichedTags,
      pagination: {
        limit: limit,
        offset: offset,
        total: total,
        hasMore: hasMore
      },
      generatedAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get trending tags', error);
    throw error;
  }
}));

/**
 * GET /api/trending/summary
 * Get summary of trending activity
 */
router.get('/summary', asyncHandler(async (req, res) => {
  logger.info('Trending summary requested');
  
  try {
    const result = await hashtagService.getTrendingTags(20);
    const trendingTags = result.tags;
    
    const summary = {
      totalTags: trendingTags.length,
      topTag: trendingTags[0] ? {
        name: trendingTags[0].name,
        uses: trendingTags[0].history?.[0]?.uses || 0
      } : null,
      totalUses: trendingTags.reduce((sum, tag) => 
        sum + (tag.history?.[0]?.uses || 0), 0
      ),
      uniqueAccounts: trendingTags.reduce((sum, tag) => 
        sum + (tag.history?.[0]?.accounts || 0), 0
      ),
      averageUses: trendingTags.length > 0 
        ? Math.round(
          trendingTags.reduce((sum, tag) => 
            sum + (tag.history?.[0]?.uses || 0), 0
          ) / trendingTags.length
        )
        : 0,
      categories: categorizeTags(trendingTags),
      generatedAt: new Date().toISOString()
    };
    
    res.json(summary);
    
  } catch (error) {
    logger.error('Failed to get trending summary', error);
    throw error;
  }
}));

/**
 * GET /api/trending/:tag
 * Get detailed information about a specific trending tag
 */
router.get('/:tag', asyncHandler(async (req, res) => {
  const { tag } = req.params;
  
  if (!tag) {
    throw new ValidationError('Tag name is required');
  }
  
  logger.info('Trending tag details requested', { tag });
  
  try {
    const result = await hashtagService.getTrendingTags(50);
    const trendingTags = result.tags;
    const tagInfo = trendingTags.find(t => t.name.toLowerCase() === tag.toLowerCase());
    
    if (!tagInfo) {
      return res.status(404).json({
        error: {
          message: `Tag #${tag} not found in trending tags`,
          code: 'TRENDING_TAG_NOT_FOUND'
        }
      });
    }
    
    const detailedInfo = {
      name: tagInfo.name,
      url: tagInfo.url,
      history: tagInfo.history || [],
      statistics: {
        currentUses: tagInfo.history?.[0]?.uses || 0,
        accounts: tagInfo.history?.[0]?.accounts || 0,
        weekTotal: tagInfo.history?.reduce((sum, day) => sum + (parseInt(day.uses) || 0), 0) || 0,
        peakDay: tagInfo.history?.reduce((max, day) => 
          parseInt(day.uses) > (parseInt(max.uses) || 0) ? day : max, 
          tagInfo.history[0] || {}
        ),
        trendDirection: getTrendDirection(tagInfo.history),
        averageDaily: tagInfo.history?.length > 0 
          ? Math.round(
            tagInfo.history.reduce((sum, day) => sum + (parseInt(day.uses) || 0), 0) / tagInfo.history.length
          )
          : 0
      },
      timeline: tagInfo.history?.map((day, index) => ({
        day: day.day,
        uses: parseInt(day.uses) || 0,
        accounts: day.accounts || 0,
        rank: index + 1
      })) || [],
      relatedHashtags: [], // Would need additional API calls to determine
      generatedAt: new Date().toISOString()
    };
    
    res.json(detailedInfo);
    
  } catch (error) {
    logger.error(`Failed to get trending tag details for: ${tag}`, error);
    throw error;
  }
}));

/**
 * GET /api/trending/compare
 * Compare multiple trending tags
 */
router.get('/compare', asyncHandler(async (req, res) => {
  const { tags } = req.query;
  
  if (!tags) {
    throw new ValidationError('Tags parameter is required');
  }
  
  const tagList = tags.split(',').map(tag => tag.trim().replace('#', '').toLowerCase());
  
  if (tagList.length < 2 || tagList.length > 5) {
    throw new ValidationError('Please provide between 2 and 5 tags to compare');
  }
  
  logger.info('Trending tags comparison requested', { tags: tagList });
  
  try {
    const result = await hashtagService.getTrendingTags(50);
    const trendingTags = result.tags;
    const foundTags = trendingTags.filter(tag => 
      tagList.includes(tag.name.toLowerCase())
    );
    
    if (foundTags.length === 0) {
      return res.status(404).json({
        error: {
          message: 'None of the specified tags were found in trending tags',
          code: 'NO_TAGS_FOUND'
        }
      });
    }
    
    const comparison = {
      tags: foundTags.map(tag => ({
        name: tag.name,
        currentUses: tag.history?.[0]?.uses || 0,
        weekTotal: tag.history?.reduce((sum, day) => sum + (parseInt(day.uses) || 0), 0) || 0,
        trendDirection: getTrendDirection(tag.history),
        rank: foundTags.indexOf(tag) + 1
      })),
      statistics: {
        totalUses: foundTags.reduce((sum, tag) => 
          sum + (tag.history?.[0]?.uses || 0), 0
        ),
        averageUses: Math.round(
          foundTags.reduce((sum, tag) => sum + (tag.history?.[0]?.uses || 0), 0) / foundTags.length
        ),
        topPerformer: foundTags.reduce((top, tag) => 
          (tag.history?.[0]?.uses || 0) > (top.history?.[0]?.uses || 0) ? tag : top
        )
      },
      missingTags: tagList.filter(tag => 
        !foundTags.some(foundTag => foundTag.name.toLowerCase() === tag.toLowerCase())
      ),
      generatedAt: new Date().toISOString()
    };
    
    res.json(comparison);
    
  } catch (error) {
    logger.error('Failed to compare trending tags', error);
    throw error;
  }
}));

/**
 * Determine trend direction from history data
 */
function getTrendDirection(history) {
  if (!history || history.length < 2) {
    return 'stable';
  }
  
  // Normalize to numbers, treating NaN as 0
  const recentParsed = parseInt(history[0]?.uses);
  const previousParsed = parseInt(history[1]?.uses);
  const recent = Number.isNaN(recentParsed) ? 0 : recentParsed;
  const previous = Number.isNaN(previousParsed) ? 0 : previousParsed;
  
  // Handle division by zero: when previous is 0
  if (previous === 0) {
    if (recent > 0) return 'rising';
    return 'stable';
  }
  
  // Only perform percentage calculation when previous > 0 to avoid Infinity/NaN
  const change = ((recent - previous) / previous) * 100;
  
  if (change > 10) return 'rising';
  if (change < -10) return 'falling';
  return 'stable';
}

/**
 * Categorize trending tags based on patterns
 */
function categorizeTags(trendingTags) {
  const categories = {
    entertainment: 0,
    technology: 0,
    politics: 0,
    sports: 0,
    general: 0
  };
  
  // This is a simplified categorization
  // In production, you'd use more sophisticated methods
  trendingTags.forEach(tag => {
    const name = tag.name.toLowerCase();
    
    if (name.includes('film') || name.includes('movie') || name.includes('cinema')) {
      categories.entertainment++;
    } else if (name.includes('tech') || name.includes('code') || name.includes('programming')) {
      categories.technology++;
    } else if (name.includes('politic') || name.includes('election')) {
      categories.politics++;
    } else if (name.includes('sport') || name.includes('football') || name.includes('soccer')) {
      categories.sports++;
    } else {
      categories.general++;
    }
  });
  
  return categories;
}

export { router as trendingRoutes };