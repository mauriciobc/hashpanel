import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
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
} from '../../../src/utils/timezone.js';

// Mock the config module
vi.mock('../../../src/config/index.js', () => ({
  env: {
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
    PREFERRED_TIMEZONE: 'America/Sao_Paulo',
  },
  appConfig: {
    server: {
      timezone: 'America/Sao_Paulo',
    },
  },
}));

describe('timezone utils', () => {
  beforeEach(() => {
    // Mock moment to return consistent dates for testing
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-23T10:30:00Z'));
  });

  describe('formatDateInTimezone', () => {
    it('should format date in specified timezone', () => {
      const date = '2026-01-23T10:30:00Z';
      const result = formatDateInTimezone(date, 'America/Sao_Paulo', 'YYYY-MM-DD');
      expect(result).toBe('2026-01-23');
    });

    it('should use default timezone when none provided', () => {
      const date = '2026-01-23T10:30:00Z';
      const result = formatDateInTimezone(date);
      expect(result).toBe('2026-01-23');
    });

    it('should throw error for invalid date', () => {
      expect(() => formatDateInTimezone(null, 'UTC')).toThrow('Date is required for formatting');
    });
  });

  describe('getCurrentDateInTimezone', () => {
    it('should return current date in specified timezone', () => {
      const result = getCurrentDateInTimezone('UTC');
      expect(result).toBe('2026-01-23');
    });

    it('should use default timezone when none provided', () => {
      const result = getCurrentDateInTimezone();
      expect(result).toBe('2026-01-23');
    });
  });

  describe('getCurrentMoment', () => {
    it('should return moment object in specified timezone', () => {
      const moment = getCurrentMoment('UTC');
      expect(moment.isValid()).toBe(true);
      expect(moment.format('YYYY-MM-DD')).toBe('2026-01-23');
    });
  });

  describe('getCurrentTimestampISO', () => {
    it('should return ISO timestamp', () => {
      const result = getCurrentTimestampISO();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('getCurrentDateFormatted', () => {
    it('should format current date in Brazilian format', () => {
      const result = getCurrentDateFormatted('UTC');
      expect(result).toBe('23/01/2026');
    });
  });

  describe('parseAndValidateTimezone', () => {
    it('should return valid IANA timezone', () => {
      const result = parseAndValidateTimezone('America/Sao_Paulo');
      expect(result).toBe('America/Sao_Paulo');
    });

    it('should return fallback for invalid timezone', () => {
      const result = parseAndValidateTimezone('Invalid/Timezone');
      expect(result).toBe('America/Sao_Paulo'); // fallback
    });

    it('should throw error when throwOnInvalid is true', () => {
      expect(() => parseAndValidateTimezone('Invalid/Timezone', { throwOnInvalid: true }))
        .toThrow('Invalid IANA timezone identifier');
    });

    it('should return fallback for null input', () => {
      const result = parseAndValidateTimezone(null);
      expect(result).toBe('America/Sao_Paulo');
    });

    it('should return fallback for empty string', () => {
      const result = parseAndValidateTimezone('');
      expect(result).toBe('America/Sao_Paulo');
    });

    it('should reject non-string inputs', () => {
      const result = parseAndValidateTimezone(123);
      expect(result).toBe('America/Sao_Paulo'); // fallback due to validation
    });
  });

  describe('getTimezoneOffset', () => {
    it('should return offset for Sao Paulo', () => {
      const result = getTimezoneOffset('America/Sao_Paulo');
      expect(result).toBe('UTC-03'); // or UTC-02 during DST
    });

    it('should return UTC for UTC timezone', () => {
      const result = getTimezoneOffset('UTC');
      expect(result).toBe('UTC');
    });
  });

   describe('getTimezoneAbbreviation', () => {
     it('should return abbreviation for Sao Paulo', () => {
       const result = getTimezoneAbbreviation('America/Sao_Paulo');
       expect(result).toBe('-03'); // UTC-3 for Sao Paulo (no DST in test date)
     });
   });

  describe('getTimezoneName', () => {
    it('should return friendly name', () => {
      const result = getTimezoneName('America/Sao_Paulo');
      expect(result).toBe('Sao Paulo');
    });
  });

  describe('convertDateBetweenTimezones', () => {
    it('should convert date between timezones', () => {
      const date = '2026-01-23T10:30:00Z';
      const result = convertDateBetweenTimezones(date, 'UTC', 'America/Sao_Paulo');
      expect(result.isValid()).toBe(true);
    });

    it('should throw for invalid timezones', () => {
      const date = '2026-01-23T10:30:00Z';
      expect(() => convertDateBetweenTimezones(date, 'Invalid', 'UTC')).toThrow();
    });
  });

  describe('isAtTimezoneBoundary', () => {
    it('should detect dates near midnight', () => {
      const nearMidnight = '2026-01-23T23:30:00Z'; // 20:30 in Sao Paulo
      const result = isAtTimezoneBoundary(nearMidnight, 'America/Sao_Paulo');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getTimezoneInfo', () => {
    it('should return comprehensive timezone info', () => {
      const result = getTimezoneInfo('America/Sao_Paulo');
      expect(result).toHaveProperty('timezone');
      expect(result).toHaveProperty('offset');
      expect(result).toHaveProperty('abbreviation');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('currentTime');
      expect(result).toHaveProperty('isValid');
    });
  });

  describe('getTimezoneLogContext', () => {
    it('should return log context with timezone info', () => {
      const result = getTimezoneLogContext('America/Sao_Paulo', { user: 'test' });
      expect(result).toHaveProperty('timezone');
      expect(result).toHaveProperty('timezoneOffset');
      expect(result).toHaveProperty('timezoneAbbr');
      expect(result).toHaveProperty('user');
    });
  });
});
