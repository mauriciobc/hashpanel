import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { postingRateLimit } from '../../middleware/rateLimiter.js';
import { tootService } from '../../services/tootService.js';
import { hashtagService } from '../../services/hashtagService.js';
import { ValidationError, BusinessError } from '../../errors/index.js';
import { logger } from '../../utils/logger.js';
import { VALIDATION_CONFIG } from '../../constants/index.js';
import { validateTimezoneParameter } from '../../utils/validators.js';

const router = Router();
// Using singleton instances from services

/**
 * Sanitize values for safe logging to prevent log injection attacks
 * @param {string} value - The value to sanitize
 * @param {string} type - Type of value: 'hashtag', 'date', or 'generic'
 * @returns {string} - Sanitized value or safe placeholder
 */
function sanitizeForLog(value, type = 'generic') {
  if (value === null || value === undefined) {
    return null;
  }
  
  // Convert to string if not already
  let str = String(value);
  
  // Remove control characters and newlines (except spaces and tabs)
  str = str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F\n\r]/g, '');
  
  // Limit length to prevent log flooding
  const MAX_LENGTH = type === 'hashtag' ? VALIDATION_CONFIG.MAX_HASHTAG_LENGTH : 200;
  if (str.length > MAX_LENGTH) {
    str = str.substring(0, MAX_LENGTH) + '...';
  }
  
  // Type-specific validation
  if (type === 'hashtag') {
    // Remove # if present for normalization
    const normalized = str.replace(/^#/, '');
    // Validate against hashtag pattern
    if (!VALIDATION_CONFIG.HASHTAG_PATTERN.test(normalized)) {
      return '[INVALID_HASHTAG]';
    }
    return normalized;
  }
  
  if (type === 'date') {
    // Validate ISO date format (YYYY-MM-DD)
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDatePattern.test(str)) {
      return '[INVALID_DATE]';
    }
    // Additional validation: check if it's a valid date
    const date = new Date(str + 'T00:00:00Z');
    if (isNaN(date.getTime())) {
      return '[INVALID_DATE]';
    }
    return str;
  }
  
  // For generic values, just return sanitized string
  return str;
}

/**
 * Sanitize objects for safe logging to prevent leaking sensitive data
 * @param {any} obj - The object to sanitize
 * @param {number} depth - Current recursion depth (default: 0, max: 3)
 * @returns {any} - Sanitized object with sensitive fields omitted or masked
 */
function sanitizeObjectForLog(obj, depth = 0) {
  // Prevent infinite recursion
  if (depth > 3) {
    return '[MAX_DEPTH_REACHED]';
  }
  
  // Handle null/undefined
  if (obj === null || obj === undefined) {
    return null;
  }
  
  // Handle primitives - sanitize strings, pass through numbers/booleans
  if (typeof obj !== 'object') {
    return sanitizeForLog(obj, 'generic');
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObjectForLog(item, depth + 1));
  }
  
  // Handle objects
  const sanitized = {};
  const sensitiveKeys = [
    'token', 'password', 'secret', 'key', 'auth', 'authorization',
    'apiKey', 'apikey', 'accessToken', 'access_token', 'refreshToken',
    'refresh_token', 'bearer', 'credentials', 'cookie', 'cookies',
    'headers', 'authorization', 'x-api-key', 'x-auth-token'
  ];
  
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    // Omit sensitive fields entirely
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    
    // Recursively sanitize nested objects and arrays
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObjectForLog(value, depth + 1);
    } else {
      // Sanitize primitive values
      sanitized[key] = sanitizeForLog(value, 'generic');
    }
  }
  
  return sanitized;
}

/**
 * POST /api/toot/generate
 * Generate a summary without posting
 */
