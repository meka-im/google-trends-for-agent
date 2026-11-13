import { z } from 'zod';
import { validateTerms, type TermVerdict } from './validate.js';
import { askTerm, SnapshotStore, diffSnapshots, type TermSnapshot } from './snapshot.js';
import type { InterestOverTime } from './core.js';
import type { TrendsResponse } from './api.js';
import { TrendsClient, type ClientOptions } from './client.js';
import { queryTrends, compareTrends } from './api.js';
import { TIME_RANGES } from './core.js';
import { fetchTrending, listTrending, type TrendingHours, type TrendingResponse } from './trending.js';
import { TRENDING_GEOS, DEFAULT_TRENDING_GEOS, normalizeTrendingGeos } from './geos.js';
import { createDefaultTransport, RateLimiter, throwIfAborted, type Transport } from './transport.js';
import { detectGaps, summarizeInterest } from './gaps.js';
import { fetchTrafficSnapshot, trafficSnapshotEnvelope, trafficSnapshotError } from './trends-snapshot.js';
import type { Baselines } from './traffic.js';

const guidance = ' Light use only. On BLOCKED stop and report. On RATE_LIMITED wait retryAfterSec before a bounded retry; if absent, back off conservatively.';
const hours = z.union([z.literal(4), z.literal(24), z.literal(48), z.literal(168)]);
const nonnegative = z.number().int().nonnegative().safe();
const time = z.enum(TIME_RANGES);

/** Output schema version shared by all four tools. */
export const SCHEMA_VERSION = 1;
/** Shared defaults for every tool: US, past 24 hours, web search, all categories. */
export const DEFAULTS = { geo: 'US', time: 'now 1-d', property: '', category: 0 } as const;

/** The shared tool error envelope for arguments rejected before a request. */
export function invalidInputEnvelope(message: string) {
  return {
    ok: false as const, schemaVersion: SCHEMA_VERSION, status: 'error' as const,
    error: { code: 'INVALID_INPUT' as const, message: message || 'invalid input' },
    meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 0, durationMs: 0, warnings: [] as string[] },
  };
}

/** Normalize an MCP SDK schema-rejection message into the shared tool envelope. */
export function schemaRejectionEnvelope(message: string) {
  const cleaned = message
    .replace(/^MCP error -\d+:\s*/, '')
    .replace(/^Input validation error:\s*/i, '')
    .replace(/^Invalid arguments for tool [^:]+:\s*/i, '');
  return invalidInputEnvelope(cleaned || message);
}

/** Normalize a Zod parse failure into the same envelope. */
export function zodRejectionEnvelope(error: z.ZodError) {
  const issue = error.issues[0];
  const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  return invalidInputEnvelope(path + (issue?.message || 'invalid input'));
}

/** Context supplied by each transport adapter for one tool invocation. */
export interface ToolCallContext { signal?: AbortSignal }

/** Options read at call time by the dsh plugin so `.volatile()` settings apply without a restart. */
export interface ToolLiveSettings {
  /** Default geo for trends_ask/trends_compare/trends_snapshot. */
  defaultGeo?: string;
  /** Server-wide anchor override for validate/trends_snapshot. */
  anchor?: string;
  /** Optional calibration overrides. */
  baselines?: Baselines;
  /** Reuse saved snapshots (default true); false forces a fresh upstream fetch. */
  cache?: boolean;
  /** Snapshot storage directory. */
  snapshotDir?: string;
  /** Chart output directory; null disables chart files. */
  chartDir?: string | null;
}

/** Options shared by the MCP and dsh adapters. */
export interface ToolsOptions extends ClientOptions {
  /** Snapshot storage shared by trends_ask and trends_snapshot (default `.gtfa/snapshots`). */
  snapshotDir?: string;
  /** Chart directory for trends_snapshot (default `.gtfa/charts`; null disables files). */
  chartDir?: string | null;
  /** Optional calibration overrides; the built-in US anchors (gpts, sudoku) are always available. */
  baselines?: Baselines;
  /** Default geo for trends_ask/trends_compare/trends_snapshot (default US). */
  defaultGeo?: string;
  /** Server-wide anchor for validate/trends_snapshot (a per-call trends_snapshot anchor still wins); unset = automatic by window. */
  anchor?: string;
  /** Live values for the dsh settings UI; overrides the static fields above per call. */
  settings?: () => ToolLiveSettings;
}

