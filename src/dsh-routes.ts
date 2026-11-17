import { OnDemandActorClient } from './actor-on-demand.js';
import { createApifyAccountClient, type ApifyUsageResult, type ApifyUsageSource } from './apify-account.js';
import {
  APIFY_OAUTH_CANCEL_PATH,
  APIFY_OAUTH_LOGOUT_PATH,
  APIFY_OAUTH_START_PATH,
  APIFY_OAUTH_STATUS_PATH,
  type ApifyOAuthManager,
  type OAuthTokenResolution,
} from './apify-oauth.js';
import {
  createActorRelayTransport,
  createApifyActorClient,
  resolveApifyApiToken,
  type ActorRelayTransport,
  type ApifyActorClientOptions,
} from './apify-actor.js';
import { abortError, createDefaultTransport, isChallengeResponse, raceAbort, type Transport } from './transport.js';
import { GTFA_PUBLIC_ACTOR_ID, type EgressMode } from './options.js';
import { GTrendsError } from './core.js';
import { VERSION } from './version.js';
import type { ActorRuntime } from './actor-runtime.js';
import { createTools } from './tools.js';
import { dashboardRoute, type DashboardBoundary } from './dashboard-routes.js';
import {
  CONNECTION_FILTER, CONNECTION_KEYWORDS, CONNECTION_PROBE_PROTOCOL, connectionErrorCode,
  emptyDataCheck, summarizeConnectionProbe, type ConnectionCode, type ConnectionDiagnostics, type ConnectionResult,
} from './connection-check.js';

export const APIFY_USAGE_PATH = '/api/gtfa.apify-usage';
export const APIFY_ACTORS_PATH = '/api/gtfa.apify-actors';
export const APIFY_DEPLOY_PATH = '/api/gtfa.apify-deploy';
export const APIFY_UPDATE_PATH = '/api/gtfa.apify-update';
export const TEST_CONNECTION_PATH = '/api/gtfa.test-connection';

const TRENDS_URL = 'https://trends.google.com/trends/';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RouteSettings {
  egress: EgressMode;
  apifyToken?: string;
  apifyActor?: string;
}

export interface RouteOverrides {
  dashboard?: DashboardBoundary;
  /** Fetch implementation for the Apify REST API in tests. */
  fetch?: typeof globalThis.fetch;
  /** Local transport used by the local test-connection check in tests. */
  localTransport?: Transport;
  /** Relay transport factory used by the Actor test-connection check in tests. */
  relayTransport?: (token: string, actorId: string) => Transport;
  /** Actor client overrides (cache clock). */
  actorOptions?: ApifyActorClientOptions;
  /** Clock override for latency assertions. */
  now?: () => number;
  /** OAuth manager used by account and connection routes. */
  oauth?: ApifyOAuthManager;
  /** Data-query boundary for deterministic route tests. */
  connectionProbe?: (signal: AbortSignal) => Promise<unknown>;
}

export type TestConnectionCode = ConnectionCode;
export type TestConnectionResult = ConnectionResult;

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

function failure(
  egress: EgressMode,
  code: TestConnectionCode,
  message: string,
  latencyMs: number,
  status: number | null = null,
  actorId?: string,
): TestConnectionResult {
  return { ok: false, egress, status, latencyMs, code, message, ...(actorId ? { actorId } : {}) };
}

function elapsed(clock: () => number, startedAt: number): number {
  return Math.max(0, Math.round(clock() - startedAt));
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

/** Connection-only overrides are temporary; saved credentials never leave the Host. */
async function readTestSettings(request: Request, saved: RouteSettings): Promise<{ settings: RouteSettings; source: 'draft' | 'saved' } | undefined> {
  try {
    const text = await request.text();
    if (text.length > 16_384) return undefined;
    const body: unknown = text.trim() ? JSON.parse(text) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !['egress', 'apifyActor', 'apifyToken'].includes(key))) return undefined;
    if ('egress' in input && (typeof input.egress !== 'string' || !['local', 'actor-public', 'actor-own'].includes(input.egress))) return undefined;
    for (const [key, limit] of [['apifyActor', 256], ['apifyToken', 4096]] as const) {
      if (key in input && (typeof input[key] !== 'string' || input[key].length > limit || /[\u0000-\u001f\u007f]/.test(input[key]))) return undefined;
    }
    return {
      settings: {
        egress: (input.egress ?? saved.egress) as EgressMode,
        apifyActor: 'apifyActor' in input ? (input.apifyActor as string).trim() : saved.apifyActor,
        apifyToken: 'apifyToken' in input ? (input.apifyToken as string).trim() : saved.apifyToken,
      },
      source: Object.keys(input).length ? 'draft' : 'saved',
    };
  } catch { return undefined; }
}

