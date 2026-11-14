import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveFilter, DEFAULT_FILTER, settledPoints } from '../src/filter.js';
import { SnapshotStore, snapshotTerm, askTerm, diffSnapshots, snapshotDiff, type TermSnapshot } from '../src/snapshot.js';
import { validateTerms, parseLeadInput, detectFreshSpike } from '../src/validate.js';
import { runAskCli } from '../src/ask-cli.js';
import { snapshotTrafficTerm, trafficSnapshotEnvelope } from '../src/trends-snapshot.js';
import { verdictEnvelope } from '../src/tools.js';
import { loadBaselines } from '../src/traffic.js';
import type { queryTrends } from '../src/api.js';
const dirs: string[] = [];
async function store() { const dir = await mkdtemp(join(tmpdir(), 'gtfa-')); dirs.push(dir); return new SnapshotStore(dir); }
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function mock(values: number[], breakout = false): typeof queryTrends {
  return vi.fn(async (input: any) => ({ status: 'ok', input, meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 1, durationMs: 0, warnings: [] },
    data: { interestOverTime: { timeline: values.map((v, i) => ({ time: new Date(Date.UTC(2026, 0, 1, i)).toISOString(), values: input.queries.length === 2 ? [v, 10] : [v] })) },
      relatedQueries: { top: [{ query: 'popular', value: 100 }], rising: breakout ? [{ query: 'new', value: 5000, formattedValue: 'Breakout' }] : [] },
      interestBySubregion: { rows: [{ geoCode: 'US-CA', geoName: 'California', values: [100] }] } } }));
}
it('resolves args > config > env > defaults, including worldwide and web', () => {
  expect(resolveFilter({}, {}, {})).toEqual(DEFAULT_FILTER);
  expect(resolveFilter({ geo: '', property: '' }, { geo: 'GB', time: 'today 1-m' }, { GTFA_GEO: 'JP', GTFA_TIME: 'now 7-d' })).toMatchObject({ geo: '', time: 'today 1-m', property: '' });
  expect(resolveFilter({}, {}, { GTFA_GEO: 'JP' }).geo).toBe('JP');
  expect(resolveFilter({ geo: ' us ' }, {}, {}).geo).toBe('US');
  expect(resolveFilter({ geo: '   ' }, {}, {}).geo).toBe('');
});
it('drops two daily points and one hourly point', () => {
  const points = [0, 1, 2, 3, 4].map(i => ({ time: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }));
  expect(settledPoints(points, { ...DEFAULT_FILTER, time: 'today 1-m' })).toHaveLength(3);
  expect(settledPoints(points, { ...DEFAULT_FILTER, time: 'now 7-d' })).toHaveLength(4);
});
it.each([
  [[10, 10, 30, 30, 0], false, 'rising'],
  [[20, 20, 20, 20, 0], false, 'steady'],
  [[5, 5, 2, 2, 100], false, 'flat'],
  [[0, 0, 0, 0, 100], false, 'no_data'],
  [[5, 5, 5, 5, 0], true, 'rising'],
] as const)('classifies %j', async (values, breakout, verdict) => {
  const rows = await validateTerms(['x'], { store: await store(), query: mock([...values], breakout), anchor: false });
  expect(rows[0].verdict).toBe(verdict);
});
it('uses the full shared-scale comparison window and calibrates only matching geos', async () => {
  for (const geo of ['US', 'JP']) {
    const [r] = await validateTerms(['x'], { store: await store(), filter: { geo }, query: mock([20, 20, 20, 20, 100]) });
    expect(r.anchor.ratio).toBe(3.6);
    expect(r.anchor.term).toBe('sudoku');
    if (geo === 'US') {
      expect(r.anchor.dailySearches).toBe(63000);
      expect(verdictEnvelope(r).anchor).toMatchObject({ term: 'sudoku', dailySearches: 63000 });
      expect(r.anchor.traffic).toMatchObject({ unit: 'searches/day', average: 226800, low: 113400, high: 340200 });
    } else {
      expect(r.anchor.dailySearches).toBeNull();
      expect(r.anchor.traffic.average).toBeNull();
      expect(r.anchor.note).toContain('无法估');
    }
  }
});
it.each([
  { label: 'non-web property', filter: { property: 'youtube' } },
  { label: 'category', filter: { category: 1 } },
] as const)('keeps ratio but omits absolute traffic for a $label', async ({ filter }) => {
  const baselines = { version: 2 as const, anchors: [{ term: 'sudoku', geo: 'US', dailySearches: 12000, tolerance: 0.2 }] };
  const query = mock([20, 20, 20, 20, 100]);
  const [r] = await validateTerms(['x'], { store: await store(), filter, query, baselines });
  expect(r.anchor).toMatchObject({ dailySearches: null, ratio: 3.6, band: 'high' });
  expect(r.anchor.traffic).toEqual({ unit: 'searches/day', average: null, latest: null, settledLatest: null, peak: null, low: null, high: null, gapCount: 0 });
  expect(r.anchor.note).toContain('Baseline calibration applies only to web/all categories');
  expect(r.anchor.note).not.toContain('No calibration for geo');
  expect(verdictEnvelope(r).warnings).toEqual([expect.stringContaining('web/all categories')]);
});
it('uses an explicit web property with the default US baseline', async () => {
  const [r] = await validateTerms(['x'], { store: await store(), filter: { property: 'web' }, query: mock([20, 20, 20, 20, 100]) });
  expect(r.anchor).toMatchObject({ term: 'sudoku', dailySearches: 63000, ratio: 3.6, traffic: { average: 226800 } });
});
it('normalizes geo before ask cache lookup, upstream input, and response display', async () => {
  const s = await store(), query = mock([10, 10, 20, 20, 0]);
  const first = await askTerm('x', { store: s, filter: { geo: ' us ' }, query });
  const second = await askTerm('x', { store: s, filter: { geo: 'us' }, query });
  expect(first.snapshot.filter.geo).toBe('US');
  expect(second.source).toBe('cache');
  expect(second.snapshot.id).toBe(first.snapshot.id);
  expect(query).toHaveBeenCalledTimes(1);
  expect((query as any).mock.calls[0][0].geo).toBe('US');
});
it('matches trends_snapshot traffic for the same fixture comparison', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/traffic-snapshot.json', import.meta.url), 'utf8')) as TermSnapshot;
  const timeline = fixture.interest.points.map((p, i) => ({ time: p.time, values: [p.value, fixture.anchor!.points[i]!.value] }));
  const query: typeof queryTrends = vi.fn(async input => {
    const compare = input.queries.length > 1;
    return { status: 'ok' as const, input, meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 1, durationMs: 0, warnings: [] },
      data: {
        interestOverTime: { timeline: compare ? timeline : fixture.interest.points.map(p => ({ time: p.time, values: [p.value] })) },
        relatedQueries: { top: [], rising: [] }, interestBySubregion: { rows: [] },
      } };
  });
  const [r] = await validateTerms(['Astra'], { store: await store(), filter: { geo: 'US', time: 'now 1-d' }, query });
  const e = await trafficSnapshotEnvelope(fixture, { cached: false, ageMin: 0, chartDir: null });
  expect(r.anchor.ratio).toBe(e.anchor.ratio);
  expect(r.anchor.traffic).toEqual(e.traffic);
  expect(verdictEnvelope(r).traffic).toEqual(e.traffic);
});
it('omits traffic and warns for a sparse/near-zero anchor', async () => {
  const start = Date.parse('2026-10-31T00:00:00.000Z');
  const anchorPoints = Array.from({ length: 180 }, (_, i) => ({ time: new Date(start + i * 60000).toISOString(), value: i < 3 ? 11 : 0 }));
  const termPoints = anchorPoints.map((p, i) => ({ time: p.time, value: i < 3 ? 100 : 0 }));
  const timeline = anchorPoints.map((p, i) => ({ time: p.time, values: [termPoints[i].value, p.value] }));
  const query: typeof queryTrends = vi.fn(async input => ({ status: 'ok' as const, input, meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 1, durationMs: 0, warnings: [] },
    data: { interestOverTime: { timeline: input.queries.length > 1 ? timeline : termPoints.map(p => ({ time: p.time, values: [p.value] })) }, relatedQueries: { top: [], rising: [] }, interestBySubregion: { rows: [] } } }));
  const [r] = await validateTerms(['sparse'], { store: await store(), filter: { geo: 'US', time: 'now 1-d' }, query });
  expect(r.anchor.ratio).toBeNull();
  expect(r.anchor.traffic).toEqual({ unit: 'searches/day', average: null, latest: null, settledLatest: null, peak: null, low: null, high: null, gapCount: 0 });
  expect(r.anchor.warning).toContain('anchor too sparse/weak for calibration; traffic omitted');
  expect(r.anchor.note).toContain('anchor too sparse/weak for calibration; traffic omitted');
  expect(verdictEnvelope(r).warnings).toEqual([expect.stringContaining('anchor too sparse/weak')]);
});
it('stops after upstream blocking and reports every lead honestly', async () => {
  const query = vi.fn<typeof queryTrends>(async input => ({ status: 'error', input, error: { code: 'RATE_LIMITED', message: 'limited' }, meta: { fetchedAt: new Date().toISOString(), durationMs: 0, upstreamRequests: 1, warnings: [] } }));
  const rows = await validateTerms(['a', 'b'], { store: await store(), query });
  expect(rows.map(r => r.verdict)).toEqual(['blocked', 'blocked']);
  expect(query).toHaveBeenCalledTimes(1);
});
it('accepts JSON lead report shapes and preserves evidence', () => {
  for (const field of ['leads', 'rows', 'keywords', 'table']) expect(parseLeadInput({ [field]: [{ term: 'a' }, { keyword: 'b' }, { name: 'c', url: 'https://example.com' }] }).map(r => r.name)).toEqual(['a', 'b', 'c']);
  expect(parseLeadInput(['x', { name: 'y', variants: ['z'] }])[1].variants).toEqual(['z']);
});
it('reuses fresh and never-refresh cache, refreshes stale, and diffs lists independently', async () => {
  const s = await store(), query = mock([10, 10, 10, 10, 0]);
  const first = await askTerm('x', { store: s, query });
  expect((await askTerm('x', { store: s, query })).source).toBe('cache');
  first.snapshot.fetchedAt = '2000-01-01T00:00:00.000Z'; await s.save(first.snapshot);
  const staleStore = await store(); await staleStore.save(first.snapshot);
  expect((await askTerm('x', { store: staleStore, query, refresh: 'never' })).source).toBe('cache');
  expect((await askTerm('x', { store: staleStore, query })).source).toBe('live');
  const next = structuredClone(first.snapshot); next.popular = []; next.rising = [{ query: 'popular', rank: 1, value: 500, breakout: false }];
  expect(diffSnapshots(first.snapshot, next)).toMatchObject({ droppedPopular: ['popular'], newRising: [{ query: 'popular' }], risingUp: [] });
  expect((await s.history('x')).length).toBe(2);
});
it('keeps an unsettled daily spike out of rising verdicts', async () => {
  const query: typeof queryTrends = async input => {
    const r = await mock([10, 10, 10, 10, 100, 100])(input);
    (r.data!.interestOverTime as any).timeline.forEach((p: any, i: number) => p.time = new Date(Date.UTC(2026, 0, i + 1)).toISOString());
    return r;
  };
  expect((await validateTerms(['x'], { store: await store(), filter: { time: 'today 1-m' }, query, anchor: false }))[0].verdict).toBe('steady');
});
it('runs CLI JSON validation offline and warns without failing on blocks', async () => {
  const s = await store();
  const result = await runAskCli(['--validate', '--from', '-', '--json', '--no-anchor', '--store', s.dir], { stdin: '{"leads":[{"name":"x"}]}', query: mock([10, 10, 20, 20, 0]) });
  expect(result.code).toBe(0); expect(JSON.parse(result.stdout)[0].term).toBe('x');
});
it('loads daily baselines for anchor calibration', async () => {
  const b = await loadBaselines('examples/baselines.json');
  expect(b.version).toBe(2);
  expect(b.anchors[0]).toMatchObject({ term: 'gpts', dailySearches: 3500, geo: 'US', tolerance: 0.5 });
  expect(b.anchors[1]).toMatchObject({ term: 'sudoku', dailySearches: 63000, geo: 'US', tolerance: 0.5 });
  expect(b.windowAnchors).toEqual({ short: 'sudoku', long: 'gpts' });
});
it('never serves a blocked snapshot from cache', async () => {
  const s = await store();
  const blocked = vi.fn<typeof queryTrends>(async input => ({ status: 'error', input, error: { code: 'BLOCKED', message: 'b' }, meta: { fetchedAt: new Date().toISOString(), durationMs: 0, upstreamRequests: 1, warnings: [] } }));
  await askTerm('x', { store: s, query: blocked });
  expect((await askTerm('x', { store: s, query: blocked })).source).toBe('live');
  expect(blocked).toHaveBeenCalledTimes(2);
});
it('flags a fresh spike in the past-24h window as spiking with medium confidence', async () => {
  const base = Array(40).fill(5), rows = await validateTerms(['g'], { store: await store(), query: mock([...base, 0, 77, 100, 100]) });
  expect(rows[0].verdict).toBe('spiking'); expect(rows[0].confidence).toBe('mid');
  expect(rows[0].freshSpike?.recheckAfterMin).toBe(60); expect(rows[0].reasons[0]).toContain('recheck');
});
it('does not flag spikes for small bumps, long windows or short series', () => {
  expect(detectFreshSpike([...Array(40).fill(5), 8, 12], DEFAULT_FILTER)).toBeUndefined();
  expect(detectFreshSpike([...Array(40).fill(5), 80, 100], { time: 'today 1-m' })).toBeUndefined();
  expect(detectFreshSpike([1, 1, 90], DEFAULT_FILTER)).toBeUndefined();
  expect(detectFreshSpike([...Array(40).fill(5), 80, 100], DEFAULT_FILTER)?.ratio).toBeGreaterThan(10);
});
it('shares one anchor comparison across up to four terms per run', async () => {
  const query = mock(Array(20).fill(10));
  await validateTerms(['a', 'b', 'c'], { store: await store(), query });
  const compareCalls = (query as any).mock.calls.filter((c: any[]) => c[0].queries.includes('sudoku'));
  expect(compareCalls).toHaveLength(1); expect(compareCalls[0][0].queries).toEqual(['a', 'b', 'c', 'sudoku']);
});
it('uses gpts for 7-day validation and exposes its daily baseline', async () => {
  const query = mock([20, 20, 20, 20, 100]);
  const [r] = await validateTerms(['x'], { store: await store(), filter: { geo: 'US', time: 'now 7-d' }, query });
  expect(r.anchor.term).toBe('gpts');
  expect(r.anchor.dailySearches).toBe(3500);
  expect(r.anchor.traffic).toMatchObject({ average: 12600, low: 6300, high: 18900 });
  expect(verdictEnvelope(r).anchor).toMatchObject({ term: 'gpts', dailySearches: 3500 });
  expect((query as any).mock.calls.some((c: any[]) => c[0].queries.includes('gpts'))).toBe(true);
});
it('ask CLI maps blocked/rate-limited to exit 3, other upstream errors to 1, and partial to 2', async () => {
  const s = await store();
  for (const code of ['BLOCKED', 'RATE_LIMITED'] as const) {
    const query = vi.fn<typeof queryTrends>(async input => ({ status: 'error', input, error: { code, message: code }, meta: { fetchedAt: new Date().toISOString(), durationMs: 0, upstreamRequests: 1, warnings: [] } }));
    const r = await runAskCli(['x', '--json', '--refresh', 'always', '--store', s.dir], { query });
    expect(r.code).toBe(3);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, status: 'blocked', error: { code } });
  }
  const failed = vi.fn<typeof queryTrends>(async input => ({ status: 'error', input, error: { code: 'NETWORK_ERROR', message: 'offline' }, meta: { fetchedAt: new Date().toISOString(), durationMs: 0, upstreamRequests: 1, warnings: [] } }));
  const errorResult = await runAskCli(['x', '--json', '--refresh', 'always', '--store', s.dir], { query: failed });
  expect(errorResult.code).toBe(1);
  expect(JSON.parse(errorResult.stdout)).toMatchObject({ ok: false, status: 'error', error: { code: 'NETWORK_ERROR' } });

  const partial = vi.fn<typeof queryTrends>(async input => ({ status: 'partial', input,
    data: { interestOverTime: { timeline: [{ time: '2026-10-31T00:00:00.000Z', values: [10] }, { time: '2026-10-31T01:00:00.000Z', values: [20] }] }, relatedQueries: { top: [], rising: [] }, interestBySubregion: { rows: [] } },
    meta: { fetchedAt: new Date().toISOString(), durationMs: 0, upstreamRequests: 1, warnings: ['related queries unavailable'] } }));
  const partialResult = await runAskCli(['x', '--json', '--refresh', 'always', '--store', s.dir], { query: partial });
  expect(partialResult.code).toBe(2);
  expect(JSON.parse(partialResult.stdout)).toMatchObject({ ok: true, status: 'partial', meta: { warnings: ['related queries unavailable'] } });
});

