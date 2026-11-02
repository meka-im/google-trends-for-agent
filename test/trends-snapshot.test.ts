import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { askEnvelope, createServer, SCHEMA_VERSION } from '../src/mcp.js';
import { runSnapshotCli } from '../src/snapshot-cli.js';
import { SnapshotStore, snapshotTerm, type TermSnapshot } from '../src/snapshot.js';
import { fetchTrafficSnapshot, snapshotTrafficTerm, trafficSnapshotEnvelope } from '../src/trends-snapshot.js';
import type { Transport } from '../src/transport.js';

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'gtfa-snapshot-')); dirs.push(dir); return dir; };
const chartSlug = (tz: string) => `${tz.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'utc'}-${createHash('sha1').update(tz).digest('hex').slice(0, 8)}`;
const chartPath = (dir: string, id: string, tz = 'UTC') => join(dir, `${id}-${chartSlug(tz)}.svg`);
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/traffic-snapshot.json', import.meta.url), 'utf8')) as TermSnapshot;
const weekFixture = (): TermSnapshot => {
  const snap = fixture();
  snap.id = 'traffic-fixture-7d';
  snap.filter = { ...snap.filter, time: 'now 7-d' };
  snap.interest.points = [
    { time: '2026-10-25T00:00:00.000Z', value: 20 },
    { time: '2026-10-26T00:00:00.000Z', value: 0 },
    { time: '2026-10-27T00:00:00.000Z', value: 40 },
    { time: '2026-10-28T00:00:00.000Z', value: 40 },
    { time: '2026-10-29T00:00:00.000Z', value: 60 },
    { time: '2026-10-30T00:00:00.000Z', value: 80 },
    { time: '2026-10-31T00:00:00.000Z', value: 60 },
  ];
  snap.anchor.points = [
    { time: '2026-10-25T00:00:00.000Z', value: 100 },
    { time: '2026-10-26T00:00:00.000Z', value: 0 },
    { time: '2026-10-27T00:00:00.000Z', value: 100 },
    { time: '2026-10-28T00:00:00.000Z', value: 100 },
    { time: '2026-10-29T00:00:00.000Z', value: 100 },
    { time: '2026-10-30T00:00:00.000Z', value: 100 },
    { time: '2026-10-31T00:00:00.000Z', value: 100 },
  ];
  return snap;
};
const timeline = (points: { time: string; term: number; anchor: number }[]) => ({
  status: 'ok' as const, input: {},
  data: {
    interestOverTime: { timeline: points.map(p => ({ time: p.time, values: [p.term, p.anchor] })) },
    relatedQueriesByQuery: [{ query: 'Astra', top: [{ query: 'astra app', value: 100 }], rising: [] }],
  },
  meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 1, durationMs: 0, warnings: [] },
});
const timelineFor = (snap: TermSnapshot) => timeline(snap.interest.points.map((p, i) => ({ time: p.time, term: p.value, anchor: snap.anchor?.points[i]?.value ?? 0 })));
const cleanups: (() => Promise<void>)[] = [];
const originalTz = process.env.GTFA_TZ;
beforeEach(() => { delete process.env.GTFA_TZ; });
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (originalTz === undefined) delete process.env.GTFA_TZ;
  else process.env.GTFA_TZ = originalTz;
});
async function connect(options: { snapshotDir: string; chartDir: string; transport?: Transport }) {
  const server = createServer({ transport: options.transport ?? (async () => ({ status: 500, headers: {}, body: '' })), minIntervalMs: 0, snapshotDir: options.snapshotDir, chartDir: options.chartDir });
  const client = new Client({ name: 'snapshot-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  cleanups.push(async () => { await client.close(); await server.close(); });
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}

describe('trends_snapshot traffic conversion', () => {
  it('converts shared-scale scores to searches/day with rounded bounds and tables', async () => {
    const chartDir = temp();
    const e = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir });
    expect(e).toMatchObject({ ok: true, schemaVersion: SCHEMA_VERSION, status: 'ok', term: 'Astra', filter: { geo: 'US', time: 'now 1-d', category: 0, property: 'web' } });
    expect(e.chart).toEqual({ svg: '', path: chartPath(chartDir, 'traffic-fixture') });
    expect(e.anchor).toEqual({ term: 'gpts', dailySearches: 550, tolerance: 0.5, level: 100, ratio: 0.58, source: 'baseline', note: 'Anchor calibration estimate; not measured volume' });
    expect(e.traffic).toEqual({ unit: 'searches/day', average: 319, latest: 440, settledLatest: 330, peak: 440, low: 160, high: 479, gapCount: 1 });
    expect(e.series.points[1]).toEqual({ t: '2026-10-31T01:00:00.000Z', score: 0, traffic: 0, gap: true });
    expect(e.series.anchorPoints[1]).toEqual({ t: '2026-10-31T01:00:00.000Z', score: 0 });
    expect(e.tables.popular).toEqual([
      { rank: 1, query: 'astra app', value: 100, formattedValue: '100', estDaily: 319 },
      { rank: 2, query: 'astra ai', value: 50, formattedValue: '50', estDaily: 160 },
    ]);
    expect(e.tables.rising).toEqual([
      { rank: 1, query: 'astra ai', value: 250, formattedValue: '+250%', breakout: false, estDaily: 160 },
      { rank: 2, query: 'astra new', value: 5000, formattedValue: 'Breakout', breakout: true, estDaily: null },
    ]);
    expect(e.verdict).toMatchObject({ label: 'rising', confidence: 'mid', prioritize: true, reasons: ['Breakout related queries'] });
    expect(e.summary).toContain('Astra ≈ 319 searches/day (US·24h), 0.58× gpts; rising');
    expect(e.meta).toMatchObject({ cached: false, snapshotId: 'traffic-fixture', exploreUrl: expect.stringContaining('q=Astra') });
    expect(e.meta.warnings?.[0]).toContain('1 low-sample gap point');
    expect(Object.keys(e).slice(0, 3)).toEqual(['ok', 'schemaVersion', 'status']);
  });

  it('excludes anchor gaps from anchorLevel instead of dividing by the raw zero-inclusive mean', async () => {
    const e = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir: null });
    // Raw mean would be 66.67 and inflate traffic; gap-aware level is exactly 100.
    expect(e.anchor.level).toBe(100);
    expect(e.series.anchorPoints).toHaveLength(6);
    expect(e.traffic.average).toBe(319);
  });

  it('omits traffic when the anchor is sparse/near-zero and keeps a precise level + warning', async () => {
    const snap = fixture();
    const start = Date.parse('2026-10-31T00:00:00.000Z');
    snap.anchor = { term: 'gpts', points: Array.from({ length: 180 }, (_, i) => ({ time: new Date(start + i * 60000).toISOString(), value: i < 3 ? 11 : 0 })) };
    const e = await trafficSnapshotEnvelope(snap, { cached: false, ageMin: 0, chartDir: null });
    expect(e.anchor.level).toBe(0.18);
    expect(e.anchor.level).not.toBe(0);
    expect(e.anchor.ratio).toBeNull();
    expect(e.traffic).toEqual({ unit: 'searches/day', average: null, latest: null, settledLatest: null, peak: null, low: null, high: null, gapCount: 1 });
    expect(e.meta.warnings).toContain('anchor too sparse/weak for calibration; traffic omitted');
    expect(e.anchor.note).toContain('anchor too sparse/weak for calibration; traffic omitted');
    expect(e.tables.popular.every(r => r.estDaily === null)).toBe(true);
  });

  it('honors a matching baselines override', async () => {
    const e = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir: null,
      baselines: { version: 1, anchors: [{ term: 'gpts', dailySearches: 1000, geo: 'US', tolerance: 0.2 }], defaultAnchor: 'gpts' } });
    expect(e.anchor).toMatchObject({ dailySearches: 1000, tolerance: 0.2, level: 100, ratio: 0.58 });
    expect(e.traffic).toMatchObject({ average: 580, low: 464, high: 696 });
  });

  it('leaves traffic fields null and adds a note without matching non-US calibration', async () => {
    const snap = fixture();
    snap.filter = { ...snap.filter, geo: 'JP' };
    const e = await trafficSnapshotEnvelope(snap, { cached: false, ageMin: 0, chartDir: null });
    expect(e.anchor).toMatchObject({ dailySearches: null, tolerance: null, level: 100, ratio: 0.58, source: 'baseline' });
    expect(e.anchor.note).toContain('No calibration for geo JP');
    expect(e.traffic).toEqual({ unit: 'searches/day', average: null, latest: null, settledLatest: null, peak: null, low: null, high: null, gapCount: 1 });
    expect(e.tables.popular.every(r => r.estDaily === null)).toBe(true);
    expect(e.tables.rising.every(r => r.estDaily === null)).toBe(true);
    expect(e.meta.warnings).toContain('No anchor calibration for geo JP; traffic fields are null');
  });

  it('emits an inline SVG with term/anchor lines and writes the same file', async () => {
    const chartDir = temp();
    const e = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir, svg: true });
    expect(e.chart.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*<\/svg>$/);
    expect(e.chart.svg).toContain('class="term-line"');
    expect(e.chart.svg).toContain('class="anchor-line"');
    expect(e.chart.svg).toContain('stroke-dasharray="6 5"');
    expect(e.chart.svg).toContain('(UTC)');
    expect(e.chart.svg).toContain('10/31 00:00');
    expect(e.chart.svg).toContain('>05:00<');
    expect(e.chart.svg).toMatch(/peak 440 · 10\/31 05:00/);
    expect(e.chart.svg).toMatch(/latest 440 · 10\/31 05:00/);
    expect(e.chart.svg).not.toMatch(/NaN|undefined/);
    expect(e.chart.path).toBe(chartPath(chartDir, 'traffic-fixture'));
    expect(readFileSync(e.chart.path!, 'utf8')).toBe(e.chart.svg);
  });

  it('renders chart labels in an explicitly requested IANA time zone', async () => {
    const e = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir: null, svg: true, timeZone: 'Asia/Shanghai' });
    expect(e.chart.svg).toContain('Astra — searches/day (Asia/Shanghai)');
    expect(e.chart.svg).toContain('<title>Astra searches/day (Asia/Shanghai)</title>');
    expect(e.chart.svg).toContain('10/31 08:00');
    expect(e.chart.svg).toContain('>13:00<');
  });

  it('writes distinct chart files for different time zones of the same snapshot', async () => {
    const chartDir = temp();
    const utc = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir, week: weekFixture() });
    const shanghai = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir, week: weekFixture(), timeZone: 'Asia/Shanghai' });
    expect(utc.chart.path).toBe(chartPath(chartDir, 'traffic-fixture'));
    expect(utc.chart7d.path).toBe(chartPath(chartDir, 'traffic-fixture-7d'));
    expect(shanghai.chart.path).toBe(chartPath(chartDir, 'traffic-fixture', 'Asia/Shanghai'));
    expect(shanghai.chart7d.path).toBe(chartPath(chartDir, 'traffic-fixture-7d', 'Asia/Shanghai'));
    expect(new Set([utc.chart.path, utc.chart7d.path, shanghai.chart.path, shanghai.chart7d.path]).size).toBe(4);
  });

  it('keeps chart paths distinct for zones whose names differ only by sign', async () => {
    const chartDir = temp();
    const plus = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir, week: weekFixture(), timeZone: 'Etc/GMT+1' });
    const minus = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir, week: weekFixture(), timeZone: 'Etc/GMT-1' });
    expect(plus.chart.path).toBe(chartPath(chartDir, 'traffic-fixture', 'Etc/GMT+1'));
    expect(plus.chart7d.path).toBe(chartPath(chartDir, 'traffic-fixture-7d', 'Etc/GMT+1'));
    expect(minus.chart.path).toBe(chartPath(chartDir, 'traffic-fixture', 'Etc/GMT-1'));
    expect(minus.chart7d.path).toBe(chartPath(chartDir, 'traffic-fixture-7d', 'Etc/GMT-1'));
    expect(plus.chart.path).not.toBe(minus.chart.path);
    expect(plus.chart7d.path).not.toBe(minus.chart7d.path);
  });

  it('canonicalizes case-variant zone names for labels and chart paths', async () => {
    const chartDir = temp(), canonical = 'America/Catamarca';
    const base = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir, week: weekFixture(), svg: true, timeZone: 'America/Argentina/ComodRivadavia' });
    expect(base.chart.svg).toContain('Astra — searches/day (America/Catamarca)');
    expect(base.chart.path).toBe(chartPath(chartDir, 'traffic-fixture', canonical));
    for (const variant of ['aMerICA/ARgentInA/CoMODRIvadAViA', 'AmERICA/ArgentinA/COmODRIvadAVIa']) {
      const e = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir, week: weekFixture(), svg: true, timeZone: variant });
      expect(e.chart.svg).toContain('Astra — searches/day (America/Catamarca)');
      expect(e.chart.svg).toBe(base.chart.svg);
      expect(e.chart.path).toBe(base.chart.path);
      expect(e.chart7d.path).toBe(base.chart7d.path);
    }
  });

  it('honors GTFA_TZ for chart labels when no explicit time zone is given', async () => {
    process.env.GTFA_TZ = 'Asia/Shanghai';
    const e = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir: null, svg: true });
    expect(e.chart.svg).toContain('Astra — searches/day (Asia/Shanghai)');
    expect(e.chart.svg).toContain('10/31 08:00');
  });

  it('adds a calibrated now 7-d chart and traffic block alongside the primary window', async () => {
    const chartDir = temp();
    const e = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir, week: weekFixture(), svg: true });
    expect(e.traffic7d).toEqual({ unit: 'searches/day', average: 275, latest: 330, settledLatest: 440, peak: 440, low: 138, high: 413, gapCount: 1 });
    expect(e.chart7d.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*<\/svg>$/);
    expect(e.chart7d.svg).toContain('class="term-line"');
    expect(e.chart7d.svg).toContain('class="anchor-line"');
    expect(e.chart7d.svg).toContain('(UTC)');
    expect(e.chart7d.svg).not.toBe(e.chart.svg);
    expect(e.chart7d.path).toBe(chartPath(chartDir, 'traffic-fixture-7d'));
    expect(readFileSync(e.chart7d.path!, 'utf8')).toBe(e.chart7d.svg);
    expect(e.chart.path).toBe(chartPath(chartDir, 'traffic-fixture'));
  });

  it('always includes chart7d/traffic7d with a null fallback when the week snapshot is missing', async () => {
    const e = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir: null });
    expect(e.chart7d).toEqual({ svg: '', path: null });
    expect(e.traffic7d).toEqual({ unit: 'searches/day', average: null, latest: null, settledLatest: null, peak: null, low: null, high: null, gapCount: 0 });
    expect(e.meta.warnings).toContain('7-day window unavailable: no now 7-d snapshot');
    const failed = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir: null, weekError: 'upstream 503' });
    expect(failed.chart7d).toEqual({ svg: '', path: null });
    expect(failed.meta.warnings).toContain('7-day window unavailable: upstream 503');
  });

  it('breaks the dashed anchor line across anchor gaps instead of painting zeros', async () => {
    const e = await trafficSnapshotEnvelope(fixture(), { cached: false, ageMin: 0, chartDir: null, svg: true });
    // Anchor gaps at indices 1 and 4 split the dashed line; the only drawable
    // segment is the two non-gap points at indices 2 and 3.
    const anchorLine = e.chart.svg.match(/class="anchor-line" points="([^"]+)"/);
    expect(anchorLine?.[1].trim().split(/\s+/)).toHaveLength(2);
    expect(e.chart.svg).not.toMatch(/NaN|undefined/);
  });

  it('reuses the primary chart when the primary window is already now 7-d', async () => {
    const chartDir = temp();
    const e = await trafficSnapshotEnvelope(weekFixture(), { cached: false, ageMin: 0, chartDir });
    expect(e.chart7d).toEqual(e.chart);
    expect(e.traffic7d).toEqual(e.traffic);
    expect(e.traffic7d).toMatchObject({ average: 275, settledLatest: 440, gapCount: 1 });
    expect(e.chart7d.path).toBe(chartPath(chartDir, 'traffic-fixture-7d'));
  });
});

