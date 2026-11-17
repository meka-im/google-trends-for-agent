import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '../src/dsh.js';
import {
  APIFY_ACTORS_PATH, APIFY_DEPLOY_PATH, APIFY_UPDATE_PATH, APIFY_USAGE_PATH, TEST_CONNECTION_PATH, registerRoutes, scrubSecrets, testConnection,
  type RouteSettings,
} from '../src/dsh-routes.js';
import { resolveApifyApiToken } from '../src/apify-actor.js';
import {
  APIFY_OAUTH_CANCEL_PATH,
  APIFY_OAUTH_LOGOUT_PATH,
  APIFY_OAUTH_START_PATH,
  APIFY_OAUTH_STATUS_PATH,
  GTFA_APIFY_OAUTH_SESSION,
  createApifyOAuthManager,
  type ApifyOAuthManager,
  type OAuthCredentialsService,
} from '../src/apify-oauth.js';
import { GTrendsError } from '../src/core.js';
import { CONNECTION_KEYWORDS, CONNECTION_FILTER } from '../src/connection-check.js';
import type { Transport } from '../src/transport.js';

const TOKEN = 'apify_api_saved_secret';
const ACTOR = 'actor-1';
const LIMITS_URL = 'https://api.apify.com/v2/users/me/limits';
const ME_URL = 'https://api.apify.com/v2/users/me';
const ACTS_URL = 'https://api.apify.com/v2/acts?my=1&limit=1000';
const ALL_ROUTES = [
  APIFY_ACTORS_PATH,
  APIFY_DEPLOY_PATH,
  APIFY_UPDATE_PATH,
  APIFY_OAUTH_STATUS_PATH,
  APIFY_OAUTH_START_PATH,
  APIFY_OAUTH_CANCEL_PATH,
  APIFY_OAUTH_LOGOUT_PATH,
  APIFY_USAGE_PATH,
  TEST_CONNECTION_PATH,
].sort();

interface Route {
  path: string;
  methods: readonly string[];
  requestBody: string;
  fetch: (request: Request) => Promise<Response>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function settings(overrides: Partial<RouteSettings> = {}): RouteSettings {
  return { egress: 'actor-own', apifyToken: TOKEN, apifyActor: ACTOR, ...overrides };
}

function routeHarness(getSettings: () => RouteSettings, overrides: Parameters<typeof registerRoutes>[2] = {}) {
  const routes = new Map<string, Route>();
  let injected: ((scope: unknown) => void) | undefined;
  const connection = {
    fetch: {
      register(route: Route) {
        routes.set(route.path, route);
        return async () => { routes.delete(route.path); };
      },
    },
  };
  const ctx = {
    get: () => undefined,
    inject(names: string[], callback: (scope: unknown) => void) {
      if (names.includes('connection')) injected = callback;
    },
  };
  registerRoutes(ctx as never, getSettings, {
    connectionProbe: async () => ({ ok: true, schemaVersion: 1, status: 'ok', filter: CONNECTION_FILTER,
      meta: { fetchedAt: new Date().toISOString() },
      series: CONNECTION_KEYWORDS.map(keyword => ({ keyword, points: [{ t: '2026-11-16T00:00:00.000Z', value: 50 }] })) }),
    ...overrides,
  });
  const connect = () => injected?.({
    connection,
    get: (name: string) => name === 'connection' ? connection : undefined,
    effect: (callback: () => void | (() => void)) => callback(),
  });
  return { routes, connect };
}

function accountFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url) === LIMITS_URL) {
      return json({
        data: {
          monthlyUsageCycle: { startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-31T23:59:59.999Z' },
          limits: { maxMonthlyUsageUsd: 19, maxMonthlyResidentialProxyGbytes: 5 },
          current: { monthlyUsageUsd: 8.06, monthlyResidentialProxyGbytes: 0.006 },
        },
      });
    }
    if (String(url) === ME_URL) {
      return json({ data: { username: 'private', email: 'private@example.test', proxy: { password: 'proxy-secret' }, plan: { tier: 'BRONZE', monthlyBasePriceUsd: 19, monthlyUsageCreditsUsd: 19 } } });
    }
    throw new Error(`unexpected URL ${String(url)}`);
  });
}

