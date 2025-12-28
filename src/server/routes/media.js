import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { lightRateLimit } from '../../middleware/rateLimiter.js';
import { ValidationError } from '../../errors/index.js';
import { logger } from '../../utils/logger.js';

// Use native fetch (Node 18+) or fallback to node-fetch
let fetch;
if (globalThis.fetch) {
  // Native fetch (Node 18+)
  fetch = globalThis.fetch;
} else {
  // Try to load node-fetch dynamically when needed
  fetch = null;
  logger.warn('Native fetch not available. Install node-fetch for image proxy support.');
}

const router = Router();

// In-memory cache for proxied images (simple implementation)
// In production, consider using Redis or similar
const imageCache = new Map();
const CACHE_TTL = 3600000; // 1 hour in milliseconds
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB max

/**
 * Validate and sanitize image URL
 */
function validateImageUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new ValidationError('Image URL is required');
  }

  try {
    const urlObj = new URL(url);
    
    // Only allow HTTP/HTTPS
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new ValidationError('Invalid protocol. Only HTTP/HTTPS allowed');
    }

    // Whitelist allowed domains (Mastodon CDNs and common image hosts)
    // In production, you might want to make this configurable
    const allowedDomains = [
      'cdn.ursal.zone',
      'i.cdn.ursal.zone',
      'files.mastodon.social',
      'media.mastodon.social',
      'cdn.mastodon.social'
    ];

    const hostname = urlObj.hostname.toLowerCase();
    const isAllowed = allowedDomains.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );

    if (!isAllowed) {
      logger.warn('Image URL from non-whitelisted domain', { hostname, url });
      // Allow but log for monitoring
    }

    return urlObj.href;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Invalid URL format');
  }
}

/**
 * GET /api/media/proxy
 * Proxy image requests to avoid CORS and hotlinking issues
 * 
 * Query params:
 * - url: The image URL to proxy (required, URL encoded)
 * - cache: Whether to use cache (default: true)
 */
router.get('/proxy', lightRateLimit, asyncHandler(async (req, res) => {
  // Lazy load fetch if not available
  let fetchFunction = fetch;
  if (!fetchFunction) {
    try {
      const nodeFetch = await import('node-fetch');
      fetchFunction = nodeFetch.default;
    } catch (error) {
      throw new ValidationError('Image proxy not available. Please install node-fetch or use Node.js 18+');
    }
  }

  const { url, cache = 'true' } = req.query;

  if (!url) {
    throw new ValidationError('URL parameter is required');
  }

  // Decode URL
  let imageUrl;
  try {
    imageUrl = decodeURIComponent(url);
  } catch (error) {
    throw new ValidationError('Invalid URL encoding');
  }

  // Validate URL
  const validatedUrl = validateImageUrl(imageUrl);

  // Check cache
  const useCache = cache !== 'false';
  if (useCache && imageCache.has(validatedUrl)) {
    const cached = imageCache.get(validatedUrl);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      logger.debug('Serving image from cache', { url: validatedUrl });
      res.set({
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=3600',
        'X-Cache': 'HIT'
      });
      return res.send(cached.data);
    } else {
      // Cache expired
      imageCache.delete(validatedUrl);
    }
  }

  try {
    logger.info('Proxying image request', { url: validatedUrl });

    // Fetch image with timeout and size limit
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetchFunction(validatedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': new URL(validatedUrl).origin + '/',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site'
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    // Check content type
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      throw new ValidationError('URL does not point to an image');
    }

    // Check content length
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_IMAGE_SIZE) {
      throw new ValidationError('Image too large');
    }

    // Get image data - handle both native fetch and node-fetch
    let buffer;
    if (response.arrayBuffer) {
      // Native fetch (Node 18+)
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else if (response.buffer) {
      // node-fetch
      buffer = await response.buffer();
    } else {
      throw new Error('Unsupported fetch implementation');
    }
    
    if (buffer.length > MAX_IMAGE_SIZE) {
      throw new ValidationError('Image too large');
    }

    // Cache the image
    if (useCache) {
      imageCache.set(validatedUrl, {
        data: buffer,
        contentType,
        timestamp: Date.now()
      });
      
      // Clean old cache entries periodically (simple cleanup)
      if (imageCache.size > 100) {
        const now = Date.now();
        for (const [key, value] of imageCache.entries()) {
          if (now - value.timestamp > CACHE_TTL) {
            imageCache.delete(key);
          }
        }
      }
    }

    // Set response headers
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'X-Cache': 'MISS',
      'Content-Length': buffer.length
    });

    res.send(buffer);

  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('Image fetch timeout', { url: validatedUrl });
      throw new ValidationError('Image fetch timeout');
    }
    
    logger.error('Failed to proxy image', error, { url: validatedUrl });
    throw new ValidationError(`Failed to fetch image: ${error.message}`);
  }
}));

export { router as mediaRoutes };
