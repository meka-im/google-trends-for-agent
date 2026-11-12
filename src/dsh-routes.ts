import { createHash } from 'node:crypto';
import { createEgressTransport, type EgressMode, type EgressOptions } from './egress.js';
import { createApifyAccountClient, type ApifyUsageResult, type ApifyUsageSource } from './apify-account.js';
import { abortError, createDefaultTransport, raceAbort, type Transport } from './transport.js';
import type { ApifyProxyGroup } from './options.js';

export const APIFY_USAGE_PATH = '/api/gtfa.apify-usage';
export const TEST_CONNECTION_PATH = '/api/gtfa.test-connection';

const TRENDS_URL = 'https://trends.google.com/trends/';
const BROWSER_INFO_URL = 'http://api.apify.com/v2/browser-info';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RouteSettings {
  egress: EgressMode;
  apifyToken?: string;
  apifyProxyGroup: ApifyProxyGroup;
  apifyProxyCountry: string;
}

export interface RouteOverrides {
  /** Fetch implementation for the Apify REST API (usage) in tests. */
  fetch?: typeof globalThis.fetch;
  /** Local transport used by the local test-connection check in tests. */
  localTransport?: Transport;
  /** Apify transport construction overrides for test-connection in tests. */
  egress?: EgressOptions;
  /** Clock override for latency and fetchedAt assertions. */
  now?: () => number;
}

export type TestConnectionCode = 'no-token' | 'invalid-token' | 'proxy-auth' | 'network' | 'http' | 'busy';

export interface TestConnectionResult {
  ok: boolean;
  egress: EgressMode;
  status: number | null;
  latencyMs: number;
  code?: TestConnectionCode;
  message?: string;
  ip?: string;
  country?: string;
}

interface ConnectionRoute {
  path: string;
  methods: readonly ('GET' | 'HEAD' | 'POST')[];
  requestBody: 'buffered' | 'streaming';
  fetch: (request: Request) => Promise<Response>;
}

interface ConnectionService {
  fetch?: { register(route: ConnectionRoute): () => Promise<void> };
}

interface RouteContext {
  get?(name: string): unknown;
  inject?(names: string[], callback: (ctx: RouteContext) => void): unknown;
  effect?(callback: () => void | (() => void)): unknown;
}

/** Saved config token wins; otherwise APIFY_TOKEN. APIFY_PROXY_PASSWORD is not an API token. */
export function resolveApifyApiToken(configToken?: string | null, env: NodeJS.ProcessEnv = process.env): { token?: string; source?: ApifyUsageSource } {
  const configured = configToken?.trim();
  if (configured) return { token: configured, source: 'config' };
  const fromEnv = env.APIFY_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: 'env' };
  return {};
}

/** Remove proxy credentials and any accidental token text from an error message. */
export function scrubSecrets(message: string, token?: string): string {
  let text = message.replace(/https?:\/\/[^\s/@]+@/gi, 'http://***@');
  if (token) text = text.split(token).join('***');
  return text;
}

/** Error text plus its innermost cause (undici hides it behind "fetch failed"). */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  let detail = '';
  let cause: unknown = (error as { cause?: unknown }).cause;
  for (let depth = 0; cause && typeof cause === 'object' && depth < 5; depth++) {
    const row = cause as { code?: unknown; message?: unknown; cause?: unknown };
    const text = typeof row.message === 'string' && row.message ? row.message : typeof row.code === 'string' ? row.code : '';
    if (text) detail = text;
    cause = row.cause;
  }
  return detail && !error.message.includes(detail) ? `${error.message}: ${detail}` : error.message;
}

function failure(egress: EgressMode, code: TestConnectionCode, message: string, latencyMs: number, status: number | null = null): TestConnectionResult {
  return { ok: false, egress, status, latencyMs, code, message };
}

