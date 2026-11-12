import { createHash } from 'node:crypto';
import { GTrendsError } from './core.js';
import { abortError, raceAbort, throwIfAborted, type Transport, type TransportRequest, type TransportResponse } from './transport.js';
import { GTFA_ACTOR_GIT_URL, GTFA_ACTOR_NAME, GTFA_ACTOR_STANDBY_IDLE_SECS } from './options.js';

const API_BASE = 'https://api.apify.com/v2';
const DEFAULT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
/** The first relay call may wait for a cold Standby start. */
const COLD_START_TIMEOUT_MS = 120_000;

export type ApifyActorErrorCode = 'no-token' | 'invalid-token' | 'network' | 'http' | 'exists';
export type ApifyTokenSource = 'config' | 'env';

export interface ApifyActor {
  id: string;
  name: string;
  username: string | null;
  title: string | null;
  standbyUrl: string | null;
  standbyEnabled: boolean;
  lastBuildStatus: string | null;
}

export type ApifyActorsResult =
  | { ok: true; actors: ApifyActor[] }
  | { ok: false; code: Exclude<ApifyActorErrorCode, 'exists'>; status?: number; message: string };

export type ApifyDeployResult =
  | { ok: true; actorId: string; buildId: string }
  | { ok: false; code: ApifyActorErrorCode; status?: number; message: string };

export interface ApifyActorClientOptions {
  /** Fetch implementation; production uses global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Clock override for cache tests. */
  now?: () => number;
  /** Successful list/standby cache lifetime. Default 60 s. */
  cacheTtlMs?: number;
  /** Per-request Apify API timeout. Default 10 s. */
  timeoutMs?: number;
}

export interface ApifyActorListOptions {
  refresh?: boolean;
  signal?: AbortSignal;
}

/** Saved config token wins; otherwise APIFY_TOKEN. */
export function resolveApifyApiToken(
  configToken?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): { token?: string; source?: ApifyTokenSource } {
  const configured = configToken?.trim();
  if (configured) return { token: configured, source: 'config' };
  const fromEnv = env.APIFY_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: 'env' };
  return {};
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function actorMatches(name: string): boolean {
  return name === GTFA_ACTOR_NAME || name.startsWith(`${GTFA_ACTOR_NAME}-`);
}

/** The token is only ever sent to an https *.apify.actor Standby host. */
function isApifyStandbyUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && url.hostname.endsWith('.apify.actor');
  } catch { return false; }
}

interface CachedActors {
  tokenHash: string;
  at: number;
  actors: ApifyActor[];
}

interface CachedStandby {
  key: string;
  at: number;
  url: string;
}

type ApiResult = { ok: true; body: unknown } | { ok: false; code: 'invalid-token' | 'network' | 'http'; status?: number; message: string };

/**
 * Small read/write client for the user's own Apify account. Only actor metadata
 * and the deploy result leave this module; tokens and account identity are never
 * included in errors or return values.
 */
