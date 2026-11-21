import { estimateVolume, hasVolumeSignal, normalizeTerm, pointsOf, row, rows, volumeFilter, volumeReferences, type VolumeSettings } from './dashboard-volume.js';
import { settledPoints } from './filter.js';
import { settledNonGapPoints } from './gaps.js';
import { anchorDailySearches } from './traffic.js';
import type { SavedQuery } from './query-history-types.js';
import { supportsVolumeWindow } from './volume-types.js';
import type { CalibrationPoint } from './calibration.js';

import { GTrendsError } from './core.js';
import type { BatchResult, BatchRound, BatchReading } from './batch-types.js';

function original(saved: SavedQuery, keyword: string) {
  const series = rows(saved.result.series).find(s => normalizeTerm(String(s.keyword)) === normalizeTerm(keyword));
  return pointsOf(series?.points ?? row(saved.result.interest).points);
}
function aligned(a: CalibrationPoint[], b: CalibrationPoint[]) {
  return a.length > 0 && a.length === b.length && a.every((p, i) => Date.parse(p.time) === Date.parse(b[i]!.time));
}
const mean = (points: CalibrationPoint[]) => points.reduce((sum, p) => sum + p.value, 0) / points.length;

/** Older completed comparisons retained the shared interest curves even when
 * the volume gate discarded a dense low-scoring term. Recover its scale
 * from a directly calibrated peer in this record, on matching time buckets.
 */
export function recoverComparisonCurves(saved: SavedQuery) {
  const batch = saved.result.batchVolume as BatchResult | undefined;
  if (!batch?.complete || batch.error || saved.record.tool !== 'trends_compare') return;
  const filter = volumeFilter(saved.record.geo, saved.record.time);
  const bases = batch.series.filter(s => !s.via && s.anchor && s.traffic.average && s.points.length);
  for (const [index, missing] of batch.series.entries()) {
    if (missing.reason !== 'samples' || missing.below || missing.traffic.average !== null) continue;
    const target = original(saved, missing.keyword);
    for (const basis of bases) {
      const ref = original(saved, basis.keyword);
      if (!aligned(target, ref)) continue;
      const measured = new Map(basis.points.map(p => [Date.parse(p.t), p.value]));
      const settled = settledNonGapPoints(ref, filter);
      const matching = settled.flatMap(p => {
        const daily = measured.get(Date.parse(p.time));
        return daily != null && p.value > 0 ? [daily] : [];
      });
      if (matching.length < 3 || matching.length < .9 * settled.length) continue;
      const pairedReference = ref.filter(p => measured.get(Date.parse(p.time)) != null ||
        Date.parse(p.time) > Date.parse(settled.at(-1)!.time));
      const dailySearches = matching.reduce((sum, v) => sum + v, 0) / matching.length;
      const inferred = estimateVolume(missing.keyword, target, [{points: pairedReference, anchor: {
        term: basis.keyword, geo: filter.geo, dailySearches, tolerance: basis.anchor!.tolerance,
      }}], filter);
      if (inferred.traffic.average === null) continue;
      batch.series[index] = {...inferred, via: basis.keyword, anchor: basis.anchor};
      break;
    }
  }
}

