import { nullTraffic, type CalibrationPoint } from './calibration.js';
import { supportsVolumeWindow, type TrafficEstimate, type VolumeReason, type VolumeSeries } from './volume-types.js';
import { currentMekaBaselineVersion, mekaAnchorsFor } from './dsh-baselines.js';
import { settledPoints, type TrendsFilter } from './filter.js';
import { markGaps } from './gaps.js';
import { anchorDailySearches, findAnchor, SHORT_WINDOWS, type Anchor, type Baselines } from './traffic.js';

export const row = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const rows = (value: unknown) => Array.isArray(value) ? value.map(row) : [];
export const normalizeTerm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
export const describeAnchor = (anchor: Anchor) => ({
  term: anchor.term, dailySearches: anchorDailySearches(anchor), tolerance: anchor.tolerance ?? .5,
});

export interface VolumeSettings { geo: string; anchor?: string; baselines?: Baselines }
export const volumeFilter = (geo: string, time: string): TrendsFilter => ({ geo: geo.trim().toUpperCase(), time, property: '', category: 0 });

export function volumeReferences(filter: TrendsFilter, settings: VolumeSettings, referenceTime = filter.time) {
  const window = (SHORT_WINDOWS as readonly string[]).includes(filter.time) ? 'short' : 'long';
  const requested = settings.anchor || settings.baselines?.windowAnchors?.[window]?.trim();
  const regional = mekaAnchorsFor(filter.geo, referenceTime);
  const custom = settings.baselines?.anchors.filter(anchor => anchor.geo.trim().toUpperCase() === filter.geo) ?? [];
  const byTerm = new Map([...regional, ...custom].map(anchor => [normalizeTerm(anchor.term), anchor]));
  const pinnedKey = requested === undefined ? undefined : normalizeTerm(requested);
  const ineligiblePin = pinnedKey !== undefined && !byTerm.has(pinnedKey) &&
    mekaAnchorsFor(filter.geo).some(anchor => normalizeTerm(anchor.term) === pinnedKey);
  const pinned = ineligiblePin ? undefined : requested;
  // Historical built-ins remain available to explicit pins. Automatic
  // calibration uses the MEKA catalog and user-supplied rows for this region.
  const lookup = (term: string) => {
    const key = normalizeTerm(term);
    return byTerm.get(key) ?? (pinned && key === pinnedKey ? findAnchor(undefined, term, filter.geo, filter) : undefined);
  };
  const available = [...byTerm.values()].sort((left, right) => anchorDailySearches(left)! - anchorDailySearches(right)!);
  return { pinned, lookup, available };
}

export function pointsOf(value: unknown, scoreKey = 'value'): CalibrationPoint[] {
  return rows(value).flatMap(point => {
    const score = point[scoreKey];
    return typeof point.t === 'string' && Number.isFinite(Date.parse(point.t)) &&
      typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100
      ? [{ time: point.t, value: score }] : [];
  });
}

const mean = (points: readonly CalibrationPoint[]) => points.reduce((sum, point) => sum + point.value, 0) / points.length;
const positive = (points: readonly CalibrationPoint[]) => points.filter(point => point.value > 0).length;
const peak = (points: readonly CalibrationPoint[]) => Math.max(0, ...points.map(point => point.value));

export function hasVolumeSignal(points: readonly CalibrationPoint[]): boolean {
  const nonzero = positive(points), average = mean(points);
  // At an average score of two, integer rounding can move the mean by up
  // to 25%. Accept this coarser estimate only with sustained observations.
  return (nonzero >= Math.max(3, points.length / 4) && average >= 3) ||
    (points.length >= 24 && nonzero >= .9 * points.length && average > 2);
}

function estimateAgainst(
  points: ReturnType<typeof markGaps<CalibrationPoint>>,
  anchorPoints: CalibrationPoint[],
  anchor: Anchor,
  filter: TrendsFilter,
) {
  // Both means use the same settled timestamps. A gap in either curve excludes that pair.
  const anchorByTime = new Map(settledPoints(markGaps(anchorPoints), filter).map(point => [Date.parse(point.time), point]));
  const pairs = points.flatMap(term => {
    const reference = anchorByTime.get(Date.parse(term.time));
    return reference && reference.value > 0 && !term.gap && !reference.gap ? [{ term, reference }] : [];
  });
  const terms = pairs.map(pair => pair.term), references = pairs.map(pair => pair.reference);
  const daily = anchorDailySearches(anchor);
  const anchorMean = mean(references);
  if (daily === null || terms.length < points.length * .75 || !hasVolumeSignal(terms)) return undefined;
  const ratio = mean(terms) / anchorMean, factor = daily / anchorMean;
  const anchorTargetDaily = daily * ratio;
  // Small nonzero scores can guide the next anchor selection even when
  // rounding makes this reference too weak to report a volume estimate.
  if (peak(references) < 10 || anchorMean < 3) return { anchorTargetDaily };
  const average = Math.round(anchorTargetDaily);
  const latest = Math.round([...terms].reverse().find(point => point.value > 0)!.value * factor);
  const tolerance = anchor.tolerance ?? .5;
  const traffic: TrafficEstimate = {
    unit: 'searches/day', average, latest, settledLatest: latest, peak: Math.round(peak(terms) * factor),
    low: Math.round(average * (1 - tolerance)), high: Math.round(average * (1 + tolerance)),
    gapCount: points.length - terms.length,
  };
  const pairedTimes = new Set(terms.map(point => point.time));
  return {
    anchorTargetDaily,
    estimate: {
      anchor: describeAnchor(anchor), traffic, distance: Math.abs(Math.log(ratio)),
      points: points.map(point => ({
        t: point.time, value: point.value > 0 && pairedTimes.has(point.time) ? Math.round(point.value * factor) : null,
      })),
    },
  };
}