export class ApifyActorClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly clock: () => number;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private actorsCache: CachedActors | undefined;
  private standbyCache: CachedStandby | undefined;

  constructor(options: ApifyActorClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.clock = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** List only this package's Actors in the account, with Standby URL and latest build status. */
  async listMyActors(token: string, options: ApifyActorListOptions = {}): Promise<ApifyActorsResult> {
    const trimmed = token.trim();
    if (!trimmed) return { ok: false, code: 'no-token', message: 'Add an Apify token (or set APIFY_TOKEN) to list your Actors.' };
    const hash = tokenHash(trimmed);
    const now = this.clock();
    if (!options.refresh && this.actorsCache?.tokenHash === hash && now - this.actorsCache.at < this.cacheTtlMs) {
      return { ok: true, actors: this.actorsCache.actors };
    }
    const list = await this.getJson(`${API_BASE}/acts?my=1&limit=1000`, trimmed, options.signal);
    if (!list.ok) return list;
    const items = record(list.body).data;
    const rows = Array.isArray(record(items).items) ? record(items).items as unknown[] : [];
    const actors: ApifyActor[] = [];
    for (const item of rows) {
      const row = record(item);
      const id = stringOrNull(row.id);
      const name = stringOrNull(row.name);
      if (!id || !name || !actorMatches(name)) continue;
      const detail = await this.getJson(`${API_BASE}/acts/${encodeURIComponent(id)}`, trimmed, options.signal);
      if (!detail.ok) return detail;
      const data = record(record(detail.body).data);
      const standby = record(data.actorStandby);
      const tagged = record(data.taggedBuilds);
      const latest = record(tagged.latest);
      const buildId = stringOrNull(latest.buildId);
      let lastBuildStatus: string | null = null;
      if (buildId) {
        const build = await this.getJson(`${API_BASE}/actor-builds/${encodeURIComponent(buildId)}`, trimmed, options.signal);
        if (!build.ok) return build;
        lastBuildStatus = stringOrNull(record(record(build.body).data).status);
      } else {
        // `latest` is tagged only on success, so a running or failed first build
        // shows up only in the build list.
        const builds = await this.getJson(`${API_BASE}/acts/${encodeURIComponent(id)}/builds?desc=1&limit=1`, trimmed, options.signal);
        if (!builds.ok) return builds;
        const recent = record(record(builds.body).data).items;
        const first = record(Array.isArray(recent) ? recent[0] : undefined);
        lastBuildStatus = stringOrNull(first.status);
      }
      actors.push({
        id,
        name,
        username: stringOrNull(row.username),
        title: stringOrNull(data.title) ?? stringOrNull(row.title),
        standbyUrl: stringOrNull(data.standbyUrl),
        standbyEnabled: standby.isEnabled === true,
        lastBuildStatus,
      });
    }
    this.actorsCache = { tokenHash: hash, at: this.clock(), actors };
    return { ok: true, actors };
  }

  /** Resolve the Actor's Standby base URL; cached for 60 s per token hash + Actor id. */
  async resolveStandbyUrl(token: string, actorId: string, options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<string> {
    const trimmed = token.trim();
    const id = actorId.trim();
    if (!trimmed) throw new GTrendsError('INVALID_INPUT', 'Add an Apify token (or set APIFY_TOKEN) to use Apify egress.');
    if (!id) throw new GTrendsError('INVALID_INPUT', 'Select or deploy your google-trends-for-agent Actor in Plugins → Google Trends.');
    const key = `${tokenHash(trimmed)}|${id}`;
    const now = this.clock();
    if (!options.refresh && this.standbyCache?.key === key && now - this.standbyCache.at < this.cacheTtlMs) {
      return this.standbyCache.url;
    }
    const detail = await this.getJson(`${API_BASE}/acts/${encodeURIComponent(id)}`, trimmed, options.signal);
    if (!detail.ok) throw this.standbyError(detail);
    const data = record(record(detail.body).data);
    const url = stringOrNull(data.standbyUrl);
    if (!url) {
      throw new GTrendsError('INVALID_INPUT', 'This Actor has no Standby URL. Enable Standby in the Actor settings, then try again.');
    }
    if (!isApifyStandbyUrl(url)) {
      throw new GTrendsError('INVALID_INPUT', 'Apify returned an unexpected Standby URL for this Actor.');
    }
    this.standbyCache = { key, at: this.clock(), url };
    return url;
  }

  /** Create this package's Actor in the user's account and start its first build. */
  async deployActor(token: string): Promise<ApifyDeployResult> {
    const trimmed = token.trim();
    if (!trimmed) return { ok: false, code: 'no-token', message: 'Add an Apify token (or set APIFY_TOKEN) to deploy the Actor.' };
    const created = await this.requestJson(`${API_BASE}/acts`, trimmed, 'POST', {
      name: GTFA_ACTOR_NAME,
      title: 'Google Trends for AI Agents',
      isPublic: false,
      versions: [{
        versionNumber: '0.1',
        sourceType: 'GIT_REPO',
        gitRepoUrl: GTFA_ACTOR_GIT_URL,
        buildTag: 'latest',
      }],
      actorStandby: {
        isEnabled: true,
        idleTimeoutSecs: GTFA_ACTOR_STANDBY_IDLE_SECS,
        memoryMbytes: 512,
        desiredRequestsPerActorRun: 3,
        maxRequestsPerActorRun: 4,
        build: 'latest',
      },
    });
    if (!created.ok) {
      // Apify answers 409 `actor-name-not-unique` ("Some other Actor already has this name").
      if (created.status === 409 || (created.status === 400 && /already has this name|not unique|already exists/i.test(created.message))) {
        return { ok: false, code: 'exists', status: created.status ?? 409, message: 'An Actor with this name already exists. Refresh the list and select it.' };
      }
      return created;
    }
    const actorId = stringOrNull(record(record(created.body).data).id);
    if (!actorId) return { ok: false, code: 'http', message: 'Apify created the Actor but returned no id.' };
    const built = await this.requestJson(`${API_BASE}/acts/${encodeURIComponent(actorId)}/builds?version=0.1&tag=latest`, trimmed, 'POST');
    if (!built.ok) return built;
    const buildId = stringOrNull(record(record(built.body).data).id);
    if (!buildId) return { ok: false, code: 'http', message: 'Apify started the build but returned no build id.' };
    return { ok: true, actorId, buildId };
  }

  private standbyError(error: Extract<ApiResult, { ok: false }>): GTrendsError {
    if (error.code === 'invalid-token') return new GTrendsError('INVALID_INPUT', 'Apify rejected the token. Check it in Apify Console → Settings → API & Integrations.');
    if (error.code === 'network') return new GTrendsError('NETWORK_ERROR', 'Could not reach the Apify API. Check connectivity and try again.');
    if (error.status === 404) return new GTrendsError('INVALID_INPUT', 'Select or deploy your google-trends-for-agent Actor in Plugins → Google Trends.');
    return new GTrendsError('INVALID_INPUT', error.status ? `Apify API returned HTTP ${error.status} for this Actor.` : error.message);
  }

  private async getJson(url: string, token: string, signal?: AbortSignal): Promise<ApiResult> {
    return this.requestJson(url, token, 'GET', undefined, signal);
  }

  private async requestJson(
    url: string,
    token: string,
    method: 'GET' | 'POST',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<ApiResult> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    let response: Response;
    try {
      response = await raceAbort(this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: combined,
      }), combined);
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return {
        ok: false,
        code: 'network',
        message: timedOut
          ? `Apify API request timed out after ${Math.round(this.timeoutMs / 1000)} seconds.`
          : 'Could not reach the Apify API. Check connectivity and try again.',
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: 'invalid-token',
        status: response.status,
        message: `Apify rejected the token (HTTP ${response.status}). Check it in Apify Console → Settings → API & Integrations.`,
      };
    }
    let parsed: unknown;
    const text = await response.text();
    if (text) {
      try { parsed = JSON.parse(text); }
      catch {
        return {
          ok: false,
          code: 'http',
          status: response.status,
          message: `Apify API returned a non-JSON response (HTTP ${response.status}).`,
        };
      }
    }
    if (!response.ok) {
      const message = stringOrNull(record(record(parsed).error).message);
      return {
        ok: false,
        code: 'http',
        status: response.status,
        message: (message ?? `Apify API returned HTTP ${response.status}.`).split(token).join('***'),
      };
    }
    return { ok: true, body: parsed };
  }
}

