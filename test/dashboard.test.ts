import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '../src/dsh.js';
import { QueryHistoryStore } from '../src/query-history.js';
import { TIME_RANGES } from '../src/core.js';
import type { GtfaTool } from '../src/tools.js';
import { dashboardRoute } from '../src/dashboard-routes.js';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
type Route = { fetch(request: Request): Promise<Response> };
async function host(blocked = false) {
  const directory = await mkdtemp(join(tmpdir(), 'gtfa-dashboard-')); directories.push(directory);
  const fixture = async (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  let keywords: string[] = [];
  const transport = vi.fn(async (request: { url: string; method?: string }) => {
    if (blocked) return { status: 429, headers: {}, body: '' };
    const path = new URL(request.url).pathname;
    let body = request.method === 'HEAD' ? '' : path.endsWith('/explore') ? await fixture('explore-multi.txt') : path.endsWith('/multiline') ? await fixture('multiline-multi.txt') : await fixture('relatedsearches-single.txt');
    if (path.endsWith('/explore')) {
      const input = JSON.parse(new URL(request.url).searchParams.get('req')!);
      keywords = input.comparisonItem.map((item: { keyword: string }) => item.keyword);
      const document = JSON.parse(body.replace(/^\)\]}'[,]?\s*/, ''));
      const widget = document.widgets.find((widget: { id: string }) => widget.id === 'TIMESERIES');
      widget.request.comparisonItem = keywords.map(keyword => ({ ...widget.request.comparisonItem[0], complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: keyword }] } }));
      body = ")]}'\n" + JSON.stringify(document);
    }
    if (path.endsWith('/multiline')) {
      const document = JSON.parse(body.replace(/^\)\]}'[,]?\s*/, ''));
      document.default.timelineData.forEach((point: Record<string, unknown>) => { point.value = keywords.map((_, i) => 80 - i * 15); point.formattedValue = keywords.map((_, i) => String(80 - i * 15)); point.hasData = keywords.map(() => true); });
      if (document.default.averages) document.default.averages = keywords.map((_, i) => 80 - i * 15);
      body = "\u0029]}'\n" + JSON.stringify(document);
    }
    return { status: 200, headers: {}, body };
  });
  const tools = new Map<string, { execute(args: unknown, options: { signal?: AbortSignal }): Promise<Record<string, unknown>> }>();
  const routes = new Map<string, Route>();
  const ctx = { tools: { register(tool: GtfaTool) { tools.set(tool.name, tool as never); } },
    get: (name: string) => name === 'connection' ? { fetch: { register(route: Route & { path: string }) { routes.set(route.path, route); return async () => {}; } } } : undefined };
  await register(ctx, { snapshotDir: directory, chartDir: null }, { transport, minIntervalMs: 0 });
  const route = routes.get('/api/gtfa.dashboard')!;
  const call = (body?: unknown, suffix = '', origin?: string) => route.fetch(new Request(`http://localhost:4321/api/gtfa.dashboard${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(origin ? { origin } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { directory, tools, route, call, transport, store: new QueryHistoryStore(directory) };
}

describe('dsh query history and dashboard', () => {
  it('opens and replays retained results without any upstream traffic; records manual and Agent calls separately', async () => {
    const h = await host();
    const initial = await (await h.call()).json();
    expect(initial.records).toEqual([]); expect(h.transport).not.toHaveBeenCalled();
    const agent = await h.tools.get('trends_compare')!.execute({ keywords: ['ChatGPT', 'Gemini'], geo: 'CA', time: 'today 5-y' }, {});
    expect(agent.ok, JSON.stringify(agent.error)).toBe(true);
    const response = await h.call({ action: 'query', name: 'trends_compare', input: { keywords: ['Claude', 'Gemini'], geo: '', time: 'all' } });
    expect((await response.json()).result.ok).toBe(true);
    const rows = await new QueryHistoryStore(h.directory).list();
    expect(rows.map(row => row.source).sort()).toEqual(['agent', 'manual']);
    const manual = rows.find(row => row.source === 'manual')!;
    expect(manual).toMatchObject({ geo: '', time: 'all', terms: ['Claude', 'Gemini'], costUsd: 0 });
    const count = h.transport.mock.calls.length;
    const saved = await (await h.call(undefined, `?id=${manual.id}`)).json();
    expect(saved.result.filter.time).toBe('all');
    await h.call(); expect(h.transport).toHaveBeenCalledTimes(count);
    expect((await stat(join(h.store.directory, `${manual.id}.json`))).mode & 0o777).toBe(0o600);
  });
  it('passes every supported time window through the actual comparison tool unchanged', async () => {
    const h = await host();
    for (const time of TIME_RANGES) {
      const response = await h.call({ action: 'query', name: 'trends_compare', input: { keywords: ['ChatGPT', 'Gemini'], time } });
      const output = (await response.json()).result;
      expect(output.ok, JSON.stringify(output.error)).toBe(true);
      expect(output.filter.time).toBe(time);
    }
    expect(new Set((await h.store.list()).map(row => row.time))).toEqual(new Set(TIME_RANGES));
  });
  it('keeps the real block code and failures, without invented series', async () => {
    const h = await host(true);
    const output = await h.tools.get('trends_compare')!.execute({ keywords: ['ChatGPT', 'Gemini'] }, {});
    expect(output.ok).toBe(false);
    const record = (await h.store.list())[0]!;
    expect(record.errorCode).toBe('RATE_LIMITED');
    expect((await h.store.get(record.id))!.result.error).toMatchObject({ code: 'RATE_LIMITED' });
  });
  it('rejects cross-site mutations, invalid queries, ids and paths; only clears requested journal files', async () => {
    const h = await host();
    expect((await h.call({ action: 'query', name: 'trends_compare', input: {} }, '', 'https://evil.example')).status).toBe(403);
    expect((await h.call({ action: 'clear', ids: ['../../secret'] })).status).toBe(400);
    expect((await h.call({ action: 'query', name: 'trends_snapshot', input: { term: 'ChatGPT', time: 'today 2-m' } })).status).toBe(200);
    expect(h.transport).not.toHaveBeenCalled();
    expect((await h.store.list()).length).toBe(0);
    await h.tools.get('trends_compare')!.execute({ keywords: ['ChatGPT', 'Gemini'] }, {});
    const row = (await h.store.list())[0]!;
    await writeFile(join(h.directory, 'cache-keep.json'), '{}');
    const result = await (await h.call({ action: 'clear', ids: [row.id] })).json();
    expect(result.deleted).toBe(1); expect(await h.store.list()).toEqual([]);
    expect((await h.call(undefined, `?id=${row.id}`)).status).toBe(404);
    expect(await readFile(join(h.directory, 'cache-keep.json'), 'utf8')).toBe('{}');
  });
  it('persists cache hits once per call but does not count an old Actor run twice; scrubs token-like error text', async () => {
    const h = await host();
    const result = { ok: true, status: 'ok', meta: { actorRunId: 'run1', actorUsageUsd: 0.001, fetchedAt: new Date().toISOString() } };
    const options = { tool: 'trends_snapshot' as const, input: { term: 'ChatGPT' }, source: 'manual' as const, egress: 'actor-public' as const, defaultGeo: 'US', startedAt: Date.now() };
    await h.store.save({ ...options, result });
    const cached = await h.store.save({ ...options, result: { ...result, meta: { ...result.meta, cached: true }, error: { message: 'apify_api_fake_secret https://u:password@proxy.example' } } });
    expect(cached).toMatchObject({ cached: true, actorRunId: null, costUsd: 0 });
    const text = await readFile(join(h.store.directory, `${cached.id}.json`), 'utf8');
    expect(text).not.toContain('fake_secret'); expect(text).not.toContain('password');
    const rows = await h.store.list(); expect(rows.length).toBe(2); expect(rows.filter(row => row.actorRunId).length).toBe(1);
  });
  it('retains the latest 1,000 calls and removes expired result copies together', async () => {
    const h = await host();
    const options = { tool: 'trends_snapshot' as const, input: { term: 'ChatGPT' }, result: { ok: true, status: 'ok' }, source: 'manual' as const, egress: 'local' as const, defaultGeo: 'US' };
    const oldest = await h.store.save({ ...options, startedAt: 0 });
    for (let offset = 0; offset < 999; offset += 25) {
      await Promise.all(Array.from({ length: Math.min(25, 999 - offset) }, async (_, i) => {
        const id = randomUUID(), record = { ...oldest, id, createdAt: new Date(1000 + offset + i).toISOString() };
        await writeFile(join(h.store.directory, `${id}.meta.json`), JSON.stringify(record));
        await writeFile(join(h.store.directory, `${id}.json`), '{}');
      }));
    }
    await h.store.save({ ...options, startedAt: Date.now() });
    expect(await h.store.list()).toHaveLength(1000);
    expect(await h.store.get(oldest.id)).toBeNull();
    await expect(stat(join(h.store.directory, `${oldest.id}.json`))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('records the actual Trending Now countries rather than the default query region', async () => {
    const h = await host();
    const record = await h.store.save({ tool: 'trends_now', input: { geos: ['CA', 'GB'], hours: 48 }, result: { ok: true, status: 'ok', geos: ['CA', 'GB'] }, source: 'agent', egress: 'local', defaultGeo: 'US', startedAt: Date.now() });
    expect(record).toMatchObject({ geo: 'CA, GB', time: '48h', terms: ['CA', 'GB'] });
  });
  it('uses exactly one Actor run and one journal record for a calibrated multi-term UI query', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gtfa-dashboard-actor-')); directories.push(directory);
    const routes = new Map<string, Route>();
    let keywords: string[] = [];
    let actorRuns = 0;
    let filter = { geo: 'US', time: 'now 1-d' };
    const actorFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('/runs?')) {
        const input = JSON.parse(String(init!.body)).toolRequest.input;
        keywords = input.keywords;
        filter = { geo: input.geo ?? 'US', time: input.time };
        actorRuns++;
        return Response.json({ data: { id: 'run-' + actorRuns, status: 'SUCCEEDED', defaultKeyValueStoreId: 'one-store', usageTotalUsd: 0.001 } });
      }
      if (String(url).endsWith('/records/TOOL_RESPONSE')) return Response.json({ protocol: 1, snapshots: [], result: { ok: true, status: 'ok', schemaVersion: 1,
        filter, meta: { fetchedAt: new Date().toISOString() },
        series: keywords.map((keyword, index) => ({ keyword,
          points: Array.from({ length: 24 }, (_, hour) => ({
            t: new Date(Date.UTC(2026, 10, 1, hour)).toISOString(),
            value: (actorRuns === 1 ? [0, 60, 1, 10, 95] : [28, 18, 60])[index],
          })) })) } });
      throw new Error('Unexpected Actor request');
    });
    await register({ tools: { register() {} }, get: name => name === 'connection' ? { fetch: { register(route: Route & { path: string }) { routes.set(route.path, route); return async () => {}; } } } : undefined },
      { egress: 'actor-public', apifyToken: 'apify_api_test_placeholder', snapshotDir: directory, chartDir: null }, { onDemand: { fetch: actorFetch } });
    const reply = await routes.get('/api/gtfa.dashboard')!.fetch(new Request('http://localhost/api/gtfa.dashboard', { method: 'POST', body: JSON.stringify({ action: 'query', name: 'trends_compare', input: { keywords: ['Alpha', 'Beta'] } }) }));
    const output = (await reply.json()).result;
    expect(output.ok).toBe(true); expect(output.calibration.status).toBe('partial');
    expect(keywords).toEqual(['Alpha', 'Beta', 'oz to ml', 'sudoku', 'instagram']);
    expect(actorFetch.mock.calls.filter(([url]) => String(url).includes('/runs?'))).toHaveLength(1);
    const records = await new QueryHistoryStore(directory).list();
    expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ terms: ['Alpha', 'Beta'], actorRunId: 'run-1', costUsd: 0.001 });

    const id = records[0]!.id, route = routes.get('/api/gtfa.dashboard')!;
    const post = (body: unknown) => route.fetch(new Request('http://localhost/api/gtfa.dashboard', { method: 'POST', body: JSON.stringify(body) }));
    expect((await post({ action: 'estimate', id, term: 'unrelated' })).status).toBe(422);
    expect(actorRuns).toBe(1);
    const check = { action: 'estimate', id, term: 'alpha', requestId: randomUUID() };
    const response = await post(check);
    expect(response.status).toBe(200);
    const { saved } = await response.json();
    expect(keywords).toEqual(['Alpha', 'kph to mph', 'oz to ml']);
    expect(saved.volumeChecks).toMatchObject([{ sameWindow: true, keyword: 'Alpha', actorRunId: 'run-2', costUsd: 0.001,
      estimate: { anchor: { term: 'kph to mph' }, traffic: { average: 2489 } } }]);
    expect(saved.result).toEqual((await new QueryHistoryStore(directory).get(id))!.result);
    expect((await post({ ...check, requestId: randomUUID() })).status).toBe(200);
    expect(actorRuns).toBe(2);
    const store = new QueryHistoryStore(directory);
    expect(await store.list()).toMatchObject([{ id, volumeRuns: [{ actorRunId: 'run-2', costUsd: 0.001 }] }]);
    expect((await store.get(id))?.volumeChecks).toHaveLength(1);
    expect(await store.clear([id])).toBe(1);
    await expect(stat(join(store.directory, id + '.volume.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('restores a legacy band from its completed Actor batch and counts that run once', async () => {
    const h = await host();
    const directory = h.directory, store = h.store, routes = new Map<string, Route>();
    const filter = { geo: 'US', time: 'today 1-m' };
    const timeline = Array.from({ length: 10 }, (_, i) => new Date(Date.UTC(2026, 10, i + 1)).toISOString());
    const series = [{ keyword: 'Alpha', value: 28 }, { keyword: 'kph to mph', value: 60 }, { keyword: 'oz to ml', value: 60 }]
      .map(({ keyword, value }) => ({ keyword, points: timeline.map(t => ({ t, value })) }));
    const actorFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      if (String(url).endsWith('/actor-runs/saved-run')) {
        return Response.json({ data: { id: 'saved-run', status: 'SUCCEEDED', defaultKeyValueStoreId: 'saved-store' } });
      }
      if (String(url).endsWith('/key-value-stores/saved-store/records/TOOL_RESPONSE')) {
        return Response.json({ protocol: 1, result: { ok: true, filter, series } });
      }
      return new Response(null, { status: 404 });
    });
    const record = await store.save({ tool: 'trends_compare', input: { ...filter, keywords: ['Alpha', 'Beta'] },
      result: { ok: true, status: 'ok', filter }, source: 'manual', egress: 'actor-own', defaultGeo: 'US', startedAt: Date.now() });
    const requestId = randomUUID(), createdAt = new Date().toISOString();
    await store.saveVolumeCheck(record.id, { requestId, keyword: 'Alpha', sameWindow: true, actorRunId: 'saved-run', costUsd: .001,
      egress: 'actor-own', createdAt, fetchedAt: createdAt,
      estimate: { keyword: 'Alpha', traffic: { unit: 'searches/day', average: null, latest: null, settledLatest: null, peak: null, low: null, high: null, gapCount: 0 },
        points: [], reason: 'disagreement', range: { low: 747, high: 2473, anchors: ['kph to mph', 'oz to ml'] },
        period: { from: timeline[0]!, to: timeline[7]! } } });
    await register({ tools: { register() {} }, get: name => name === 'connection' ? { fetch: { register(route: Route & { path: string }) { routes.set(route.path, route); return async () => {}; } } } : undefined },
      { egress: 'actor-own', apifyToken: 'apify_api_test_placeholder', snapshotDir: directory, chartDir: null }, { onDemand: { fetch: actorFetch } });
    const route = routes.get('/api/gtfa.dashboard')!;
    const restore = () => route.fetch(new Request('http://localhost/api/gtfa.dashboard', { method: 'POST',
      body: JSON.stringify({ action: 'restore', id: record.id, term: 'alpha' }) }));
    const response = await restore();
    expect(response.status).toBe(200);
    const { saved } = await response.json();
    expect(saved.volumeChecks).toMatchObject([{ requestId, actorRunId: 'saved-run', costUsd: .001, estimate: {
      range: { low: 747, high: 2473, points: timeline.slice(0, 8).map(t => ({ t, low: 747, high: 2473 })) },
    } }]);
    expect((await restore()).status).toBe(200);
    expect(actorFetch).toHaveBeenCalledTimes(2);
    expect(await store.list()).toMatchObject([{ volumeRuns: [{ actorRunId: 'saved-run', costUsd: .001 }] }]);
  });
  it('reports only the active request progress without starting work, and clears it after cancellation', async () => {
    let started!: () => void;
    const active = new Promise<void>(resolve => { started = resolve; });
    const execute = vi.fn(async (_name, _input, signal, progress) => {
      progress?.('queued'); started();
      await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      return { ok: true };
    });
    const route = dashboardRoute({ settings: () => ({ egress: 'actor-public', geo: 'US', cache: true, snapshotDir: '/unused' }), execute }, () => undefined);
    const controller = new AbortController(), requestId = randomUUID();
    const pending = route.fetch(new Request('http://localhost/api/gtfa.dashboard', { method: 'POST', signal: controller.signal,
      body: JSON.stringify({ action: 'query', name: 'trends_compare', requestId, input: { keywords: ['A', 'B'] } }) }));
    await active;
    const poll = (id: string) => route.fetch(new Request(`http://localhost/api/gtfa.dashboard?progress=${id}`));
    expect((await (await poll(requestId)).json()).progress).toMatchObject({ requestId, phase: 'queued' });
    expect((await (await poll(randomUUID())).json()).progress).toBeNull();
    expect(execute).toHaveBeenCalledOnce();
    controller.abort(); expect((await pending).status).toBe(502);
    expect((await (await poll(requestId)).json()).progress).toBeNull();
  });
});
