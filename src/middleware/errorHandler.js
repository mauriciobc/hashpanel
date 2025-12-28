import { logger } from '../utils/logger.js';
import { HashbotError } from '../errors/index.js';
import { env } from '../config/index.js';

// Try to import JWT error types for instanceof checks (optional dependency)
let JsonWebTokenError, TokenExpiredError, NotBeforeError;
try {
  const jwt = await import('jsonwebtoken');
  JsonWebTokenError = jwt.JsonWebTokenError;
  TokenExpiredError = jwt.TokenExpiredError;
  NotBeforeError = jwt.NotBeforeError;
} catch {
  // jsonwebtoken not installed, will use error.name checks only
}

// Express error handling middleware
export const errorHandler = (error, req, res, next) => {
  // Build safe error object with only essential properties
  const isDevelopment = env.NODE_ENV === 'development';
  const enableDebug = process.env.DEBUG === 'true' || isDevelopment;
  
  const safeErrorData = {
    name: error?.name || 'Error',
    message: error?.message || 'Unknown error',
    code: error?.code || null,
    ...(enableDebug && error?.stack ? { stack: error.stack } : {})
  };

  // Log the error with safe data only (never pass full error object)
  logger.error('Request error', {
    error: safeErrorData,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Handle known Hashbot errors
  if (error instanceof HashbotError) {
    return res.status(error.statusCode).json({
      error: {
        message: error.message,
        code: error.code,
        details: error.details,
        timestamp: error.timestamp
      }
    });
  }

  // Handle validation errors (like from Zod)
  if (error.name === 'ZodError') {
    return res.status(400).json({
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: {
          fields: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code
          }))
        },
        timestamp: new Date().toISOString()
      }
    });
  }

  // Handle JWT errors - check by error.name and instanceof (if jsonwebtoken is available)
  const isJWTError = 
    (JsonWebTokenError && error instanceof JsonWebTokenError) ||
    (TokenExpiredError && error instanceof TokenExpiredError) ||
    (NotBeforeError && error instanceof NotBeforeError) ||
    error.name === 'JsonWebTokenError' ||
    error.name === 'TokenExpiredError' ||
    error.name === 'NotBeforeError';
  
  if (isJWTError) {
    let code, message;
    
    if ((TokenExpiredError && error instanceof TokenExpiredError) || error.name === 'TokenExpiredError') {
      code = 'TOKEN_EXPIRED';
      message = 'Authentication token has expired';
    } else if ((NotBeforeError && error instanceof NotBeforeError) || error.name === 'NotBeforeError') {
      code = 'TOKEN_NOT_YET_VALID';
      message = 'Authentication token is not yet valid';
    } else {
      code = 'INVALID_TOKEN';
      message = 'Invalid authentication token';
    }
    
    return res.status(401).json({
      error: {
        message,
        code,
        timestamp: new Date().toISOString()
      }
    });
  }

  // Handle syntax errors (invalid JSON)
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      error: {
        message: 'Invalid JSON in request body',
        code: 'INVALID_JSON',
        timestamp: new Date().toISOString()
      }
    });
  }

  // Default error response for unknown errors
  res.status(500).json({
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString()
    }
  });
};

// 404 handler middleware
export const notFoundHandler = (req, res) => {
  logger.warn('Route not found', {
    method: req.method,
    url: req.url,
    ip: req.ip
  });

  res.status(404).json({
    error: {
      message: 'Route not found',
      code: 'NOT_FOUND',
      details: {
        method: req.method,
        url: req.url
      },
      timestamp: new Date().toISOString()
    }
  });
};

// Async error wrapper for route handlers
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Request logging middleware
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Log request
  logger.info('Request started', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      ip: req.ip
    });
  });

  next();
};