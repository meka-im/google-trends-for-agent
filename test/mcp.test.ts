import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/mcp.js';
import { VERSION } from '../src/version.js';
import { TRENDING_GEOS } from '../src/geos.js';
import { askEnvelope, compareEnvelope, blockedVerdict, SCHEMA_VERSION } from '../src/tools.js';
import type { TermSnapshot } from '../src/snapshot.js';
import type { Transport } from '../src/transport.js';
const body = readFileSync(new URL('./fixtures/trending/SG-24.html', import.meta.url), 'utf8');
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function connect(transport: Transport = async () => ({ status: 200, headers: {}, body }), extras: { snapshotDir?: string } = {}) {
  const server = createServer({ transport, minIntervalMs: 0, ...extras });
  const client = new Client({ name: 'offline-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  cleanups.push(async () => { await client.close(); await server.close(); });
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}
describe('MCP offline', () => {
  it('registers only the four primary tools by default', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['trends_ask', 'trends_compare', 'trends_now', 'trends_snapshot'].sort());
  });
  it('exposes only the slim input schemas', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const props = Object.fromEntries(tools.map(t => [t.name, Object.keys((t.inputSchema as { properties: object }).properties).sort()]));
    expect(props).toEqual({ trends_ask: ['fresh', 'geo', 'points', 'term', 'time', 'validate'], trends_compare: ['geo', 'keywords', 'time'], trends_now: ['geos', 'hours', 'limit'], trends_snapshot: ['anchor', 'fresh', 'geo', 'svg', 'term', 'time', 'tz'] });
    for (const t of tools) expect(t.description).toMatch(/Output: ok, schemaVersion/);
    expect(tools.find(t => t.name === 'trends_now')!.description).toMatch(/Supported geos: .*SG/);
    const compare = tools.find(t => t.name === 'trends_compare')!;
    expect((compare.inputSchema.properties as Record<string, unknown>).keywords).toMatchObject({ minItems: 1, maxItems: 5 });
  });
  it('trends_compare defaults to US and now 1-d', async () => {
    const urls: string[] = [];
    const client = await connect(async req => { urls.push(req.url); return req.method === 'HEAD' ? { status: 200, headers: { 'set-cookie': 'NID=x; Path=/' }, body: '' } : { status: 500, headers: {}, body: '' }; });
    const r = await client.callTool({ name: 'trends_compare', arguments: { keywords: ['a', 'b'] } });
    expect(r.structuredContent).toMatchObject({ ok: false, schemaVersion: SCHEMA_VERSION, filter: { geo: 'US', time: 'now 1-d' }, series: [{ keyword: 'a', points: [] }, { keyword: 'b', points: [] }] });
    const explore = decodeURIComponent(urls.find(u => u.includes('/api/explore'))!);
    expect(explore).toContain('{"keyword":"a","geo":"US","time":"now 1-d"}');
    expect(explore).toContain('"category":0,"property":""');
  });
  it('reports the package version in serverInfo', async () => {
    const client = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: 'google-trends-for-agent', version: VERSION });
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
  it('propagates MCP cancellation to the tool fetch signal', async () => {
    let signal: AbortSignal | undefined;
    const hanging: Transport = async req => new Promise((_resolve, reject) => {
      signal = req.signal;
      req.signal?.addEventListener('abort', () => {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        reject(error);
      });
    });
    const client = await connect(hanging);
    const controller = new AbortController();
    const pending = client.callTool({ name: 'trends_now', arguments: { geos: ['US'] } }, undefined, { signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(signal).toBeDefined());
    controller.abort();
    await pending;
    await vi.waitFor(() => expect(signal!.aborted).toBe(true));
  });
  it('every tool carries the light-use guidance', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    for (const tool of tools) expect(tool.description).toMatch(/Light use.*BLOCKED.*RATE_LIMITED.*retryAfterSec/);
  });
  it('returns SG fixture items in the trends_now envelope', async () => {
    const client = await connect();
    const r = await client.callTool({ name: 'trends_now', arguments: { geos: ['SG'], limit: 20 } });
    expect(r.isError).not.toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: true, schemaVersion: SCHEMA_VERSION, status: 'ok', hours: 24, geos: ['SG'], summary: { geos: 1, ok: 1, failed: 0 } });
    const sg = (r.structuredContent!.byGeo as { geo: string; ok: boolean; items: Record<string, unknown>[] }[])[0];
    expect(sg.geo).toBe('SG'); expect(sg.items.length).toBe(3);
    expect(Object.keys(sg.items[0]).sort()).toEqual(['active', 'categories', 'endedAt', 'growthPct', 'link', 'newsCount', 'query', 'rank', 'relatedQueries', 'startedAt', 'title', 'traffic', 'trafficLabel'].sort());
    expect(JSON.parse((r.content as { text: string }[])[0].text)).toEqual(r.structuredContent);
  });
  it('supports per-geo list defaults', async () => {
    const client = await connect();
    const batch = await client.callTool({ name: 'trends_now', arguments: { geos: 'default', limit: 1 } });
    expect(batch.structuredContent).toMatchObject({ ok: true, status: 'ok', summary: { geos: 30, ok: 30, failed: 0 } });
    expect((batch.structuredContent!.byGeo as { items: unknown[] }[]).every(r => r.items.length === 1)).toBe(true);
  });
  it('rejects invalid queries without HTTP' , async () => {
    const transport = vi.fn<Transport>();
    const client = await connect(transport);
    for (const keywords of [[], ['a', 'b', 'c', 'd', 'e', 'f'], [42, 43]]) {
      const bad = await client.callTool({ name: 'trends_compare', arguments: { keywords } });
      expect(bad.isError).toBe(true);
      expect(bad.structuredContent).toMatchObject({ ok: false, schemaVersion: SCHEMA_VERSION, status: 'error', error: { code: 'INVALID_INPUT' } });
    }
    // Semantic validation also returns the structured API error envelope.
    const r = await client.callTool({ name: 'trends_compare', arguments: { keywords: ['x', 'y'], geo: 'ZZ' } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, status: 'error', error: { code: 'INVALID_INPUT' } });
    expect(transport).not.toHaveBeenCalled();
  });
  it('uppercases and dedupes geos, and rejects more than 30 explicit geos without HTTP', async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 200, headers: {}, body }));
    const client = await connect(transport);
    const r = await client.callTool({ name: 'trends_now', arguments: { geos: ['sg', 'SG', 'us'], limit: 1 } });
    expect(r.structuredContent).toMatchObject({ ok: true, geos: ['SG', 'US'], summary: { geos: 2, ok: 2, failed: 0 } });
    expect(transport).toHaveBeenCalledTimes(2);
    transport.mockClear();
    const tooMany = await client.callTool({ name: 'trends_now', arguments: { geos: TRENDING_GEOS.slice(0, 31).map(geo => geo.code) } });
    expect(tooMany.isError).toBe(true);
    expect(tooMany.structuredContent).toMatchObject({ ok: false, status: 'error', error: { code: 'INVALID_INPUT', message: expect.stringMatching(/at most 30/) } });
    expect(transport).not.toHaveBeenCalled();
  });
  it('returns upstream errors and stops lists on a block', async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 200, headers: {}, body: 'captcha' }));
    const client = await connect(transport);
    const r = await client.callTool({ name: 'trends_now', arguments: { geos: ['SG', 'US'] } });
    expect(r.isError).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(r.structuredContent).toMatchObject({ ok: false, status: 'error', byGeo: [{ ok: false, error: { code: 'BLOCKED' } }, { ok: false, error: { message: 'skipped after upstream block' } }] });
  });
  it('shares request spacing across query and trending tools', async () => {
    let now = 0;
    const starts: number[] = [];
    const server = createServer({ minIntervalMs: 1500, now: () => now, sleep: async ms => { now += ms; }, transport: async () => {
      starts.push(now);
      return { status: 500, headers: {}, body: '' };
    } });
    const client = new Client({ name: 'spacing', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    cleanups.push(async () => { await client.close(); await server.close(); });
    await Promise.all([server.connect(b), client.connect(a)]);
    await client.callTool({ name: 'trends_compare', arguments: { keywords: ['coffee', 'tea'] } });
    await client.callTool({ name: 'trends_now', arguments: { geos: ['SG'] } });
    expect(starts.length).toBeGreaterThan(1);
    expect(starts.every((t, i) => i === 0 || t - starts[i - 1] >= 1500)).toBe(true);
  });
});

  it('schema rejection returns the shared envelope with structuredContent', async () => {
    const client = await connect();
    const r = await client.callTool({ name: 'trends_compare', arguments: { keywords: [] } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, schemaVersion: SCHEMA_VERSION, status: 'error', error: { code: 'INVALID_INPUT' }, meta: { upstreamRequests: 0 } });
    expect(JSON.parse((r.content as { text: string }[])[0].text)).toEqual(r.structuredContent);
    expect(String((r.structuredContent as { error: { message: string } }).error.message)).toMatch(/keywords|array|1/i);
  });

