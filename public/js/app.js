    // API Base URL
    const API_BASE = '/api';

    // Detect browser timezone with validation and fallback
    let browserTimezone;
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Validate: must be non-empty string matching IANA timezone pattern
      // IANA timezones typically follow patterns like "America/Sao_Paulo", "Europe/London", "UTC", etc.
      if (typeof detected === 'string' && detected.trim() !== '') {
        // Basic IANA pattern validation: at least one letter, may contain slashes, underscores, hyphens
        // This covers patterns like "UTC", "America/Sao_Paulo", "Europe/London", etc.
        const ianaPattern = /^[A-Za-z][A-Za-z0-9_\/\-]+$|^UTC$/i;
        if (ianaPattern.test(detected.trim())) {
          browserTimezone = detected.trim();
        } else {
          throw new Error(`Invalid IANA timezone format: ${detected}`);
        }
      } else {
        throw new Error(`Timezone detection returned invalid value: ${detected}`);
      }
    } catch (error) {
      console.warn('Failed to detect or validate browser timezone, falling back to UTC:', error);
      browserTimezone = 'UTC';
    }

    console.info(`✓ Timezone detected: ${browserTimezone} (${getTimezoneOffset ? '' : 'offset will be calculated after utilities load'})`);

    // State management for cleanup
    let refreshInterval = null;
    let currentAbortedController = null;
    let isLoadingData = false; // Prevent overlapping loadData calls

    // Client-side cache configuration
    const CACHE_KEY = 'hashpanel_stats_cache';
    const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
    const CACHE_MAX_ENTRIES = 100; // Maximum number of cached entries

    /**
     * Remove expired entries from cache based on timestamp and TTL
     */
    function purgeExpiredEntries(cache) {
      const now = Date.now();
      const entries = Object.keys(cache);
      let purged = 0;
      
      for (const key of entries) {
        const entry = cache[key];
        if (entry && entry.timestamp && now - entry.timestamp >= CACHE_TTL) {
          delete cache[key];
          purged++;
        }
      }
      
      if (purged > 0) {
        console.log(`Purged ${purged} expired cache entries`);
      }
      
      return cache;
    }

    /**
     * Evict least-recently-used entries when cache exceeds limit
     */
    function evictLRUEntries(cache, maxEntries) {
      const entries = Object.entries(cache);
      
      if (entries.length <= maxEntries) {
        return cache;
      }
      
      // Sort by lastAccess (oldest first), then by timestamp as fallback
      entries.sort((a, b) => {
        const aAccess = a[1].lastAccess || a[1].timestamp || 0;
        const bAccess = b[1].lastAccess || b[1].timestamp || 0;
        return aAccess - bAccess;
      });
      
      // Remove oldest entries until under limit
      const toRemove = entries.length - maxEntries;
      for (let i = 0; i < toRemove; i++) {
        delete cache[entries[i][0]];
      }
      
      console.log(`Evicted ${toRemove} least-recently-used cache entries`);
      return cache;
    }

    /**
     * Get cached data for a hashtag
     * Updates lastAccess timestamp when entry is accessed
     */
    function getCachedStats(hashtag) {
      try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        const entry = cache[hashtag];
        
        if (entry && entry.timestamp) {
          const now = Date.now();
          const age = now - entry.timestamp;
          
          if (age < CACHE_TTL) {
            // Update lastAccess timestamp
            entry.lastAccess = now;
            cache[hashtag] = entry;
            
            // Save updated access time (may fail silently if quota exceeded)
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
            } catch (e) {
              // Ignore quota errors on access update - entry is still valid
              console.warn('Failed to update cache access time:', e);
            }
            
            console.log(`Using client cache for hashtag: ${hashtag}`);
            return entry.data;
          } else {
            // Entry expired, remove it
            delete cache[hashtag];
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
            } catch (e) {
              // Ignore errors on cleanup
            }
          }
        }
      } catch (e) {
        console.warn('Failed to read from client cache:', e);
      }
      return null;
    }

    /**
     * Set cached data for a hashtag
     * Implements bounded cache with LRU eviction and quota error handling
     */
    function setCachedStats(hashtag, data) {
      try {
        // Load current cache
        let cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        
        // Purge expired entries first
        cache = purgeExpiredEntries(cache);
        
        // Add/update entry with metadata
        cache[hashtag] = {
          data,
          timestamp: Date.now(),
          lastAccess: Date.now()
        };
        
        // Evict LRU entries if over limit
        cache = evictLRUEntries(cache, CACHE_MAX_ENTRIES);
        
        // Attempt to save
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch (e) {
          // Handle quota exceeded error
          if (e.name === 'QuotaExceededError' || e.code === 22) {
            console.warn('Storage quota exceeded, evicting oldest entries and retrying...');
            
            // Evict more aggressively (remove oldest 25% of entries)
            const entries = Object.entries(cache);
            entries.sort((a, b) => {
              const aAccess = a[1].lastAccess || a[1].timestamp || 0;
              const bAccess = b[1].lastAccess || b[1].timestamp || 0;
              return aAccess - bAccess;
            });
            
            const toRemove = Math.max(1, Math.floor(entries.length * 0.25));
            for (let i = 0; i < toRemove; i++) {
              delete cache[entries[i][0]];
            }
            
            // Retry once
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
              console.log(`Successfully saved cache after evicting ${toRemove} entries`);
            } catch (retryError) {
              console.error('Failed to save cache even after eviction:', retryError);
              // Last resort: clear cache and save only current entry
              try {
                const minimalCache = { [hashtag]: cache[hashtag] };
                localStorage.setItem(CACHE_KEY, JSON.stringify(minimalCache));
                console.warn('Cleared cache and saved only current entry due to quota');
              } catch (finalError) {
                console.error('Failed to save cache completely:', finalError);
              }
            }
          } else {
            throw e; // Re-throw non-quota errors
          }
        }
      } catch (e) {
        console.warn('Failed to write to client cache:', e);
      }
    }

    /**
     * Periodic cleanup of expired cache entries
     * Runs every CACHE_TTL interval
     */
    function startCacheCleanupTimer() {
      // Run cleanup immediately on first call
      try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        purgeExpiredEntries(cache);
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch (e) {
        console.warn('Cache cleanup failed:', e);
      }
      
      // Schedule periodic cleanup
      setInterval(() => {
        try {
          const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
          const beforeCount = Object.keys(cache).length;
          purgeExpiredEntries(cache);
          const afterCount = Object.keys(cache).length;
          
          if (beforeCount > afterCount) {
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
            console.log(`Periodic cleanup: removed ${beforeCount - afterCount} expired entries`);
          }
        } catch (e) {
          console.warn('Periodic cache cleanup failed:', e);
        }
      }, CACHE_TTL);
    }

    // Initialize cache cleanup timer on page load
    startCacheCleanupTimer();

    // Rate Limit State Management
    const rateLimitState = {
      limit: null,
      remaining: null,
      reset: null,
      updateTimer: null
    };

    // Format time remaining until reset
    function formatTimeRemaining(resetTimestamp) {
      if (!resetTimestamp) return '';
      
      const now = Date.now();
      const reset = resetTimestamp * 1000; // Convert to milliseconds
      const diff = Math.max(0, reset - now);
      
      if (diff === 0) return 'Resetado';
      
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      
      if (minutes > 0) {
        return `Reset em ${minutes}m ${seconds}s`;
      }
      return `Reset em ${seconds}s`;
    }

    // Update rate limit indicator UI
    function updateRateLimitIndicator(limit, remaining, reset) {
      const indicator = document.getElementById('rateLimitIndicator');
      const textEl = document.getElementById('rateLimitText');
      const resetEl = document.getElementById('rateLimitReset');
      
      if (!indicator || !textEl || !resetEl) return;
      
      // Update state
      rateLimitState.limit = limit;
      rateLimitState.remaining = remaining;
      rateLimitState.reset = reset;
      
      // Show indicator if we have data
      if (limit !== null && remaining !== null) {
        indicator.style.display = 'flex';
        
        // Update text
        textEl.textContent = `Requisições: ${remaining}/${limit}`;
        
        // Update reset time
        if (reset) {
          resetEl.textContent = formatTimeRemaining(reset);
        }
        
        // Update styling based on remaining requests
        indicator.classList.remove('warning', 'critical', 'limited');
        
        if (remaining === 0) {
          indicator.classList.add('limited');
          textEl.textContent = 'Limite atingido!';
        } else if (remaining <= limit * 0.2) {
          indicator.classList.add('critical');
        } else if (remaining <= limit * 0.5) {
          indicator.classList.add('warning');
        }
        
        // Update refresh button state
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
          if (remaining === 0) {
            refreshBtn.disabled = true;
            refreshBtn.classList.add('loading');
            refreshBtn.title = 'Limite de requisições atingido. Aguarde o reset.';
          } else {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove('loading');
            refreshBtn.title = '';
          }
        }
      } else {
        indicator.style.display = 'none';
      }
      
      // Schedule next update
      if (rateLimitState.updateTimer) {
        clearInterval(rateLimitState.updateTimer);
      }
      
      if (reset) {
        rateLimitState.updateTimer = setInterval(() => {
          const resetEl = document.getElementById('rateLimitReset');
          if (resetEl && rateLimitState.reset) {
            resetEl.textContent = formatTimeRemaining(rateLimitState.reset);
            
            // Check if reset time has passed
            const now = Date.now();
            const resetTime = rateLimitState.reset * 1000;
            if (now >= resetTime) {
              // Reset state - will be updated on next request
              rateLimitState.limit = null;
              rateLimitState.remaining = null;
              rateLimitState.reset = null;
              indicator.style.display = 'none';
              clearInterval(rateLimitState.updateTimer);
            }
          }
        }, 1000); // Update every second
      }
    }

    // Extract rate limit info from response headers
    function extractRateLimitInfo(response) {
      const limit = response.headers.get('RateLimit-Limit');
      const remaining = response.headers.get('RateLimit-Remaining');
      const reset = response.headers.get('RateLimit-Reset');
      
      if (limit || remaining || reset) {
        return {
          limit: limit ? parseInt(limit, 10) : null,
          remaining: remaining ? parseInt(remaining, 10) : null,
          reset: reset ? parseInt(reset, 10) : null
        };
      }
      return null;
    }

    // Enhanced fetch wrapper that tracks rate limits
    async function fetchWithRateLimitTracking(url, options = {}) {
      // Add timezone to query params if not already present
      const urlObj = new URL(url, window.location.origin);
      if (!urlObj.searchParams.has('timezone')) {
        urlObj.searchParams.set('timezone', browserTimezone);
        url = urlObj.pathname + urlObj.search;
      }
      try {
        const response = await fetch(url, options);
        
        // Extract rate limit info from headers
        const rateLimitInfo = extractRateLimitInfo(response);
        if (rateLimitInfo) {
          updateRateLimitIndicator(
            rateLimitInfo.limit,
            rateLimitInfo.remaining,
            rateLimitInfo.reset
          );
        }
        
        // Handle rate limit errors
        if (response.status === 429) {
          const rateLimitInfo = extractRateLimitInfo(response);
          if (rateLimitInfo) {
            updateRateLimitIndicator(
              rateLimitInfo.limit,
              0, // No remaining requests
              rateLimitInfo.reset
            );
          }
        }
        
        return response;
      } catch (error) {
        // Re-throw errors
        throw error;
      }
    }

    // Normalize hashtag - remove # sign if present
    function normalizeHashtag(hashtag) {
      if (!hashtag) return hashtag;
      return hashtag.toString().replace(/^#/, '');
    }

    // Security: Sanitize HTML to prevent XSS
    function sanitizeHTML(str) {
      if (typeof str !== 'string') return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // Cleanup function to reset state before loading new data
    function cleanupBeforeLoad() {
      // Abort any ongoing fetch requests
      if (currentAbortedController) {
        currentAbortedController.abort();
        console.log('Aborted previous fetch request');
      }
      
      // Create new abort controller for this load
      currentAbortedController = new AbortController();
      
      // Close any open modals
      const modal = document.getElementById('tootModal');
      if (modal && modal.classList.contains('active')) {
        closeModal();
      }
      
      // Hide error state
      document.getElementById('error').classList.remove('active');
      
      console.log('Cleanup completed before loading new data');
    }

    // UX: Show/hide loading and error states
    function showLoading() {
      document.getElementById('loading').classList.add('active');
      document.getElementById('error').classList.remove('active');
      setStatusDot('loading');
      const refreshBtn = document.getElementById('refreshBtn');
      refreshBtn.classList.add('loading');
      refreshBtn.disabled = true;
      
      // Disable trending tags table interactions while loading
      const trendingTable = document.getElementById('trending-tags-table');
      if (trendingTable) {
        trendingTable.style.opacity = '0.5';
        trendingTable.style.pointerEvents = 'none';
      }
    }
    
    function hideLoading() {
      document.getElementById('loading').classList.remove('active');
      const refreshBtn = document.getElementById('refreshBtn');
      refreshBtn.classList.remove('loading');
      refreshBtn.disabled = false;
      
      // Re-enable trending tags table
      const trendingTable = document.getElementById('trending-tags-table');
      if (trendingTable) {
        trendingTable.style.opacity = '1';
        trendingTable.style.pointerEvents = 'auto';
      }
    }
    
    function showError(message) {
      document.getElementById('errorMessage').textContent = message;
      document.getElementById('error').classList.add('active');
      document.getElementById('loading').classList.remove('active');
      setStatusDot('error');
      hideLoading();
    }

    // Status dot reflects the real data state (loading / fresh / stale / error)
    function setStatusDot(state) {
      const dot = document.getElementById('statusDot');
      if (dot) dot.dataset.state = state;
    }

    // Map low-level fetch failures to plain pt-BR guidance
    function friendlyFetchError(error) {
      if (error instanceof DOMException && error.name === 'TypeError') {
        return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
      }
      if (error && error.message === 'Failed to fetch') {
        return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
      }
      return error?.message || 'Erro inesperado ao carregar dados';
    }

    // Format numbers with locale
    function formatNumber(num) {
      return num?.toLocaleString('pt-BR') || '0';
    }

    // Modal functions - legacy support (kept for backwards compatibility)
    function openModalWithFallback(button) {
      // Check if we have a tootId in cache first
      const tootId = button.dataset.tootId;
      if (tootId && window.tootDataCache?.[tootId]) {
        openModalFromCache(tootId);
        return;
      }
      
      // Fallback to parsing data attributes (legacy method)
      let media = [];
      try {
        if (button.dataset.media) {
          const decoded = decodeURIComponent(button.dataset.media);
          media = JSON.parse(decoded);
          console.log('Parsed media from button:', media);
        }
      } catch (e) {
        console.error('Failed to parse media data:', e);
      }
      
      const tootData = {
        link: button.dataset.url,
        author: button.dataset.author,
        content: button.dataset.content || '',
        favorites: parseInt(button.dataset.favorites) || 0,
        boosts: parseInt(button.dataset.boosts) || 0,
        relevance: button.dataset.relevance || 0,
        followers: parseInt(button.dataset.followers) || 0,
        media: media
      };
      
      console.log('Opening modal with tootData (legacy):', tootData);
      openModal(tootData.link, tootData);
    }

    function openModal(tootUrl, tootData = null) {
      const modal = document.getElementById('tootModal');
      const modalBody = document.getElementById('modalBody');
      const openLink = document.getElementById('modalOpenLink');
      
      modal.classList.add('active');
      openLink.href = tootUrl;
      
      // Show loading state
      modalBody.innerHTML = `
        <div class="embed-loading">
          <div class="spinner"></div>
          <p>Carregando preview...</p>
        </div>
      `;
      
      // Fetch embed from Mastodon oEmbed API, pass tootData for fallback
      fetchEmbed(tootUrl, tootData);
    }

    function closeModal() {
      document.getElementById('tootModal').classList.remove('active');
    }

    async function fetchEmbed(tootUrl, tootData = null) {
      const modalBody = document.getElementById('modalBody');
      let embedTimeout;
      
      try {
        // Extract instance from toot URL
        const urlObj = new URL(tootUrl);
        const instance = urlObj.origin;
        const oembedUrl = `${instance}/api/oembed?url=${encodeURIComponent(tootUrl)}`;
        
        const response = await fetch(oembedUrl, {
          mode: 'cors',
          credentials: 'omit'
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Não foi possível carregar o embed`);
        }
        
        const data = await response.json();
        
        console.log('oEmbed response:', data);
        
        if (data.html) {
          // Check if HTML contains iframe
          const htmlLower = data.html.toLowerCase();
          const hasIframe = htmlLower.includes('<iframe') || htmlLower.includes('iframe');
          
          if (!hasIframe) {
            console.warn('oEmbed HTML does not contain iframe:', data.html);
            // If HTML is just a link or text, use fallback immediately
            // This happens when the Mastodon instance doesn't support oEmbed iframes
            if (tootData) {
              console.log('Using custom preview fallback (no iframe in oEmbed response)');
              showCustomPreview(tootData);
              return;
            }
            // If no tootData, show error with link
            modalBody.innerHTML = `
              <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                <p>Preview não disponível para este toot.</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">
                  <a href="${tootUrl}" target="_blank" style="color: #667eea; text-decoration: none;">
                    Abrir no Mastodon →
                  </a>
                </p>
              </div>
            `;
            return;
          }
          
          // Clear modal body first
          modalBody.innerHTML = '';
          
          // Create container
          const container = document.createElement('div');
          container.className = 'embed-container';
          
          // Insert HTML directly - browser will parse and render iframe
          container.innerHTML = data.html;
          
          // Ensure iframe has proper styling
          const iframe = container.querySelector('iframe');
          if (iframe) {
            // Verify iframe has a valid src
            const iframeSrc = iframe.getAttribute('src');
            if (!iframeSrc || iframeSrc.trim() === '') {
              console.warn('Iframe found but has no src attribute');
              if (tootData) {
                showCustomPreview(tootData);
                return;
              }
              throw new Error('Iframe sem atributo src válido');
            }
            
            console.log('Iframe src:', iframeSrc);
            
            // Remove any existing width/height attributes and set via style
            // Keep height attribute if present (Mastodon oEmbed usually provides it)
            const originalHeight = iframe.getAttribute('height');
            iframe.removeAttribute('width');
            
            iframe.style.width = '100%';
            iframe.style.maxWidth = '100%';
            // Use original height if available, otherwise use min-height
            // Mastodon embeds typically need more height for images
            if (originalHeight && !isNaN(parseInt(originalHeight))) {
              const height = parseInt(originalHeight);
              // If height is too small (likely for text-only posts), increase it
              if (height < 600) {
                iframe.style.height = '800px';
                iframe.style.minHeight = '800px';
              } else {
                iframe.style.height = originalHeight + 'px';
                iframe.style.minHeight = originalHeight + 'px';
              }
            } else {
              // Default to larger height for posts that might have images
              iframe.style.minHeight = '800px';
              iframe.style.height = '800px';
            }
            iframe.style.border = 'none';
            iframe.style.borderRadius = 'var(--radius-md)';
            iframe.style.display = 'block';
            iframe.style.background = 'transparent';
            iframe.style.visibility = 'visible';
            iframe.style.opacity = '1';
            iframe.style.overflow = 'visible';
            
            // Set timeout for iframe loading (10 seconds)
            embedTimeout = setTimeout(() => {
              console.warn('Embed iframe loading timeout');
              if (tootData) {
                showCustomPreview(tootData);
              }
            }, 10000);
            
            // Handle iframe load success - clear timeout
            iframe.onload = () => {
              clearTimeout(embedTimeout);
              console.log('Embed iframe loaded successfully');
              // Ensure iframe is visible after load
              iframe.style.visibility = 'visible';
              iframe.style.opacity = '1';
              
              // Try to adjust iframe height to fit content (if accessible)
              try {
                // If iframe is from same origin, we can access its content
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc) {
                  const iframeBody = iframeDoc.body;
                  if (iframeBody) {
                    const height = Math.max(
                      iframeBody.scrollHeight,
                      iframeBody.offsetHeight,
                      600
                    );
                    iframe.style.height = height + 'px';
                    console.log('Iframe height adjusted to:', height);
                  }
                }
              } catch (e) {
                // Cross-origin iframe - can't access content
                // Use a larger default height for posts with images
                iframe.style.minHeight = '800px';
                iframe.style.height = '800px';
                console.log('Cross-origin iframe, using default height');
              }
            };
            
            // Handle iframe load error
            iframe.onerror = () => {
              clearTimeout(embedTimeout);
              console.error('Embed iframe failed to load');
              if (tootData) {
                showCustomPreview(tootData);
              }
            };
            
            // Append container to modal
            modalBody.appendChild(container);
            
            // Force a reflow to ensure iframe is rendered
            void container.offsetHeight;
          } else {
            // If no iframe found after insertion, use fallback
            console.warn('No iframe found after HTML insertion, using fallback');
            console.warn('HTML content:', container.innerHTML);
            if (tootData) {
              showCustomPreview(tootData);
              return;
            }
            throw new Error('Iframe não encontrado após inserção do HTML');
          }
        } else {
          throw new Error('Embed HTML não disponível na resposta');
        }
      } catch (error) {
        if (embedTimeout) clearTimeout(embedTimeout);
        console.error('Error fetching embed:', error);
        
        // Check if it's a CORS error
        if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
          console.warn('CORS error detected, using fallback preview');
        }
        
        // Fallback to custom preview if tootData is available
        if (tootData) {
          showCustomPreview(tootData);
        } else {
          modalBody.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
              <p>Não foi possível carregar o preview.</p>
              <p style="font-size: 0.9rem; margin-top: 0.5rem;">Erro: ${sanitizeHTML(error.message)}</p>
            </div>
          `;
        }
      }
    }

    // Process Mastodon HTML content for display
    function processContentHTML(htmlContent) {
      if (!htmlContent || typeof htmlContent !== 'string') {
        return '<p>Conteúdo não disponível.</p>';
      }
      
      // Create a temporary container to manipulate the HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;
      
      // Remove any script tags for safety
      const scripts = tempDiv.querySelectorAll('script');
      scripts.forEach(script => script.remove());
      
      // Remove media/attachment links (we display media separately)
      const mediaLinks = tempDiv.querySelectorAll('a[class*="attachment"], a[rel*="attachment"]');
      mediaLinks.forEach(link => link.remove());
      
      // Remove "Abrir link" or similar redundant links that Mastodon adds for media
      const allLinks = tempDiv.querySelectorAll('a');
      allLinks.forEach(link => {
        const text = link.textContent.trim().toLowerCase();
        const href = link.getAttribute('href') || '';
        
        // Remove links that are just media URLs without meaningful text
        if (text === 'abrir link' || 
            text === 'open link' || 
            text === '' ||
            (href.includes('media_attachments') && text === href)) {
          link.remove();
          return;
        }
        
        // Remove invisible/ellipsis text spans within links (Mastodon uses these)
        const invisibleSpans = link.querySelectorAll('.invisible, .ellipsis');
        invisibleSpans.forEach(span => {
          if (span.classList.contains('invisible')) {
            span.remove();
          }
        });
        
        // Add target and security attributes
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        
        // Style hashtag links
        if (href.includes('/tags/') || href.includes('/tag/')) {
          link.classList.add('hashtag');
        }
        
        // Style mention links
        if (href.includes('/@') || link.classList.contains('mention')) {
          link.classList.add('mention');
        }
      });
      
      // Remove empty paragraphs left over from removed links
      const paragraphs = tempDiv.querySelectorAll('p');
      paragraphs.forEach(p => {
        if (p.textContent.trim() === '' && !p.querySelector('img, video, audio')) {
          p.remove();
        }
      });
      
      return tempDiv.innerHTML;
    }

    function showCustomPreview(tootData) {
      const modalBody = document.getElementById('modalBody');
      
      // Debug: log media data
      console.log('showCustomPreview - tootData:', tootData);
      console.log('showCustomPreview - media:', tootData.media);
      
      // Process the content HTML
      const processedContent = processContentHTML(tootData.content);
      
      // Process media attachments (images)
      let mediaHTML = '';
      const imageDataArray = []; // Store image data for event handlers
      
      if (tootData.media && Array.isArray(tootData.media) && tootData.media.length > 0) {
        // Filter images and get URL from various possible fields
        const images = tootData.media
          .map(m => {
            // Get URL from various possible fields (Mastodon API structure)
            const url = m.url || 
                       m.preview_url || 
                       m.remote_url || 
                       m.preview_remote_url || 
                       (m.meta && m.meta.original && m.meta.original.url) ||
                       (m.meta && m.meta.small && m.meta.small.url) ||
                       (m.meta && m.meta.medium && m.meta.medium.url);
            
            // Check if it's an image type
            const isImage = m.type === 'image' || 
                          m.type === 'photo' || 
                          (m.type && m.type.includes('image')) ||
                          (!m.type && url && (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') || url.includes('.gif') || url.includes('.webp')));
            
            if (isImage && url) {
              return {
                url: url,
                description: m.description || m.alt_text || '',
                type: m.type || 'image'
              };
            }
            return null;
          })
          .filter(img => img !== null);
        
        console.log('showCustomPreview - filtered images:', images);
        
        if (images.length > 0) {
          // Calculate grid layout based on number of images
          const gridColumns = images.length === 1 ? '1fr' : 
                             images.length === 2 ? '1fr 1fr' :
                             images.length === 3 ? '1fr 1fr' :
                             'repeat(2, 1fr)';
          
          mediaHTML = `
            <div class="toot-media-container" style="margin-bottom: 1.5rem;">
              <div style="display: grid; grid-template-columns: ${gridColumns}; gap: 0.5rem;">
                ${images.map((img, idx) => {
                  const imgUrl = img.url;
                  // Use proxy endpoint to avoid CORS issues
                  const proxyUrl = `${API_BASE}/media/proxy?url=${encodeURIComponent(imgUrl)}`;
                  console.log('Rendering image via proxy:', proxyUrl, 'Original:', imgUrl);
                  
                  // Create a unique ID for this image container
                  const imgId = 'toot-img-' + idx;
                  
                  // Store image data for later use
                  imageDataArray.push({ imgId, imgUrl, proxyUrl });
                  
                  // Adjust aspect ratio based on image count
                  const aspectRatio = images.length === 1 ? '56.25%' : '100%'; // 16:9 for single, square for multiple
                  
                  return `
                  <div id="${imgId}" class="toot-img-container" data-original-url="${sanitizeHTML(imgUrl)}" style="position: relative; padding-top: ${aspectRatio}; background: rgba(255, 255, 255, 0.05); border-radius: var(--radius-md); overflow: hidden; ${images.length === 3 && idx === 0 ? 'grid-row: span 2;' : ''}">
                    <img 
                      src="${proxyUrl}" 
                      alt="${sanitizeHTML(img.description || 'Imagem do toot')}"
                      title="${sanitizeHTML(img.description || '')}"
                      class="toot-img"
                      data-original-url="${sanitizeHTML(imgUrl)}"
                      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; cursor: pointer; transition: transform 0.2s, filter 0.2s;"
                      loading="lazy"
                    />
                    ${img.description ? `<div class="toot-img-description" style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(0,0,0,0.8)); padding: 0.75rem; color: white; font-size: 0.8rem; line-height: 1.4; opacity: 0; transition: opacity 0.2s;">${sanitizeHTML(img.description)}</div>` : ''}
                  </div>
                `;
                }).join('')}
              </div>
            </div>
          `;
        } else {
          console.warn('No valid images found in media array. Media data:', JSON.stringify(tootData.media, null, 2));
        }
      } else {
        console.warn('No media data or empty media array. tootData:', JSON.stringify(tootData, null, 2));
      }
      
      modalBody.innerHTML = `
        <div class="embed-container" style="padding: 1.5rem; background: rgba(255, 255, 255, 0.05);">
          <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--primary-gradient); display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
              🐘
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 700; color: var(--text-primary); font-size: 1.1rem; margin-bottom: 0.25rem;">@${sanitizeHTML(tootData.author)}</div>
              <div style="color: var(--text-secondary); font-size: 0.9rem;">
                ${tootData.followers ? formatNumber(tootData.followers) + ' seguidores' : ''}
              </div>
            </div>
          </div>
          <div class="toot-content" style="margin-bottom: 1.5rem;">
            ${processedContent}
          </div>
          ${mediaHTML}
          <div style="display: flex; flex-direction: row; align-items: center; justify-content: flex-start; gap: 2rem; padding-top: 1rem; border-top: 1px solid var(--border-color); flex-wrap: nowrap;">
            <div style="display: flex; flex-direction: row; align-items: center; gap: 0.5rem; color: var(--text-secondary); white-space: nowrap;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
              <span>${formatNumber(tootData.favorites || 0)}</span>
            </div>
            <div style="display: flex; flex-direction: row; align-items: center; gap: 0.5rem; color: var(--text-secondary); white-space: nowrap;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 1l4 4-4 4"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <path d="M7 23l-4-4 4-4"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
              </svg>
              <span>${formatNumber(tootData.boosts || 0)}</span>
            </div>
            <div style="display: flex; flex-direction: row; align-items: center; gap: 0.5rem; color: var(--text-secondary); white-space: nowrap;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                <line x1="9" y1="9" x2="9.01" y2="9"/>
                <line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
              <span class="relevance-badge">${tootData.relevance}</span>
            </div>
          </div>
        </div>
      `;
      
      // Attach event handlers to images AFTER innerHTML is set (avoids inline handler issues)
      const imgContainers = modalBody.querySelectorAll('.toot-img-container');
      imgContainers.forEach(container => {
        const img = container.querySelector('.toot-img');
        const description = container.querySelector('.toot-img-description');
        const originalUrl = container.dataset.originalUrl;
        
        if (img) {
          // Error handler
          img.onerror = function() {
            console.error('Image failed to load via proxy:', this.src);
            container.innerHTML = `
              <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 0.85rem; text-align: center; padding: 1rem; flex-direction: column;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">🖼️</div>
                <a href="${originalUrl}" target="_blank" rel="noopener noreferrer" style="color: #667eea; text-decoration: none;">Abrir imagem</a>
              </div>
            `;
          };
          
          // Load handler
          img.onload = function() {
            console.log('Image loaded successfully:', this.src);
          };
          
          // Click handler - open original image
          img.onclick = function() {
            window.open(originalUrl, '_blank');
          };
          
          // Hover effects
          img.onmouseover = function() {
            this.style.transform = 'scale(1.02)';
            this.style.filter = 'brightness(1.1)';
          };
          img.onmouseout = function() {
            this.style.transform = 'scale(1)';
            this.style.filter = 'brightness(1)';
          };
        }
        
        // Description hover effect
        if (description) {
          container.onmouseover = function() {
            description.style.opacity = '1';
          };
          container.onmouseout = function() {
            description.style.opacity = '0';
          };
        }
      });
    }

    // Close modal on backdrop click
    document.getElementById('tootModal').addEventListener('click', function(e) {
      if (e.target === this) {
        closeModal();
      }
    });

    // Close modal on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeModal();
      }
    });

    // Render KPI cards - insert directly into bento grid
    function renderKPICards(stats) {
      const { hashtag, summary } = stats;
      const bentoGrid = document.getElementById('bentoGrid');

      // Remove existing KPI cards if any
      const existingKPIs = bentoGrid.querySelectorAll('.kpi-card');
      existingKPIs.forEach(card => card.remove());

      // Create KPI cards and insert them at the beginning of the grid,
      // preserving the authored order (hashtag first) via a single fragment
      const kpiCards = [
        {
          class: 'primary',
          icon: '#',
          content: `<div class="kpi-hashtag" style="margin-top: 0.5rem;">#${hashtag}</div><div class="kpi-label" style="margin-top: 0.5rem;">Hashtag Atual</div>`
        },
        {
          class: 'success',
          icon: '📝',
          content: `<div class="kpi-value">${formatNumber(summary.tootCount)}</div><div class="kpi-label">Posts Hoje</div>`
        },
        {
          class: 'info',
          icon: '👥',
          content: `<div class="kpi-value">${formatNumber(summary.uniqueUsers)}</div><div class="kpi-label">Participantes Únicos</div>`
        },
        {
          class: 'warning',
          icon: '📊',
          content: `<div class="kpi-value">${formatNumber(summary.weeklyTotal)}</div><div class="kpi-label">Total da Semana</div>`
        }
      ];

      const kpiFragment = document.createDocumentFragment();
      kpiCards.forEach((kpi, index) => {
        const card = document.createElement('div');
        card.className = `kpi-card ${kpi.class}`;
        card.style.animationDelay = `${(index + 1) * 0.1}s`;
        card.innerHTML = `
          <div>
            <div class="kpi-icon" aria-hidden="true">${kpi.icon}</div>
            ${kpi.content}
          </div>
        `;
        kpiFragment.appendChild(card);
      });
      bentoGrid.insertBefore(kpiFragment, bentoGrid.firstChild);
    }

    // Render top toots
    function renderTopToots(topToots) {
      const container = document.getElementById('topTootsContent');
      
      if (!topToots || topToots.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon" aria-hidden="true">📭</div>
            <p>Nenhum post encontrado hoje.</p>
          </div>
        `;
        return;
      }

      // Store toot data in a global map for retrieval
      window.tootDataCache = window.tootDataCache || {};

      const tootsHTML = `
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Autor</th>
                <th scope="col">Favoritos</th>
                <th scope="col">Boosts</th>
                <th scope="col">Relevância</th>
                <th scope="col">Link</th>
              </tr>
            </thead>
            <tbody>
              ${topToots.slice(0, 5).map((toot, index) => {
                let buttonHTML = '<span style="color: var(--text-secondary); opacity: 0.8;">N/A</span>';
                if (toot.link) {
                  // Map media with all possible URL fields
                  const mediaData = (toot.media || []).map(m => {
                    const url = m.url || m.preview_url || m.remote_url || m.preview_remote_url ||
                               (m.meta && m.meta.original && m.meta.original.url) ||
                               (m.meta && m.meta.small && m.meta.small.url);
                    return {
                      type: m.type,
                      url: url,
                      description: m.description || m.alt_text || '',
                      meta: m.meta
                    };
                  }).filter(m => m.url);

                  // Store full toot data in cache to avoid data-attribute corruption
                  const tootId = `toot-${toot.id || index}-${Date.now()}`;
                  window.tootDataCache[tootId] = {
                    link: toot.link,
                    author: toot.author,
                    content: toot.content || '',
                    favorites: toot.favorites || 0,
                    boosts: toot.boosts || 0,
                    relevance: toot.relevance || 0,
                    followers: toot.followers || 0,
                    media: mediaData
                  };

                  buttonHTML = `<button data-toot-id="${tootId}" onclick="openModalFromCache(this.dataset.tootId)" class="btn-link" style="background: none; border: none; cursor: pointer;">Ver <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg><span class="sr-only">toot de ${sanitizeHTML(toot.author)}</span></button>`;
                }
                return `
                <tr>
                  <td data-label="Autor">
                    <strong>@${sanitizeHTML(toot.author)}</strong>
                    <small style="display: block; color: var(--text-secondary); font-weight: 400;">${formatNumber(toot.followers)} seguidores</small>
                  </td>
                  <td data-label="Favoritos"><span class="td-value">${formatNumber(toot.favorites)}</span></td>
                  <td data-label="Boosts"><span class="td-value">${formatNumber(toot.boosts)}</span></td>
                  <td data-label="Relevância"><span class="td-value"><span class="relevance-badge">${toot.relevance}</span></span></td>
                  <td data-label="Link"><span class="td-value">${buttonHTML}</span></td>
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
      
      container.innerHTML = tootsHTML;
    }

    // Open modal from cached toot data (avoids data-attribute corruption)
    function openModalFromCache(tootId) {
      const tootData = window.tootDataCache?.[tootId];
      if (!tootData) {
        console.error('Toot data not found in cache:', tootId);
        return;
      }
      
      console.log('Opening modal from cache:', tootId, tootData);
      openModal(tootData.link, tootData);
    }

    // Load data for specific hashtag
    async function loadHashtagData(hashtag) {
      cleanupBeforeLoad();
      showLoading();
      
      try {
        // Normalize hashtag - remove # sign if present
        const normalizedHashtag = normalizeHashtag(hashtag);
        console.log(`Loading hashtag data for: "${hashtag}" (normalized: "${normalizedHashtag}")`);
        
        // 1. Parallel fetch daily hashtag and check cache
        const dailyHashtagRes = await fetchWithRateLimitTracking(`${API_BASE}/hashtag/current`);
        if (!dailyHashtagRes.ok) throw new Error('Falha ao carregar hashtag atual');
        const dailyData = await dailyHashtagRes.json();
        const isDailyHashtag = normalizedHashtag.toLowerCase() === dailyData.hashtag.toLowerCase(); 

        const cachedStats = getCachedStats(normalizedHashtag);
        if (cachedStats) {
          console.log(`Rendering cached stats for selected hashtag: ${normalizedHashtag}`);
          renderKPICards(cachedStats);
          renderTopToots(cachedStats.topToots || []);

          // Background fetch trending tags to keep view consistent
          const trendingRes = await fetchWithRateLimitTracking(`${API_BASE}/trending?limit=10`);
          if (trendingRes.ok) {
            const { tags: trendingTags } = await trendingRes.json();
            renderTrendingTags(trendingTags, hashtag);
          }

          updateActivePill(normalizedHashtag);
          setStatusDot('stale');

          const now = new Date();
          document.getElementById('lastUpdated').textContent =
            `Última atualização (cache): ${now.toLocaleString('pt-BR')}`;
          
          const backBtn = document.getElementById('backToDailyBtn');
          backBtn.style.display = isDailyHashtag ? 'none' : 'inline-flex';
          
          hideLoading();
        }

        // 2. Fetch stats for the selected hashtag
        const statsUrl = `${API_BASE}/hashtag/${encodeURIComponent(normalizedHashtag)}/stats`;
        console.log(`Fetching fresh stats from: ${statsUrl}`);
        const statsRes = await fetchWithRateLimitTracking(statsUrl);
        
        if (!statsRes.ok) {
          if (cachedStats) {
            console.warn('Background refresh failed, keeping cached data');
            return;
          }

          let errorMessage = `Falha ao carregar estatísticas para #${hashtag}`;
          // ... rest of error handling ...
          try {
            const errorData = await statsRes.json();
            if (errorData.error && errorData.error.message) {
              errorMessage = errorData.error.message;
            }
          } catch (e) {
            if (statsRes.status === 404) {
              errorMessage = `A hashtag #${hashtag} não foi encontrada ou não possui dados recentes.`;
            } else if (statsRes.status >= 500) {
              errorMessage = `Erro no servidor ao buscar dados para #${hashtag}. Tente novamente mais tarde.`;
            }
          }
          throw new Error(errorMessage);
        }
        
        const stats = await statsRes.json(); 
        if (!stats) {
          throw new Error(`Dados inválidos retornados para #${hashtag}`);
        }

        // 3. Update cache and render fresh data
        setCachedStats(normalizedHashtag, stats);

        // Fetch trending tags (keep them)
        const trendingRes = await fetchWithRateLimitTracking(`${API_BASE}/trending?limit=10`);
        if (!trendingRes.ok) throw new Error('Falha ao carregar tags em alta');
        const { tags: trendingTags } = await trendingRes.json();
 
        // Render all sections
        renderKPICards(stats);
        renderTopToots(stats.topToots || []);
        renderTrendingTags(trendingTags, hashtag);
        
        // Update active pill
        updateActivePill(normalizedHashtag);
 
        // Update last updated time and show/hide back button
        const now = new Date();
        document.getElementById('lastUpdated').textContent =
          `Última atualização: ${now.toLocaleString('pt-BR')}`;
        setStatusDot('fresh');

        const backBtn = document.getElementById('backToDailyBtn');
        backBtn.style.display = isDailyHashtag ? 'none' : 'inline-flex';

        hideLoading();
      } catch (error) {
        console.error('Error loading hashtag data:', error);
        showError(friendlyFetchError(error));
      }
    }

    // Render trending tags
    function renderTrendingTags(trendingTags, currentHashtag = null) {
      const tbody = document.getElementById('trending-tags-tbody');
      tbody.innerHTML = ''; 
      
      // Normalize currentHashtag for comparison (remove # sign if present)
      const normalizedCurrentHashtag = currentHashtag ? normalizeHashtag(currentHashtag) : null;
      
      if (!trendingTags || trendingTags.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" class="text-center" style="padding: 3rem; color: var(--text-secondary);">
              <div class="empty-state-icon">📭</div>
              <p style="margin-top: 1rem;">Nenhuma tag em alta encontrada.</p>
            </td>
          </tr>
        `;
        return;
      }

      const trendConfig = {
        'rising': { emoji: '📈', class: 'rising' },
        'falling': { emoji: '📉', class: 'falling' },
        'stable': { emoji: '➡️', class: '' }
      };

      trendingTags.slice(0, 10).forEach((tag, index) => {
        const trend = trendConfig[tag.trendDirection] || trendConfig['stable'];
        const trendLabel = tag.trendDirection === 'rising' ? 'Subindo' :
                          tag.trendDirection === 'falling' ? 'Caindo' : 'Estável';

        const isCurrent = normalizedCurrentHashtag && tag.name.toLowerCase() === normalizedCurrentHashtag.toLowerCase();

        const row = document.createElement('tr');
        row.style.animationDelay = `${index * 0.05}s`;
        row.style.cursor = isCurrent ? 'default' : 'pointer';
        row.setAttribute('data-clickable', (!isCurrent).toString());
        if (!isCurrent) {
          row.setAttribute('title', `Clique para ver dados de #${tag.name}`);
        }
        row.innerHTML = `
          <td data-label="Nome">
            <span class="td-value" style="text-align: left;">
              <strong>
                ${isCurrent ?
                  `<span style="color: #667eea;">#${sanitizeHTML(tag.name)} <small style="color: var(--text-secondary); font-weight: 400;">(atual)</small></span>` :
                  `<button type="button" class="tag-link-btn" data-hashtag="${sanitizeHTML(tag.name)}" aria-label="Ver dados de #${sanitizeHTML(tag.name)}">#${sanitizeHTML(tag.name)}</button>`
                }
              </strong>
            </span>
          </td>
          <td data-label="Usos Hoje"><span class="td-value">${formatNumber(tag.currentUses)}</span></td>
          <td data-label="Contas"><span class="td-value">${formatNumber(tag.accounts)}</span></td>
          <td data-label="Tendência">
            <span class="td-value" style="text-align: right;">
              <span class="trend-badge ${trend.class}">
                <span aria-hidden="true">${trend.emoji}</span> ${trendLabel}
              </span>
            </span>
          </td>
        `;

        if (!isCurrent) {
          const linkBtn = row.querySelector('.tag-link-btn');
          linkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            loadHashtagData(tag.name);
          });
          row.addEventListener('click', () => loadHashtagData(tag.name));
        }

        tbody.appendChild(row);
      });
    }

    // Load and render daily hashtags
    let currentSelectedHashtag = null;

    async function loadDailyHashtags() {
      const pillsContainer = document.getElementById('dailyHashtagsPills');
      
      try {
        const response = await fetchWithRateLimitTracking(`${API_BASE}/hashtag/daily`);
        if (!response.ok) throw new Error('Falha ao carregar hashtags diárias');
        
        const data = await response.json();
        const { dailySchedule, current } = data;
        
        // Clear loading state
        pillsContainer.innerHTML = '';
        
        // Find today's hashtags only
        const todayData = dailySchedule.find(day => day.isToday);
        
        if (!todayData) {
          pillsContainer.innerHTML = `
            <div class="hashtag-pill loading" style="color: var(--text-secondary);">
              Nenhuma hashtag encontrada para hoje
            </div>
          `;
          return;
        }
        
        // Get hashtags array - endpoint always returns array in hashtags field
        // The endpoint uses getHashtagsForDay() which always returns an array
        const hashtags = Array.isArray(todayData.hashtags) && todayData.hashtags.length > 0
          ? todayData.hashtags
          : (todayData.hashtag ? [todayData.hashtag] : []);
        
        // Ensure we have hashtags to display
        if (!hashtags || hashtags.length === 0) {
          pillsContainer.innerHTML = `
            <div class="hashtag-pill loading" style="color: var(--text-secondary);">
              Nenhuma hashtag configurada para hoje
            </div>
          `;
          return;
        }
        
        // Render pills only for today's hashtags
        hashtags.forEach((hashtag, index) => {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'hashtag-pill';
          pill.dataset.hashtag = hashtag;
          pill.setAttribute('aria-pressed', 'false');

          // Mark first hashtag as active by default
          if (index === 0) {
            pill.classList.add('active');
            pill.setAttribute('aria-pressed', 'true');
            currentSelectedHashtag = hashtag;
          }

          pill.innerHTML = `
            <span class="pill-indicator" aria-hidden="true"></span>
            <span>#${hashtag}</span>
          `;

          // Add click handler
          pill.addEventListener('click', () => {
            // Remove active class from all pills
            document.querySelectorAll('.hashtag-pill').forEach(p => {
              if (!p.classList.contains('loading')) {
                p.classList.remove('active');
                p.setAttribute('aria-pressed', 'false');
              }
            });
            // Add active class to clicked pill
            pill.classList.add('active');
            pill.setAttribute('aria-pressed', 'true');
            // Load data for selected hashtag
            currentSelectedHashtag = hashtag;
            loadHashtagData(hashtag);
          });
          
          pillsContainer.appendChild(pill);
        });
        
      } catch (error) {
        console.error('Error loading daily hashtags:', error);
        pillsContainer.innerHTML = `
          <div class="hashtag-pill loading" style="color: var(--text-secondary);">
            Erro ao carregar hashtags
          </div>
        `;
      }
    }

    // Update active pill when hashtag changes
    function updateActivePill(hashtag) {
      const pills = document.querySelectorAll('.hashtag-pill');
      const normalizedHashtag = normalizeHashtag(hashtag);

      pills.forEach(pill => {
        // Skip loading pills
        if (pill.classList.contains('loading')) return;

        // Compare against the pill's own dataset (works with accented hashtags)
        const pillHashtag = pill.dataset.hashtag;

        if (pillHashtag && pillHashtag.toLowerCase() === normalizedHashtag.toLowerCase()) {
          // Remove active class from all pills
          pills.forEach(p => {
            if (!p.classList.contains('loading')) {
              p.classList.remove('active');
              p.setAttribute('aria-pressed', 'false');
            }
          });
          // Add active class to matching pill
          pill.classList.add('active');
          pill.setAttribute('aria-pressed', 'true');
          currentSelectedHashtag = hashtag;
        }
      });
    }

    // Main data loading function - uses new API structure
    async function loadData() {
      // Prevent overlapping calls
      if (isLoadingData) {
        return;
      }
      
      isLoadingData = true;
      cleanupBeforeLoad();
      showLoading();
      
      try {
        const signal = currentAbortedController?.signal;
        
        // 1. Parallel fetch current hashtag and trending tags
        const [hashtagRes, trendingRes] = await Promise.all([
          fetchWithRateLimitTracking(`${API_BASE}/hashtag/current`, { signal }),
          fetchWithRateLimitTracking(`${API_BASE}/trending?limit=10`, { signal })
        ]);
        
        if (!hashtagRes.ok) throw new Error('Falha ao carregar hashtag atual');
        if (!trendingRes.ok) throw new Error('Falha ao carregar tags em alta');

        const { hashtag } = await hashtagRes.json();
        const { tags: trendingTags } = await trendingRes.json();

        // 2. Check for cached stats before fetching
        const cachedStats = getCachedStats(hashtag);
        if (cachedStats) {
          console.log(`Rendering cached stats for: ${hashtag}`);
          renderKPICards(cachedStats);
          renderTopToots(cachedStats.topToots || []);
          renderTrendingTags(trendingTags, hashtag);
          updateActivePill(hashtag);
          setStatusDot('stale');

          const now = new Date();
          document.getElementById('lastUpdated').textContent =
            `Última atualização (cache): ${now.toLocaleString('pt-BR')}`;

          hideLoading();
        }

        // 3. Fetch fresh dashboard stats for current hashtag
        const statsRes = await fetchWithRateLimitTracking(`${API_BASE}/hashtag/${encodeURIComponent(hashtag)}/stats`, { signal });
        
        if (!statsRes.ok) {
          // If we already showed cached data, don't show error for background fetch
          if (cachedStats) {
            console.warn('Background refresh failed, keeping cached data');
            return;
          }

          // Handle rate limiting with user-friendly message
          if (statsRes.status === 429) {
            const errorData = await statsRes.json().catch(() => ({}));
            const retryAfter = errorData.error?.retryAfter || 15;
            throw new Error(`Limite de requisições atingido. Aguarde ${retryAfter} segundos antes de tentar novamente.`);
          }
          throw new Error('Falha ao carregar estatísticas');
        }
        
        const stats = await statsRes.json();
        
        // 4. Update cache and render fresh data
        setCachedStats(hashtag, stats);

        // Render all sections
        renderKPICards(stats);
        renderTopToots(stats.topToots || []);
        renderTrendingTags(trendingTags, hashtag);
        
        // Update active pill
        updateActivePill(hashtag);

        // Update last updated time and hide back button
        const now = new Date();
        document.getElementById('lastUpdated').textContent =
          `Última atualização: ${now.toLocaleString('pt-BR')}`;
        setStatusDot('fresh');

        document.getElementById('backToDailyBtn').style.display = 'none';

        hideLoading();
      } catch (error) {
        // Don't show error for aborted requests (user-initiated cancellation)
        if (error.name === 'AbortError') {
          return; // Silently ignore aborted requests
        }

        console.error('Error loading data:', error);
        showError(friendlyFetchError(error));
      } finally {
        isLoadingData = false;
      }
    }

    // Initialize dashboard
    loadDailyHashtags(); // Load daily hashtags pills first
    loadData();
    
    // Set up auto-refresh interval (every 5 minutes)
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
    refreshInterval = setInterval(() => {
      console.log('Auto-refresh triggered');
      loadData();
    }, 300000);
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      if (currentAbortedController) {
        currentAbortedController.abort();
      }
    });

    // ==================== Weekly History View ====================
    let weeklyUsesChart = null;
    let weeklyAccountsChart = null;
    let dailyViewMode = false;
    
    // Color palette for multiple hashtags
    const hashtagColors = [
      { border: 'rgb(102, 126, 234)', background: 'rgba(102, 126, 234, 0.1)' }, // Primary blue
      { border: 'rgb(67, 233, 123)', background: 'rgba(67, 233, 123, 0.1)' },   // Green
      { border: 'rgb(250, 112, 154)', background: 'rgba(250, 112, 154, 0.1)' }, // Pink
      { border: 'rgb(79, 172, 254)', background: 'rgba(79, 172, 254, 0.1)' },   // Light blue
      { border: 'rgb(255, 107, 107)', background: 'rgba(255, 107, 107, 0.1)' }, // Red
      { border: 'rgb(243, 202, 64)', background: 'rgba(243, 202, 64, 0.1)' },   // Yellow
      { border: 'rgb(118, 75, 162)', background: 'rgba(118, 75, 162, 0.1)' },   // Purple
      { border: 'rgb(240, 147, 251)', background: 'rgba(240, 147, 251, 0.1)' }, // Light pink
    ];

    // Navigation between views
    function showView(view) {
      const dashboardView = document.getElementById('dashboardView');
      const historyView = document.getElementById('historyView');
      const navDashboard = document.getElementById('navDashboard');
      const navHistory = document.getElementById('navHistory');

      if (view === 'history') {
        dashboardView.style.display = 'none';
        historyView.style.display = 'block';
        navDashboard.classList.remove('active');
        navHistory.classList.add('active');
        navDashboard.style.background = 'var(--bg-card)';
        navDashboard.style.border = '1px solid var(--border-color)';
        navHistory.style.background = 'var(--primary-gradient)';
        navHistory.style.border = 'none';
        
        initializeHistoryView();
      } else {
        dashboardView.style.display = 'block';
        historyView.style.display = 'none';
        navHistory.classList.remove('active');
        navDashboard.classList.add('active');
        navHistory.style.background = 'var(--bg-card)';
        navHistory.style.border = '1px solid var(--border-color)';
        navDashboard.style.background = 'var(--primary-gradient)';
        navDashboard.style.border = 'none';
      }
    }

    // Initialize history view
    function initializeHistoryView() {
      // Populate year selector (last 5 years + current year)
      const yearSelect = document.getElementById('yearSelect');
      const currentYear = new Date().getFullYear();
      yearSelect.innerHTML = '';
      for (let year = currentYear; year >= currentYear - 5; year--) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === currentYear) option.selected = true;
        yearSelect.appendChild(option);
      }

      // Load hashtags list
      loadHistoryHashtags().then(() => {
        // Initialize filters after hashtags are loaded
        updateFilters();
      });
    }

    // Handle hashtag select change
    function handleHashtagSelectChange() {
      const hashtagSelect = document.getElementById('hashtagSelect');
      const selectedOptions = Array.from(hashtagSelect.selectedOptions);
      const allOption = selectedOptions.find(opt => opt.value === 'all');
      
      // Handle "all" selection - if "all" is selected, deselect other options
      if (allOption && selectedOptions.length > 1) {
        // If "all" is selected along with other options, deselect others
        Array.from(hashtagSelect.options).forEach(opt => {
          if (opt.value !== 'all') {
            opt.selected = false;
          }
        });
      } else if (!allOption && selectedOptions.length > 0) {
        // If individual hashtags are selected, ensure "all" is not selected
        const allOpt = Array.from(hashtagSelect.options).find(opt => opt.value === 'all');
        if (allOpt && allOpt.selected) {
          allOpt.selected = false;
        }
      }
      
      // Update filters and load data
      updateFilters();
    }

    // Update filter visibility based on filter type
    async function updateFilters() {
      const filterType = document.getElementById('filterTypeSelect').value;
      const weekContainer = document.getElementById('weekFilterContainer');
      const dayContainer = document.getElementById('dayFilterContainer');
      const dailyViewContainer = document.getElementById('dailyViewContainer');
      const selectedHashtags = getSelectedHashtags();
      
      weekContainer.style.display = filterType === 'week' ? 'block' : 'none';
      dayContainer.style.display = filterType === 'day' ? 'block' : 'none';
      
      // Show daily view button when week filter is active AND hashtag(s) are selected
      // Works with single hashtag, "all" hashtags, or multiple hashtags
      const canShowDailyView = filterType === 'week' && selectedHashtags.length > 0;
      dailyViewContainer.style.display = canShowDailyView ? 'block' : 'none';
      
      // Reset daily view mode when filter changes or when daily view is not available
      if (filterType !== 'week' || !canShowDailyView) {
        dailyViewMode = false;
      }
      
      // Update button state (enabled/disabled based on week selection)
      updateDailyViewButton();
      
      // Load weeks if week filter is selected
      if (filterType === 'week') {
        try {
          await loadAvailableWeeks();
        } catch (error) {
          console.error('Error loading available weeks:', error);
        }
      }
      
      // Load history with new filters
      if (selectedHashtags.length > 0) {
        loadWeeklyHistory();
      }
    }

    // Toggle daily view mode
    function toggleDailyView() {
      const weekSelect = document.getElementById('weekSelect');
      const selectedWeek = weekSelect?.value || '';
      
      // Only allow toggle if a week is selected
      if (!selectedWeek) return;
      
      dailyViewMode = !dailyViewMode;
      updateDailyViewButton();
      loadWeeklyHistory();
    }

    // Update daily view button text, style, and enabled/disabled state
    function updateDailyViewButton() {
      const btn = document.getElementById('toggleDailyViewBtn');
      const weekSelect = document.getElementById('weekSelect');
      const selectedWeek = weekSelect?.value || '';
      
      // Check if a specific week is selected
      const isWeekSelected = selectedWeek !== '';
      
      // Update enabled/disabled state
      btn.disabled = !isWeekSelected;
      
      if (dailyViewMode && isWeekSelected) {
        btn.textContent = '📊 Ver Semanal';
        btn.style.background = 'var(--primary-gradient)';
        btn.style.border = 'none';
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.title = 'Voltar para visualização semanal';
      } else if (isWeekSelected) {
        btn.textContent = '📅 Ver Diário';
        btn.style.background = 'var(--bg-secondary)';
        btn.style.border = '1px solid var(--border-color)';
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.title = 'Ver dados diários da semana selecionada';
      } else {
        btn.textContent = '📅 Ver Diário';
        btn.style.background = 'var(--bg-secondary)';
        btn.style.border = '1px solid var(--border-color)';
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.title = 'Selecione uma semana específica para habilitar';
        // Reset daily view mode if week is deselected
        dailyViewMode = false;
      }
    }

    // Handle week selector change
    function onWeekSelectChange() {
      // Update daily view button state
      updateDailyViewButton();
      // Load data
      loadWeeklyHistory();
    }

    // Get selected hashtags
    function getSelectedHashtags() {
      const hashtagSelect = document.getElementById('hashtagSelect');
      const selectedOptions = Array.from(hashtagSelect.selectedOptions);
      
      // Check if "all" is selected
      const allOption = selectedOptions.find(opt => opt.value === 'all');
      if (allOption) {
        return ['all'];
      }
      
      // Return selected hashtag values
      return selectedOptions.map(opt => opt.value);
    }

    // Load available weeks for the selected year and hashtag
    async function loadAvailableWeeks() {
      const year = document.getElementById('yearSelect').value;
      const selectedHashtags = getSelectedHashtags();
      const weekSelect = document.getElementById('weekSelect');
      
      if (selectedHashtags.length === 0) {
        weekSelect.innerHTML = '<option value="">Selecione uma hashtag</option>';
        return;
      }
      
      try {
        weekSelect.innerHTML = '<option value="">Carregando...</option>';
        
        let weeklyData = [];
        
        // Handle "all" hashtags - fetch aggregated data
        if (selectedHashtags.includes('all')) {
          const url = `${API_BASE}/hashtag/history/weekly?year=${year}`;
          const response = await fetch(url);
          if (!response.ok) throw new Error('Failed to load weeks');
          
          const data = await response.json();
          
          // Extract unique weeks from all hashtags
          const allWeeks = new Map();
          Object.values(data.data || {}).forEach(hashtagData => {
            (hashtagData || []).forEach(week => {
              if (!allWeeks.has(week.weekNumber)) {
                allWeeks.set(week.weekNumber, week);
              }
            });
          });
          
          weeklyData = Array.from(allWeeks.values()).sort((a, b) => a.weekNumber - b.weekNumber);
        }
        // Handle multiple hashtags - fetch data for first one (representative)
        else if (selectedHashtags.length > 1) {
          const url = `${API_BASE}/hashtag/${encodeURIComponent(selectedHashtags[0])}/history/weekly?year=${year}`;
          const response = await fetch(url);
          if (!response.ok) throw new Error('Failed to load weeks');
          
          const data = await response.json();
          weeklyData = data.weeklyData || [];
        }
        // Single hashtag
        else {
          const hashtag = selectedHashtags[0];
          const url = `${API_BASE}/hashtag/${encodeURIComponent(hashtag)}/history/weekly?year=${year}`;
          const response = await fetch(url);
          if (!response.ok) throw new Error('Failed to load weeks');
          
          const data = await response.json();
          weeklyData = data.weeklyData || [];
        }
        
        weekSelect.innerHTML = '<option value="">Todas as semanas</option>';
        
        if (weeklyData.length > 0) {
          weeklyData.forEach(week => {
            const option = document.createElement('option');
            option.value = week.weekNumber;
            option.textContent = `Semana ${week.weekNumber} (${formatDate(week.weekStart)} - ${formatDate(week.weekEnd)})`;
            weekSelect.appendChild(option);
          });
        } else {
          weekSelect.innerHTML = '<option value="">Nenhuma semana disponível</option>';
        }
      } catch (error) {
        console.error('Error loading weeks:', error);
        weekSelect.innerHTML = '<option value="">Erro ao carregar</option>';
      }
    }

    // Load hashtags for multi-select
    async function loadHistoryHashtags() {
      try {
        const response = await fetch(`${API_BASE}/hashtag/daily`);
        if (!response.ok) throw new Error('Failed to load hashtags');
        
        const data = await response.json();
        const hashtagSelect = document.getElementById('hashtagSelect');
        
        // Clear existing options
        hashtagSelect.innerHTML = '';
        
        // Add "all" option first
        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = 'Todas as hashtags (agregado)';
        hashtagSelect.appendChild(allOption);
        
        // Extract unique hashtags
        const uniqueHashtags = new Set();
        data.dailySchedule.forEach(day => {
          if (day.hashtags && Array.isArray(day.hashtags)) {
            day.hashtags.forEach(tag => uniqueHashtags.add(tag));
          } else if (day.hashtag && day.hashtag !== 'unknown') {
            uniqueHashtags.add(day.hashtag);
          }
        });
        
        // Create options for each hashtag
        Array.from(uniqueHashtags).sort().forEach(hashtag => {
          const option = document.createElement('option');
          option.value = hashtag;
          option.textContent = `#${hashtag}`;
          hashtagSelect.appendChild(option);
        });
      } catch (error) {
        console.error('Error loading hashtags:', error);
      }
    }

    // Load weekly history data
    async function loadWeeklyHistory() {
      const year = document.getElementById('yearSelect').value;
      const selectedHashtags = getSelectedHashtags();
      const filterType = document.getElementById('filterTypeSelect').value;
      const week = document.getElementById('weekSelect')?.value || '';
      const day = document.getElementById('daySelect')?.value || '';
      
      if (selectedHashtags.length === 0) {
        // Clear charts and table if no hashtags selected
        if (weeklyUsesChart) weeklyUsesChart.destroy();
        if (weeklyAccountsChart) weeklyAccountsChart.destroy();
        weeklyUsesChart = null;
        weeklyAccountsChart = null;
        document.getElementById('weeklyHistoryTableBody').innerHTML = `
          <tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">
            Selecione pelo menos uma hashtag para ver os dados
          </td></tr>
        `;
        return;
      }
      
      try {
        // Handle "all hashtags" aggregation
        if (selectedHashtags.includes('all')) {
          // Day filter doesn't work with "all"
          if (filterType === 'day') {
            document.getElementById('weeklyHistoryTableBody').innerHTML = `
              <tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">
                Filtro por dia não está disponível para "Todas as hashtags"
              </td></tr>
            `;
            return;
          }
          
          const url = `${API_BASE}/hashtag/history/weekly?year=${year}`;
          const response = await fetch(url);
          if (!response.ok) throw new Error('Failed to load weekly history');
          const data = await response.json();
          
          // If week filter is active, filter the data by week
          if (filterType === 'week' && week) {
            // If daily view mode is enabled, fetch daily data for all hashtags
            if (dailyViewMode) {
              await renderAllHashtagsDailyView(data, year, parseInt(week));
            } else {
              renderAllHashtagsHistoryFiltered(data, year, parseInt(week));
            }
          } else {
            renderAllHashtagsHistory(data, year);
          }
          return;
        }
        
        // Handle multiple hashtags - fetch data for each
        if (selectedHashtags.length > 1) {
          // Day filter doesn't work with multiple hashtags
          if (filterType === 'day') {
            document.getElementById('weeklyHistoryTableBody').innerHTML = `
              <tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">
                Filtro por dia só funciona com uma hashtag selecionada
              </td></tr>
            `;
            return;
          }
          
          const hashtagDataPromises = selectedHashtags.map(async (hashtag) => {
            const url = `${API_BASE}/hashtag/${encodeURIComponent(hashtag)}/history/weekly?year=${year}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to load data for ${hashtag}`);
            const data = await response.json();
            return { hashtag, data };
          });
          
          const hashtagDataResults = await Promise.all(hashtagDataPromises);
          
          // If week filter is active, filter the data by week
          if (filterType === 'week' && week) {
            // If daily view mode is enabled, fetch daily data for multiple hashtags
            if (dailyViewMode) {
              await renderMultipleHashtagsDailyView(hashtagDataResults, year, parseInt(week));
            } else {
              renderMultipleHashtagsHistoryFiltered(hashtagDataResults, year, parseInt(week));
            }
          } else {
            renderMultipleHashtagsHistory(hashtagDataResults, year);
          }
          return;
        }
        
        // Single hashtag selected
        const hashtag = selectedHashtags[0];
        let url = `${API_BASE}/hashtag/${encodeURIComponent(hashtag)}/history/weekly?year=${year}`;
        if (filterType === 'week' && week) {
          url += `&week=${week}`;
          // Add daily parameter if daily view mode is enabled
          if (dailyViewMode) {
            url += `&daily=true`;
          }
        } else if (filterType === 'day' && day) {
          url += `&date=${day}`;
        }
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to load weekly history');
        
        const data = await response.json();
        
        // Handle different response types
        if (data.type === 'daily' || (data.dailyData && dailyViewMode)) {
          if (data.dailyData) {
            renderDailyWeekData(data);
          } else {
            renderDailyData(data);
          }
        } else {
          renderSingleHashtagHistory(data);
        }
      } catch (error) {
        console.error('Error loading weekly history:', error);
        document.getElementById('weeklyHistoryTableBody').innerHTML = `
          <tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-danger);">
            Erro ao carregar dados: ${error.message}
          </td></tr>
        `;
      }
    }

    // Render daily data
    function renderDailyData(data) {
      // Update summary cards
      document.getElementById('summaryTotalUses').textContent = data.uses || 0;
      document.getElementById('summaryTotalAccounts').textContent = data.accounts || 0;
      document.getElementById('summaryWeeks').textContent = '1';
      document.getElementById('summaryAverage').textContent = (data.uses || 0).toFixed(1);
      
      // Clear charts (daily data doesn't need charts)
      if (weeklyUsesChart) weeklyUsesChart.destroy();
      if (weeklyAccountsChart) weeklyAccountsChart.destroy();
      weeklyUsesChart = null;
      weeklyAccountsChart = null;
      
      // Update table
      const tbody = document.getElementById('weeklyHistoryTableBody');
      tbody.innerHTML = `
        <tr>
          <td>${data.weekNumber ? `Semana ${data.weekNumber}` : '-'}</td>
          <td>${formatDate(data.date)}</td>
          <td>${formatDate(data.date)}</td>
          <td>${data.uses}</td>
          <td>${data.accounts}</td>
          <td>${data.uses}</td>
        </tr>
      `;
    }

    // Render daily week data (all days of a week)
    function renderDailyWeekData(data) {
      const { dailyData, summary, weekStart, weekEnd, weekNumber } = data;
      
      // Update summary cards
      document.getElementById('summaryTotalUses').textContent = summary.totalUses || 0;
      document.getElementById('summaryTotalAccounts').textContent = summary.totalAccounts || 0;
      document.getElementById('summaryWeeks').textContent = '1';
      document.getElementById('summaryAverage').textContent = summary.averageDaily ? summary.averageDaily.toFixed(1) : 0;
      
      // Update charts with daily data
      updateDailyCharts(dailyData);
      
      // Update table
      const tbody = document.getElementById('weeklyHistoryTableBody');
      if (dailyData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">Nenhum dado disponível para esta semana</td></tr>';
        return;
      }
      
      tbody.innerHTML = dailyData.map(day => {
        const date = new Date(day.date);
        const dayName = date.toLocaleDateString('pt-BR', { weekday: 'short' });
        return `
          <tr>
            <td>Semana ${weekNumber}</td>
            <td>${formatDate(day.date)} (${dayName})</td>
            <td>${formatDate(day.date)}</td>
            <td>${day.uses}</td>
            <td>${day.accounts}</td>
            <td>${day.uses}</td>
          </tr>
        `;
      }).join('');
    }

    // Render single hashtag history
    function renderSingleHashtagHistory(data) {
      const { weeklyData, summary } = data;
      
      // Update summary cards
      document.getElementById('summaryTotalUses').textContent = summary.totalUses || 0;
      document.getElementById('summaryTotalAccounts').textContent = summary.totalAccounts || 0;
      document.getElementById('summaryWeeks').textContent = summary.totalWeeks || 0;
      document.getElementById('summaryAverage').textContent = summary.averageWeekly ? summary.averageWeekly.toFixed(1) : 0;
      
      // Update charts
      updateWeeklyCharts(weeklyData);
      
      // Update table
      const tbody = document.getElementById('weeklyHistoryTableBody');
      if (weeklyData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">Nenhum dado disponível para este período</td></tr>';
        return;
      }
      
      tbody.innerHTML = weeklyData.map(week => `
        <tr>
          <td>Semana ${week.weekNumber}</td>
          <td>${formatDate(week.weekStart)}</td>
          <td>${formatDate(week.weekEnd)}</td>
          <td>${week.totalUses}</td>
          <td>${week.totalAccounts}</td>
          <td>${week.dailyAverage.toFixed(1)}</td>
        </tr>
      `).join('');
    }

    // Render multiple hashtags history (each as separate line)
    function renderMultipleHashtagsHistory(hashtagDataResults, year) {
      // Extract weekly data for each hashtag
      const datasetsArray = hashtagDataResults.map(({ hashtag, data }) => ({
        hashtag,
        weeklyData: data.weeklyData || []
      }));
      
      // Calculate aggregated summary
      let totalUses = 0;
      let totalAccounts = 0;
      let maxWeeks = 0;
      const allWeekNumbers = new Set();
      
      datasetsArray.forEach(({ weeklyData }) => {
        weeklyData.forEach(week => {
          totalUses += week.totalUses;
          totalAccounts += week.totalAccounts;
          allWeekNumbers.add(week.weekNumber);
        });
        maxWeeks = Math.max(maxWeeks, weeklyData.length);
      });
      
      const avgWeekly = allWeekNumbers.size > 0 ? totalUses / allWeekNumbers.size : 0;
      
      // Update summary cards
      document.getElementById('summaryTotalUses').textContent = totalUses;
      document.getElementById('summaryTotalAccounts').textContent = totalAccounts;
      document.getElementById('summaryWeeks').textContent = maxWeeks;
      document.getElementById('summaryAverage').textContent = avgWeekly.toFixed(1);
      
      // Update charts with multiple datasets
      updateWeeklyChartsMultiple(datasetsArray);
      
      // Update table - show aggregated data
      const tbody = document.getElementById('weeklyHistoryTableBody');
      if (allWeekNumbers.size === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">Nenhum dado disponível para este período</td></tr>';
        return;
      }
      
      // Aggregate weeks across all hashtags
      const aggregatedWeeks = {};
      datasetsArray.forEach(({ weeklyData }) => {
        weeklyData.forEach(week => {
          if (!aggregatedWeeks[week.weekNumber]) {
            aggregatedWeeks[week.weekNumber] = {
              weekNumber: week.weekNumber,
              weekStart: week.weekStart,
              weekEnd: week.weekEnd,
              totalUses: 0,
              totalAccounts: 0
            };
          }
          aggregatedWeeks[week.weekNumber].totalUses += week.totalUses;
          aggregatedWeeks[week.weekNumber].totalAccounts += week.totalAccounts;
        });
      });
      
      const sortedWeeks = Object.values(aggregatedWeeks).sort((a, b) => a.weekNumber - b.weekNumber);
      sortedWeeks.forEach(week => {
        week.dailyAverage = week.totalUses / 7;
      });
      
      tbody.innerHTML = sortedWeeks.map(week => `
        <tr>
          <td>Semana ${week.weekNumber}</td>
          <td>${formatDate(week.weekStart)}</td>
          <td>${formatDate(week.weekEnd)}</td>
          <td>${week.totalUses}</td>
          <td>${week.totalAccounts}</td>
          <td>${week.dailyAverage ? week.dailyAverage.toFixed(1) : 0}</td>
        </tr>
      `).join('');
    }

    // Render all hashtags history
    function renderAllHashtagsHistory(data, year) {
      const { data: allData, summary } = data;
      
      // Aggregate data across all hashtags
      const aggregatedWeeks = {};
      let totalUses = 0;
      let totalAccounts = 0;
      let weekCount = 0;
      
      Object.values(allData).forEach(hashtagData => {
        hashtagData.forEach(week => {
          if (!aggregatedWeeks[week.weekNumber]) {
            aggregatedWeeks[week.weekNumber] = {
              weekNumber: week.weekNumber,
              weekStart: week.weekStart,
              weekEnd: week.weekEnd,
              totalUses: 0,
              totalAccounts: 0
            };
          }
          aggregatedWeeks[week.weekNumber].totalUses += week.totalUses;
          aggregatedWeeks[week.weekNumber].totalAccounts += week.totalAccounts;
          totalUses += week.totalUses;
          totalAccounts += week.totalAccounts;
        });
        weekCount = Math.max(weekCount, hashtagData.length);
      });
      
      const weeklyData = Object.values(aggregatedWeeks).sort((a, b) => a.weekNumber - b.weekNumber);
      weeklyData.forEach(week => {
        week.dailyAverage = week.totalUses / 7;
      });
      
      const avgWeekly = weeklyData.length > 0 ? totalUses / weeklyData.length : 0;
      
      // Update summary cards
      document.getElementById('summaryTotalUses').textContent = totalUses;
      document.getElementById('summaryTotalAccounts').textContent = totalAccounts;
      document.getElementById('summaryWeeks').textContent = weekCount;
      document.getElementById('summaryAverage').textContent = avgWeekly.toFixed(1);
      
      // Update charts
      updateWeeklyCharts(weeklyData);
      
      // Update table
      const tbody = document.getElementById('weeklyHistoryTableBody');
      if (weeklyData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">Nenhum dado disponível para este período</td></tr>';
        return;
      }
      
      tbody.innerHTML = weeklyData.map(week => `
        <tr>
          <td>Semana ${week.weekNumber}</td>
          <td>${formatDate(week.weekStart)}</td>
          <td>${formatDate(week.weekEnd)}</td>
          <td>${week.totalUses}</td>
          <td>${week.totalAccounts}</td>
          <td>${week.dailyAverage ? week.dailyAverage.toFixed(1) : 0}</td>
        </tr>
      `).join('');
    }

    // Render all hashtags history filtered by a specific week
    function renderAllHashtagsHistoryFiltered(data, year, weekNumber) {
      const { data: allData } = data;
      
      // Aggregate data across all hashtags for the specific week
      let totalUses = 0;
      let totalAccounts = 0;
      let weekStart = null;
      let weekEnd = null;
      const hashtagBreakdown = [];
      
      Object.entries(allData).forEach(([hashtag, hashtagData]) => {
        const weekData = hashtagData.find(w => w.weekNumber === weekNumber);
        if (weekData) {
          totalUses += weekData.totalUses;
          totalAccounts += weekData.totalAccounts;
          if (!weekStart) {
            weekStart = weekData.weekStart;
            weekEnd = weekData.weekEnd;
          }
          hashtagBreakdown.push({
            hashtag,
            totalUses: weekData.totalUses,
            totalAccounts: weekData.totalAccounts,
            dailyAverage: weekData.dailyAverage || (weekData.totalUses / 7)
          });
        }
      });
      
      const avgDaily = totalUses / 7;
      
      // Update summary cards
      document.getElementById('summaryTotalUses').textContent = totalUses;
      document.getElementById('summaryTotalAccounts').textContent = totalAccounts;
      document.getElementById('summaryWeeks').textContent = '1';
      document.getElementById('summaryAverage').textContent = avgDaily.toFixed(1);
      
      // Update charts with breakdown by hashtag
      if (hashtagBreakdown.length > 0) {
        updateWeeklyChartsBarByHashtag(hashtagBreakdown);
      } else {
        if (weeklyUsesChart) weeklyUsesChart.destroy();
        if (weeklyAccountsChart) weeklyAccountsChart.destroy();
        weeklyUsesChart = null;
        weeklyAccountsChart = null;
      }
      
      // Update table - show breakdown by hashtag
      const tbody = document.getElementById('weeklyHistoryTableBody');
      if (hashtagBreakdown.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">Nenhum dado disponível para esta semana</td></tr>';
        return;
      }
      
      // Sort by uses descending
      hashtagBreakdown.sort((a, b) => b.totalUses - a.totalUses);
      
      tbody.innerHTML = hashtagBreakdown.map(item => `
        <tr>
          <td>#${item.hashtag}</td>
          <td>${formatDate(weekStart)}</td>
          <td>${formatDate(weekEnd)}</td>
          <td>${item.totalUses}</td>
          <td>${item.totalAccounts}</td>
          <td>${item.dailyAverage ? item.dailyAverage.toFixed(1) : 0}</td>
        </tr>
      `).join('');
    }

    // Render multiple hashtags history filtered by a specific week
    function renderMultipleHashtagsHistoryFiltered(hashtagDataResults, year, weekNumber) {
      const hashtagBreakdown = [];
      let weekStart = null;
      let weekEnd = null;
      let totalUses = 0;
      let totalAccounts = 0;
      
      hashtagDataResults.forEach(({ hashtag, data }) => {
        const weekData = (data.weeklyData || []).find(w => w.weekNumber === weekNumber);
        if (weekData) {
          totalUses += weekData.totalUses;
          totalAccounts += weekData.totalAccounts;
          if (!weekStart) {
            weekStart = weekData.weekStart;
            weekEnd = weekData.weekEnd;
          }
          hashtagBreakdown.push({
            hashtag,
            totalUses: weekData.totalUses,
            totalAccounts: weekData.totalAccounts,
            dailyAverage: weekData.dailyAverage || (weekData.totalUses / 7)
          });
        }
      });
      
      const avgDaily = totalUses / 7;
      
      // Update summary cards
      document.getElementById('summaryTotalUses').textContent = totalUses;
      document.getElementById('summaryTotalAccounts').textContent = totalAccounts;
      document.getElementById('summaryWeeks').textContent = '1';
      document.getElementById('summaryAverage').textContent = avgDaily.toFixed(1);
      
      // Update charts with breakdown by hashtag
      if (hashtagBreakdown.length > 0) {
        updateWeeklyChartsBarByHashtag(hashtagBreakdown);
      } else {
        if (weeklyUsesChart) weeklyUsesChart.destroy();
        if (weeklyAccountsChart) weeklyAccountsChart.destroy();
        weeklyUsesChart = null;
        weeklyAccountsChart = null;
      }
      
      // Update table
      const tbody = document.getElementById('weeklyHistoryTableBody');
      if (hashtagBreakdown.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">Nenhum dado disponível para esta semana</td></tr>';
        return;
      }
      
      // Sort by uses descending
      hashtagBreakdown.sort((a, b) => b.totalUses - a.totalUses);
      
      tbody.innerHTML = hashtagBreakdown.map(item => `
        <tr>
          <td>#${item.hashtag}</td>
          <td>${formatDate(weekStart)}</td>
          <td>${formatDate(weekEnd)}</td>
          <td>${item.totalUses}</td>
          <td>${item.totalAccounts}</td>
          <td>${item.dailyAverage ? item.dailyAverage.toFixed(1) : 0}</td>
        </tr>
      `).join('');
    }

    // Update charts with bar chart showing hashtag breakdown
    function updateWeeklyChartsBarByHashtag(hashtagBreakdown) {
      const labels = hashtagBreakdown.map(item => `#${item.hashtag}`);
      const usesData = hashtagBreakdown.map(item => item.totalUses);
      const accountsData = hashtagBreakdown.map(item => item.totalAccounts);
      
      // Update chart titles
      document.getElementById('usesChartTitle').textContent = 'Total de Usos por Hashtag';
      document.getElementById('accountsChartTitle').textContent = 'Contas Únicas por Hashtag';
      
      // Destroy existing charts
      if (weeklyUsesChart) weeklyUsesChart.destroy();
      if (weeklyAccountsChart) weeklyAccountsChart.destroy();
      
      // Generate colors for each bar
      const backgroundColors = hashtagBreakdown.map((_, i) => hashtagColors[i % hashtagColors.length].background);
      const borderColors = hashtagBreakdown.map((_, i) => hashtagColors[i % hashtagColors.length].border);
      
      // Uses chart (bar)
      const usesCtx = document.getElementById('weeklyUsesChart').getContext('2d');
      weeklyUsesChart = new Chart(usesCtx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Usos',
            data: usesData,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          }
        }
      });
      
      // Accounts chart (bar)
      const accountsCtx = document.getElementById('weeklyAccountsChart').getContext('2d');
      weeklyAccountsChart = new Chart(accountsCtx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Contas',
            data: accountsData,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          }
        }
      });
    }

    // Fetch daily data for multiple hashtags with rate limit tracking and concurrency control
    async function fetchDailyDataForHashtags(hashtags, year, weekNumber, concurrency = 5) {
      const allDailyData = [];
      
      // Process hashtags in batches to control concurrency
      for (let i = 0; i < hashtags.length; i += concurrency) {
        const batch = hashtags.slice(i, i + concurrency);
        const batchPromises = batch.map(async (hashtag) => {
          const url = `${API_BASE}/hashtag/${encodeURIComponent(hashtag)}/history/weekly?year=${year}&week=${weekNumber}&daily=true`;
          try {
            const response = await fetchWithRateLimitTracking(url);
            if (!response.ok) return { hashtag, dailyData: [] };
            const result = await response.json();
            return { hashtag, dailyData: result.dailyData || [] };
          } catch (error) {
            console.error(`Error fetching daily data for ${hashtag}:`, error);
            return { hashtag, dailyData: [] };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        allDailyData.push(...batchResults);
      }
      
      return allDailyData;
    }

    // Render daily view for all hashtags (async - fetches daily data for each)
    async function renderAllHashtagsDailyView(data, year, weekNumber) {
      const { data: allData } = data;
      
      // Find week info from first hashtag with this week
      let weekStart = null;
      let weekEnd = null;
      const hashtagsWithWeek = [];
      
      Object.entries(allData).forEach(([hashtag, hashtagData]) => {
        const weekData = hashtagData.find(w => w.weekNumber === weekNumber);
        if (weekData) {
          if (!weekStart) {
            weekStart = weekData.weekStart;
            weekEnd = weekData.weekEnd;
          }
          hashtagsWithWeek.push(hashtag);
        }
      });
      
      if (!weekStart || hashtagsWithWeek.length === 0) {
        document.getElementById('weeklyHistoryTableBody').innerHTML = `
          <tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">
            Nenhum dado disponível para esta semana
          </td></tr>
        `;
        return;
      }
      
      // Fetch daily data for each hashtag with concurrency control
      const allDailyData = await fetchDailyDataForHashtags(hashtagsWithWeek, year, weekNumber);
      renderMultipleHashtagsDailyChart(allDailyData, weekStart, weekEnd);
    }

    // Render daily view for multiple hashtags (async - fetches daily data for each)
    async function renderMultipleHashtagsDailyView(hashtagDataResults, year, weekNumber) {
      // Find week info
      let weekStart = null;
      let weekEnd = null;
      const hashtagsWithWeek = [];
      
      hashtagDataResults.forEach(({ hashtag, data }) => {
        const weekData = (data.weeklyData || []).find(w => w.weekNumber === weekNumber);
        if (weekData) {
          if (!weekStart) {
            weekStart = weekData.weekStart;
            weekEnd = weekData.weekEnd;
          }
          hashtagsWithWeek.push(hashtag);
        }
      });
      
      if (!weekStart || hashtagsWithWeek.length === 0) {
        document.getElementById('weeklyHistoryTableBody').innerHTML = `
          <tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">
            Nenhum dado disponível para esta semana
          </td></tr>
        `;
        return;
      }
      
      // Fetch daily data for each hashtag with concurrency control
      const allDailyData = await fetchDailyDataForHashtags(hashtagsWithWeek, year, weekNumber);
      renderMultipleHashtagsDailyChart(allDailyData, weekStart, weekEnd);
    }

    // Render chart with multiple hashtags daily data
    function renderMultipleHashtagsDailyChart(allDailyData, weekStart, weekEnd) {
      // Get all unique dates across all hashtags
      const allDates = new Set();
      allDailyData.forEach(({ dailyData }) => {
        dailyData.forEach(day => allDates.add(day.date));
      });
      
      const sortedDates = Array.from(allDates).sort();
      
      // Format labels with weekday names
      const labels = sortedDates.map(dateStr => {
        const date = new Date(dateStr);
        const weekday = date.toLocaleDateString('pt-BR', { weekday: 'short' });
        const dayNum = date.getDate();
        return `${weekday} ${dayNum}`;
      });
      
      // Calculate totals for summary
      let totalUses = 0;
      let totalAccounts = 0;
      
      allDailyData.forEach(({ dailyData }) => {
        dailyData.forEach(day => {
          totalUses += day.uses || 0;
          totalAccounts += day.accounts || 0;
        });
      });
      
      const avgDaily = sortedDates.length > 0 ? totalUses / sortedDates.length : 0;
      
      // Update summary cards
      document.getElementById('summaryTotalUses').textContent = totalUses;
      document.getElementById('summaryTotalAccounts').textContent = totalAccounts;
      document.getElementById('summaryWeeks').textContent = '1';
      document.getElementById('summaryAverage').textContent = avgDaily.toFixed(1);
      
      // Update chart titles
      document.getElementById('usesChartTitle').textContent = 'Evolução Diária - Total de Usos';
      document.getElementById('accountsChartTitle').textContent = 'Evolução Diária - Contas Únicas';
      
      // Create datasets for uses chart
      const usesDatasets = allDailyData.map(({ hashtag, dailyData }, index) => {
        const color = hashtagColors[index % hashtagColors.length];
        const data = sortedDates.map(date => {
          const day = dailyData.find(d => d.date === date);
          return day ? day.uses : 0;
        });
        
        return {
          label: `#${hashtag}`,
          data: data,
          borderColor: color.border,
          backgroundColor: color.background,
          tension: 0.4,
          fill: false
        };
      });
      
      // Create datasets for accounts chart
      const accountsDatasets = allDailyData.map(({ hashtag, dailyData }, index) => {
        const color = hashtagColors[index % hashtagColors.length];
        const data = sortedDates.map(date => {
          const day = dailyData.find(d => d.date === date);
          return day ? day.accounts : 0;
        });
        
        return {
          label: `#${hashtag}`,
          data: data,
          borderColor: color.border,
          backgroundColor: color.background,
          tension: 0.4,
          fill: false
        };
      });
      
      // Destroy existing charts
      if (weeklyUsesChart) weeklyUsesChart.destroy();
      if (weeklyAccountsChart) weeklyAccountsChart.destroy();
      
      // Uses chart
      const usesCtx = document.getElementById('weeklyUsesChart').getContext('2d');
      weeklyUsesChart = new Chart(usesCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: usesDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#a0aec0' },
              position: 'top'
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          }
        }
      });
      
      // Accounts chart
      const accountsCtx = document.getElementById('weeklyAccountsChart').getContext('2d');
      weeklyAccountsChart = new Chart(accountsCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: accountsDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#a0aec0' },
              position: 'top'
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          }
        }
      });
      
      // Update table - show daily breakdown for each hashtag
      const tbody = document.getElementById('weeklyHistoryTableBody');
      if (allDailyData.length === 0 || sortedDates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 3rem; color: var(--text-secondary);">Nenhum dado diário disponível</td></tr>';
        return;
      }
      
      // Create table rows showing daily data for each date
      let tableHtml = '';
      sortedDates.forEach(dateStr => {
        const date = new Date(dateStr);
        const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long' });
        
        // Sum for this date across all hashtags
        let dayUses = 0;
        let dayAccounts = 0;
        allDailyData.forEach(({ dailyData }) => {
          const day = dailyData.find(d => d.date === dateStr);
          if (day) {
            dayUses += day.uses || 0;
            dayAccounts += day.accounts || 0;
          }
        });
        
        tableHtml += `
          <tr>
            <td>${weekday}</td>
            <td>${formatDate(dateStr)}</td>
            <td>${formatDate(dateStr)}</td>
            <td>${dayUses}</td>
            <td>${dayAccounts}</td>
            <td>${allDailyData.length} hashtags</td>
          </tr>
        `;
      });
      
      tbody.innerHTML = tableHtml;
    }

    // Update charts - single dataset
    function updateWeeklyCharts(weeklyData, hashtagLabel = null) {
      // Single dataset (original behavior)
      const labels = weeklyData.map(w => `Semana ${w.weekNumber}`);
      const usesData = weeklyData.map(w => w.totalUses);
      const accountsData = weeklyData.map(w => w.totalAccounts);
      
      // Update chart titles to weekly
      document.getElementById('usesChartTitle').textContent = 'Evolução Semanal - Total de Usos';
      document.getElementById('accountsChartTitle').textContent = 'Evolução Semanal - Contas Únicas';
      
      // Destroy existing charts if they exist
      if (weeklyUsesChart) weeklyUsesChart.destroy();
      if (weeklyAccountsChart) weeklyAccountsChart.destroy();
      
      const label = hashtagLabel || 'Total de Usos';
      
      // Uses chart
      const usesCtx = document.getElementById('weeklyUsesChart').getContext('2d');
      weeklyUsesChart = new Chart(usesCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: label,
            data: usesData,
            borderColor: 'rgb(102, 126, 234)',
            backgroundColor: 'rgba(102, 126, 234, 0.1)',
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#a0aec0' }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          }
        }
      });
      
      // Accounts chart
      const accountsCtx = document.getElementById('weeklyAccountsChart').getContext('2d');
      weeklyAccountsChart = new Chart(accountsCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: label,
            data: accountsData,
            borderColor: 'rgb(67, 233, 123)',
            backgroundColor: 'rgba(67, 233, 123, 0.1)',
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#a0aec0' }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          }
        }
      });
    }

    // Update charts with daily data (weekdays on x-axis)
    function updateDailyCharts(dailyData) {
      // Format labels with weekday names
      const labels = dailyData.map(day => {
        const date = new Date(day.date);
        const weekday = date.toLocaleDateString('pt-BR', { weekday: 'short' });
        const dayNum = date.getDate();
        return `${weekday} ${dayNum}`;
      });
      
      const usesData = dailyData.map(day => day.uses);
      const accountsData = dailyData.map(day => day.accounts);
      
      // Update chart titles
      document.getElementById('usesChartTitle').textContent = 'Evolução Diária - Total de Usos';
      document.getElementById('accountsChartTitle').textContent = 'Evolução Diária - Contas Únicas';
      
      // Destroy existing charts if they exist
      if (weeklyUsesChart) weeklyUsesChart.destroy();
      if (weeklyAccountsChart) weeklyAccountsChart.destroy();
      
      // Uses chart
      const usesCtx = document.getElementById('weeklyUsesChart').getContext('2d');
      weeklyUsesChart = new Chart(usesCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Usos Diários',
            data: usesData,
            borderColor: 'rgb(102, 126, 234)',
            backgroundColor: 'rgba(102, 126, 234, 0.1)',
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#a0aec0' }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          }
        }
      });
      
      // Accounts chart
      const accountsCtx = document.getElementById('weeklyAccountsChart').getContext('2d');
      weeklyAccountsChart = new Chart(accountsCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Contas Diárias',
            data: accountsData,
            borderColor: 'rgb(67, 233, 123)',
            backgroundColor: 'rgba(67, 233, 123, 0.1)',
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#a0aec0' }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          }
        }
      });
    }

    // Update charts with multiple datasets (one per hashtag)
    function updateWeeklyChartsMultiple(datasetsArray) {
      // datasetsArray is array of { label, weeklyData }
      // Get all unique week numbers across all datasets
      const allWeekNumbers = new Set();
      datasetsArray.forEach(ds => {
        ds.weeklyData.forEach(week => allWeekNumbers.add(week.weekNumber));
      });
      
      const sortedWeeks = Array.from(allWeekNumbers).sort((a, b) => a - b);
      const labels = sortedWeeks.map(w => `Semana ${w}`);
      
      // Update chart titles to weekly
      document.getElementById('usesChartTitle').textContent = 'Evolução Semanal - Total de Usos';
      document.getElementById('accountsChartTitle').textContent = 'Evolução Semanal - Contas Únicas';
      
      // Create datasets for uses chart
      const usesDatasets = datasetsArray.map((ds, index) => {
        const color = hashtagColors[index % hashtagColors.length];
        const data = sortedWeeks.map(weekNum => {
          const week = ds.weeklyData.find(w => w.weekNumber === weekNum);
          return week ? week.totalUses : null;
        });
        
        return {
          label: `#${ds.hashtag}`,
          data: data,
          borderColor: color.border,
          backgroundColor: color.background,
          tension: 0.4,
          fill: false // Don't fill when multiple lines
        };
      });
      
      // Create datasets for accounts chart
      const accountsDatasets = datasetsArray.map((ds, index) => {
        const color = hashtagColors[index % hashtagColors.length];
        const data = sortedWeeks.map(weekNum => {
          const week = ds.weeklyData.find(w => w.weekNumber === weekNum);
          return week ? week.totalAccounts : null;
        });
        
        return {
          label: `#${ds.hashtag}`,
          data: data,
          borderColor: color.border,
          backgroundColor: color.background,
          tension: 0.4,
          fill: false
        };
      });
      
      // Destroy existing charts if they exist
      if (weeklyUsesChart) weeklyUsesChart.destroy();
      if (weeklyAccountsChart) weeklyAccountsChart.destroy();
      
      // Uses chart
      const usesCtx = document.getElementById('weeklyUsesChart').getContext('2d');
      weeklyUsesChart = new Chart(usesCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: usesDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#a0aec0' },
              position: 'top'
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          }
        }
      });
      
      // Accounts chart
      const accountsCtx = document.getElementById('weeklyAccountsChart').getContext('2d');
      weeklyAccountsChart = new Chart(accountsCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: accountsDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#a0aec0' },
              position: 'top'
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: '#a0aec0' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            }
          }
        }
      });
    }

    // Get timezone offset for display
    function getTimezoneOffset(timezone) {
      const date = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'shortOffset'
      });
      
      try {
        const parts = formatter.formatToParts(date);
        const offsetPart = parts.find(part => part.type === 'timeZoneName');
        return offsetPart ? offsetPart.value : '';
      } catch (e) {
        // Fallback: compute offset for the provided timezone (not local)
        try {
          // Format the date in UTC and target timezone to calculate offset
          const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
          const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
          
          // Calculate offset in minutes
          const offset = (tzDate - utcDate) / (1000 * 60);
          const hours = Math.floor(Math.abs(offset) / 60);
          const minutes = Math.abs(offset) % 60;
          const sign = offset >= 0 ? '+' : '-';
          
          return `UTC${sign}${hours.toString().padStart(2, '0')}${minutes > 0 ? ':' + minutes.toString().padStart(2, '0') : ''}`;
        } catch (fallbackError) {
          // Last resort: return local offset with warning
          console.warn('Failed to calculate timezone offset for', timezone, fallbackError);
          const offset = -date.getTimezoneOffset();
          const hours = Math.floor(Math.abs(offset) / 60);
          const minutes = Math.abs(offset) % 60;
          const sign = offset >= 0 ? '+' : '-';
          return `UTC${sign}${hours.toString().padStart(2, '0')}${minutes > 0 ? ':' + minutes.toString().padStart(2, '0') : ''}`;
        }
      }
    }

    // Get timezone display name
    function getTimezoneName(timezone) {
      const parts = timezone.split('/');
      return parts[parts.length - 1].replace(/_/g, ' ');
    }

    // Format date helper with timezone information
    function formatDate(dateString) {
      if (!dateString) return '-';
      // Parse date and format using browser's timezone automatically
      const date = new Date(dateString + 'T00:00:00');
      return date.toLocaleDateString('pt-BR', { timeZone: browserTimezone });
    }

    // Format date with timezone tooltip
    function formatDateWithTooltip(dateString) {
      if (!dateString) return '-';
      const formattedDate = formatDate(dateString);
      const tzOffset = getTimezoneOffset(browserTimezone);
      const tzName = getTimezoneName(browserTimezone);
      return `<span title="Timezone: ${tzName} (${tzOffset})" style="cursor: help; border-bottom: 1px dotted #a0aec0;">${formattedDate}</span>`;
    }

    // Format datetime for display
    function formatDateTime(dateTimeString) {
      if (!dateTimeString) return '-';
      const date = new Date(dateTimeString);
      return date.toLocaleString('pt-BR', { timeZone: browserTimezone });
    }

    // Format datetime with timezone tooltip
    function formatDateTimeWithTooltip(dateTimeString) {
      if (!dateTimeString) return '-';
      const formattedDateTime = formatDateTime(dateTimeString);
      const tzOffset = getTimezoneOffset(browserTimezone);
      const tzName = getTimezoneName(browserTimezone);
      return `<span title="Timezone: ${tzName} (${tzOffset})" style="cursor: help; border-bottom: 1px dotted #a0aec0;">${formattedDateTime}</span>`;
    }

    // Make functions global
    window.showView = showView;
    window.loadWeeklyHistory = loadWeeklyHistory;
    window.updateFilters = updateFilters;
    window.getSelectedHashtags = getSelectedHashtags;
    window.handleHashtagSelectChange = handleHashtagSelectChange;
    window.onWeekSelectChange = onWeekSelectChange;