/** Volume calibration for the dsh dashboard, using same-batch points on a common scale. */
export function estimateVolume(
  keyword: string, termPoints: CalibrationPoint[],
  references: { anchor: Anchor; points: CalibrationPoint[] }[], filter: TrendsFilter,
  missingReference: VolumeReason = 'anchor',
): VolumeSeries {
  const settled = settledPoints(markGaps(termPoints), filter);
  const period = settled.length ? { from: settled[0]!.time, to: settled.at(-1)!.time } : undefined;
  const unavailable = { keyword, traffic: nullTraffic(), points: [], period };
  if (!supportsVolumeWindow(filter.time)) return { ...unavailable, reason: 'window' };
  if (!references.length) return { ...unavailable, reason: missingReference };
  if (!hasVolumeSignal(settled)) return { ...unavailable, reason: 'samples' };
  const comparisons = references.flatMap(({ anchor, points }) => {
    const comparison = estimateAgainst(settled, points, anchor, filter);
    return comparison ? [comparison] : [];
  });
  const estimates = comparisons.flatMap(({ estimate }) => estimate ? [estimate] : [])
    .sort((left, right) => left.distance - right.distance);
  const best = estimates[0];
  if (!best) {
    const hints = comparisons.map(({ anchorTargetDaily }) => Math.log(anchorTargetDaily));
    const anchorTargetDaily = hints.length ? Math.round(Math.exp(hints.reduce((sum, hint) => sum + hint, 0) / hints.length)) : undefined;
    return { ...unavailable, reason: 'anchor', ...(anchorTargetDaily ? { anchorTargetDaily } : {}) };
  }
  const averages = estimates.map(estimate => estimate.traffic.average!);
  const low = Math.min(...averages), high = Math.max(...averages);
  if (high > 2 * low) {
    const points = settled.map((point, index) => {
      const values = estimates.flatMap(estimate => {
        const value = estimate.points[index]!.value;
        return value === null ? [] : [value];
      });
      const aligned = values.length === estimates.length;
      return { t: point.time, low: aligned ? Math.min(...values) : null, high: aligned ? Math.max(...values) : null };
    });
    return { ...unavailable, reason: 'disagreement', range: { low, high, anchors: estimates.map(estimate => estimate.anchor.term), points } };
  }
  const used = best.points.filter(point => point.value !== null);
  return { keyword, anchor: best.anchor, traffic: best.traffic, points: best.points,
    period: { from: used[0]!.t, to: used.at(-1)!.t } };
}

export function volumeCalibration(series: VolumeSeries[], reason: VolumeReason = 'anchor') {
  const anchor = series.find(item => item.anchor)?.anchor;
  const count = series.filter(item => item.anchor).length;
  return {
    status: count === 0 ? 'unavailable' : count === series.length ? 'ok' : 'partial',
    reasonCode: count ? 'ok' : series[0]?.reason ?? reason,
    catalogVersion: currentMekaBaselineVersion(),
    settledOnly: true,
    anchor,
    series,
  };
}

export function calibratedSnapshot(result: Record<string, unknown>, input: Record<string, unknown>, settings: VolumeSettings) {
  if (!result.ok) return result;
  const filter = volumeFilter(String(input.geo ?? settings.geo), String(input.time ?? 'now 1-d'));
  const series = row(result.series), anchorName = row(result.anchor).term;
  const pin = typeof input.anchor === 'string' ? { ...settings, anchor: input.anchor } : settings;
  const anchor = typeof anchorName === 'string' ? volumeReferences(filter, pin).lookup(anchorName) : undefined;
  const estimate = estimateVolume(String(input.term), pointsOf(series.points, 'score'),
    anchor ? [{ anchor, points: pointsOf(series.anchorPoints, 'score') }] : [], filter, 'baseline');
  return { ...result, calibration: volumeCalibration([estimate]) };
}

/** Keep relative results from either runtime when dsh has no eligible reference. */
export function relativeDshResult(result: Record<string, unknown>, snapshot: boolean, geo: string) {
  const note = `Search-volume baseline unavailable for ${geo || 'Worldwide'}.`;
  const anchor = { term: 'none', dailySearches: null, ratio: null, note };
  const verdict = row(result.verdict);
  if (!snapshot) {
    return result.verdict ? { ...result, verdict: {
      ...verdict, traffic: nullTraffic(), anchor: { ...anchor, band: null },
      warnings: [...(Array.isArray(verdict.warnings) ? verdict.warnings : []), note],
    } } : result;
  }
  if (!result.traffic) return result;
  const reference = { ...anchor, tolerance: null, level: null, source: 'baseline' };
  const chart = { path: null, svg: '' };
  const series = row(result.series), meta = row(result.meta);
  const points = rows(series.points).map(point => ({ ...point, traffic: null }));
  return {
    ...result,
    ...(result.ok ? { summary: `${String(result.term)} (${geo || 'Worldwide'}) · ${note}` } : {}),
    anchor: reference, anchor7d: reference, traffic: nullTraffic(), traffic7d: nullTraffic(),
    chart, chart7d: chart, series: { ...series, points, anchorPoints: [] },
    verdict: { ...verdict, prioritize: false },
    meta: { ...meta, warnings: [...(Array.isArray(meta.warnings) ? meta.warnings : []), note] },
  };
}
