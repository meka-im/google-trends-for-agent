import { summarizeInterest } from './gaps.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { queryTrends, type TrendsResponse } from './api.js';
import { isAbortError } from './transport.js';
import type { InterestOverTime, RelatedQueries, GeoResult, GeoRow } from './core.js';
import { resolveFilter, filterInput, settledPoints, type TrendsFilter } from './filter.js';
export interface TermSnapshot {
  schema: 'term-snapshot/1'; id: string; term: string; filter: TrendsFilter; fetchedAt: string;
  status: 'ok' | 'no_data' | 'partial' | 'blocked' | 'error'; error?: TrendsResponse['error'];
  /** Upstream warnings retained from the fetch (e.g. a partial response). */
  warnings?: string[];
  interest: { points: { time: string; value: number }[]; latest: number; peak: number; settledLatest: number };
  /** Shared-scale anchor curve captured with the term by trends_snapshot. */
  anchor?: { term: string; points: { time: string; value: number }[] };
  popular: { rank: number; query: string; value: number }[];
  rising: { rank: number; query: string; value: number; formattedValue?: string; breakout: boolean }[];
  regions: { rank: number; code: string; name: string; value: number }[];
}
export const normalizeKeyword = (term: string) => term.trim().toLowerCase();
export const LOW_SAMPLE_WARNING = 'Interest average < 1 and Popular/Rising tables empty; treated as no_data, traffic omitted';

/** An isolated noisy peak without related-query evidence is not usable demand. */
export function isLowSample(s: TermSnapshot): boolean {
  const average = summarizeInterest(s.interest.points, s.filter).average;
  return average !== null && average < 1 && !s.popular.length && !s.rising.length;
}
export function gateLowSample(s: TermSnapshot): TermSnapshot {
  if (!isLowSample(s) || s.error || s.status === 'blocked' || s.status === 'error') return s;
  return { ...s, status: 'no_data', warnings: [...new Set([...(s.warnings ?? []), LOW_SAMPLE_WARNING])] };
}