it('ask CLI --validate maps blocked and upstream errors to non-zero exits', async () => {
  const s = await store();
  const blocked = vi.fn<typeof queryTrends>(async input => ({ status: 'error', input, error: { code: 'BLOCKED', message: 'blocked' }, meta: { fetchedAt: new Date().toISOString(), durationMs: 0, upstreamRequests: 1, warnings: [] } }));
  const blockedResult = await runAskCli(['x', '--validate', '--json', '--no-anchor', '--refresh', 'always', '--store', s.dir], { query: blocked });
  expect(blockedResult.code).toBe(3);
  expect(JSON.parse(blockedResult.stdout)).toMatchObject({ ok: false, status: 'blocked', error: { code: 'BLOCKED' } });

  const failed = vi.fn<typeof queryTrends>(async input => ({ status: 'error', input, error: { code: 'NETWORK_ERROR', message: 'offline' }, meta: { fetchedAt: new Date().toISOString(), durationMs: 0, upstreamRequests: 1, warnings: [] } }));
  const errorResult = await runAskCli(['x', '--validate', '--json', '--no-anchor', '--refresh', 'always', '--store', s.dir], { query: failed });
  expect(errorResult.code).toBe(1);
  expect(JSON.parse(errorResult.stdout)).toMatchObject({ ok: false, status: 'error', error: { code: 'NETWORK_ERROR' } });
});

