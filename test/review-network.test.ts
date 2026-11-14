import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { batchTrends, queryTrends, type TrendsResponse } from '../src/api.js';
import { runAskCli } from '../src/ask-cli.js';
import { runSnapshotCli } from '../src/snapshot-cli.js';
import { createActorRelayTransport } from '../src/apify-actor.js';
import { testConnection } from '../src/dsh-routes.js';
import { createTools } from '../src/tools.js';
import type { fetchTrending } from '../src/trending.js';
import type { Transport } from '../src/transport.js';

const TOKEN = 'apify_api_review_secret';
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function localResponse(body = '', status = 200, headers: Record<string, string> = {}) {
  return { body, status, headers };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function okResponse(input: unknown): TrendsResponse {
  const row = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const queries = Array.isArray(row.queries) ? row.queries : ['term'];
  const width = Math.max(1, queries.length);
  const dataTypes = Array.isArray(row.dataTypes) ? row.dataTypes : [];
  const timeline = Array.from({ length: 14 }, (_, index) => {
    const value = 20 + index;
    return {
      time: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      formattedTime: `Jan ${index + 1}`,
      values: Array.from({ length: width }, () => value),
      formattedValues: Array.from({ length: width }, () => String(value)),
      hasData: Array.from({ length: width }, () => true),
      isPartial: false,
    };
  });
  const data: Record<string, unknown> = { interestOverTime: { timeline, averages: null } };
  if (dataTypes.includes('relatedQueries')) data.relatedQueries = { top: [], rising: [] };
  if (dataTypes.includes('interestBySubregion')) {
    data.interestBySubregion = { resolution: 'COUNTRY', valueMode: 'RELATIVE', rows: [], omittedNoDataRows: 0 };
  }
  return {
    status: 'ok',
    input: row,
    data,
    meta: { upstreamRequests: 1, durationMs: 0, warnings: [], fetchedAt: new Date().toISOString() },
  };
}

function errorResponse(input: unknown, code: NonNullable<TrendsResponse['error']>['code']): TrendsResponse {
  return {
    status: 'error',
    input,
    error: { code, message: 'timed out' },
    meta: { upstreamRequests: 1, durationMs: 0, warnings: [], fetchedAt: new Date().toISOString() },
  };
}

describe('batch upstream stop behavior', () => {
  it.each([
    ['BLOCKED', localResponse('captcha')],
    ['RATE_LIMITED', localResponse('', 429, { 'retry-after': '7' })],
  ] as const)('stops after %s and preserves the stop code for skipped items', async (code, stopResponse) => {
    const transport = vi.fn<Transport>().mockResolvedValue(stopResponse);
    const batch = await batchTrends([
      { queries: ['first'], maxRetries: 0 },
      { queries: ['second'], maxRetries: 0 },
    ], { transport, minIntervalMs: 0 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(batch.results[0]?.error).toMatchObject({ code, ...(code === 'RATE_LIMITED' ? { retryAfterSec: 7 } : {}) });
    expect(batch.results[1]).toMatchObject({
      error: { code, ...(code === 'RATE_LIMITED' ? { retryAfterSec: 7 } : {}), message: expect.stringContaining('skipped') },
      meta: { upstreamRequests: 0 },
    });
  });

  it('continues after RATE_LIMITED when stopOnBlocked is false', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(localResponse('', 429, { 'retry-after': '7' }));
    await batchTrends([
      { queries: ['first'], maxRetries: 0 },
      { queries: ['second'], maxRetries: 0 },
    ], { transport, minIntervalMs: 0, sleep: async () => {}, stopOnBlocked: false });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe('CLI timeout propagation', () => {
  it('applies --timeout to plain ask, validated term plus anchor, trending, and snapshot primary plus 7d', async () => {
    const seenAsk: unknown[] = [];
    const askQuery = vi.fn<typeof queryTrends>(async input => {
      seenAsk.push(input);
      return okResponse(input);
    });
    const ask = await runAskCli(['Astra', '--json', '--fresh', '--store', tempDir('gtfa-review-ask-'), '--timeout', '1500'], { query: askQuery });
    expect(ask.code).toBe(0);
    expect(seenAsk).toHaveLength(1);
    expect(seenAsk[0]).toMatchObject({ timeoutMs: 1500 });

    const seenValidate: unknown[] = [];
    const validateQuery = vi.fn<typeof queryTrends>(async input => {
      seenValidate.push(input);
      return okResponse(input);
    });
    const trendingTimeouts: Array<number | undefined> = [];
    const trendingFetch = vi.fn<typeof fetchTrending>(async input => ({
      status: 'ok',
      geo: input.geo,
      hours: input.hours ?? 24,
      fetchedAt: new Date().toISOString(),
      items: [],
      meta: { upstreamRequests: 1, durationMs: 0 },
    }));
    trendingFetch.mockImplementation(async input => ({
      status: 'ok',
      geo: input.geo,
      hours: input.hours ?? 24,
      fetchedAt: new Date().toISOString(),
      items: [],
      meta: { upstreamRequests: 1, durationMs: 0 },
    }));
    const validate = await runAskCli([
      'Astra', '--validate', '--trending', '--json', '--fresh', '--store', tempDir('gtfa-review-validate-'), '--timeout', '2500',
    ], {
      query: validateQuery,
      trendingFetch: async (input, options) => {
        trendingTimeouts.push(options?.timeoutMs);
        return trendingFetch(input, options);
      },
      baselines: { version: 2, anchors: [] },
    });
    expect(validate.code).toBe(0);
    expect(seenValidate).toHaveLength(2);
    expect(seenValidate.every(input => (input as { timeoutMs?: number }).timeoutMs === 2500)).toBe(true);
    expect(trendingTimeouts).toContain(2500);

    const seenSnapshot: unknown[] = [];
    const snapshotQuery = vi.fn<typeof queryTrends>(async input => {
      seenSnapshot.push(input);
      return okResponse(input);
    });
    const snapshot = await runSnapshotCli([
      'Astra', '--json', '--fresh', '--store', tempDir('gtfa-review-snapshot-'), '--timeout', '3500',
    ], {
      query: snapshotQuery,
      baselines: { version: 2, anchors: [] },
      chartDir: null,
    });
    expect(snapshot.code).toBe(0);
    expect(seenSnapshot).toHaveLength(2);
    expect(seenSnapshot.every(input => (input as { timeoutMs?: number }).timeoutMs === 3500)).toBe(true);
  });

  it('keeps help usable without a timeout value and rejects invalid values as code 4', async () => {
    expect((await runAskCli(['Astra', '--help', '--timeout', 'not-a-number', '--json'])).code).toBe(0);
    expect((await runSnapshotCli(['Astra', '--help', '--timeout', '999', '--json'])).code).toBe(0);
    expect((await runAskCli(['Astra', '--timeout', '999'])).code).toBe(4);
    expect((await runAskCli(['Astra', '--timeout', '60001'])).code).toBe(4);
    expect((await runSnapshotCli(['Astra', '--timeout', '1.5'])).code).toBe(4);
  });

  it('keeps upstream TRENDS_TIMEOUT results at exit code 1', async () => {
    const timeoutQuery = vi.fn<typeof queryTrends>(async input => errorResponse(input, 'TRENDS_TIMEOUT'));
    expect((await runAskCli([
      'Astra', '--json', '--fresh', '--store', tempDir('gtfa-review-ask-timeout-'),
    ], { query: timeoutQuery })).code).toBe(1);
    const snapshot = await runSnapshotCli([
      'Astra', '--json', '--fresh', '--store', tempDir('gtfa-review-snapshot-timeout-'),
    ], { query: timeoutQuery, baselines: { version: 2, anchors: [] }, chartDir: null });
    expect(snapshot.code).toBe(1);
    expect(JSON.parse(snapshot.stdout)).toMatchObject({ error: { code: 'TRENDS_TIMEOUT' } });
  });
});

describe('tool descriptions and country normalization', () => {
  it('describes only public ask fields and normalizes compare geo', async () => {
    const fixture: Transport = async req => req.method === 'HEAD'
      ? localResponse()
      : localResponse(readFileSync(new URL('./fixtures/explore-single-world.txt', import.meta.url), 'utf8'));
    const tools = createTools({ transport: fixture, minIntervalMs: 0 });
    const ask = tools.find(tool => tool.name === 'trends_ask')!;
    const snapshot = tools.find(tool => tool.name === 'trends_snapshot')!;
    const compare = tools.find(tool => tool.name === 'trends_compare')!;
    expect(ask.description).not.toContain('estDaily');
    expect(snapshot.description).toContain('related-query estDaily is always null');
    expect(snapshot.description).toContain('BLOCKED/RATE_LIMITED primary skips the extra now 7-d fetch');
    expect(compare.description).not.toMatch(/calibration baselines|estDaily/);

    const result = await compare.execute({ keywords: ['coffee'], geo: ' us ' });
    expect(result).toMatchObject({ filter: { geo: 'US', time: 'now 1-d' } });
  });
});

describe('Actor relay cancellation', () => {
  const request = {
    url: 'https://trends.google.com/trends/',
    method: 'HEAD',
    headers: {},
    timeoutMs: 5000,
  };

  it('aborts a waiting Standby URL resolver promptly and can retry', async () => {
    const controller = new AbortController();
    let resolverSignal: AbortSignal | undefined;
    let attempt = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/health')
      ? json({ ok: true, version: '0.1.0', relay: 1 })
      : json({ status: 200, headers: {}, body: '' }));
    const transport = createActorRelayTransport({
      token: TOKEN,
      actorId: 'a1',
      fetch: fetchMock as unknown as typeof fetch,
      resolveStandbyUrl: async (_token, _actorId, options) => {
        attempt += 1;
        resolverSignal = options?.signal;
        if (attempt === 1) {
          return new Promise<string>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
          });
        }
        return 'https://actor.test';
      },
    });
    const pending = transport({ ...request, signal: controller.signal });
    await vi.waitFor(() => expect(resolverSignal).toBeDefined());
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'cancelled' });
    expect(resolverSignal?.aborted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(transport(request)).resolves.toMatchObject({ status: 200 });
    expect(attempt).toBe(2);
  });

  it('aborts the health fetch signal and retries after the caller cancels', async () => {
    const controller = new AbortController();
    let healthSignal: AbortSignal | undefined;
    let healthAttempts = 0;
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/health')) {
        healthAttempts += 1;
        if (healthAttempts === 1) {
          healthSignal = init?.signal ?? undefined;
          return new Promise<Response>((_resolve, reject) => {
            healthSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
          });
        }
        return Promise.resolve(json({ ok: true, version: '0.1.0', relay: 1 }));
      }
      return Promise.resolve(json({ status: 200, headers: {}, body: '' }));
    });
    const transport = createActorRelayTransport({
      token: TOKEN,
      actorId: 'a1',
      fetch: fetchMock as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test',
    });
    const pending = transport({ ...request, signal: controller.signal });
    await vi.waitFor(() => expect(healthSignal).toBeDefined());
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'cancelled' });
    expect(healthSignal?.aborted).toBe(true);
    await expect(transport(request)).resolves.toMatchObject({ status: 200 });
    expect(healthAttempts).toBe(2);
  });

  it('lets a concurrent health check succeed when another caller cancels', async () => {
    const first = new AbortController();
    const second = new AbortController();
    const responses: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      responses.push(resolve);
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const transport = createActorRelayTransport({
      token: TOKEN,
      actorId: 'a1',
      fetch: fetchMock as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test',
    });
    const firstCall = transport.checkHealth(first.signal);
    const secondCall = transport.checkHealth(second.signal);
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    first.abort(new Error('first cancelled'));
    await expect(firstCall).rejects.toMatchObject({ name: 'AbortError' });
    responses[1]!(json({ ok: true, version: '0.1.0', relay: 1 }));
    await expect(secondCall).resolves.toBeUndefined();
    await expect(transport.checkHealth()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('passes the caller signal into dsh testConnection health checks', async () => {
    const controller = new AbortController();
    let healthSignal: AbortSignal | undefined;
    const relay = Object.assign(async () => ({ status: 200, headers: {}, body: '' }), {
      checkHealth: async (signal?: AbortSignal) => {
        healthSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
        });
      },
    });
    const pending = testConnection({
      egress: 'actor-own',
      apifyToken: TOKEN,
      apifyActor: 'a1',
      signal: controller.signal,
      relayTransport: () => relay,
    });
    await vi.waitFor(() => expect(healthSignal).toBeDefined());
    expect(healthSignal).toBe(controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
