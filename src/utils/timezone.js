import moment from 'moment-timezone';
import { appConfig as config } from '../config/index.js';
import { ValidationError } from '../errors/index.js';
import { logger } from './logger.js';

/**
 * Central timezone utility module
 * Provides consistent timezone handling across the application
 */

/**
 * Format a date in a specific timezone
 * @param {Date|string|moment.Moment} date - Date to format
 * @param {string} timezone - IANA timezone identifier (e.g., 'America/Sao_Paulo', 'UTC')
 * @param {string} format - moment.js format string (default: 'YYYY-MM-DD')
 * @returns {string} Formatted date string
 * 
 * @example
 * formatDateInTimezone(new Date(), 'America/Sao_Paulo', 'DD/MM/YYYY')
 * // => '23/01/2026'
 */
export function formatDateInTimezone(date, timezone, format = 'YYYY-MM-DD') {
  if (!date) {
    throw new ValidationError('Date is required for formatting', 'date', date);
  }

  const validatedTimezone = parseAndValidateTimezone(timezone, {
    fallback: config.server.timezone,
    throwOnInvalid: false,
  });

  return moment(date).tz(validatedTimezone).format(format);
}

/**
 * Get current date in a specific timezone
 * @param {string} timezone - IANA timezone identifier
 * @param {string} format - moment.js format string (default: 'YYYY-MM-DD')
 * @returns {string} Current date in the specified timezone
 * 
 * @example
 * getCurrentDateInTimezone('America/Sao_Paulo')
 * // => '2026-01-23'
 */
export function getCurrentDateInTimezone(timezone, format = 'YYYY-MM-DD') {
  const validatedTimezone = parseAndValidateTimezone(timezone, {
    fallback: config.server.timezone,
    throwOnInvalid: false,
  });

  return moment().tz(validatedTimezone).format(format);
}

/**
 * Get current moment object in a specific timezone
 * @param {string} timezone - IANA timezone identifier
 * @returns {moment.Moment} Moment object in the specified timezone
 * 
 * @example
 * const now = getCurrentMoment('America/Sao_Paulo');
 * now.format('HH:mm:ss')
 */
export function getCurrentMoment(timezone) {
  const validatedTimezone = parseAndValidateTimezone(timezone, {
    fallback: config.server.timezone,
    throwOnInvalid: false,
  });

  return moment().tz(validatedTimezone);
}

/**
 * Get current timestamp in ISO format
 * @returns {string} ISO 8601 timestamp
 * 
 * @example
 * getCurrentTimestampISO()
 * // => '2026-01-23T10:30:45.123Z'
 */
export function getCurrentTimestampISO() {
  return new Date().toISOString();
}

/**
 * Format current date for display in Brazilian Portuguese format
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} Formatted date (DD/MM/YYYY)
 * 
 * @example
 * getCurrentDateFormatted('America/Sao_Paulo')
 * // => '23/01/2026'
 */
export function getCurrentDateFormatted(timezone) {
  const validatedTimezone = parseAndValidateTimezone(timezone, {
    fallback: config.server.timezone,
    throwOnInvalid: false,
  });

  return moment().tz(validatedTimezone).format('DD/MM/YYYY');
}

/**
 * Parse and validate timezone with comprehensive error handling
 * @param {string} timezone - Timezone to validate
 * @param {Object} options - Validation options
 * @param {string} options.fallback - Fallback timezone if validation fails (default: server timezone)
 * @param {boolean} options.throwOnInvalid - Throw error instead of using fallback (default: false)
 * @param {Object} options.logger - Logger instance for warnings (default: global logger)
 * @returns {string} Validated IANA timezone identifier
 * @throws {ValidationError} If throwOnInvalid is true and timezone is invalid
 * 
 * @example
 * parseAndValidateTimezone('America/Sao_Paulo')
 * // => 'America/Sao_Paulo'
 * 
 * parseAndValidateTimezone('Invalid/Zone', { fallback: 'UTC' })
 * // => 'UTC' (with warning logged)
 */
