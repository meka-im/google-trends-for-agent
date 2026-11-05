import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetch as realFetch } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../src/mcp.js';
import { parsePort, resolveStandbyPort, startHttpMcpServer, type HttpMcpServer } from '../src/http.js';
import type { Transport } from '../src/transport.js';

// test/setup.ts blocks global fetch; the SDK client needs real localhost HTTP.
vi.stubGlobal('fetch', realFetch);

const sgBody = readFileSync(new URL('./fixtures/trending/SG-24.txt', import.meta.url), 'utf8');
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start(transport?: Transport): Promise<{ http: HttpMcpServer; snapshotDir: string }> {
  const snapshotDir = mkdtempSync(join(tmpdir(), 'gtfa-http-'));
  const http = await startHttpMcpServer({
    port: 0,
    createMcpServer: () => createServer({
      snapshotDir,
      minIntervalMs: 0,
      transport: transport ?? (async req => req.method === 'HEAD'
        ? { status: 200, headers: {}, body: '' }
        : { status: 200, headers: {}, body: sgBody }),
    }),
  });
  cleanups.push(async () => { await http.close(); rmSync(snapshotDir, { recursive: true, force: true }); });
  return { http, snapshotDir };
}

describe('Streamable HTTP MCP transport', () => {
  it('serves initialize and tools/list over HTTP, then calls a tool', async () => {
    const { http } = await start();
    const client = new Client({ name: 'http-test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(http.url), {
      requestInit: { headers: { Authorization: 'Bearer test-token' } },
    });
    cleanups.push(() => client.close());
    await client.connect(transport);

    expect(transport.sessionId).toBeTruthy();
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['trends_ask', 'trends_compare', 'trends_now', 'trends_snapshot'].sort());

    const result = await client.callTool({ name: 'trends_now', arguments: { geos: ['SG'], limit: 1 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: true, status: 'ok', geos: ['SG'], summary: { geos: 1, ok: 1, failed: 0 } });
  });

  it('returns 200 on GET / readiness, including the Apify probe header', async () => {
    const { http } = await start();
    const ready = await realFetch(`http://127.0.0.1:${http.port}/`);
    expect(ready.status).toBe(200);
    expect(await ready.text()).toContain('ready');

    const probe = await realFetch(`http://127.0.0.1:${http.port}/`, { headers: { 'x-apify-container-server-readiness-probe': '1' } });
    expect(probe.status).toBe(200);
    expect(await probe.text()).toContain('Readiness probe OK');
  });

  it('rejects an unknown session and non-MCP paths', async () => {
    const { http } = await start();
    const unknown = await realFetch(`http://127.0.0.1:${http.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'missing', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(unknown.status).toBe(404);

    const missing = await realFetch(`http://127.0.0.1:${http.port}/other`);
    expect(missing.status).toBe(404);
  });
});

describe('HTTP port resolution', () => {
  it('prefers ACTOR_STANDBY_PORT, then ACTOR_WEB_SERVER_PORT, then 4321', () => {
    expect(resolveStandbyPort({ ACTOR_STANDBY_PORT: '4567', ACTOR_WEB_SERVER_PORT: '5678' })).toBe(4567);
    expect(resolveStandbyPort({ ACTOR_WEB_SERVER_PORT: '5678' })).toBe(5678);
    expect(resolveStandbyPort({})).toBe(4321);
    expect(parsePort(undefined)).toBe(4321);
    expect(() => parsePort('abc')).toThrow(/Invalid port/);
    expect(() => parsePort('-1')).toThrow(/Invalid port/);
  });
});