export function createApifyActorClient(options: ApifyActorClientOptions = {}): ApifyActorClient {
  return new ApifyActorClient(options);
}

const sharedClient = createApifyActorClient();

/** Module-level convenience wrappers; routes use one client so the 60 s cache is shared. */
export function listMyActors(token: string, options: ApifyActorListOptions = {}): Promise<ApifyActorsResult> {
  return sharedClient.listMyActors(token, options);
}

export function resolveStandbyUrl(token: string, actorId: string): Promise<string> {
  return sharedClient.resolveStandbyUrl(token, actorId);
}

export function deployActor(token: string): Promise<ApifyDeployResult> {
  return sharedClient.deployActor(token);
}

export interface CreateActorRelayTransportOptions {
  /** Saved config token or APIFY_TOKEN. */
  token: string;
  /** The user's google-trends-for-agent Actor id. */
  actorId: string;
  /** Fetch implementation for tests. */
  fetch?: typeof globalThis.fetch;
  /** Standby URL resolver for tests; defaults to resolveStandbyUrl with the module cache. */
  resolveStandbyUrl?: (token: string, actorId: string) => Promise<string>;
  /** First request timeout (cold Standby start). Default 120 s. */
  coldStartTimeoutMs?: number;
}

/**
 * Relay transport for `apify` egress. Each Google request is POSTed to the
 * user's Actor at `/egress/fetch`, which performs it with its on-platform
 * residential proxy. The Apify token only travels in the Authorization header
 * and is never included in error messages.
 */
