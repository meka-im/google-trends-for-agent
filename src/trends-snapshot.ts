import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { queryTrends, type TrendsResponse } from './api.js';
import { renderTrafficChart, type TrafficChartPoint } from './chart.js';
import { filterInput, resolveFilter, settledPoints, type TrendsFilter } from './filter.js';
import { settledNonGapPoints } from './gaps.js';
import { SnapshotStore, type TermSnapshot } from './snapshot.js';
import { anchorDailySearches, DEFAULT_ANCHOR, findAnchor, type Baselines } from './traffic.js';
import { calibrateTraffic, nullTraffic, round2 } from './calibration.js';
import type { InterestOverTime, RelatedQueries } from './core.js';
import { resolveTimeZone } from './timezone.js';

export interface TrafficSnapshotOptions {
  filter?: Partial<TrendsFilter>;
  anchor?: string;
  store?: SnapshotStore;
  maxAgeMin?: number;
  refresh?: 'if-stale' | 'never' | 'always';
  query?: typeof queryTrends;
  /** IANA time zone for chart labels; defaults to GTFA_TZ, then UTC. */
  timeZone?: string;
}
export interface TrafficSnapshotResult {
  snapshot: TermSnapshot;
  source: 'live' | 'cache';
  ageMin: number;
  /** Extra now 7-d snapshot when the primary window is not already now 7-d. */
  week?: TermSnapshot;
  /** Non-fatal failure of the extra 7-day fetch; the primary snapshot still succeeds. */
  weekError?: string;
}
export interface TrafficEnvelopeOptions {
  cached: boolean;
  ageMin: number;
  baselines?: Baselines;
  /** Directory for the inline SVG copies; null disables writing. Default `.gtfa/charts`. */
  chartDir?: string | null;
  /** Extra now 7-d snapshot; when omitted, a now 7-d primary is reused for chart7d. */
  week?: TermSnapshot;
  /** Non-fatal failure of the extra 7-day fetch (adds a warning). */
  weekError?: string;
  /** Embed inline SVG text (default false: chart/chart7d keep `svg: ""` and `path`). */
  svg?: boolean;
  /** IANA time zone for chart labels; defaults to GTFA_TZ, then UTC. */
  timeZone?: string;
}

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const chartZoneSlug = (timeZone: string) => {
  const base = timeZone.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'utc';
  const hash = createHash('sha1').update(timeZone).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
};
const round = (n: number) => Math.round(n);
const compact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(Math.round(n));
const shortTime = (time: string) => ({
  'now 1-H': '1h', 'now 4-H': '4h', 'now 1-d': '24h', 'now 7-d': '7d',
  'today 1-m': '1m', 'today 3-m': '3m', 'today 12-m': '12m', 'today 5-y': '5y', all: 'all',
} as Record<string, string>)[time] ?? time;
const errorNote = (e?: TrendsResponse['error']) => e ? { error: { code: e.code, message: e.message, ...(e.retryAfterSec !== undefined ? { retryAfterSec: e.retryAfterSec } : {}) } } : {};

/** Fresh-spike heuristic shared with trends_ask validation (short windows only). */
function detectSpike(values: number[], filter: Pick<TrendsFilter, 'time'>): { ratio: number; baseline: number; recent: number } | undefined {
  if (!/^now \d+-[dH]$/.test(filter.time) || /^now 7-d$/.test(filter.time) || values.length < 8) return;
  const recentVals = values.slice(-2), base = mean(values.slice(0, -2)), recent = Math.max(mean(recentVals), recentVals[recentVals.length - 1]);
  if (recent >= 20 && recent >= base + 15 && recent >= 3 * Math.max(base, 1)) return { ratio: recent / Math.max(base, 1), baseline: base, recent };
}

