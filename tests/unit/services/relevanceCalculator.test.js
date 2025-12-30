import assert from 'assert';
import { RelevanceCalculator } from '../../../src/services/relevanceCalculator.js';
import { DataProcessingError } from '../../../src/errors/index.js';

/**
 * Test suite for RelevanceCalculator weight validation, NaN prevention, and score normalization
 * Uses Node.js native assert module (no external test framework required)
 * 
 * v2.0: Updated for replies weight and 0-100 normalization
 */

// Test helper function
function createTestToot(overrides = {}) {
  return {
    id: '123',
    favourites_count: 10,
    reblogs_count: 5,
    replies_count: 2,
    account: {
      id: '456',
      username: 'testuser',
      followers_count: 100,
      following_count: 50,
      statuses_count: 200,
      created_at: '2020-01-01T00:00:00Z'
    },
    ...overrides
  };
}

// Helper to create a viral toot with high engagement
function createViralToot() {
  return createTestToot({
    favourites_count: 50000,
    reblogs_count: 10000,
    replies_count: 5000,
    account: {
      id: '789',
      username: 'influencer',
      followers_count: 500000,
      following_count: 100,
      statuses_count: 1000,
      created_at: '2018-01-01T00:00:00Z'
    }
  });
}

// Test: Normalize missing favorites key
function testNormalizeMissingFavorites() {
  const incompleteWeights = {
    boosts: 0.4,
    followers: 0.4,
    replies: 0.2
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0, 'favorites should be normalized to 0');
  assert.strictEqual(calculator.weights.boosts, 0.4, 'boosts should remain 0.4');
  assert.strictEqual(calculator.weights.followers, 0.4, 'followers should remain 0.4');
  assert.strictEqual(calculator.weights.replies, 0.2, 'replies should remain 0.2');
  console.log('✓ testNormalizeMissingFavorites');
}

// Test: Normalize missing boosts key
function testNormalizeMissingBoosts() {
  const incompleteWeights = {
    favorites: 0.5,
    followers: 0.3,
    replies: 0.2
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0.5, 'favorites should remain 0.5');
  assert.strictEqual(calculator.weights.boosts, 0, 'boosts should be normalized to 0');
  assert.strictEqual(calculator.weights.followers, 0.3, 'followers should remain 0.3');
  assert.strictEqual(calculator.weights.replies, 0.2, 'replies should remain 0.2');
  console.log('✓ testNormalizeMissingBoosts');
}

// Test: Normalize missing followers key
function testNormalizeMissingFollowers() {
  const incompleteWeights = {
    favorites: 0.5,
    boosts: 0.3,
    replies: 0.2
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0.5, 'favorites should remain 0.5');
  assert.strictEqual(calculator.weights.boosts, 0.3, 'boosts should remain 0.3');
  assert.strictEqual(calculator.weights.followers, 0, 'followers should be normalized to 0');
  assert.strictEqual(calculator.weights.replies, 0.2, 'replies should remain 0.2');
  console.log('✓ testNormalizeMissingFollowers');
}

// Test: Normalize missing replies key (new in v2.0)
function testNormalizeMissingReplies() {
  const incompleteWeights = {
    favorites: 0.4,
    boosts: 0.3,
    followers: 0.3
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0.4, 'favorites should remain 0.4');
  assert.strictEqual(calculator.weights.boosts, 0.3, 'boosts should remain 0.3');
  assert.strictEqual(calculator.weights.followers, 0.3, 'followers should remain 0.3');
  assert.strictEqual(calculator.weights.replies, 0, 'replies should be normalized to 0');
  console.log('✓ testNormalizeMissingReplies');
}

// Test: Error when all required keys are missing and sum is not 1.0
function testNormalizeAllMissingKeys() {
  const incompleteWeights = {
    customKey: 1.0
  };
  
  // Should throw error because after normalizing required keys to 0, sum is 0, not 1.0
  assert.throws(() => {
    new RelevanceCalculator(incompleteWeights);
  }, DataProcessingError, 'should throw error when sum is not 1.0 after normalization');
  console.log('✓ testNormalizeAllMissingKeys');
}

// Test: Handle undefined values
function testHandleUndefinedValues() {
  const incompleteWeights = {
    favorites: undefined,
    boosts: 0.4,
    followers: 0.4,
    replies: 0.2
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0, 'undefined favorites should be coerced to 0');
  assert.strictEqual(calculator.weights.boosts, 0.4, 'boosts should remain 0.4');
  assert.strictEqual(calculator.weights.followers, 0.4, 'followers should remain 0.4');
  assert.strictEqual(calculator.weights.replies, 0.2, 'replies should remain 0.2');
  console.log('✓ testHandleUndefinedValues');
}