export function createActorRelayTransport(options: CreateActorRelayTransportOptions): Transport {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const resolve = options.resolveStandbyUrl ?? ((token: string, actorId: string) => sharedClient.resolveStandbyUrl(token, actorId));
  const coldStartTimeoutMs = options.coldStartTimeoutMs ?? COLD_START_TIMEOUT_MS;
  let standby: string | undefined;
  let resolving: Promise<string> | undefined;
  let first = true;

  const baseUrl = async (): Promise<string> => {
    if (standby) return standby;
    resolving ??= resolve(options.token.trim(), options.actorId.trim()).then(url => {
      standby = url.replace(/\/+$/, '');
      return standby;
    }).finally(() => { resolving = undefined; });
    return resolving;
  };

  return async (request: TransportRequest): Promise<TransportResponse> => {
    throwIfAborted(request.signal);
    if (!options.token.trim()) {
      throw new GTrendsError('INVALID_INPUT', 'Add an Apify token (or set APIFY_TOKEN) to use apify egress.');
    }
    if (!options.actorId.trim()) {
      throw new GTrendsError('INVALID_INPUT', 'Select or deploy your google-trends-for-agent Actor in Plugins → Google Trends.');
    }
    const base = await baseUrl();
    const timeoutMs = first ? Math.max(request.timeoutMs, coldStartTimeoutMs) : request.timeoutMs;
    first = false;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
    let response: Response;
    try {
      response = await raceAbort(fetchImpl(`${base}/egress/fetch`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token.trim()}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: request.url,
          method: request.method ?? 'GET',
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          timeoutMs: request.timeoutMs,
        }),
        redirect: 'manual',
        signal,
      }), signal);
    } catch (error) {
      if (request.signal?.aborted) throw abortError(request.signal);
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new GTrendsError('NETWORK_ERROR', timedOut
        ? `Your Apify Actor did not answer within ${Math.round(timeoutMs / 1000)} seconds. Retry; a cold Standby start can take up to two minutes.`
        : 'Could not reach your Apify Actor. Check its Standby URL and connectivity, then retry.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new GTrendsError('INVALID_INPUT', 'Apify rejected the token. Check it in Apify Console → Settings → API & Integrations.');
    }
    if (response.status === 404) {
      throw new GTrendsError('INVALID_INPUT', 'Select or deploy your google-trends-for-agent Actor in Plugins → Google Trends.');
    }
    if (response.status === 429 || response.status >= 500) {
      throw new GTrendsError('NETWORK_ERROR', `Your Apify Actor is temporarily unavailable (HTTP ${response.status}). Retry in a moment.`);
    }
    if (!response.ok) {
      throw new GTrendsError('INVALID_INPUT', `Your Apify Actor rejected the relay request (HTTP ${response.status}).`);
    }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new GTrendsError('NETWORK_ERROR', 'Your Apify Actor returned a non-JSON relay response. Retry; if it persists, redeploy the Actor.'); }
    const row = record(body);
    if (typeof row.status !== 'number' || !Number.isFinite(row.status) || typeof row.body !== 'string') {
      throw new GTrendsError('NETWORK_ERROR', 'Your Apify Actor returned an invalid relay response. Retry; if it persists, redeploy the Actor.');
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(record(row.headers))) {
      if (typeof value === 'string') headers[key] = value;
    }
    return { status: row.status, headers, body: row.body };
  };
}
