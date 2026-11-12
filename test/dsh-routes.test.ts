import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '../src/dsh.js';
import {
  APIFY_ACTORS_PATH, APIFY_DEPLOY_PATH, APIFY_USAGE_PATH, TEST_CONNECTION_PATH, registerRoutes, scrubSecrets, testConnection,
  type RouteSettings,
} from '../src/dsh-routes.js';
import { resolveApifyApiToken } from '../src/apify-actor.js';
import { GTrendsError } from '../src/core.js';
import type { Transport } from '../src/transport.js';

const TOKEN = 'apify_api_saved_secret';
const ACTOR = 'actor-1';
const LIMITS_URL = 'https://api.apify.com/v2/users/me/limits';
const ME_URL = 'https://api.apify.com/v2/users/me';
const ACTS_URL = 'https://api.apify.com/v2/acts?my=1&limit=1000';

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
  return { egress: 'apify', apifyToken: TOKEN, apifyActor: ACTOR, ...overrides };
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
  registerRoutes(ctx as never, getSettings, overrides);
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
      return json({ data: { items: [{ id: ACTOR, name: 'google-trends-for-agent', username: 'alice' }] } });
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
    if (target === 'https://api.apify.com/v2/acts' && init?.method === 'POST') return json({ data: { id: 'new-actor' } }, 201);
    if (target === 'https://api.apify.com/v2/acts/new-actor/builds?version=0.1&tag=latest') return json({ data: { id: 'new-build' } }, 201);
    throw new Error(`unexpected URL ${target}`);
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dsh host routes', () => {
  it('registers all exact routes only after connection is injected', () => {
    const harness = routeHarness(() => settings());
    expect(harness.routes.size).toBe(0);
    harness.connect();
    expect([...harness.routes.keys()].sort()).toEqual([APIFY_ACTORS_PATH, APIFY_DEPLOY_PATH, APIFY_USAGE_PATH, TEST_CONNECTION_PATH]);
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
    expect([...harness.routes.keys()].sort()).toEqual([APIFY_ACTORS_PATH, APIFY_DEPLOY_PATH, APIFY_USAGE_PATH, TEST_CONNECTION_PATH]);
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
    expect(await response.json()).toEqual(expect.objectContaining({ ok: false, code: 'no-token' }));
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
        standbyUrl: 'https://alice--google-trends-for-agent.apify.actor',
        standbyEnabled: true,
        lastBuildStatus: 'SUCCEEDED',
      }],
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });

    vi.stubEnv('APIFY_TOKEN', '');
    const noToken = routeHarness(() => settings({ apifyToken: undefined }));
    noToken.connect();
    expect(await (await noToken.routes.get(APIFY_ACTORS_PATH)!.fetch(new Request(`https://dsh.test${APIFY_ACTORS_PATH}`))).json())
      .toMatchObject({ ok: false, code: 'no-token' });

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

  it('tests local egress with exactly one request', async () => {
    const transport = vi.fn(async () => ({ status: 200, headers: {}, body: '' }));
    const harness = routeHarness(() => settings({ egress: 'local' }), { localTransport: transport as Transport, now: () => 1_000 });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }));
    expect(await response.json()).toMatchObject({ ok: true, egress: 'local', status: 200, latencyMs: 0 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0]).toMatchObject({ url: 'https://trends.google.com/trends/', method: 'GET' });
  });

  it('tests apify egress with exactly one relay call through the saved Actor', async () => {
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
    expect(await response.json()).toEqual({
      ok: true, egress: 'apify', status: 200, latencyMs: 0, actorId: ACTOR,
    });
    expect(seen).toEqual({ token: TOKEN, actorId: ACTOR });
    expect(target).toHaveBeenCalledTimes(1);
    expect(target.mock.calls[0]![0]).toMatchObject({ url: 'https://trends.google.com/trends/', method: 'GET' });
  });

  it('maps apify test-connection codes: no-token, no-actor, invalid-token, network, http', async () => {
    vi.stubEnv('APIFY_TOKEN', '');
    expect(await testConnection({ egress: 'apify', apifyToken: '' })).toMatchObject({ ok: false, code: 'no-token' });

    expect(await testConnection({ egress: 'apify', apifyToken: TOKEN })).toMatchObject({ ok: false, code: 'no-actor' });

    const invalid = await testConnection({
      egress: 'apify', apifyToken: TOKEN, apifyActor: ACTOR,
      relayTransport: () => (async () => { throw new GTrendsError('INVALID_INPUT', 'Apify rejected the token (HTTP 401).'); }) as Transport,
    });
    expect(invalid).toMatchObject({ ok: false, code: 'invalid-token', actorId: ACTOR });

    const noActor = await testConnection({
      egress: 'apify', apifyToken: TOKEN, apifyActor: ACTOR,
      relayTransport: () => (async () => { throw new GTrendsError('INVALID_INPUT', 'Select or deploy your google-trends-for-agent Actor.'); }) as Transport,
    });
    expect(noActor).toMatchObject({ ok: false, code: 'no-actor', actorId: ACTOR });

    const network = await testConnection({
      egress: 'apify', apifyToken: TOKEN, apifyActor: ACTOR,
      relayTransport: () => (async () => { throw new Error('fetch failed'); }) as Transport,
    });
    expect(network).toMatchObject({ ok: false, code: 'network', actorId: ACTOR });

    const http = await testConnection({
      egress: 'apify', apifyToken: TOKEN, apifyActor: ACTOR,
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
