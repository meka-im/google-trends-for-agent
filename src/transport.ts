import { ProxyAgent, fetch as proxyFetch } from 'undici';
import { CookieJar } from 'tough-cookie';
import { GTrendsError } from './core.js';

export interface TransportRequest { url: string; method?: string; body?: string; headers: Record<string, string>; timeoutMs: number }
export interface TransportResponse { status: number; headers: Record<string, string>; body: string }
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** Uses global fetch directly, or an HTTPS proxy when configured. Redirects are never followed. */
export function createDefaultTransport(): Transport {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  return async req => {
    const init = { method: req.method ?? 'GET', body: req.body, headers: req.headers, redirect: 'manual' as const, signal: AbortSignal.timeout(req.timeoutMs) };
    const res = dispatcher ? await proxyFetch(req.url, { ...init, dispatcher }) : await globalThis.fetch(req.url, init);
    const headers = Object.fromEntries(res.headers.entries());
    const cookies = res.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies.join('\n');
    return { status: res.status, headers, body: await res.text() };
  };
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
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const wait = this.nextAt - this.now();
      if (wait > 0) await this.sleep(wait);
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
    return this.limiter.run(async () => {
      const cookie = await this.jar.getCookieString(req.url);
      let res: TransportResponse;
      this.upstreamRequests++;
      try { res = await this.transport({ ...req, headers: { ...req.headers, ...(cookie ? { cookie } : {}) } }); }
      catch (error) {
        const timeout = error instanceof Error && /timeout|abort/i.test(error.name);
        throw new GTrendsError(timeout ? 'TRENDS_TIMEOUT' : 'NETWORK_ERROR', timeout ? 'upstream request timed out' : 'upstream request failed');
      }
      const headers = Object.fromEntries(Object.entries(res.headers).map(([k,v]) => [k.toLowerCase(),v]));
      // Split combined headers without splitting an Expires date's comma.
      for (const cookie of (headers['set-cookie'] ?? '').split(/\n|,(?=\s*[^;,=\s]+\s*=)/)) {
        if (cookie.trim()) await this.jar.setCookie(cookie.trim(), req.url, { ignoreError: true });
      }
      const looksJson = /^\s*(?:\)\]\}'[,]?\s*)?[{[]/.test(res.body);
      const blocked = /\/sorry(?:\/|\b)/i.test(headers.location ?? '') ||
        !looksJson && /captcha|unusual traffic|\/sorry(?:\/|\b)/i.test(res.body);
      if (blocked || res.status === 429) {
        const retry = headers['retry-after'];
        const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.limiter.now()) : 0;
        this.limiter.penalize(Number.isFinite(delay) ? delay : 0);
        throw new GTrendsError(blocked ? 'BLOCKED' : 'RATE_LIMITED', blocked ? 'upstream challenge detected' : 'upstream rate limit reached', delay > 0 && Number.isFinite(delay) ? Math.ceil(delay / 1000) : undefined);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new GTrendsError(res.status >= 500 ? 'TRENDS_TEMPORARILY_UNAVAILABLE' : 'TRENDS_PROTOCOL_CHANGED', `unexpected upstream status ${res.status}`);
      }
      this.limiter.recover();
      return res.body;
    });
  }
}