/** Fetch the shared-scale term+anchor comparison and the term's related queries in one logical query. */
export async function snapshotTrafficTerm(term: string, opts: TrafficSnapshotOptions = {}): Promise<TermSnapshot> {
  resolveTimeZone(opts.timeZone);
  const filter = resolveFilter(opts.filter), query = opts.query ?? queryTrends, anchorTerm = opts.anchor?.trim() || DEFAULT_ANCHOR.term;
  const same = term.trim() === anchorTerm.trim();
  let r: TrendsResponse;
  try { r = await query({ queries: same ? [term] : [term, anchorTerm], ...filterInput(filter), dataTypes: ['interestOverTime', 'relatedQueries'] }); }
  catch (e) { r = { status: 'error', input: term, error: { code: 'NETWORK_ERROR', message: String(e) }, meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 0, durationMs: 0, warnings: [] } }; }
  const timeline = (r.data?.interestOverTime as InterestOverTime | undefined)?.timeline ?? [];
  const anchorIndex = same ? 0 : 1;
  const points = timeline.map(p => ({ time: p.time, value: p.values[0] ?? 0 }));
  const anchorPoints = timeline.map(p => ({ time: p.time, value: p.values[anchorIndex] ?? 0 }));
  const byQuery = r.data?.relatedQueriesByQuery as { query: string; top: RelatedQueries['top'] | null; rising: RelatedQueries['rising'] | null }[] | undefined;
  const first = byQuery?.[0];
  const single = r.data?.relatedQueries as RelatedQueries | undefined;
  const related = { top: first?.top ?? single?.top ?? [], rising: first?.rising ?? single?.rising ?? [] };
  return {
    schema: 'term-snapshot/1', id: randomUUID(), term, filter, fetchedAt: r.meta.fetchedAt,
    status: ['BLOCKED', 'RATE_LIMITED'].includes(r.error?.code ?? '') ? 'blocked' : r.status === 'partial' ? 'partial' : r.status === 'error' ? 'error' : points.some(p => p.value > 0) ? 'ok' : 'no_data',
    ...(r.error ? { error: r.error } : {}),
    ...(r.meta.warnings.length ? { warnings: [...r.meta.warnings] } : {}),
    interest: { points, latest: points.at(-1)?.value ?? 0, peak: Math.max(0, ...points.map(p => p.value)), settledLatest: settledPoints(points, filter).at(-1)?.value ?? 0 },
    anchor: { term: anchorTerm, points: anchorPoints },
    popular: related.top.map((p, i) => ({ rank: i + 1, query: p.query, value: p.value })),
    rising: related.rising.map((p, i) => ({ rank: i + 1, query: p.query, value: p.value, formattedValue: p.formattedValue, breakout: /breakout/i.test(p.formattedValue) })),
    regions: [],
  };
}

async function fetchOne(term: string, opts: TrafficSnapshotOptions, store: SnapshotStore, filter: TrendsFilter, anchorTerm: string): Promise<Omit<TrafficSnapshotResult, 'week' | 'weekError'>> {
  const old = (await store.history(term, filter, 1, anchorTerm))[0], age = old ? Math.max(0, (Date.now() - Date.parse(old.fetchedAt)) / 60000) : Infinity;
  if (old && (old.status === 'ok' || old.status === 'no_data') && (opts.refresh === 'never' || opts.refresh !== 'always' && age <= (opts.maxAgeMin ?? 360))) return { snapshot: old, source: 'cache' as const, ageMin: age };
  if (opts.refresh === 'never') throw new Error('no cached snapshot');
  const snapshot = await snapshotTrafficTerm(term, { ...opts, filter, anchor: anchorTerm });
  await store.save(snapshot);
  return { snapshot, source: 'live' as const, ageMin: Math.max(0, (Date.now() - Date.parse(snapshot.fetchedAt)) / 60000) };
}

/** Cached snapshot fetch for trends_snapshot / CLI snapshot (same 360-minute default as ask).
 * Also loads a now 7-d comparison in parallel unless the primary window already is now 7-d. */
export async function fetchTrafficSnapshot(term: string, opts: TrafficSnapshotOptions = {}): Promise<TrafficSnapshotResult> {
  resolveTimeZone(opts.timeZone);
  const store = opts.store ?? new SnapshotStore(), filter = resolveFilter(opts.filter), anchorTerm = opts.anchor?.trim() || DEFAULT_ANCHOR.term;
  const primary = fetchOne(term, opts, store, filter, anchorTerm);
  if (filter.time === 'now 7-d') {
    const result = await primary;
    return { ...result, week: result.snapshot };
  }
  let weekError: string | undefined;
  const week = fetchOne(term, opts, store, { ...filter, time: 'now 7-d' }, anchorTerm)
    .catch(e => { weekError = e instanceof Error ? e.message : String(e); return undefined; });
  const [result, weekResult] = await Promise.all([primary, week]);
  return { ...result, ...(weekResult ? { week: weekResult.snapshot } : {}), ...(weekError ? { weekError } : {}) };
}

