import { settledPoints, type TrendsFilter } from './filter.js';
import { markGaps, type GapPoint } from './gaps.js';

/** A shared-scale (0–100) point from a Trends comparison. */
export interface CalibrationPoint { time: string; value: number }

/** Daily traffic block shared by trends_ask (validate) and trends_snapshot. */
export interface TrafficEstimate {
  unit: 'searches/day';
  average: number | null;
  latest: number | null;
  settledLatest: number | null;
  peak: number | null;
  low: number | null;
  high: number | null;
  gapCount: number;
}

export interface CalibrationOptions {
  filter: TrendsFilter;
  /** Anchor daily searches from the matching baseline, or null when there is no calibration. */
  dailySearches: number | null;
  /** Fractional tolerance used for the low/high band. */
  tolerance: number | null;
}

export interface CalibrationResult {
  /** Term points with `gap: true` markers. */
  termMarked: (CalibrationPoint & GapPoint)[];
  /** Anchor points with `gap: true` markers. */
  anchorMarked: (CalibrationPoint & GapPoint)[];
  /** Non-gap anchor points (the calibration denominator). */
  anchorKept: (CalibrationPoint & GapPoint)[];
  /** Non-gap term points. */
  kept: (CalibrationPoint & GapPoint)[];
  /** Gap-aware anchor mean (unrounded). */
  anchorLevel: number;
  anchorSampleCount: number;
  anchorNonzeroCount: number;
  /** True when the anchor is strong enough to calibrate traffic. */
  anchorUsable: boolean;
  /** True when the anchor exists but fails the reliability gate. */
  weakAnchor: boolean;
  /** `round2(term mean / anchor mean)`; null when the anchor is unusable. */
  ratio: number | null;
  /** `anchorDailySearches / anchorLevel`; null without calibration or a weak anchor. */
  factor: number | null;
  traffic: TrafficEstimate;
  /** Per-point term traffic aligned with `termMarked`. */
  seriesTraffic: (number | null)[];
  /** Per-point anchor traffic aligned with `anchorMarked` (gap points still use their raw value). */
  anchorTraffic: (number | null)[];
  /** Warning for a sparse/weak anchor, when calibration exists but traffic was omitted. */
  warning?: string;
  /** Human-readable explanation for the anchor block. */
  note: string;
  trafficFor: (score: number) => number | null;
}

/** Minimum share of non-gap anchor points that must be nonzero. */
export const MIN_ANCHOR_NONZERO_FRACTION = 0.25;
/** Trends is an integer 0–100 scale: an anchor mean below 1 cannot calibrate. */
export const MIN_ANCHOR_LEVEL = 1;
export const ANCHOR_WEAK_WARNING = 'anchor too sparse/weak for calibration; traffic omitted';

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const round = (n: number) => Math.round(n);
export const round2 = (n: number) => Math.round(n * 100) / 100;

export function nullTraffic(gapCount = 0): TrafficEstimate {
  return { unit: 'searches/day', average: null, latest: null, settledLatest: null, peak: null, low: null, high: null, gapCount };
}

/**
 * Shared calibration math for `trends_ask --validate` and `trends_snapshot`.
 *
 * `traffic = score / anchorLevel × dailySearches`, where both means are gap-aware
 * (Google's isolated low-sample zeros are excluded).
 *
 * Reliability gate: the anchor must have at least one non-gap point, a gap-aware
 * mean ≥ 1 (Trends' integer scale), and at least 25% of its non-gap points must be
 * nonzero. Sparse/near-zero anchors produce null ratio/traffic plus a warning.
 */
export function calibrateTraffic(termPoints: readonly CalibrationPoint[], anchorPoints: readonly CalibrationPoint[], opts: CalibrationOptions): CalibrationResult {
  const termMarked = markGaps(termPoints);
  const anchorMarked = markGaps(anchorPoints);
  const anchorKept = anchorMarked.filter(p => !p.gap);
  const kept = termMarked.filter(p => !p.gap);
  const anchorLevel = anchorKept.length ? mean(anchorKept.map(p => p.value)) : 0;
  const anchorSampleCount = anchorKept.length;
  const anchorNonzeroCount = anchorKept.filter(p => p.value > 0).length;
  const nonzeroFraction = anchorSampleCount ? anchorNonzeroCount / anchorSampleCount : 0;
  const daily = opts.dailySearches !== null && Number.isFinite(opts.dailySearches) && opts.dailySearches > 0 ? opts.dailySearches : null;
  const tolerance = daily === null ? null : opts.tolerance;
  const hasCalibration = daily !== null;
  const weakAnchor = hasCalibration && (anchorSampleCount === 0 || anchorLevel < MIN_ANCHOR_LEVEL || nonzeroFraction < MIN_ANCHOR_NONZERO_FRACTION);
  const anchorUsable = anchorSampleCount > 0 && anchorLevel >= MIN_ANCHOR_LEVEL && nonzeroFraction >= MIN_ANCHOR_NONZERO_FRACTION && kept.length > 0;
  const factor = anchorUsable && daily !== null ? daily / anchorLevel : null;
  const trafficFor = (score: number) => factor === null ? null : round(score * factor);
  const trafficValues = factor === null ? [] : kept.map(p => trafficFor(p.value) as number);
  const trafficAverage = factor === null ? null : round(mean(trafficValues));
  const trafficLatest = factor === null ? null : trafficFor(kept.at(-1)?.value ?? 0);
  const settled = settledPoints(termMarked, opts.filter).filter(p => !p.gap);
  const trafficSettledLatest = factor === null ? null : trafficFor(settled.at(-1)?.value ?? 0);
  const trafficPeak = factor === null ? null : Math.max(0, ...trafficValues);
  const gapCount = termMarked.length - kept.length;
  const termAverageScore = mean(kept.map(p => p.value));
  const ratio = anchorUsable ? round2(termAverageScore / anchorLevel) : null;
  const traffic: TrafficEstimate = {
    unit: 'searches/day',
    average: trafficAverage,
    latest: trafficLatest,
    settledLatest: trafficSettledLatest,
    peak: trafficPeak,
    low: trafficAverage === null || tolerance === null ? null : round(trafficAverage * (1 - tolerance)),
    high: trafficAverage === null || tolerance === null ? null : round(trafficAverage * (1 + tolerance)),
    gapCount,
  };
  const warning = weakAnchor ? ANCHOR_WEAK_WARNING : undefined;
  const geoLabel = opts.filter.geo || 'Worldwide';
  const note = daily === null
    ? `No calibration for geo ${geoLabel}; traffic fields are null`
    : weakAnchor
      ? `${ANCHOR_WEAK_WARNING} (${anchorNonzeroCount}/${anchorSampleCount} non-gap anchor points nonzero, level ${round2(anchorLevel)})`
      : anchorUsable
        ? 'Anchor calibration estimate; not measured volume'
        : 'No non-gap term points; traffic fields are null';
  const seriesTraffic = termMarked.map(p => trafficFor(p.value));
  const anchorTraffic = anchorMarked.map(p => factor === null ? null : round(p.value * factor));
  return {
    termMarked, anchorMarked, anchorKept, kept, anchorLevel, anchorSampleCount, anchorNonzeroCount,
    anchorUsable, weakAnchor, ratio, factor, traffic, seriesTraffic, anchorTraffic,
    ...(warning ? { warning } : {}), note, trafficFor,
  };
}
