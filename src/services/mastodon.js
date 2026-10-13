import Mastodon from 'mastodon-api';
import { appConfig as config } from '../config/index.js';
import { logger, loggers } from '../utils/logger.js';
import { APIError, RateLimitError, NotFoundError } from '../errors/index.js';

export class MastodonService {
  constructor() {
    try {
      // Create client with timeout configuration
      // Note: The mastodon-api library uses this timeout for HTTP requests
      // However, connection timeouts at the OS level may still occur
      this.client = new Mastodon({
        client_key: config.mastodon.clientKey,
        client_secret: config.mastodon.clientSecret,
        access_token: config.mastodon.accessToken,
        timeout_ms: config.mastodon.timeout,
        api_url: config.mastodon.url,
      });

      // Set a global error handler for any unhandled connection errors
      // This is a safety measure for errors that occur outside of explicit requests
      // (e.g., keep-alive connections, DNS lookups with multiple IPs)
      if (typeof process !== 'undefined') {
        // Store reference to prevent garbage collection
        this._networkErrorHandler = (error) => {
          // Only handle network timeout errors that might occur from this client
          if (
            error &&
            (error.code === 'ETIMEDOUT' ||
              (error.name === 'AggregateError' && error.code === 'ETIMEDOUT') ||
              (error.name === 'AggregateError' &&
                Array.isArray(error.errors) &&
                error.errors.some((err) => err?.code === 'ETIMEDOUT')))
          ) {
            // Log but don't throw - let the global handler deal with it
            // This prevents the error from becoming uncaught
            logger.debug('Network timeout error intercepted (likely from connection retry)', {
              code: error.code,
              name: error.name,
              isAggregateError: error.name === 'AggregateError',
            });
          }
        };
      }

      // Wrap client methods to catch any errors that might occur outside of explicit requests
      // This prevents AggregateError from becoming uncaught exceptions
      this._wrapClientMethods();
    } catch (error) {
      throw error;
    }

    this.lastRequestTime = 0;
    this.requestCount = 0;
    
    // Rate limit tracking from Mastodon API
    this.rateLimitInfo = {
      limit: null,
      remaining: null,
      reset: null,
      lastUpdated: null,
    };
  }

  /**
   * Wrap client methods to ensure all errors are caught
   * This prevents AggregateError from becoming uncaught exceptions
   * @private
   */
  _wrapClientMethods() {
    // The mastodon-api library uses methods like 'get', 'post', etc.
    // We need to ensure that any errors from these methods are properly caught
    // However, since we already wrap calls in makeAPIRequest, this is mainly
    // a safety measure for any direct calls or internal retries

    // Store original methods
    const originalMethods = ['get', 'post', 'put', 'delete', 'patch'];

    originalMethods.forEach((method) => {
      if (this.client[method] && typeof this.client[method] === 'function') {
        const originalMethod = this.client[method].bind(this.client);

        this.client[method] = function (...args) {
          try {
            const result = originalMethod(...args);

            // If result is a promise, ensure it has error handling
            if (result && typeof result.then === 'function') {
              return result.catch((error) => {
                // Re-throw to be handled by makeAPIRequest
                throw error;
              });
            }

            return result;
          } catch (syncError) {
            throw syncError;
          }
        };
      }
    });
  }

  /**
   * Extract and monitor rate limit headers from Mastodon API response
   * @param {object} response - Response object from Mastodon API
   * @param {string} endpoint - API endpoint for logging context
   * @private
   */
  _monitorRateLimitHeaders(response, endpoint) {
    if (!response || !response.resp || !response.resp.headers) {
      return;
    }

    const headers = response.resp.headers;
    const limit = parseInt(headers['x-ratelimit-limit']) || null;
    const remaining = parseInt(headers['x-ratelimit-remaining']) || null;
    const reset = headers['x-ratelimit-reset'] || null;

    // Update rate limit info
    if (limit !== null || remaining !== null || reset !== null) {
      this.rateLimitInfo = {
        limit,
        remaining,
        reset,
        lastUpdated: new Date().toISOString(),
      };

      // Calculate usage percentage
      const percentUsed = limit && remaining !== null 
        ? ((limit - remaining) / limit * 100).toFixed(1) 
        : 'N/A';

      // Log at different levels based on remaining requests
      if (remaining !== null && remaining < 50) {
        logger.warn('Mastodon API rate limit low', {
          endpoint,
          limit,
          remaining,
          reset,
          percentUsed: `${percentUsed}%`,
        });
      } else if (remaining !== null && remaining < 100) {
        logger.info('Mastodon API rate limit status', {
          endpoint,
          limit,
          remaining,
          reset,
          percentUsed: `${percentUsed}%`,
        });
      } else {
        logger.debug('Mastodon API rate limit status', {
          endpoint,
          limit,
          remaining,
          reset,
          percentUsed: `${percentUsed}%`,
        });
      }
    }
  }