export async function estimateBatch(saved: SavedQuery, settings: VolumeSettings, requestId: string,
  compare: (keywords: string[]) => Promise<Record<string, unknown>>,
  publish: (state: BatchResult, round?: BatchRound) => Promise<void>,
  cached: (term: string) => Promise<SavedQuery | null>,
) {
  const { record } = saved;
  const filter = volumeFilter(record.geo, record.time);
  const refs = volumeReferences(filter, settings);
  const requested = new Set(record.terms.map(normalizeTerm));
  const candidates = refs.available.filter(a => !requested.has(normalizeTerm(a.term)));
  const pinned = refs.pinned ? refs.lookup(refs.pinned) : undefined;
  const state: BatchResult = { requestId, series: [], rounds: [], runs: [], complete: false };
  const latest = new Map<string, BatchReading>();
  const done = (v?: BatchReading) => v?.traffic.average != null || v?.below != null;
  const put = (v: BatchReading) => latest.set(normalizeTerm(v.keyword), v);
  const store = async (active?: BatchRound) => {
    state.series = [...latest.values()];
    await publish(state, active);
  };
  const terms = record.terms.map(keyword => {
    const points = original(saved, keyword);
    const settled = settledNonGapPoints(points, filter);
    const peak = Math.max(1, ...settled.map(p => p.value));
    const sorted = settled.map(p => p.value).sort((a,b) => a-b);
    const quality = hasVolumeSignal(settled) ? (sorted[Math.floor(sorted.length/2)] ?? 0) / peak : 0;
    return { keyword, points, quality };
  });
  for (const term of terms) {
    const previous = await cached(term.keyword);
    if (!previous || !aligned(term.points, original(previous, term.keyword))) continue;
    const prior = (previous.result.batchVolume as BatchResult | undefined)?.series.find(s =>
      normalizeTerm(s.keyword) === normalizeTerm(term.keyword) && s.traffic.average !== null);
    const base = prior?.anchor && refs.lookup(prior.anchor.term);
    if (prior && base && anchorDailySearches(base) === prior.anchor?.dailySearches && (!pinned || pinned.term === base.term)) {
      put({ ...prior, keyword: term.keyword, reused: true });
    }
  }
  const pending = terms.filter(t => !latest.has(normalizeTerm(t.keyword))).sort((a,b) => b.quality-a.quality);
  const reference = pending[0];
  let batch = pending.length === 5 ? [reference!, ...pending.slice(-3)] : pending;
  const nearest = (value: number, pool = candidates) => pool.reduce<typeof candidates[number] | undefined>((best,a) =>
    !best || Math.abs(Math.log(anchorDailySearches(a)!/value)) < Math.abs(Math.log(anchorDailySearches(best)!/value)) ? a : best, undefined);
  const tried = new Set<string>();
  let anchor = refs.pinned ? pinned : nearest(1600);
  for (let round = 1; supportsVolumeWindow(filter.time) && batch.length && anchor && round <= 3; round++) {
    tried.add(normalizeTerm(anchor.term));
    const info: BatchRound = { round, anchor: anchor.term, daily: anchorDailySearches(anchor)!, targets: batch.map(t => t.keyword), completed: [...latest.values()].filter(done).length };
    state.rounds.push(info);
    await store(info);
    const keywords = [...new Set([...batch.map(t => normalizeTerm(t.keyword)), normalizeTerm(anchor.term)])];
    let output: Record<string, unknown>;
    try {
      output = await compare(keywords.map(key => batch.find(t => normalizeTerm(t.keyword) === key)?.keyword ?? anchor!.term));
    } catch (error) {
      if (!(error instanceof GTrendsError)) throw error;
      info.error = state.error = error.code;
      break;
    }
    const meta = row(output.meta);
    if (typeof meta.actorRunId === 'string') state.runs.push({ actorRunId: meta.actorRunId, costUsd: typeof meta.actorUsageUsd === 'number' ? meta.actorUsageUsd : null, createdAt: new Date().toISOString() });
    if (!output.ok || output.status === 'blocked') {
      const code = String(row(output.error).code ?? 'NETWORK_ERROR');
      info.error = code;
      state.error = code;
      break;
    }
    const byTerm = new Map(rows(output.series).map(s => [normalizeTerm(String(s.keyword)), pointsOf(s.points)]));
    const base = byTerm.get(normalizeTerm(anchor.term)) ?? [];
    const settledBase = settledNonGapPoints(base, filter);
    for (const term of batch) {
      const target = byTerm.get(normalizeTerm(term.keyword)) ?? [];
      if (!aligned(term.points, target) || !aligned(target, base)) continue;
      const estimate: BatchReading = estimateVolume(term.keyword, target, [{ anchor, points: base }], filter);
      // A censored zero alone cannot bound search volume. Require repeated
      // paired observations below a clearly visible regional floor.
      if (estimate.reason === 'samples' && anchor.term === refs.available[0]?.term) {
        const pairs = settledPoints(target, filter);
        const settled = settledPoints(base, filter);
        if (pairs.filter(p => p.value > 0).length >= 2 && hasVolumeSignal(settled) &&
          pairs.length >= 4 && settled.every((p,i) => p.value >= 3 && pairs[i]!.value + 1 < p.value)) estimate.below = info.daily;
      }
      put(estimate);
    }
    const basis = reference && latest.get(normalizeTerm(reference.keyword));
    if (round === 1 && reference && basis?.traffic.average && basis.anchor && reference.quality > 0) {
      for (const term of pending.filter(t => !batch.includes(t) && t.quality > 0 && aligned(t.points, reference.points))) {
        const calibrated = estimateVolume(term.keyword, term.points, [{ points: reference.points, anchor: {
          term: reference.keyword, geo: filter.geo, dailySearches: basis.traffic.average, tolerance: basis.anchor.tolerance,
        } }], filter);
        if (calibrated.traffic.average !== null) put({ ...calibrated, via: reference.keyword, anchor: basis.anchor });
      }
    }
    batch = pending.filter(t => !done(latest.get(normalizeTerm(t.keyword)))).slice(0,4);
    const hints = batch.map(t => latest.get(normalizeTerm(t.keyword))?.anchorTargetDaily).filter((v): v is number => Boolean(v));
    const targetDaily = hints.length ? Math.exp(hints.reduce((sum, v) => sum + Math.log(v), 0) / hints.length) : undefined;
    const untried = candidates.filter(a => !tried.has(normalizeTerm(a.term)));
    const next = targetDaily ? nearest(targetDaily, untried) : mean(settledBase) < 3 ? nearest(info.daily * 30, untried) : untried[0];
    if (refs.pinned || !next || (round === 2 && !targetDaily)) break;
    anchor = next;
  }
  for (const term of terms) if (!state.error && !latest.has(normalizeTerm(term.keyword))) {
    put(estimateVolume(term.keyword, [], [], filter, state.rounds.length ? 'samples' : 'baseline'));
  }
  state.complete = !state.error;
  await store();
  return state;
}