describe('partial snapshots and warnings', () => {
  const partialMeta = { fetchedAt: '2026-10-31T05:00:00.000Z', upstreamRequests: 2, durationMs: 1, warnings: ['related queries unavailable'] };
  it('preserves partial status and warnings in snapshotTerm and trends_ask', async () => {
    const query = vi.fn(async (input: unknown) => ({ status: 'partial' as const, input,
      data: { interestOverTime: { timeline: [{ time: '2026-10-31T00:00:00.000Z', values: [10] }, { time: '2026-10-31T01:00:00.000Z', values: [20] }] }, relatedQueries: { top: [], rising: [] }, interestBySubregion: { rows: [] } },
      meta: partialMeta }));
    const snap = await snapshotTerm('Astra', {}, { query: query as never });
    expect(snap.status).toBe('partial');
    expect(snap.warnings).toEqual(['related queries unavailable']);
    const e = askEnvelope(snap, { cached: false, ageMin: 0, diff: null });
    expect(e).toMatchObject({ ok: true, status: 'partial' });
    expect(e.meta.warnings).toContain('related queries unavailable');
  });

  it('preserves partial status and warnings in snapshotTrafficTerm and trends_snapshot', async () => {
    const query = vi.fn(async (input: unknown) => ({ status: 'partial' as const, input,
      data: { interestOverTime: { timeline: [{ time: '2026-10-31T00:00:00.000Z', values: [40, 100] }, { time: '2026-10-31T01:00:00.000Z', values: [60, 100] }] },
        relatedQueriesByQuery: [{ query: 'Astra', top: [], rising: [] }] },
      meta: partialMeta }));
    const snap = await snapshotTrafficTerm('Astra', { query: query as never });
    expect(snap.status).toBe('partial');
    expect(snap.warnings).toEqual(['related queries unavailable']);
    const e = await trafficSnapshotEnvelope(snap, { cached: false, ageMin: 0, chartDir: null });
    expect(e).toMatchObject({ ok: true, status: 'partial' });
    expect(e.meta.warnings).toContain('related queries unavailable');
    expect(e.chart7d).toEqual({ svg: '', path: null });
    expect(e.traffic7d).toMatchObject({ average: null, gapCount: 0 });
  });
});