  /**
   * Get current rate limit information from Mastodon API
   * @returns {object} Rate limit information
   */
  getRateLimitInfo() {
    return { ...this.rateLimitInfo };
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
      await new Promise((resolve) => setTimeout(resolve, delayTime));
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Make API request with error handling and rate limiting
   * @param {string} endpoint - API endpoint
   * @param {object} params - Request parameters
   * @param {string} method - HTTP method ('get', 'post', etc.), defaults to 'get'
   * @returns {Promise} Response data
   */
  async makeAPIRequest(endpoint, params = {}, method = 'get') {
    await this.applyRateLimit();

    try {
      logger.debug(`Making API request to ${endpoint}`, { params, method });

      const clientMethod = this.client[method];
      if (!clientMethod || typeof clientMethod !== 'function') {
        throw new APIError(`Unsupported HTTP method: ${method}`, null, { endpoint, method });
      }

      const startTime = Date.now();

      const response = await this._executeRequest(clientMethod, endpoint, params);
      const duration = Date.now() - startTime;

      if (!response || !response.data) {
        throw new APIError(`Invalid response from ${endpoint}`, null, { endpoint, params, method });
      }

      // Monitor rate limit headers from Mastodon API
      this._monitorRateLimitHeaders(response, endpoint);

      loggers.apiRequest(method.toUpperCase(), endpoint);
      loggers.performance('mastodon_api_request', duration, { endpoint, method });

      return response.data;
    } catch (error) {
      loggers.error(`API request failed for ${endpoint}`, error, { params, method });

      // Handle AggregateError specifically - extract the first meaningful error
      let actualError = error;
      if (
        error.name === 'AggregateError' &&
        Array.isArray(error.errors) &&
        error.errors.length > 0
      ) {
        // Use the first error from the aggregate, or the aggregate itself if no errors array
        actualError = error.errors[0] || error;
      }

      // Handle specific Mastodon API errors
      if (actualError.response || error.response) {
        const response = actualError.response || error.response;
        const { status, statusText } = response;

        if (status === 429) {
          throw new RateLimitError(
            'Mastodon API rate limit exceeded',
            response.headers['retry-after']
          );
        }

        if (status === 404) {
          throw new NotFoundError(`Resource not found: ${endpoint}`, endpoint);
        }

        if (status >= 500) {
          throw new APIError(`Mastodon server error: ${status} ${statusText}`, actualError, {
            endpoint,
            status,
            method,
          });
        }
      }

      // Check if it's a timeout error and wrap it properly
      // Handle both direct ETIMEDOUT and AggregateError containing ETIMEDOUT
      const isTimeout =
        actualError.code === 'ETIMEDOUT' ||
        error.code === 'ETIMEDOUT' ||
        (error.name === 'AggregateError' && error.code === 'ETIMEDOUT') ||
        (error.name === 'AggregateError' &&
          Array.isArray(error.errors) &&
          error.errors.some((err) => err?.code === 'ETIMEDOUT'));

      if (isTimeout) {
        // Wrap the error but preserve the original error details
        const timeoutError = new APIError(
          `Request timeout for ${endpoint}: ${actualError.message || error.message}`,
          actualError,
          { endpoint, method }
        );
        // Preserve the original error code and name for proper handling upstream
        timeoutError.originalError = error;
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }

      throw new APIError(
        `Failed to fetch data from ${endpoint}: ${actualError.message || error.message}`,
        actualError,
        { endpoint, method }
      );
    }
  }

  _executeRequest(clientMethod, endpoint, params) {
    try {
      const requestPromise = clientMethod.call(this.client, endpoint, params);
      return Promise.resolve(requestPromise).catch((error) => {
        throw error;
      });
    } catch (syncError) {
      return Promise.reject(syncError);
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
      ...options,
    };

    logger.info(`Fetching toots for hashtag: ${hashtag}`, { params });

    try {
      const toots = await this.makeAPIRequest(`timelines/tag/${hashtag}`, params);

      if (!Array.isArray(toots)) {
        throw new APIError('Expected array of toots but received different data type', null, {
          hashtag,
          receivedType: typeof toots,
        });
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

    logger.info(`Starting to fetch all toots for hashtag: ${hashtag}`, {
      maxPages: maxPagesToFetch,
    });

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

        logger.debug(
          `Fetched page ${pageCount} for hashtag: ${hashtag}, got ${toots.length} toots`
        );

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
      pagesFetched: pageCount,
    });

    loggers.business('all_toots_fetched', {
      hashtag,
      count: allToots.length,
      pages: pageCount,
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
        historyLength: data?.history?.length,
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
      const tags = await this.makeAPIRequest('trends/tags', params);

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
      ...options,
    };

    try {
      logger.info('Creating new toot', {
        statusLength: status.length,
        visibility: tootData.visibility,
      });

      const responseData = await this.makeAPIRequest('statuses', tootData, 'post');

      if (!responseData) {
        throw new APIError('Invalid response when creating toot', null, { tootData });
      }

      logger.info('Successfully created toot', {
        tootId: responseData.id,
        url: responseData.url,
      });

      loggers.business('toot_created', {
        tootId: responseData.id,
        statusLength: status.length,
      });

      return responseData;
    } catch (error) {
      loggers.error('Failed to create toot', error, { statusLength: status.length });
      throw new APIError(`Failed to create toot: ${error.message}`, error);
    }
  }

  /**
   * Fetch with AbortController-based timeout (same source as makeAPIRequest).
   * @param {string} url
   * @param {RequestInit} init
   * @param {number} timeoutMs
   * @returns {Promise<Response>}
   * @private
   */
  async _fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      return response;
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(id);
    }
  }

