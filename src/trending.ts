import { GTrendsError } from './core.js';
import type { TrendsErrorCode } from './api.js';
import { normalizeTrendingGeos, TRENDING_GEOS } from './geos.js';
import { abortError, createDefaultTransport, isAbortError, RateLimiter, Session, throwIfAborted, withRetry, type Transport, type RateLimitOptions, type TimeoutSurface } from './transport.js';

export const TRENDING_CATEGORIES: Record<number, string> = {
  1: 'Autos and Vehicles', 2: 'Beauty and Fashion', 3: 'Business and Finance', 4: 'Entertainment',
  5: 'Food and Drink', 6: 'Games', 7: 'Health', 8: 'Hobbies and Leisure', 9: 'Jobs and Education',
  10: 'Law and Government', 11: 'Other', 13: 'Pets and Animals', 14: 'Politics', 15: 'Science',
  16: 'Shopping', 17: 'Sports', 18: 'Technology', 19: 'Travel and Transportation', 20: 'Climate',
};
export type TrendingHours = 4 | 24 | 48 | 168;
export interface TrendingInput { geo: string; hours?: TrendingHours; lang?: string; minVolume?: number; categories?: number[]; limit?: number }
export interface TrendingItem {
  rank: number; title: string; query: string; geo: string; volume: number; volumeLabel: string;
  growthPct: number; categoryIds: number[]; categories: string[]; startedAt: string; endedAt: string | null;
  active: boolean; relatedQueries: string[]; newsCount: number;
}
export interface TrendingResponse {
  status: 'ok' | 'error'; geo: string; hours: TrendingHours; fetchedAt: string; items: TrendingItem[];
  error?: { code: TrendsErrorCode; message: string; retryAfterSec?: number };
  meta: { upstreamRequests: number; durationMs: number };
}
export interface TrendingOptions extends RateLimitOptions { transport?: Transport; limiter?: RateLimiter; timeoutMs?: number; maxRetries?: number; stopOnBlocked?: boolean; signal?: AbortSignal; timeoutSurface?: TimeoutSurface }
export function trendingVolumeLabel(volume: number): string {
  return `${volume >= 1e6 ? `${volume / 1e6}M` : volume >= 1000 ? `${volume / 1000}K` : volume}+`;
}
const TRENDING_PAGE_URL = 'https://trends.google.com/trending';
const TRENDING_TIMEOUT_MS = 15_000;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const protocolChanged = (detail: string) => new GTrendsError('TRENDS_PROTOCOL_CHANGED',
  `Google Trends returned an unexpected Trending Now page (${detail}); the public endpoint may have changed. Retry later, and update gtfa if it persists.`);
