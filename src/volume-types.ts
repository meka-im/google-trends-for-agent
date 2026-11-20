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

export type VolumeReason = 'samples' | 'anchor' | 'disagreement' | 'capacity' | 'baseline' | 'window';
export interface VolumeBandPoint { t: string; low: number | null; high: number | null }
export interface VolumeSeries {
  keyword: string;
  traffic: TrafficEstimate;
  points: { t: string; value: number | null }[];
  reason?: VolumeReason;
  anchor?: { term: string; dailySearches: number | null; tolerance: number };
  /** Approximate tier for a follow-up when the first batch's anchors were too weak. */
  anchorTargetDaily?: number;
  range?: { low: number; high: number; anchors: string[]; points?: VolumeBandPoint[] };
  period?: { from: string; to: string };
}
export const supportsVolumeWindow = (time: string) => time !== 'today 5-y' && time !== 'all';
