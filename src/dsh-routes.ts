import { createApifyAccountClient, type ApifyUsageResult, type ApifyUsageSource } from './apify-account.js';
import {
  createActorRelayTransport,
  createApifyActorClient,
  resolveApifyApiToken,
  type ApifyActorClientOptions,
} from './apify-actor.js';
import { abortError, createDefaultTransport, raceAbort, type Transport } from './transport.js';
import type { EgressMode } from './options.js';

export const APIFY_USAGE_PATH = '/api/gtfa.apify-usage';
export const APIFY_ACTORS_PATH = '/api/gtfa.apify-actors';
export const APIFY_DEPLOY_PATH = '/api/gtfa.apify-deploy';
export const TEST_CONNECTION_PATH = '/api/gtfa.test-connection';

const TRENDS_URL = 'https://trends.google.com/trends/';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RouteSettings {
  egress: EgressMode;
  apifyToken?: string;
  apifyActor?: string;
}

export interface RouteOverrides {
  /** Fetch implementation for the Apify REST API in tests. */
  fetch?: typeof globalThis.fetch;
  /** Local transport used by the local test-connection check in tests. */
  localTransport?: Transport;
  /** Relay transport factory used by the apify test-connection check in tests. */
  relayTransport?: (token: string, actorId: string) => Transport;
  /** Actor client overrides (cache clock). */
  actorOptions?: ApifyActorClientOptions;
  /** Clock override for latency assertions. */
  now?: () => number;
}

export type TestConnectionCode = 'no-token' | 'no-actor' | 'invalid-token' | 'network' | 'http' | 'busy';

export interface TestConnectionResult {
  ok: boolean;
  egress: EgressMode;
  status: number | null;
  latencyMs: number;
  code?: TestConnectionCode;
  message?: string;
  actorId?: string;
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

/**
 * One reachability check for the saved egress: one target request per call.
 * The apify check relays `GET https://trends.google.com/trends/` through the
 * selected Actor, so it exercises the same path the tools use.
 */
export async function testConnection(options: {
  egress: EgressMode;
  apifyToken?: string;
  apifyActor?: string;
  localTransport?: Transport;
  relayTransport?: (token: string, actorId: string) => Transport;
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
    return failure('apify', 'no-token', 'Add an Apify token (or set APIFY_TOKEN) to use apify egress.', 0);
  }
  const actorId = options.apifyActor?.trim();
  if (!actorId) {
    return failure('apify', 'no-actor', 'Select or deploy your google-trends-for-agent Actor in Plugins → Google Trends.', 0);
  }
  const startedAt = clock();
  let transport: Transport;
  try {
    transport = options.relayTransport?.(resolved.token, actorId)
      ?? createActorRelayTransport({ token: resolved.token, actorId });
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    const message = scrubSecrets(errorText(error), resolved.token);
    return failure('apify', 'invalid-token', message || 'Could not build the Actor relay transport.', 0, null, actorId);
  }

  try {
    const response = await raceAbort(transport({
      url: TRENDS_URL,
      method: 'GET',
      headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0' },
      timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    }), options.signal);
    const latencyMs = elapsed(clock, startedAt);
    if (response.status === 401 || response.status === 403) {
      return failure('apify', 'invalid-token', 'Apify rejected the token. Check it in Apify Console → Settings → API & Integrations.', latencyMs, response.status, actorId);
    }
    if (response.status === 404) {
      return failure('apify', 'no-actor', 'Select or deploy your google-trends-for-agent Actor in Plugins → Google Trends.', latencyMs, response.status, actorId);
    }
    if (response.status < 200 || response.status >= 400) {
      return failure('apify', 'http', `Your Apify Actor returned HTTP ${response.status}.`, latencyMs, response.status, actorId);
    }
    return { ok: true, egress: 'apify', status: response.status, latencyMs, actorId };
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    const message = scrubSecrets(errorText(error), resolved.token);
    const code: TestConnectionCode = /rejected the token|HTTP 401|HTTP 403|invalid token|token is invalid/i.test(message)
      ? 'invalid-token'
      : /Select or deploy|HTTP 404|Standby URL|no Actor/i.test(message)
        ? 'no-actor'
        : 'network';
    return failure('apify', code, message || 'Could not reach your Apify Actor. Check the Standby URL and connectivity.', elapsed(clock, startedAt), null, actorId);
  }
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
      const resolved = resolveApifyApiToken(settings.apifyToken);
      if (!resolved.token) return json({ ok: false, code: 'no-token', message: 'Add an Apify token (or set APIFY_TOKEN) to list your Actors.' });
      return json(await actors.listMyActors(resolved.token, { refresh, signal: request.signal }));
    },
  }));

  disposers.push(service.fetch.register({
    path: APIFY_DEPLOY_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async () => {
      if (deploying) {
        return json({ ok: false, code: 'busy', message: 'A deploy is already running. Try again in a moment.' }, 429);
      }
      const resolved = resolveApifyApiToken(getSettings().apifyToken);
      if (!resolved.token) return json({ ok: false, code: 'no-token', message: 'Add an Apify token (or set APIFY_TOKEN) to deploy the Actor.' });
      deploying = true;
      try {
        return json(await actors.deployActor(resolved.token));
      } finally {
        deploying = false;
      }
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
          apifyActor: settings.apifyActor,
          localTransport: overrides.localTransport,
          relayTransport: overrides.relayTransport,
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
