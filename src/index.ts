#!/usr/bin/env node

import { createServer } from './server.js';

const { run } = createServer();

run().catch((error) => {
  console.error('[BSC] Fatal error:', error);
  process.exit(1);
});

function shutdown() {
  console.error('[BSC] Shutting down gracefully...');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
