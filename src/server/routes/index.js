import { Router } from 'express';
import { dashboardRoutes } from './dashboard.js';
import { hashtagRoutes } from './hashtag.js';
import { trendingRoutes } from './trending.js';
import { tootRoutes } from './toot.js';
import { mediaRoutes } from './media.js';
import { websocketRoutes } from './websocket.js';
import { docsRoutes } from './docs.js';

const router = Router();

// API version and info
router.get('/', (req, res) => {
  res.json({
    name: 'Hashbot2 API',
    version: '1.0.0',
    description: 'Mastodon hashtag monitoring and analysis API',
    endpoints: {
      dashboard: '/api/dashboard',
      hashtag: '/api/hashtag',
      trending: '/api/trending',
      toot: '/api/toot',
      media: '/api/media',
      websocket: '/api/websocket',
    },
    documentation: '/api/docs',
  });
});

// Route groups
router.use('/dashboard', dashboardRoutes);
router.use('/hashtag', hashtagRoutes);
router.use('/trending', trendingRoutes);
router.use('/toot', tootRoutes);
router.use('/media', mediaRoutes);
router.use('/websocket', websocketRoutes);
router.use('/docs', docsRoutes);

export { router as apiRoutes };