// Test: Handle null values
function testHandleNullValues() {
  const incompleteWeights = {
    favorites: null,
    boosts: 0.4,
    followers: 0.4,
    replies: 0.2
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0, 'null favorites should be coerced to 0');
  assert.strictEqual(calculator.weights.boosts, 0.4, 'boosts should remain 0.4');
  assert.strictEqual(calculator.weights.followers, 0.4, 'followers should remain 0.4');
  assert.strictEqual(calculator.weights.replies, 0.2, 'replies should remain 0.2');
  console.log('✓ testHandleNullValues');
}

// Test: No NaN with incomplete weights that sum to 1.0
function testNoNaNWithIncompleteWeights() {
  const incompleteWeights = {
    favorites: 0.4,
    boosts: 0.3,
    followers: 0.3
    // Missing replies (will be normalized to 0, sum still 1.0)
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  const testToot = createTestToot();
  const result = calculator.calculateRelevance(testToot);
  
  assert.ok(typeof result.relevanceScore === 'number', 'score should be a number');
  assert.ok(!isNaN(result.relevanceScore), 'score should not be NaN');
  assert.ok(isFinite(result.relevanceScore), 'score should be finite');
  console.log('✓ testNoNaNWithIncompleteWeights');
}

// Test: Error with custom weights missing all required keys (sum not 1.0)
function testNoNaNWithCustomWeights() {
  const customWeights = {
    customMetric: 1.0
  };
  
  // Should throw error because after normalizing required keys to 0, sum is 0, not 1.0
  assert.throws(() => {
    new RelevanceCalculator(customWeights);
  }, DataProcessingError, 'should throw error when sum is not 1.0 after normalization');
  console.log('✓ testNoNaNWithCustomWeights');
}

// Test: Valid scores with partial weights
function testValidScoresWithPartialWeights() {
  const partialWeights = {
    favorites: 1.0
  };
  
  const calculator = new RelevanceCalculator(partialWeights);
  const testToot = createTestToot();
  const result = calculator.calculateRelevance(testToot);
  
  assert.ok(typeof result.relevanceScore === 'number', 'score should be a number');
  assert.ok(!isNaN(result.relevanceScore), 'score should not be NaN');
  assert.ok(isFinite(result.relevanceScore), 'score should be finite');
  assert.ok(result.relevanceScore >= 0, 'score should be non-negative');
  console.log('✓ testValidScoresWithPartialWeights');
}

// Test: Error with all weights as 0
function testErrorWithAllZeroWeights() {
  const zeroWeights = {
    favorites: 0,
    boosts: 0,
    followers: 0,
    replies: 0
  };
  
  assert.throws(() => {
    new RelevanceCalculator(zeroWeights);
  }, DataProcessingError, 'should throw DataProcessingError when sum is 0');
  console.log('✓ testErrorWithAllZeroWeights');
}

// Test: Normalized weights used in calculations
function testNormalizedWeightsUsedInCalculations() {
  const incompleteWeights = {
    favorites: 0.6,
    boosts: 0.2,
    followers: 0.2
    // replies missing
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0.6, 'favorites should be 0.6');
  assert.strictEqual(calculator.weights.boosts, 0.2, 'boosts should be 0.2');
  assert.strictEqual(calculator.weights.followers, 0.2, 'followers should be 0.2');
  assert.strictEqual(calculator.weights.replies, 0, 'replies should be normalized to 0');
  
  const testToot = createTestToot();
  const result = calculator.calculateRelevance(testToot);
  
  assert.ok(!isNaN(result.relevanceScore), 'score should not be NaN');
  console.log('✓ testNormalizedWeightsUsedInCalculations');
}

// Test: Normalize on update with weights that sum to 1.0
function testNormalizeOnUpdate() {
  const calculator = new RelevanceCalculator();
  
  const incompleteWeights = {
    favorites: 0.5,
    boosts: 0.3,
    followers: 0.2
    // Missing replies (will be normalized to 0, sum still 1.0)
  };
  
  calculator.updateWeights(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0.5, 'favorites should be 0.5');
  assert.strictEqual(calculator.weights.boosts, 0.3, 'boosts should be 0.3');
  assert.strictEqual(calculator.weights.followers, 0.2, 'followers should be 0.2');
  assert.strictEqual(calculator.weights.replies, 0, 'replies should be normalized to 0');
  console.log('✓ testNormalizeOnUpdate');
}

// Test: Score normalization returns values between 0 and 100 (new in v2.0)
function testScoreNormalizationRange() {
  const calculator = new RelevanceCalculator();
  const testToot = createTestToot();
  const result = calculator.calculateRelevance(testToot);
  
  assert.ok(result.relevanceScore >= 0, 'normalized score should be >= 0');
  assert.ok(result.relevanceScore <= 100, 'normalized score should be <= 100');
  assert.ok(typeof result.relevanceScoreRaw === 'number', 'raw score should be a number');
  console.log('✓ testScoreNormalizationRange');
}

// Test: Viral content gets high scores but stays under 100 (new in v2.0)
function testViralContentScores() {
  const calculator = new RelevanceCalculator();
  const viralToot = createViralToot();
  const result = calculator.calculateRelevance(viralToot);
  
  assert.ok(result.relevanceScore >= 80, 'viral content should have high score (>= 80)');
  assert.ok(result.relevanceScore <= 100, 'viral content score should not exceed 100');
  assert.ok(result.relevanceScoreRaw > 3, 'raw score for viral content should be significant');
  console.log('✓ testViralContentScores');
}

// Test: Low engagement gets low scores (new in v2.0)
function testLowEngagementScores() {
  const calculator = new RelevanceCalculator();
  const lowEngagementToot = createTestToot({
    favourites_count: 0,
    reblogs_count: 0,
    replies_count: 0,
    account: {
      id: '999',
      username: 'newuser',
      followers_count: 5,
      following_count: 10,
      statuses_count: 3,
      created_at: '2024-01-01T00:00:00Z'
    }
  });
  
  const result = calculator.calculateRelevance(lowEngagementToot);
  
  assert.ok(result.relevanceScore >= 0, 'low engagement score should be >= 0');
  assert.ok(result.relevanceScore < 30, 'low engagement should have low score (< 30)');
  console.log('✓ testLowEngagementScores');
}

// Test: Replies contribute to score (new in v2.0)
function testRepliesContributeToScore() {
  const calculator = new RelevanceCalculator();
  
  const tootWithReplies = createTestToot({
    favourites_count: 10,
    reblogs_count: 5,
    replies_count: 100  // High replies
  });
  
  const tootWithoutReplies = createTestToot({
    favourites_count: 10,
    reblogs_count: 5,
    replies_count: 0
  });
  
  const resultWithReplies = calculator.calculateRelevance(tootWithReplies);
  const resultWithoutReplies = calculator.calculateRelevance(tootWithoutReplies);
  
  assert.ok(
    resultWithReplies.relevanceScore > resultWithoutReplies.relevanceScore,
    'toot with more replies should have higher score'
  );
  console.log('✓ testRepliesContributeToScore');
}

// Run all tests
import { pathToFileURL } from 'url';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Running RelevanceCalculator v2.0 tests (with replies + normalization)...\n');
  
  let passed = 0;
  let failed = 0;
  
  const tests = [
    // Weight validation tests
    testNormalizeMissingFavorites,
    testNormalizeMissingBoosts,
    testNormalizeMissingFollowers,
    testNormalizeMissingReplies,
    testNormalizeAllMissingKeys,
    testHandleUndefinedValues,
    testHandleNullValues,
    testNoNaNWithIncompleteWeights,
    testNoNaNWithCustomWeights,
    testValidScoresWithPartialWeights,
    testErrorWithAllZeroWeights,
    testNormalizedWeightsUsedInCalculations,
    testNormalizeOnUpdate,
    // Score normalization tests (v2.0)
    testScoreNormalizationRange,
    testViralContentScores,
    testLowEngagementScores,
    testRepliesContributeToScore
  ];
  
  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (error) {
      console.error(`✗ ${test.name}`);
      console.error(`  ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\nTest execution completed.`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

export {
  // Weight validation tests
  testNormalizeMissingFavorites,
  testNormalizeMissingBoosts,
  testNormalizeMissingFollowers,
  testNormalizeMissingReplies,
  testNormalizeAllMissingKeys,
  testHandleUndefinedValues,
  testHandleNullValues,
  testNoNaNWithIncompleteWeights,
  testNoNaNWithCustomWeights,
  testValidScoresWithPartialWeights,
  testErrorWithAllZeroWeights,
  testNormalizedWeightsUsedInCalculations,
  testNormalizeOnUpdate,
  // Score normalization tests (v2.0)
  testScoreNormalizationRange,
  testViralContentScores,
  testLowEngagementScores,
  testRepliesContributeToScore
};
