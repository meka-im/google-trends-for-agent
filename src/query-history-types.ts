import type { VolumeSeries } from './volume-types.js';
import type { EgressMode } from './options.js';

/** Browser-safe journal contract; results remain native tool envelopes. */
export type QueryToolName = 'trends_ask' | 'trends_compare' | 'trends_now' | 'trends_snapshot';
export type ActorRunPurpose = 'query' | 'batch-round' | 'single-retry' | 'estimate' | 'connection-test';
export type ActorRunSource = 'manual' | 'agent' | 'settings';
export type ActorRunStatus = 'SUCCEEDED' | 'FAILED' | 'TIMED-OUT' | 'ABORTED' | 'ERROR';
export interface ActorRunRecord {
  runId: string;
  actorId: string | null;
  egress: 'actor-public' | 'actor-own';
  purpose: ActorRunPurpose;
  round?: number;
  anchor?: string;
  source: ActorRunSource;
  tool: QueryToolName;
  terms: string[];
  geo: string;
  time: string;
  status: ActorRunStatus;
  toolStatus?: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number | null;
  costUsd: number | null;
  queryRecordId: string | null;
  legacy?: boolean;
}
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
export interface SavedQuery { record: QueryRecord; result: Record<string, unknown>; volumeChecks?: VolumeCheck[]; actorRuns?: ActorRunRecord[] }