function actorFetch() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target === ACTS_URL) {
      return json({ data: { items: [{ id: ACTOR, name: 'google-trends-for-agent', username: 'alice', title: 'Google Trends for AI Agents' }] } });
    }
    if (target === `https://api.apify.com/v2/acts/${ACTOR}`) {
      return json({
        data: {
          id: ACTOR,
          name: 'google-trends-for-agent',
          username: 'alice',
          title: 'Google Trends for AI Agents',
          standbyUrl: 'https://alice--google-trends-for-agent.apify.actor',
          actorStandby: { isEnabled: true },
          taggedBuilds: { latest: { buildId: 'build-1' } },
        },
      });
    }
    if (target === 'https://api.apify.com/v2/actor-builds/build-1') return json({ data: { status: 'SUCCEEDED' } });
    if (target === `https://api.apify.com/v2/acts/${ACTOR}/builds?desc=1&limit=1`) return json({ data: { items: [{ id: 'build-1', status: 'SUCCEEDED' }] } });
    if (target === `https://api.apify.com/v2/acts/${ACTOR}/builds/default`) return json({ data: { id: 'build-1' } });
    if (target === 'https://api.apify.com/v2/acts' && init?.method === 'POST') return json({ data: { id: 'new-actor' } }, 201);
    if (target === 'https://api.apify.com/v2/acts/new-actor/builds?version=0.1&tag=latest') return json({ data: { id: 'new-build' } }, 201);
    throw new Error(`unexpected URL ${target}`);
  });
}

