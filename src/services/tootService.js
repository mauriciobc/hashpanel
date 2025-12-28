import { mastodonService } from './mastodon.js';
import { dataProcessor } from './dataProcessor.js';
import { logger, loggers } from '../utils/logger.js';
import { appConfig as config } from '../config/index.js';
import { BusinessError, ValidationError } from '../errors/index.js';
import { generateTootLink } from '../utils/linkGenerator.js';

export class TootService {
  constructor() {
    this.postingStats = {
      totalPosted: 0,
      successfulPosts: 0,
      failedPosts: 0,
      lastPostTime: null
    };
  }

  /**
   * Generate summary text for a hashtag
   */
  async generateSummary(hashtag, analysis) {
    if (!hashtag) {
      throw new ValidationError('Hashtag is required');
    }

    if (!analysis) {
      throw new ValidationError('Analysis is required');
    }

    logger.info(`Generating summary for hashtag: ${hashtag}`);

    try {
      // Get key metrics
      const todayCount = analysis.getTodayCount();
      const weeklyTotal = analysis.getWeeklyTotal();
      const uniqueUsers = analysis.getUniqueUserCount();
      const topToots = analysis.getTopToots(3);
      const engagement = analysis.getEngagementStats();

      // Build summary text
      const summaryLines = [
        `📊 #${hashtag} - Resumo Diário`,
        '',
        `📝 Posts hoje: ${todayCount}`,
        `👥 Participantes: ${uniqueUsers}`,
        `📈 Posts na semana: ${weeklyTotal}`,
        ''
      ];

      // Add engagement section
      if (todayCount > 0) {
        summaryLines.push(
          `🔥 Engajamento de hoje:`,
          `⭐ ${engagement.totalFavorites} favoritos`,
          `🔄 ${engagement.totalBoosts} boosts`,
          `💬 ${engagement.totalReplies} respostas`,
          ''
        );
      }

      // Add top posts section
      if (topToots.length > 0) {
        summaryLines.push('🏆 Principais posts:');
        
        for (let i = 0; i < topToots.length; i++) {
          const toot = topToots[i];
          const link = await generateTootLink(toot.id);
          
          summaryLines.push(
            `${i + 1}. @${toot.account.username} (Score: ${toot.relevanceScore})`,
            `   🔗 ${link}`,
            ''
          );
        }
      }

      // Add footer
      summaryLines.push(
        `📅 Gerado em ${new Date().toLocaleDateString('pt-BR')}`,
        `🤖 Via #Hashbot2`
      );

      const summary = summaryLines.join('\n');
      
      // Validate summary length
      if (summary.length > 500) {
        logger.warn(`Summary exceeds 500 characters: ${summary.length}`);
        // Truncate if necessary
        return this.truncateSummary(summaryLines, 500);
      }

      logger.info(`Generated summary for ${hashtag}`, {
        length: summary.length,
        tootCount: todayCount
      });

      return summary;
      
    } catch (error) {
      loggers.error(`Failed to generate summary for hashtag: ${hashtag}`, error);
      throw new BusinessError(`Failed to generate summary: ${error.message}`);
    }
  }

  /**
   * Truncate summary to fit within character limit
   */
  truncateSummary(summaryLines, maxLength) {
    const truncatedLines = [];
    let currentLength = 0;
    
    for (const line of summaryLines) {
      if (currentLength + line.length + 1 > maxLength) {
        break;
      }
      truncatedLines.push(line);
      currentLength += line.length + 1;
    }
    
    // Add truncation notice
    if (truncatedLines.length < summaryLines.length) {
      truncatedLines.push('... (resumo truncado)');
    }
    
    return truncatedLines.join('\n');
  }

  /**
   * Post summary to Mastodon
   */
  async postSummary(summary, hashtag) {
    if (!summary) {
      throw new ValidationError('Summary is required');
    }

    if (!hashtag) {
      throw new ValidationError('Hashtag is required');
    }

    logger.info(`Posting summary for hashtag: ${hashtag}`, {
      summaryLength: summary.length
    });

    try {
      // Validate summary before posting
      this.validateSummary(summary);
      
      // Post to Mastodon
      const result = await mastodonService.createToot(summary, {
        language: 'pt',
        visibility: 'public',
        sensitive: false
      });

      // Update statistics
      this.updatePostingStats(true);
      
      loggers.business('summary_posted', {
        tootId: result.id,
        hashtag,
        summaryLength: summary.length,
        url: result.url
      });

      return result;
      
    } catch (error) {
      this.updatePostingStats(false);
      loggers.error(`Failed to post summary for hashtag: ${hashtag}`, error);
      throw new BusinessError(`Failed to post summary: ${error.message}`);
    }
  }