/** One transport-neutral agent tool: the single source for MCP and dsh. */
export interface GtfaTool {
  name: (typeof PRIMARY_TOOLS)[number];
  description: string;
  inputSchema: z.ZodType<unknown>;
  execute(input: unknown, context?: ToolCallContext): Promise<Record<string, unknown>>;
}

function response(result: Record<string, unknown>) { return result; }
const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null;
const err = (e?: TrendsResponse['error']) => e ? { error: { code: e.code, message: e.message, ...(e.retryAfterSec !== undefined ? { retryAfterSec: e.retryAfterSec } : {}) } } : {};

/** Convert a validation row to the verdict object embedded in trends_ask. */
export function verdictEnvelope(v: TermVerdict): Record<string, unknown> {
  return { label: v.verdict, confidence: v.confidence, reasons: v.reasons, traffic: v.anchor.traffic, anchor: { term: v.anchor.term, dailySearches: v.anchor.dailySearches, ratio: v.anchor.ratio, band: v.anchor.band, note: v.anchor.note }, ...(v.anchor.warning ? { warnings: [v.anchor.warning] } : {}), ...(v.freshSpike ? { freshSpike: v.freshSpike } : {}), ...(v.trendingNow ? { trendingNow: v.trendingNow } : {}), ...(v.retryAfterSec !== undefined ? { retryAfterSec: v.retryAfterSec } : {}) };
}
/** Map a term snapshot (plus optional verdict/diff) to the stable trends_ask envelope.
 * Full interest points are omitted by default to keep agent context small; pass
 * `includePoints: true` (MCP `points` / CLI `--points`) to include them. */
