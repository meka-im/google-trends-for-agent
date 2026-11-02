import { settledPoints, type TrendsFilter } from './filter.js';

/** A point whose value is missing/too low to be trusted as real search interest. */
export interface GapPoint { gap?: true }
export interface GapSummary<T extends { time: string; value: number }> {
  points: (T & GapPoint)[];
  gapCount: number;
  average: number | null;
  latest: number;
  settledLatest: number;
  peak: number;
}

/** Google sometimes emits isolated zero points between healthy values on low-sample
 * curves. Treat a zero as a gap only when the series is mostly nonzero (>50% of all
 * points) and the zero lies between the first and last nonzero point. Leading and
 * trailing zero runs are therefore treated as real zeros, never as gaps. */
export function detectGaps(points: readonly { value: number }[]): boolean[] {
  const flags = points.map(() => false);
  if (!points.length || points.filter(p => p.value !== 0).length * 2 <= points.length) return flags;
  const first = points.findIndex(p => p.value !== 0);
  const last = points.length - 1 - [...points].reverse().findIndex(p => p.value !== 0);
  for (let i = first + 1; i < last; i++) flags[i] = points[i].value === 0;
  return flags;
}

/** Copy points and add `gap: true` to detected gaps; raw values are left untouched. */
export function markGaps<T extends { time: string; value: number }>(points: readonly T[]): (T & GapPoint)[] {
  const flags = detectGaps(points);
  return points.map((point, i) => flags[i] ? { ...point, gap: true } : { ...point });
}

/** Settled points with gap points removed (used by verdict calculations). */
export function settledNonGapPoints<T extends { time: string; value: number }>(points: readonly T[], filter: TrendsFilter): (T & GapPoint)[] {
  return settledPoints(markGaps(points), filter).filter(point => !point.gap);
}

const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null;

/** Envelope-facing interest statistics. Gap points are excluded from every aggregate. */
export function summarizeInterest<T extends { time: string; value: number }>(points: readonly T[], filter: TrendsFilter): GapSummary<T> {
  const marked = markGaps(points);
  const kept = marked.filter(point => !point.gap);
  const settled = settledPoints(marked, filter).filter(point => !point.gap);
  return {
    points: marked,
    gapCount: marked.length - kept.length,
    average: avg(kept.map(point => point.value)),
    latest: kept.at(-1)?.value ?? 0,
    settledLatest: settled.at(-1)?.value ?? 0,
    peak: Math.max(0, ...kept.map(point => point.value)),
  };
}
