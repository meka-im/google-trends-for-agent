import { afterEach, describe, expect, it, vi } from 'vitest';
import { chartKeyFor, runOnce, type ActorRunDeps, type ActorRunRow } from '../src/actor-run.js';
import type { GtfaTool } from '../src/tools.js';

const FIELDS: Record<string, unknown> = {
  interest: { latest: 43, average: 38.6, settledLatest: 41, peak: 100 },
  verdict: { label: 'steady', traffic: { average: 1520 }, anchor: { term: 'sudoku' } },
  tables: { popular: [{ query: 'sora 2' }, { query: 'sora video' }], rising: [{ query: 'sora 2 api' }] },
  meta: { fetchedAt: '2026-11-12T09:30:00.000Z' },
};

function askEnvelope(term: string, extra: Record<string, unknown> = {}) {
  return { ok: true, status: 'ok', term, ...FIELDS, ...extra };
}

function harness(executeTool: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>, extra: Partial<ActorRunDeps> = {}) {
  const pushed: ActorRunRow[] = [];
  const values: Record<string, unknown> = {};
  const options: Record<string, unknown> = {};
  const logs: string[] = [];
  const deps: ActorRunDeps = {
    executeTool,
    pushData: async item => { pushed.push(item as unknown as ActorRunRow); },
    setValue: async (key, value, opts) => { values[key] = value; if (opts) options[key] = opts; },
    log: message => logs.push(message),
    now: () => 1_000,
    ...extra,
  };
  return { deps, pushed, values, options, logs };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runOnce validation', () => {
  it.each([
    [{ tool: 'nope', terms: ['a'] }, /Unknown tool/],
    [{ tool: 'ask', terms: [] }, /at least one term/],
    [{ tool: 'compare', terms: ['a'] }, /2–5 terms/],
    [{ tool: 'compare', terms: ['a', 'b', 'c', 'd', 'e', 'f'] }, /2–5 terms/],
    [{ tool: 'now', terms: [], geo: 'WORLDWIDE' }, /needs a country/],
    [{ tool: 'ask', terms: ['a'], window: 'yesterday' }, /Unknown window/],
    [{ tool: 'ask', terms: ['a'], anchor: 'chairs' }, /Unknown anchor/],
    [{ tool: 'ask', terms: ['a'], geo: 'ZZ' }, /Unsupported geo/],
  ])('fails %j up front', async (input, message) => {
    const { deps, pushed, values, logs } = harness(async () => askEnvelope('a'));
    const result = await runOnce(input as never, deps);
    expect(result.failed).toBe(true);
    expect(result.rows).toEqual([]);
    expect(pushed).toEqual([]);
    expect(JSON.stringify(values.OUTPUT)).toMatch(message);
    expect((values.OUTPUT as { status: string }).status).toBe('failed');
    expect(logs[0]).toMatch(/Invalid input/);
  });
});

