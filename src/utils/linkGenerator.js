import { appConfig as config } from '../config/index.js';
import { logger } from './logger.js';
import { ValidationError } from '../errors/index.js';

// Cache base URL parsing to avoid repeated URL parsing operations
const cachedBaseUrl = (() => {
  try {
    const mastodonUrl = new URL(config.mastodon.url);
    
    // Detect known API path patterns (e.g., /api, /api/v1, /api/v2, etc.)
    const apiPathPattern = /^\/api(\/v\d+)?\/?$/;
    const pathname = mastodonUrl.pathname;
    
    let baseUrl;
    if (apiPathPattern.test(pathname)) {
      // If path matches API pattern, use origin only
      baseUrl = mastodonUrl.origin;
      logger.debug('Detected API path pattern, using origin only', { 
        pathname, 
        baseUrl 
      });
    } else {
      // Otherwise, combine origin with pathname, normalizing slashes
      const normalizedPathname = pathname.endsWith('/') 
        ? pathname.slice(0, -1) 
        : pathname;
      baseUrl = mastodonUrl.origin + normalizedPathname;
      logger.debug('Using origin with pathname', { 
        pathname, 
        normalizedPathname, 
        baseUrl 
      });
    }
    
    return baseUrl;
  } catch (error) {
    logger.error('Failed to parse Mastodon URL for caching', { 
      url: config.mastodon.url, 
      error: error.message 
    });
    
    // Try to extract normalized origin from config URL as fallback
    try {
      const fallbackUrl = new URL(config.mastodon.url);
      logger.debug('Using normalized origin as fallback', { 
        origin: fallbackUrl.origin 
      });
      return fallbackUrl.origin;
    } catch (fallbackError) {
      logger.error('Failed to extract origin from config URL', { 
        url: config.mastodon.url, 
        error: fallbackError.message 
      });
      // Last resort: return config URL as-is (may be malformed)
      return config.mastodon.url;
    }
  }
})();

/**
 * Generate web URLs for Mastodon toots
 */
export function generateTootLink(tootId) {
  if (!tootId) {
    throw new ValidationError('Toot ID is required');
  }

  if (typeof tootId !== 'string') {
    throw new ValidationError('Toot ID must be a string');
  }

  try {
    // Use cached base URL to avoid repeated parsing
    const webUrl = new URL(`${cachedBaseUrl}/web/statuses/${tootId}`);
    
    logger.debug(`Generated toot link: ${webUrl.href}`, { tootId });
    
    return webUrl.href;
    
  } catch (error) {
    logger.error(`Failed to generate toot link for ID: ${tootId}`, error);
    throw new ValidationError(`Failed to generate toot link: ${error.message}`);
  }
}

/**
 * Generate profile link for a Mastodon user
 */
export function generateProfileLink(username, instance = null) {
  if (!username) {
    throw new ValidationError('Username is required');
  }

  try {
    // If instance is provided, use it; otherwise use the configured instance
    const baseUrl = instance || new URL(config.mastodon.url).origin;
    const profileUrl = new URL(`${baseUrl}/@${username}`);
    
    logger.debug(`Generated profile link: ${profileUrl.href}`, { username, instance });
    
    return profileUrl.href;
    
  } catch (error) {
    logger.error(`Failed to generate profile link for username: ${username}`, error);
    throw new ValidationError(`Failed to generate profile link: ${error.message}`);
  }
}

/**
 * Generate hashtag search link
 */
export function generateHashtagLink(hashtag, instance = null) {
  if (!hashtag) {
    throw new ValidationError('Hashtag is required');
  }

  // Remove # if present
  const cleanHashtag = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag;

  try {
    // If instance is provided, use it; otherwise use the configured instance
    const baseUrl = instance || new URL(config.mastodon.url).origin;
    const tagUrl = new URL(`${baseUrl}/tags/${cleanHashtag}`);
    
    logger.debug(`Generated hashtag link: ${tagUrl.href}`, { hashtag: cleanHashtag, instance });
    
    return tagUrl.href;
    
  } catch (error) {
    logger.error(`Failed to generate hashtag link for: ${hashtag}`, error);
    throw new ValidationError(`Failed to generate hashtag link: ${error.message}`);
  }
}

/**
 * Extract toot ID from various URL formats
 */
