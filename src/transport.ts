import { ProxyAgent, fetch as proxyFetch } from 'undici';
import { CookieJar } from 'tough-cookie';
import { GTrendsError } from './core.js';

export interface TransportRequest { url: string; method?: string; body?: string; headers: Record<string, string>; timeoutMs: number; signal?: AbortSignal }
export interface TransportResponse { status: number; headers: Record<string, string>; body: string }
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** Safe error label for logs: a stable code or class name, never the raw message. */
export function errorLabel(error: unknown): string {
  if (error instanceof GTrendsError) return error.code;
  if (error instanceof Error) return error.name || 'Error';
  return 'Error';
}

/** Normalize any caller abort reason to an `AbortError` while preserving its message. */
export function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  const error = new Error(reason instanceof Error && reason.message ? reason.message : 'The operation was aborted');
  error.name = 'AbortError';
  if (reason !== undefined) (error as Error & { cause?: unknown }).cause = reason;
  return error;
}

/** Throw the caller's abort reason instead of retrying an upstream error. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Race a promise against a caller abort signal so waits and sleeps stop promptly. */
export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(abortError(signal)); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;
export type ProxySource = (typeof PROXY_ENV)[number] | 'none';
export interface ProxyConfig { source: ProxySource; url: string | null }

/** HTTPS_PROXY wins over HTTP_PROXY; an empty variable is treated as unset. */
export function getProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  for (const source of PROXY_ENV) {
    const url = env[source]?.trim();
    if (url) return { source, url };
  }
  return { source: 'none', url: null };
}

/** Never print proxy credentials in diagnostics. */
export function redactProxyUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    return url.toString().replace(/\/$/, '');
  } catch { return '<invalid URL>'; }
}

export function describeProxy(env: NodeJS.ProcessEnv = process.env): string {
  const proxy = getProxyConfig(env);
  return proxy.url ? `${proxy.source}=${redactProxyUrl(proxy.url)}` : 'direct (no HTTPS_PROXY/HTTP_PROXY)';
}

/** True when Google Trends returned its CAPTCHA / unusual-traffic challenge. */
export function isChallengeResponse(res: Pick<TransportResponse, 'status' | 'headers' | 'body'>): boolean {
  const headers = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const looksJson = /^\s*(?:\)\]\}'[,]?\s*)?[{[]/.test(res.body);
  return /\/sorry(?:\/|\b)/i.test(headers.location ?? '') ||
    // `\bcaptcha` skips asset names such as the trending page's `.grecaptcha-badge` CSS.
    !looksJson && /\bcaptcha\b|unusual traffic|\/sorry(?:\/|\b)/i.test(res.body);
}

/** HTTP 429 from Google Trends. */
export function isRateLimitResponse(res: Pick<TransportResponse, 'status'>): boolean {
  return res.status === 429;
}