router.post('/generate', asyncHandler(async (req, res) => {
  const { hashtag, date } = req.body;
  
  if (!hashtag) {
    throw new ValidationError('Hashtag is required');
  }
  
  logger.info('Toot generation requested', { 
    hashtag: sanitizeForLog(hashtag, 'hashtag'), 
    date: sanitizeForLog(date, 'date') 
  });
  
  try {
    // Analyze hashtag
    const analysis = await hashtagService.analyzeHashtag(hashtag, { date });
    
    // Generate summary preview
    const preview = await tootService.previewSummary(hashtag, analysis);
    
    res.json({
      hashtag,
      date: date || new Date().toISOString().split('T')[0],
      summary: preview.summary,
      metadata: {
        length: preview.characterCount,
        hashtagCount: preview.hashtagCount,
        lineCount: preview.lineCount,
        isValid: preview.isValid
      },
      analysis: {
        tootCount: analysis.getTodayCount(),
        uniqueUsers: analysis.getUniqueUserCount(),
        topToots: analysis.getTopToots(3).map(toot => ({
          author: toot.account.username,
          relevance: toot.relevanceScore
        }))
      },
      generatedAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to generate toot', error);
    throw error;
  }
}));

/**
 * POST /api/toot/post
 * Post a generated or custom toot
 */
router.post('/post', postingRateLimit, asyncHandler(async (req, res) => {
  const { content, hashtag, options = {} } = req.body;
  
  // Allow either direct content or hashtag-based generation
  if (content) {
    const sanitizedOptions = sanitizeObjectForLog(options);
    logger.info('Direct toot posting requested', { 
      contentLength: content.length,
      options: sanitizedOptions
    });
    
    // Validate content length before posting
    if (content.length > VALIDATION_CONFIG.MAX_TOOT_LENGTH) {
      logger.warn('Direct toot posting rejected: content exceeds character limit', {
        contentLength: content.length,
        maxLength: VALIDATION_CONFIG.MAX_TOOT_LENGTH,
        exceededBy: content.length - VALIDATION_CONFIG.MAX_TOOT_LENGTH
      });
      
      return res.status(400).json({
        success: false,
        error: {
          message: `Content exceeds ${VALIDATION_CONFIG.MAX_TOOT_LENGTH} character limit (${content.length} characters)`,
          code: 'CONTENT_TOO_LONG',
          field: 'content',
          contentLength: content.length,
          maxLength: VALIDATION_CONFIG.MAX_TOOT_LENGTH
        }
      });
    }
    
    try {
      const result = await tootService.createCustomToot(content, options);
      
      res.json({
        success: true,
        toot: {
          id: result.id,
          url: result.url,
          content: result.content,
          createdAt: result.created_at
        },
        postedAt: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Failed to post custom toot', error);
      throw error;
    }
    
  } else if (hashtag) {
    const sanitizedOptions = sanitizeObjectForLog(options);
    logger.info('Hashtag toot posting requested', { 
      hashtag: sanitizeForLog(hashtag, 'hashtag'), 
      options: sanitizedOptions
    });
    
    try {
      // Analyze hashtag and generate summary
      const analysis = await hashtagService.analyzeHashtag(hashtag);
      
      if (!analysis.hasTodayToots()) {
        throw new BusinessError(`No toots found for hashtag: ${hashtag}`);
      }
      
      // Generate and post summary
      const result = await tootService.generateAndPostSummary(hashtag, analysis);
      
      res.json({
        success: true,
        hashtag,
        summary: result.summary,
        toot: {
          id: result.toot.id,
          url: result.toot.url,
          createdAt: result.toot.created_at
        },
        analysis: {
          tootCount: analysis.getTodayCount(),
          uniqueUsers: analysis.getUniqueUserCount()
        },
        postedAt: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Failed to post hashtag toot', error);
      throw error;
    }
    
  } else {
    throw new ValidationError('Either content or hashtag must be provided');
  }
}));

/**
 * POST /api/toot/daily
 * Post the daily summary
 */
router.post('/daily', postingRateLimit, asyncHandler(async (req, res) => {
  const { dryRun = false, timezone: clientTimezone } = req.body;
  
  // Validate timezone parameter
  const validatedTimezone = validateTimezoneParameter(clientTimezone);
  
  logger.info('Daily toot posting requested', { 
    dryRun,
    timezone: sanitizeForLog(validatedTimezone, 'generic')
  });
  
  try {
    // Get current day's hashtag using validated timezone
    const dailyHashtag = hashtagService.getDailyHashtag({ timezone: validatedTimezone });
    
    // Analyze hashtag
    const analysis = await hashtagService.analyzeHashtag(dailyHashtag, { 
      timezone: validatedTimezone 
    });
    
    if (!analysis.hasTodayToots()) {
      return res.json({
        success: false,
        message: `No toots found for today's hashtag: #${dailyHashtag}`,
        hashtag: dailyHashtag,
        tootCount: 0,
        postedAt: new Date().toISOString()
      });
    }
    
    if (dryRun) {
      // Generate preview only
      const preview = await tootService.previewSummary(dailyHashtag, analysis);
      
      return res.json({
        success: true,
        dryRun: true,
        hashtag: dailyHashtag,
        summary: preview.summary,
        analysis: {
          tootCount: analysis.getTodayCount(),
          uniqueUsers: analysis.getUniqueUserCount(),
          weeklyTotal: analysis.getWeeklyTotal()
        },
        generatedAt: new Date().toISOString()
      });
    } else {
      // Post the summary
      const result = await tootService.generateAndPostSummary(dailyHashtag, analysis);
      
      res.json({
        success: true,
        dryRun: false,
        hashtag: dailyHashtag,
        summary: result.summary,
        toot: {
          id: result.toot.id,
          url: result.toot.url,
          createdAt: result.toot.created_at
        },
        analysis: {
          tootCount: analysis.getTodayCount(),
          uniqueUsers: analysis.getUniqueUserCount(),
          weeklyTotal: analysis.getWeeklyTotal()
        },
        postedAt: new Date().toISOString()
      });
    }
    
  } catch (error) {
    logger.error('Failed to post daily toot', error);
    throw error;
  }
}));

/**
 * GET /api/toot/history
 * Get posting history
 */
router.get('/history', asyncHandler(async (req, res) => {
  const { limit = 10, offset = 0 } = req.query;
  
  // Sanitize query parameters (convert to numbers and validate)
  const sanitizedLimit = Math.max(1, Math.min(100, parseInt(limit) || 10));
  const sanitizedOffset = Math.max(0, parseInt(offset) || 0);
  
  logger.info('Toot history requested', { 
    limit: sanitizedLimit, 
    offset: sanitizedOffset 
  });
  
  try {
    const history = await tootService.getPostingHistory(sanitizedLimit);
    
    res.json({
      history: history.posts || [],
      pagination: {
        limit: sanitizedLimit,
        offset: sanitizedOffset,
        total: history.total || 0
      },
      stats: tootService.getStats(),
      generatedAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get toot history', error);
    throw error;
  }
}));

/**
 * GET /api/toot/stats
 * Get tooting statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  logger.info('Toot stats requested');
  
  try {
    const stats = tootService.getStats();
    
    res.json({
      stats,
      generatedAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get toot stats', error);
    throw error;
  }
}));

/**
 * POST /api/toot/validate
 * Validate toot content before posting
 */
router.post('/validate', asyncHandler(async (req, res) => {
  const { content } = req.body;
  
  if (!content) {
    throw new ValidationError('Content is required for validation');
  }
  
  logger.info('Toot validation requested', { contentLength: content.length });
  
  try {
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      metadata: {
        length: content.length,
        characterCount: content.length,
        wordCount: content.split(/\s+/).filter(word => word.length > 0).length,
        lineCount: content.split('\n').length,
        hashtagCount: (content.match(/#/g) || []).length,
        mentionCount: (content.match(/@/g) || []).length,
        linkCount: (content.match(/https?:\/\/\S+/g) || []).length
      }
    };
    
    // Check length
    if (content.length > 500) {
      validation.isValid = false;
      validation.errors.push({
        field: 'content',
        message: `Content exceeds 500 character limit (${content.length} characters)`,
        code: 'CONTENT_TOO_LONG'
      });
    }
    
    if (content.length === 0) {
      validation.isValid = false;
      validation.errors.push({
        field: 'content',
        message: 'Content cannot be empty',
        code: 'CONTENT_EMPTY'
      });
    }
    
    if (content.trim().length === 0) {
      validation.isValid = false;
      validation.errors.push({
        field: 'content',
        message: 'Content cannot be only whitespace',
        code: 'CONTENT_WHITESPACE_ONLY'
      });
    }
    
    // Warnings
    if (content.length > 450) {
      validation.warnings.push({
        field: 'content',
        message: `Content is close to character limit (${content.length}/500 characters)`,
        code: 'CONTENT_NEAR_LIMIT'
      });
    }
    
    if (!content.includes('#')) {
      validation.warnings.push({
        field: 'content',
        message: 'Content does not include any hashtags',
        code: 'NO_HASHTAGS'
      });
    }
    
    if (content.includes('@')) {
      validation.warnings.push({
        field: 'content',
        message: 'Content includes mentions - ensure they are relevant',
        code: 'CONTAINS_MENTIONS'
      });
    }
    
    res.json({
      validation,
      processedAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to validate toot content', error);
    throw error;
  }
}));

export { router as tootRoutes };