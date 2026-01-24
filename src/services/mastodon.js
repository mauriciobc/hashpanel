import Mastodon from 'mastodon-api';
import { appConfig as config } from '../config/index.js';
import { logger, loggers } from '../utils/logger.js';
import { APIError, RateLimitError, NotFoundError } from '../errors/index.js';
import { sendTelemetry } from '../utils/telemetry.js';

export class MastodonService {
  constructor() {
    sendTelemetry({
      location: 'src/services/mastodon.js:constructor',
      message: 'MastodonService constructor entry',
      data: { timeout: config.mastodon.timeout, url: config.mastodon.url },
      hypothesisId: 'D',
    });
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
            sendTelemetry({
              location: 'src/services/mastodon.js:network_error',
              message: 'Network error handler caught timeout',
              data: {
                code: error.code,
                name: error.name,
                isAggregate: error.name === 'AggregateError',
              },
              hypothesisId: 'E',
            });
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
      sendTelemetry({
        location: 'src/services/mastodon.js:constructor',
        message: 'Mastodon client created',
        data: { hasClient: !!this.client },
        hypothesisId: 'D',
      });

      // Wrap client methods to catch any errors that might occur outside of explicit requests
      // This prevents AggregateError from becoming uncaught exceptions
      this._wrapClientMethods();
    } catch (error) {
      sendTelemetry({
        location: 'src/services/mastodon.js:constructor_error',
        message: 'Mastodon client creation error',
        data: { error: error.message, code: error.code },
        hypothesisId: 'D',
      });
      throw error;
    }

    this.lastRequestTime = 0;
    this.requestCount = 0;
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
                sendTelemetry({
                  location: 'src/services/mastodon.js:wrapped_method_error',
                  message: 'Wrapped client method error',
                  data: {
                    method,
                    error: error?.message,
                    code: error?.code,
                    name: error?.name,
                    isAggregate: error?.name === 'AggregateError',
                  },
                  hypothesisId: 'E',
                });
                // Re-throw to be handled by makeAPIRequest
                throw error;
              });
            }

            return result;
          } catch (syncError) {
            sendTelemetry({
              location: 'src/services/mastodon.js:wrapped_method_sync_error',
              message: 'Wrapped client method sync error',
              data: { method, error: syncError?.message, code: syncError?.code },
              hypothesisId: 'E',
            });
            throw syncError;
          }
        };
      }
    });
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
    sendTelemetry({
      location: 'src/services/mastodon.js:makeAPIRequest',
      message: 'makeAPIRequest entry',
      data: { endpoint, method },
      hypothesisId: 'A',
    });
    await this.applyRateLimit();

    try {
      logger.debug(`Making API request to ${endpoint}`, { params, method });

      const clientMethod = this.client[method];
      if (!clientMethod || typeof clientMethod !== 'function') {
        throw new APIError(`Unsupported HTTP method: ${method}`, null, { endpoint, method });
      }

      const startTime = Date.now();

      const response = await this._executeRequest(clientMethod, endpoint, params, method);
      const duration = Date.now() - startTime;
      sendTelemetry({
        location: 'src/services/mastodon.js:makeAPIRequest_after',
        message: 'After client method call',
        data: { endpoint, method, duration },
        hypothesisId: 'A',
      });

      if (!response || !response.data) {
        throw new APIError(`Invalid response from ${endpoint}`, null, { endpoint, params, method });
      }

      loggers.apiRequest(method.toUpperCase(), endpoint);
      loggers.performance('mastodon_api_request', duration, { endpoint, method });

      return response.data;
    } catch (error) {
      sendTelemetry({
        location: 'src/services/mastodon.js:makeAPIRequest_error',
        message: 'API request error caught',
        data: {
          endpoint,
          method,
          error: error.message,
          code: error.code,
          name: error.name,
          isAggregate: error.name === 'AggregateError',
          errorsCount: error.errors?.length,
          stack: error.stack?.substring(0, 100),
        },
        hypothesisId: 'A',
      });
      loggers.error(`API request failed for ${endpoint}`, error, { params, method });

      // Handle AggregateError specifically - extract the first meaningful error
      let actualError = error;
      if (
        error.name === 'AggregateError' &&
        Array.isArray(error.errors) &&
        error.errors.length > 0
      ) {
        sendTelemetry({
          location: 'src/services/mastodon.js:makeAPIRequest_aggregate_error',
          message: 'AggregateError detected, extracting first error',
          data: {
            errorsCount: error.errors.length,
            firstError: error.errors[0]?.code,
            firstErrorName: error.errors[0]?.name,
          },
          hypothesisId: 'A',
        });
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
        sendTelemetry({
          location: 'src/services/mastodon.js:makeAPIRequest_timeout',
          message: 'Timeout error detected in catch',
          data: {
            endpoint,
            method,
            code: actualError.code || error.code,
            name: error.name,
            isAggregate: error.name === 'AggregateError',
            errorsCount: error.errors?.length,
          },
          hypothesisId: 'A',
        });
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

  _executeRequest(clientMethod, endpoint, params, method) {
    sendTelemetry({
      location: 'src/services/mastodon.js:makeAPIRequest',
      message: 'Before client method call',
      data: { endpoint, method },
      hypothesisId: 'A',
    });

    try {
      const requestPromise = clientMethod.call(this.client, endpoint, params);
      return Promise.resolve(requestPromise).catch((error) => {
        sendTelemetry({
          location: 'src/services/mastodon.js:makeAPIRequest_rejected',
          message: 'Request promise rejected',
          data: {
            endpoint,
            method,
            error: error?.message,
            code: error?.code,
            name: error?.name,
            isAggregate: error?.name === 'AggregateError',
            errorsCount: error?.errors?.length,
          },
          hypothesisId: 'B',
        });
        throw error;
      });
    } catch (syncError) {
      sendTelemetry({
        location: 'src/services/mastodon.js:makeAPIRequest_sync_error',
        message: 'Synchronous error in client method call',
        data: {
          endpoint,
          method,
          error: syncError?.message,
          code: syncError?.code,
          name: syncError?.name,
        },
        hypothesisId: 'C',
      });
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
    sendTelemetry({
      location: 'src/services/mastodon.js:232',
      message: 'getTrendingTags entry',
      data: { limit, offset },
      hypothesisId: 'A',
    });
    try {
      const params = { limit: Math.min(limit, 100), offset };
      sendTelemetry({
        location: 'src/services/mastodon.js:236',
        message: 'Before makeAPIRequest for trends/tags',
        data: { params },
        hypothesisId: 'A',
      });
      const tags = await this.makeAPIRequest('trends/tags', params);
      sendTelemetry({
        location: 'src/services/mastodon.js:239',
        message: 'getTrendingTags succeeded',
        data: { tagsCount: tags?.length },
        hypothesisId: 'A',
      });

      logger.info(`Fetched ${tags.length} trending tags`, { limit, offset });

      return tags;
    } catch (error) {
      sendTelemetry({
        location: 'src/services/mastodon.js:247',
        message: 'getTrendingTags error',
        data: {
          error: error.message,
          code: error.code,
          name: error.name,
          isAggregate: error.name === 'AggregateError',
        },
        hypothesisId: 'A',
      });
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
   * Get service statistics
   */
  getStats() {
    return {
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
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