/** Uses global fetch directly, or HTTPS_PROXY/HTTP_PROXY when configured. Redirects are never followed. */
export function createDefaultTransport(env: NodeJS.ProcessEnv = process.env): Transport {
  const proxy = getProxyConfig(env);
  let dispatcher: ProxyAgent | undefined;
  if (proxy.url) {
    try {
      const parsed = new URL(proxy.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('proxy URL must start with http:// or https://');
      dispatcher = new ProxyAgent(proxy.url);
    } catch (error) {
      throw new GTrendsError('NETWORK_ERROR', `Invalid ${proxy.source} "${redactProxyUrl(proxy.url)}": ${error instanceof Error ? error.message : 'invalid URL'}. Set it to http://host:port, or unset it for a direct connection.`);
    }
  }
  return async req => {
    const timeout = AbortSignal.timeout(req.timeoutMs);
    const signal = req.signal ? AbortSignal.any([timeout, req.signal]) : timeout;
    const init = { method: req.method ?? 'GET', body: req.body, headers: req.headers, redirect: 'manual' as const, signal };
    const res = dispatcher ? await proxyFetch(req.url, { ...init, dispatcher }) : await globalThis.fetch(req.url, init);
    const headers = Object.fromEntries(res.headers.entries());
    const cookies = res.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies.join('\n');
    return { status: res.status, headers, body: await res.text() };
  };
}

export const RETRYABLE_ERROR_CODES = ['RATE_LIMITED', 'TRENDS_TIMEOUT', 'TRENDS_TEMPORARILY_UNAVAILABLE', 'NETWORK_ERROR'] as const;
export interface RetryOptions { maxRetries: number; sleep: (ms: number) => Promise<void>; maxRateLimitWaitMs?: number; signal?: AbortSignal }
const DEFAULT_MAX_RATE_LIMIT_WAIT_MS = 10_000;

/** RATE_LIMITED honors Retry-After when it fits the bounded wait; other transient failures retry immediately. */
export function retryDelayMs(error: GTrendsError, attempt: number, maxWaitMs = DEFAULT_MAX_RATE_LIMIT_WAIT_MS): number | null {
  if (!(RETRYABLE_ERROR_CODES as readonly string[]).includes(error.code)) return null;
  if (error.code !== 'RATE_LIMITED') return 0;
  const retryAfterMs = error.retryAfterSec !== undefined ? error.retryAfterSec * 1000 : 0;
  if (retryAfterMs > maxWaitMs) return null;
  return Math.min(maxWaitMs, Math.max(1000, retryAfterMs, 1000 * 2 ** attempt));
}

/** Bounded retry wrapper shared by Explore and Trending Now requests. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(options.signal);
    try {
      const value = await fn();
      throwIfAborted(options.signal);
      return value;
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal);
      if (!(error instanceof GTrendsError) || attempt >= options.maxRetries) throw error;
      const delay = retryDelayMs(error, attempt, options.maxRateLimitWaitMs);
      if (delay === null) throw error;
      if (delay > 0) await raceAbort(options.sleep(delay), options.signal);
      throwIfAborted(options.signal);
    }
  }
}

export interface RateLimitOptions {
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
/** Share one limiter across sessions to apply spacing to all requests from a client. */
export class RateLimiter {
  private tail: Promise<void> = Promise.resolve();
  private nextAt = 0;
  private backoffMs = 0;
  readonly interval: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  constructor(options: RateLimitOptions = {}) {
    this.interval = options.minIntervalMs ?? 1000;
    if (!Number.isFinite(this.interval) || this.interval < 0) throw new RangeError('minIntervalMs must be non-negative');
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise(resolve => { release = resolve; });
    try {
      await raceAbort(previous, signal);
      throwIfAborted(signal);
      const wait = this.nextAt - this.now();
      if (wait > 0) await raceAbort(this.sleep(wait), signal);
      throwIfAborted(signal);
      this.nextAt = this.now() + this.interval;
      return await fn();
    } finally { release(); }
  }
  penalize(retryAfterMs = 0): void {
    this.backoffMs = Math.min(60_000, Math.max(1000, this.interval * 2, this.backoffMs * 2, retryAfterMs));
    this.nextAt = Math.max(this.nextAt, this.now() + this.backoffMs);
  }
  recover(): void { this.backoffMs = Math.floor(this.backoffMs / 2); }
}

export class Session {
  private readonly jar = new CookieJar();
  upstreamRequests = 0;
  constructor(private transport: Transport, private limiter: RateLimiter) {}
  async request(req: TransportRequest): Promise<string> {
    throwIfAborted(req.signal);
    return this.limiter.run(async () => {
      throwIfAborted(req.signal);
      const cookie = await this.jar.getCookieString(req.url);
      throwIfAborted(req.signal);
      let res: TransportResponse;
      this.upstreamRequests++;
      try { res = await raceAbort(this.transport({ ...req, headers: { ...req.headers, ...(cookie ? { cookie } : {}) } }), req.signal); }
      catch (error) {
        if (req.signal?.aborted) throw abortError(req.signal);
        if (error instanceof GTrendsError) throw error;
        const timeout = error instanceof Error && /timeout|abort/i.test(error.name);
        const message = timeout
          ? `Google Trends request timed out after ${req.timeoutMs} ms. Retry, raise --timeout (max 60000), or set HTTPS_PROXY/HTTP_PROXY if this network blocks Google.`
          : 'Could not reach Google Trends (network, DNS, TLS, or proxy failure). Check connectivity/firewall; if a proxy is required, set HTTPS_PROXY or HTTP_PROXY.';
        throw new GTrendsError(timeout ? 'TRENDS_TIMEOUT' : 'NETWORK_ERROR', message);
      }
      throwIfAborted(req.signal);
      const headers = Object.fromEntries(Object.entries(res.headers).map(([k,v]) => [k.toLowerCase(),v]));
      // Split combined headers without splitting an Expires date's comma.
      for (const cookie of (headers['set-cookie'] ?? '').split(/\n|,(?=\s*[^;,=\s]+\s*=)/)) {
        if (cookie.trim()) await this.jar.setCookie(cookie.trim(), req.url, { ignoreError: true });
      }
      const blocked = isChallengeResponse(res);
      if (blocked || isRateLimitResponse(res)) {
        const retry = headers['retry-after'];
        const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.limiter.now()) : 0;
        this.limiter.penalize(Number.isFinite(delay) ? delay : 0);
        const retryAfterSec = delay > 0 && Number.isFinite(delay) ? Math.ceil(delay / 1000) : undefined;
        const message = blocked
          ? 'Google Trends returned a challenge (CAPTCHA/unusual traffic) for this IP. Stop and report; retry later, reduce request rate, or set HTTPS_PROXY/HTTP_PROXY to use a different egress.'
          : `Google Trends rate limit (HTTP 429). ${retryAfterSec !== undefined ? `Wait ${retryAfterSec}s` : 'Wait a few seconds'} before retrying; lower request rate or set HTTPS_PROXY/HTTP_PROXY.`;
        throw new GTrendsError(blocked ? 'BLOCKED' : 'RATE_LIMITED', message, retryAfterSec);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new GTrendsError(res.status >= 500 ? 'TRENDS_TEMPORARILY_UNAVAILABLE' : 'TRENDS_PROTOCOL_CHANGED',
          res.status >= 500
            ? `Google Trends is temporarily unavailable (HTTP ${res.status}). Retry in a moment; if it persists, check connectivity or set HTTPS_PROXY/HTTP_PROXY.`
            : `Google Trends returned unexpected HTTP ${res.status}; the public endpoint may have changed. Retry later and update gtfa if it persists.`);
      }
      this.limiter.recover();
      return res.body;
    }, req.signal);
  }
}
