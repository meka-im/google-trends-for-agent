#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './mcp.js';
import { DEFAULT_HTTP_PORT, parsePort, startHttpMcpServer } from './http.js';
import { loadBaselinesFromEnv, type Baselines } from './traffic.js';
import { createMekaBaselinesSync } from './dsh-baselines-sync.js';
import { resolveEgress } from './options.js';

const args = process.argv.slice(2);
const valueAfter = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

let baselines: Baselines | undefined;
const snapshotDir = process.env.GTFA_SNAPSHOT_DIR?.trim() || '.gtfa/snapshots';
const rawEgress = valueAfter('--egress') ?? process.env.GTFA_EGRESS;
const { egress } = resolveEgress(rawEgress);
const apifyActor = (valueAfter('--actor') ?? process.env.GTFA_APIFY_ACTOR ?? process.env.APIFY_ACTOR)?.trim() || undefined;

const serverOptions = () => ({
  ...(baselines ? { baselines } : {}),
  ...(egress !== 'local' ? { egress } : {}),
  ...(apifyActor ? { apifyActor } : {}),
  // Let read-only installs keep caches/charts outside the current working directory.
  ...(process.env.GTFA_SNAPSHOT_DIR ? { snapshotDir: process.env.GTFA_SNAPSHOT_DIR } : {}),
  ...(process.env.GTFA_CHART_DIR ? { chartDir: process.env.GTFA_CHART_DIR } : {}),
});

try {
  baselines = await loadBaselinesFromEnv();
  // Sync MEKA baselines once on initial install when no local cache exists yet; subsequent runs read disk cache only.
  createMekaBaselinesSync({ getSnapshotDir: () => snapshotDir }).ensureInitialSync();
  if (args.includes('--http')) {
    const port = parsePort(valueAfter('--port') ?? process.env.PORT ?? undefined, DEFAULT_HTTP_PORT);
    const http = await startHttpMcpServer({
      port,
      host: '127.0.0.1',
      mode: 'local',
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
