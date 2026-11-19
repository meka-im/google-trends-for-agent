import { supportsVolumeWindow } from './volume-types.js';
import { TIME_RANGES } from './core.js';
import { settledPoints } from './filter.js';
import { estimateVolume, hasVolumeSignal, normalizeTerm, pointsOf, row, rows, volumeFilter, volumeReferences, type VolumeSettings } from './dashboard-volume.js';
import { anchorDailySearches } from './traffic.js';
import type { EgressMode } from './options.js';
import type { SavedQuery, VolumeCheck } from './query-history-types.js';

export function estimateRequest(saved: SavedQuery, term: string, settings: VolumeSettings) {
  const { record, result } = saved;
  if (record.tool !== 'trends_compare' && record.tool !== 'trends_snapshot') return;
  if (!result.ok || result.status === 'blocked' || !(TIME_RANGES as readonly string[]).includes(record.time) || !supportsVolumeWindow(record.time)) return;
  const keyword = record.terms.find(value => normalizeTerm(value) === normalizeTerm(term));
  if (!keyword) return;
  const filter = volumeFilter(record.geo, record.time);
  const calibration = row(result.calibration);
  const previous = rows(calibration.series).find(value => normalizeTerm(String(value.keyword)) === normalizeTerm(keyword));
  const previousTraffic = row(previous?.traffic ?? result.traffic);
  if (calibration.settledOnly && typeof previousTraffic.average === 'number') return;
  const series = record.tool === 'trends_compare'
    ? pointsOf(rows(rows(result.series).find(value => normalizeTerm(String(value.keyword)) === normalizeTerm(keyword))?.points)
      .map(point => ({ ...point, value: point.value ?? 0 })))
    : pointsOf(row(result.series).points, 'score');
  const refs = volumeReferences(filter, settings);
  const differentTerm = (anchor: { term: string }) => normalizeTerm(anchor.term) !== normalizeTerm(keyword);
  const available = refs.available.filter(differentTerm);
  const pinned = refs.pinned ? refs.lookup(refs.pinned) : undefined;
  const lowSignal = previous?.reason === 'samples' || !hasVolumeSignal(settledPoints(series, filter));
  const priorAverage = previousTraffic.average;
  const near = typeof priorAverage === 'number' && priorAverage > 0 ? [...available].sort((a, b) =>
    Math.abs(Math.log(anchorDailySearches(a)! / priorAverage)) - Math.abs(Math.log(anchorDailySearches(b)! / priorAverage)),
  ).slice(0, 3) : undefined;
  const spread = near ?? (lowSignal ? available.slice(0, 2) : [0, .33, .66, .85].flatMap(fraction => {
    const anchor = available[Math.floor((available.length - 1) * fraction)];
    return anchor ? [anchor] : [];
  }));
  // A known target can validate against another tier. An explicit pin takes
  // precedence whenever it can serve as a distinct reference.
  const references = refs.pinned && normalizeTerm(refs.pinned) !== normalizeTerm(keyword) ? pinned ? [pinned] : [] : [...new Set(spread)];
  if (!references.length) return;
  return { keyword, references, filter, series };
}

export function finishEstimate(
  request: NonNullable<ReturnType<typeof estimateRequest>>, result: Record<string, unknown>,
  egress: EgressMode, requestId: string, createdAt: string,
): VolumeCheck {
  const { keyword, filter, series: original } = request;
  const batch = new Map(rows(result.series).map(value => [normalizeTerm(String(value.keyword)), pointsOf(value.points)]));
  const series = batch.get(normalizeTerm(keyword)) ?? [];
  const originalTimes = settledPoints(original, filter).map(point => Date.parse(point.time));
  const newTimes = settledPoints(series, filter).map(point => Date.parse(point.time));
  const sameWindow = newTimes.length > 0 && newTimes.length === originalTimes.length &&
    newTimes.every((stamp, index) => stamp === originalTimes[index]);
  const meta = row(result.meta), error = row(result.error);
  const cost = meta.actorUsageUsd;
  return {
    keyword, requestId, createdAt, sameWindow, egress,
    fetchedAt: typeof meta.fetchedAt === 'string' ? meta.fetchedAt : null,
    actorRunId: typeof meta.actorRunId === 'string' ? meta.actorRunId : null,
    costUsd: egress === 'local' ? 0 : typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
    ...(result.ok ? { estimate: estimateVolume(keyword, series, request.references.map(anchor => ({
      anchor, points: batch.get(normalizeTerm(anchor.term)) ?? [],
    })), filter) } : { errorCode: typeof error.code === 'string' ? error.code : 'NETWORK_ERROR' }),
  };
}

/** Rebuild a v0.2.28 range from the exact completed batch, keeping its saved summary. */
export function restoreEstimateBand(saved: SavedQuery, check: VolumeCheck, output: Record<string, unknown>, settings: VolumeSettings) {
  const original = check.estimate, range = original?.range;
  if (!original || !range || range.points || !output.ok) return undefined;
  const filter = volumeFilter(saved.record.geo, saved.record.time);
  const actual = row(output.filter);
  if (actual.geo !== filter.geo || actual.time !== filter.time) return undefined;
  const { lookup } = volumeReferences(filter, settings);
  const batch = new Map(rows(output.series).map(value => [normalizeTerm(String(value.keyword)), pointsOf(value.points)]));
  const references = range.anchors.flatMap(term => {
    const anchor = lookup(term);
    return anchor ? [{ anchor, points: batch.get(normalizeTerm(term)) ?? [] }] : [];
  });
  const restored = estimateVolume(check.keyword, batch.get(normalizeTerm(check.keyword)) ?? [], references, filter);
  const band = restored.range;
  // The same scope, anchors, and saved results rule out applying newer baselines to history.
  if (!band?.points || band.low !== range.low || band.high !== range.high ||
    band.anchors.length !== range.anchors.length || !band.anchors.every((anchor, index) => anchor === range.anchors[index]) ||
    restored.period?.from !== original.period?.from || restored.period?.to !== original.period?.to) return undefined;
  return { ...check, estimate: { ...original, range: { ...range, points: band.points } } };
}
