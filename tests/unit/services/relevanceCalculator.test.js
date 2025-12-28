import assert from 'assert';
import { RelevanceCalculator } from '../../../src/services/relevanceCalculator.js';
import { DataProcessingError } from '../../../src/errors/index.js';

/**
 * Test suite for RelevanceCalculator weight validation and NaN prevention
 * Uses Node.js native assert module (no external test framework required)
 */

// Test helper function
function createTestToot() {
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
    }
  };
}

// Test: Normalize missing favorites key
function testNormalizeMissingFavorites() {
  const incompleteWeights = {
    boosts: 0.5,
    followers: 0.5
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0, 'favorites should be normalized to 0');
  assert.strictEqual(calculator.weights.boosts, 0.5, 'boosts should remain 0.5');
  assert.strictEqual(calculator.weights.followers, 0.5, 'followers should remain 0.5');
  console.log('✓ testNormalizeMissingFavorites');
}

// Test: Normalize missing boosts key
function testNormalizeMissingBoosts() {
  const incompleteWeights = {
    favorites: 0.6,
    followers: 0.4
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0.6, 'favorites should remain 0.6');
  assert.strictEqual(calculator.weights.boosts, 0, 'boosts should be normalized to 0');
  assert.strictEqual(calculator.weights.followers, 0.4, 'followers should remain 0.4');
  console.log('✓ testNormalizeMissingBoosts');
}

// Test: Normalize missing followers key
function testNormalizeMissingFollowers() {
  const incompleteWeights = {
    favorites: 0.7,
    boosts: 0.3
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0.7, 'favorites should remain 0.7');
  assert.strictEqual(calculator.weights.boosts, 0.3, 'boosts should remain 0.3');
  assert.strictEqual(calculator.weights.followers, 0, 'followers should be normalized to 0');
  console.log('✓ testNormalizeMissingFollowers');
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
    boosts: 0.5,
    followers: 0.5
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0, 'undefined favorites should be coerced to 0');
  assert.strictEqual(calculator.weights.boosts, 0.5, 'boosts should remain 0.5');
  assert.strictEqual(calculator.weights.followers, 0.5, 'followers should remain 0.5');
  console.log('✓ testHandleUndefinedValues');
}

// Test: Handle null values
function testHandleNullValues() {
  const incompleteWeights = {
    favorites: null,
    boosts: 0.5,
    followers: 0.5
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0, 'null favorites should be coerced to 0');
  assert.strictEqual(calculator.weights.boosts, 0.5, 'boosts should remain 0.5');
  assert.strictEqual(calculator.weights.followers, 0.5, 'followers should remain 0.5');
  console.log('✓ testHandleNullValues');
}

// Test: No NaN with incomplete weights that sum to 1.0
function testNoNaNWithIncompleteWeights() {
  const incompleteWeights = {
    favorites: 0.5,
    boosts: 0.5
    // Missing followers (will be normalized to 0, sum still 1.0)
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
    followers: 0
  };
  
  assert.throws(() => {
    new RelevanceCalculator(zeroWeights);
  }, DataProcessingError, 'should throw DataProcessingError when sum is 0');
  console.log('✓ testErrorWithAllZeroWeights');
}

// Test: Normalized weights used in calculations
function testNormalizedWeightsUsedInCalculations() {
  const incompleteWeights = {
    favorites: 0.8,
    boosts: 0.2
    // followers missing
  };
  
  const calculator = new RelevanceCalculator(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0.8, 'favorites should be 0.8');
  assert.strictEqual(calculator.weights.boosts, 0.2, 'boosts should be 0.2');
  assert.strictEqual(calculator.weights.followers, 0, 'followers should be normalized to 0');
  
  const testToot = createTestToot();
  const result = calculator.calculateRelevance(testToot);
  
  assert.ok(!isNaN(result.relevanceScore), 'score should not be NaN');
  console.log('✓ testNormalizedWeightsUsedInCalculations');
}

// Test: Normalize on update with weights that sum to 1.0
function testNormalizeOnUpdate() {
  const calculator = new RelevanceCalculator();
  
  const incompleteWeights = {
    favorites: 0.6,
    boosts: 0.4
    // Missing followers (will be normalized to 0, sum still 1.0)
  };
  
  calculator.updateWeights(incompleteWeights);
  
  assert.strictEqual(calculator.weights.favorites, 0.6, 'favorites should be 0.6');
  assert.strictEqual(calculator.weights.boosts, 0.4, 'boosts should be 0.4');
  assert.strictEqual(calculator.weights.followers, 0, 'followers should be normalized to 0');
  console.log('✓ testNormalizeOnUpdate');
}

// Run all tests
import { pathToFileURL } from 'url';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Running RelevanceCalculator weight validation tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  const tests = [
    testNormalizeMissingFavorites,
    testNormalizeMissingBoosts,
    testNormalizeMissingFollowers,
    testNormalizeAllMissingKeys,
    testHandleUndefinedValues,
    testHandleNullValues,
    testNoNaNWithIncompleteWeights,
    testNoNaNWithCustomWeights,
    testValidScoresWithPartialWeights,
    testErrorWithAllZeroWeights,
    testNormalizedWeightsUsedInCalculations,
    testNormalizeOnUpdate
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
  testNormalizeMissingFavorites,
  testNormalizeMissingBoosts,
  testNormalizeMissingFollowers,
  testNormalizeAllMissingKeys,
  testHandleUndefinedValues,
  testHandleNullValues,
  testNoNaNWithIncompleteWeights,
  testNoNaNWithCustomWeights,
  testValidScoresWithPartialWeights,
  testErrorWithAllZeroWeights,
  testNormalizedWeightsUsedInCalculations,
  testNormalizeOnUpdate
};
