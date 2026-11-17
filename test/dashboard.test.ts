import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '../src/dsh.js';
import { QueryHistoryStore } from '../src/query-history.js';
import { TIME_RANGES } from '../src/core.js';
import type { GtfaTool } from '../src/tools.js';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
type Route = { fetch(request: Request): Promise<Response> };
async function host(blocked = false) {
  const directory = await mkdtemp(join(tmpdir(), 'gtfa-dashboard-')); directories.push(directory);
  const fixture = async (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  const transport = vi.fn(async (request: { url: string; method?: string }) => {
    if (blocked) return { status: 429, headers: {}, body: '' };
    const path = new URL(request.url).pathname;
    let body = request.method === 'HEAD' ? '' : path.endsWith('/explore') ? await fixture('explore-multi.txt') : path.endsWith('/multiline') ? await fixture('multiline-multi.txt') : await fixture('relatedsearches-single.txt');
    if (path.endsWith('/explore')) {
      const input = JSON.parse(new URL(request.url).searchParams.get('req')!);
      body = body.replaceAll('"chatgpt"', JSON.stringify(input.comparisonItem[0].keyword)).replaceAll('"claude"', JSON.stringify(input.comparisonItem[1].keyword));
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
});
