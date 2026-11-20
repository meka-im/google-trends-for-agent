import type { VolumeSeries } from './volume-types.js';
import type { QueryRecord } from './query-history-types.js';

export interface BatchRound {
  round: number; targets: string[]; anchor: string; daily: number; completed: number;
}
export interface BatchReading extends VolumeSeries { via?: string; below?: number; reused?: boolean }
export interface BatchResult {
  requestId: string; rounds: BatchRound[]; series: BatchReading[]; complete: boolean; error?: string;
  runs: NonNullable<QueryRecord['volumeRuns']>;
}

