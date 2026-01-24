#!/usr/bin/env node

import { webServer } from './src/server/index.js';
import { sendTelemetry } from './src/utils/telemetry.js';

// Send startup telemetry
sendTelemetry({
  location: 'server-new.js:startup',
  message: 'Server startup initiated',
  data: { timestamp: Date.now() },
  hypothesisId: 'A'
});

// Start web server
webServer.start().catch(error => {
  sendTelemetry({
    location: 'server-new.js:startup_fail',
    message: 'Server startup failed',
    data: { error: error.message, code: error.code, stack: error.stack },
    hypothesisId: 'A'
  });
  console.error('Server failed to start:', error);
  process.exit(1);
});