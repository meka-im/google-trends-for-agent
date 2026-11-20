import { estimateVolume, hasVolumeSignal, normalizeTerm, pointsOf, row, rows, volumeFilter, volumeReferences, type VolumeSettings } from './dashboard-volume.js';
import { settledPoints } from './filter.js';
import { settledNonGapPoints } from './gaps.js';
import { anchorDailySearches } from './traffic.js';
import type { SavedQuery } from './query-history-types.js';
import { supportsVolumeWindow } from './volume-types.js';
import type { CalibrationPoint } from './calibration.js';

import type { BatchResult, BatchRound, BatchReading } from './batch-types.js';

function original(saved: SavedQuery, keyword: string) {
  const series = rows(saved.result.series).find(s => normalizeTerm(String(s.keyword)) === normalizeTerm(keyword));
  return pointsOf(series?.points ?? row(saved.result.interest).points);
}
function aligned(a: CalibrationPoint[], b: CalibrationPoint[]) {
  return a.length > 0 && a.length === b.length && a.every((p, i) => Date.parse(p.time) === Date.parse(b[i]!.time));
}
const mean = (points: CalibrationPoint[]) => points.reduce((sum, p) => sum + p.value, 0) / points.length;

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
  const nearest = (value: number) => candidates.reduce<typeof candidates[number] | undefined>((best,a) =>
    !best || Math.abs(Math.log(anchorDailySearches(a)!/value)) < Math.abs(Math.log(anchorDailySearches(best)!/value)) ? a : best, undefined);
  let anchor = refs.pinned ? pinned : nearest(1600);
  for (let round = 1; supportsVolumeWindow(filter.time) && batch.length && anchor && round <= 2; round++) {
    const info = { round, anchor: anchor.term, daily: anchorDailySearches(anchor)!, targets: batch.map(t => t.keyword), completed: [...latest.values()].filter(done).length };
    state.rounds.push(info);
    await store(info);
    const keywords = [...new Set([...batch.map(t => normalizeTerm(t.keyword)), normalizeTerm(anchor.term)])];
    const output = await compare(keywords.map(key => batch.find(t => normalizeTerm(t.keyword) === key)?.keyword ?? anchor!.term));
    const meta = row(output.meta);
    if (typeof meta.actorRunId === 'string') state.runs.push({ actorRunId: meta.actorRunId, costUsd: typeof meta.actorUsageUsd === 'number' ? meta.actorUsageUsd : null, createdAt: new Date().toISOString() });
    if (!output.ok || output.status === 'blocked') { state.error = String(row(output.error).code ?? 'NETWORK_ERROR'); break; }
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
    const next = hints.length ? nearest(Math.max(...hints)) : mean(settledBase) < 3 ? nearest(info.daily*30) : candidates[0];
    if (refs.pinned || next?.term === anchor.term) break;
    anchor = next;
  }
  for (const term of terms) if (!latest.has(normalizeTerm(term.keyword))) {
    put(estimateVolume(term.keyword, [], [], filter, state.rounds.length ? 'samples' : 'baseline'));
  }
  state.complete = !state.error;
  await store();
  return state;
}
