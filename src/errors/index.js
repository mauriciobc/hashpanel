// Base error class for all Hashbot errors
export class HashbotError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', statusCode = 500, details = {}) {
    super(message);
    this.name = 'HashbotError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
    
    // Ensure stack trace is preserved
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    const json = {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp
    };
    
    // Include stack trace only in non-production environments or when explicitly requested
    if (this.includeStack || process.env.NODE_ENV !== 'production') {
      json.stack = this.stack;
    }
    
    return json;
  }
}

// Configuration-related errors
export class ConfigurationError extends HashbotError {
  constructor(message, details = {}) {
    super(message, 'CONFIG_ERROR', 500, details);
    this.name = 'ConfigurationError';
  }
}

// API-related errors
export class APIError extends HashbotError {
  constructor(message, originalError = null, details = {}) {
    super(message, 'API_ERROR', 502, {
      originalError: originalError?.message,
      ...details
    });
    this.name = 'APIError';
  }
}

// Validation errors
export class ValidationError extends HashbotError {
  constructor(message, field = null, value = null) {
    super(message, 'VALIDATION_ERROR', 400, { field, value });
    this.name = 'ValidationError';
  }
}

// Rate limiting errors
export class RateLimitError extends HashbotError {
  constructor(message = 'Rate limit exceeded', retryAfter = null) {
    super(message, 'RATE_LIMIT_ERROR', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

// Data processing errors
export class DataProcessingError extends HashbotError {
  constructor(message, step = null, details = {}) {
    super(message, 'DATA_PROCESSING_ERROR', 422, { step, ...details });
    this.name = 'DataProcessingError';
  }
}

// Authentication/Authorization errors
export class AuthenticationError extends HashbotError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

// Business logic errors
export class BusinessError extends HashbotError {
  constructor(message, operation = null, details = {}) {
    super(message, 'BUSINESS_ERROR', 422, { operation, ...details });
    this.name = 'BusinessError';
  }
}

// Not found errors
export class NotFoundError extends HashbotError {
  constructor(message = 'Resource not found', resource = null) {
    super(message, 'NOT_FOUND', 404, { resource });
    this.name = 'NotFoundError';
  }
}