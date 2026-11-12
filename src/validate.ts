import { queryTrends } from './api.js';
import type { InterestOverTime } from './core.js';
import { resolveFilter, filterInput, type TrendsFilter } from './filter.js';
import { settledNonGapPoints, summarizeInterest } from './gaps.js';
import { askTerm, SnapshotStore, type TermSnapshot } from './snapshot.js';
import { fetchTrending, type TrendingItem } from './trending.js';
import { anchorDailySearches, defaultAnchorFor, findAnchor, type Baselines } from './traffic.js';
import { calibrateTraffic, nullTraffic, type TrafficEstimate } from './calibration.js';
export interface LeadInput { name: string; variants?: string[]; source?: string; url?: string; firstSeen?: string }
export function parseLeadInput(json: unknown): LeadInput[] {
  if (typeof json === 'string') { try { return parseLeadInput(JSON.parse(json)); } catch { return [{ name: json }]; } }
  if (Array.isArray(json)) return json.flatMap(x => typeof x === 'string' ? [{ name: x }] : parseLeadInput(x));
  if (!json || typeof json !== 'object') return [];
  const row = json as Record<string, unknown>;
  for (const field of ['leads', 'rows', 'keywords', 'table']) if (Array.isArray(row[field])) return parseLeadInput(row[field]);
  const name = row.name ?? row.term ?? row.keyword;
  return typeof name === 'string' && name.trim() ? [{ ...row, name } as unknown as LeadInput] : [];
}
export interface TermVerdict {
  term: string; input: LeadInput; filter: TrendsFilter; verdict: 'spiking' | 'rising' | 'steady' | 'flat' | 'no_data' | 'blocked'; freshSpike?: { ratio: number; baseline: number; recent: number; recheckAfterMin: number };
  confidence: 'high' | 'mid' | 'low'; reasons: string[]; interest: TermSnapshot['interest'];
  popular: TermSnapshot['popular']; rising: TermSnapshot['rising']; regions: TermSnapshot['regions'];
  /** `traffic` is searches/day (shared snapshot formula). */
  anchor: { term: string; dailySearches: number | null; ratio: number | null; band: 'high' | 'mid' | 'low' | null; traffic: TrafficEstimate; note: string; warning?: string };
  trendingNow?: TrendingItem; retryAfterSec?: number; snapshotId: string; fetchedAt: string; source: 'live' | 'cache'; exploreUrl: string;
}
export interface ValidateOptions {
  filter?: Partial<TrendsFilter>; anchor?: string | false; store?: SnapshotStore; maxAgeMin?: number; query?: typeof queryTrends;
  trending?: boolean; refresh?: 'if-stale' | 'never' | 'always'; concurrency?: 1; stopOnBlocked?: boolean; baselines?: Baselines; trendingFetch?: typeof fetchTrending;
}
/** Short windows only (now 1-d / 4-H / 1-H): the last 1-2 settled points jump well above
 * the rest of the window (>= 3× its mean and >= 20 absolute, and +15 over the mean). */
export function detectFreshSpike(values: number[], filter: Pick<TrendsFilter, 'time'>): TermVerdict['freshSpike'] | undefined {
  if (!/^now \d+-[dH]$/.test(filter.time) || /^now 7-d$/.test(filter.time) || values.length < 8) return;
  const recentVals = values.slice(-2), base = mean(values.slice(0, -2)), recent = Math.max(mean(recentVals), recentVals[recentVals.length - 1]);
  if (recent >= 20 && recent >= base + 15 && recent >= 3 * Math.max(base, 1)) return { ratio: recent / Math.max(base, 1), baseline: base, recent, recheckAfterMin: 60 };
}
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
/** Compare the settled final half with the earlier half. Daily rises must persist
 * through the third-from-last point; breakout evidence can independently qualify. */
