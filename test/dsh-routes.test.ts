import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '../src/dsh.js';
import {
  APIFY_USAGE_PATH, TEST_CONNECTION_PATH, registerRoutes, resolveApifyApiToken, scrubSecrets, testConnection,
  type RouteSettings,
} from '../src/dsh-routes.js';
import type { Transport } from '../src/transport.js';

const TOKEN = 'apify_api_saved_secret';
const LIMITS_URL = 'https://api.apify.com/v2/users/me/limits';
const ME_URL = 'https://api.apify.com/v2/users/me';

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
  return { egress: 'apify', apifyToken: TOKEN, apifyProxyGroup: 'RESIDENTIAL', apifyProxyCountry: 'US', ...overrides };
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dsh host routes', () => {
  it('registers both exact routes only after connection is injected', () => {
    const harness = routeHarness(() => settings());
    expect(harness.routes.size).toBe(0);
    harness.connect();
    expect([...harness.routes.keys()].sort()).toEqual([APIFY_USAGE_PATH, TEST_CONNECTION_PATH]);
    expect(harness.routes.get(APIFY_USAGE_PATH)!.methods).toEqual(['GET']);
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
    expect([...harness.routes.keys()].sort()).toEqual([APIFY_USAGE_PATH, TEST_CONNECTION_PATH]);
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

  it('tests local egress with exactly one request', async () => {
    const transport = vi.fn(async () => ({ status: 200, headers: {}, body: '' }));
    const harness = routeHarness(() => settings({ egress: 'local' }), { localTransport: transport as Transport, now: () => 1_000 });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }));
    expect(await response.json()).toMatchObject({ ok: true, egress: 'local', status: 200, latencyMs: 0 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0]).toMatchObject({ url: 'https://trends.google.com/trends/', method: 'GET' });
  });

  it('tests Apify egress through the saved proxy settings and returns proxy metadata', async () => {
    const proxyFetch = vi.fn(async () => json({ data: { proxy: { password: 'proxy-secret' } } }));
    let proxyUrl = '';
    const target = vi.fn(async () => ({ status: 200, headers: {}, body: JSON.stringify({ clientIp: '1.2.3.4', countryCode: 'US' }) }));
    const harness = routeHarness(() => settings({ apifyProxyGroup: 'RESIDENTIAL', apifyProxyCountry: 'GB' }), {
      egress: {
        fetch: proxyFetch as unknown as typeof fetch,
        createTransport: url => { proxyUrl = url; return target as Transport; },
      },
    });
    harness.connect();
    const response = await harness.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }));
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, egress: 'apify', status: 200, ip: '1.2.3.4', country: 'US' });
    expect(target).toHaveBeenCalledTimes(1);
    expect(target.mock.calls[0]![0]).toMatchObject({ url: 'http://api.apify.com/v2/browser-info' });
    expect(proxyUrl).toContain('groups-RESIDENTIAL');
    expect(proxyUrl).toContain('country-GB');
    expect(JSON.stringify(body)).not.toContain('proxy-secret');
  });

  it('maps proxy 407 to proxy-auth and scrubs proxy credentials from failures', async () => {
    const proxyFetch = vi.fn(async () => json({ data: { proxy: { password: 'proxy-secret' } } }));
    const rejected = routeHarness(() => settings(), {
      egress: {
        fetch: proxyFetch as unknown as typeof fetch,
        createTransport: () => (async () => ({ status: 407, headers: {}, body: '' })) as Transport,
      },
    });
    rejected.connect();
    const rejectedBody = await (await rejected.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }))).json();
    expect(rejectedBody).toMatchObject({ ok: false, egress: 'apify', code: 'proxy-auth', status: 407 });

    const failed = routeHarness(() => settings(), {
      egress: {
        fetch: proxyFetch as unknown as typeof fetch,
        createTransport: () => (async () => { throw new Error('connect ECONNREFUSED http://groups-RESIDENTIAL:proxy-secret@proxy.apify.com:8000'); }) as Transport,
      },
    });
    failed.connect();
    const failedBody = await (await failed.routes.get(TEST_CONNECTION_PATH)!.fetch(new Request(`https://dsh.test${TEST_CONNECTION_PATH}`, { method: 'POST' }))).json() as Record<string, unknown>;
    expect(failedBody).toMatchObject({ ok: false, egress: 'apify', code: 'network' });
    const serialized = JSON.stringify(failedBody);
    expect(serialized).not.toContain('proxy-secret');
    expect(serialized).not.toContain('groups-RESIDENTIAL:proxy-secret');
    expect(serialized).toContain('http://***@');
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

  it('resolves the API token without using APIFY_PROXY_PASSWORD', () => {
    vi.stubEnv('APIFY_TOKEN', '');
    vi.stubEnv('APIFY_PROXY_PASSWORD', 'proxy-password');
    expect(resolveApifyApiToken('config-token')).toEqual({ token: 'config-token', source: 'config' });
    expect(resolveApifyApiToken(undefined)).toEqual({});
  });

  it('scrubs proxy credentials and token text from messages', () => {
    const scrubbed = scrubSecrets(`failed http://user:secret@proxy.test:8000 and ${TOKEN}`, TOKEN);
    expect(scrubbed).not.toContain('user:secret');
    expect(scrubbed).not.toContain(TOKEN);
    expect(scrubbed).toContain('http://***@proxy.test:8000');
  });

  it('maps local and Apify transport failures to test-connection codes', async () => {
    const local = await testConnection({
      egress: 'local',
      localTransport: async () => { throw new Error('proxy http://user:secret@proxy.test:8000 refused'); },
    });
    expect(local).toMatchObject({ ok: false, egress: 'local', code: 'network' });
    expect(JSON.stringify(local)).not.toContain('user:secret');

    const noToken = await testConnection({ egress: 'apify', apifyToken: '' });
    expect(noToken).toMatchObject({ ok: false, egress: 'apify', code: 'no-token' });
  });
});
