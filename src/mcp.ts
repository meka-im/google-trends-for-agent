import { validateTerms, type TermVerdict } from './validate.js';
import { askTerm, SnapshotStore, diffSnapshots, type TermSnapshot } from './snapshot.js';
import type { InterestOverTime } from './core.js';
import type { TrendsResponse } from './api.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TrendsClient, type ClientOptions } from './client.js';
import { queryTrends, compareTrends } from './api.js';
import { TIME_RANGES } from './core.js';
import { fetchTrending, listTrending, type TrendingHours, type TrendingResponse } from './trending.js';
import { TRENDING_GEOS, DEFAULT_TRENDING_GEOS } from './geos.js';
import { createDefaultTransport, RateLimiter } from './transport.js';
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

/** Normalize an MCP SDK schema-rejection message into the shared tool envelope. */
export function schemaRejectionEnvelope(message: string) {
  const cleaned = message
    .replace(/^MCP error -\d+:\s*/, '')
    .replace(/^Input validation error:\s*/i, '')
    .replace(/^Invalid arguments for tool [^:]+:\s*/i, '');
  return {
    ok: false as const, schemaVersion: SCHEMA_VERSION, status: 'error' as const,
    error: { code: 'INVALID_INPUT' as const, message: cleaned || message },
    meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 0, durationMs: 0, warnings: [] as string[] },
  };
}

function response(result: { ok: boolean } & Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result, ...(result.ok ? {} : { isError: true }) };
}
const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null;
const err = (e?: TrendsResponse['error']) => e ? { error: { code: e.code, message: e.message, ...(e.retryAfterSec !== undefined ? { retryAfterSec: e.retryAfterSec } : {}) } } : {};

