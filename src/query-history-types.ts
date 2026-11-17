import type { EgressMode } from './options.js';

/** Browser-safe journal contract; results remain native tool envelopes. */
export type QueryToolName = 'trends_ask' | 'trends_compare' | 'trends_now' | 'trends_snapshot';
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
}
export interface SavedQuery { record: QueryRecord; result: Record<string, unknown> }
