import { createHash } from 'node:crypto';
import { abortError, raceAbort } from './transport.js';

const LIMITS_URL = 'https://api.apify.com/v2/users/me/limits';
const ME_URL = 'https://api.apify.com/v2/users/me';

export type ApifyUsageSource = 'config' | 'env';
export type ApifyUsageErrorCode = 'no-token' | 'invalid-token' | 'network' | 'http';

export interface ApifyPlan {
  tier: string | null;
  monthlyBasePriceUsd: number | null;
  monthlyUsageCreditsUsd: number | null;
}

export interface ApifyUsage {
  ok: true;
  source: ApifyUsageSource;
  plan: ApifyPlan;
  usageUsd: number | null;
  limitUsd: number | null;
  cycle: { startAt: string | null; endAt: string | null };
  residentialGb: number | null;
  residentialGbLimit: number | null;
  fetchedAt: string;
}

export interface ApifyUsageError {
  ok: false;
  code: ApifyUsageErrorCode;
  status?: number;
  message: string;
}

export type ApifyUsageResult = ApifyUsage | ApifyUsageError;

export interface ApifyAccountClientOptions {
  /** Fetch implementation for tests; production uses global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Clock override for cache tests. */
  now?: () => number;
  /** Successful-result cache lifetime. Default 60 s. */
  cacheTtlMs?: number;
  /** Per-request timeout. Default 10 s. */
  timeoutMs?: number;
}

export interface ApifyUsageOptions {
  token: string;
  source: ApifyUsageSource;
  refresh?: boolean;
  signal?: AbortSignal;
}

interface CachedUsage {
  tokenHash: string;
  at: number;
  result: ApifyUsage;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Hash a token for cache keys; the token itself is never retained. */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function noToken(): ApifyUsageError {
  return { ok: false, code: 'no-token', message: 'Add an Apify token (or set APIFY_TOKEN) to see usage.' };
}

function httpError(status: number, message?: string): ApifyUsageError {
  return { ok: false, code: 'http', status, message: message ?? `Apify API returned HTTP ${status}.` };
}

/**
 * Read-only Apify account usage client. Only the two documented account
 * endpoints are called, and only plan/usage fields leave this module: the
 * /users/me response also contains the proxy password, email, and username,
 * which are dropped here.
 */
export class ApifyAccountClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly clock: () => number;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private cached: CachedUsage | undefined;

  constructor(options: ApifyAccountClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.clock = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Successful results are cached for 60 s per token hash; failures are not cached. */
  async usage(options: ApifyUsageOptions): Promise<ApifyUsageResult> {
    const token = options.token.trim();
    if (!token) return noToken();
    const hash = tokenHash(token);
    const now = this.clock();
    if (!options.refresh && this.cached?.tokenHash === hash && now - this.cached.at < this.cacheTtlMs) {
      return { ...this.cached.result, source: options.source };
    }
    // A different token invalidates the previous account's cached cycle.
    if (this.cached && this.cached.tokenHash !== hash) this.cached = undefined;
    const result = await this.requestUsage(token, options.source, options.signal);
    if (result.ok) this.cached = { tokenHash: hash, at: this.clock(), result };
    else if (result.code === 'invalid-token') this.cached = undefined;
    return result;
  }

  private async requestUsage(token: string, source: ApifyUsageSource, signal?: AbortSignal): Promise<ApifyUsageResult> {
    const limits = await this.getJson(LIMITS_URL, token, signal);
    if (!limits.ok) return limits.error;
    const me = await this.getJson(ME_URL, token, signal);
    if (!me.ok) return me.error;

    const usageData = record(record(limits.body).data);
    const current = record(usageData.current);
    const limitsData = record(usageData.limits);
    const cycle = record(usageData.monthlyUsageCycle);
    const plan = record(record(record(me.body).data).plan);

    return {
      ok: true,
      source,
      plan: {
        tier: stringOrNull(plan.tier),
        monthlyBasePriceUsd: numberOrNull(plan.monthlyBasePriceUsd),
        monthlyUsageCreditsUsd: numberOrNull(plan.monthlyUsageCreditsUsd),
      },
      usageUsd: numberOrNull(current.monthlyUsageUsd),
      limitUsd: numberOrNull(limitsData.maxMonthlyUsageUsd),
      cycle: {
        startAt: stringOrNull(cycle.startAt),
        endAt: stringOrNull(cycle.endAt),
      },
      residentialGb: numberOrNull(current.monthlyResidentialProxyGbytes),
      residentialGbLimit: numberOrNull(limitsData.maxMonthlyResidentialProxyGbytes),
      fetchedAt: new Date(this.clock()).toISOString(),
    };
  }

  private async getJson(url: string, token: string, signal?: AbortSignal): Promise<{ ok: true; body: unknown } | { ok: false; error: ApifyUsageError }> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    let response: Response;
    try {
      response = await raceAbort(this.fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: combined,
      }), combined);
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return {
        ok: false,
        error: {
          ok: false,
          code: 'network',
          message: timedOut
            ? `Apify API request timed out after ${Math.round(this.timeoutMs / 1000)} seconds.`
            : 'Could not reach the Apify API. Check connectivity and try again.',
        },
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: {
          ok: false,
          code: 'invalid-token',
          status: response.status,
          message: `Apify rejected the token (HTTP ${response.status}). Check it in Apify Console → Settings → API & Integrations.`,
        },
      };
    }
    if (!response.ok) return { ok: false, error: httpError(response.status) };
    try {
      return { ok: true, body: await response.json() };
    } catch {
      return { ok: false, error: httpError(response.status, `Apify API returned a non-JSON response (HTTP ${response.status}).`) };
    }
  }
}

export function createApifyAccountClient(options: ApifyAccountClientOptions = {}): ApifyAccountClient {
  return new ApifyAccountClient(options);
}
