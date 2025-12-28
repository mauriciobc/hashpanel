import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { logger } from '../utils/logger.js';
import { appConfig as config } from '../config/index.js';
import { RateLimitError } from '../errors/index.js';

// Basic rate limiting configuration
// Increased from 100 to 200 requests per 15 minutes for better UX
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Apply adaptive rate limiting multiplier if available
    const baseLimit = 200; // Increased from 100 for better UX
    const multiplier = req.rateLimitMultiplier ?? 1;
    return Math.floor(baseLimit * multiplier);
  },
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
  max: (req) => {
    // Apply adaptive rate limiting multiplier if available
    const baseLimit = 10;
    const multiplier = req.rateLimitMultiplier ?? 1;
    return Math.floor(baseLimit * multiplier);
  },
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

// Rate limiting for moderate operations (dashboard stats, hashtag analysis)
// Increased from 5 to 20 requests per 15 minutes for better UX
export const moderateRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Apply adaptive rate limiting multiplier if available
    const baseLimit = 20; // Increased from 5 for better UX
    const multiplier = req.rateLimitMultiplier ?? 1;
    return Math.floor(baseLimit * multiplier);
  },
  message: {
    error: {
      message: 'Too many requests, please wait before trying again',
      code: 'MODERATE_RATE_LIMIT_EXCEEDED',
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
    
    logger.warn('Moderate rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url
    });
    
    res.status(429).json({
      error: {
        message: 'Too many requests, please wait before trying again',
        code: 'MODERATE_RATE_LIMIT_EXCEEDED',
        retryAfter,
        resetTime: resetTime.toISOString()
      }
    });
  }
});

// Rate limiting for light operations (media proxy, simple endpoints)
// More permissive for frequently accessed resources
export const lightRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes (shorter window for better UX)
  max: (req) => {
    // Apply adaptive rate limiting multiplier if available
    const baseLimit = 100; // High limit for light operations
    const multiplier = req.rateLimitMultiplier ?? 1;
    return Math.floor(baseLimit * multiplier);
  },
  message: {
    error: {
      message: 'Too many requests, please wait a moment before trying again',
      code: 'LIGHT_RATE_LIMIT_EXCEEDED',
      retryAfter: 300 // 5 minutes in seconds
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const resetTime = new Date(Date.now() + 5 * 60 * 1000);
    const retryAfter = Math.ceil((resetTime.getTime() - Date.now()) / 1000);
    
    logger.warn('Light rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url
    });
    
    res.status(429).json({
      error: {
        message: 'Too many requests, please wait a moment before trying again',
        code: 'LIGHT_RATE_LIMIT_EXCEEDED',
        retryAfter,
        resetTime: resetTime.toISOString()
      }
    });
  }
});

// Very strict rate limiting for expensive operations (kept for truly heavy operations)
// Increased from 5 to 10 requests per 15 minutes
export const heavyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Apply adaptive rate limiting multiplier if available
    const baseLimit = 10; // Increased from 5 for better UX
    const multiplier = req.rateLimitMultiplier ?? 1;
    return Math.floor(baseLimit * multiplier);
  },
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
  const baseMax = options.max || 100;
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: typeof baseMax === 'function' 
      ? (req) => {
          const multiplier = req.rateLimitMultiplier ?? 1;
          return Math.floor(baseMax(req) * multiplier);
        }
      : (req) => {
          const multiplier = req.rateLimitMultiplier ?? 1;
          return Math.floor(baseMax * multiplier);
        },
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

// In-memory storage for distributed rate limiting (fallback when Redis is not available)
// This Map is safe for concurrent access because JavaScript runs single-threaded
// (event loop processes one operation at a time)
const rateLimitStore = new Map();

// Cleanup interval to prevent memory leaks
// Using .unref() so the interval doesn't keep the process alive when no other work exists
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  const windowStart = now - (15 * 60 * 1000); // 15 minutes ago
  
  for (const [key, timestamps] of rateLimitStore.entries()) {
    const validTimestamps = timestamps.filter(ts => ts > windowStart);
    
    if (validTimestamps.length === 0) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, validTimestamps);
    }
  }
}, 5 * 60 * 1000).unref(); // Cleanup every 5 minutes

/**
 * Generates a unique client identifier for rate limiting.
 * Uses IP address from req.ip or req.socket.remoteAddress.
 * 
 * @param {Object} req - Express request object
 * @returns {string|null} Client identifier for rate limiting, or null if no reliable identifier exists
 */
