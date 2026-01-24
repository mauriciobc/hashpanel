import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MastodonService } from '../../../src/services/mastodon.js';
import Mastodon from 'mastodon-api';

// Mock mastodon-api
vi.mock('mastodon-api');

import { logger, loggers } from '../../../src/utils/logger.js';
import { sendTelemetry } from '../../../src/utils/telemetry.js';

describe('MastodonService', () => {
  let service;
  let mockGet, mockPost;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockGet = vi.fn().mockImplementation(() => Promise.resolve({ data: [] }));
    mockPost = vi.fn().mockImplementation(() => Promise.resolve({ data: {} }));

    // Setup mock instance
    const mockClient = {
      get: mockGet,
      post: mockPost,
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    
    // Ensure the constructor returns our mock
    vi.mocked(Mastodon).mockImplementation(function() {
      return mockClient;
    });
    
    service = new MastodonService();
  });

  describe('makeAPIRequest', () => {
    it('should successfully make a GET request', async () => {
      const mockData = { some: 'data' };
      mockGet.mockResolvedValueOnce({ data: mockData });

      const result = await service.makeAPIRequest('test/endpoint');

      expect(result).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('test/endpoint', {});
    });

    it('should throw APIError on invalid response', async () => {
      mockGet.mockResolvedValueOnce(null);

      await expect(service.makeAPIRequest('test/endpoint'))
        .rejects.toThrow('Invalid response from test/endpoint');
    });

    it('should handle 429 Rate Limit error', async () => {
      const error = new Error('Rate limit');
      error.response = { status: 429, headers: { 'retry-after': '60' } };
      mockGet.mockRejectedValueOnce(error);

      await expect(service.makeAPIRequest('test/endpoint'))
        .rejects.toThrow('Mastodon API rate limit exceeded');
    });

    it('should handle 404 Not Found error', async () => {
      const error = new Error('Not found');
      error.response = { status: 404 };
      mockGet.mockRejectedValueOnce(error);

      await expect(service.makeAPIRequest('test/endpoint'))
        .rejects.toThrow('Resource not found: test/endpoint');
    });

    it('should handle timeout error', async () => {
      const error = new Error('connect ETIMEDOUT');
      error.code = 'ETIMEDOUT';
      mockGet.mockRejectedValueOnce(error);

      await expect(service.makeAPIRequest('test/endpoint'))
        .rejects.toThrow('Request timeout for test/endpoint');
    });
  });

  describe('fetchTootsByHashtag', () => {
    it('should fetch toots for a hashtag', async () => {
      const mockToots = [{ id: '1', content: 'hello' }];
      mockGet.mockResolvedValueOnce({ data: mockToots });

      const result = await service.fetchTootsByHashtag('test');

      expect(result).toEqual(mockToots);
      expect(mockGet).toHaveBeenCalledWith('timelines/tag/test', expect.any(Object));
    });

    it('should throw error if hashtag is missing', async () => {
      await expect(service.fetchTootsByHashtag(null))
        .rejects.toThrow('Valid hashtag is required');
    });
  });

  describe('fetchAllToots', () => {
    it('should fetch all pages of toots', async () => {
      // Mock tootsPerPage to 2 for this test
      vi.mock('../../../src/config/index.js', async (importOriginal) => {
        const original = await importOriginal();
        return {
          ...original,
          appConfig: {
            ...original.appConfig,
            performance: {
              ...original.appConfig.performance,
              tootsPerPage: 2
            }
          }
        };
      });

      const page1 = [{ id: '10' }, { id: '9' }];
      const page2 = [{ id: '8' }];
      
      mockGet
        .mockResolvedValueOnce({ data: page1 })
        .mockResolvedValueOnce({ data: page2 });

      const result = await service.fetchAllToots('test', 2);

      expect(result).toHaveLength(3);
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockGet).toHaveBeenNthCalledWith(2, 'timelines/tag/test', expect.objectContaining({ max_id: '9' }));
    });
  });

  describe('getTrendingTags', () => {
    it('should fetch trending tags', async () => {
      const mockTags = [{ name: 'tag1' }, { name: 'tag2' }];
      mockGet.mockResolvedValueOnce({ data: mockTags });

      const result = await service.getTrendingTags();

      expect(result).toEqual(mockTags);
      expect(mockGet).toHaveBeenCalledWith('trends/tags', expect.any(Object));
    });
  });
});
