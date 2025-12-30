#!/usr/bin/env node

import { webServer } from './src/server/index.js';

// #region agent log
fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server-new.js:6',message:'Server startup initiated',data:{timestamp:Date.now()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
// #endregion

// Start web server
webServer.start().catch(error => {
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/f426892d-b7cd-4420-929c-80542dc01840',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server-new.js:10',message:'Server startup failed',data:{error:error.message,code:error.code,stack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  console.error('Server failed to start:', error);
  process.exit(1);
});