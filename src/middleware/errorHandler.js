import { logger } from '../utils/logger.js';
import { HashbotError } from '../errors/index.js';

// Express error handling middleware
export const errorHandler = (error, req, res, next) => {
  // Log the error
  logger.error('Request error', error, {
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

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: {
        message: 'Invalid authentication token',
        code: 'INVALID_TOKEN',
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