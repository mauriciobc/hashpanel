import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { hashtagListener } from '../../services/hashtagListener.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * GET /api/websocket/status
 * Get WebSocket connection status and statistics
 */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    logger.debug('WebSocket status requested');
    
    const status = hashtagListener.getStatus();
    
    // Forçar verificação imediata do status
    hashtagListener.checkWebSocketStatus();
    
    res.json({
      websocket: status,
      timestamp: new Date().toISOString()
    });
  })
);

export { router as websocketRoutes };
