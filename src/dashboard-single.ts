import { GTrendsError } from './core.js';
import { anchorDailySearches, type Anchor } from './traffic.js';
import { settledPoints, type TrendsFilter } from './filter.js';
import { normalizeTerm, pointsOf, row, volumeReferences, volumeCalibration, estimateVolume, rows, volumeFilter, type VolumeSettings } from './dashboard-volume.js';
import { supportsVolumeWindow } from './volume-types.js';
import type { SavedQuery } from './query-history-types.js';
import type { CalibrationPoint } from './calibration.js';

const daily = (anchor: Anchor) => anchorDailySearches(anchor)!;
type Envelope = Record<string, unknown>;
type Execute = (name: 'trends_snapshot' | 'trends_compare', args: Envelope) => Promise<Envelope>;

export function retryAnchors(target: CalibrationPoint[], reference: CalibrationPoint[], first: Anchor,
  candidates: Anchor[], filter: TrendsFilter): Anchor[] {
  const terms = settledPoints(target, filter);
  const refs = new Map(settledPoints(reference, filter).map(p => [Date.parse(p.time), p.value]));
  const pairs = terms.flatMap(p => {
    const other = refs.get(Date.parse(p.time));
    return other === undefined ? [] : [{ term: p.value, ref: other }];
  });
  if (pairs.length < Math.max(3, terms.length * .75)) return [];
  const termSum = pairs.reduce((n, p) => n + p.term, 0);
  const refSum = pairs.reduce((n, p) => n + p.ref, 0);
  const lower = candidates.filter(a => daily(a) < daily(first));
  const higher = candidates.filter(a => daily(a) > daily(first));
  if (!termSum) return refSum ? lower.slice(0, 2) : [];
  if (!refSum) return higher.slice(-2);

  // All candidates are sorted by daily volume. A spiky target needs a reference
  // visible even at its peak (roughly 10/100 on the new comparison's scale).
  const rough = daily(first) * termSum / refSum;
  const peakFloor = daily(first) * Math.max(...pairs.map(p => p.term)) * pairs.length / (10 * refSum);
  const expected = Math.max(rough, peakFloor);
  const pool = expected < daily(first) ? lower : higher;
  const below = pool.filter(a => daily(a) <= expected);
  const above = pool.filter(a => daily(a) > expected);
  // At an anchor score of 1 or 2, half a unit of rounding materially
  // changes the ratio. Use the second slot to cover that uncertainty.
  if (expected >= daily(first) && refSum / pairs.length < 3 && higher.length >= 2) {
    const nearest = [...higher].sort((a, b) =>
      Math.abs(Math.log(daily(a) / expected)) - Math.abs(Math.log(daily(b) / expected)))[0];
    const denominator = pairs.reduce((sum, p) => sum + Math.max(0, p.ref - .5), 0);
    const upper = daily(first) * (termSum + .5 * pairs.length) / denominator;
    const aboveNearest = higher.filter(a => daily(a) > daily(nearest));
    const guard = aboveNearest.find(a => daily(a) >= upper) ?? aboveNearest.at(-1);
    if (guard) return [nearest, guard];
  }
  if (!below.length) return above.slice(0, 2);
  if (!above.length) return below.slice(-2);
  return [below[below.length - 1], above[0]];
}

/** One snapshot retains related queries and the seven-day companion. Only
 * an inconclusive, correctly paired sample can trigger a second comparison. */