function oauthCredentials(token?: string): OAuthCredentialsService {
  const values = new Map<string, string>();
  if (token) values.set(GTFA_APIFY_OAUTH_SESSION, JSON.stringify({ access_token: token }));
  return {
    async resolve(ref) {
      const value = values.get(ref);
      return value === undefined ? undefined : { value, source: 'test' };
    },
    async describe(ref) {
      return { configured: values.has(ref), writable: true };
    },
    async set(ref, value) {
      values.set(ref, value);
    },
    async unset(ref) {
      values.delete(ref);
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dsh host routes', () => {
  it('accepts authenticated browser origins through the dsh HTTP bridge while still rejecting cross-site sources', async () => {
    const cancel = vi.fn(async () => ({ available: true, connected: false, pending: false }));
    const oauth = { cancel } as unknown as ApifyOAuthManager;
    const harness = routeHarness(() => settings(), { oauth }); harness.connect();
    const route = harness.routes.get(APIFY_OAUTH_CANCEL_PATH)!;
    for (const [origin, host] of [['http://127.0.0.1:18823', '127.0.0.1:18823'], ['https://harness.example', 'harness.example:443']]) {
      const response = await route.fetch(new Request('http://dsh.internal/api/gtfa.apify-oauth-cancel', {
        method: 'POST', headers: { origin, host, 'sec-fetch-site': 'same-origin' }, body: '{}',
      }));
      expect(response.status).toBe(200);
    }
    expect(cancel).toHaveBeenCalledTimes(2);
    for (const headers of [
      { origin: 'https://evil.test', host: '127.0.0.1:18823' },
      { origin: 'http://127.0.0.1:18824', host: '127.0.0.1:18823' },
      { origin: 'null', host: '127.0.0.1:18823' },
      { origin: 'https://harness.example', host: 'harness.example@evil.test' },
      { origin: 'https://harness.example', host: 'harness.example/path' },
      { origin: 'https://harness.example' },
      { origin: 'http://127.0.0.1:18823', host: '127.0.0.1:18823', 'sec-fetch-site': 'cross-site' },
    ]) {
      expect((await route.fetch(new Request('http://dsh.internal/api/gtfa.apify-oauth-cancel', {
        method: 'POST', headers: headers as Record<string, string>, body: '{}',
      }))).status).toBe(403);
    }
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it('rejects cross-site Actor build mutations before resolving credentials or contacting Apify', async () => {
    const fetchMock = vi.fn();
    const harness = routeHarness(() => settings(), { fetch: fetchMock as typeof fetch });
    harness.connect();
    for (const path of [APIFY_DEPLOY_PATH, APIFY_UPDATE_PATH]) {
      const response = await harness.routes.get(path)!.fetch(new Request(`https://dsh.test${path}`, {
        method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body: '{}',
      }));
      expect(response.status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid update bodies before any billable work', async () => {
    const fetchMock = vi.fn();
    const harness = routeHarness(() => settings(), { fetch: fetchMock as typeof fetch });
    harness.connect();
    for (const body of ['invalid-json', '{"apifyActor":null}', '{"apifyActor":"mine","unexpected":true}']) {
      const response = await harness.routes.get(APIFY_UPDATE_PATH)!.fetch(new Request(`https://dsh.test${APIFY_UPDATE_PATH}`, { method: 'POST', body }));
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('registers all exact routes only after connection is injected', () => {
    const harness = routeHarness(() => settings());
    expect(harness.routes.size).toBe(0);
    harness.connect();
    expect([...harness.routes.keys()].sort()).toEqual([APIFY_ACTORS_PATH, APIFY_DEPLOY_PATH, APIFY_UPDATE_PATH, APIFY_USAGE_PATH, TEST_CONNECTION_PATH]);
    expect(harness.routes.get(APIFY_USAGE_PATH)!.methods).toEqual(['GET']);
    expect(harness.routes.get(APIFY_ACTORS_PATH)!.methods).toEqual(['GET']);
    expect(harness.routes.get(APIFY_DEPLOY_PATH)!.methods).toEqual(['POST']);
    expect(harness.routes.get(TEST_CONNECTION_PATH)!.methods).toEqual(['POST']);
  });

  it('keeps the plugin working without a connection service and attaches routes when present', async () => {
    const harness = routeHarness(() => settings());
    let connectionCallback: ((scope: unknown) => void) | undefined;
    const tools = new Map<string, unknown>();
    const ctx = {
      tools: { register: (definition: { name: string }) => { tools.set(definition.name, definition); } },
      inject(names: string[], callback: (scope: unknown) => void) {
        if (names.includes('connection')) connectionCallback = callback;
      },
    };
    await register(ctx as never, { egress: 'local', chartDir: null }, { minIntervalMs: 0 });
    expect(tools.size).toBe(4);
    expect(harness.routes.size).toBe(0);
    expect(connectionCallback).toBeTypeOf('function');

    connectionCallback!({
      connection: { fetch: { register: (route: Route) => { harness.routes.set(route.path, route); return async () => {}; } } },
      get: (name: string) => name === 'connection' ? { fetch: { register: (route: Route) => { harness.routes.set(route.path, route); return async () => {}; } } } : undefined,
      effect: (callback: () => unknown) => callback(),
    });
    expect([...harness.routes.keys()].sort()).toEqual([...ALL_ROUTES, '/api/gtfa.dashboard'].sort());
  });

  it('registers OAuth status and POST-only lifecycle routes when a manager is mounted', async () => {
    const oauth = createApifyOAuthManager({
      credentials: oauthCredentials('route-oauth-token'),
      fetch: (async () => json({})) as unknown as typeof fetch,
    });
    const harness = routeHarness(() => settings(), { oauth });
    harness.connect();
    expect([...harness.routes.keys()].sort()).toEqual(ALL_ROUTES);
    expect(harness.routes.get(APIFY_OAUTH_STATUS_PATH)!.methods).toEqual(['GET']);
    for (const path of [APIFY_OAUTH_START_PATH, APIFY_OAUTH_CANCEL_PATH, APIFY_OAUTH_LOGOUT_PATH]) {
      expect(harness.routes.get(path)!.methods).toEqual(['POST']);
    }

    const status = await harness.routes.get(APIFY_OAUTH_STATUS_PATH)!
      .fetch(new Request(`https://dsh.test${APIFY_OAUTH_STATUS_PATH}`));
    expect(await status.json()).toEqual({ available: true, connected: true, pending: false });
  });

  it('rejects cross-site OAuth lifecycle POSTs without invoking the provider', async () => {
    const fetchMock = vi.fn(async () => json({}));
    const oauth = createApifyOAuthManager({
      credentials: oauthCredentials(),
      fetch: fetchMock as unknown as typeof fetch,
    });
    const harness = routeHarness(() => settings(), { oauth });
    harness.connect();
    const response = await harness.routes.get(APIFY_OAUTH_START_PATH)!.fetch(new Request(
      `https://dsh.test${APIFY_OAUTH_START_PATH}`,
      { method: 'POST', headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } },
    ));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'cross-site request rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses one OAuth token for usage and connection routes ahead of config', async () => {
    const oauthToken = 'oauth-account-token';
    const oauth = createApifyOAuthManager({
      credentials: oauthCredentials(oauthToken),
      fetch: (async () => json({})) as unknown as typeof fetch,
    });
    const fetchMock = accountFetch();
    const harness = routeHarness(() => settings(), {
      fetch: fetchMock as unknown as typeof fetch,
      oauth,
    });
    harness.connect();

    const usage = await harness.routes.get(APIFY_USAGE_PATH)!
      .fetch(new Request(`https://dsh.test${APIFY_USAGE_PATH}?refresh=1`));
    expect(await usage.json()).toMatchObject({ ok: true, source: 'oauth' });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers)
      .toMatchObject({ authorization: `Bearer ${oauthToken}` });

    let seenToken: string | undefined;
    const relay = routeHarness(() => settings(), {
      oauth,
      relayTransport: (token, actorId) => {
        seenToken = token;
        return (async () => ({ status: 200, headers: {}, body: '<html></html>' })) as Transport;
      },
    });
    relay.connect();
    const connection = await relay.routes.get(TEST_CONNECTION_PATH)!
      .fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }));
    expect(await connection.json()).toMatchObject({ ok: true, egress: 'actor-own' });
    expect(seenToken).toBe(oauthToken);
  });

  it('serves saved-token usage with no account identity or token in the response', async () => {
    const fetchMock = accountFetch();
    const harness = routeHarness(() => settings(), { fetch: fetchMock as unknown as typeof fetch });
    harness.connect();
    const response = await harness.routes.get(APIFY_USAGE_PATH)!.fetch(new Request(`https://dsh.test${APIFY_USAGE_PATH}?refresh=1`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      source: 'config',
      usageUsd: 8.06,
      limitUsd: 19,
      plan: { tier: 'BRONZE', monthlyBasePriceUsd: 19, monthlyUsageCreditsUsd: 19 },
      residentialGb: 0.006,
      residentialGbLimit: 5,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('proxy-secret');
    expect(serialized).not.toContain('private@example.test');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses APIFY_TOKEN only when the saved token is empty', async () => {
    vi.stubEnv('APIFY_TOKEN', 'env-token');
    const fetchMock = accountFetch();
    const harness = routeHarness(() => settings({ apifyToken: undefined }), { fetch: fetchMock as unknown as typeof fetch });
    harness.connect();
    const response = await harness.routes.get(APIFY_USAGE_PATH)!.fetch(new Request(`https://dsh.test${APIFY_USAGE_PATH}`));
    expect(await response.json()).toMatchObject({ ok: true, source: 'env' });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer env-token' });
  });

  it('returns no-token without calling Apify', async () => {
    vi.stubEnv('APIFY_TOKEN', '');
    const fetchMock = accountFetch();
    const harness = routeHarness(() => settings({ apifyToken: undefined }), { fetch: fetchMock as unknown as typeof fetch });
    harness.connect();
    const response = await harness.routes.get(APIFY_USAGE_PATH)!.fetch(new Request(`https://dsh.test${APIFY_USAGE_PATH}`));
    expect(await response.json()).toEqual({
      ok: false,
      code: 'no-token',
      message: 'Sign in with Apify in Plugins → Google Trends, or use the advanced manual token or APIFY_TOKEN, to see usage.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists this package\'s Actors and maps token failures', async () => {
    const fetchMock = actorFetch();
    const harness = routeHarness(() => settings(), { fetch: fetchMock as unknown as typeof fetch });
    harness.connect();
    const response = await harness.routes.get(APIFY_ACTORS_PATH)!.fetch(new Request(`https://dsh.test${APIFY_ACTORS_PATH}?refresh=1`));
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      actors: [{
        id: ACTOR,
        name: 'google-trends-for-agent',
        username: 'alice',
        title: 'Google Trends for AI Agents',
        standbyUrl: null,
        standbyEnabled: false,
        lastBuildId: 'build-1',
        lastBuildStatus: 'SUCCEEDED',
      }],
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === `https://api.apify.com/v2/acts/${ACTOR}`)).toBe(false);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });

    vi.stubEnv('APIFY_TOKEN', '');
    const noToken = routeHarness(() => settings({ apifyToken: undefined }));
    noToken.connect();
    expect(await (await noToken.routes.get(APIFY_ACTORS_PATH)!.fetch(new Request(`https://dsh.test${APIFY_ACTORS_PATH}`))).json())
      .toMatchObject({
        ok: false,
        code: 'no-token',
        message: 'Sign in with Apify in Plugins → Google Trends, or use the advanced manual token or APIFY_TOKEN, to list your Actors.',
      });

    const invalid = routeHarness(() => settings(), { fetch: (async () => json({}, 401)) as unknown as typeof fetch });
    invalid.connect();
    expect(await (await invalid.routes.get(APIFY_ACTORS_PATH)!.fetch(new Request(`https://dsh.test${APIFY_ACTORS_PATH}`))).json())
      .toMatchObject({ ok: false, code: 'invalid-token' });
  });

  it('deploys through the route and allows only one deploy at a time', async () => {
    const fetchMock = actorFetch();
    const harness = routeHarness(() => settings(), { fetch: fetchMock as unknown as typeof fetch });
    harness.connect();
    const response = await harness.routes.get(APIFY_DEPLOY_PATH)!.fetch(new Request(`https://dsh.test${APIFY_DEPLOY_PATH}`, { method: 'POST' }));
    expect(await response.json()).toEqual({ ok: true, actorId: 'new-actor', buildId: 'new-build' });

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let deploys = 0;
    const slow = routeHarness(() => settings(), {
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === 'https://api.apify.com/v2/acts' && init?.method === 'POST') {
          deploys += 1;
          await gate;
          return json({ data: { id: 'slow-actor' } }, 201);
        }
        return json({ data: { id: 'slow-build' } }, 201);
      }) as unknown as typeof fetch,
    });
    slow.connect();
    const route = slow.routes.get(APIFY_DEPLOY_PATH)!;
    const first = route.fetch(new Request(`https://dsh.test${APIFY_DEPLOY_PATH}`, { method: 'POST' }));
    const second = await route.fetch(new Request(`https://dsh.test${APIFY_DEPLOY_PATH}`, { method: 'POST' }));
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ ok: false, code: 'busy' });
    release();
    expect(await (await first).json()).toMatchObject({ ok: true, actorId: 'slow-actor' });
    expect(deploys).toBe(1);
  });

  it('claims the deploy slot before a deferred OAuth resolve and resets it on no-token', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const resolveToken = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await gate;
        return { token: 'oauth-deploy-token', source: 'oauth' as const };
      }
      if (calls === 2) return {};
      if (calls === 3) throw new Error('OAuth resolver unavailable');
      return { token: 'oauth-deploy-token', source: 'oauth' as const };
    });
    const fetchMock = actorFetch();
    const harness = routeHarness(() => settings(), {
      fetch: fetchMock as unknown as typeof fetch,
      oauth: { resolveToken } as unknown as ApifyOAuthManager,
    });
    harness.connect();
    const route = harness.routes.get(APIFY_DEPLOY_PATH)!;

    const first = route.fetch(new Request(`https://dsh.test${APIFY_DEPLOY_PATH}`, { method: 'POST' }));
    const second = await route.fetch(new Request(`https://dsh.test${APIFY_DEPLOY_PATH}`, { method: 'POST' }));
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ ok: false, code: 'busy' });
    expect(resolveToken).toHaveBeenCalledTimes(1);

    release();
    expect(await (await first).json()).toEqual({ ok: true, actorId: 'new-actor', buildId: 'new-build' });

    const noToken = await route.fetch(new Request(`https://dsh.test${APIFY_DEPLOY_PATH}`, { method: 'POST' }));
    expect(await noToken.json()).toMatchObject({
      ok: false,
      code: 'no-token',
      message: 'Sign in with Apify in Plugins → Google Trends, or use the advanced manual token or APIFY_TOKEN, to deploy the Actor.',
    });
    expect(resolveToken).toHaveBeenCalledTimes(2);

    await expect(route.fetch(new Request(`https://dsh.test${APIFY_DEPLOY_PATH}`, { method: 'POST' })))
      .rejects.toThrow('OAuth resolver unavailable');
    expect(resolveToken).toHaveBeenCalledTimes(3);

    const recovered = await route.fetch(new Request(`https://dsh.test${APIFY_DEPLOY_PATH}`, { method: 'POST' }));
    expect(await recovered.json()).toEqual({ ok: true, actorId: 'new-actor', buildId: 'new-build' });
    expect(resolveToken).toHaveBeenCalledTimes(4);
    const deployments = fetchMock.mock.calls.filter(([url, init]) =>
      String(url) === 'https://api.apify.com/v2/acts' && (init as RequestInit | undefined)?.method === 'POST');
    expect(deployments).toHaveLength(2);
  });

  it('runs a local preflight before the keyword probe', async () => {
    const transport = vi.fn(async () => ({ status: 200, headers: {}, body: '' }));
    const harness = routeHarness(() => settings({ egress: 'local' }), { localTransport: transport as Transport, now: () => 1_000 });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }));
    expect(await response.json()).toMatchObject({ ok: true, egress: 'local', status: 200, latencyMs: 0 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0]).toMatchObject({ url: 'https://trends.google.com/trends/', method: 'HEAD' });
  });

  it('checks the draft local route without changing the saved Actor route', async () => {
    const saved = Object.freeze(settings());
    const localTransport = vi.fn(async () => ({ status: 200, headers: {}, body: '' }));
    const relayTransport = vi.fn();
    const harness = routeHarness(() => saved, { localTransport, relayTransport });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, {
      method: 'POST', body: JSON.stringify({ egress: 'local' }),
    }));
    expect(await response.json()).toMatchObject({ ok: true, egress: 'local', settingsSource: 'draft' });
    expect(localTransport).toHaveBeenCalledTimes(1);
    expect(relayTransport).not.toHaveBeenCalled();
    expect(saved).toEqual(settings());
  });

  it('checks a draft Actor selection and token only for this request', async () => {
    const saved = Object.freeze(settings({ egress: 'local' }));
    const target = vi.fn(async () => ({ status: 200, headers: {}, body: '' }));
    const relayTransport = vi.fn(() => target);
    const harness = routeHarness(() => saved, { relayTransport, localTransport: async () => ({ status: 200, headers: {}, body: '' }) });
    harness.connect();
    const route = harness.routes.get(TEST_CONNECTION_PATH)!;
    const response = await route.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, {
      method: 'POST', body: JSON.stringify({ egress: 'actor-own', apifyActor: 'draft-actor', apifyToken: 'apify_api_draft' }),
    }));
    const result = await response.json();
    expect(result).toMatchObject({ ok: true, egress: 'actor-own', actorId: 'draft-actor', settingsSource: 'draft' });
    expect(JSON.stringify(result)).not.toContain('apify_api_draft');
    expect(relayTransport).toHaveBeenCalledWith('apify_api_draft', 'draft-actor');
    expect(saved).toEqual(settings({ egress: 'local' }));
    // A later request with no overrides must still use the saved configuration.
    expect(await (await route.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }))).json())
      .toMatchObject({ ok: true, egress: 'local', settingsSource: 'saved' });
  });

  it('uses a Host-only stored token when only the route and Actor are edited', async () => {
    const relayTransport = vi.fn(() => async () => ({ status: 200, headers: {}, body: '' }));
    const harness = routeHarness(() => settings({ egress: 'local' }), { relayTransport });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, {
      method: 'POST', body: JSON.stringify({ egress: 'actor-own', apifyActor: 'new-actor' }),
    }));
    expect(await response.json()).toMatchObject({ ok: true, actorId: 'new-actor' });
    expect(relayTransport).toHaveBeenCalledWith(TOKEN, 'new-actor');
  });

  it('tests clearing a manual token without falling back to its saved value', async () => {
    vi.stubEnv('APIFY_TOKEN', '');
    const relayTransport = vi.fn();
    const harness = routeHarness(() => settings(), { relayTransport });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, {
      method: 'POST', body: JSON.stringify({ egress: 'actor-own', apifyToken: '' }),
    }));
    expect(await response.json()).toMatchObject({ ok: false, code: 'no-token', settingsSource: 'draft' });
    expect(relayTransport).not.toHaveBeenCalled();
  });

  it('keeps OAuth priority over a draft manual token and scrubs OAuth errors', async () => {
    const oauthToken = 'oauth-host-only-secret';
    const resolveToken = vi.fn(async () => ({ token: oauthToken, source: 'oauth' as const }));
    const relayTransport = vi.fn(() => async () => { throw new Error(`failed with ${oauthToken}`); });
    const harness = routeHarness(() => settings(), { oauth: { resolveToken } as unknown as ApifyOAuthManager, relayTransport });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, {
      method: 'POST', body: JSON.stringify({ egress: 'actor-own', apifyToken: 'draft-manual-token' }),
    }));
    const result = await response.json();
    expect(resolveToken).toHaveBeenCalledWith('draft-manual-token');
    expect(relayTransport).toHaveBeenCalledWith(oauthToken, ACTOR);
    expect(result).toMatchObject({ ok: false, settingsSource: 'draft' });
    expect(JSON.stringify(result)).not.toContain(oauthToken);
    expect(JSON.stringify(result)).not.toContain('draft-manual-token');
  });

  it.each([
    ['invalid JSON', 'invalid-json'], ['null', 'null'], ['array', '[]'],
    ['non-string egress', JSON.stringify({ egress: ['local'] })],
    ['unknown egress', JSON.stringify({ egress: 'invalid' })],
    ['non-string token', JSON.stringify({ apifyToken: {} })],
    ['control characters', JSON.stringify({ apifyActor: 'actor\ninvalid' })],
    ['oversized Actor', JSON.stringify({ apifyActor: 'a'.repeat(257) })],
    ['oversized token', JSON.stringify({ apifyToken: 't'.repeat(4097) })],
    ['unknown key', JSON.stringify({ egress: 'local', arbitraryUrl: 'https://example.test' })],
  ])('rejects %s before any upstream work', async (_label, body) => {
    const localTransport = vi.fn(); const relayTransport = vi.fn(); const fetch = vi.fn();
    const harness = routeHarness(() => settings(), { localTransport, relayTransport, fetch });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST', body }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid connection test settings.' });
    expect(localTransport).not.toHaveBeenCalled();
    expect(relayTransport).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tests actor-own egress with exactly one relay call through the saved Actor', async () => {
    const target = vi.fn(async () => ({ status: 200, headers: {}, body: '<html></html>' }));
    let seen: { token: string; actorId: string } | undefined;
    const harness = routeHarness(() => settings(), {
      relayTransport: (token, actorId) => {
        seen = { token, actorId };
        return target as Transport;
      },
      now: () => 1_000,
    });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }));
    expect(await response.json()).toMatchObject({
      ok: true, egress: 'actor-own', status: 200, latencyMs: 0, actorId: ACTOR,
    });
    expect(seen).toEqual({ token: TOKEN, actorId: ACTOR });
    expect(target).toHaveBeenCalledTimes(1);
    expect(target.mock.calls[0]![0]).toMatchObject({ url: 'https://trends.google.com/trends/', method: 'HEAD' });
  });

  it('uses the public Actor id for actor-public and needs no Actor select', async () => {
    const target = vi.fn(async () => ({ status: 200, headers: {}, body: '<html></html>' }));
    let seen: { token: string; actorId: string } | undefined;
    const harness = routeHarness(() => settings({ egress: 'actor-public', apifyActor: undefined }), {
      relayTransport: (token, actorId) => {
        seen = { token, actorId };
        return target as Transport;
      },
      now: () => 1_000,
    });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }));
    expect(await response.json()).toMatchObject({
      ok: true, egress: 'actor-public', status: 200, latencyMs: 0, actorId: 'meka.im~google-trends-for-agent',
    });
    expect(seen).toEqual({ token: TOKEN, actorId: 'meka.im~google-trends-for-agent' });
    expect(target).toHaveBeenCalledTimes(1);
  });

  it('maps relay version mismatches to version-mismatch', async () => {
    const target = Object.assign(
      async () => ({ status: 200, headers: {}, body: '' }),
      { checkHealth: async () => { throw new GTrendsError('INVALID_INPUT', 'This Actor build speaks relay v2; this plugin needs v1. Update the plugin or rebuild the Actor.'); } },
    );
    const result = await testConnection({
      egress: 'actor-own', apifyToken: TOKEN, apifyActor: ACTOR,
      relayTransport: () => target as unknown as Transport,
    });
    expect(result).toMatchObject({
      ok: false,
      egress: 'actor-own',
      code: 'version-mismatch',
      message: expect.stringMatching(/speaks relay v2; this plugin needs v1/),
      actorId: ACTOR,
    });
  });

  it('maps Actor test-connection codes: no-token, no-actor, invalid-token, network, http', async () => {
    vi.stubEnv('APIFY_TOKEN', '');
    expect(await testConnection({ egress: 'actor-own', apifyToken: '' })).toMatchObject({
      ok: false,
      code: 'no-token',
      message: 'Sign in with Apify in Plugins → Google Trends, or use the advanced manual token or APIFY_TOKEN, to use an Actor egress.',
    });

    expect(await testConnection({ egress: 'actor-own', apifyToken: TOKEN })).toMatchObject({ ok: false, code: 'no-actor' });

    const invalid = await testConnection({
      egress: 'actor-own', apifyToken: TOKEN, apifyActor: ACTOR,
      relayTransport: () => (async () => { throw new GTrendsError('INVALID_INPUT', 'Apify rejected the token (HTTP 401).'); }) as Transport,
    });
    expect(invalid).toMatchObject({ ok: false, code: 'invalid-token', actorId: ACTOR });

    const noActor = await testConnection({
      egress: 'actor-own', apifyToken: TOKEN, apifyActor: ACTOR,
      relayTransport: () => (async () => { throw new GTrendsError('INVALID_INPUT', 'Select or deploy your google-trends-for-agent Actor.'); }) as Transport,
    });
    expect(noActor).toMatchObject({ ok: false, code: 'no-actor', actorId: ACTOR });

    const network = await testConnection({
      egress: 'actor-own', apifyToken: TOKEN, apifyActor: ACTOR,
      relayTransport: () => (async () => { throw new Error('fetch failed'); }) as Transport,
    });
    expect(network).toMatchObject({ ok: false, code: 'network', actorId: ACTOR });

    const http = await testConnection({
      egress: 'actor-own', apifyToken: TOKEN, apifyActor: ACTOR,
      relayTransport: () => (async () => ({ status: 503, headers: {}, body: '' })) as Transport,
    });
    expect(http).toMatchObject({ ok: false, code: 'http', status: 503, actorId: ACTOR });
  });

  it('names the network cause hidden behind "fetch failed"', async () => {
    const failing = (async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }) as unknown as Transport;
    const result = await testConnection({ egress: 'local', localTransport: failing });
    expect(result).toMatchObject({ ok: false, code: 'network', message: 'fetch failed: ECONNREFUSED' });
    const tunnel = (async () => { throw new TypeError('fetch failed', { cause: { code: 0, message: 'Request was cancelled.', cause: { message: 'Proxy response (403) !== 200 when HTTP Tunneling' } } }); }) as unknown as Transport;
    expect((await testConnection({ egress: 'local', localTransport: tunnel })).message).toBe('fetch failed: Proxy response (403) !== 200 when HTTP Tunneling');
  });

  it('rejects a second test while one is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const transport = vi.fn(async () => { await gate; return { status: 200, headers: {}, body: '' }; });
    const harness = routeHarness(() => settings({ egress: 'local' }), { localTransport: transport as Transport });
    harness.connect();
    const route = harness.routes.get(TEST_CONNECTION_PATH)!;
    const first = route.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }));
    const second = await route.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }));
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ ok: false, code: 'busy' });
    release();
    expect(await (await first).json()).toMatchObject({ ok: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-site and non-POST diagnostic requests before any paid or Google work', async () => {
    const transport = vi.fn(async () => ({ status: 200, headers: {}, body: '' }));
    const probe = vi.fn(async () => ({}));
    const harness = routeHarness(() => settings({ egress: 'local' }), { localTransport: transport, connectionProbe: probe });
    harness.connect();
    const route = harness.routes.get(TEST_CONNECTION_PATH)!;
    for (const init of [
      { method: 'GET' },
      { method: 'POST', headers: { origin: 'https://attacker.test' } },
      { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } },
    ]) {
      const response = await route.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, init));
      expect(response.status).toBe(init.method === 'GET' ? 405 : 403);
    }
    expect(transport).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it('resolves the API token from the saved value or APIFY_TOKEN', () => {
    vi.stubEnv('APIFY_TOKEN', '');
    expect(resolveApifyApiToken('config-token')).toEqual({ token: 'config-token', source: 'config' });
    expect(resolveApifyApiToken(undefined)).toEqual({});
  });

  it('scrubs proxy credentials and token text from messages', () => {
    const scrubbed = scrubSecrets(`failed http://user:secret@proxy.test:8000 and ${TOKEN}`, TOKEN);
    expect(scrubbed).not.toContain('user:secret');
    expect(scrubbed).not.toContain(TOKEN);
    expect(scrubbed).toContain('http://***@proxy.test:8000');
  });

  it('maps local transport failures to test-connection codes', async () => {
    const local = await testConnection({
      egress: 'local',
      localTransport: async () => { throw new Error('proxy http://user:secret@proxy.test:8000 refused'); },
    });
    expect(local).toMatchObject({ ok: false, egress: 'local', code: 'network' });
    expect(JSON.stringify(local)).not.toContain('user:secret');
  });
});