it('ask CLI returns structured INVALID_INPUT for bad flags', async () => {
  const r = await runAskCli(['x', '--unknown']);
  expect(r.code).toBe(4);
  expect(JSON.parse(r.stdout)).toMatchObject({ status: 'error', error: { code: 'INVALID_INPUT', message: expect.stringContaining('--unknown') }, meta: { upstreamRequests: 0, durationMs: 0, warnings: [], fetchedAt: expect.any(String) } });
});
it('ask CLI --validate --diff returns JSON with diff instead of a table', async () => {
  const s = await store();
  const r = await runAskCli(['x', '--validate', '--diff', '--no-anchor', '--store', s.dir], { query: mock([10, 10, 20, 20, 0]) });
  const rows = JSON.parse(r.stdout);
  expect(rows).toMatchObject({ term: 'x', diff: null }); // single term → envelope object, same as MCP
});
it.each([false, true])('ask CLI --diff bypasses cache and saves a snapshot (validate=%s)', async validate => {
  const s = await store(), upstream = mock([10, 10, 20, 20, 0]);
  let fetches = 0;
  const start = Date.now() - 1000;
  const query: typeof queryTrends = vi.fn(async input => {
    const r = await upstream(input);
    r.meta.fetchedAt = new Date(start + ++fetches).toISOString();
    return r;
  });
  const args = ['x', '--json', '--store', s.dir, ...(validate ? ['--validate', '--no-anchor'] : [])];
  const first = JSON.parse((await runAskCli(args, { query })).stdout);
  expect(first.diff).toBeNull();
  const cached = JSON.parse((await runAskCli(args, { query })).stdout);
  expect(cached.meta.cached).toBe(true);
  expect(fetches).toBe(1);

  const result = await runAskCli([...args, '--diff', '--refresh', 'never'], { query });
  expect(result.code).toBe(0);
  const next = JSON.parse(result.stdout);
  expect(next.meta.cached).toBe(false);
  expect(next.diff).toMatchObject({ from: first.meta.snapshotId, to: next.meta.snapshotId });
  expect(next).not.toHaveProperty('diffReason');
  expect(fetches).toBe(2);
  expect(await s.history('x')).toHaveLength(2);
});
it('keeps retryAfterSec when the anchor comparison is rate limited', async () => {
  const ok = mock([10, 10, 20, 20, 30, 30]);
  const query = vi.fn<typeof queryTrends>(async input => (input as { queries: string[] }).queries.length > 1
    ? { status: 'error', input, error: { code: 'RATE_LIMITED', message: 'slow down', retryAfterSec: 42 }, meta: { fetchedAt: new Date().toISOString(), durationMs: 0, upstreamRequests: 1, warnings: [] } }
    : ok(input));
  const [r] = await validateTerms(['x'], { store: await store(), query });
  expect(r).toMatchObject({ verdict: 'blocked', retryAfterSec: 42 });
});
it('calibrates a term that equals the anchor against itself instead of sending it twice', async () => {
  const query = mock([20, 20, 20, 20, 0]);
  const [r] = await validateTerms(['GPTs'], { store: await store(), filter: { time: 'now 7-d' }, query });
  const comparisons = (query as unknown as { mock: { calls: [{ queries: string[]; dataTypes?: string[] }][] } }).mock.calls.map(([i]) => i).filter(i => i.dataTypes?.length === 1);
  expect(comparisons.map(i => i.queries)).toEqual([['GPTs']]);
  expect(r.anchor).toMatchObject({ term: 'gpts', dailySearches: 3500, ratio: 1 });
  expect(r.anchor.traffic.average).toBe(3500);
});