/** Convert a validation row to the verdict object embedded in trends_ask. */
export function verdictEnvelope(v: TermVerdict): Record<string, unknown> {
  return { label: v.verdict, confidence: v.confidence, reasons: v.reasons, traffic: v.anchor.traffic, anchor: { term: v.anchor.term, ratio: v.anchor.ratio, band: v.anchor.band, note: v.anchor.note }, ...(v.anchor.warning ? { warnings: [v.anchor.warning] } : {}), ...(v.freshSpike ? { freshSpike: v.freshSpike } : {}), ...(v.trendingNow ? { trendingNow: v.trendingNow } : {}), ...(v.retryAfterSec !== undefined ? { retryAfterSec: v.retryAfterSec } : {}) };
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
/** Map a TrendsResponse for 2–5 keywords to the stable trends_compare envelope. */
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

const ASK_DOC = 'Input: term (required); geo (default US); time (now 1-H|now 4-H|now 1-d|now 7-d|today 1-m|today 3-m|today 12-m|today 5-y|all, default now 1-d); fresh (default false: reuse a saved snapshot under 360 min); validate (default false: add verdict, anchor gpts); points (default false: include the full interest series). Web search, all categories. Output: ok, schemaVersion, status (ok|no_data|partial|blocked|error), term, summary, filter{geo,time,category,property}, interest{average,latest,settledLatest,peak,gapCount,points?[{t,value,gap?}]} (points omitted by default; set points=true), tables{popular[{rank,query,value,formattedValue}], rising[{rank,query,value,formattedValue,breakout}]}, regions[{geo,name,value}], verdict? {label,confidence,reasons,traffic{unit:"searches/day",average,latest,settledLatest,peak,low,high,gapCount}|null,anchor{term,ratio,band,note},warnings?,freshSpike?,trendingNow?,retryAfterSec?} (same calibration helper and reliability gate as trends_snapshot), diff (vs previous saved snapshot, or null with diffReason), error?{code,message,retryAfterSec?}, meta{cached,ageMin,fetchedAt,snapshotId,exploreUrl,warnings?}.';
const SNAPSHOT_DOC = 'Input: term (required); geo (default US); time (same enum, default now 1-d); anchor (default gpts); fresh (default false: reuse a saved snapshot under 360 min); svg (default false: embed inline SVG text; chart/chart7d.svg is "" by default and path is still written); tz (IANA time zone for chart labels; default GTFA_TZ, then UTC; invalid names return INVALID_INPUT). One shared-scale interest comparison [term, anchor] plus the term\'s Popular/Rising related queries. Output: ok, schemaVersion, status (ok|no_data|partial|blocked|error), term, summary, filter{geo,time,category,property}, anchor{term,dailySearches,tolerance,level,ratio,source,note} (level keeps 2 decimals; ratio null when the anchor is too sparse/weak), traffic{unit:"searches/day",average,latest,settledLatest,peak,low,high,gapCount} (numeric fields null without calibration or when the anchor reliability gate fails), series{points[{t,score,traffic,gap?}],anchorPoints[{t,score}]}, chart{svg,path}, chart7d{svg,path} (always present: the now 7-d curve, same calibration; reuses chart when time is already now 7-d; `{svg:"",path:null}` when the 7-day fetch is unavailable), traffic7d{same fields as traffic} (always present; null numeric fields when the 7-day fetch is unavailable), tables{popular[{rank,query,value,formattedValue,estDaily}],rising[{rank,query,value,formattedValue,breakout,estDaily}]}, verdict{label,confidence,reasons,prioritize}, error?{code,message,retryAfterSec?}, meta{cached,ageMin,fetchedAt,snapshotId,exploreUrl,warnings?}.';
const COMPARE_DOC = 'Input: keywords (2-5, required); geo (default US); time (same enum, default now 1-d). Web search, all categories. Output: ok, schemaVersion, status (ok|partial|error), filter{geo,time}, summary (one line), series[{keyword,points[{t,value}],average,latest,peak}], error?{code,message,retryAfterSec?}, meta{fetchedAt,upstreamRequests,durationMs,warnings}. Values are relative 0-100 across all keywords in the call; latest/peak are gap-aware.';
const trendingDoc = () => `Input: geos (list of country codes | "default" | "all"; default "default" = ${DEFAULT_TRENDING_GEOS.map(g => g.code).join(' ')}); hours (Trending Now window in hours, 4|24|48|168, default 24; not the Explore time enum); limit (per geo, default 10). Stops after the first block. Supported geos: ${TRENDING_GEOS.map(g => g.code).join(' ')}. Output: ok, schemaVersion, status (ok|partial|error), hours, geos, summary{geos,ok,failed}, byGeo[{geo,ok,fetchedAt,items[{rank,title,query,traffic,trafficLabel,growthPct,startedAt,endedAt,active,categories,relatedQueries,newsCount,link}],error?}], error? (first failure), meta{fetchedAt}.`;

/** The four agent-facing MCP tools. Everything else stays in the library. */
export const PRIMARY_TOOLS = ['trends_ask', 'trends_compare', 'trends_now', 'trends_snapshot'] as const;
export interface ServerOptions extends ClientOptions {
  /** Snapshot storage shared by trends_ask and trends_snapshot (default `.gtfa/snapshots`). */
  snapshotDir?: string;
  /** Chart directory for trends_snapshot (default `.gtfa/charts`; null disables files). */
  chartDir?: string | null;
  /** Optional calibration overrides; the built-in US gpts default is always available. */
  baselines?: Baselines;
}
/** Creates an unconnected server. options.transport injects HTTP, not MCP, transport. */
export function createServer(options: ServerOptions = {}): McpServer {
  const transport = options.transport ?? createDefaultTransport();
  const limiter = options.limiter ?? new RateLimiter({ ...options, minIntervalMs: options.minIntervalMs ?? 1500 });
  const shared = { ...options, transport, limiter };
  const client = new TrendsClient(shared);
  const storeFor = () => new SnapshotStore(options.snapshotDir);
  const server = new McpServer({ name: 'google-trends-for-agent', version: '0.1.0' }, { instructions: 'Four tools. trends_ask, trends_compare and trends_snapshot share defaults geo=US, time=now 1-d, web search, all categories; trends_now defaults to a 30-country set and hours=24. trends_ask: one term -> interest, popular + rising related queries, regions, diff vs previous snapshot; validate=true adds a verdict. trends_compare: 2-5 keywords relative interest (e.g. a candidate vs an anchor). trends_now: Trending Now by country. trends_snapshot: one term + a shared-scale gpts anchor -> calibrated searches/day estimate, traffic series, related queries, verdict and a chart file path (inline SVG with svg=true; chart labels use UTC unless tz or GTFA_TZ selects another IANA zone); it also always returns a now 7-d curve as chart7d/traffic7d, and traffic fields are null without matching calibration or when the anchor is too sparse/weak. trends_ask omits full interest.points by default (set points=true); trends_snapshot omits inline SVG text by default (set svg=true). Every tool result has ok, schemaVersion, status, error? and meta; arguments rejected by schema validation return the same envelope with ok:false and error.code INVALID_INPUT. Report no_data/blocked honestly; never invent volumes; verdict.traffic is searches/day and is null (无法估) without calibration. trends_ask/trends_snapshot share the calibration formula traffic = score / anchorLevel * dailySearches with a sparse-anchor gate.' });
  const query = (input: unknown) => queryTrends(input, { client });
  // SDK schema failures call createToolError before our handlers; normalize to the shared envelope.
  (server as unknown as { createToolError: (message: string) => object }).createToolError = (message: string) => {
    const result = schemaRejectionEnvelope(message);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result, isError: true };
  };
  server.registerTool('trends_ask', { description: 'Ask about one term. ' + ASK_DOC + guidance, inputSchema: { term: z.string().trim().min(1).max(100), geo: z.string().default(DEFAULTS.geo), time: time.default(DEFAULTS.time), fresh: z.boolean().default(false), validate: z.boolean().default(false), points: z.boolean().default(false) } }, async ({ term, geo, time, fresh, validate, points }) => {
    const store = storeFor(), filter = { geo, time, category: DEFAULTS.category, property: DEFAULTS.property };
    let snap: TermSnapshot, cached = false, ageMin = 0, verdict: Record<string, unknown> | undefined, validationWarnings: string[] = [];
    if (validate) {
      const [v] = await validateTerms([term], { filter, store, refresh: fresh ? 'always' : undefined, query, trendingFetch: input => fetchTrending(input, shared) });
      snap = (await store.history(term, filter, 1))[0];
      cached = v.source === 'cache'; ageMin = Math.max(0, (Date.now() - Date.parse(v.fetchedAt)) / 60000);
      verdict = verdictEnvelope(v);
      if (v.anchor.warning) validationWarnings = [v.anchor.warning];
      if (!snap) return response({ ok: false, schemaVersion: SCHEMA_VERSION, status: v.verdict, term, filter: { ...filter, property: 'web' }, verdict, diff: null, diffReason: 'No snapshot', meta: { cached: false, fetchedAt: v.fetchedAt } });
    } else {
      const a = await askTerm(term, { filter, store, refresh: fresh ? 'always' : undefined, query });
      snap = a.snapshot; cached = a.source === 'cache'; ageMin = a.ageMin;
    }
    const rows = await store.history(term, filter, 2);
    const diff = rows.length < 2 ? null : diffSnapshots(rows[1], rows[0]);
    return response(blockedVerdict(askEnvelope(snap, { cached, ageMin, verdict, diff, ...(diff ? {} : { diffReason: 'Need two snapshots' }), includePoints: points, ...(validationWarnings.length ? { warnings: validationWarnings } : {}) })));
  });
  server.registerTool('trends_snapshot', { description: 'Calibrated searches/day snapshot for one term against a shared-scale anchor. ' + SNAPSHOT_DOC + guidance, inputSchema: { term: z.string().trim().min(1).max(100), geo: z.string().default(DEFAULTS.geo), time: time.default(DEFAULTS.time), anchor: z.string().trim().min(1).max(100).default('gpts'), fresh: z.boolean().default(false), svg: z.boolean().default(false), tz: z.string().trim().min(1).max(100).optional() } }, async ({ term, geo, time, anchor, fresh, svg, tz }) => {
    const store = storeFor(), filter = { geo, time, category: DEFAULTS.category, property: DEFAULTS.property };
    try {
      const a = await fetchTrafficSnapshot(term, { filter, store, anchor, refresh: fresh ? 'always' : undefined, query, timeZone: tz });
      return response(await trafficSnapshotEnvelope(a.snapshot, { cached: a.source === 'cache', ageMin: a.ageMin, baselines: options.baselines, chartDir: options.chartDir, week: a.week, svg, timeZone: tz, ...(a.weekError ? { weekError: a.weekError } : {}) }));
    } catch (e) {
      return response(trafficSnapshotError(term, e instanceof Error ? e.message : String(e), filter));
    }
  });
  server.registerTool('trends_compare', { description: 'Compare relative search interest for 2–5 keywords (e.g. a candidate against an anchor). ' + COMPARE_DOC + guidance, inputSchema: { keywords: z.array(z.string().trim().min(1).max(100)).min(2).max(5), geo: z.string().default(DEFAULTS.geo), time: time.default(DEFAULTS.time) } }, async ({ keywords, geo, time }) => {
    const seen = new Set<string>(), dup = keywords.find(k => { const n = k.trim().toLowerCase().replace(/\s+/g, ' '); return seen.has(n) || !seen.add(n); });
    if (dup !== undefined) return response({ ok: false, schemaVersion: SCHEMA_VERSION, status: 'error', filter: { geo, time }, series: [], error: { code: 'INVALID_INPUT', message: `duplicate keyword: "${dup.trim()}"; each keyword must be unique` }, meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 0, durationMs: 0, warnings: [] } });
    const r = await compareTrends(keywords, { geo, timeRange: time, category: DEFAULTS.category, searchType: 'web', dataTypes: ['interestOverTime'], client } as never);
    return response(compareEnvelope(keywords, r, { geo, time }));
  });
  server.registerTool('trends_now', { description: 'Trending Now for one or more countries, fetched sequentially. ' + trendingDoc() + guidance, inputSchema: { geos: z.union([z.array(z.string()).min(1), z.literal('default'), z.literal('all')]).default('default'), hours: hours.default(24), limit: nonnegative.default(10) } }, async ({ geos, hours, limit }) => {
    const list = geos === 'default' ? DEFAULT_TRENDING_GEOS.map(g => g.code) : geos === 'all' ? TRENDING_GEOS.map(g => g.code) : geos;
    const r = await listTrending({ geos: list, hours, limit }, { ...shared, stopOnBlocked: true });
    return response(nowEnvelope(r.results, hours));
  });
  return server;
}
