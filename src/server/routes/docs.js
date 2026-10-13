import { Router } from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';

const router = Router();

// The OpenAPI document lives at <repo>/docs/openapi.json (cwd is the project root).
const OPENAPI_PATH = path.join(process.cwd(), 'docs', 'openapi.json');

/**
 * GET /api/docs
 * Serve the OpenAPI 3 specification as JSON.
 */
router.get('/', (req, res) => {
  try {
    const spec = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8'));
    res.json(spec);
  } catch (error) {
    logger.error('Failed to serve OpenAPI spec', error);
    res.status(500).json({
      error: { message: 'API documentation unavailable', code: 'DOCS_UNAVAILABLE' },
    });
  }
});

export { router as docsRoutes };
