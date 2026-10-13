#!/usr/bin/env node

import { webServer } from './index.js';
import { logger } from '../utils/logger.js';

// Start web server
webServer.start().catch(async error => {
  logger.error('Server failed to start', error);
  process.exit(1);
});
