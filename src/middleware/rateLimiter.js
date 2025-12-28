import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { logger } from '../utils/logger.js';
import { appConfig as config } from '../config/index.js';
import { RateLimitError } from '../errors/index.js';

// Basic rate limiting configuration
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: {
      message: 'Too many requests from this IP, please try again later',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 900 // 15 minutes in seconds
    }
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    const resetTime = new Date(Date.now() + 15 * 60 * 1000);
    const retryAfter = Math.ceil((resetTime.getTime() - Date.now()) / 1000);
    
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method
    });
    
    res.status(429).json({
      error: {
        message: 'Too many requests from this IP, please try again later',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
        resetTime: resetTime.toISOString()
      }
    });
  }
});

// Stricter rate limiting for posting endpoints
export const postingRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 posts per hour
  message: {
    error: {
      message: 'Too many posts, please wait before posting again',
      code: 'POSTING_RATE_LIMIT_EXCEEDED',
      retryAfter: 3600 // 1 hour in seconds
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const resetTime = new Date(Date.now() + 60 * 60 * 1000);
    const retryAfter = Math.ceil((resetTime.getTime() - Date.now()) / 1000);
    
    logger.warn('Posting rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url
    });
    
    res.status(429).json({
      error: {
        message: 'Too many posts, please wait before posting again',
        code: 'POSTING_RATE_LIMIT_EXCEEDED',
        retryAfter,
        resetTime: resetTime.toISOString()
      }
    });
  }
});

// Very strict rate limiting for expensive operations
export const heavyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 heavy requests per 15 minutes
  message: {
    error: {
      message: 'Too many heavy requests, please wait before trying again',
      code: 'HEAVY_RATE_LIMIT_EXCEEDED',
      retryAfter: 900
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/health';
  },
  handler: (req, res) => {
    const resetTime = new Date(Date.now() + 15 * 60 * 1000);
    const retryAfter = Math.ceil((resetTime.getTime() - Date.now()) / 1000);
    
    logger.warn('Heavy rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url
    });
    
    res.status(429).json({
      error: {
        message: 'Too many heavy requests, please wait before trying again',
        code: 'HEAVY_RATE_LIMIT_EXCEEDED',
        retryAfter,
        resetTime: resetTime.toISOString()
      }
    });
  }
});

// Custom rate limiting middleware for specific endpoints
export const createCustomRateLimit = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    message: options.message || {
      error: {
        message: 'Rate limit exceeded',
        code: 'CUSTOM_RATE_LIMIT_EXCEEDED'
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: options.keyGenerator || ((req) => {
      return ipKeyGenerator(req);
    }),
    skip: options.skip || (() => false),
    handler: options.handler || ((req, res) => {
      logger.warn('Custom rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.url
      });
      
      res.status(429).json(options.message || {
        error: {
          message: 'Rate limit exceeded',
          code: 'CUSTOM_RATE_LIMIT_EXCEEDED'
        }
      });
    })
  });
};

// Rate limiting middleware that checks against Redis or database
export const distributedRateLimit = async (req, res, next) => {
  // This would implement distributed rate limiting using Redis or database
  // For now, fall back to memory-based rate limiting
  
  // Get client identifier
  const key = req.ip || req.connection.remoteAddress;
  const endpoint = req.path;
  const limitKey = `rate_limit:${endpoint}:${key}`;
  
  try {
    // Here you would check Redis/Database for current count
    // For now, we'll use a simple in-memory counter
    
    const now = Date.now();
    const windowStart = now - (15 * 60 * 1000); // 15 minutes ago
    
    // This is a placeholder - in production, use Redis
    const currentCount = 0; // Get from storage
    
    if (currentCount >= 100) {
      logger.warn('Distributed rate limit exceeded', {
        ip: req.ip,
        endpoint,
        currentCount
      });
      
      return res.status(429).json({
        error: {
          message: 'Rate limit exceeded',
          code: 'DISTRIBUTED_RATE_LIMIT_EXCEEDED'
        }
      });
    }
    
    next();
    
  } catch (error) {
    logger.error('Error in distributed rate limiting', error);
    // Fail open - allow request if rate limiting fails
    next();
  }
};

// Adaptive rate limiting based on server load
export const adaptiveRateLimit = (req, res, next) => {
  // Adjust rate limits based on current server load
  const memoryUsage = process.memoryUsage();
  const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
  const cpuUsage = process.cpuUsage();
  
  // If server is under heavy load, reduce rate limits
  let multiplier = 1;
  
  if (memoryUsagePercent > 80) {
    multiplier = 0.5; // Halve the rate limit
  } else if (memoryUsagePercent > 60) {
    multiplier = 0.75; // Reduce by 25%
  }
  
  // Store multiplier for other middleware to use
  req.rateLimitMultiplier = multiplier;
  
  logger.debug('Adaptive rate limiting applied', {
    ip: req.ip,
    memoryUsagePercent,
    multiplier
  });
  
  next();
};

// Rate limiting with user authentication
export const authenticatedRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Higher limit for authenticated users
  keyGenerator: (req) => {
    return req.user?.id || ipKeyGenerator(req);
  },
  skip: (req) => {
    // Skip rate limiting for admin users
    return req.user?.role === 'admin';
  },
  message: {
    error: {
      message: 'Too many requests for authenticated user',
      code: 'AUTH_RATE_LIMIT_EXCEEDED'
    }
  }
});

// WebSocket rate limiting (for future implementation)
export class WebSocketRateLimiter {
  constructor() {
    this.connections = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000); // Cleanup every minute
  }

  checkLimit(connectionId, limit = 100, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!this.connections.has(connectionId)) {
      this.connections.set(connectionId, []);
    }
    
    const requests = this.connections.get(connectionId);
    
    // Remove old requests outside the window
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    
    if (validRequests.length >= limit) {
      return false; // Rate limit exceeded
    }
    
    // Add current request
    validRequests.push(now);
    this.connections.set(connectionId, validRequests);
    
    return true; // Allow request
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - (15 * 60 * 1000); // 15 minutes ago
    
    for (const [connectionId, requests] of this.connections) {
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      
      if (validRequests.length === 0) {
        // Remove empty entries
        this.connections.delete(connectionId);
      } else {
        this.connections.set(connectionId, validRequests);
      }
    }
    
    logger.debug('Rate limiter cleanup completed', {
      activeConnections: this.connections.size
    });
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.connections.clear();
  }
}

export const wsRateLimiter = new WebSocketRateLimiter();