export async function validateTerms(input: (string | LeadInput)[], opts: ValidateOptions = {}): Promise<TermVerdict[]> {
  if (opts.concurrency !== undefined && opts.concurrency !== 1) throw new Error('validation concurrency must be 1');
  const filter = resolveFilter(opts.filter), store = opts.store ?? new SnapshotStore(), query = opts.query ?? queryTrends;
  const anchorTerm = opts.anchor === false ? '' : opts.anchor?.trim() || defaultAnchorFor(filter.time, opts.baselines);
  const calibration = findAnchor(opts.baselines, anchorTerm, filter.geo);
  const daily = calibration ? anchorDailySearches(calibration) : null;
  const tolerance = daily === null ? null : calibration?.tolerance ?? .5;
  const results: TermVerdict[] = [], rows = new Map<string, TermVerdict>(); let blocked = false;
  const pending: { term: string; anchor: TermVerdict['anchor'] }[] = [];
  const trending = opts.trending ? await (opts.trendingFetch ?? fetchTrending)({ geo: filter.geo, hours: 24 }) : undefined;
  for (const lead of parseLeadInput(input)) {
    const term = lead.name;
    const answer = await askTerm(term, { filter, store, maxAgeMin: opts.maxAgeMin, refresh: opts.refresh, query: blocked ? async i => ({ status: 'error', input: i, error: { code: 'BLOCKED', message: 'skipped after upstream block' }, meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 0, durationMs: 0, warnings: [] } }) : query });
    const s = answer.snapshot, interest = summarizeInterest(s.interest.points, filter), settled = settledNonGapPoints(s.interest.points, filter), values = settled.map(p => p.value);
    const split = Math.ceil(values.length / 2), early = mean(values.slice(0, split)), tail = mean(values.slice(split));
    const ratio = early ? tail / early : tail > 0 ? Infinity : 0;
    const spike = detectFreshSpike(values, filter);
    let verdict: TermVerdict['verdict'] = 'flat';
    const reasons: string[] = [];
    let retryAfterSec: number | undefined;
    if (s.status === 'blocked') { verdict = 'blocked'; reasons.push(s.error?.code ?? 'BLOCKED'); if (s.error?.retryAfterSec !== undefined) retryAfterSec = s.error.retryAfterSec; if (opts.stopOnBlocked !== false) blocked = true; }
    else if (s.status === 'error' || !values.some(v => v > 0)) { verdict = 'no_data'; reasons.push(s.error?.message ?? 'No settled search interest'); }
    else if (spike) { verdict = 'spiking'; reasons.push(`Fresh spike: last points avg ${spike.recent.toFixed(0)} vs earlier 24h avg ${spike.baseline.toFixed(1)} (${spike.ratio.toFixed(1)}×); recheck in ~${spike.recheckAfterMin} min`); }
    else if (values.length >= 2 && ratio >= 1.5 || s.rising.some(r => r.breakout)) { verdict = 'rising'; reasons.push(s.rising.some(r => r.breakout) ? 'Breakout related queries' : 'Settled tail mean >= 1.5 × earlier mean'); }
    else if (Math.max(...values) >= 10 && tail >= early) { verdict = 'steady'; reasons.push('Settled peak >= 10 with no decline'); }
    else reasons.push('Insufficient sustained rise or declining interest');
    const anchor: TermVerdict['anchor'] = { term: anchorTerm || 'none', dailySearches: daily === null ? null : Math.round(daily), ratio: null, band: null, traffic: nullTraffic(), note: anchorTerm ? 'Comparison unavailable' : 'Anchor disabled' };
    if (anchorTerm && verdict !== 'blocked' && verdict !== 'no_data' && !blocked) pending.push({ term, anchor });
    if (!anchor.traffic.average && filter.geo !== 'US') anchor.note = `无法估 (no calibration for geo ${filter.geo})`;
    const match = trending?.items.find(i => i.title.toLowerCase().includes(term.toLowerCase()) || i.query.toLowerCase().includes(term.toLowerCase()));
    const row: TermVerdict = { term, input: lead, filter, verdict, ...(spike && verdict === 'spiking' ? { freshSpike: spike } : {}), confidence: verdict === 'spiking' ? 'mid' : verdict === 'blocked' || verdict === 'no_data' || values.length < 4 ? 'low' : values.length >= 12 ? 'high' : 'mid', reasons,
      interest: { ...s.interest, points: interest.points, latest: interest.latest, peak: interest.peak, settledLatest: interest.settledLatest }, popular: s.popular.slice(0, 5), rising: s.rising.slice(0, 5), regions: s.regions.slice(0, 5), anchor, ...(match ? { trendingNow: match } : {}), ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
      snapshotId: s.id, fetchedAt: s.fetchedAt, source: answer.source, exploreUrl: 'https://trends.google.com/trends/explore?' + new URLSearchParams({ q: term, geo: filter.geo, date: filter.time, cat: String(filter.category), gprop: filter.property }) };
    results.push(row); rows.set(term, row);
  }
  // One shared comparison per run: up to 4 terms + the anchor per Google request, so every
  // term in a batch is scaled against the same anchor curve.
  for (let i = 0; i < pending.length && !blocked; i += 4) {
    const batch = pending.slice(i, i + 4);
    const comparison = await query({ queries: [...batch.map(b => b.term), anchorTerm], ...filterInput(filter), dataTypes: ['interestOverTime'] });
    if (['BLOCKED', 'RATE_LIMITED'].includes(comparison.error?.code ?? '')) {
      for (const b of batch) { const r = rows.get(b.term)!; r.verdict = 'blocked'; r.confidence = 'low'; r.reasons.push(comparison.error!.code); b.anchor.note = comparison.error!.message; if (comparison.error!.retryAfterSec !== undefined) r.retryAfterSec = comparison.error!.retryAfterSec; delete r.freshSpike; }
      if (opts.stopOnBlocked !== false) blocked = true; continue;
    }
    const timeline = (comparison.data?.interestOverTime as InterestOverTime)?.timeline ?? [];
    const k = batch.length;
    const anchorPoints = timeline.map(p => ({ time: p.time, value: p.values[k] ?? 0 }));
    batch.forEach((b, j) => {
      const anchor = b.anchor;
      if (comparison.status === 'error' || !timeline.length) return;
      const termPoints = timeline.map(p => ({ time: p.time, value: p.values[j] ?? 0 }));
      // Same pure calibration helper as trends_snapshot: gap-aware means over the full
      // shared-scale comparison, so the ratio and daily band are directly comparable.
      const c = calibrateTraffic(termPoints, anchorPoints, { filter, dailySearches: daily, tolerance });
      anchor.ratio = c.ratio;
      anchor.band = c.ratio === null ? null : c.ratio >= 1 ? 'high' : c.ratio >= .1 ? 'mid' : 'low';
      anchor.traffic = c.traffic;
      anchor.note = daily === null ? `无法估 (no calibration for geo ${filter.geo}); traffic fields are null` : c.note;
      if (c.warning) anchor.warning = c.warning;
      else delete anchor.warning;
    });
  }
  return results;
}
