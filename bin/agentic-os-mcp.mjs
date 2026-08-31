#!/usr/bin/env node

import { serveStdio } from '../src/mcp-stdio.mjs';

try {
  await serveStdio();
} catch (error) {
  process.stderr.write(`agentic-os-mcp: ${error.message}\n`);
  process.exitCode = 1;
}