describe('trends_snapshot 7-day fetch', () => {
  it('loads the primary and now 7-d windows together when primary is 1-d', async () => {
    const chartDir = temp(), store = new SnapshotStore(temp());
    const query = vi.fn(async (input: { timeRange?: string }) => timelineFor(input.timeRange === 'now 7-d' ? weekFixture() : fixture()));
    const r = await fetchTrafficSnapshot('Astra', { filter: { time: 'now 1-d' }, store, query: query as never });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.map(([input]) => (input as { timeRange?: string }).timeRange).sort()).toEqual(['now 1-d', 'now 7-d']);
    expect(r.snapshot.filter.time).toBe('now 1-d');
    expect(r.week?.filter.time).toBe('now 7-d');
    const e = await trafficSnapshotEnvelope(r.snapshot, { cached: r.source === 'cache', ageMin: r.ageMin, chartDir, week: r.week, svg: true });
    expect(e.chart.svg).not.toBe(e.chart7d?.svg);
    expect(e.traffic7d).toMatchObject({ average: 275, gapCount: 1 });
    expect(e.chart.path).not.toBe(e.chart7d?.path);
  });

  it('rejects an invalid IANA time zone before querying upstream', async () => {
    const store = new SnapshotStore(temp()), query = vi.fn();
    await expect(fetchTrafficSnapshot('Astra', { filter: { time: 'now 1-d' }, store, query: query as never, timeZone: 'Not/AZone' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(query).not.toHaveBeenCalled();
  });

  it('makes no duplicate upstream call when primary is already now 7-d', async () => {
    const chartDir = temp(), store = new SnapshotStore(temp());
    const query = vi.fn(async (input: { timeRange?: string }) => timelineFor(input.timeRange === 'now 7-d' ? weekFixture() : fixture()));
    const r = await fetchTrafficSnapshot('Astra', { filter: { time: 'now 7-d' }, store, query: query as never });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatchObject({ timeRange: 'now 7-d' });
    expect(r.week).toBe(r.snapshot);
    const e = await trafficSnapshotEnvelope(r.snapshot, { cached: r.source === 'cache', ageMin: r.ageMin, chartDir, week: r.week });
    expect(e.chart7d).toEqual(e.chart);
    expect(e.traffic7d).toEqual(e.traffic);
  });
});

describe('trends_snapshot schema and CLI', () => {
  it('rejects missing/invalid input with the shared envelope and no network', async () => {
    const transport = vi.fn<Transport>();
    const client = await connect({ snapshotDir: temp(), chartDir: temp(), transport });
    for (const args of [{}, { term: '' }, { term: 'Astra', time: 'now 2-H' }, { term: 'Astra', tz: 'Not/AZone' }]) {
      const r = await client.callTool({ name: 'trends_snapshot', arguments: args });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ ok: false, schemaVersion: SCHEMA_VERSION, status: 'error', error: { code: 'INVALID_INPUT' }, meta: { upstreamRequests: 0 } });
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('serves a saved snapshot through the MCP tool and writes the chart', async () => {
    const storeDir = temp(), chartDir = temp();
    const snap = fixture(), week = weekFixture(), now = new Date().toISOString();
    snap.fetchedAt = now; week.fetchedAt = now;
    await new SnapshotStore(storeDir).save(snap);
    await new SnapshotStore(storeDir).save(week);
    const client = await connect({ snapshotDir: storeDir, chartDir });
    const r = await client.callTool({ name: 'trends_snapshot', arguments: { term: 'Astra' } });
    expect(r.isError).not.toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: true, schemaVersion: SCHEMA_VERSION, status: 'ok', term: 'Astra', traffic: { average: 319 }, traffic7d: { average: 275 }, anchor: { term: 'gpts', dailySearches: 550 }, meta: { cached: true } });
    expect((r.structuredContent as { chart: { path: string } }).chart.path).toBe(chartPath(chartDir, 'traffic-fixture'));
    expect((r.structuredContent as { chart7d: { path: string } }).chart7d.path).toBe(chartPath(chartDir, 'traffic-fixture-7d'));
    expect((r.structuredContent as { chart: { svg: string } }).chart.svg).toBe('');
    expect((r.structuredContent as { chart7d: { svg: string } }).chart7d.svg).toBe('');
    expect(JSON.parse((r.content as { text: string }[])[0].text)).toEqual(r.structuredContent);
    const withSvg = await client.callTool({ name: 'trends_snapshot', arguments: { term: 'Astra', svg: true } });
    expect((withSvg.structuredContent as { chart: { svg: string } }).chart.svg).toContain('<svg');
    expect((withSvg.structuredContent as { chart7d: { svg: string } }).chart7d.svg).toContain('<svg');
  });

  it('CLI snapshot --json emits the same envelope shape as MCP', async () => {
    const storeDir = temp(), chartDir = temp();
    const snap = fixture(), week = weekFixture(), now = new Date().toISOString();
    snap.fetchedAt = now; week.fetchedAt = now;
    await new SnapshotStore(storeDir).save(snap);
    await new SnapshotStore(storeDir).save(week);
    const query = vi.fn();
    const r = await runSnapshotCli(['Astra', '--json', '--store', storeDir, '--chart-dir', chartDir], { query: query as never });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ ok: true, schemaVersion: 1, status: 'ok', term: 'Astra', traffic: { average: 319, settledLatest: 330 }, traffic7d: { average: 275, settledLatest: 440 }, anchor: { term: 'gpts', dailySearches: 550 }, meta: { cached: true } });
    expect(Object.keys(out).slice(0, 3)).toEqual(['ok', 'schemaVersion', 'status']);
    expect(out.chart.path).toBe(chartPath(chartDir, 'traffic-fixture'));
    expect(out.chart7d.path).toBe(chartPath(chartDir, 'traffic-fixture-7d'));
    expect(out.chart.svg).toBe('');
    expect(out.chart7d.svg).toBe('');
    expect(query).not.toHaveBeenCalled();
    const withSvg = await runSnapshotCli(['Astra', '--json', '--svg', '--store', storeDir, '--chart-dir', chartDir], { query: query as never });
    expect(JSON.parse(withSvg.stdout).chart.svg).toContain('<svg');
    expect(JSON.parse(withSvg.stdout).chart7d.svg).toContain('<svg');
  });

  it('CLI snapshot --tz renders the requested zone and uses GTFA_TZ when --tz is absent', async () => {
    const storeDir = temp(), chartDir = temp();
    const snap = fixture(), week = weekFixture(), now = new Date().toISOString();
    snap.fetchedAt = now; week.fetchedAt = now;
    await new SnapshotStore(storeDir).save(snap);
    await new SnapshotStore(storeDir).save(week);
    const query = vi.fn();
    const shanghai = await runSnapshotCli(['Astra', '--json', '--svg', '--tz', 'Asia/Shanghai', '--store', storeDir, '--chart-dir', chartDir], { query: query as never });
    expect(shanghai.code).toBe(0);
    expect(JSON.parse(shanghai.stdout).chart.svg).toContain('Astra — searches/day (Asia/Shanghai)');
    expect(JSON.parse(shanghai.stdout).chart.svg).toContain('10/31 08:00');
    expect(JSON.parse(shanghai.stdout).chart.path).toBe(chartPath(chartDir, 'traffic-fixture', 'Asia/Shanghai'));
    expect(JSON.parse(shanghai.stdout).chart7d.path).toBe(chartPath(chartDir, 'traffic-fixture-7d', 'Asia/Shanghai'));
    process.env.GTFA_TZ = 'Asia/Shanghai';
    const fromEnv = await runSnapshotCli(['Astra', '--json', '--svg', '--store', storeDir, '--chart-dir', chartDir], { query: query as never });
    expect(fromEnv.code).toBe(0);
    expect(JSON.parse(fromEnv.stdout).chart.svg).toContain('Astra — searches/day (Asia/Shanghai)');
    expect(query).not.toHaveBeenCalled();
  });

  it('CLI snapshot --tz rejects an invalid IANA zone with INVALID_INPUT', async () => {
    const r = await runSnapshotCli(['Astra', '--json', '--tz', 'Not/AZone']);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, schemaVersion: 1, status: 'error', error: { code: 'INVALID_INPUT' } });
  });

  it('CLI snapshot --json returns INVALID_INPUT for bad flags', async () => {
    const r = await runSnapshotCli(['Astra', '--json', '--bogus']);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, schemaVersion: 1, status: 'error', error: { code: 'INVALID_INPUT' } });
  });
});
