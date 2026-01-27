import { mastodonService } from './mastodon.js';
import { imageGenerator } from './imageGenerator.js';
import { hashtagService } from './hashtagService.js';
import { logger, loggers } from '../utils/logger.js';
import { appConfig as config } from '../config/index.js';
import { BusinessError, ValidationError } from '../errors/index.js';
import { generateTootLink } from '../utils/linkGenerator.js';
import { getCurrentDateFormatted } from '../utils/timezone.js';
import fs from 'fs/promises';

// Constants
const MAX_TOOT_LENGTH = 500;
const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour
const TRUNCATION_NOTICE = '... (resumo truncado)';

export class TootService {
  constructor() {
    this.postingStats = {
      totalPosted: 0,
      successfulPosts: 0,
      failedPosts: 0,
      lastPostTime: null,
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
        '',
      ];

      // Add engagement section
      if (todayCount > 0) {
        summaryLines.push(
          '🔥 Engajamento de hoje:',
          `⭐ ${engagement.totalFavorites} favoritos`,
          `🔄 ${engagement.totalBoosts} boosts`,
          `💬 ${engagement.totalReplies} respostas`,
          ''
        );
      }

      // Add top posts section
      if (topToots.length > 0) {
        summaryLines.push('🏆 Principais posts:');

        // Generate all links in parallel
        const linkPromises = topToots.map((toot) => generateTootLink(toot.id));
        const links = await Promise.all(linkPromises);

        // Iterate over topToots and resolved links to build summary lines
        for (let i = 0; i < topToots.length; i++) {
          const toot = topToots[i];
          const link = links[i];

          summaryLines.push(
            `${i + 1}. @${toot.account.username} (Score: ${toot.relevanceScore})`,
            `   🔗 ${link}`,
            ''
          );
        }
      }

      // Add footer
      summaryLines.push(
        `📅 Gerado em ${getCurrentDateFormatted(config.server.timezone)}`,
        '🤖 Via #Hashbot2'
      );

      const summary = summaryLines.join('\n');

      // Truncate if necessary
      if (summary.length > MAX_TOOT_LENGTH) {
        logger.warn(`Summary exceeds ${MAX_TOOT_LENGTH} characters: ${summary.length}`);
        return this.truncateSummary(summaryLines, MAX_TOOT_LENGTH);
      }

      logger.info(`Generated summary for ${hashtag}`, {
        length: summary.length,
        tootCount: todayCount,
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
    let result = '';
    const noticeLength = TRUNCATION_NOTICE.length;

    for (const line of summaryLines) {
      const lineWithNewline = result ? `\n${line}` : line;
      const wouldExceed = result.length + lineWithNewline.length > maxLength;

      if (wouldExceed) {
        // Try to add truncation notice
        const noticeWithNewline = result ? `\n${TRUNCATION_NOTICE}` : TRUNCATION_NOTICE;
        if (result.length + noticeWithNewline.length <= maxLength) {
          result += noticeWithNewline;
        }
        break;
      }

      result += lineWithNewline;
    }

    return result;
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
      summaryLength: summary.length,
    });

    try {
      // Validate summary before posting
      this.validateContent(summary, { requireHashtag: true });

      // Post to Mastodon
      const result = await mastodonService.createToot(summary, {
        language: 'pt',
        visibility: 'public',
        sensitive: false,
      });

      // Update statistics
      this.updatePostingStats(true);

      loggers.business('summary_posted', {
        tootId: result.id,
        hashtag,
        summaryLength: summary.length,
        url: result.url,
      });

      return result;
    } catch (error) {
      this.updatePostingStats(false);
      loggers.error(`Failed to post summary for hashtag: ${hashtag}`, error);
      throw new BusinessError(`Failed to post summary: ${error.message}`);
    }
  }

  /**
   * Validate toot content
   * @param {string} content - Content to validate
   * @param {Object} options - Validation options
   * @param {boolean} options.requireHashtag - Whether to require at least one hashtag
   */
  validateContent(content, options = {}) {
    const { requireHashtag = false } = options;

    if (typeof content !== 'string') {
      throw new ValidationError('Content must be a string');
    }

    if (content.trim().length === 0) {
      throw new ValidationError('Content cannot be empty');
    }

    if (content.length > MAX_TOOT_LENGTH) {
      throw new ValidationError(
        `Content exceeds ${MAX_TOOT_LENGTH} character limit (${content.length} characters)`
      );
    }

    if (requireHashtag && !content.includes('#')) {
      throw new ValidationError('Content must include at least one hashtag');
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
      options,
    });

