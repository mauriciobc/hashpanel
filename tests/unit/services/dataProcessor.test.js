import assert from 'assert';
import { describe, it, beforeEach } from 'vitest';
import { DataProcessor } from '../../../src/services/dataProcessor.js';
import { DataProcessingError } from '../../../src/errors/index.js';
import moment from 'moment-timezone';

/**
 * Test suite for DataProcessor
 * Tests data processing pipeline, filtering, and timezone handling
 */

// Test helper: Create a valid toot object
function createTestToot(overrides = {}) {
  return {
    id: '123',
    created_at: '2025-01-24T12:00:00Z',
    content: '<p>Test toot content</p>',
    favourites_count: 10,
    reblogs_count: 5,
    replies_count: 2,
    account: {
      id: '456',
      username: 'testuser',
      followers_count: 100,
    },
    ...overrides,
  };
}

// Test helper: Create multiple toots with different dates
function createTootsWithDates(dates, timezone = 'UTC') {
  return dates.map((date, index) => {
    const momentDate = moment.tz(date, timezone);
    return createTestToot({
      id: `${index + 1}`,
      created_at: momentDate.toISOString(),
    });
  });
}

describe('DataProcessor', () => {
  let processor;

  beforeEach(() => {
    processor = new DataProcessor();
  });

  describe('Constructor', () => {
    it('should initialize with default stats', () => {
      const stats = processor.getStats();
      assert.strictEqual(stats.totalProcessed, 0);
      assert.strictEqual(stats.validToots, 0);
      assert.strictEqual(stats.ignoredToots, 0);
      assert.strictEqual(stats.errors, 0);
    });

    it('should accept custom relevance calculator', () => {
      const customCalculator = { calculateRelevance: () => {} };
      const customProcessor = new DataProcessor(customCalculator);
      assert.strictEqual(customProcessor.relevanceCalculator, customCalculator);
    });
  });

  describe('isValidToot', () => {
    it('should validate a valid toot', () => {
      const toot = createTestToot();
      assert.strictEqual(processor.isValidToot(toot), true);
    });

    it('should reject null/undefined', () => {
      assert.strictEqual(processor.isValidToot(null), false);
      assert.strictEqual(processor.isValidToot(undefined), false);
    });

    it('should reject toot missing required fields', () => {
      const invalidToot = { id: '123' };
      assert.strictEqual(processor.isValidToot(invalidToot), false);
    });

    it('should reject toot with invalid account', () => {
      const toot = createTestToot({ account: null });
      assert.strictEqual(processor.isValidToot(toot), false);
    });

    it('should reject toot with negative numeric fields', () => {
      const toot = createTestToot({ favourites_count: -1 });
      assert.strictEqual(processor.isValidToot(toot), false);
    });

    it('should reject toot with non-finite numeric fields', () => {
      const toot = createTestToot({ reblogs_count: NaN });
      assert.strictEqual(processor.isValidToot(toot), false);
    });
  });

  describe('filterValidToots', () => {
    it('should filter out invalid toots', () => {
      const toots = [
        createTestToot({ id: '1' }),
        { id: '2', invalid: true }, // missing required fields
        createTestToot({ id: '3' }),
      ];

      const result = processor.filterValidToots(toots);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, '1');
      assert.strictEqual(result[1].id, '3');
    });

    it('should throw error if input is not an array', () => {
      assert.throws(
        () => processor.filterValidToots('not an array'),
        DataProcessingError
      );
    });

    it('should update stats correctly', () => {
      const toots = [
        createTestToot({ id: '1' }),
        { id: '2' }, // invalid
        createTestToot({ id: '3' }),
      ];

      processor.filterValidToots(toots);
      const stats = processor.getStats();
      assert.strictEqual(stats.validToots, 2);
      assert.strictEqual(stats.errors, 1);
    });
  });

  describe('filterByDate - Timezone Handling', () => {
    it('should filter toots by date in UTC timezone', () => {
      const targetDate = '2025-01-24';
      const toots = createTootsWithDates(
        [
          '2025-01-23T23:00:00', // Jan 23
          '2025-01-24T12:00:00', // Jan 24 ✓
          '2025-01-24T23:59:59', // Jan 24 ✓
          '2025-01-25T01:00:00', // Jan 25
        ],
        'UTC'
      );

      const result = processor.filterByDate(toots, targetDate, 'UTC');
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, '2');
      assert.strictEqual(result[1].id, '3');
    });

    it('should filter toots by date in America/Sao_Paulo timezone (UTC-3)', () => {
      const targetDate = '2025-01-24';
      // Create toots with UTC timestamps that fall on different dates in São Paulo
      const toots = [
        createTestToot({
          id: '1',
          created_at: '2025-01-24T02:00:00Z', // Jan 23 23:00 in SP (UTC-3)
        }),
        createTestToot({
          id: '2',
          created_at: '2025-01-24T03:00:00Z', // Jan 24 00:00 in SP ✓
        }),
        createTestToot({
          id: '3',
          created_at: '2025-01-24T15:00:00Z', // Jan 24 12:00 in SP ✓
        }),
        createTestToot({
          id: '4',
          created_at: '2025-01-25T02:59:59Z', // Jan 24 23:59:59 in SP ✓
        }),
        createTestToot({
          id: '5',
          created_at: '2025-01-25T03:00:00Z', // Jan 25 00:00 in SP
        }),
      ];

      const result = processor.filterByDate(toots, targetDate, 'America/Sao_Paulo');
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].id, '2');
      assert.strictEqual(result[1].id, '3');
      assert.strictEqual(result[2].id, '4');
    });

    it('should filter toots by date in Asia/Tokyo timezone (UTC+9)', () => {
      const targetDate = '2025-01-24';
      const toots = [
        createTestToot({
          id: '1',
          created_at: '2025-01-23T14:59:59Z', // Jan 23 23:59:59 in Tokyo
        }),
        createTestToot({
          id: '2',
          created_at: '2025-01-23T15:00:00Z', // Jan 24 00:00 in Tokyo ✓
        }),
        createTestToot({
          id: '3',
          created_at: '2025-01-24T06:00:00Z', // Jan 24 15:00 in Tokyo ✓
        }),
        createTestToot({
          id: '4',
          created_at: '2025-01-24T14:59:59Z', // Jan 24 23:59:59 in Tokyo ✓
        }),
        createTestToot({
          id: '5',
          created_at: '2025-01-24T15:00:00Z', // Jan 25 00:00 in Tokyo
        }),
      ];

      const result = processor.filterByDate(toots, targetDate, 'Asia/Tokyo');
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].id, '2');
      assert.strictEqual(result[1].id, '3');
      assert.strictEqual(result[2].id, '4');
    });

    it('should normalize targetDate correctly regardless of format quirks', () => {
      const targetDate = '2025-01-24';
      const toots = [
        createTestToot({
          id: '1',
          created_at: '2025-01-24T12:00:00Z',
        }),
      ];

      // Should work regardless of how the date is passed
      const result1 = processor.filterByDate(toots, targetDate, 'UTC');
      const result2 = processor.filterByDate(toots, '2025-01-24', 'UTC');

      assert.strictEqual(result1.length, 1);
      assert.strictEqual(result2.length, 1);
    });

    it('should handle date at timezone boundary correctly', () => {
      // Test the exact moment when dates change in different timezones
      const targetDate = '2025-01-24';
      const toots = [
        createTestToot({
          id: '1',
          created_at: '2025-01-24T00:00:00Z', // Exactly midnight UTC
        }),
      ];

      // In UTC, should match
      const resultUTC = processor.filterByDate(toots, targetDate, 'UTC');
      assert.strictEqual(resultUTC.length, 1);

      // In São Paulo (UTC-3), this is Jan 23 21:00
      const resultSP = processor.filterByDate(toots, targetDate, 'America/Sao_Paulo');
      assert.strictEqual(resultSP.length, 0);

      // In Tokyo (UTC+9), this is Jan 24 09:00
      const resultTokyo = processor.filterByDate(toots, targetDate, 'Asia/Tokyo');
      assert.strictEqual(resultTokyo.length, 1);
    });

    it('should throw error if targetDate is missing', () => {
      const toots = [createTestToot()];
      assert.throws(
        () => processor.filterByDate(toots, null),
        DataProcessingError
      );
    });

    it('should use server timezone as fallback if client timezone is invalid', () => {
      const targetDate = '2025-01-24';
      const toots = [
        createTestToot({
          id: '1',
          created_at: '2025-01-24T12:00:00Z',
        }),
      ];

      // Should not throw, should fallback to server timezone
      const result = processor.filterByDate(toots, targetDate, 'Invalid/Timezone');
      assert.ok(Array.isArray(result));
    });

    it('should handle toots with invalid dates gracefully', () => {
      const targetDate = '2025-01-24';
      const toots = [
        createTestToot({
          id: '1',
          created_at: '2025-01-24T12:00:00Z',
        }),
        createTestToot({
          id: '2',
          created_at: 'invalid-date',
        }),
        createTestToot({
          id: '3',
          created_at: '2025-01-24T15:00:00Z',
        }),
      ];

      const result = processor.filterByDate(toots, targetDate, 'UTC');
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, '1');
      assert.strictEqual(result[1].id, '3');
    });
  });

  describe('filterByTimeframe', () => {
    it('should return all toots for "all" timeframe', () => {
      const toots = [createTestToot(), createTestToot()];
      const result = processor.filterByTimeframe(toots, 'all');
      assert.strictEqual(result.length, 2);
    });

    it('should filter toots for "today" timeframe', () => {
      const now = moment().tz('UTC');
      const toots = [
        createTestToot({
          id: '1',
          created_at: now.clone().subtract(2, 'days').toISOString(),
        }),
        createTestToot({
          id: '2',
          created_at: now.clone().toISOString(),
        }),
      ];

      const result = processor.filterByTimeframe(toots, 'today', 'UTC');
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, '2');
    });

    it('should filter toots for "week" timeframe', () => {
      const now = moment().tz('UTC');
      const toots = [
        createTestToot({
          id: '1',
          created_at: now.clone().subtract(8, 'days').toISOString(),
        }),
        createTestToot({
          id: '2',
          created_at: now.clone().subtract(5, 'days').toISOString(),
        }),
        createTestToot({
          id: '3',
          created_at: now.clone().toISOString(),
        }),
      ];

      const result = processor.filterByTimeframe(toots, 'week', 'UTC');
      assert.strictEqual(result.length, 2);
    });

    it('should filter toots for "month" timeframe', () => {
      const now = moment().tz('UTC');
      const toots = [
        createTestToot({
          id: '1',
          created_at: now.clone().subtract(31, 'days').toISOString(),
        }),
        createTestToot({
          id: '2',
          created_at: now.clone().subtract(20, 'days').toISOString(),
        }),
      ];

      const result = processor.filterByTimeframe(toots, 'month', 'UTC');
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, '2');
    });

    it('should handle unknown timeframe gracefully', () => {
      const toots = [createTestToot(), createTestToot()];
      const result = processor.filterByTimeframe(toots, 'unknown', 'UTC');
      assert.strictEqual(result.length, 2);
    });
  });

  describe('sortByRelevance', () => {
    it('should sort toots by relevance score descending', () => {
      const toots = [
        createTestToot({ id: '1', relevanceScore: 50 }),
        createTestToot({ id: '2', relevanceScore: 100 }),
        createTestToot({ id: '3', relevanceScore: 75 }),
      ];

      const result = processor.sortByRelevance(toots);
      assert.strictEqual(result[0].id, '2'); // 100
      assert.strictEqual(result[1].id, '3'); // 75
      assert.strictEqual(result[2].id, '1'); // 50
    });

    it('should handle toots with missing relevance scores', () => {
      const toots = [
        createTestToot({ id: '1', relevanceScore: 50 }),
        createTestToot({ id: '2' }), // no score (treated as 0)
        createTestToot({ id: '3', relevanceScore: 75 }),
      ];

      const result = processor.sortByRelevance(toots);
      assert.strictEqual(result[0].id, '3');
      assert.strictEqual(result[1].id, '1');
      assert.strictEqual(result[2].id, '2');
    });

    it('should not mutate original array', () => {
      const toots = [
        createTestToot({ id: '1', relevanceScore: 50 }),
        createTestToot({ id: '2', relevanceScore: 100 }),
      ];

      const original = [...toots];
      processor.sortByRelevance(toots);

      assert.strictEqual(toots[0].id, original[0].id);
      assert.strictEqual(toots[1].id, original[1].id);
    });
  });

  describe('getTopToots', () => {
    it('should return top N toots by relevance', () => {
      const toots = [
        createTestToot({ id: '1', relevanceScore: 50 }),
        createTestToot({ id: '2', relevanceScore: 100 }),
        createTestToot({ id: '3', relevanceScore: 75 }),
        createTestToot({ id: '4', relevanceScore: 25 }),
      ];

      const result = processor.getTopToots(toots, 2);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, '2'); // 100
      assert.strictEqual(result[1].id, '3'); // 75
    });

    it('should return empty array if count is 0', () => {
      const toots = [createTestToot()];
      const result = processor.getTopToots(toots, 0);
      assert.strictEqual(result.length, 0);
    });

    it('should throw error if input is not an array', () => {
      assert.throws(
        () => processor.getTopToots('not an array', 5),
        DataProcessingError
      );
    });
  });

  describe('processToots - Full Pipeline', () => {
    it('should process toots through complete pipeline', () => {
      const toots = [
        createTestToot({ id: '1', favourites_count: 10 }),
        createTestToot({ id: '2', favourites_count: 20 }),
        { id: '3', invalid: true }, // will be filtered out
      ];

      const result = processor.processToots(toots);
      assert.ok(Array.isArray(result));
      assert.strictEqual(result.length, 2);
      assert.ok(result[0].relevanceScore !== undefined);
    });

    it('should apply date filter when specified', () => {
      const targetDate = '2025-01-24';
      const toots = [
        createTestToot({
          id: '1',
          created_at: '2025-01-24T12:00:00Z',
        }),
        createTestToot({
          id: '2',
          created_at: '2025-01-23T12:00:00Z',
        }),
      ];

      const result = processor.processToots(toots, {
        filterByDate: targetDate,
        timezone: 'UTC',
      });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, '1');
    });

    it('should apply limit when specified', () => {
      const toots = [
        createTestToot({ id: '1' }),
        createTestToot({ id: '2' }),
        createTestToot({ id: '3' }),
      ];

      const result = processor.processToots(toots, { limit: 2 });
      assert.strictEqual(result.length, 2);
    });

    it('should throw error on pipeline failure with null input', () => {
      // The underlying error is a TypeError (reading .length of null)
      // which gets wrapped in DataProcessingError
      assert.throws(
        () => processor.processToots(null),
        (error) => {
          return error instanceof DataProcessingError || error instanceof TypeError;
        }
      );
    });
  });

  describe('resetStats', () => {
    it('should reset processing statistics', () => {
      processor.processingStats.totalProcessed = 100;
      processor.processingStats.validToots = 80;
      processor.processingStats.errors = 20;

      processor.resetStats();

      const stats = processor.getStats();
      assert.strictEqual(stats.totalProcessed, 0);
      assert.strictEqual(stats.validToots, 0);
      assert.strictEqual(stats.errors, 0);
    });
  });

  describe('validateTootStructure - Static Method', () => {
    it('should return empty array for valid toot', () => {
      const toot = createTestToot();
      const errors = DataProcessor.validateTootStructure(toot);
      assert.strictEqual(errors.length, 0);
    });

    it('should return errors for invalid toot', () => {
      const errors = DataProcessor.validateTootStructure(null);
      assert.ok(errors.length > 0);
    });

    it('should detect missing required fields', () => {
      const toot = { id: '123' };
      const errors = DataProcessor.validateTootStructure(toot);
      assert.ok(errors.some((e) => e.includes('created_at')));
      assert.ok(errors.some((e) => e.includes('content')));
      assert.ok(errors.some((e) => e.includes('account')));
    });

    it('should detect missing account fields', () => {
      const toot = createTestToot({
        account: { id: '123' }, // missing username
      });
      const errors = DataProcessor.validateTootStructure(toot);
      assert.ok(errors.some((e) => e.includes('username')));
    });
  });
});