export function parseAndValidateTimezone(timezone, options = {}) {
  const {
    fallback = config.server.timezone,
    throwOnInvalid = false,
    logger: loggerInstance = logger,
  } = options;

  // If no timezone provided, use fallback
  if (!timezone || timezone === '') {
    return fallback;
  }

  // Must be a string
  if (typeof timezone !== 'string') {
    const error = new ValidationError(
      `Invalid timezone type: expected string, got ${typeof timezone}`,
      'timezone',
      timezone
    );
    if (throwOnInvalid) throw error;
    loggerInstance.warn('Invalid timezone type, using fallback', {
      providedType: typeof timezone,
      fallback,
    });
    return fallback;
  }

  // Check if timezone is valid using moment-timezone
  if (!moment.tz.zone(timezone)) {
    const error = new ValidationError(
      `Invalid IANA timezone identifier: "${timezone}". Must be a valid timezone like "America/Sao_Paulo" or "UTC". See https://en.wikipedia.org/wiki/List_of_tz_database_time_zones`,
      'timezone',
      timezone
    );
    if (throwOnInvalid) throw error;
    loggerInstance.warn('Invalid timezone identifier, using fallback', {
      providedTimezone: timezone,
      fallback,
    });
    return fallback;
  }

  return timezone;
}

/**
 * Get human-readable timezone offset
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} Offset string (e.g., 'UTC-3', 'UTC+9', 'UTC')
 * 
 * @example
 * getTimezoneOffset('America/Sao_Paulo')
 * // => 'UTC-3'
 * 
 * getTimezoneOffset('Asia/Tokyo')
 * // => 'UTC+9'
 */
export function getTimezoneOffset(timezone) {
  const validatedTimezone = parseAndValidateTimezone(timezone, {
    fallback: 'UTC',
    throwOnInvalid: false,
  });

  const offset = moment.tz(validatedTimezone).format('Z'); // Returns format like '+09:00' or '-03:00'
  const hours = offset.slice(0, 3); // Get '+09' or '-03'
  const minutes = offset.slice(4, 6); // Get '00'

  // Format as UTC±X or UTC±X:30
  if (minutes === '00') {
    return hours === '+00' || hours === '-00' ? 'UTC' : `UTC${hours}`;
  }
  return `UTC${hours}:${minutes}`;
}

/**
 * Get timezone abbreviation (e.g., 'BRT', 'JST', 'UTC')
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} Timezone abbreviation
 * 
 * @example
 * getTimezoneAbbreviation('America/Sao_Paulo')
 * // => 'BRT' (or 'BRST' during DST)
 */
export function getTimezoneAbbreviation(timezone) {
  const validatedTimezone = parseAndValidateTimezone(timezone, {
    fallback: 'UTC',
    throwOnInvalid: false,
  });

  return moment.tz(validatedTimezone).format('z');
}

/**
 * Get display-friendly timezone name
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} Human-readable name (e.g., 'Sao Paulo', 'Tokyo')
 * 
 * @example
 * getTimezoneName('America/Sao_Paulo')
 * // => 'Sao Paulo'
 */
export function getTimezoneName(timezone) {
  const validatedTimezone = parseAndValidateTimezone(timezone, {
    fallback: 'UTC',
    throwOnInvalid: false,
  });

  const parts = validatedTimezone.split('/');
  const name = parts[parts.length - 1].replace(/_/g, ' ');
  return name;
}

/**
 * Convert a date from one timezone to another
 * @param {Date|string|moment.Moment} date - Date to convert
 * @param {string} fromTimezone - Source timezone
 * @param {string} toTimezone - Target timezone
 * @returns {moment.Moment} Converted moment object
 * 
 * @example
 * const brazilTime = '2026-01-23 14:00:00';
 * const tokyoTime = convertDateBetweenTimezones(
 *   brazilTime,
 *   'America/Sao_Paulo',
 *   'Asia/Tokyo'
 * );
 * tokyoTime.format('YYYY-MM-DD HH:mm:ss')
 * // => '2026-01-24 02:00:00' (same moment, different timezone)
 */