/**
 * Reachability preflight only. Local sends a HEAD; Actor routes read API metadata.
 */
export async function testConnection(options: {
  egress: EgressMode;
  apifyToken?: string;
  apifyActor?: string;
  localTransport?: Transport;
  relayTransport?: (token: string, actorId: string) => Transport;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  oauth?: ApifyOAuthManager;
}): Promise<TestConnectionResult> {
  const clock = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (options.egress === 'local') {
    const startedAt = clock();
    const transport = options.localTransport ?? createDefaultTransport();
    try {
      const response = await raceAbort(transport({
        url: TRENDS_URL,
        method: 'HEAD',
        headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0' },
        timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
      }), options.signal);
      const latencyMs = elapsed(clock, startedAt);
      if (isChallengeResponse(response)) {
        return failure('local', 'blocked', 'Google Trends returned a challenge (CAPTCHA/unusual traffic). Stop and retry later.', latencyMs, response.status);
      }
      if (response.status === 429) return failure('local', 'rate-limited', 'Google Trends returned HTTP 429. Stop and retry later.', latencyMs, response.status);
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

  if (options.egress !== 'actor-public' && options.egress !== 'actor-own') {
    return failure(options.egress, 'network', `Unsupported egress "${String(options.egress)}".`, 0);
  }

  const resolved: OAuthTokenResolution = options.oauth
    ? await options.oauth.resolveToken(options.apifyToken)
    : (() => {
      const legacy = resolveApifyApiToken(options.apifyToken);
      return legacy.token ? { token: legacy.token, source: legacy.source } : {};
    })();
  if (!resolved.token) {
    return failure(
      options.egress,
      resolved.message ? 'invalid-token' : 'no-token',
      resolved.message ?? 'Sign in with Apify in Plugins → Google Trends, or use the advanced manual token or APIFY_TOKEN, to use an Actor egress.',
      0,
    );
  }
  const actorId = options.egress === 'actor-public' ? GTFA_PUBLIC_ACTOR_ID : options.apifyActor?.trim();
  if (!actorId) {
    return failure(options.egress, 'no-actor', 'Select or deploy your google-trends-for-agent Actor in Plugins → Google Trends.', 0);
  }
  const startedAt = clock();
  if (!options.relayTransport) {
    try {
      await new OnDemandActorClient(options.fetch ? { fetch: options.fetch } : {}).check(resolved.token, actorId, options.signal);
      return { ok: true, egress: options.egress, status: 200, latencyMs: elapsed(clock, startedAt), actorId };
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal);
      const message = scrubSecrets(errorText(error), resolved.token);
      return failure(options.egress, /rejected the token|HTTP 401|HTTP 403/i.test(message) ? 'invalid-token' : /HTTP 404|Select or deploy/i.test(message) ? 'no-actor' : 'network', message, elapsed(clock, startedAt), null, actorId);
    }
  }
  // Explicit legacy transport injection remains for library consumers and old
  // fixtures. Production checks only the API and never start a paid Actor.
  let transport: Transport;
  try {
    transport = options.relayTransport?.(resolved.token, actorId)
      ?? createActorRelayTransport({ token: resolved.token, actorId });
    const health = (transport as Partial<ActorRelayTransport>).checkHealth;
    if (typeof health === 'function') await health.call(transport, options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    const message = scrubSecrets(errorText(error), resolved.token);
    const code: TestConnectionCode = /relay v|needs v1|Update the plugin or rebuild/i.test(message)
      ? 'version-mismatch'
      : /rejected the token|HTTP 401|HTTP 403|invalid token|token is invalid/i.test(message)
        ? 'invalid-token'
        : 'network';
    return failure(options.egress, code, message || 'Could not build the Actor relay transport.', 0, null, actorId);
  }

  try {
    const response = await raceAbort(transport({
      url: TRENDS_URL,
      method: 'HEAD',
      headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0' },
      timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    }), options.signal);
    const latencyMs = elapsed(clock, startedAt);
    if (isChallengeResponse(response)) {
      return failure(options.egress, 'blocked', 'Google Trends returned a challenge (CAPTCHA/unusual traffic). Stop and retry later.', latencyMs, response.status, actorId);
    }
    if (response.status === 429) return failure(options.egress, 'rate-limited', 'Google Trends returned HTTP 429. Stop and retry later.', latencyMs, response.status, actorId);
    if (response.status === 401 || response.status === 403) {
      return failure(options.egress, 'invalid-token', 'Apify rejected the token. Check it in Apify Console → Settings → API & Integrations.', latencyMs, response.status, actorId);
    }
    if (response.status === 404) {
      return failure(options.egress, 'no-actor', 'Select or deploy your google-trends-for-agent Actor in Plugins → Google Trends.', latencyMs, response.status, actorId);
    }
    if (response.status < 200 || response.status >= 400) {
      return failure(options.egress, 'http', `Your Apify Actor returned HTTP ${response.status}.`, latencyMs, response.status, actorId);
    }
    return { ok: true, egress: options.egress, status: response.status, latencyMs, actorId };
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    const message = scrubSecrets(errorText(error), resolved.token);
    const code: TestConnectionCode = /relay v|needs v1|Update the plugin or rebuild/i.test(message)
      ? 'version-mismatch'
      : /rejected the token|HTTP 401|HTTP 403|invalid token|token is invalid/i.test(message)
        ? 'invalid-token'
        : /Select or deploy|HTTP 404|Standby URL|no Actor/i.test(message)
          ? 'no-actor'
          : 'network';
    return failure(options.egress, code, message || 'Could not reach your Apify Actor. Check the Standby URL and connectivity.', elapsed(clock, startedAt), null, actorId);
  }
}

/** One preflight followed by one fresh comparison; never fan out or retry a data probe. */
export async function diagnoseConnection(options: Parameters<typeof testConnection>[0] & {
  connectionProbe?: (signal: AbortSignal) => Promise<unknown>;
  diagnosticTimeoutMs?: number;
}): Promise<ConnectionDiagnostics> {
  const clock = options.now ?? Date.now, startedAt = clock();
  const deadline = AbortSignal.timeout(options.diagnosticTimeoutMs ?? 120_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  let network: TestConnectionResult;
  try { network = await raceAbort(testConnection({ ...options, signal }), signal); }
  catch {
    network = failure(options.egress, options.signal?.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'network', 'Connection preflight did not complete.', elapsed(clock, startedAt));
  }
  if (!network.ok) return { ...network, network, data: emptyDataCheck(network.code ?? 'network', 0, true), checkedAt: new Date().toISOString() };
  const dataStarted = clock();
  let actorRuntime: ActorRuntime | null | undefined;
  let data;
  try {
    const input = { keywords: [...CONNECTION_KEYWORDS], ...CONNECTION_FILTER, timeoutMs: 30_000 };
    let result: unknown;
    if (options.connectionProbe) result = await raceAbort(options.connectionProbe(signal), signal);
    else if (options.egress === 'local') {
      const tool = createTools({ transport: options.localTransport, chartDir: null }).find(tool => tool.name === 'trends_compare')!;
      result = await tool.execute(input, { signal, maxRetries: 0 });
    } else {
      const resolved = options.oauth ? await raceAbort(options.oauth.resolveToken(options.apifyToken), signal) : resolveApifyApiToken(options.apifyToken);
      if (!resolved.token) return { ...network, ok: false, code: 'invalid-token', network,
        data: emptyDataCheck('invalid-token'), latencyMs: elapsed(clock, startedAt), checkedAt: new Date().toISOString() };
      const output = await new OnDemandActorClient(options.fetch ? { fetch: options.fetch } : {}).call(resolved.token, network.actorId!, {
        protocol: CONNECTION_PROBE_PROTOCOL, name: 'trends_compare', input, settings: { cache: false, charts: false },
      }, signal);
      result = output.result;
      actorRuntime = output.runtime;
    }
    data = summarizeConnectionProbe(result, elapsed(clock, dataStarted));
  } catch (error) {
    const code = options.signal?.aborted ? 'cancelled' : deadline.aborted ? 'timeout'
      : error instanceof GTrendsError ? /rejected the token/i.test(error.message) ? 'invalid-token'
        : /HTTP 404|Select or deploy/i.test(error.message) ? 'no-actor' : connectionErrorCode(error.code) : 'network';
    data = emptyDataCheck(code, elapsed(clock, dataStarted));
  }
  return { ...network, ok: data.ok, ...(data.code ? { code: data.code } : {}), latencyMs: elapsed(clock, startedAt),
    ...(actorRuntime !== undefined ? { actorRuntime, pluginVersion: VERSION } : {}),
    network, data, checkedAt: new Date().toISOString() };
}

function attachRoutes(connection: unknown, getSettings: () => RouteSettings, overrides: RouteOverrides): (() => void) | undefined {
  const service = connection as ConnectionService | undefined;
  if (!service?.fetch?.register) return undefined;
  const account = createApifyAccountClient({
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const actors = createApifyActorClient({
    ...overrides.actorOptions,
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  let testing = false;
  let deploying = false;
  const disposers: Array<() => Promise<void>> = [];

  const resolveRouteToken = async (legacyToken?: string): Promise<OAuthTokenResolution> => {
    if (overrides.oauth) return overrides.oauth.resolveToken(legacyToken);
    const resolved = resolveApifyApiToken(legacyToken);
    return resolved.token ? { token: resolved.token, source: resolved.source } : {};
  };

  const tokenFailure = (resolved: OAuthTokenResolution, action: string): ApifyUsageResult => {
    if (resolved.code === 'network') {
      return { ok: false, code: 'network', message: resolved.message ?? `Could not reach Apify while trying to ${action}.` };
    }
    if (resolved.code) return { ok: false, code: 'invalid-token', message: resolved.message ?? `Apify OAuth could not ${action}.` };
    return { ok: false, code: 'no-token', message: `Sign in with Apify in Plugins → Google Trends, or use the advanced manual token or APIFY_TOKEN, to ${action}.` };
  };

  disposers.push(service.fetch.register({
    path: APIFY_USAGE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => {
      const refresh = new URL(request.url).searchParams.get('refresh') === '1';
      const settings = getSettings();
      const resolved = await resolveRouteToken(settings.apifyToken);
      let result: ApifyUsageResult;
      if (!resolved.token) {
        result = tokenFailure(resolved, 'see usage');
      } else {
        result = await account.usage({
          token: resolved.token,
          source: resolved.source as ApifyUsageSource,
          refresh,
          signal: request.signal,
        });
      }
      return json(result);
    },
  }));

  disposers.push(service.fetch.register({
    path: APIFY_ACTORS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => {
      const refresh = new URL(request.url).searchParams.get('refresh') === '1';
      const settings = getSettings();
      const resolved = await resolveRouteToken(settings.apifyToken);
      if (!resolved.token) return json(tokenFailure(resolved, 'list your Actors'));
      return json(await actors.listMyActors(resolved.token, { refresh, signal: request.signal, metadata: 'build' }));
    },
  }));

  disposers.push(service.fetch.register({
    path: APIFY_DEPLOY_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      const rejected = rejectCrossSite(request);
      if (rejected) return rejected;
      if (deploying) {
        return json({ ok: false, code: 'busy', message: 'A deploy is already running. Try again in a moment.' }, 429);
      }
      deploying = true;
      try {
        const resolved = await resolveRouteToken(getSettings().apifyToken);
        if (!resolved.token) return json(tokenFailure(resolved, 'deploy the Actor'));
        return json(await actors.deployActor(resolved.token));
      } finally {
        deploying = false;
      }
    },
  }));

  disposers.push(service.fetch.register({
    path: APIFY_UPDATE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      const rejected = rejectCrossSite(request);
      if (rejected) return rejected;
      const input = await readTestSettings(request, getSettings());
      if (!input || !input.settings.apifyActor || !/^[a-zA-Z0-9_~./-]{1,256}$/.test(input.settings.apifyActor)) {
        return json({ ok: false, code: 'http', message: 'Select your Actor first.' }, 400);
      }
      if (deploying) return json({ ok: false, code: 'busy', message: 'An Actor build is already starting.' }, 429);
      deploying = true;
      try {
        const resolved = await resolveRouteToken(input.settings.apifyToken);
        if (!resolved.token) return json(tokenFailure(resolved, 'update the Actor'));
        return json(await actors.updateActor(resolved.token, input.settings.apifyActor, request.signal));
      } finally { deploying = false; }
    },
  }));

  disposers.push(service.fetch.register({
    path: TEST_CONNECTION_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      const rejected = rejectCrossSite(request);
      if (rejected) return rejected;
      const selected = await readTestSettings(request, getSettings());
      if (!selected) return json({ error: 'Invalid connection test settings.' }, 400);
      const { settings, source } = selected;
      if (testing) {
        return json({ ...failure(settings.egress, 'busy', 'A connection test is already running. Try again in a moment.', 0), settingsSource: source }, 429);
      }
      testing = true;
      try {
        const result = await diagnoseConnection({
          egress: settings.egress,
          apifyToken: settings.apifyToken,
          apifyActor: settings.apifyActor,
          localTransport: overrides.localTransport,
          relayTransport: overrides.relayTransport,
          fetch: overrides.fetch,
          oauth: overrides.oauth,
          signal: request.signal,
          now: overrides.now,
          connectionProbe: overrides.connectionProbe,
        });
        return json({ ...result, settingsSource: source });
      } finally {
        testing = false;
      }
    },
  }));

  const rejectCrossSite = (request: Request): Response | undefined => {
    const site = request.headers.get('sec-fetch-site')?.toLowerCase();
    if (site && !['same-origin', 'same-site', 'none'].includes(site)) {
      return json({ error: 'cross-site request rejected' }, 403);
    }
    const origin = request.headers.get('origin');
    if (origin) {
      try {
        const supplied = new URL(origin);
        const target = new URL(request.url);
        let expected = target.origin;
        // dsh's HTTP bridge constructs Fetch URLs under http://dsh.internal
        // while preserving the real Host header. Its outer browser-trust fence
        // authenticates that Host before dispatching owner-only plugin routes.
        // Compare the public authority, including ports, for this bridge only.
        if (target.origin === 'http://dsh.internal') {
          const host = request.headers.get('host');
          if (!host || /[\s/@\\?#]/.test(host) || !['http:', 'https:'].includes(supplied.protocol)) {
            return json({ error: 'cross-site request rejected' }, 403);
          }
          expected = new URL(`${supplied.protocol}//${host}`).origin;
        }
        if (supplied.origin === 'null' || supplied.origin !== expected) {
          return json({ error: 'cross-site request rejected' }, 403);
        }
      } catch {
        return json({ error: 'cross-site request rejected' }, 403);
      }
    }
    return undefined;
  };

  const oauthRoute = (path: string, methods: readonly ('POST')[], run: (request: Request) => Promise<unknown>) => {
    if (!overrides.oauth) return;
    disposers.push(service.fetch!.register({
      path,
      methods,
      requestBody: 'buffered',
      fetch: async request => {
        if (!methods.includes(request.method as 'POST')) {
          return json({ error: 'method not allowed' }, 405);
        }
        const rejected = rejectCrossSite(request);
        if (rejected) return rejected;
        try {
          return json(await run(request));
        } catch {
          return json({ available: true, connected: false, pending: false, code: 'network', message: 'Could not complete the OAuth request. Try again.' }, 500);
        }
      },
    }));
  };

  if (overrides.dashboard) disposers.push(service.fetch.register(dashboardRoute(overrides.dashboard, rejectCrossSite)));

  if (overrides.oauth) {
    disposers.push(service.fetch.register({
      path: APIFY_OAUTH_STATUS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async request => {
        try {
          return json(await overrides.oauth!.status(request.signal));
        } catch {
          return json({ available: true, connected: false, pending: false, code: 'network', message: 'Could not read OAuth status. Try again.' }, 500);
        }
      },
    }));
    oauthRoute(APIFY_OAUTH_START_PATH, ['POST'], request => overrides.oauth!.start(request.signal));
    oauthRoute(APIFY_OAUTH_CANCEL_PATH, ['POST'], () => overrides.oauth!.cancel());
    oauthRoute(APIFY_OAUTH_LOGOUT_PATH, ['POST'], () => overrides.oauth!.logout());
  }

  return () => {
    for (const dispose of disposers) void dispose();
  };
}

/**
 * Register the owner-only usage, Actor, deploy, and test-connection routes when
 * the web host provides `connection`. Headless/TUI profiles have no such
 * service, so tools and skills keep working unchanged.
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