    try {
      // Validate content
      this.validateContent(content);

      // Create toot with custom options
      const result = await mastodonService.createToot(content, {
        language: options.language || 'pt',
        visibility: options.visibility || 'public',
        sensitive: options.sensitive || false,
        ...options,
      });

      // Update statistics
      this.updatePostingStats(true);

      loggers.business('custom_toot_created', {
        tootId: result.id,
        contentLength: content.length,
        visibility: options.visibility,
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
        summaryLength: summary.length,
      });

      return {
        summary,
        toot: result,
      };
    } catch (error) {
      loggers.error(`Failed to generate and post summary for hashtag: ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Generate and post daily report with image
   * @param {Object} options - Report generation options
   * @param {string} options.timezone - Timezone for analysis
   * @param {string} options.saveImagePath - Optional path to save image locally
   * @param {string} options.theme - Theme for image ('dark' or 'light'), defaults to 'dark'
   */
  async generateAndPostDailyReport(options = {}) {
    const { 
      timezone = config.server.timezone, 
      saveImagePath = null,
      theme = 'dark'
    } = options;
    
    logger.info('Starting daily image report process', { theme });

    try {
      // 1. Get daily hashtag and analysis
      const dailyHashtag = hashtagService.getDailyHashtag({ timezone });
      const analysis = await hashtagService.analyzeHashtag(dailyHashtag, {
        timezone,
        maxPages: 3
      });

      if (!analysis.hasTodayToots()) {
        logger.warn('No toots found for today, skipping image report');
        return { success: false, reason: 'no_toots' };
      }

      // 2. Prepare stats for image
      const stats = {
        hashtag: dailyHashtag,
        summary: {
          tootCount: analysis.getTodayCount(),
          uniqueUsers: analysis.getUniqueUserCount(),
          weeklyTotal: analysis.getWeeklyTotal()
        }
      };

      // 3. Generate image
      const imageResult = await imageGenerator.generateDashboardImage(stats, { theme });
      
      if (!imageResult?.imageBuffer || !Buffer.isBuffer(imageResult.imageBuffer) || imageResult.imageBuffer.length === 0) {
        throw new BusinessError('Failed to generate image: invalid or empty buffer');
      }
      
      const { imageBuffer, altText } = imageResult;

      // 4. Save image locally if path provided
      if (saveImagePath) {
        await fs.writeFile(saveImagePath, imageBuffer);
        logger.info('Image saved locally', { path: saveImagePath });
      }

      // 5. Upload image to Mastodon
      let mediaResult;
      try {
        mediaResult = await mastodonService.uploadMedia(imageBuffer, altText);
        
        if (!mediaResult?.id) {
          throw new BusinessError('Media upload failed: no ID returned');
        }
      } catch (uploadError) {
        // Save image on upload failure as fallback
        const sanitizedHashtag = dailyHashtag.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fallbackPath = `./daily-report-${sanitizedHashtag}-${Date.now()}.png`;
        try {
          await fs.writeFile(fallbackPath, imageBuffer);
          logger.warn('Upload failed, image saved locally', { 
            path: fallbackPath,
            error: uploadError.message
          });
        } catch (saveError) {
          logger.error('Failed to save fallback image', { error: saveError.message });
        }
        throw uploadError;
      }

      // 6. Post toot with media
      const tootText = `#hashpanel #${dailyHashtag}\n\n📊 Relatório do dia: ${config.server.publicUrl}`;
      const postResult = await mastodonService.createToot(tootText, {
        media_ids: [mediaResult.id],
        language: 'pt',
        visibility: 'public'
      });

      this.updatePostingStats(true);

      loggers.business('daily_image_report_posted', {
        tootId: postResult.id,
        hashtag: dailyHashtag,
        mediaId: mediaResult.id
      });

      return {
        success: true,
        toot: postResult,
        media: mediaResult
      };
    } catch (error) {
      this.updatePostingStats(false);
      loggers.error('Failed to generate and post daily image report', error);
      throw error instanceof BusinessError ? error : new BusinessError(`Failed to generate daily report: ${error.message}`);
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
        isValid: summary.length <= MAX_TOOT_LENGTH,
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
    const successRate =
      this.postingStats.totalPosted > 0
        ? (this.postingStats.successfulPosts / this.postingStats.totalPosted) * 100
        : 0;

    return {
      ...this.postingStats,
      successRate: Math.round(successRate * 100) / 100,
      failureRate: Math.round((100 - successRate) * 100) / 100,
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
      lastPostTime: null,
    };

    logger.info('Toot service statistics reset');
  }

  /**
   * Get posting history (placeholder for future implementation)
   */
  async getPostingHistory(limit = 10, offset = 0) {
    // This would typically query a database or log file
    // For now, return basic info
    return {
      posts: [],
      total: this.postingStats.successfulPosts,
      limit,
      offset,
    };
  }

  /**
   * Check if posting is allowed (rate limiting, etc.)
   */
  canPost() {
    const lastPost = this.postingStats.lastPostTime;

    if (lastPost) {
      const timeSinceLastPost = Date.now() - lastPost.getTime();

      if (timeSinceLastPost < RATE_LIMIT_MS) {
        return {
          allowed: false,
          reason: `Rate limit: Only one post per ${RATE_LIMIT_MS / (60 * 1000)} minutes allowed`,
          nextAllowedTime: new Date(lastPost.getTime() + RATE_LIMIT_MS),
        };
      }
    }

    return { allowed: true };
  }
}

// Export singleton instance for use across the application
export const tootService = new TootService();
