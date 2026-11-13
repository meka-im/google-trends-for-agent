import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { fetch as realFetch } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../src/mcp.js';
import { IdleExitController, isStandbyRun, parsePort, resolveStandbyPort, startHttpMcpServer, type HttpMcpServer, type IdleExitOptions } from '../src/http.js';
import type { GtfaTool } from '../src/tools.js';
import type { Transport } from '../src/transport.js';

// test/setup.ts blocks global fetch; the SDK client needs real localhost HTTP.
vi.stubGlobal('fetch', realFetch);

const sgBody = readFileSync(new URL('./fixtures/trending/SG-24.html', import.meta.url), 'utf8');
function rawGet(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers, setHost: false }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start(
  transport?: Transport,
  extra: { tools?: GtfaTool[]; version?: string; idleExit?: IdleExitOptions; log?: (message: string) => void; mode?: 'local' | 'standby'; deadlineMs?: number } = {},
): Promise<{ http: HttpMcpServer; snapshotDir: string }> {
  const snapshotDir = mkdtempSync(join(tmpdir(), 'gtfa-http-'));
  const effective = transport ?? (async req => req.method === 'HEAD'
    ? { status: 200, headers: {}, body: '' }
    : { status: 200, headers: {}, body: sgBody });
  const http = await startHttpMcpServer({
    port: 0,
    transport: effective,
    ...(extra.tools ? { tools: extra.tools } : {}),
    ...(extra.version ? { version: extra.version } : {}),
    ...(extra.mode ? { mode: extra.mode } : {}),
    ...(extra.deadlineMs ? { deadlineMs: extra.deadlineMs } : {}),
    ...(extra.idleExit ? { idleExit: extra.idleExit } : {}),
    ...(extra.log ? { log: extra.log } : {}),
    createMcpServer: () => createServer({
      snapshotDir,
      minIntervalMs: 0,
      transport: effective,
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

  it('serves GET /health as cheap JSON without calling Google', async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 200, headers: {}, body: '' }));
    const { http } = await start(transport, { version: '9.9.9' });
    const response = await realFetch(`http://127.0.0.1:${http.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: '9.9.9', relay: 1 });
    expect(transport).not.toHaveBeenCalled();
  });

  it('adds ACTOR_BUILD_NUMBER to /health only when set', async () => {
    vi.stubEnv('ACTOR_BUILD_NUMBER', '42');
    const { http } = await start();
    const health = await (await realFetch(`http://127.0.0.1:${http.port}/health`)).json() as Record<string, unknown>;
    expect(health).toMatchObject({ ok: true, relay: 1, build: '42' });
    expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('allows loopback Host/Origin and rejects foreign Host or Origin without wildcard CORS', async () => {
    const { http } = await start();
    const base = `http://127.0.0.1:${http.port}`;
    const ok = await realFetch(`${base}/health`, { headers: { origin: 'http://localhost:5173' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBeNull();

    const foreignHost = await rawGet(http.port, '/health', { host: 'evil.test' });
    expect(foreignHost.status).toBe(403);
    expect(JSON.parse(foreignHost.body)).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const foreignOrigin = await realFetch(`${base}/health`, { headers: { origin: 'https://evil.test' } });
    expect(foreignOrigin.status).toBe(403);
    expect(await foreignOrigin.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(foreignOrigin.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('trusts Apify proxy Host and Origin in standby mode', async () => {
    const { http } = await start(undefined, { mode: 'standby' });
    const ready = await realFetch(`http://127.0.0.1:${http.port}/health`, {
      headers: { host: 'meka-im--google-trends-for-agent.apify.actor', origin: 'https://console.apify.com' },
    });
    expect(ready.status).toBe(200);
  });

  it('relays only https://trends.google.com requests and passes the response through', async () => {
    const calls: { url: string; method?: string; timeoutMs: number }[] = [];
    const seenHeaders: Record<string, string>[] = [];
    const transport = vi.fn<Transport>(async request => {
      seenHeaders.push(request.headers);
      calls.push({ url: request.url, method: request.method, timeoutMs: request.timeoutMs });
      return { status: 200, headers: { 'x-actor': 'yes' }, body: '<html>relayed</html>' };
    });
    const logs: string[] = [];
    const { http } = await start(transport, { log: message => logs.push(message) });
    const relay = (body: unknown) => realFetch(`http://127.0.0.1:${http.port}/egress/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    for (const url of ['https://evil.test/steal', 'http://trends.google.com/trends/', 'https://trends.google.com.evil.test/', 'https://trends.google.com:8443/trends/', 'https://u:p@trends.google.com/']) {
      const rejected = await relay({ url, headers: {}, timeoutMs: 5000 });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({ error: { code: 'INVALID_INPUT', message: expect.any(String) } });
    }
    expect(transport).not.toHaveBeenCalled();

    const accepted = await relay({
      url: 'https://trends.google.com/trends/api/explore?hl=en-US&q=secret',
      method: 'GET',
      headers: { accept: 'application/json', 'x-secret': 'do-not-log', Host: 'evil.test', 'proxy-authorization': 'x', connection: 'close' },
      timeoutMs: 999_999,
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({
      status: 200,
      headers: { 'x-actor': 'yes' },
      body: '<html>relayed</html>',
    });
    expect(calls).toEqual([{ url: 'https://trends.google.com/trends/api/explore?hl=en-US&q=secret', method: 'GET', timeoutMs: 60_000 }]);
    expect(seenHeaders).toEqual([{ accept: 'application/json' }]);
    expect(logs.join('\n')).toContain('Relay GET /trends/api/explore');
    for (const secret of ['hl=en-US', 'q=secret', 'do-not-log', '<html>relayed</html>']) {
      expect(logs.join('\n')).not.toContain(secret);
    }
  });

  it('retries a failed relay once, then answers 502 without the error text', async () => {
    let calls = 0;
    let alwaysFail = false;
    const flaky: Transport = async () => {
      calls += 1;
      if (alwaysFail || calls === 1) throw new TypeError('proxy secret-detail');
      return { status: 200, headers: {}, body: 'ok' };
    };
    const logs: string[] = [];
    const { http } = await start(flaky, { log: message => logs.push(message) });
    const relay = () => realFetch(`http://127.0.0.1:${http.port}/egress/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://trends.google.com/trends/', method: 'HEAD', headers: {} }),
    });
    const ok = await relay();
    expect(ok.status).toBe(200);
    expect(calls).toBe(2);

    alwaysFail = true;
    const failed = await relay();
    expect(failed.status).toBe(502);
    expect(calls).toBe(4);
    expect(logs.join('\n')).toContain('failed (attempt 2, TypeError)');
    expect(logs.join('\n')).not.toContain('secret-detail');
  });

  it('runs shared tool definitions at POST /tools/{name}', async () => {
    const tool = {
      name: 'trends_now',
      description: 'test',
      inputSchema: {},
      execute: vi.fn(async (input: unknown) => ({ ok: true, status: 'ok', received: input })),
    } as unknown as GtfaTool;
    const failing = {
      name: 'trends_ask',
      description: 'test',
      inputSchema: {},
      execute: vi.fn(async () => ({ ok: false, error: { code: 'INVALID_INPUT', message: 'bad input' } })),
    } as unknown as GtfaTool;
    const { http } = await start(undefined, { tools: [tool, failing] });
    const call = (name: string) => realFetch(`http://127.0.0.1:${http.port}/tools/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ geos: ['US'] }),
    });

    const ok = await call('trends_now');
    expect(await ok.json()).toEqual({ ok: true, result: { ok: true, status: 'ok', received: { geos: ['US'] } } });
    const bad = await call('trends_ask');
    expect(await bad.json()).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'bad input' } });

    const missing = await call('nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: 'INVALID_INPUT', message: expect.stringContaining('Unknown tool') } });
  });

  it('aborts a /tools call when the client disconnects', async () => {
    let signal: AbortSignal | undefined;
    const tool = {
      name: 'trends_now',
      description: 'test',
      inputSchema: {},
      execute: async (_input: unknown, context?: { signal?: AbortSignal }) => {
        signal = context?.signal;
        await new Promise((_resolve, reject) => context!.signal!.addEventListener('abort', () => {
          const error = new Error('client disconnected');
          error.name = 'AbortError';
          reject(error);
        }));
        return { ok: true };
      },
    } as unknown as GtfaTool;
    const { http } = await start(undefined, { tools: [tool] });
    const controller = new AbortController();
    const pending = realFetch(`http://127.0.0.1:${http.port}/tools/trends_now`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ geos: ['US'] }),
      signal: controller.signal,
    }).catch(() => undefined);
    await vi.waitFor(() => expect(signal).toBeDefined());
    controller.abort();
    await pending;
    await vi.waitFor(() => expect(signal!.aborted).toBe(true));
  });

  it('aborts an /mcp tool call at the configured deadline', async () => {
    let signal: AbortSignal | undefined;
    const hanging: Transport = async req => new Promise((_resolve, reject) => {
      signal = req.signal;
      req.signal?.addEventListener('abort', () => {
        const error = new Error('deadline');
        error.name = 'AbortError';
        reject(error);
      });
    });
    const { http } = await start(hanging, { deadlineMs: 50 });
    const client = new Client({ name: 'deadline-test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(http.url));
    cleanups.push(() => client.close());
    await client.connect(transport);
    await client.callTool({ name: 'trends_now', arguments: { geos: ['US'] } }).catch(() => undefined);
    expect(signal?.aborted).toBe(true);
  });

  it('aborts a /tools call at the configured deadline', async () => {
    const tool = {
      name: 'trends_now',
      description: 'test',
      inputSchema: {},
      execute: async (_input: unknown, context?: { signal?: AbortSignal }) => {
        await new Promise((_resolve, reject) => context!.signal!.addEventListener('abort', () => {
          const error = new Error('deadline');
          error.name = 'AbortError';
          reject(error);
        }));
        return { ok: true };
      },
    } as unknown as GtfaTool;
    const { http } = await start(undefined, { tools: [tool], deadlineMs: 20 });
    const response = await realFetch(`http://127.0.0.1:${http.port}/tools/trends_now`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ geos: ['US'] }),
    });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: { code: 'TRENDS_TIMEOUT' } });
  });

  it('exits Standby after the idle window with no in-flight requests', () => {
    let now = 0;
    let queued: (() => void) | undefined;
    const exit = vi.fn();
    const log = vi.fn();
    const idle = new IdleExitController({
      enabled: true,
      timeoutMs: 100,
      now: () => now,
      schedule: callback => { queued = callback; return 1; },
      cancel: () => { queued = undefined; },
      exit,
      log,
    });
    idle.start();
    expect(queued).toBeTypeOf('function');
    now = 40;
    idle.enter();
    expect(queued).toBeUndefined();
    now = 80;
    idle.leave();
    expect(queued).toBeTypeOf('function');
    now = 120;
    queued!();
    expect(exit).not.toHaveBeenCalled();
    now = 200;
    queued!();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/No requests for .*exiting the Standby Actor/));
    idle.stop();
  });

  it('wires the idle exit controller into the HTTP server', async () => {
    let now = 0;
    let queued: (() => void) | undefined;
    const exit = vi.fn();
    const { http } = await start(undefined, {
      idleExit: {
        enabled: true,
        timeoutMs: 100,
        now: () => now,
        schedule: callback => { queued = callback; return 1; },
        cancel: () => { queued = undefined; },
        exit,
        log: () => {},
      },
    });
    expect(http.port).toBeGreaterThan(0);
    expect(queued).toBeTypeOf('function');
    now = 200;
    queued!();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('ignores readiness probes and keeps a request in flight until its handler finishes', async () => {
    const harness = async (transport?: Transport) => {
      const state = { now: 0, queued: undefined as (() => void) | undefined, exit: vi.fn() };
      const { http } = await start(transport, {
        idleExit: {
          enabled: true,
          timeoutMs: 100,
          now: () => state.now,
          schedule: callback => { state.queued = callback; return 1; },
          cancel: () => { state.queued = undefined; },
          exit: state.exit,
          log: () => {},
        },
      });
      return { ...state, state, base: `http://127.0.0.1:${http.port}` };
    };

    const probed = await harness();
    const probe = await realFetch(`${probed.base}/`, { headers: { 'x-apify-container-server-readiness-probe': '1' } });
    expect(probe.status).toBe(200);
    probed.state.now = 200;
    probed.state.queued!();
    expect(probed.state.exit).toHaveBeenCalledTimes(1);

    let finish: (() => void) | undefined;
    const slow = await harness(async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      return { status: 200, headers: {}, body: 'ok' };
    });
    const controller = new AbortController();
    const pending = realFetch(`${slow.base}/egress/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://trends.google.com/trends/', headers: {} }),
      signal: controller.signal,
    }).catch(() => undefined);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    await pending;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(slow.state.queued).toBeUndefined();
    finish!();
    await vi.waitFor(() => expect(slow.state.queued).toBeTypeOf('function'));
    slow.state.now = 1000;
    slow.state.queued!();
    expect(slow.state.exit).toHaveBeenCalledTimes(1);
  });

  it('does not schedule an exit when idle exit is disabled', () => {
    const exit = vi.fn();
    const schedule = vi.fn();
    const idle = new IdleExitController({ enabled: false, timeoutMs: 100, exit, schedule });
    idle.start();
    idle.leave();
    expect(schedule).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
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

describe('run mode', () => {
  it('treats only APIFY_META_ORIGIN=STANDBY as a Standby run', () => {
    expect(isStandbyRun({ APIFY_META_ORIGIN: 'STANDBY' })).toBe(true);
    expect(isStandbyRun({ APIFY_META_ORIGIN: 'API', ACTOR_STANDBY_PORT: '4321' })).toBe(false);
    expect(isStandbyRun({})).toBe(false);
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