export function convertDateBetweenTimezones(date, fromTimezone, toTimezone) {
  const validatedFromTz = parseAndValidateTimezone(fromTimezone, {
    throwOnInvalid: true,
  });
  const validatedToTz = parseAndValidateTimezone(toTimezone, {
    throwOnInvalid: true,
  });

  return moment.tz(date, validatedFromTz).tz(validatedToTz);
}

/**
 * Check if a date is at a timezone boundary (near midnight)
 * Useful for detecting potential date boundary bugs
 * @param {Date|string|moment.Moment} date - Date to check
 * @param {string} timezone - IANA timezone identifier
 * @param {number} thresholdMinutes - Minutes from midnight to consider as boundary (default: 60)
 * @returns {boolean} True if date is within threshold of midnight
 * 
 * @example
 * isAtTimezoneBoundary('2026-01-23 23:45:00', 'America/Sao_Paulo')
 * // => true (within 60 minutes of midnight)
 */
export function isAtTimezoneBoundary(date, timezone, thresholdMinutes = 60) {
  const validatedTimezone = parseAndValidateTimezone(timezone, {
    throwOnInvalid: false,
  });

  const momentInTz = moment(date).tz(validatedTimezone);
  const minutesSinceMidnight = momentInTz.hours() * 60 + momentInTz.minutes();
  const minutesUntilMidnight = 24 * 60 - minutesSinceMidnight;

  return minutesSinceMidnight <= thresholdMinutes || minutesUntilMidnight <= thresholdMinutes;
}

/**
 * Get comprehensive timezone information for display/logging
 * @param {string} timezone - IANA timezone identifier
 * @returns {Object} Timezone information object
 * 
 * @example
 * getTimezoneInfo('America/Sao_Paulo')
 * // => {
 * //   timezone: 'America/Sao_Paulo',
 * //   offset: 'UTC-3',
 * //   abbreviation: 'BRT',
 * //   name: 'Sao Paulo',
 * //   currentTime: '2026-01-23T14:30:00-03:00'
 * // }
 */
export function getTimezoneInfo(timezone) {
  const validatedTimezone = parseAndValidateTimezone(timezone, {
    fallback: 'UTC',
    throwOnInvalid: false,
  });

  const now = moment.tz(validatedTimezone);

  return {
    timezone: validatedTimezone,
    offset: getTimezoneOffset(validatedTimezone),
    abbreviation: getTimezoneAbbreviation(validatedTimezone),
    name: getTimezoneName(validatedTimezone),
    currentTime: now.format(),
    isValid: moment.tz.zone(validatedTimezone) !== null,
  };
}

/**
 * Log timezone context for debugging
 * Helper function to add timezone information to log entries
 * @param {string} timezone - Timezone being used
 * @param {Object} additionalContext - Additional log context
 * @returns {Object} Log context object with timezone info
 * 
 * @example
 * logger.info('Processing data', getTimezoneLogContext('America/Sao_Paulo', { hashtag: 'test' }));
 */
export function getTimezoneLogContext(timezone, additionalContext = {}) {
  const info = getTimezoneInfo(timezone);
  return {
    ...additionalContext,
    timezone: info.timezone,
    timezoneOffset: info.offset,
    timezoneAbbr: info.abbreviation,
  };
}

export default {
  formatDateInTimezone,
  getCurrentDateInTimezone,
  getCurrentMoment,
  getCurrentTimestampISO,
  getCurrentDateFormatted,
  parseAndValidateTimezone,
  getTimezoneOffset,
  getTimezoneAbbreviation,
  getTimezoneName,
  convertDateBetweenTimezones,
  isAtTimezoneBoundary,
  getTimezoneInfo,
  getTimezoneLogContext,
};