export function askEnvelope(snap: TermSnapshot, extra: { cached: boolean; ageMin: number; verdict?: Record<string, unknown>; diff: unknown; diffReason?: string; includePoints?: boolean; warnings?: string[] }) {
  const ok = ['ok', 'no_data', 'partial'].includes(snap.status);
  const interest = summarizeInterest(snap.interest.points, snap.filter);
  const warnings: string[] = [];
  if (interest.gapCount) warnings.push(`${interest.gapCount} low-sample gap point${interest.gapCount === 1 ? '' : 's'} in interest series (zero values between nonzero points) excluded from aggregates and verdict`);
  if (snap.warnings?.length) warnings.push(...snap.warnings);
  if (extra.warnings?.length) warnings.push(...extra.warnings);
  return {
    ok, schemaVersion: SCHEMA_VERSION, status: snap.status, term: snap.term,
    summary: ok ? `${snap.term}: latest ${interest.settledLatest}, peak ${interest.peak}; ${snap.popular.length} popular, ${snap.rising.length} rising` + (snap.rising[0] ? `; top rising "${snap.rising[0].query}"` : '') : `${snap.term}: ${snap.status}`,
    filter: { geo: snap.filter.geo, time: snap.filter.time, category: snap.filter.category, property: snap.filter.property || 'web' },
    interest: { ...(extra.includePoints ? { points: interest.points.map(p => ({ t: p.time, value: p.value, ...(p.gap ? { gap: true } : {}) })) } : {}), average: interest.average, latest: interest.latest, settledLatest: interest.settledLatest, peak: interest.peak, gapCount: interest.gapCount },
    tables: {
      popular: snap.popular.map(r => ({ rank: r.rank, query: r.query, value: r.value, formattedValue: String(r.value) })),
      rising: snap.rising.map(r => ({ rank: r.rank, query: r.query, value: r.value, formattedValue: r.breakout ? 'Breakout' : `+${r.value}%`, breakout: r.breakout })),
    },
    regions: snap.regions.map(r => ({ geo: r.code, name: r.name, value: r.value })),
    ...(extra.verdict ? { verdict: extra.verdict } : {}),
    diff: extra.diff ?? null, ...(extra.diffReason ? { diffReason: extra.diffReason } : {}),
    ...err(snap.error),
    meta: { cached: extra.cached, ageMin: Math.round(extra.ageMin * 10) / 10, fetchedAt: snap.fetchedAt, snapshotId: snap.id,
      exploreUrl: 'https://trends.google.com/trends/explore?' + new URLSearchParams({ q: snap.term, geo: snap.filter.geo, date: snap.filter.time }),
      ...(warnings.length ? { warnings } : {}) },
  };
}
/** If the verdict is blocked (e.g. anchor comparison blocked/rate-limited) while the term snapshot was fine, mark the envelope failed so agents back off. */
export function blockedVerdict<T extends { ok: boolean; verdict?: Record<string, unknown>; meta?: unknown }>(env: T): T | (Omit<T, 'ok'> & { ok: false; status: 'blocked'; error: { code: string; message: string; retryAfterSec?: number } }) {
  const v = env.verdict;
  if (!env.ok || v?.label !== 'blocked') return env;
  const reasons = (v.reasons as string[] | undefined) ?? [], code = [...reasons].reverse().find(r => r === 'BLOCKED' || r === 'RATE_LIMITED') ?? 'BLOCKED';
  const { meta, ...rest } = env;
  return { ...rest, ok: false, status: 'blocked', error: { code, message: (v.anchor as { note?: string } | undefined)?.note || 'validation blocked', ...(typeof v.retryAfterSec === 'number' ? { retryAfterSec: v.retryAfterSec } : {}) }, meta } as never;
}
/** Map a TrendsResponse for 1–5 distinct keywords to the stable trends_compare envelope. */
export function compareEnvelope(keywords: string[], r: TrendsResponse, filter: { geo: string; time: string } = { geo: DEFAULTS.geo, time: DEFAULTS.time }) {
  const iot = r.data?.interestOverTime as InterestOverTime | undefined;
  const series = keywords.map((keyword, i) => {
    const points = (iot?.timeline ?? []).map(p => ({ t: p.time, value: p.values[i] ?? 0 }));
    const gaps = detectGaps(points);
    const kept = points.filter((_, idx) => !gaps[idx]);
    return { keyword, points, average: iot?.averages?.[i] ?? avg(points.map(p => p.value)), latest: kept.at(-1)?.value ?? 0, peak: Math.max(0, ...kept.map(p => p.value)) };
  });
  const summary = `${keywords.join(' vs ')} (${filter.geo}·${filter.time}): ` + series.map(s => `${s.keyword} latest ${s.latest}/peak ${s.peak}`).join(', ');
  return { ok: r.status !== 'error', schemaVersion: SCHEMA_VERSION, status: r.status, filter, summary, series, ...err(r.error),
    meta: { fetchedAt: r.meta.fetchedAt, upstreamRequests: r.meta.upstreamRequests, durationMs: r.meta.durationMs, warnings: r.meta.warnings } };
}
/** Map Trending Now results (one or many geos) to the stable trends_now envelope. */
export function nowEnvelope(results: TrendingResponse[], hours: TrendingHours) {
  const okCount = results.filter(r => r.status === 'ok').length;
  const status = results.length && okCount === results.length ? 'ok' : okCount ? 'partial' : 'error';
  return { ok: status !== 'error', schemaVersion: SCHEMA_VERSION, status, hours, geos: results.map(x => x.geo),
    summary: { geos: results.length, ok: okCount, failed: results.length - okCount },
    byGeo: results.map(x => ({ geo: x.geo, ok: x.status === 'ok', fetchedAt: x.fetchedAt,
      items: x.items.map(i => ({ rank: i.rank, title: i.title, query: i.query, traffic: i.volume, trafficLabel: i.volumeLabel, growthPct: i.growthPct, startedAt: i.startedAt, endedAt: i.endedAt, active: i.active, categories: i.categories, relatedQueries: i.relatedQueries, newsCount: i.newsCount, link: 'https://trends.google.com/trends/explore?' + new URLSearchParams({ q: i.query, geo: x.geo, date: ({ 4: 'now 4-H', 24: 'now 1-d', 48: 'now 7-d', 168: 'now 7-d' } as const)[hours] }) })),
      ...err(x.error) })),
    ...err(results.find(x => x.error)?.error), meta: { fetchedAt: new Date().toISOString() } };
}

