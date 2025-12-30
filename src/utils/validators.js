import moment from 'moment-timezone';
import { ValidationError } from '../errors/index.js';
import { logger } from './logger.js';
import { appConfig as config } from '../config/index.js';

/**
 * Validates and normalizes the days query parameter
 * @param {string|number|undefined} daysValue - Raw value from query string
 * @param {number} defaultValue - Default value to use if validation fails
 * @param {number} min - Minimum allowed value (default: 1)
 * @param {number} max - Maximum allowed value (default: 365)
 * @returns {number} Validated and clamped days value
 * @throws {ValidationError} If value is provided but clearly invalid
 */
export function validateDaysParameter(daysValue, defaultValue = 7, min = 1, max = 365) {
  // If undefined or null, use default
  if (daysValue === undefined || daysValue === null || daysValue === '') {
    return defaultValue;
  }
  
  // Parse the value
  const parsed = Number(daysValue);
  
  // Check if parsing resulted in NaN (clearly invalid input)
  if (isNaN(parsed)) {
    throw new ValidationError(
      `Invalid days parameter: "${daysValue}". Must be a valid number.`,
      'days',
      daysValue
    );
  }
  
  // Check if it's a finite integer
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ValidationError(
      `Invalid days parameter: "${daysValue}". Must be a finite integer.`,
      'days',
      daysValue
    );
  }
  
  // Clamp to acceptable range
  const clamped = Math.max(min, Math.min(max, parsed));
  
  // If value was provided but needed clamping, log a warning
  if (clamped !== parsed) {
    logger.warn('Days parameter clamped to valid range', {
      original: parsed,
      clamped,
      min,
      max
    });
  }
  
  return clamped;
}

/**
 * Validates and normalizes the timezone query parameter
 * @param {string|string[]|undefined} timezoneValue - Raw value from query string
 * @param {string|null} defaultValue - Default timezone to use if validation fails (IANA identifier). If null, uses config.server.timezone
 * @returns {string} Validated IANA timezone identifier
 * @throws {ValidationError} If value is provided but invalid
 */
export function validateTimezoneParameter(timezoneValue, defaultValue = null) {
  // If undefined, null, or empty, use default
  if (timezoneValue === undefined || timezoneValue === null || timezoneValue === '') {
    return defaultValue !== null ? defaultValue : config.server.timezone;
  }
  
  // Reject arrays - must be a single value
  if (Array.isArray(timezoneValue)) {
    throw new ValidationError(
      'Invalid timezone parameter. Must be a single value, not an array.',
      'timezone',
      timezoneValue
    );
  }
  
  // Must be a string
  if (typeof timezoneValue !== 'string') {
    throw new ValidationError(
      `Invalid timezone parameter. Must be a string, got ${typeof timezoneValue}.`,
      'timezone',
      timezoneValue
    );
  }
  
  // Must be non-empty string
  if (timezoneValue.trim() === '') {
    throw new ValidationError(
      'Invalid timezone parameter. Must be a non-empty string.',
      'timezone',
      timezoneValue
    );
  }
  
  // Validate IANA timezone identifier using Intl.DateTimeFormat
  // This is the standard way to validate timezones in JavaScript
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezoneValue });
  } catch (error) {
    // Intl.DateTimeFormat throws RangeError for invalid timezone identifiers
    if (error instanceof RangeError) {
      throw new ValidationError(
        `Invalid timezone parameter: "${timezoneValue}". Must be a valid IANA timezone identifier.`,
        'timezone',
        timezoneValue
      );
    }
    // Re-throw unexpected errors
    throw error;
  }
  
  return timezoneValue;
}
