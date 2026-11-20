import type { VolumeSeries } from './volume-types.js';
import type { EgressMode } from './options.js';

/** Browser-safe journal contract; results remain native tool envelopes. */
export type QueryToolName = 'trends_ask' | 'trends_compare' | 'trends_now' | 'trends_snapshot';
export interface VolumeRun { actorRunId: string | null; costUsd: number | null; createdAt: string }
export interface VolumeCheck extends VolumeRun {
  keyword: string;
  requestId: string;
  sameWindow: boolean;
  egress: EgressMode;
  fetchedAt: string | null;
  estimate?: VolumeSeries;
  errorCode?: string;
}
export interface QueryRecord {
  id: string;
  tool: QueryToolName;
  terms: string[];
  geo: string;
  time: string;
  source: 'manual' | 'agent';
  egress: EgressMode;
  status: string;
  cached: boolean;
  createdAt: string;
  fetchedAt: string | null;
  durationMs: number;
  actorRunId: string | null;
  costUsd: number | null;
  errorCode: string | null;
  dailyVolume?: number | null;
  singleVolume?: { calls: number; hit: 'first' | 'second' | 'none' };
  volumeRuns?: VolumeRun[];
}
export interface SavedQuery { record: QueryRecord; result: Record<string, unknown>; volumeChecks?: VolumeCheck[] }