  /**
   * Validate summary text
   */
  validateSummary(summary) {
    if (typeof summary !== 'string') {
      throw new ValidationError('Summary must be a string');
    }

    if (summary.trim().length === 0) {
      throw new ValidationError('Summary cannot be empty');
    }

    if (summary.length > 500) {
      throw new ValidationError(`Summary exceeds 500 character limit (${summary.length} characters)`);
    }

    // Check for required content
    if (!summary.includes('#')) {
      throw new ValidationError('Summary must include at least one hashtag');
    }
  }

  /**
   * Update posting statistics
   */
  updatePostingStats(success) {
    this.postingStats.totalPosted++;
    
    if (success) {
      this.postingStats.successfulPosts++;
      this.postingStats.lastPostTime = new Date();
    } else {
      this.postingStats.failedPosts++;
    }
  }

  /**
   * Create a custom toot
   */
  async createCustomToot(content, options = {}) {
    if (!content) {
      throw new ValidationError('Content is required');
    }

    logger.info('Creating custom toot', {
      contentLength: content.length,
      options
    });

    try {
      // Validate content
      this.validateSummary(content);
      
      // Create toot with custom options
      const result = await mastodonService.createToot(content, {
        language: options.language || 'pt',
        visibility: options.visibility || 'public',
        sensitive: options.sensitive || false,
        ...options
      });

      // Update statistics
      this.updatePostingStats(true);
      
      loggers.business('custom_toot_created', {
        tootId: result.id,
        contentLength: content.length,
        visibility: options.visibility
      });

      return result;
      
    } catch (error) {
      this.updatePostingStats(false);
      loggers.error('Failed to create custom toot', error);
      throw new BusinessError(`Failed to create custom toot: ${error.message}`);
    }
  }

  /**
   * Generate and post summary in one operation
   */
  async generateAndPostSummary(hashtag, analysis) {
    logger.info(`Generating and posting summary for hashtag: ${hashtag}`);

    try {
      // Generate summary
      const summary = await this.generateSummary(hashtag, analysis);
      
      // Post summary
      const result = await this.postSummary(summary, hashtag);
      
      loggers.business('summary_generated_and_posted', {
        tootId: result.id,
        hashtag,
        summaryLength: summary.length
      });

      return {
        summary,
        toot: result
      };
      
    } catch (error) {
      loggers.error(`Failed to generate and post summary for hashtag: ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Preview summary without posting
   */
  async previewSummary(hashtag, analysis) {
    logger.info(`Previewing summary for hashtag: ${hashtag}`);

    try {
      const summary = await this.generateSummary(hashtag, analysis);
      
      return {
        summary,
        length: summary.length,
        characterCount: summary.length,
        hashtagCount: (summary.match(/#/g) || []).length,
        lineCount: summary.split('\n').length,
        isValid: summary.length <= 500
      };
      
    } catch (error) {
      loggers.error(`Failed to preview summary for hashtag: ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Get posting statistics
   */
  getStats() {
    const successRate = this.postingStats.totalPosted > 0 
      ? (this.postingStats.successfulPosts / this.postingStats.totalPosted) * 100 
      : 0;

    return {
      ...this.postingStats,
      successRate: Math.round(successRate * 100) / 100,
      failureRate: Math.round((100 - successRate) * 100) / 100
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.postingStats = {
      totalPosted: 0,
      successfulPosts: 0,
      failedPosts: 0,
      lastPostTime: null
    };
    
    logger.info('Toot service statistics reset');
  }

  /**
   * Get posting history (placeholder for future implementation)
   */
  async getPostingHistory(limit = 10) {
    // This would typically query a database or log file
    // For now, return basic info
    return {
      posts: [],
      total: this.postingStats.successfulPosts,
      limit
    };
  }

  /**
   * Check if posting is allowed (rate limiting, etc.)
   */
  canPost() {
    // Add any posting restrictions here
    // For example: rate limiting, time restrictions, etc.
    
    const now = new Date();
    const lastPost = this.postingStats.lastPostTime;
    
    // Example: don't post more than once per hour
    if (lastPost) {
      const timeSinceLastPost = now - lastPost;
      const oneHour = 60 * 60 * 1000;
      
      if (timeSinceLastPost < oneHour) {
        return {
          allowed: false,
          reason: 'Rate limit: Only one post per hour allowed',
          nextAllowedTime: new Date(lastPost.getTime() + oneHour)
        };
      }
    }
    
    return { allowed: true };
  }
}

// Export singleton instance for use across the application
export const tootService = new TootService();