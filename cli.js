#!/usr/bin/env node

import { runCLI } from './src/cli/index.js';

// Run the CLI application
runCLI().catch(error => {
  console.error('CLI failed to start:', error);
  process.exit(1);
});