const ASK_DOC = 'Input: term (required); geo (default US; "" = Worldwide); time (now 1-H|now 4-H|now 1-d|now 7-d|today 1-m|today 3-m|today 12-m|today 5-y|all, default now 1-d); fresh (default false: reuse a saved snapshot under 360 min); validate (default false: add verdict; anchor auto by window: sudoku for now 1-H/now 4-H/now 1-d, gpts for now 7-d and longer); points (default false: include the full interest series). Web search, all categories. Output: ok, schemaVersion, status (ok|no_data|partial|blocked|error), term, summary, filter{geo,time,category,property}, interest{average,latest,settledLatest,peak,gapCount,points?[{t,value,gap?}]} (points omitted by default; set points=true), tables{popular[{rank,query,value,formattedValue}], rising[{rank,query,value,formattedValue,breakout}]}, regions[{geo,name,value}], verdict? {label,confidence,reasons,traffic{unit:"searches/day",average,latest,settledLatest,peak,low,high,gapCount}|null,anchor{term,dailySearches,ratio,band,note},warnings?,freshSpike?,trendingNow?,retryAfterSec?} (same calibration helper and reliability gate as trends_snapshot), diff (latest saved snapshot vs the one before it, including on cache hits; null with diffReason when fewer than two exist; use fresh=true to save a new snapshot), error?{code,message,retryAfterSec?}, meta{cached,ageMin,fetchedAt,snapshotId,exploreUrl,warnings?}.';
const SNAPSHOT_DOC = 'Input: term (required); geo (default US; "" = Worldwide); time (same enum, default now 1-d); anchor (optional; omit for automatic: sudoku for now 1-H/now 4-H/now 1-d, gpts for now 7-d and longer; an explicit anchor forces both the primary and 7-day fetches); fresh (default false: reuse a saved snapshot under 360 min); svg (default false: embed inline SVG text; chart/chart7d.svg is "" by default and path is still written); tz (IANA time zone for chart labels; default GTFA_TZ, then UTC; invalid names return INVALID_INPUT). One shared-scale interest comparison [term, anchor] plus the term\'s Popular/Rising related queries. Output: ok, schemaVersion, status (ok|no_data|partial|blocked|error), term, summary, filter{geo,time,category,property}, anchor{term,dailySearches,tolerance,level,ratio,source,note} (primary window; level keeps 2 decimals; ratio null when the anchor is too sparse/weak), anchor7d{term,dailySearches,tolerance,level,ratio,source,note} (the extra now 7-d window and the baseline it used; equals anchor when time is already now 7-d, and is baseline-only when the 7-day fetch is unavailable), traffic{unit:"searches/day",average,latest,settledLatest,peak,low,high,gapCount} (numeric fields null without calibration or when the anchor reliability gate fails), series{points[{t,score,traffic,gap?}],anchorPoints[{t,score}]}, chart{svg,path}, chart7d{svg,path} (always present: the now 7-d curve, same calibration; reuses chart when time is already now 7-d; `{svg:"",path:null}` when the 7-day fetch is unavailable), traffic7d{same fields as traffic} (always present; null numeric fields when the 7-day fetch is unavailable), tables{popular[{rank,query,value,formattedValue,estDaily}],rising[{rank,query,value,formattedValue,breakout,estDaily}]}, verdict{label,confidence,reasons,prioritize}, error?{code,message,retryAfterSec?}, meta{cached,ageMin,fetchedAt,snapshotId,exploreUrl,warnings?}.';
const COMPARE_DOC = 'Input: keywords (1-5 distinct, required); geo (default US; "" = Worldwide); time (same enum, default now 1-d). Web search, all categories. Output: ok, schemaVersion, status (ok|partial|error), filter{geo,time}, summary (one line), series[{keyword,points[{t,value}],average,latest,peak}], error?{code,message,retryAfterSec?}, meta{fetchedAt,upstreamRequests,durationMs,warnings}. Values are relative 0-100 across all keywords in the call; latest/peak are gap-aware.';
const trendingDoc = () => `Input: geos (list of up to 30 country codes, uppercased and deduped in order | "default" | "all"; default "default" = ${DEFAULT_TRENDING_GEOS.map(g => g.code).join(' ')}); hours (Trending Now window in hours, 4|24|48|168, default 24; not the Explore time enum); limit (per geo, default 10). Stops after the first block. Supported geos: ${TRENDING_GEOS.map(g => g.code).join(' ')}. Output: ok, schemaVersion, status (ok|partial|error), hours, geos, summary{geos,ok,failed}, byGeo[{geo,ok,fetchedAt,items[{rank,title,query,traffic,trafficLabel,growthPct,startedAt,endedAt,active,categories,relatedQueries,newsCount,link}],error?}], error? (first failure), meta{fetchedAt}.`;

/** The four agent-facing tools. Everything else stays in the library. */
export const PRIMARY_TOOLS = ['trends_ask', 'trends_compare', 'trends_now', 'trends_snapshot'] as const;