export async function snapshotTerm(term: string, filter: Partial<TrendsFilter> = {}, opts: { query?: typeof queryTrends } = {}): Promise<TermSnapshot> {
  const f = resolveFilter(filter), query = opts.query ?? queryTrends;
  let r: TrendsResponse;
  try { r = await query({ queries: [term], ...filterInput(f), dataTypes: ['interestOverTime', 'relatedQueries', 'interestBySubregion'] }); }
  catch (e) {
    if (isAbortError(e)) throw e;
    r = { status: 'error', input: term, error: { code: 'NETWORK_ERROR', message: String(e) }, meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 0, durationMs: 0, warnings: [] } };
  }
  const points = ((r.data?.interestOverTime as InterestOverTime)?.timeline ?? []).map(p => ({ time: p.time, value: p.values[0] }));
  const related = r.data?.relatedQueries as RelatedQueries | undefined;
  const rows = (r.data?.interestBySubregion as GeoResult<GeoRow>)?.rows ?? [];
  return gateLowSample({ schema: 'term-snapshot/1', id: randomUUID(), term, filter: f, fetchedAt: r.meta.fetchedAt,
    status: ['BLOCKED', 'RATE_LIMITED'].includes(r.error?.code ?? '') ? 'blocked' : r.status === 'partial' ? 'partial' : r.status === 'error' ? 'error' : points.some(p => p.value > 0) ? 'ok' : 'no_data',
    ...(r.error ? { error: r.error } : {}),
    ...(r.meta.warnings.length ? { warnings: [...r.meta.warnings] } : {}),
    interest: { points, latest: points.at(-1)?.value ?? 0, peak: Math.max(0, ...points.map(p => p.value)), settledLatest: settledPoints(points, f).at(-1)?.value ?? 0 },
    popular: (related?.top ?? []).map((p, i) => ({ rank: i + 1, query: p.query, value: p.value })),
    rising: (related?.rising ?? []).map((p, i) => ({ rank: i + 1, query: p.query, value: p.value, formattedValue: p.formattedValue, breakout: /breakout/i.test(p.formattedValue) })),
    regions: [...rows].sort((a, b) => b.values[0] - a.values[0]).map((p, i) => ({ rank: i + 1, code: p.geoCode, name: p.geoName, value: p.values[0] })) });
}
export class SnapshotStore {
  constructor(public dir = '.gtfa/snapshots') {}
  key(term: string, filter: TrendsFilter, anchorTerm?: string) { return normalizeKeyword(term).replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60) + '-' + createHash('sha256').update(JSON.stringify([normalizeKeyword(term), filter.geo, filter.time, filter.category, filter.property, filter.hl ?? '', ...(anchorTerm ? ['anchor', normalizeKeyword(anchorTerm)] : [])])).digest('hex').slice(0, 16); }
  async save(s: TermSnapshot) { const path = join(this.dir, this.key(s.term, s.filter, s.anchor?.term), s.fetchedAt.replace(/:/g, '-') + '-' + s.id + '.json'); await atomicJson(path, s); return path; }
  async history(term: string, filter: Partial<TrendsFilter> = {}, limit = Infinity, anchorTerm?: string): Promise<TermSnapshot[]> {
    const dir = join(this.dir, this.key(term, resolveFilter(filter), anchorTerm));
    try { const files = (await readdir(dir)).filter(f => f.endsWith('.json')); const rows = await Promise.all(files.map(async f => JSON.parse(await readFile(join(dir, f), 'utf8')) as TermSnapshot)); return rows.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt)).slice(0, limit); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  }
  async latest(term: string, filter: Partial<TrendsFilter> = {}, anchorTerm?: string) { return (await this.history(term, filter, 1, anchorTerm))[0] ?? null; }
}
export async function askTerm(term: string, opts: { maxAgeMin?: number; refresh?: 'if-stale' | 'never' | 'always'; store?: SnapshotStore; filter?: Partial<TrendsFilter>; query?: typeof queryTrends } = {}) {
  const store = opts.store ?? new SnapshotStore(), filter = resolveFilter(opts.filter);
  const old = await store.latest(term, filter), age = old ? Math.max(0, (Date.now() - Date.parse(old.fetchedAt)) / 60000) : Infinity;
  if (old && (old.status === 'ok' || old.status === 'no_data') && (opts.refresh === 'never' || opts.refresh !== 'always' && age <= (opts.maxAgeMin ?? 360))) return { snapshot: gateLowSample({ ...old, term }), source: 'cache' as const, ageMin: age };
  if (opts.refresh === 'never') throw new Error('no cached snapshot');
  const snapshot = await snapshotTerm(term, filter, opts); await store.save(snapshot);
  return { snapshot, source: 'live' as const, ageMin: Math.max(0, (Date.now() - Date.parse(snapshot.fetchedAt)) / 60000) };
}
export function diffSnapshots(prev: TermSnapshot, next: TermSnapshot) {
  if (!matchingSnapshots(prev, next) || !usableDiffSnapshot(prev) || !usableDiffSnapshot(next)) return null;
  const key = normalizeKeyword;
  return { term: next.term, filter: next.filter, from: prev.id, to: next.id,
    newPopular: next.popular.filter(n => !prev.popular.some(p => key(p.query) === key(n.query))).map(p => p.query),
    droppedPopular: prev.popular.filter(p => !next.popular.some(n => key(p.query) === key(n.query))).map(p => p.query),
    newRising: next.rising.filter(n => !prev.rising.some(p => key(p.query) === key(n.query))),
    risingUp: next.rising.flatMap(n => { const p = prev.rising.find(p => key(p.query) === key(n.query)); return p && n.value > p.value ? [{ query: n.query, from: p.value, to: n.value }] : []; }),
    regionMoves: next.regions.flatMap(n => { const p = prev.regions.find(p => p.code === n.code); return p && p.rank !== n.rank ? [{ code: n.code, fromRank: p.rank, toRank: n.rank }] : []; }),
    interestDelta: (() => { const from = summarizeInterest(prev.interest.points, prev.filter).settledLatest, to = summarizeInterest(next.interest.points, next.filter).settledLatest; return { latestFrom: from, latestTo: to, delta: to - from }; })() };
}

/** Only complete, successful data can be a comparison baseline. Failures remain on disk for diagnostics. */
function usableDiffSnapshot(s: TermSnapshot) { return s.status === 'ok' && !s.error && !isLowSample(s); }
function matchingSnapshots(a: TermSnapshot, b: TermSnapshot) {
  const store = new SnapshotStore();
  return store.key(a.term, a.filter, a.anchor?.term) === store.key(b.term, b.filter, b.anchor?.term);
}
export function snapshotDiff(current: TermSnapshot, history: TermSnapshot[]) {
  if (!usableDiffSnapshot(current)) return { diff: null, diffReason: 'Current snapshot has no usable successful data' };
  const index = history.findIndex(s => s.id === current.id);
  const prior = index < 0 ? history : history.slice(index + 1);
  const previous = prior.find(s => matchingSnapshots(s, current) && usableDiffSnapshot(s));
  if (!previous) return { diff: null, diffReason: prior.some(s => !matchingSnapshots(s, current))
    ? 'Snapshot history has incompatible term or filters' : prior.length ? 'No usable prior successful snapshot' : 'Need two snapshots' };
  return { diff: diffSnapshots(previous, current) };
}

/** Writes JSON via a unique temp file and rename. */
export async function atomicJson(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); const tmp = `${path}.${randomUUID()}.tmp`; try { await writeFile(tmp, JSON.stringify(value, null, 2)); await rename(tmp, path); } finally { await unlink(tmp).catch(() => {}); } }