function getClientIdentifier(req) {
  // Try to get IP address from request
  const ip = req.ip || req.socket?.remoteAddress;
  
  // Check if IP is valid (not undefined, null, or 'unknown')
  // Note: localhost IPs are still valid identifiers for rate limiting
  if (ip && ip !== 'unknown') {
    return ip;
  }
  
  // Fail-closed: Return null if no reliable IP is present
  // We intentionally fail-closed for unidentifiable clients to prevent security issues.
  // If header-based identification is ever required, it must include explicit documentation
  // and additional safeguards (e.g., trusted proxy validation or authentication) rather
  // than using mutable client headers.
  return null;
}

// Rate limiting middleware that checks against Redis or database
// Currently uses in-memory storage as fallback
export const distributedRateLimit = async (req, res, next) => {
  // Configuration - increased from 100 to 200 for better UX
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 200; // Increased from 100 for better UX
  
  // Get client identifier using robust identification method
  const key = getClientIdentifier(req);
  
  // Fail-closed: Reject request if no reliable client identifier exists
  // This prevents all unknown clients from sharing a single rate-limit bucket
  if (!key) {
    logger.warn('Unable to identify client for rate limiting - rejecting request', {
      ip: req.ip,
      socketRemoteAddress: req.socket?.remoteAddress,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method
    });
    
    return res.status(400).json({
      error: {
        message: 'Unable to identify client. Request rejected for security reasons.',
        code: 'CLIENT_IDENTIFICATION_FAILED',
        details: 'The server cannot reliably identify your client. This may occur when required headers are missing or when the request is malformed.'
      }
    });
  }
  
  const endpoint = req.path;
  const limitKey = `rate_limit:${endpoint}:${key}`;
  
  try {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Get or initialize timestamps for this key
    if (!rateLimitStore.has(limitKey)) {
      rateLimitStore.set(limitKey, []);
    }
    
    const timestamps = rateLimitStore.get(limitKey);
    
    // Remove old timestamps outside the window
    const validTimestamps = timestamps.filter(ts => ts > windowStart);
    
    // Check if limit is exceeded
    const currentCount = validTimestamps.length;
    
    if (currentCount >= maxRequests) {
      logger.warn('Distributed rate limit exceeded', {
        ip: req.ip || key,
        endpoint,
        currentCount,
        limit: maxRequests
      });
      
      const resetTime = new Date(now + windowMs);
      const retryAfter = Math.ceil((resetTime.getTime() - now) / 1000);
      
      return res.status(429).json({
        error: {
          message: 'Rate limit exceeded',
          code: 'DISTRIBUTED_RATE_LIMIT_EXCEEDED',
          retryAfter,
          resetTime: resetTime.toISOString()
        }
      });
    }
    
    // Add current request timestamp
    validTimestamps.push(now);
    rateLimitStore.set(limitKey, validTimestamps);
    
    next();
    
  } catch (error) {
    logger.error('Error in distributed rate limiting', {
      error: error.message,
      stack: error.stack,
      ip: req.ip || key,
      endpoint
    });
    
    // Fail closed - deny request if rate limiting fails
    // This prevents potential abuse when the rate limiter is unavailable
    return res.status(503).json({
      error: {
        message: 'Service temporarily unavailable',
        code: 'RATE_LIMIT_CHECK_FAILED'
      }
    });
  }
};

// Adaptive rate limiting based on server load
// This middleware calculates a rate limit multiplier based on server memory usage
// and stores it in req.rateLimitMultiplier. All rate limiters will automatically
// apply this multiplier to their max limits when processing requests.
export const adaptiveRateLimit = (req, res, next) => {
  // Adjust rate limits based on current server load
  const memoryUsage = process.memoryUsage();
  const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
  
  // If server is under heavy load, reduce rate limits
  let multiplier = 1;
  
  if (memoryUsagePercent > 80) {
    multiplier = 0.5; // Halve the rate limit
  } else if (memoryUsagePercent > 60) {
    multiplier = 0.75; // Reduce by 25%
  }
  
  // Store multiplier for rate limiters to use
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
  max: (req) => {
    // Apply adaptive rate limiting multiplier if available
    const baseLimit = 200;
    const multiplier = req.rateLimitMultiplier ?? 1;
    return Math.floor(baseLimit * multiplier);
  },
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