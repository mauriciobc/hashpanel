import { logger } from '../utils/logger.js';
import { DataProcessingError } from '../errors/index.js';

export class RelevanceCalculator {
  constructor(weights = null) {
    // Default weights that sum to 1.0
    this.weights = weights || {
      favorites: 0.4,    // 40% weight for favorites/likes
      boosts: 0.3,       // 30% weight for boosts/reblogs
      followers: 0.3    // 30% weight for author's followers
    };
    
    this.validateWeights();
    this.calculationStats = {
      totalCalculations: 0,
      errors: 0,
      averageScore: 0,
      maxScore: 0,
      minScore: Infinity
    };
  }

  /**
   * Validate and normalize weights to ensure required keys exist
   * Normalizes weights to always contain favorites, boosts, and followers
   * Missing keys are coerced to 0, then weights are renormalized to sum to 1.0
   */
  validateWeights() {
    // Required weight keys
    const requiredKeys = ['favorites', 'boosts', 'followers'];
    
    // Normalize weights: ensure all required keys exist with numeric values
    const normalizedWeights = { ...this.weights };
    let hasMissingKeys = false;
    
    for (const key of requiredKeys) {
      if (!(key in normalizedWeights) || normalizedWeights[key] === undefined || normalizedWeights[key] === null) {
        normalizedWeights[key] = 0;
        hasMissingKeys = true;
      }
      
      // Coerce to number if not already
      const weightValue = normalizedWeights[key];
      if (typeof weightValue !== 'number' || isNaN(weightValue)) {
        throw new DataProcessingError(
          `Weight for ${key} must be a valid number, got ${weightValue}`,
          'weight_validation',
          { key, weight: weightValue, weights: this.weights }
        );
      }
      
      // Validate range
      if (weightValue < 0 || weightValue > 1) {
        throw new DataProcessingError(
          `Weight for ${key} must be between 0 and 1, got ${weightValue}`,
          'weight_validation',
          { key, weight: weightValue }
        );
      }
    }
    
    // If missing keys were added, log a warning
    if (hasMissingKeys) {
      logger.warn('Missing weight keys were normalized to 0', { 
        originalWeights: this.weights, 
        normalizedWeights 
      });
    }
    
    // Calculate sum of normalized weights
    const sum = requiredKeys.reduce((total, key) => total + normalizedWeights[key], 0);
    
    // Validate sum
    if (Math.abs(sum - 1.0) > 0.01) {
      throw new DataProcessingError(
        `Relevance weights must sum to 1.0, but sum to ${sum}`,
        'weight_validation',
        { weights: normalizedWeights, sum }
      );
    }
    
    // Validate any additional (non-required) weights
    for (const [key, weight] of Object.entries(normalizedWeights)) {
      if (!requiredKeys.includes(key)) {
        if (typeof weight !== 'number' || isNaN(weight) || weight < 0 || weight > 1) {
          throw new DataProcessingError(
            `Weight for ${key} must be a number between 0 and 1`,
            'weight_validation',
            { key, weight }
          );
        }
      }
    }
    
    // Mutate this.weights with normalized values
    this.weights = normalizedWeights;
    
    logger.debug('Relevance weights validated and normalized', { weights: this.weights });
  }

  /**
   * Calculate relevance score for a single toot
   */
  calculateRelevance(toot) {
    try {
      // Validate input
      const validationErrors = this.validateToot(toot);
      if (validationErrors.length > 0) {
        throw new DataProcessingError(
          `Invalid toot structure: ${validationErrors.join(', ')}`,
          'toot_validation',
          { tootId: toot?.id, errors: validationErrors }
        );
      }

      // Extract metrics with fallbacks
      const metrics = this.extractMetrics(toot);
      
      // Calculate weighted score
      const score = this.calculateWeightedScore(metrics);
      
      // Round to 1 decimal place
      const relevanceScore = Math.round(score * 10) / 10;
      
      // Update statistics
      this.updateStats(relevanceScore);
      
      // Return enhanced toot object
      return {
        ...toot,
        relevanceScore,
        metrics,
        calculatedAt: new Date().toISOString()
      };
      
    } catch (error) {
      this.calculationStats.errors++;
      logger.error(`Failed to calculate relevance for toot ${toot?.id}`, error);
      throw error;
    }
  }

  /**
   * Validate toot structure for relevance calculation
   */
  validateToot(toot) {
    const errors = [];
    
    if (!toot || typeof toot !== 'object') {
      errors.push('Toot must be an object');
      return errors;
    }

    // Check required fields
    if (!toot.id) errors.push('Missing toot.id');
    if (!toot.account) errors.push('Missing toot.account');
    
    if (toot.account) {
      if (!toot.account.id) errors.push('Missing toot.account.id');
      if (!toot.account.username) errors.push('Missing toot.account.username');
    }

    // Check numeric fields
    const numericFields = ['favourites_count', 'reblogs_count'];
    for (const field of numericFields) {
      if (field in toot) {
        const value = toot[field];
        if (typeof value !== 'number' || value < 0) {
          errors.push(`${field} must be a non-negative number, got ${value}`);
        }
      }
    }

    return errors;
  }

  /**
   * Extract metrics from toot for calculation
   */
  extractMetrics(toot) {
    return {
      favorites: toot.favourites_count || 0,
      boosts: toot.reblogs_count || 0,
      replies: toot.replies_count || 0,
      followers: toot.account.followers_count || 0,
      following: toot.account.following_count || 0,
      statuses: toot.account.statuses_count || 0,
      accountAge: this.calculateAccountAge(toot.account.created_at)
    };
  }