describe('runOnce mapping', () => {
  it('calls ask once per term, sequentially, and maps interest plus verdict', async () => {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const { deps, pushed, values, logs } = harness(async (name, input) => {
      calls.push({ name, input });
      return askEnvelope(String(input.term));
    });
    const result = await runOnce({ tool: 'ask', terms: ['Sora', 'Veo'], geo: 'US', window: 'now 1-d' }, deps);
    expect(calls.map(call => call.input.term)).toEqual(['Sora', 'Veo']);
    expect(calls.every(call => call.name === 'trends_ask')).toBe(true);
    expect(calls[0]!.input).toMatchObject({ geo: 'US', time: 'now 1-d', validate: true });
    expect(pushed).toHaveLength(2);
    expect(pushed[0]).toMatchObject({
      term: 'Sora', tool: 'ask', geo: 'US', window: 'now 1-d', status: 'ok',
      interestLatest: 43, interestSettled: 41, interestAverage: 38.6, interestPeak: 100,
      searchesPerDay: 1520, verdict: 'steady', anchor: 'sudoku',
      topRelated: ['sora 2', 'sora video'], topRising: ['sora 2 api'],
      chartKey: null, chartUrl: null, error: null, fetchedAt: '2026-11-12T09:30:00.000Z',
    });
    expect(logs).toEqual(['Sora: ok', 'Veo: ok']);
    expect(values.OUTPUT).toMatchObject({ status: 'completed', tool: 'ask', geo: 'US', delivered: 2, completed: true, partial: false });
  });

  it('passes the anchor to snapshot and stores the chart in KV', async () => {
    vi.stubEnv('APIFY_DEFAULT_KEY_VALUE_STORE_ID', 'store-1');
    const chart = Buffer.from('<svg></svg>');
    const values: Record<string, unknown> = {};
    const setValue = vi.fn(async (key: string, value: unknown) => { values[key] = value; });
    const { deps, pushed } = harness(async (_name, input) => ({
      ok: true, status: 'ok', term: input.term,
      filter: { geo: 'US', time: 'now 7-d', category: 0, property: 'web' },
      traffic: { latest: 52000, settledLatest: 48000, average: 12000, peak: 90000 },
      series: { points: [
        { t: '2026-11-10T00:00:00Z', score: 40, traffic: 10000 },
        { t: '2026-11-10T01:00:00Z', score: 100, traffic: 25000 },
        { t: '2026-11-10T02:00:00Z', score: 60, traffic: 15000 },
        { t: '2026-11-10T03:00:00Z', score: 50, traffic: 12500 },
      ] },
      anchor: { term: 'gpts' }, verdict: { label: 'rising' },
      tables: { popular: [{ query: 'sora 2' }], rising: [{ query: 'sora 2 api' }] },
      chart: { path: '/tmp/charts/sora.svg' },
      meta: { fetchedAt: '2026-11-12T10:00:00.000Z' },
    }), { setValue, readFile: async () => chart });
    const result = await runOnce({ tool: 'snapshot', terms: ['Sora'], geo: 'US', window: 'now 7-d', anchor: 'gpts' }, deps);
    expect(pushed[0]).toMatchObject({
      status: 'ok', interestLatest: 50, interestSettled: 60, interestAverage: 62.5, interestPeak: 100,
      searchesPerDay: 12000, verdict: 'rising', anchor: 'gpts',
      chartKey: chartKeyFor('Sora'), chartUrl: `https://api.apify.com/v2/key-value-stores/store-1/records/${chartKeyFor('Sora')}`,
    });
    expect(setValue).toHaveBeenCalledWith(chartKeyFor('Sora'), chart, { contentType: 'image/svg+xml' });
    expect(values.OUTPUT).toMatchObject({ status: 'completed', delivered: 1 });
    expect(result.failed).toBe(false);
  });

  it('defaults geo to US and the window to now 1-d', async () => {
    let seen: Record<string, unknown> | undefined;
    const { deps } = harness(async (_name, input) => { seen = input; return askEnvelope('Sora'); });
    await runOnce({ tool: 'ask', terms: ['Sora'] }, deps);
    expect(seen).toMatchObject({ term: 'Sora', geo: 'US', time: 'now 1-d' });
  });

  it('uses one compare call and one row per series entry', async () => {
    const calls: unknown[] = [];
    const { deps, pushed } = harness(async (name, input) => {
      calls.push(input);
      return {
        ok: true, status: 'ok',
        series: [{ keyword: 'chatgpt', latest: 80, average: 70, peak: 100 }, { keyword: 'claude', latest: 55, average: 60, peak: 90 }],
        meta: { fetchedAt: '2026-11-12T11:00:00.000Z' },
      };
    });
    await runOnce({ tool: 'compare', terms: ['chatgpt', 'claude'], geo: 'GB', window: 'now 7-d' }, deps);
    expect(calls).toEqual([{ keywords: ['chatgpt', 'claude'], geo: 'GB', time: 'now 7-d' }]);
    expect(pushed.map(row => row.term)).toEqual(['chatgpt', 'claude']);
    expect(pushed[0]).toMatchObject({ interestLatest: 80, interestAverage: 70, interestPeak: 100, interestSettled: null, searchesPerDay: null });
  });

  it('caps Trending Now at 25 rows and passes the mapped hours', async () => {
    let received: Record<string, unknown> | undefined;
    const { deps, pushed } = harness(async (_name, input) => {
      received = input;
      return {
        ok: true, status: 'ok',
        byGeo: [{
          geo: 'US', ok: true, fetchedAt: '2026-11-12T12:00:00.000Z',
          items: Array.from({ length: 30 }, (_, i) => ({ rank: i + 1, title: `Item ${i}`, query: `query ${i}`, relatedQueries: ['a', 'b'] })),
        }],
        meta: { fetchedAt: '2026-11-12T12:00:00.000Z' },
      };
    });
    await runOnce({ tool: 'now', terms: ['ignored'], geo: 'US', window: 'now 7-d' }, deps);
    expect(received).toMatchObject({ geos: ['US'], hours: 168, limit: 25 });
    expect(pushed).toHaveLength(25);
    expect(pushed[0]).toMatchObject({ term: 'query 0', tool: 'now', status: 'ok', interestLatest: null, topRelated: ['a', 'b'] });
  });

  it('marks a rate-limited row and keeps the run partial when another row succeeds', async () => {
    let call = 0;
    const { deps, pushed, values } = harness(async (_name, input) => {
      call += 1;
      return call === 1
        ? askEnvelope(String(input.term))
        : { ok: false, status: 'error', error: { code: 'RATE_LIMITED', message: 'slow down' } };
    });
    const result = await runOnce({ tool: 'ask', terms: ['good', 'slow'], geo: 'US', window: 'now 1-d' }, deps);
    expect(pushed.map(row => row.status)).toEqual(['ok', 'rate_limited']);
    expect(pushed[1]!.error).toEqual({ code: 'RATE_LIMITED', message: 'slow down' });
    expect(values.OUTPUT).toMatchObject({ status: 'partial', delivered: 1, blocked: 1, errors: 0, partial: true, completed: false });
    expect(result.failed).toBe(false);
  });

  it('treats all no_data rows as completed, and all errors as failed', async () => {
    const noData = harness(async () => ({ ok: true, status: 'no_data', interest: {}, tables: {}, meta: {} }));
    const completed = await runOnce({ tool: 'ask', terms: ['nothing'], geo: 'US', window: 'now 1-d' }, noData.deps);
    expect(completed.output).toMatchObject({ status: 'completed', delivered: 0, noData: 1, completed: true });
    expect(completed.failed).toBe(false);

    const failed = harness(async () => ({ ok: false, status: 'error', error: { code: 'BLOCKED', message: 'challenge' } }));
    const blocked = await runOnce({ tool: 'ask', terms: ['blocked'], geo: 'US', window: 'now 1-d' }, failed.deps);
    expect(blocked.output).toMatchObject({ status: 'failed', blocked: 1, errors: 0, completed: false, partial: false });
    expect(blocked.failed).toBe(true);
  });

  it('keeps a partial envelope with usable data as delivered, and the run partial', async () => {
    const { deps, pushed, values } = harness(async (_name, input) => askEnvelope(String(input.term), {
      ok: true, status: 'partial', error: { code: 'NETWORK_ERROR', message: 'related queries failed' },
    }));
    const result = await runOnce({ tool: 'ask', terms: ['Sora'], geo: 'US', window: 'now 1-d' }, deps);
    expect(pushed[0]).toMatchObject({ status: 'ok', interestLatest: 43, error: { code: 'NETWORK_ERROR' } });
    expect(values.OUTPUT).toMatchObject({ status: 'partial', delivered: 1, partial: true, completed: false });
    expect(result.failed).toBe(false);
  });

  it('reports a Trending Now country failure as a row', async () => {
    const { deps, pushed, values } = harness(async () => ({
      ok: false, status: 'error',
      byGeo: [{ geo: 'US', ok: false, items: [], error: { code: 'BLOCKED', message: 'challenge page' } }],
    }));
    const result = await runOnce({ tool: 'now', geo: 'US', window: 'now 1-d' }, deps);
    expect(pushed).toEqual([expect.objectContaining({ term: 'US', status: 'blocked', error: { code: 'BLOCKED', message: 'challenge page' } })]);
    expect(values.OUTPUT).toMatchObject({ status: 'failed', blocked: 1 });
    expect(result.failed).toBe(true);
  });

  it('builds ASCII-only, collision-free chart keys', () => {
    const keys = ['C++', 'C#', '人工智能', 'Sora'].map(chartKeyFor);
    expect(new Set(keys).size).toBe(4);
    for (const key of keys) expect(key).toMatch(/^chart-[a-z0-9-]*[0-9a-f]{8}$/);
    expect(chartKeyFor('Sora')).toBe(chartKeyFor('Sora'));
  });

  it('turns a thrown tool error into an error row', async () => {
    const { deps, pushed } = harness(async () => { throw new Error('boom'); });
    const result = await runOnce({ tool: 'snapshot', terms: ['Sora'], geo: 'US', window: 'now 1-d' }, deps);
    expect(pushed[0]).toMatchObject({ status: 'error', error: { code: 'INTERNAL', message: 'boom' } });
    expect(result.failed).toBe(true);
  });

  it('uses the shared tools when no executor is injected', async () => {
    const tool: GtfaTool = {
      name: 'trends_ask',
      description: 'test',
      inputSchema: undefined as never,
      execute: async input => askEnvelope(String((input as { term: string }).term)),
    };
    const { deps, pushed } = harness(async () => ({}), { executeTool: undefined, tools: [tool] });
    await runOnce({ tool: 'ask', terms: ['Sora'], geo: 'US', window: 'now 1-d' }, deps);
    expect(pushed[0]).toMatchObject({ term: 'Sora', status: 'ok' });
  });
});
