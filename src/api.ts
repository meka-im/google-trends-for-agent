import { TrendsClient, type ClientOptions } from './client.js';
import { GTrendsError, type GTrendsInput } from './core.js';
import { abortError, isAbortError, throwIfAborted } from './transport.js';

export type TrendsErrorCode = 'INVALID_INPUT' | 'INVALID_COMBINATION' | 'REQUEST_TOO_LARGE' | 'BLOCKED' | 'RATE_LIMITED' | 'TRENDS_TIMEOUT' | 'TRENDS_PROTOCOL_CHANGED' | 'TRENDS_TEMPORARILY_UNAVAILABLE' | 'NETWORK_ERROR';
export interface TrendsResponse {
  status: 'ok' | 'partial' | 'error';
  input: unknown;
  data?: Record<string, unknown>;
  error?: { code: TrendsErrorCode; message: string; retryAfterSec?: number };
  meta: { upstreamRequests: number; durationMs: number; warnings: string[]; fetchedAt: string };
}
export interface QueryOptions extends ClientOptions { client?: TrendsClient }
export type TrendsInput = Partial<GTrendsInput> & { queries: string[] };
export function errorResponse(input: unknown, code: TrendsErrorCode, message: string): TrendsResponse {
  return { status: 'error', input, error: { code, message }, meta: { upstreamRequests: 0, durationMs: 0, warnings: [], fetchedAt: new Date().toISOString() } };
}
/** One logical comparison of one to five keywords. Input and upstream failures are returned. */
export async function queryTrends(input: unknown, options: QueryOptions = {}): Promise<TrendsResponse> {
  try {
    const result = await (options.client ?? new TrendsClient(options)).query(input);
    return { ...result, input: result.input ?? input, error: result.error as TrendsResponse['error'], meta: { ...result.meta, fetchedAt: new Date().toISOString() } };
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    if (isAbortError(error)) throw error;
    return errorResponse(input, error instanceof GTrendsError ? error.code : error instanceof RangeError ? 'INVALID_INPUT' : 'NETWORK_ERROR', error instanceof Error ? error.message : 'query failed');
  }
}
export function compareTrends(keywords: string[], opts: Omit<TrendsInput, 'queries'> & QueryOptions = {}): Promise<TrendsResponse> {
  const { transport, minIntervalMs, now, sleep, client, limiter, signal, timeoutSurface, ...input } = opts;
  return queryTrends({ ...input, queries: keywords }, { transport, minIntervalMs, now, sleep, client, limiter, signal, timeoutSurface });
}
export interface BatchOptions extends QueryOptions { stopOnBlocked?: boolean }
export async function batchTrends(items: readonly unknown[], opts: BatchOptions = {}): Promise<{ status: TrendsResponse['status']; results: (TrendsResponse & { index: number })[] }> {
  const results: (TrendsResponse & { index: number })[] = [];
  let stopError: NonNullable<TrendsResponse['error']> | undefined;
  let client: TrendsClient;
  try { client = opts.client ?? new TrendsClient(opts); }
  catch (e) { return { status: 'error', results: items.map((input, index) => ({ ...errorResponse(input, 'INVALID_INPUT', e instanceof Error ? e.message : 'invalid options'), index })) }; }
  for (const [index, input] of items.entries()) {
    throwIfAborted(opts.signal);
    let result: TrendsResponse;
    if (stopError) {
      result = errorResponse(input, stopError.code, stopError.code === 'BLOCKED' ? 'skipped after upstream block' : 'skipped after upstream rate limit');
      if (stopError.retryAfterSec !== undefined) result.error!.retryAfterSec = stopError.retryAfterSec;
    } else {
      result = await queryTrends(input, { client, signal: opts.signal });
    }
    results.push({ ...result, index });
    if (opts.stopOnBlocked !== false && ['BLOCKED', 'RATE_LIMITED'].includes(result.error?.code ?? '')) stopError = result.error;
  }
  return { status: results.length && results.every(r => r.status === 'ok') ? 'ok' : results.every(r => r.status === 'error') ? 'error' : 'partial', results };
}
