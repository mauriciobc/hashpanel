import Mastodon from 'mastodon-api';
import { appConfig as config } from '../config/index.js';
import { logger, loggers } from '../utils/logger.js';
import { APIError, RateLimitError, NotFoundError } from '../errors/index.js';

export class MastodonService {
  constructor() {
    this.client = new Mastodon({
      client_key: config.mastodon.clientKey,
      client_secret: config.mastodon.clientSecret,
      access_token: config.mastodon.accessToken,
      timeout_ms: config.mastodon.timeout,
      api_url: config.mastodon.url
    });
    
    this.lastRequestTime = 0;
    this.requestCount = 0;
  }

  /**
   * Apply rate limiting between API requests
   */
  async applyRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < config.performance.rateLimitDelay) {
      const delayTime = config.performance.rateLimitDelay - timeSinceLastRequest;
      logger.debug(`Rate limiting: waiting ${delayTime}ms`);
      await new Promise(resolve => setTimeout(resolve, delayTime));
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Make API request with error handling and rate limiting
   */
  async makeAPIRequest(endpoint, params = {}) {
    await this.applyRateLimit();
    
    try {
      logger.debug(`Making API request to ${endpoint}`, { params });
      
      const response = await this.client.get(endpoint, params);
      
      if (!response || !response.data) {
        throw new APIError(`Invalid response from ${endpoint}`, null, { endpoint, params });
      }
      
      loggers.apiRequest('GET', endpoint);
      loggers.performance('mastodon_api_request', Date.now() - this.lastRequestTime, { endpoint });
      
      return response.data;
    } catch (error) {
      loggers.error(`API request failed for ${endpoint}`, error, { params });
      
      // Handle specific Mastodon API errors
      if (error.response) {
        const { status, statusText } = error.response;
        
        if (status === 429) {
          throw new RateLimitError('Mastodon API rate limit exceeded', error.response.headers['retry-after']);
        }
        
        if (status === 404) {
          throw new NotFoundError(`Resource not found: ${endpoint}`, endpoint);
        }
        
        if (status >= 500) {
          throw new APIError(`Mastodon server error: ${status} ${statusText}`, error, { endpoint, status });
        }
      }
      
      throw new APIError(`Failed to fetch data from ${endpoint}: ${error.message}`, error, { endpoint });
    }
  }

  /**
   * Fetch toots by hashtag with pagination support
   */
  async fetchTootsByHashtag(hashtag, options = {}) {
    if (!hashtag || typeof hashtag !== 'string') {
      throw new Error('Valid hashtag is required');
    }

    const params = {
      limit: options.limit || config.performance.tootsPerPage,
      ...options
    };

    logger.info(`Fetching toots for hashtag: ${hashtag}`, { params });

    try {
      const toots = await this.makeAPIRequest(`timelines/tag/${hashtag}`, params);
      
      if (!Array.isArray(toots)) {
        throw new APIError('Expected array of toots but received different data type', null, { hashtag, receivedType: typeof toots });
      }

      logger.info(`Successfully fetched ${toots.length} toots for hashtag: ${hashtag}`);
      loggers.business('toots_fetched', { hashtag, count: toots.length });
      
      return toots;
    } catch (error) {
      loggers.error(`Failed to fetch toots for hashtag: ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Fetch all toots for a hashtag with pagination and rate limiting
   */
  async fetchAllToots(hashtag, maxPages = null) {
    if (!hashtag) {
      throw new Error('Hashtag is required');
    }

    const maxPagesToFetch = maxPages || config.performance.maxApiPages;
    const allToots = [];
    let maxId = null;
    let pageCount = 0;
    let hasMore = true;

    logger.info(`Starting to fetch all toots for hashtag: ${hashtag}`, { maxPages: maxPagesToFetch });

    while (hasMore && pageCount < maxPagesToFetch) {
      const options = { limit: config.performance.tootsPerPage };
      if (maxId) {
        options.max_id = maxId;
      }

      try {
        const toots = await this.fetchTootsByHashtag(hashtag, options);
        
        if (toots.length === 0) {
          logger.info(`No more toots found for hashtag: ${hashtag} after ${pageCount} pages`);
          hasMore = false;
          break;
        }

        allToots.push(...toots);
        maxId = toots[toots.length - 1].id;
        pageCount++;

        logger.debug(`Fetched page ${pageCount} for hashtag: ${hashtag}, got ${toots.length} toots`);

        // Check if we got fewer results than requested, indicating we're at the end
        if (toots.length < config.performance.tootsPerPage) {
          hasMore = false;
          logger.info(`Reached end of results for hashtag: ${hashtag}`);
        }

      } catch (error) {
        loggers.error(`Failed to fetch page ${pageCount + 1} for hashtag: ${hashtag}`, error);
        
        // For rate limit errors, we should stop trying
        if (error instanceof RateLimitError) {
          throw error;
        }
        
        // For other errors, we might want to continue with what we have
        logger.warn(`Continuing with ${allToots.length} toots fetched so far`);
        hasMore = false;
      }
    }

    logger.info(`Completed fetching toots for hashtag: ${hashtag}`, { 
      totalToots: allToots.length, 
      pagesFetched: pageCount 
    });

    loggers.business('all_toots_fetched', { 
      hashtag, 
      count: allToots.length, 
      pages: pageCount 
    });

    return allToots;
  }

  /**
   * Get hashtag usage statistics
   */
  async getHashtagUse(hashtag) {
    if (!hashtag) {
      throw new Error('Hashtag is required');
    }

    try {
      const data = await this.makeAPIRequest(`tags/${hashtag}`);
      
      logger.info(`Fetched hashtag statistics for: ${hashtag}`, {
        following: data?.following,
        historyLength: data?.history?.length
      });

      return data.history || [];
    } catch (error) {
      loggers.error(`Failed to fetch hashtag use for: ${hashtag}`, error);
      throw error;
    }
  }

  /**
   * Get trending tags
   */
  async getTrendingTags(limit = 10, offset = 0) {
    try {
      const params = { limit: Math.min(limit, 100), offset };
      const tags = await this.makeAPIRequest('/trends/tags', params);
      
      logger.info(`Fetched ${tags.length} trending tags`, { limit, offset });
      
      return tags;
    } catch (error) {
      loggers.error('Failed to fetch trending tags', error, { limit, offset });
      throw error;
    }
  }

  /**
   * Create a new toot (post)
   */
  async createToot(status, options = {}) {
    if (!status || typeof status !== 'string') {
      throw new Error('Status text is required and must be a string');
    }

    if (status.trim().length === 0) {
      throw new Error('Status text cannot be empty');
    }

    if (status.length > 500) {
      throw new Error('Status text exceeds Mastodon\'s 500 character limit');
    }

    const tootData = {
      status: status.trim(),
      sensitive: options.sensitive || false,
      visibility: options.visibility || 'public',
      language: options.language || 'pt',
      ...options
    };

    try {
      logger.info('Creating new toot', { 
        statusLength: status.length, 
        visibility: tootData.visibility 
      });

      const response = await this.client.post('statuses', tootData);
      
      if (!response || !response.data) {
        throw new APIError('Invalid response when creating toot', null, { tootData });
      }

      logger.info('Successfully created toot', { 
        tootId: response.data.id,
        url: response.data.url 
      });

      loggers.business('toot_created', { 
        tootId: response.data.id,
        statusLength: status.length 
      });

      return response.data;
    } catch (error) {
      loggers.error('Failed to create toot', error, { statusLength: status.length });
      throw new APIError(`Failed to create toot: ${error.message}`, error);
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
      config: {
        rateLimitDelay: config.performance.rateLimitDelay,
        maxApiPages: config.performance.maxApiPages,
        tootsPerPage: config.performance.tootsPerPage
      }
    };
  }
}

// Export singleton instance
export const mastodonService = new MastodonService();