export async function singleVolume(input: Envelope, settings: VolumeSettings, previous: SavedQuery | null,
  execute: Execute, calibrating: () => void): Promise<Envelope> {
  const term = String(input.term);
  const filter = volumeFilter(String(input.geo ?? settings.geo), String(input.time ?? 'now 7-d'));
  const pinned = typeof input.anchor === 'string' ? { ...settings, anchor: input.anchor } : settings;
  const refs = volumeReferences(filter, pinned);
  const snapshotRefs = volumeReferences(filter, pinned, 'now 7-d');
  const distinct = (a: Anchor) => normalizeTerm(a.term) !== normalizeTerm(term);
  const available = snapshotRefs.available.filter(distinct);
  const prior = rows(row(previous?.result.calibration).series).find(s => normalizeTerm(String(s.keyword)) === normalizeTerm(term));
  const priorCheck = [...(previous?.volumeChecks ?? [])].reverse().find(c => normalizeTerm(c.keyword) === normalizeTerm(term) && (c.estimate?.anchor || c.estimate?.range));
  const priorTerm = priorCheck?.estimate?.anchor?.term ?? priorCheck?.estimate?.range?.anchors[0] ??
    row(prior?.anchor).term ?? (Array.isArray(row(prior?.range).anchors) ? (row(prior?.range).anchors as string[])[0] : undefined);
  const priorMeta = row(previous?.result.meta);
  const age = Date.now() - Date.parse(String(priorMeta.fetchedAt));
  const cachedFirst = !input.fresh && age >= 0 && age < 6 * 3600000 && previous?.record.tool === 'trends_snapshot'
    ? row(previous.result.anchor).term : undefined;
  const byDistance = (a: Anchor) => Math.abs(Math.log(daily(a) / 15000));
  const first = snapshotRefs.pinned ? snapshotRefs.lookup(snapshotRefs.pinned) :
    available.find(a => typeof cachedFirst === 'string' && normalizeTerm(a.term) === normalizeTerm(cachedFirst)) ??
    available.find(a => typeof priorTerm === 'string' && normalizeTerm(a.term) === normalizeTerm(priorTerm)) ??
    [...available].sort((a, b) => byDistance(a) - byDistance(b))[0];
  const initial = await execute('trends_snapshot', first ? { ...input, anchor: first.term } : input);
  if (!initial.ok || initial.status === 'blocked') return initial;
  calibrating();
  const series = row(initial.series);
  const target = pointsOf(series.points, 'score'), reference = pointsOf(series.anchorPoints, 'score');
  const actual = row(initial.anchor).term;
  const used = typeof actual === 'string' ? refs.lookup(actual) : undefined;
  let estimate = estimateVolume(term, target, used ? [{ anchor: used, points: reference }] : [], filter, 'baseline');
  const rounds = [typeof actual === 'string' ? [actual] : []];
  const meta = row(initial.meta);
  const priorCalibration = row(previous?.result.calibration);
  const catalogKey = JSON.stringify(refs.available.map((a: Anchor) => [a.term, daily(a), a.tolerance]));
  if (meta.cached && !refs.pinned && previous?.record.tool === 'trends_snapshot' && priorCalibration.catalogKey === catalogKey &&
      (meta.actorRunId && meta.actorRunId === priorMeta.actorRunId || meta.snapshotId && meta.snapshotId === priorMeta.snapshotId) &&
      priorCalibration.status === 'ok') {
    return { ...initial, calibration: priorCalibration };
  }
  const remaining = refs.available.filter(a => distinct(a) && normalizeTerm(a.term) !== normalizeTerm(String(actual)));
  let retryError: string | undefined;
  let retryMeta: Envelope = {};
  if (used && !refs.pinned && supportsVolumeWindow(filter.time) && !estimate.anchor && !estimate.range) {
    const next = retryAnchors(target, reference, used, remaining, filter);
    if (next.length) {
      rounds.push(next.map(a => a.term));
      const result = await execute('trends_compare', {
        keywords: [term, ...next.map(a => a.term)], geo: filter.geo, time: filter.time, timeoutMs: input.timeoutMs,
      }).catch((error: unknown): Envelope => ({
        ok: false, error: { code: error instanceof GTrendsError ? error.code : 'NETWORK_ERROR' },
      }));
      retryMeta = row(result.meta);
      if (!result.ok || result.status === 'blocked') retryError = String(row(result.error).code ?? 'NETWORK_ERROR');
      else {
        const batch = new Map(rows(result.series).map(s => [normalizeTerm(String(s.keyword)), pointsOf(s.points)]));
        const second = batch.get(normalizeTerm(term)) ?? [];
        const times = settledPoints(target, filter), newTimes = settledPoints(second, filter);
        if (times.length === newTimes.length && times.every((p, i) => Date.parse(p.time) === Date.parse(newTimes[i].time))) {
          estimate = estimateVolume(term, second, next.map(anchor => ({ anchor, points: batch.get(normalizeTerm(anchor.term)) ?? [] })), filter);
        } else retryError = 'WINDOW_MISMATCH';
      }
    }
  }
  const calibration = volumeCalibration([estimate]);
  return { ...initial, ...(initial.status === 'no_data' && (estimate.anchor || estimate.range) ? { status: 'partial' } : {}),
    calibration: { ...calibration, status: estimate.range ? 'ok' : calibration.status, rounds, retryError, catalogKey },
    meta: { ...meta, ...(rounds.length > 1 ? { calibrationRetry: retryMeta } : {}) } };
}