  /**
   * Upload media to Mastodon
   * @param {Buffer} fileBuffer - File content buffer
   * @param {string} description - Alt text for the media
   * @returns {Promise<Object>} Media upload response
   */
  async uploadMedia(fileBuffer, description = '') {
    // Validate fileBuffer is a valid Buffer
    if (!Buffer.isBuffer(fileBuffer)) {
      throw new TypeError(
        `uploadMedia: fileBuffer must be a valid Buffer, received ${fileBuffer === null ? 'null' : fileBuffer === undefined ? 'undefined' : typeof fileBuffer}`
      );
    }

    logger.info('Uploading media to Mastodon', {
      bufferSize: fileBuffer.length,
      descriptionLength: description.length
    });

    // Use native FormData and Blob (Node.js 18+)
    const form = new FormData();
    const blob = new Blob([fileBuffer], { type: 'image/png' });
    form.append('file', blob, 'report.png');
    
    if (description) {
      form.append('description', description);
    }

    try {
      const timeoutMs = config.mastodon.timeout ?? 30000;

      // Try v2 endpoint first (modern Mastodon)
      const baseUrl = config.mastodon.url.replace(/\/v1\/$/, '/');
      const v2Url = `${baseUrl}v2/media`;
      
      logger.info('Uploading media via fetch (v2)', { url: v2Url });
      
      const response = await this._fetchWithTimeout(v2Url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.mastodon.accessToken}`
        },
        body: form
      }, timeoutMs);

      if (!response.ok) {
        const errorText = await response.text();
        
        // If v2 fails, try v1
        if (response.status === 404 || response.status === 500) {
          logger.info('v2 endpoint failed, trying v1', { status: response.status });
          
          // Recreate form for v1 attempt with native FormData/Blob
          const form2 = new FormData();
          const blob2 = new Blob([fileBuffer], { type: 'image/png' });
          form2.append('file', blob2, 'report.png');
          if (description) {
            form2.append('description', description);
          }
          
          const v1Url = `${baseUrl}v1/media`;
          const v1Response = await this._fetchWithTimeout(v1Url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.mastodon.accessToken}`
            },
            body: form2
          }, timeoutMs);
          
          if (!v1Response.ok) {
            const v1ErrorText = await v1Response.text();
            logger.error('Both v2 and v1 media endpoints failed', {
              v2Status: response.status,
              v1Status: v1Response.status,
              v2Error: errorText.substring(0, 200),
              v1Error: v1ErrorText.substring(0, 200)
            });
            throw new Error(`Mastodon API error: v2 returned ${response.status}, v1 returned ${v1Response.status}`);
          }
          
          const v1Data = await v1Response.json();
          logger.info('Successfully uploaded media via v1', { mediaId: v1Data.id });
          return v1Data;
        }
        
        throw new Error(`Mastodon API error (${response.status}): ${errorText.substring(0, 500)}`);
      }

      const responseData = await response.json();
      
      if (!responseData || !responseData.id) {
        throw new APIError('Invalid response when uploading media', null, { responseData });
      }

      logger.info('Successfully uploaded media via v2', { mediaId: responseData.id });
      return responseData;
    } catch (error) {
      loggers.error('Failed to upload media', error);
      throw new APIError(`Failed to upload media: ${error.message}`, error);
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
      rateLimitInfo: this.getRateLimitInfo(),
      config: {
        rateLimitDelay: config.performance.rateLimitDelay,
        maxApiPages: config.performance.maxApiPages,
        tootsPerPage: config.performance.tootsPerPage,
      },
    };
  }
}

// Export singleton instance
export const mastodonService = new MastodonService();
