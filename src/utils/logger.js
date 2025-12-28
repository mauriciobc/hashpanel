import winston from 'winston';
import { env } from '../config/index.js';

// Custom format for consistent log structure
const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...meta
    };
    
    if (stack) {
      logEntry.stack = stack;
    }
    
    return JSON.stringify(logEntry);
  })
);

// Create logger instance
export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: customFormat,
  defaultMeta: {
    service: 'hashbot2',
    environment: env.NODE_ENV
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      )
    }),
    
    // File transport for errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ],
  
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ]
});

// Create logs directory if it doesn't exist
import { mkdirSync } from 'fs';
try {
  mkdirSync('logs', { recursive: true });
} catch (error) {
  // Directory already exists or cannot be created
  logger.warn('Could not create logs directory', { error: error.message });
}

// Helper methods for structured logging
export const loggers = {
  // API request logging
  apiRequest: (method, url, userId = null) => {
    logger.info('API Request', { method, url, userId });
  },
  
  // API response logging
  apiResponse: (method, url, statusCode, responseTime) => {
    logger.info('API Response', { method, url, statusCode, responseTime });
  },
  
  // Error logging with context
  error: (message, error = null, context = {}) => {
    logger.error(message, { 
      error: error?.message || error,
      stack: error?.stack,
      ...context 
    });
  },
  
  // Performance logging
  performance: (operation, duration, metadata = {}) => {
    logger.info('Performance', { operation, duration, ...metadata });
  },
  
  // Business logic logging
  business: (event, data = {}) => {
    logger.info('Business Event', { event, ...data });
  },
  
  // Security logging
  security: (event, details = {}) => {
    logger.warn('Security Event', { event, ...details });
  }
};

// Export the main logger as default
export default logger;