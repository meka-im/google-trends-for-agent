#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './mcp.js';
try {
  // Let read-only installs keep caches/charts outside the current working directory.
  await createServer({
    ...(process.env.GTFA_SNAPSHOT_DIR ? { snapshotDir: process.env.GTFA_SNAPSHOT_DIR } : {}),
    ...(process.env.GTFA_CHART_DIR ? { chartDir: process.env.GTFA_CHART_DIR } : {}),
  }).connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : 'MCP server failed');
  process.exitCode = 1;
}