/** Create the transport-neutral tool list used by the MCP server and the dsh plugin. */
export function createTools(options: ToolsOptions = {}): GtfaTool[] {
  const transport = options.transport ?? createDefaultTransport();
  const limiter = options.limiter ?? new RateLimiter({ ...options, minIntervalMs: options.minIntervalMs ?? 1500 });
  const defaultGeo = options.defaultGeo !== undefined ? options.defaultGeo.trim() : DEFAULTS.geo;
  const anchorOverride = options.anchor?.trim() || undefined;
  const live = (): Required<Pick<ToolLiveSettings, 'defaultGeo' | 'cache' | 'snapshotDir' | 'chartDir'>> & Pick<ToolLiveSettings, 'anchor' | 'baselines'> => {
    const values = options.settings?.() ?? {};
    return {
      defaultGeo: values.defaultGeo !== undefined ? values.defaultGeo.trim() : defaultGeo,
      anchor: values.anchor?.trim() || anchorOverride,
      baselines: values.baselines ?? options.baselines,
      cache: values.cache ?? true,
      snapshotDir: values.snapshotDir?.trim() || options.snapshotDir?.trim() || '.gtfa/snapshots',
      chartDir: values.chartDir !== undefined ? values.chartDir : options.chartDir !== undefined ? options.chartDir : '.gtfa/charts',
    };
  };
  const geoField = options.settings ? z.string().trim().optional() : z.string().default(defaultGeo);
  const storeFor = () => new SnapshotStore(live().snapshotDir);
  const scoped = (context?: ToolCallContext) => {
    throwIfAborted(context?.signal);
    const signal = context?.signal ?? options.signal;
    const scopedTransport: Transport = signal
      ? request => transport({ ...request, signal })
      : transport;
    const client = new TrendsClient({ ...options, transport: scopedTransport, limiter, signal });
    const query = (input: unknown) => queryTrends(input, { client, signal });
    return { client, query, shared: { ...options, transport: scopedTransport, limiter, signal } };
  };

  const ask: GtfaTool = {
    name: 'trends_ask',
    description: 'Ask about one term. ' + ASK_DOC + guidance,
    inputSchema: z.object({
      term: z.string().trim().min(1).max(100),
      geo: geoField,
      time: time.default(DEFAULTS.time),
      fresh: z.boolean().default(false),
      validate: z.boolean().default(false),
      points: z.boolean().default(false),
    }),
    async execute(raw, context) {
      const parsed = ask.inputSchema.safeParse(raw ?? {});
      if (!parsed.success) return zodRejectionEnvelope(parsed.error);
      const { term, geo, time: range, fresh, validate, points } = parsed.data as { term: string; geo?: string; time: (typeof TIME_RANGES)[number]; fresh: boolean; validate: boolean; points: boolean };
      const settings = live();
      const { query, shared } = scoped(context);
      const store = storeFor(), filter = { geo: geo !== undefined ? geo.trim() : settings.defaultGeo, time: range, category: DEFAULTS.category, property: DEFAULTS.property };
      const refresh = fresh || settings.cache === false ? 'always' : undefined;
      let snap: TermSnapshot, cached = false, ageMin = 0, verdict: Record<string, unknown> | undefined, validationWarnings: string[] = [];
      if (validate) {
        const [v] = await validateTerms([term], { filter, store, refresh, query, anchor: settings.anchor, baselines: settings.baselines, trendingFetch: input => fetchTrending(input, shared) });
        snap = (await store.history(term, filter, 1))[0];
        cached = v.source === 'cache'; ageMin = Math.max(0, (Date.now() - Date.parse(v.fetchedAt)) / 60000);
        verdict = verdictEnvelope(v);
        if (v.anchor.warning) validationWarnings = [v.anchor.warning];
        if (!snap) return response({ ok: false, schemaVersion: SCHEMA_VERSION, status: v.verdict, term, filter: { ...filter, property: 'web' }, verdict, diff: null, diffReason: 'No snapshot', meta: { cached: false, fetchedAt: v.fetchedAt } });
      } else {
        const a = await askTerm(term, { filter, store, refresh, query });
        snap = a.snapshot; cached = a.source === 'cache'; ageMin = a.ageMin;
      }
      const rows = await store.history(term, filter, 2);
      const diff = rows.length < 2 ? null : diffSnapshots(rows[1], rows[0]);
      return response(blockedVerdict(askEnvelope(snap, { cached, ageMin, verdict, diff, ...(diff ? {} : { diffReason: 'Need two snapshots' }), includePoints: points, ...(validationWarnings.length ? { warnings: validationWarnings } : {}) })));
    },
  };

  const snapshot: GtfaTool = {
    name: 'trends_snapshot',
    description: 'Calibrated searches/day snapshot for one term against a shared-scale anchor. ' + SNAPSHOT_DOC + guidance,
    inputSchema: z.object({
      term: z.string().trim().min(1).max(100),
      geo: geoField,
      time: time.default(DEFAULTS.time),
      anchor: z.string().trim().min(1).max(100).optional(),
      fresh: z.boolean().default(false),
      svg: z.boolean().default(false),
      tz: z.string().trim().min(1).max(100).optional(),
    }),
    async execute(raw, context) {
      const parsed = snapshot.inputSchema.safeParse(raw ?? {});
      if (!parsed.success) return zodRejectionEnvelope(parsed.error);
      const { term, geo, time: range, anchor, fresh, svg, tz } = parsed.data as { term: string; geo?: string; time: (typeof TIME_RANGES)[number]; anchor?: string; fresh: boolean; svg: boolean; tz?: string };
      const settings = live();
      const { query } = scoped(context);
      const store = storeFor(), filter = { geo: geo !== undefined ? geo.trim() : settings.defaultGeo, time: range, category: DEFAULTS.category, property: DEFAULTS.property };
      try {
        const forcedAnchor = anchor ?? settings.anchor;
        const refresh = fresh || settings.cache === false ? 'always' : undefined;
        const a = await fetchTrafficSnapshot(term, { filter, store, anchor: forcedAnchor, baselines: settings.baselines, refresh, query, timeZone: tz });
        return response(await trafficSnapshotEnvelope(a.snapshot, { cached: a.source === 'cache', ageMin: a.ageMin, baselines: settings.baselines, chartDir: settings.chartDir, week: a.week, weekAnchor: forcedAnchor, svg, timeZone: tz, ...(a.weekError ? { weekError: a.weekError } : {}) }));
      } catch (e) {
        return response(trafficSnapshotError(term, e instanceof Error ? e.message : String(e), filter));
      }
    },
  };

  const compare: GtfaTool = {
    name: 'trends_compare',
    description: 'Compare relative search interest for 1–5 distinct keywords (e.g. a candidate against an anchor). ' + COMPARE_DOC + guidance,
    inputSchema: z.object({
      keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(5),
      geo: geoField,
      time: time.default(DEFAULTS.time),
    }),
    async execute(raw, context) {
      const parsed = compare.inputSchema.safeParse(raw ?? {});
      if (!parsed.success) return zodRejectionEnvelope(parsed.error);
      const { keywords, geo, time: range } = parsed.data as { keywords: string[]; geo?: string; time: (typeof TIME_RANGES)[number] };
      const geoValue = geo !== undefined ? geo.trim() : live().defaultGeo;
      const { client } = scoped(context);
      const seen = new Set<string>(), dup = keywords.find(k => { const n = k.trim().toLowerCase().replace(/\s+/g, ' '); return seen.has(n) || !seen.add(n); });
      if (dup !== undefined) return response({ ok: false, schemaVersion: SCHEMA_VERSION, status: 'error', filter: { geo: geoValue, time: range }, series: [], error: { code: 'INVALID_INPUT', message: `duplicate keyword: "${dup.trim()}"; each keyword must be unique` }, meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 0, durationMs: 0, warnings: [] } });
      const r = await compareTrends(keywords, { geo: geoValue, timeRange: range, category: DEFAULTS.category, searchType: 'web', dataTypes: ['interestOverTime'], client, signal: context?.signal } as never);
      return response(compareEnvelope(keywords, r, { geo: geoValue, time: range }));
    },
  };

  const now: GtfaTool = {
    name: 'trends_now',
    description: 'Trending Now for one or more countries, fetched sequentially. ' + trendingDoc() + guidance,
    inputSchema: z.object({
      geos: z.union([z.array(z.string()).min(1), z.literal('default'), z.literal('all')]).default('default'),
      hours: hours.default(24),
      limit: nonnegative.default(10),
    }),
    async execute(raw, context) {
      const parsed = now.inputSchema.safeParse(raw ?? {});
      if (!parsed.success) return zodRejectionEnvelope(parsed.error);
      const { geos, hours: window, limit } = parsed.data as { geos: string[] | 'default' | 'all'; hours: TrendingHours; limit: number };
      const { shared } = scoped(context);
      let list: string[];
      try { list = normalizeTrendingGeos(geos); }
      catch (error) { return response(invalidInputEnvelope(error instanceof Error ? error.message : 'invalid geos')); }
      const r = await listTrending({ geos: list, hours: window, limit }, { ...shared, stopOnBlocked: true });
      return response(nowEnvelope(r.results, window));
    },
  };

  return [ask, snapshot, compare, now];
}