  /**
   * Calculate account age in days
   */
  calculateAccountAge(createdAt) {
    if (!createdAt) return 0;
    
    try {
      const created = new Date(createdAt);
      
      // Validate the parsed date explicitly
      if (isNaN(created.getTime())) {
        logger.warn('Invalid date for account age calculation', { createdAt });
        return 0;
      }
      
      const now = new Date();
      const diffTime = Math.abs(now - created);
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    } catch (error) {
      logger.warn('Failed to calculate account age', { createdAt, error: error.message });
      return 0;
    }
  }

  /**
   * Calculate weighted relevance score
   * Uses safe defaults to prevent NaN if weights are somehow undefined
   */
  calculateWeightedScore(metrics) {
    const { favorites, boosts, followers } = metrics;
    
    // Apply logarithmic scaling to prevent very large numbers from dominating
    const scaledFollowers = Math.log10(Math.max(1, followers));
    const scaledFavorites = Math.log10(Math.max(1, favorites));
    const scaledBoosts = Math.log10(Math.max(1, boosts));
    
    // Use safe defaults to prevent NaN (weights should be normalized by validateWeights, but this is a safety net)
    const { favorites: wFavorites = 0, boosts: wBoosts = 0, followers: wFollowers = 0 } = this.weights;
    
    // Calculate weighted score
    const score = 
      (wFavorites * scaledFavorites) +
      (wBoosts * scaledBoosts) +
      (wFollowers * scaledFollowers);
    
    // Final safety check: ensure result is a valid number
    if (isNaN(score) || !isFinite(score)) {
      logger.error('Invalid score calculated', { 
        metrics, 
        weights: this.weights, 
        score,
        scaledValues: { scaledFavorites, scaledBoosts, scaledFollowers }
      });
      return 0;
    }
    
    return score;
  }

  /**
   * Update calculation statistics
   */
  updateStats(score) {
    // Increment totalCalculations only for successful calculations
    this.calculationStats.totalCalculations++;
    
    // Update min/max
    if (score > this.calculationStats.maxScore) {
      this.calculationStats.maxScore = score;
    }
    if (score < this.calculationStats.minScore) {
      this.calculationStats.minScore = score;
    }
    
    // Update average (running average)
    const total = this.calculationStats.totalCalculations;
    const currentAvg = this.calculationStats.averageScore;
    this.calculationStats.averageScore = ((currentAvg * (total - 1)) + score) / total;
  }

  /**
   * Calculate relevance for multiple toots
   */
  calculateRelevanceBatch(toots) {
    if (!Array.isArray(toots)) {
      throw new DataProcessingError('Input must be an array of toots', 'batch_calculation');
    }

    logger.info(`Calculating relevance for ${toots.length} toots`);
    
    const results = toots.map((toot, index) => {
      try {
        return this.calculateRelevance(toot);
      } catch (error) {
        logger.error(`Failed to calculate relevance for toot at index ${index}`, error);
        return null;
      }
    }).filter(Boolean); // Remove null results

    logger.info(`Successfully calculated relevance for ${results.length} toots`);
    
    return results;
  }

  /**
   * Get toots sorted by relevance
   */
  sortByRelevance(toots) {
    if (!Array.isArray(toots)) {
      throw new DataProcessingError('Input must be an array of toots', 'sort_relevance');
    }

    // Ensure all toots have relevance scores
    const tootsWithScores = toots.map(toot => {
      if (toot.relevanceScore === undefined) {
        try {
          return this.calculateRelevance(toot);
        } catch (error) {
          logger.error(`Failed to calculate relevance for toot ${toot.id}`, error);
          return { ...toot, relevanceScore: 0 };
        }
      }
      return toot;
    });

    // Sort by relevance score (descending)
    return tootsWithScores.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Get top N toots by relevance
   */
  getTopToots(toots, count = 5) {
    const sortedToots = this.sortByRelevance([...toots]);
    return sortedToots.slice(0, count);
  }

  /**
   * Get calculation statistics
   */
  getStats() {
    const totalAttempts = this.calculationStats.totalCalculations + this.calculationStats.errors;
    return {
      ...this.calculationStats,
      weights: this.weights,
      errorRate: totalAttempts > 0 
        ? (this.calculationStats.errors / totalAttempts) * 100 
        : 0
    };
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      weights: this.weights,
      stats: this.getStats()
    };
  }

  /**
   * Update weights (with validation)
   */
  updateWeights(newWeights) {
    const oldWeights = { ...this.weights };
    
    try {
      this.weights = { ...newWeights };
      this.validateWeights();
      
      logger.info('Updated relevance weights', { 
        oldWeights, 
        newWeights: this.weights 
      });
      
      // Reset stats since weights changed
      this.resetStats();
      
    } catch (error) {
      // Revert to old weights on validation error
      this.weights = oldWeights;
      throw error;
    }
  }

  /**
   * Reset calculation statistics
   */
  resetStats() {
    this.calculationStats = {
      totalCalculations: 0,
      errors: 0,
      averageScore: 0,
      maxScore: 0,
      minScore: Infinity
    };
  }

  /**
   * Export configuration for persistence
   */
  exportConfig() {
    return {
      weights: this.weights,
      version: '1.0',
      exportedAt: new Date().toISOString(),
      stats: this.getStats()
    };
  }

  /**
   * Import configuration (with validation)
   */
  importConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new DataProcessingError('Invalid config object', 'import_config');
    }

    if (!config.weights || typeof config.weights !== 'object') {
      throw new DataProcessingError('Config must contain weights object', 'import_config');
    }

    this.updateWeights(config.weights);
    
    logger.info('Imported relevance configuration', { 
      version: config.version,
      exportedAt: config.exportedAt 
    });
  }
}

// Create singleton instance with default weights
export const relevanceCalculator = new RelevanceCalculator();