/** Calibrate one shared-scale snapshot into traffic, series points and an inline SVG. */
function calibrate(snap: TermSnapshot, opts: TrafficEnvelopeOptions) {
  const filter = snap.filter;
  const anchorTerm = snap.anchor?.term ?? DEFAULT_ANCHOR.term;
  const calibration = findAnchor(opts.baselines, anchorTerm, filter.geo);
  const daily = calibration ? anchorDailySearches(calibration) : null;
  const tolerance = daily === null ? null : calibration?.tolerance ?? DEFAULT_ANCHOR.tolerance ?? .5;
  const c = calibrateTraffic(snap.interest.points, snap.anchor?.points ?? [], { filter, dailySearches: daily, tolerance });
  const anchor = {
    term: anchorTerm,
    dailySearches: daily === null ? null : round(daily),
    tolerance,
    level: c.anchorSampleCount ? round2(c.anchorLevel) : null,
    ratio: c.ratio,
    source: 'baseline' as const,
    note: c.note,
  };
  const chartPoints: TrafficChartPoint[] = c.termMarked.map((p, i) => ({ t: p.time, traffic: c.seriesTraffic[i], ...(p.gap ? { gap: true } : {}) }));
  const anchorChartPoints: TrafficChartPoint[] = c.anchorMarked.map((p, i) => ({ t: p.time, traffic: p.gap ? null : c.anchorTraffic[i], ...(p.gap ? { gap: true } : {}) }));
  const svg = renderTrafficChart({ term: snap.term, points: chartPoints, anchorPoints: anchorChartPoints, ...(opts.timeZone !== undefined ? { timeZone: opts.timeZone } : {}) });
  return {
    filter, anchorTerm, daily, tolerance, termMarked: c.termMarked, anchorMarked: c.anchorMarked,
    anchorKept: c.anchorKept, anchorLevel: c.anchorLevel, kept: c.kept, factor: c.factor,
    trafficAverage: c.traffic.average, gapCount: c.traffic.gapCount, traffic: c.traffic, anchor,
    seriesTraffic: c.seriesTraffic, anchorTraffic: c.anchorTraffic, svg,
    ...(c.warning ? { warning: c.warning } : {}),
  };
}

function verdictFor(snap: TermSnapshot, traffic: { settledLatest: number | null }) {
  const values = settledNonGapPoints(snap.interest.points, snap.filter).map(p => p.value);
  const reasons: string[] = [];
  if (snap.status === 'blocked') { reasons.push(snap.error?.code ?? 'BLOCKED'); return { label: 'no_data' as const, confidence: 'low' as const, reasons, prioritize: false }; }
  if (snap.status === 'error' || !values.some(v => v > 0)) { reasons.push(snap.error?.message ?? 'No settled search interest'); return { label: 'no_data' as const, confidence: 'low' as const, reasons, prioritize: false }; }
  const spike = detectSpike(values, snap.filter);
  let label: 'rising' | 'spiking' | 'steady' | 'fading' = 'steady';
  if (spike) { label = 'spiking'; reasons.push(`Fresh spike: last points avg ${spike.recent.toFixed(0)} vs earlier avg ${spike.baseline.toFixed(1)} (${spike.ratio.toFixed(1)}×)`); }
  else {
    const split = Math.ceil(values.length / 2), early = mean(values.slice(0, split)), tail = mean(values.slice(split));
    if (snap.rising.some(r => r.breakout)) { label = 'rising'; reasons.push('Breakout related queries'); }
    else if (values.length >= 2 && tail >= 1.5 * early) { label = 'rising'; reasons.push('Settled tail mean >= 1.5 × earlier mean'); }
    else if (early > 0 && tail <= .67 * early) { label = 'fading'; reasons.push('Settled tail mean <= 0.67 × earlier mean'); }
    else if (Math.max(...values) >= 10 && tail >= early) { label = 'steady'; reasons.push('Settled peak >= 10 with no decline'); }
    else reasons.push('Insufficient sustained rise or decline');
  }
  const confidence = label === 'spiking' ? 'mid' : values.length >= 12 ? 'high' : values.length >= 4 ? 'mid' : 'low';
  return { label, confidence, reasons, prioritize: typeof traffic.settledLatest === 'number' && traffic.settledLatest >= 300 };
}

