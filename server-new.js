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
webServer.start().catch(async error => {
  try {
    await sendTelemetry({
      location: 'server-new.js:startup_fail',
      message: 'Server startup failed',
      data: { error: error.message, code: error.code },
      hypothesisId: 'A'
    });
  } catch (telemetryError) {
    // Ignore telemetry errors to ensure process can exit
  } finally {
    console.error('Server failed to start:', error);
    process.exit(1);
  }
});