it('gates a low-average noisy peak before verdict and calibration across shared ask/snapshot paths', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/low-sample.json', import.meta.url), 'utf8'));
  const query: typeof queryTrends = vi.fn(async input => {
    const r = await mock(fixture.values)(input);
    r.data!.relatedQueries = { top: [], rising: [] };
    return r;
  });
  const s = await store();
  const plain = await snapshotTerm('unlikelyterm', {}, { query });
  expect(plain.status).toBe('no_data');
  const [v] = await validateTerms(['unlikelyterm'], { store: s, query });
  expect(v).toMatchObject({ verdict: 'no_data', confidence: 'low', anchor: { ratio: null, band: null, traffic: { average: null, peak: null } } });
  // No anchor comparison is scheduled for this term.
  expect(vi.mocked(query).mock.calls.every(([i]) => i.queries.length === 1)).toBe(true);
  const cli = JSON.parse((await runAskCli(['unlikelyterm', '--validate', '--json', '--store', s.dir], { query })).stdout);
  expect(cli).toMatchObject({ status: 'no_data', interest: { average: 0.6 }, verdict: { label: 'no_data', confidence: 'low', traffic: { average: null, peak: null } } });
  const snap = await snapshotTrafficTerm('unlikelyterm', { query });
  expect(snap.status).toBe('no_data');
  const e = await trafficSnapshotEnvelope(snap, { cached: false, ageMin: 0, chartDir: null, week: snap });
  expect(e).toMatchObject({ status: 'no_data', verdict: { label: 'no_data', confidence: 'low', prioritize: false }, anchor: { ratio: null }, traffic: { average: null, peak: null }, traffic7d: { peak: null } });
  expect(e.series.points.every(p => p.traffic === null)).toBe(true);
  expect(e.meta.warnings).toContainEqual(expect.stringContaining('Interest average < 1'));
});