describe('output envelopes', () => {
  const snap: TermSnapshot = { schema: 'term-snapshot/1', id: 's1', term: 'x', filter: { geo: 'US', time: 'now 1-d', category: 0, property: '' }, fetchedAt: '2026-10-31T00:00:00.000Z', status: 'ok',
    interest: { points: [{ time: '1', value: 10 }, { time: '2', value: 30 }], latest: 30, peak: 30, settledLatest: 10 },
    popular: [{ rank: 1, query: 'x app', value: 100 }], rising: [{ rank: 1, query: 'x new', value: 250, breakout: false }, { rank: 2, query: 'x pro', value: 5000, breakout: true }],
    regions: [{ rank: 1, code: 'US-CA', name: 'California', value: 100 }] };
  it('trends_ask envelope has stable fields', () => {
    const e = askEnvelope(snap, { cached: true, ageMin: 3, diff: null, diffReason: 'Need two snapshots' });
    expect(e).toMatchObject({ ok: true, schemaVersion: 1, status: 'ok', term: 'x', filter: { geo: 'US', time: 'now 1-d', category: 0, property: 'web' },
      interest: { average: 20, peak: 30 },
      tables: { popular: [{ rank: 1, query: 'x app', value: 100, formattedValue: '100' }], rising: [{ formattedValue: '+250%', breakout: false }, { formattedValue: 'Breakout', breakout: true }] },
      regions: [{ geo: 'US-CA', name: 'California', value: 100 }], diff: null, diffReason: 'Need two snapshots', meta: { cached: true, snapshotId: 's1' } });
    expect(e.interest).not.toHaveProperty('points');
    expect(e).not.toHaveProperty('verdict');
    const withPoints = askEnvelope(snap, { cached: true, ageMin: 3, diff: null, includePoints: true });
    expect(withPoints.interest.points).toEqual([{ t: '1', value: 10 }, { t: '2', value: 30 }]);
  });
  it('trends_compare envelope builds one series per keyword', () => {
    const e = compareEnvelope(['a', 'b'], { status: 'ok', input: {}, data: { interestOverTime: { timeline: [{ time: '1', formattedTime: '', values: [10, 40], formattedValues: [], hasData: [] }], averages: [10, 40] } }, meta: { fetchedAt: 'f', upstreamRequests: 2, durationMs: 1, warnings: [] } });
    expect(e).toMatchObject({ ok: true, schemaVersion: 1, filter: { geo: 'US', time: 'now 1-d' }, summary: expect.stringContaining('a latest 10/peak 10'), series: [{ keyword: 'a', points: [{ t: '1', value: 10 }], average: 10, latest: 10, peak: 10 }, { keyword: 'b', average: 40, latest: 40, peak: 40 }] });
  });
  it('marks a blocked verdict as a failed envelope with error before meta', () => {
    const verdict = { label: 'blocked', confidence: 'low', reasons: ['RATE_LIMITED'], anchor: { term: 'gpts', ratio: null, band: null, note: 'rate limited' } };
    const e = blockedVerdict(askEnvelope(snap, { cached: false, ageMin: 0, verdict, diff: null })) as Record<string, unknown>;
    expect(e).toMatchObject({ ok: false, status: 'blocked', error: { code: 'RATE_LIMITED', message: 'rate limited' } });
    expect(Object.keys(e).slice(0, 3)).toEqual(['ok', 'schemaVersion', 'status']);
    expect(Object.keys(e).slice(-2)).toEqual(['error', 'meta']);
    const fine = askEnvelope(snap, { cached: false, ageMin: 0, verdict: { ...verdict, label: 'rising' }, diff: null });
    expect(blockedVerdict(fine)).toBe(fine);
    const withRetry = blockedVerdict(askEnvelope(snap, { cached: false, ageMin: 0, verdict: { ...verdict, retryAfterSec: 42 }, diff: null })) as Record<string, unknown>;
    expect(withRetry.error).toEqual({ code: 'RATE_LIMITED', message: 'rate limited', retryAfterSec: 42 });
  });
});
describe('trends_compare input checks', () => {
  it('accepts one keyword and returns a single series through the core', async () => {
    const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    const transport = vi.fn<Transport>(async req => {
      if (req.method === 'HEAD') return { status: 200, headers: {}, body: '' };
      const path = new URL(req.url).pathname;
      if (path.endsWith('/explore')) return { status: 200, headers: {}, body: fx('explore-single-world.txt') };
      if (path.endsWith('/multiline')) return { status: 200, headers: {}, body: fx('multiline-single-custom.txt') };
      throw new Error('unexpected ' + path);
    });
    const client = await connect(transport);
    const r = await client.callTool({ name: 'trends_compare', arguments: { keywords: ['bitcoin'] } });
    expect(r.isError).not.toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: true, series: [{ keyword: 'bitcoin', points: expect.any(Array) }] });
    expect(r.structuredContent!.series).toHaveLength(1);
    expect(transport).toHaveBeenCalled();
  });
  it('rejects duplicate keywords after trim with a structured error and no HTTP', async () => {
    const transport = vi.fn<Transport>();
    const client = await connect(transport);
    const r = await client.callTool({ name: 'trends_compare', arguments: { keywords: ['Coffee', ' coffee ', 'tea'] } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, schemaVersion: SCHEMA_VERSION, status: 'error', series: [], error: { code: 'INVALID_INPUT' } });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("trends_ask end-to-end offline", () => {
  it("asks with a temp snapshot dir: envelope, cache reuse, and diff", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gtfa-ask-"));
    const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
    const transport: Transport = async req => {
      const path = new URL(req.url).pathname;
      if (req.method === "HEAD") return { status: 200, headers: { "set-cookie": "NID=x; Path=/" }, body: "" };
      if (path.endsWith("/explore")) return { status: 200, headers: {}, body: fx("explore-single-world.txt") };
      if (path.endsWith("/multiline")) return { status: 200, headers: {}, body: fx("multiline-single-custom.txt") };
      if (path.endsWith("/comparedgeo")) return { status: 200, headers: {}, body: fx("comparedgeo-country-world.txt") };
      if (path.endsWith("/relatedsearches")) return { status: 200, headers: {}, body: fx("relatedsearches-single.txt") };
      throw new Error("unexpected " + path);
    };
    try {
      const client = await connect(transport, { snapshotDir: dir });
      const live = await client.callTool({ name: "trends_ask", arguments: { term: "bitcoin", fresh: true } });
      expect(live.isError).not.toBe(true);
      const body = live.structuredContent as Record<string, unknown>;
      expect(body).toMatchObject({ ok: true, schemaVersion: SCHEMA_VERSION, status: "ok", term: "bitcoin", filter: { geo: "US", time: "now 1-d" } });
      expect(body.tables).toMatchObject({ popular: expect.any(Array), rising: expect.any(Array) });
      expect(body.interest).not.toHaveProperty('points');
      const withPoints = await client.callTool({ name: "trends_ask", arguments: { term: "bitcoin", points: true } });
      expect((withPoints.structuredContent as { interest: { points: unknown[] } }).interest.points).toEqual(expect.any(Array));
      expect(body.diff).toBeNull();
      expect((body.meta as { cached: boolean }).cached).toBe(false);
      expect(Object.keys(body).slice(0, 3)).toEqual(["ok", "schemaVersion", "status"]);

      const cached = await client.callTool({ name: "trends_ask", arguments: { term: "bitcoin" } });
      expect((cached.structuredContent as { meta: { cached: boolean } }).meta.cached).toBe(true);
      expect(cached.structuredContent).toMatchObject({ diff: null, diffReason: 'Need two snapshots' });

      const withDiff = await client.callTool({ name: "trends_ask", arguments: { term: "bitcoin", fresh: true } });
      const next = withDiff.structuredContent as { diff: unknown; meta: { snapshotId: string; cached: boolean } };
      expect(next.diff).toMatchObject({ from: (body.meta as { snapshotId: string }).snapshotId, to: next.meta.snapshotId });
      expect(withDiff.structuredContent).not.toHaveProperty('diffReason');
      expect((withDiff.structuredContent as { meta: { cached: boolean } }).meta.cached).toBe(false);

      const cachedDiff = await client.callTool({ name: 'trends_ask', arguments: { term: 'bitcoin' } });
      expect(cachedDiff.structuredContent).toMatchObject({ diff: next.diff, meta: { cached: true, snapshotId: next.meta.snapshotId } });
      expect(cachedDiff.structuredContent).not.toHaveProperty('diffReason');
      const validated = await client.callTool({ name: "trends_ask", arguments: { term: "bitcoin", validate: true } });
      expect((validated.structuredContent as { verdict?: { label: string } }).verdict?.label).toMatch(/rising|steady|flat|spiking|no_data|blocked/);
      expect(validated.structuredContent).toMatchObject({ diff: next.diff, meta: { cached: true } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});

describe('trends_ask history regressions over MCP', () => {
  it.each([false, true])('preserves case, skips failed baselines, and continues calls for a reused-store batch (validate=%s)', async validate => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { SnapshotStore } = await import('../src/snapshot.js');
    const dir = mkdtempSync(join(tmpdir(), 'gtfa-mcp-history-'));
    const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    let failed = true;
    const transport: Transport = async req => {
      if (failed) throw new TypeError('offline');
      if (req.method === 'HEAD') return { status: 200, headers: {}, body: '' };
      const url = new URL(req.url), path = url.pathname;
      const request = JSON.parse(url.searchParams.get('req') ?? '{}');
      const items = request.comparisonItem ?? [];
      if (path.endsWith('/explore')) {
        const keywords = items.map((i: { keyword: string }) => i.keyword);
        const body = keywords.length > 1
          ? fx('explore-multi.txt').replaceAll('chatgpt', keywords[0]).replaceAll('claude', keywords[1])
          : fx('explore-single-world.txt').replaceAll('bitcoin', keywords[0]);
        return { status: 200, headers: {}, body };
      }
      const file = path.endsWith('/multiline') ? (items.length > 1 ? 'multiline-multi.txt' : 'multiline-single-custom.txt')
        : path.endsWith('/comparedgeo') ? 'comparedgeo-country-world.txt' : 'relatedsearches-single.txt';
      return { status: 200, headers: {}, body: fx(file) };
    };
    try {
      const client = await connect(transport, { snapshotDir: dir });
      const call = async (term: string, fresh = false) => (await client.callTool({ name: 'trends_ask', arguments: { term, validate, fresh } })).structuredContent!;
      for (const term of ['Sora', 'sora']) {
        const r = await call(term);
        expect(r).toMatchObject({ term, status: 'error', diff: null, diffReason: 'Current snapshot has no usable successful data', error: { code: 'NETWORK_ERROR' }, meta: { cached: false } });
      }
      expect(await new SnapshotStore(dir).history('sora')).toHaveLength(2);
      failed = false;
      const first = await call('Sora', true);
      expect(first).toMatchObject({ ok: true, status: 'ok', term: 'Sora', diff: null, diffReason: 'No usable prior successful snapshot' });
      expect(await call('sora')).toMatchObject({ term: 'sora', meta: { cached: true } });
      failed = true;
      expect(await call('SORA', true)).toMatchObject({ diff: null, error: { code: 'NETWORK_ERROR' } });
      failed = false;
      const next = await call('sora', true);
      expect(next).toMatchObject({ term: 'sora', diff: { term: 'sora', from: (first.meta as { snapshotId: string }).snapshotId } });
      // MCP's single-term surface runs the same mixed-term batch as sequential calls.
      const batch = [];
      for (const term of ['sora', 'nano banana']) batch.push(await call(term, true));
      expect(batch).toMatchObject([{ term: 'sora', diff: { term: 'sora' } }, { term: 'nano banana', diff: null }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
