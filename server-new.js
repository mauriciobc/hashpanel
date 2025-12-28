#!/usr/bin/env node

import { webServer } from './src/server/index.js';

// Start web server
webServer.start().catch(error => {
  console.error('Server failed to start:', error);
  process.exit(1);
});