export function extractTootId(url) {
  if (!url) {
    throw new ValidationError('URL is required');
  }

  try {
    const urlObj = new URL(url);
    
    // Handle different URL patterns:
    // /web/statuses/12345
    // /@username/12345
    // /statuses/12345
    
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    
    // Find the numeric ID in the path
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const part = pathParts[i];
      if (/^\d+$/.test(part)) {
        logger.debug(`Extracted toot ID: ${part} from URL: ${url}`);
        return part;
      }
    }
    
    throw new ValidationError(`No toot ID found in URL: ${url}`);
    
  } catch (error) {
    logger.error(`Failed to extract toot ID from URL: ${url}`, error);
    throw new ValidationError(`Failed to extract toot ID: ${error.message}`);
  }
}

/**
 * Validate Mastodon URL format
 */
export function validateMastodonUrl(url) {
  if (!url) {
    throw new ValidationError('URL is required');
  }

  try {
    const urlObj = new URL(url);
    
    // Check if it's a valid HTTP/HTTPS URL
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new ValidationError('URL must use HTTP or HTTPS protocol');
    }
    
    // Check if it looks like a Mastodon instance URL
    // This is a basic check - could be enhanced
    if (!urlObj.hostname || urlObj.hostname.length < 3) {
      throw new ValidationError('Invalid hostname in URL');
    }
    
    logger.debug(`Validated Mastodon URL: ${url}`);
    return true;
    
  } catch (error) {
    logger.error(`Failed to validate Mastodon URL: ${url}`, error);
    throw new ValidationError(`Invalid Mastodon URL: ${error.message}`);
  }
}

/**
 * Generate API endpoint URL
 */
export function generateApiUrl(endpoint) {
  if (!endpoint) {
    throw new ValidationError('Endpoint is required');
  }

  try {
    // Ensure endpoint starts with /
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    
    // Combine base API URL with endpoint
    const apiUrl = new URL(cleanEndpoint, config.mastodon.url);
    
    logger.debug(`Generated API URL: ${apiUrl.href}`, { endpoint });
    
    return apiUrl.href;
    
  } catch (error) {
    logger.error(`Failed to generate API URL for endpoint: ${endpoint}`, error);
    throw new ValidationError(`Failed to generate API URL: ${error.message}`);
  }
}

/**
 * Generate media attachment URL
 */
export function generateMediaUrl(mediaId) {
  if (!mediaId) {
    throw new ValidationError('Media ID is required');
  }

  try {
    const mediaUrl = generateApiUrl(`/media/${mediaId}`);
    
    logger.debug(`Generated media URL: ${mediaUrl}`, { mediaId });
    
    return mediaUrl;
    
  } catch (error) {
    logger.error(`Failed to generate media URL for ID: ${mediaId}`, error);
    throw new ValidationError(`Failed to generate media URL: ${error.message}`);
  }
}

/**
 * Generate context URL for a toot (replies, boosts, etc.)
 */
export function generateContextUrl(tootId) {
  if (!tootId) {
    throw new ValidationError('Toot ID is required');
  }

  try {
    const contextUrl = generateApiUrl(`/statuses/${tootId}/context`);
    
    logger.debug(`Generated context URL: ${contextUrl}`, { tootId });
    
    return contextUrl;
    
  } catch (error) {
    logger.error(`Failed to generate context URL for toot ID: ${tootId}`, error);
    throw new ValidationError(`Failed to generate context URL: ${error.message}`);
  }
}

/**
 * Parse Mastodon URL to extract instance information
 */
export function parseMastodonUrl(url) {
  if (!url) {
    throw new ValidationError('URL is required');
  }

  try {
    const urlObj = new URL(url);
    
    const parsed = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port,
      origin: urlObj.origin,
      pathname: urlObj.pathname,
      isApi: urlObj.pathname.includes('/api/'),
      isWeb: urlObj.pathname.includes('/web/'),
      instance: urlObj.origin
    };
    
    logger.debug(`Parsed Mastodon URL: ${url}`, parsed);
    
    return parsed;
    
  } catch (error) {
    logger.error(`Failed to parse Mastodon URL: ${url}`, error);
    throw new ValidationError(`Failed to parse Mastodon URL: ${error.message}`);
  }
}

/**
 * Generate a short display URL (for logging, etc.)
 */
export function generateShortUrl(url) {
  if (!url) {
    return '';
  }

  try {
    const urlObj = new URL(url);
    const short = `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
    
    // Truncate if too long
    if (short.length > 50) {
      return short.substring(0, 47) + '...';
    }
    
    return short;
    
  } catch (error) {
    logger.error(`Failed to generate short URL for: ${url}`, error);
    return url;
  }
}