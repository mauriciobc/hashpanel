// Daily hashtags by day of week (0 = Sunday, 6 = Saturday)
export const HASHTAGS = [
  'silentsunday',    // Sunday
  'segundaficha',     // Monday - FIXED: Added missing 'a'
  'tercinema',        // Tuesday
  'quartacapa',       // Wednesday
  'musiquinta',       // Thursday - FIXED: Added missing 'a'
  'sextaserie',       // Friday - FIXED: Added missing 'a'
  'caturday'          // Saturday
];

// Accounts to ignore in processing (using Set for O(1) lookup)
export const IGNORED_ACCOUNTS = new Set(['TagsBR', 'TrendsBR', 'trending']);

// API configuration constants
export const API_CONFIG = {
  DEFAULT_TOOTS_PER_PAGE: 40,
  MAX_TOOTS_PER_PAGE: 100,
  DEFAULT_TOP_TOOTS_COUNT: 5,
  MAX_API_PAGES: 10,
  RATE_LIMIT_DELAY_MS: 1000,
  API_TIMEOUT_MS: 30000
};

// Relevance calculation constants
export const RELEVANCE_CONFIG = {
  DEFAULT_WEIGHTS: {
    favorites: 0.4,
    boosts: 0.3,
    followers: 0.3
  },
  MIN_SCORE: 0,
  MAX_SCORE: 100,
  PRECISION: 1 // Decimal places
};

// Cache configuration
export const CACHE_CONFIG = {
  DEFAULT_TTL_SECONDS: 300, // 5 minutes
  HASHTAG_STATS_TTL_SECONDS: 600, // 10 minutes
  TRENDING_TAGS_TTL_SECONDS: 900, // 15 minutes
  MAX_CACHE_SIZE: 1000
};

// Server configuration
export const SERVER_CONFIG = {
  DEFAULT_PORT: 3000,
  CORS_OPTIONS: (() => {
    const corsOrigin = process.env.CORS_ORIGIN;
    
    // If CORS_ORIGIN is explicitly set, use it
    if (corsOrigin) {
      // Support comma-separated list of origins
      const allowedOrigins = corsOrigin.split(',').map(origin => origin.trim());
      
      // If only one origin, return it directly; otherwise return array
      const origin = allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins;
      
      return {
        origin,
        credentials: true
      };
    }
    
    // If CORS_ORIGIN is not set, use dynamic origin handler
    // In production, CORS_ORIGIN must be explicitly set for security
    return {
      origin: (origin, callback) => {
        const isDevelopment = process.env.NODE_ENV !== 'production';
        
        // In production, require explicit CORS_ORIGIN configuration
        if (!isDevelopment) {
          return callback(new Error('CORS_ORIGIN must be set in production'));
        }
        
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) {
          return callback(null, true);
        }
        
        // In development, allow localhost origins
        const localhostPattern = /^https?:\/\/localhost(:\d+)?$/;
        
        // Allow localhost in development
        if (localhostPattern.test(origin)) {
          return callback(null, true);
        }
        
        // Reject other origins in development
        callback(new Error(`Origin ${origin} not allowed`));
      },
      credentials: true
    };
  })(),
  RATE_LIMIT_OPTIONS: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP'
  }
};

// Logging configuration
export const LOGGING_CONFIG = {
  LEVELS: ['error', 'warn', 'info', 'debug'],
  DEFAULT_LEVEL: 'info',
  FILE_OPTIONS: {
    maxSize: 5 * 1024 * 1024, // 5MB
    maxFiles: 5
  }
};

// Validation constants
export const VALIDATION_CONFIG = {
  MAX_TOOT_LENGTH: 500,
  MIN_TOOT_LENGTH: 1,
  MAX_HASHTAG_LENGTH: 100,
  HASHTAG_PATTERN: /^[a-zA-Z0-9_]+$/,
  USERNAME_PATTERN: /^[a-zA-Z0-9_\-]+$/
};

// Error codes
export const ERROR_CODES = {
  // Configuration errors
  CONFIG_ERROR: 'CONFIG_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  
  // API errors
  API_ERROR: 'API_ERROR',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  
  // Data processing errors
  DATA_PROCESSING_ERROR: 'DATA_PROCESSING_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  
  // Business logic errors
  BUSINESS_ERROR: 'BUSINESS_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  
  // System errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR'
};

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503
};

// Date/time constants
export const DATETIME_CONFIG = {
  DEFAULT_TIMEZONE: 'America/Sao_Paulo',
  DATE_FORMAT: 'YYYY-MM-DD',
  DATETIME_FORMAT: 'YYYY-MM-DD HH:mm:ss',
  ISO_FORMAT: 'YYYY-MM-DDTHH:mm:ssZ'
};

// Export all constants as a single object for easy importing
export const CONSTANTS = {
  HASHTAGS,
  IGNORED_ACCOUNTS,
  API_CONFIG,
  RELEVANCE_CONFIG,
  CACHE_CONFIG,
  SERVER_CONFIG,
  LOGGING_CONFIG,
  VALIDATION_CONFIG,
  ERROR_CODES,
  HTTP_STATUS,
  DATETIME_CONFIG
};