/** Return the JSON value starting at `start`, respecting strings and nesting. */
function balancedJson(text: string, start: number): string {
  const opening = text[start];
  if (opening !== '[' && opening !== '{') throw protocolChanged('missing data payload');
  const closing = opening === '[' ? ']' : '}';
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === opening) depth++;
    else if (char === closing && --depth === 0) return text.slice(start, i + 1);
  }
  throw protocolChanged('truncated data payload');
}
/** Decode the AF_initDataCallback ds:0 payload embedded in the Trending Now page. */
export function parseTrendingResponse(body: string): TrendingItem[] {
  const key = /key\s*:\s*['"]ds:0['"]/.exec(body);
  if (!key) throw protocolChanged('missing ds:0 callback');
  const afterKey = body.slice(key.index + key[0].length);
  const data = /\bdata\s*:/.exec(afterKey);
  if (!data) throw protocolChanged('missing ds:0 data');
  const dataStart = key.index + key[0].length + data.index + data[0].length;
  const first = body.slice(dataStart).search(/[\[{]/);
  if (first < 0) throw protocolChanged('missing ds:0 data');
  let parsed: unknown;
  try { parsed = JSON.parse(balancedJson(body, dataStart + first)); }
  catch (error) { if (error instanceof GTrendsError) throw error; throw protocolChanged('invalid ds:0 JSON'); }
  if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) throw protocolChanged('missing Trending Now rows');
  const rows = parsed[1];
  const iso = (seconds: unknown): string => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new Error('invalid timestamp');
    return new Date(seconds * 1000).toISOString();
  };
  try {
    return rows.map((row: unknown, index) => {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[2] !== 'string' ||
        typeof row[6] !== 'number' || !Number.isFinite(row[6]) || typeof row[8] !== 'number' || !Number.isFinite(row[8]) ||
        !Array.isArray(row[9]) || !row[9].every((q: unknown) => typeof q === 'string') ||
        !Array.isArray(row[10]) || !row[10].every((id: unknown) => Number.isInteger(id)) || typeof row[12] !== 'string') throw new Error('invalid Trending Now item');
      const endedAt = row[4] == null ? null : iso(Array.isArray(row[4]) ? row[4][0] : row[4]);
      return { rank: index + 1, title: row[0], query: row[12], geo: row[2], volume: row[6], volumeLabel: trendingVolumeLabel(row[6]),
        growthPct: row[8], categoryIds: row[10], categories: row[10].map((id: number) => TRENDING_CATEGORIES[id] ?? `Category ${id}`),
        startedAt: iso(row[3]?.[0]), endedAt, active: endedAt === null, relatedQueries: row[9], newsCount: Array.isArray(row[11]) ? row[11].length : 0 };
    });
  } catch (error) {
    if (error instanceof GTrendsError) throw error;
    throw protocolChanged(`malformed Trending Now row: ${error instanceof Error ? error.message : 'unknown row shape'}`);
  }
}
function failure(input: TrendingInput, code: TrendsErrorCode, message: string): TrendingResponse {
  return { status: 'error', geo: typeof input.geo === 'string' ? input.geo.toUpperCase() : '', hours: input.hours ?? 24,
    fetchedAt: new Date().toISOString(), items: [], error: { code, message }, meta: { upstreamRequests: 0, durationMs: 0 } };
}
export async function fetchTrending(input: TrendingInput, options: TrendingOptions = {}): Promise<TrendingResponse> {
  const result = failure(input, 'INVALID_INPUT', 'invalid input');
  let session: Session | undefined;
  const now = options.now ?? Date.now;
  const start = now();
  try {
    throwIfAborted(options.signal);
    if (!TRENDING_GEOS.some(g => g.code === result.geo) || ![4, 24, 48, 168].includes(result.hours) ||
      (input.lang !== undefined && (typeof input.lang !== 'string' || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*$/.test(input.lang))) ||
      [input.minVolume, input.limit].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 0)) ||
      (input.categories !== undefined && (!Array.isArray(input.categories) || !input.categories.every(n => Number.isSafeInteger(n) && n > 0))) ||
      (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) ||
      (options.maxRetries !== undefined && (!Number.isSafeInteger(options.maxRetries) || options.maxRetries < 0 || options.maxRetries > 2))) {
      throw new GTrendsError('INVALID_INPUT', 'invalid geo, hours, language, filters, retries, or timeout');
    }
    const limiter = options.limiter ?? new RateLimiter({ ...options, minIntervalMs: options.minIntervalMs ?? 1500 });
    session = new Session(options.transport ?? createDefaultTransport(), limiter);
    const url = new URL(TRENDING_PAGE_URL);
    url.searchParams.set('geo', result.geo);
    url.searchParams.set('hours', String(result.hours));
    url.searchParams.set('hl', input.lang ?? 'en');
    const body = await withRetry(() => session!.request({ url: url.toString(), method: 'GET',
      timeoutMs: options.timeoutMs ?? TRENDING_TIMEOUT_MS, signal: options.signal, timeoutSurface: options.timeoutSurface,
      headers: { 'user-agent': BROWSER_USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': input.lang ?? 'en' } }),
    { maxRetries: options.maxRetries ?? 1, sleep: limiter.sleep, signal: options.signal });
    result.items = parseTrendingResponse(body).filter(item => item.volume >= (input.minVolume ?? 0) &&
      (!input.categories?.length || item.categoryIds.some(id => input.categories!.includes(id))));
    if (input.limit !== undefined) result.items = result.items.slice(0, input.limit);
    result.status = 'ok'; delete result.error;
  } catch (e) {
    if (options.signal?.aborted) throw abortError(options.signal);
    if (isAbortError(e)) throw e;
    result.error = e instanceof GTrendsError ? { code: e.code, message: e.message, ...(e.retryAfterSec !== undefined ? { retryAfterSec: e.retryAfterSec } : {}) } :
      { code: e instanceof RangeError && !session ? 'INVALID_INPUT' : 'TRENDS_PROTOCOL_CHANGED', message: 'Google Trends returned an unexpected Trending Now response; the public endpoint may have changed. Retry later, and check for a newer gtfa if it persists.' };
  }
  result.meta = { upstreamRequests: session?.upstreamRequests ?? 0, durationMs: now() - start };
  result.fetchedAt = new Date(now()).toISOString();
  return result;
}
export interface ListTrendingInput extends Omit<TrendingInput, 'geo'> { geos: string[] | 'all' }
export interface ListTrendingResponse { status: 'ok' | 'partial' | 'error'; results: TrendingResponse[]; summary: { geos: number; ok: number; failed: number } }
export async function listTrending(input: ListTrendingInput, options: TrendingOptions = {}): Promise<ListTrendingResponse> {
  const geos = normalizeTrendingGeos(input.geos, false);
  const results: TrendingResponse[] = [];
  let halted: { code: TrendsErrorCode; message: string } | undefined;
  let shared: TrendingOptions;
  try { shared = { ...options, transport: options.transport ?? createDefaultTransport(), limiter: options.limiter ?? new RateLimiter({ ...options, minIntervalMs: options.minIntervalMs ?? 1500 }) }; }
  catch { shared = options; }
  for (const geo of geos) {
    throwIfAborted(options.signal);
    const result = halted ? failure({ ...input, geo }, halted.code, halted.message) : await fetchTrending({ ...input, geo }, shared);
    throwIfAborted(options.signal);
    results.push(result);
    if (options.stopOnBlocked !== false) {
      if (result.error?.code === 'BLOCKED') halted = { code: 'BLOCKED', message: 'skipped after upstream block' };
      else if (result.error?.code === 'RATE_LIMITED') halted = { code: 'RATE_LIMITED', message: 'skipped after upstream rate limit' };
    }
  }
  const ok = results.filter(r => r.status === 'ok').length;
  return { status: ok === results.length ? 'ok' : ok ? 'partial' : 'error', results, summary: { geos: results.length, ok, failed: results.length - ok } };
}
/** Compare normalized query strings; rising entries contain the latest item. */
export function diffTrending(prev: TrendingResponse, next: TrendingResponse): { added: TrendingItem[]; removed: TrendingItem[]; rising: TrendingItem[]; unchanged: number } {
  const key = (item: TrendingItem) => item.query.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const before = new Map(prev.items.map(item => [key(item), item]));
  const after = new Map(next.items.map(item => [key(item), item]));
  const added = next.items.filter(item => !before.has(key(item)));
  const removed = prev.items.filter(item => !after.has(key(item)));
  const rising = next.items.filter(item => before.has(key(item)) && item.volume > before.get(key(item))!.volume);
  return { added, removed, rising, unchanged: next.items.length - added.length - rising.length };
}

/** One item from the MCP `trends_now` envelope (`byGeo[].items`). Accepts either traffic* or volume*. */
export interface TrendsNowItem {
  rank: number; title: string; query: string;
  traffic?: number; trafficLabel?: string; volume?: number; volumeLabel?: string;
  growthPct: number; startedAt: string; endedAt: string | null; active: boolean;
  categories?: string[]; categoryIds?: number[]; relatedQueries?: string[]; newsCount?: number; link?: string;
}
/** One country block from the MCP `trends_now` envelope. */
export interface TrendsNowByGeo {
  geo: string; ok?: boolean; fetchedAt?: string; items: TrendsNowItem[];
  error?: { code: string; message: string; retryAfterSec?: number };
}
/** The agent-facing `trends_now` structuredContent shape (or a saved JSON document in the same shape). */
export interface TrendsNowEnvelope { hours?: number; byGeo: TrendsNowByGeo[] }

/** Map one MCP item onto a library TrendingItem (traffic/trafficLabel → volume/volumeLabel). */
export function trendsNowItemToTrendingItem(item: TrendsNowItem, geo: string): TrendingItem {
  const volume = item.volume ?? item.traffic ?? 0;
  return {
    rank: item.rank, title: item.title, query: item.query, geo, volume,
    volumeLabel: item.volumeLabel ?? item.trafficLabel ?? String(volume),
    growthPct: item.growthPct, categoryIds: item.categoryIds ?? [], categories: item.categories ?? [],
    startedAt: item.startedAt, endedAt: item.endedAt, active: item.active,
    relatedQueries: item.relatedQueries ?? [], newsCount: item.newsCount ?? 0,
  };
}

/** Convert a saved/MCP `trends_now` envelope into `TrendingResponse[]` for `diffTrending`. */
export function trendsNowToTrendingResponses(env: TrendsNowEnvelope, hours: TrendingHours = (env.hours as TrendingHours | undefined) ?? 24): TrendingResponse[] {
  if (!env || !Array.isArray(env.byGeo)) throw new Error('trends_now envelope requires byGeo[]');
  return env.byGeo.map(g => ({
    status: (g.ok === false || g.error) ? 'error' as const : 'ok' as const,
    geo: g.geo, hours, fetchedAt: g.fetchedAt ?? new Date().toISOString(),
    items: (g.items ?? []).map(i => trendsNowItemToTrendingItem(i, g.geo)),
    ...(g.error ? { error: g.error as TrendingResponse['error'] } : {}),
    meta: { upstreamRequests: 0, durationMs: 0 },
  }));
}

/** Diff two `trends_now` envelopes per geo (maps traffic→volume then calls diffTrending). */
export function diffTrendsNow(prev: TrendsNowEnvelope, next: TrendsNowEnvelope, hours?: TrendingHours) {
  const a = trendsNowToTrendingResponses(prev, hours ?? (prev.hours as TrendingHours | undefined) ?? 24);
  const b = trendsNowToTrendingResponses(next, hours ?? (next.hours as TrendingHours | undefined) ?? 24);
  const byNext = new Map(b.map(r => [r.geo, r]));
  return a.map(p => {
    const n = byNext.get(p.geo);
    if (!n) return { geo: p.geo, ...diffTrending(p, { ...p, items: [] }) };
    return { geo: p.geo, ...diffTrending(p, n) };
  }).concat(b.filter(n => !a.some(p => p.geo === n.geo)).map(n => ({ geo: n.geo, ...diffTrending({ ...n, items: [] }, n) })));
}
