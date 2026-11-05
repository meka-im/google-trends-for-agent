#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './mcp.js';
import { DEFAULT_HTTP_PORT, parsePort, startHttpMcpServer } from './http.js';

const args = process.argv.slice(2);
const valueAfter = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const serverOptions = () => ({
  // Let read-only installs keep caches/charts outside the current working directory.
  ...(process.env.GTFA_SNAPSHOT_DIR ? { snapshotDir: process.env.GTFA_SNAPSHOT_DIR } : {}),
  ...(process.env.GTFA_CHART_DIR ? { chartDir: process.env.GTFA_CHART_DIR } : {}),
});

try {
  if (args.includes('--http')) {
    const port = parsePort(valueAfter('--port') ?? process.env.PORT ?? undefined, DEFAULT_HTTP_PORT);
    const http = await startHttpMcpServer({
      port,
      host: '127.0.0.1',
      path: '/mcp',
      createMcpServer: () => createServer(serverOptions()),
      log: message => console.error(message),
    });
    console.error('Streamable HTTP MCP is local-only (127.0.0.1). Use the Apify Actor for remote agents.');
    const shutdown = async () => { await http.close(); };
    process.once('SIGTERM', () => { void shutdown(); });
    process.once('SIGINT', () => { void shutdown(); });
  } else {
    await createServer(serverOptions()).connect(new StdioServerTransport());
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'MCP server failed');
  process.exitCode = 1;
}