it.each(['popular', 'rising', 'boundary'])('keeps low-interest terms with evidence or average >= 1 eligible (%s)', async evidence => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/low-sample.json', import.meta.url), 'utf8'));
  const values = evidence === 'boundary' ? Array(180).fill(1) : fixture.values;
  const query: typeof queryTrends = async input => {
    const r = await mock(values)(input);
    r.data!.relatedQueries = {
      top: evidence === 'popular' ? [{ query: 'term app', value: 100 }] : [],
      rising: evidence === 'rising' ? [{ query: 'term news', value: 5000, formattedValue: 'Breakout' }] : [],
    };
    return r;
  };
  const [v] = await validateTerms(['term'], { store: await store(), query });
  expect(v.verdict).not.toBe('no_data');
  expect(v.anchor.traffic.peak).not.toBeNull();
  const snap = await snapshotTrafficTerm('term', { query });
  const e = await trafficSnapshotEnvelope(snap, { cached: false, ageMin: 0, chartDir: null });
  expect(e.status).toBe('ok');
  expect(e.traffic.peak).not.toBeNull();
});

it.each([false, true])('CLI preserves spelling and compares case-only changes, including a reused-store batch (validate=%s)', async validate => {
  const s = await store();
  let count = 0;
  const upstream = mock([10, 10, 20, 20, 0]);
  const query: typeof queryTrends = async input => {
    const r = await upstream(input);
    r.meta.fetchedAt = new Date(Date.UTC(2026, 10, 13) + ++count).toISOString();
    return r;
  };
  const args = ['--diff', '--store', s.dir, ...(validate ? ['--validate', '--no-anchor'] : [])];
  const first = JSON.parse((await runAskCli(['Sora', ...args], { query })).stdout);
  const second = await runAskCli(['sora', ...args], { query });
  expect(second.code).toBe(0);
  expect(JSON.parse(second.stdout)).toMatchObject({ term: 'sora', diff: { term: 'sora', from: first.meta.snapshotId } });
  const batch = await runAskCli(['--validate', '--from', '-', '--diff', '--no-anchor', '--store', s.dir], { stdin: '["sora", {"term":"nano banana"}]', query });
  expect(batch.code).toBe(0);
  expect(JSON.parse(batch.stdout)).toMatchObject([{ term: 'sora', diff: { term: 'sora' } }, { term: 'nano banana', diff: null }]);
  expect(await s.history(' SORA ')).toHaveLength(3);
});

