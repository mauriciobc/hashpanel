import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../src/middleware/errorHandler.js';

// Mock the service dependencies so the routes can be exercised without
// network access or native modules.
vi.mock('../../src/services/hashtagListener.js', () => ({
  hashtagListener: {
    getStatus: vi.fn(),
    checkWebSocketStatus: vi.fn(),
  },
}));

vi.mock('../../src/services/hashtagService.js', () => ({
  hashtagService: {
    getTrendingTags: vi.fn(),
  },
}));

import { hashtagListener } from '../../src/services/hashtagListener.js';
import { hashtagService } from '../../src/services/hashtagService.js';
import { websocketRoutes } from '../../src/server/routes/websocket.js';
import { trendingRoutes } from '../../src/server/routes/trending.js';

function buildApp() {
  const app = express();
  app.use('/api/websocket', websocketRoutes);
  app.use('/api/trending', trendingRoutes);
  app.use(errorHandler);
  return app;
}

describe('HTTP routes (integration, mocked services)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/websocket/status', () => {
    it('returns the listener status', async () => {
      hashtagListener.getStatus.mockReturnValue({
        connected: true,
        readyState: 1,
        eventCount: 7,
      });

      const res = await request(app).get('/api/websocket/status');

      expect(res.status).toBe(200);
      expect(res.body.websocket).toEqual({ connected: true, readyState: 1, eventCount: 7 });
      expect(typeof res.body.timestamp).toBe('string');
      expect(hashtagListener.checkWebSocketStatus).toHaveBeenCalled();
    });
  });

  describe('GET /api/trending', () => {
    it('uses default pagination and enriches tags', async () => {
      hashtagService.getTrendingTags.mockResolvedValue({
        tags: [
          {
            name: 'node',
            url: 'https://example.com/tags/node',
            history: [{ uses: 5, accounts: 2 }],
          },
        ],
        totalCount: 1,
      });

      const res = await request(app).get('/api/trending');

      expect(res.status).toBe(200);
      expect(hashtagService.getTrendingTags).toHaveBeenCalledWith(10, 0);
      expect(res.body.pagination).toEqual({ limit: 10, offset: 0, total: 1, hasMore: false });
      expect(res.body.tags[0]).toMatchObject({
        rank: 1,
        name: 'node',
        currentUses: 5,
        accounts: 2,
        weekTotal: 5,
      });
    });

    it('clamps an oversized limit to the API maximum', async () => {
      hashtagService.getTrendingTags.mockResolvedValue({ tags: [], totalCount: 0 });

      const res = await request(app).get('/api/trending?limit=9999');

      expect(res.status).toBe(200);
      expect(hashtagService.getTrendingTags).toHaveBeenCalledWith(100, 0);
    });
  });
});
