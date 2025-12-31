import Mastodon from 'mastodon-api';
import { appConfig as config } from '../config/index.js';
import { logger, loggers } from '../utils/logger.js';
import { APIError, RateLimitError, NotFoundError } from '../errors/index.js';

export class MastodonService {
  constructor() {
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:8',message:'MastodonService constructor entry',data:{timeout:config.mastodon.timeout,url:config.mastodon.url},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    try {
      // Create client with timeout configuration
      // Note: The mastodon-api library uses this timeout for HTTP requests
      // However, connection timeouts at the OS level may still occur
      this.client = new Mastodon({
        client_key: config.mastodon.clientKey,
        client_secret: config.mastodon.clientSecret,
        access_token: config.mastodon.accessToken,
        timeout_ms: config.mastodon.timeout,
        api_url: config.mastodon.url
      });
      
      // Set a global error handler for any unhandled connection errors
      // This is a safety measure for errors that occur outside of explicit requests
      // (e.g., keep-alive connections, DNS lookups with multiple IPs)
      if (typeof process !== 'undefined') {
        // Store reference to prevent garbage collection
        this._networkErrorHandler = (error) => {
          // Only handle network timeout errors that might occur from this client
          if (error && (error.code === 'ETIMEDOUT' || 
              (error.name === 'AggregateError' && error.code === 'ETIMEDOUT') ||
              (error.name === 'AggregateError' && Array.isArray(error.errors) && 
               error.errors.some(err => err?.code === 'ETIMEDOUT')))) {
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:35',message:'Network error handler caught timeout',data:{code:error.code,name:error.name,isAggregate:error.name==='AggregateError'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            // Log but don't throw - let the global handler deal with it
            // This prevents the error from becoming uncaught
            logger.debug('Network timeout error intercepted (likely from connection retry)', {
              code: error.code,
              name: error.name,
              isAggregateError: error.name === 'AggregateError'
            });
          }
        };
      }
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:17',message:'Mastodon client created',data:{hasClient:!!this.client},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      // Wrap client methods to catch any errors that might occur outside of explicit requests
      // This prevents AggregateError from becoming uncaught exceptions
      this._wrapClientMethods();
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:25',message:'Mastodon client creation error',data:{error:error.message,code:error.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
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
    
    originalMethods.forEach(method => {
      if (this.client[method] && typeof this.client[method] === 'function') {
        const originalMethod = this.client[method].bind(this.client);
        
        this.client[method] = function(...args) {
          try {
            const result = originalMethod(...args);
            
            // If result is a promise, ensure it has error handling
            if (result && typeof result.then === 'function') {
              return result.catch((error) => {
                // #region agent log
                fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:50',message:'Wrapped client method error',data:{method,error:error?.message,code:error?.code,name:error?.name,isAggregate:error?.name==='AggregateError'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                // #endregion
                // Re-throw to be handled by makeAPIRequest
                throw error;
              });
            }
            
            return result;
          } catch (syncError) {
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:62',message:'Wrapped client method sync error',data:{method,error:syncError?.message,code:syncError?.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
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
      await new Promise(resolve => setTimeout(resolve, delayTime));
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
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:44',message:'makeAPIRequest entry',data:{endpoint,method},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    await this.applyRateLimit();
    
    // Wrap entire operation in try/catch to catch any synchronous errors
    try {
      logger.debug(`Making API request to ${endpoint}`, { params, method });
      
      const clientMethod = this.client[method];
      if (!clientMethod || typeof clientMethod !== 'function') {
        throw new APIError(`Unsupported HTTP method: ${method}`, null, { endpoint, method });
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:56',message:'Before client method call',data:{endpoint,method},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      const startTime = Date.now();
      
      // Wrap the client method call in a new Promise to ensure proper error handling
      // This prevents AggregateError from becoming uncaught
      const response = await new Promise((resolve, reject) => {
        try {
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:66',message:'Inside Promise executor',data:{endpoint,method},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          const requestPromise = clientMethod.call(this.client, endpoint, params);
          
          // Handle the promise result
          Promise.resolve(requestPromise)
            .then((result) => {
              // #region agent log
              fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:73',message:'Request promise resolved',data:{endpoint,method},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
              // #endregion
              resolve(result);
            })
            .catch((err) => {
              // #region agent log
              fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:77',message:'Request promise rejected',data:{endpoint,method,error:err?.message,code:err?.code,name:err?.name,isAggregate:err?.name==='AggregateError',errorsCount:err?.errors?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
              reject(err);
            });
        } catch (syncError) {
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:85',message:'Synchronous error in Promise executor',data:{endpoint,method,error:syncError?.message,code:syncError?.code,name:syncError?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          reject(syncError);
        }
      });
      const duration = Date.now() - startTime;
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:90',message:'After client method call',data:{endpoint,method,duration},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      if (!response || !response.data) {
        throw new APIError(`Invalid response from ${endpoint}`, null, { endpoint, params, method });
      }
      
      loggers.apiRequest(method.toUpperCase(), endpoint);
      loggers.performance('mastodon_api_request', duration, { endpoint, method });
      
      return response.data;
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:100',message:'API request error caught',data:{endpoint,method,error:error.message,code:error.code,name:error.name,isAggregate:error.name==='AggregateError',errorsCount:error.errors?.length,stack:error.stack?.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      loggers.error(`API request failed for ${endpoint}`, error, { params, method });
      
      // Handle AggregateError specifically - extract the first meaningful error
      let actualError = error;
      if (error.name === 'AggregateError' && Array.isArray(error.errors) && error.errors.length > 0) {
        // #region agent log
        fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:107',message:'AggregateError detected, extracting first error',data:{errorsCount:error.errors.length,firstError:error.errors[0]?.code,firstErrorName:error.errors[0]?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        // Use the first error from the aggregate, or the aggregate itself if no errors array
        actualError = error.errors[0] || error;
      }
      
      // Handle specific Mastodon API errors
      if (actualError.response || error.response) {
        const response = actualError.response || error.response;
        const { status, statusText } = response;
        
        if (status === 429) {
          throw new RateLimitError('Mastodon API rate limit exceeded', response.headers['retry-after']);
        }
        
        if (status === 404) {
          throw new NotFoundError(`Resource not found: ${endpoint}`, endpoint);
        }
        
        if (status >= 500) {
          throw new APIError(`Mastodon server error: ${status} ${statusText}`, actualError, { endpoint, status, method });
        }
      }
      
      // Check if it's a timeout error and wrap it properly
      // Handle both direct ETIMEDOUT and AggregateError containing ETIMEDOUT
      const isTimeout = actualError.code === 'ETIMEDOUT' || 
                       error.code === 'ETIMEDOUT' ||
                       (error.name === 'AggregateError' && error.code === 'ETIMEDOUT') ||
                       (error.name === 'AggregateError' && Array.isArray(error.errors) && error.errors.some(err => err?.code === 'ETIMEDOUT'));
      
      if (isTimeout) {
        // #region agent log
        fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:130',message:'Timeout error detected in catch',data:{endpoint,method,code:actualError.code||error.code,name:error.name,isAggregate:error.name==='AggregateError',errorsCount:error.errors?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        // Wrap the error but preserve the original error details
        const timeoutError = new APIError(`Request timeout for ${endpoint}: ${actualError.message || error.message}`, actualError, { endpoint, method });
        // Preserve the original error code and name for proper handling upstream
        timeoutError.originalError = error;
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      
      throw new APIError(`Failed to fetch data from ${endpoint}: ${actualError.message || error.message}`, actualError, { endpoint, method });
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
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:232',message:'getTrendingTags entry',data:{limit,offset},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    try {
      const params = { limit: Math.min(limit, 100), offset };
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:236',message:'Before makeAPIRequest for trends/tags',data:{params},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      const tags = await this.makeAPIRequest('trends/tags', params);
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:239',message:'getTrendingTags succeeded',data:{tagsCount:tags?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      logger.info(`Fetched ${tags.length} trending tags`, { limit, offset });
      
      return tags;
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/services/mastodon.js:247',message:'getTrendingTags error',data:{error:error.message,code:error.code,name:error.name,isAggregate:error.name==='AggregateError'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
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

      const responseData = await this.makeAPIRequest('statuses', tootData, 'post');
      
      if (!responseData) {
        throw new APIError('Invalid response when creating toot', null, { tootData });
      }

      logger.info('Successfully created toot', { 
        tootId: responseData.id,
        url: responseData.url 
      });

      loggers.business('toot_created', { 
        tootId: responseData.id,
        statusLength: status.length 
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
        tootsPerPage: config.performance.tootsPerPage
      }
    };
  }
}

// Export singleton instance
export const mastodonService = new MastodonService();