/** Convert the shared-scale comparison into an agent-facing traffic envelope and write the SVG copies. */
export async function trafficSnapshotEnvelope(snap: TermSnapshot, opts: TrafficEnvelopeOptions) {
  const warnings: string[] = [];
  const timeZone = resolveTimeZone(opts.timeZone);
  const chartOptions = { ...opts, timeZone };
  const zoneSlug = chartZoneSlug(timeZone);
  const primary = calibrate(snap, chartOptions);
  // Primary now 7-d is already the week curve: reuse it and avoid a duplicate upstream call.
  const weekSnap = snap.filter.time === 'now 7-d' ? snap : opts.week;
  const week = weekSnap ? (weekSnap === snap ? primary : calibrate(weekSnap, chartOptions)) : undefined;
  const filter = snap.filter, anchorTerm = primary.anchorTerm, traffic = primary.traffic;
  if (primary.gapCount) warnings.push(`${primary.gapCount} low-sample gap point${primary.gapCount === 1 ? '' : 's'} in interest series (zero values between nonzero points) excluded from aggregates and verdict`);
  if (primary.daily === null) warnings.push(`No anchor calibration for geo ${filter.geo}; traffic fields are null`);
  else if (primary.warning) warnings.push(primary.warning);
  if (snap.warnings?.length) warnings.push(...snap.warnings);
  if (weekSnap && weekSnap !== snap) {
    if (weekSnap.status === 'error') warnings.push(`7-day window failed: ${weekSnap.error?.message ?? 'error'}`);
    else if (weekSnap.status === 'blocked') warnings.push(`7-day window blocked: ${weekSnap.error?.message ?? 'blocked'}`);
    if (weekSnap.warnings?.length) warnings.push(...weekSnap.warnings);
    if (week?.warning) warnings.push(`7-day ${week.warning}`);
  }
  if (opts.weekError) warnings.push(`7-day window unavailable: ${opts.weekError}`);
  else if (!weekSnap) warnings.push('7-day window unavailable: no now 7-d snapshot');
  const terms = {
    popular: snap.popular.map(r => ({ rank: r.rank, query: r.query, value: r.value, formattedValue: String(r.value), estDaily: primary.trafficAverage === null ? null : round(r.value / 100 * primary.trafficAverage) })),
    rising: snap.rising.map(r => {
      const formatted = r.formattedValue ?? (r.breakout ? 'Breakout' : `+${r.value}%`);
      const match = snap.popular.find(p => p.query.trim().toLowerCase() === r.query.trim().toLowerCase());
      const estDaily = match && primary.trafficAverage !== null ? round(match.value / 100 * primary.trafficAverage) : null;
      return { rank: r.rank, query: r.query, value: r.value, formattedValue: formatted, breakout: r.breakout, estDaily };
    }),
  };
  const verdict = verdictFor(snap, traffic);
  let chartWarning = false;
  const writeChart = async (svg: string, id: string) => {
    if (opts.chartDir === null) return null;
    try {
      const dir = opts.chartDir ?? '.gtfa/charts';
      const path = join(dir, `${id}-${zoneSlug}.svg`);
      await mkdir(dir, { recursive: true });
      await writeFile(path, svg);
      return path;
    } catch {
      if (!chartWarning) { warnings.push('chart file could not be written; chart.svg is empty unless svg=true'); chartWarning = true; }
      return null;
    }
  };
  const chartPath = await writeChart(primary.svg, snap.id);
  const weekChartPath = week ? (weekSnap === snap ? chartPath : await writeChart(week.svg, weekSnap!.id)) : null;
  const includeSvg = opts.svg === true;
  const chart = { svg: includeSvg ? primary.svg : '', path: chartPath };
  const chart7d = week ? (weekSnap === snap ? chart : { svg: includeSvg ? week.svg : '', path: weekChartPath }) : { svg: '', path: null };
  const traffic7d = week ? week.traffic : nullTraffic();
  const ok = ['ok', 'no_data', 'partial'].includes(snap.status);
  const dailyLabel = primary.trafficAverage === null ? 'no calibrated traffic' : `≈ ${compact(primary.trafficAverage)} searches/day`;
  const ratioLabel = primary.anchor.ratio === null ? '' : `, ${primary.anchor.ratio}× ${anchorTerm}`;
  const summary = ok
    ? `${snap.term} ${dailyLabel} (${filter.geo}·${shortTime(filter.time)})${ratioLabel}; ${verdict.label}`
    : `${snap.term}: ${snap.status}`;
  return {
    ok, schemaVersion: 1 as const, status: snap.status, term: snap.term, summary,
    filter: { geo: filter.geo, time: filter.time, category: filter.category, property: filter.property || 'web' },
    anchor: primary.anchor, traffic,
    series: {
      points: primary.termMarked.map((p, i) => ({ t: p.time, score: p.value, traffic: primary.seriesTraffic[i], ...(p.gap ? { gap: true } : {}) })),
      anchorPoints: primary.anchorMarked.map(p => ({ t: p.time, score: p.value })),
    },
    chart,
    chart7d, traffic7d,
    tables: terms,
    verdict,
    ...errorNote(snap.error),
    meta: {
      cached: opts.cached, ageMin: Math.round(opts.ageMin * 10) / 10, fetchedAt: snap.fetchedAt, snapshotId: snap.id,
      exploreUrl: 'https://trends.google.com/trends/explore?' + new URLSearchParams({ q: snap.term, geo: filter.geo, date: filter.time, cat: String(filter.category), gprop: filter.property || 'web' }),
      ...(warnings.length ? { warnings } : {}),
    },
  };
}

/** Failure envelope used by the CLI/MCP wrapper for unexpected (non-upstream) errors. */
export function trafficSnapshotError(term: string, message: string, filter: Partial<TrendsFilter> = {}) {
  const f = resolveFilter(filter);
  return {
    ok: false as const, schemaVersion: 1 as const, status: 'error' as const,
    error: { code: 'INVALID_INPUT' as const, message },
    meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 0, durationMs: 0, warnings: [] as string[], term, filter: { geo: f.geo, time: f.time } },
  };
}