it.each([false, true])('CLI saves failed fetches for diagnostics, skips them in diff, and resumes from a prior success (validate=%s)', async validate => {
  const s = await store();
  let count = 0, fail = true;
  const upstream = mock([10, 10, 20, 20, 0]);
  const query: typeof queryTrends = vi.fn(async input => {
    const r = fail ? { status: 'error' as const, input, error: { code: 'NETWORK_ERROR', message: 'offline' }, meta: { fetchedAt: '', upstreamRequests: 1, durationMs: 0, warnings: [] } } : await upstream(input);
    r.meta.fetchedAt = new Date(Date.UTC(2026, 10, 13) + ++count).toISOString();
    return r;
  });
  const args = ['Sora', '--json', '--store', s.dir, ...(validate ? ['--validate', '--no-anchor'] : [])];
  for (let i = 0; i < 2; i++) {
    const result = await runAskCli(args, { query });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ diff: null, diffReason: 'Current snapshot has no usable successful data', meta: { cached: false }, error: { code: 'NETWORK_ERROR' } });
  }
  expect(query).toHaveBeenCalledTimes(2);
  expect(await s.history('sora')).toHaveLength(2);
  fail = false;
  const firstSuccess = JSON.parse((await runAskCli([...args, '--diff'], { query })).stdout);
  expect(firstSuccess).toMatchObject({ diff: null, diffReason: 'No usable prior successful snapshot' });
  fail = true;
  await runAskCli([...args, '--diff'], { query });
  fail = false;
  const nextSuccess = JSON.parse((await runAskCli([...args, '--diff'], { query })).stdout);
  expect(nextSuccess.diff).toMatchObject({ from: firstSuccess.meta.snapshotId, to: nextSuccess.meta.snapshotId });
});

it('returns null and an explanation for incompatible or unusable history', async () => {
  const current = await snapshotTerm('Sora', {}, { query: mock([10, 10, 20, 20, 0]) });
  const wrongFilter = { ...current, id: 'old', filter: { ...current.filter, geo: 'JP' } };
  expect(diffSnapshots(wrongFilter, current)).toBeNull();
  expect(snapshotDiff(current, [current, wrongFilter])).toEqual({ diff: null, diffReason: 'Snapshot history has incompatible term or filters' });
  for (const status of ['error', 'blocked', 'partial', 'no_data'] as const) {
    expect(snapshotDiff(current, [current, { ...current, id: 'old', status }])).toEqual({ diff: null, diffReason: 'No usable prior successful snapshot' });
  }
});
