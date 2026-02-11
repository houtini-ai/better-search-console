#!/usr/bin/env node

import { createServer } from './server.js';

const { run } = createServer();

run().catch((error) => {
  console.error('[BSC] Fatal error:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  process.exit(0);
});