function elapsed(clock: () => number, startedAt: number): number {
  return Math.max(0, Math.round(clock() - startedAt));
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

function parseBrowserInfo(body: string): { ip?: string; country?: string } {
  try {
    const parsed = body ? JSON.parse(body) as unknown : undefined;
    const top = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    const data = top.data && typeof top.data === 'object' && !Array.isArray(top.data) ? top.data as Record<string, unknown> : {};
    const source = Object.keys(data).length ? data : top;
    const ip = typeof source.clientIp === 'string' && source.clientIp.trim() ? source.clientIp.trim() : undefined;
    const country = typeof source.countryCode === 'string' && source.countryCode.trim() ? source.countryCode.trim() : undefined;
    return { ...(ip ? { ip } : {}), ...(country ? { country } : {}) };
  } catch {
    return {};
  }
}

/**
 * One reachability check for the saved egress: one target request per call. The first
 * Apify check per token also looks up the proxy password (GET /v2/users/me), as the tools do.
 */
export async function testConnection(options: {
  egress: EgressMode;
  apifyToken?: string;
  apifyProxyGroup?: ApifyProxyGroup;
  apifyProxyCountry?: string;
  localTransport?: Transport;
  apifyOptions?: EgressOptions;
  /** Reuse a transport across clicks so the proxy password lookup happens once per token/group/country. */
  apifyTransport?: (token: string, build: () => Transport) => Transport;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
}): Promise<TestConnectionResult> {
  const clock = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (options.egress === 'local') {
    const startedAt = clock();
    const transport = options.localTransport ?? createDefaultTransport();
    try {
      const response = await raceAbort(transport({
        url: TRENDS_URL,
        method: 'GET',
        headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0' },
        timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
      }), options.signal);
      const latencyMs = elapsed(clock, startedAt);
      if (response.status === 407) return failure('local', 'proxy-auth', 'The HTTPS proxy rejected authentication (407). Check HTTPS_PROXY credentials.', latencyMs, 407);
      if (response.status < 200 || response.status >= 400) {
        return failure('local', 'http', `Google Trends returned HTTP ${response.status}.`, latencyMs, response.status);
      }
      return { ok: true, egress: 'local', status: response.status, latencyMs };
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal);
      const message = scrubSecrets(errorText(error));
      return failure('local', 'network', message || 'Could not reach Google Trends. Check connectivity and the saved settings.', elapsed(clock, startedAt));
    }
  }

  if (options.egress !== 'apify') {
    return failure(options.egress, 'network', `Unsupported egress "${String(options.egress)}".`, 0);
  }

  const resolved = resolveApifyApiToken(options.apifyToken);
  if (!resolved.token) {
    return failure('apify', 'no-token', 'Add an Apify token (or set APIFY_TOKEN) to test the Apify proxy.', 0);
  }
  const startedAt = clock();
  let transport: Transport;
  try {
    const build = () => createEgressTransport({
      ...options.apifyOptions,
      egress: 'apify',
      apifyToken: resolved.token,
      apifyProxyGroup: options.apifyProxyGroup,
      apifyProxyCountry: options.apifyProxyCountry,
    });
    transport = options.apifyTransport ? options.apifyTransport(resolved.token, build) : build();
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    const message = scrubSecrets(errorText(error), resolved.token);
    return failure('apify', 'invalid-token', message || 'Could not build the Apify proxy transport.', 0);
  }

  try {
    const response = await raceAbort(transport({
      url: BROWSER_INFO_URL,
      method: 'GET',
      headers: { accept: 'application/json' },
      timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    }), options.signal);
    const latencyMs = elapsed(clock, startedAt);
    if (response.status === 407) {
      return failure('apify', 'proxy-auth', 'Apify proxy rejected the credentials (407). Check the token and proxy access.', latencyMs, 407);
    }
    if (response.status === 401 || response.status === 403) {
      return failure('apify', 'invalid-token', 'Apify rejected the token. Check it in Apify Console → Settings → API & Integrations.', latencyMs, response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      return failure('apify', 'http', `Apify proxy check returned HTTP ${response.status}.`, latencyMs, response.status);
    }
    return {
      ok: true,
      egress: 'apify',
      status: response.status,
      latencyMs,
      ...parseBrowserInfo(response.body),
    };
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    const message = scrubSecrets(errorText(error), resolved.token);
    const code: TestConnectionCode = /407|proxy authentication|proxy auth/i.test(message)
      ? 'proxy-auth'
      : /HTTP 401|HTTP 403|invalid token|token is invalid/i.test(message)
        ? 'invalid-token'
        : 'network';
    return failure('apify', code, message || 'Could not reach the Apify proxy. Check connectivity and the saved settings.', elapsed(clock, startedAt));
  }
}

function attachRoutes(connection: unknown, getSettings: () => RouteSettings, overrides: RouteOverrides): (() => void) | undefined {
  const service = connection as ConnectionService | undefined;
  if (!service?.fetch?.register) return undefined;
  const account = createApifyAccountClient({
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  let testing = false;
  // The Apify transport looks up the proxy password once (GET /v2/users/me); keep it per
  // token hash + group + country so repeated tests make only the proxy request.
  let cachedTransport: { key: string; transport: Transport } | undefined;
  const disposers: Array<() => Promise<void>> = [];

  disposers.push(service.fetch.register({
    path: APIFY_USAGE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => {
      const refresh = new URL(request.url).searchParams.get('refresh') === '1';
      const settings = getSettings();
      const resolved = resolveApifyApiToken(settings.apifyToken);
      let result: ApifyUsageResult;
      if (!resolved.token) {
        result = { ok: false, code: 'no-token', message: 'Add an Apify token (or set APIFY_TOKEN) to see usage.' };
      } else {
        result = await account.usage({
          token: resolved.token,
          source: resolved.source ?? 'config',
          refresh,
          signal: request.signal,
        });
      }
      return json(result);
    },
  }));

  disposers.push(service.fetch.register({
    path: TEST_CONNECTION_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      const settings = getSettings();
      if (testing) {
        return json(failure(settings.egress, 'busy', 'A connection test is already running. Try again in a moment.', 0), 429);
      }
      testing = true;
      try {
        const result = await testConnection({
          egress: settings.egress,
          apifyToken: settings.apifyToken,
          apifyProxyGroup: settings.apifyProxyGroup,
          apifyProxyCountry: settings.apifyProxyCountry,
          localTransport: overrides.localTransport,
          apifyOptions: overrides.egress,
          apifyTransport: (token, build) => {
            const key = `${createHash('sha256').update(token).digest('hex')}|${settings.apifyProxyGroup}|${settings.apifyProxyCountry}`;
            if (cachedTransport?.key !== key) cachedTransport = { key, transport: build() };
            return cachedTransport.transport;
          },
          signal: request.signal,
          now: overrides.now,
        });
        return json(result);
      } finally {
        testing = false;
      }
    },
  }));

  return () => {
    for (const dispose of disposers) void dispose();
  };
}

/**
 * Register the owner-only usage and test-connection routes when the web host
 * provides `connection`. Headless/TUI profiles have no such service, so tools
 * and skills keep working unchanged.
 */
export function registerRoutes(ctx: RouteContext, getSettings: () => RouteSettings, overrides: RouteOverrides = {}): void {
  const attach = (scope: RouteContext) => {
    const service = typeof scope.get === 'function' ? scope.get('connection') : (scope as { connection?: unknown }).connection;
    const cleanup = attachRoutes(service, getSettings, overrides);
    return cleanup;
  };
  const existing = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
  if (existing) {
    const cleanup = attach({ get: () => existing });
    if (typeof ctx.effect === 'function') ctx.effect(() => cleanup);
    return;
  }
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['connection'], scoped => {
    if (typeof scoped.effect === 'function') scoped.effect(() => attach(scoped));
    else attach(scoped);
  });
}
