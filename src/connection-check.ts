import type { EgressMode } from './options.js';
import type { ActorRuntime } from './actor-runtime.js';

export const CONNECTION_KEYWORDS = ['ChatGPT', 'Gemini', 'weather'] as const;
export const CONNECTION_FILTER = { geo: 'US', time: 'now 1-d' } as const;
/** A separate request protocol prevents older Actors from silently retrying a probe. */
export const CONNECTION_PROBE_PROTOCOL = 2;

export type ConnectionCode = 'no-token' | 'no-actor' | 'invalid-token' | 'version-mismatch' | 'network' | 'http' | 'busy'
  | 'blocked' | 'rate-limited' | 'timeout' | 'no-data' | 'protocol' | 'cancelled' | 'host-restart-required';
export interface ConnectionResult {
  ok: boolean;
  egress: EgressMode;
  status: number | null;
  latencyMs: number;
  code?: ConnectionCode;
  message?: string;
  actorId?: string;
  actorRunId?: string;
  costUsd?: number | null;
  /** From the actual tool run, never inferred from an Apify build number. */
  actorRuntime?: ActorRuntime | null;
  pluginVersion?: string;
}
export interface KeywordCheck {
  keyword: string;
  status: 'ok' | 'no_data' | 'error' | 'skipped';
  points: number;
  nonzeroPoints: number;
}
export interface DataCheck {
  ok: boolean;
  code?: ConnectionCode;
  latencyMs: number;
  geo: 'US';
  time: 'now 1-d';
  keywords: KeywordCheck[];
  fetchedAt?: string;
}
export interface ConnectionDiagnostics extends ConnectionResult {
  network: ConnectionResult;
  data: DataCheck;
  checkedAt: string;
}
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function emptyDataCheck(code: ConnectionCode, latencyMs = 0, skipped = false): DataCheck {
  return { ok: false, code, latencyMs, ...CONNECTION_FILTER,
    keywords: CONNECTION_KEYWORDS.map(keyword => ({ keyword, status: skipped ? 'skipped' : 'error', points: 0, nonzeroPoints: 0 })) };
}
export function connectionErrorCode(value: unknown): ConnectionCode {
  switch (value) {
    case 'BLOCKED': return 'blocked';
    case 'RATE_LIMITED': return 'rate-limited';
    case 'TRENDS_TIMEOUT': return 'timeout';
    case 'INVALID_INPUT': return 'version-mismatch';
    case 'TRENDS_PROTOCOL_CHANGED': return 'protocol';
    default: return 'network';
  }
}

/** Only validated counts and fixed keywords cross into the settings page. */
export function summarizeConnectionProbe(value: unknown, latencyMs: number): DataCheck {
  const result = row(value), filter = row(result.filter), meta = row(result.meta);
  if (result.ok === false || result.error) return emptyDataCheck(connectionErrorCode(row(result.error).code), latencyMs);
  if (result.ok !== true || result.schemaVersion !== 1 || result.status !== 'ok'
    || filter.geo !== CONNECTION_FILTER.geo || filter.time !== CONNECTION_FILTER.time
    || typeof meta.fetchedAt !== 'string' || !Number.isFinite(Date.parse(meta.fetchedAt))
    || !Array.isArray(result.series) || result.series.length !== CONNECTION_KEYWORDS.length) return emptyDataCheck('protocol', latencyMs);
  const keywords: KeywordCheck[] = [];
  for (const keyword of CONNECTION_KEYWORDS) {
    const matches = result.series.filter(item => row(item).keyword === keyword);
    const points = row(matches[0]).points;
    if (matches.length !== 1 || !Array.isArray(points) || points.length > 10000
      || points.some(item => {
        const point = row(item);
        return typeof point.t !== 'string' || !Number.isFinite(Date.parse(point.t))
          || typeof point.value !== 'number' || !Number.isFinite(point.value) || point.value < 0 || point.value > 100;
      })) return emptyDataCheck('protocol', latencyMs);
    const nonzeroPoints = points.filter(point => row(point).value as number > 0).length;
    keywords.push({ keyword, status: nonzeroPoints ? 'ok' : 'no_data', points: points.length, nonzeroPoints });
  }
  const ok = keywords.every(keyword => keyword.status === 'ok');
  return { ok, ...(!ok ? { code: 'no-data' as const } : {}), latencyMs, ...CONNECTION_FILTER, keywords, fetchedAt: meta.fetchedAt };
}
