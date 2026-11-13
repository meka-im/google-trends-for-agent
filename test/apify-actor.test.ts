import { describe, expect, it, vi } from 'vitest';
import {
  ApifyActorClient,
  createActorRelayTransport,
  resolveApifyApiToken,
} from '../src/apify-actor.js';
import { GTrendsError } from '../src/core.js';

const API = 'https://api.apify.com/v2';
const ACTS_URL = `${API}/acts?my=1&limit=1000`;
const TOKEN = 'apify_api_super_secret';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function actorDetail(id: string, name: string, buildId: string | null, standbyUrl: string | null = `https://alice--${name}.apify.actor`) {
  return json({
    data: {
      id,
      name,
      username: 'alice',
      title: name === 'google-trends-for-agent' ? 'Google Trends for AI Agents' : 'Dev copy',
      standbyUrl,
      actorStandby: { isEnabled: Boolean(standbyUrl) },
      taggedBuilds: buildId ? { latest: { buildId } } : {},
    },
  });
}

describe('Apify Actor client', () => {
  it('lists only this package\'s Actors with standby URL and latest build status', async () => {
    let now = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target === ACTS_URL) {
        return json({ data: { items: [
          { id: 'a1', name: 'google-trends-for-agent', username: 'alice' },
          { id: 'a2', name: 'google-trends-for-agent-dev', username: 'alice' },
          { id: 'other', name: 'not-this-package', username: 'alice' },
        ] } });
      }
      if (target === `${API}/acts/a1`) return actorDetail('a1', 'google-trends-for-agent', 'b1');
      if (target === `${API}/acts/a2`) return actorDetail('a2', 'google-trends-for-agent-dev', 'b2');
      if (target === `${API}/actor-builds/b1`) return json({ data: { status: 'SUCCEEDED' } });
      if (target === `${API}/actor-builds/b2`) return json({ data: { status: 'RUNNING' } });
      throw new Error(`unexpected ${target}`);
    });
    const client = new ApifyActorClient({ fetch: fetchMock as unknown as typeof fetch, now: () => now });

    const result = await client.listMyActors(TOKEN);
    expect(result).toEqual({
      ok: true,
      actors: [
        {
          id: 'a1',
          name: 'google-trends-for-agent',
          username: 'alice',
          title: 'Google Trends for AI Agents',
          standbyUrl: 'https://alice--google-trends-for-agent.apify.actor',
          standbyEnabled: true,
          lastBuildId: 'b1',
          lastBuildStatus: 'SUCCEEDED',
        },
        {
          id: 'a2',
          name: 'google-trends-for-agent-dev',
          username: 'alice',
          title: 'Dev copy',
          standbyUrl: 'https://alice--google-trends-for-agent-dev.apify.actor',
          standbyEnabled: true,
          lastBuildId: 'b2',
          lastBuildStatus: 'RUNNING',
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });

    now = 59_000;
    await client.listMyActors(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(5); // 60 s cache
    now = 61_000;
    await client.listMyActors(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    now = 62_000;
    await client.listMyActors(TOKEN, { refresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(15);
  });

  it('returns no-token without calling Apify', async () => {
    const fetchMock = vi.fn();
    const client = new ApifyActorClient({ fetch: fetchMock as unknown as typeof fetch });
    expect(await client.listMyActors('  ')).toMatchObject({ ok: false, code: 'no-token' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps invalid tokens and network failures without leaking the token', async () => {
    const unauthorized = new ApifyActorClient({ fetch: (async () => json({ error: { message: `bad ${TOKEN}` } }, 401)) as unknown as typeof fetch });
    const invalid = await unauthorized.listMyActors(TOKEN);
    expect(invalid).toMatchObject({ ok: false, code: 'invalid-token', status: 401 });
    expect(JSON.stringify(invalid)).not.toContain(TOKEN);

    const down = new ApifyActorClient({ fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    expect(await down.listMyActors(TOKEN)).toMatchObject({ ok: false, code: 'network' });
  });

  it('reports a running or failed first build that has no latest tag yet', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target === ACTS_URL) return json({ data: { items: [{ id: 'a1', name: 'google-trends-for-agent', username: 'alice' }] } });
      if (target === `${API}/acts/a1`) return actorDetail('a1', 'google-trends-for-agent', null);
      if (target === `${API}/acts/a1/builds?desc=1&limit=1`) return json({ data: { items: [{ id: 'b0', status: 'FAILED' }] } });
      throw new Error(`unexpected ${target}`);
    });
    const client = new ApifyActorClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await client.listMyActors(TOKEN);
    expect(result).toMatchObject({ ok: true, actors: [{ id: 'a1', lastBuildId: 'b0', lastBuildStatus: 'FAILED' }] });
  });

  it('never sends the token to a non-Apify Standby host', async () => {
    const client = new ApifyActorClient({ fetch: (async () => actorDetail('a1', 'google-trends-for-agent', null, 'https://evil.test')) as unknown as typeof fetch });
    await expect(client.resolveStandbyUrl(TOKEN, 'a1')).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/unexpected Standby URL/) });
  });

  it('resolves and caches the Standby URL per token + Actor', async () => {
    let now = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === `${API}/acts/a1`) return actorDetail('a1', 'google-trends-for-agent', null);
      throw new Error(`unexpected ${String(url)}`);
    });
    const client = new ApifyActorClient({ fetch: fetchMock as unknown as typeof fetch, now: () => now });
    expect(await client.resolveStandbyUrl(TOKEN, 'a1')).toBe('https://alice--google-trends-for-agent.apify.actor');
    expect(await client.resolveStandbyUrl(TOKEN, 'a1')).toBe('https://alice--google-trends-for-agent.apify.actor');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now = 61_000;
    await client.resolveStandbyUrl(TOKEN, 'a1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing Actor or an Actor without Standby', async () => {
    const missing = new ApifyActorClient({ fetch: (async () => json({ error: { message: 'not found' } }, 404)) as unknown as typeof fetch });
    await expect(missing.resolveStandbyUrl(TOKEN, 'missing')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/Select or deploy/),
    });
    await expect(missing.resolveStandbyUrl(TOKEN, '')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const noStandby = new ApifyActorClient({ fetch: (async () => actorDetail('a1', 'google-trends-for-agent', null, null)) as unknown as typeof fetch });
    await expect(noStandby.resolveStandbyUrl(TOKEN, 'a1')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/Standby URL/),
    });
  });

  it('deploys the Git-backed Standby Actor and starts a build', async () => {
    let payload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target === `${API}/acts`) {
        payload = JSON.parse(String(init!.body)) as Record<string, unknown>;
        return json({ data: { id: 'new-actor' } }, 201);
      }
      if (target === `${API}/acts/new-actor/builds?version=0.1&tag=latest`) return json({ data: { id: 'build-1' } }, 201);
      throw new Error(`unexpected ${target}`);
    });
    const client = new ApifyActorClient({ fetch: fetchMock as unknown as typeof fetch });
    expect(await client.deployActor(TOKEN)).toEqual({ ok: true, actorId: 'new-actor', buildId: 'build-1' });
    expect(payload).toEqual({
      name: 'google-trends-for-agent',
      title: 'Google Trends for AI Agents',
      isPublic: false,
      versions: [{
        versionNumber: '0.1',
        sourceType: 'GIT_REPO',
        gitRepoUrl: 'https://github.com/meka-im/google-trends-for-agent',
        buildTag: 'latest',
      }],
      actorStandby: {
        isEnabled: true,
        idleTimeoutSecs: 60,
        memoryMbytes: 512,
        desiredRequestsPerActorRun: 3,
        maxRequestsPerActorRun: 4,
        build: 'latest',
      },
    });
  });

  it('maps a name conflict to exists and never leaks the token', async () => {
    const fetchMock = vi.fn(async () => json({ error: { type: 'actor-name-not-unique', message: `Some other Actor already has this name ("google-trends-for-agent"). ${TOKEN}` } }, 409));
    const client = new ApifyActorClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await client.deployActor(TOKEN);
    expect(result).toMatchObject({ ok: false, code: 'exists' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Actor relay transport', () => {
  const request = {
    url: 'https://trends.google.com/trends/api/explore?hl=en-US',
    method: 'GET',
    headers: { accept: 'application/json' },
    timeoutMs: 8000,
  };

  it('checks /health once, then POSTs the TransportRequest to /egress/fetch', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => String(url) === 'https://actor.test/base/health'
      ? json({ ok: true, version: '0.1.0', relay: 1 })
      : json({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html>ok</html>' }));
    const transport = createActorRelayTransport({
      token: TOKEN,
      actorId: 'a1',
      fetch: fetchMock as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test/base/',
    });
    const response = await transport(request);
    expect(response).toEqual({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html>ok</html>' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://actor.test/base/health');
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('https://actor.test/base/egress/fetch');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      redirect: 'manual',
    });
    expect(JSON.parse(String(init!.body))).toEqual({
      url: request.url,
      method: 'GET',
      headers: request.headers,
      timeoutMs: 8000,
    });
  });

  it('maps 401/403, 404, 429/5xx, and network failures', async () => {
    const build = (status: number) => createActorRelayTransport({
      token: TOKEN,
      actorId: 'a1',
      fetch: (async (url: string | URL | Request) => String(url).endsWith('/health')
        ? json({ ok: true, version: '0.1.0', relay: 1 })
        : json({ status: 200, body: '' }, status)) as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test',
    });
    await expect(build(401)(request)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/rejected the token/) });
    await expect(build(403)(request)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/rejected the token/) });
    await expect(build(404)(request)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/Select or deploy/) });
    await expect(build(429)(request)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(build(503)(request)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    const offline = createActorRelayTransport({
      token: TOKEN,
      actorId: 'a1',
      fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test',
    });
    const error = await offline(request).catch((reason: unknown) => reason as GTrendsError);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', message: expect.stringMatching(/Could not reach your Apify Actor/) });
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it('requires a token and an Actor id before calling anything', async () => {
    const fetchMock = vi.fn();
    const noToken = createActorRelayTransport({ token: '', actorId: 'a1', fetch: fetchMock as unknown as typeof fetch, resolveStandbyUrl: async () => 'https://actor.test' });
    await expect(noToken(request)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/APIFY_TOKEN/) });
    const noActor = createActorRelayTransport({ token: TOKEN, actorId: '', fetch: fetchMock as unknown as typeof fetch, resolveStandbyUrl: async () => 'https://actor.test' });
    await expect(noActor(request)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/Select or deploy/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows 120 s for the first cold-start request', async () => {
    const fetchMock = vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); });
    const transport = createActorRelayTransport({
      token: TOKEN,
      actorId: 'a1',
      fetch: fetchMock as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test',
      coldStartTimeoutMs: 120_000,
    });
    await expect(transport({ ...request, timeoutMs: 5000 })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: expect.stringMatching(/120 seconds/),
    });
  });

  it('rejects an invalid relay response', async () => {
    const transport = createActorRelayTransport({
      token: TOKEN,
      actorId: 'a1',
      fetch: (async (url: string | URL | Request) => String(url).endsWith('/health')
        ? json({ ok: true, version: '0.1.0', relay: 1 })
        : json({ nope: true })) as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test',
    });
    await expect(transport(request)).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: expect.stringMatching(/invalid relay response/) });
  });

  it('requires relay v1 and caches the health check per transport', async () => {
    let health = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/health')) {
        health += 1;
        return json({ ok: true, version: '0.1.0', relay: 1 });
      }
      return json({ status: 200, headers: {}, body: '' });
    });
    const transport = createActorRelayTransport({
      token: TOKEN, actorId: 'a1', fetch: fetchMock as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test',
    });
    await transport(request);
    await transport({ ...request, url: 'https://trends.google.com/trends/api/explore?hl=en-US&q=two' });
    expect(health).toBe(1);

    const mismatch = createActorRelayTransport({
      token: TOKEN, actorId: 'a1',
      fetch: (async () => json({ ok: true, version: '9.9.9', relay: 2 })) as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test',
    });
    await expect(mismatch(request)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'This Actor build speaks relay v2; this plugin needs v1. Update the plugin or rebuild the Actor.',
    });

    const missing = createActorRelayTransport({
      token: TOKEN, actorId: 'a1',
      fetch: (async () => json({ ok: true, version: '0.0.1' })) as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test',
    });
    await expect(missing(request)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/speaks relay v\?; this plugin needs v1/),
    });
  });
});

describe('relay health retry', () => {
  it('retries the health check after a transient failure', async () => {
    const request = { url: 'https://trends.google.com/trends/', method: 'HEAD', headers: {}, timeoutMs: 5000 };
    let health = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/health')) {
        health += 1;
        return health === 1 ? json({ error: 'busy' }, 503) : json({ ok: true, version: '0.1.0', relay: 1 });
      }
      return json({ status: 200, headers: {}, body: '' });
    });
    const transport = createActorRelayTransport({
      token: TOKEN, actorId: 'a1', fetch: fetchMock as unknown as typeof fetch,
      resolveStandbyUrl: async () => 'https://actor.test',
    });
    await expect(transport(request)).rejects.toBeInstanceOf(GTrendsError);
    await expect(transport(request)).resolves.toMatchObject({ status: 200 });
    expect(health).toBe(2);
  });
});

describe('Apify token resolution', () => {
  it('prefers the saved config token, then APIFY_TOKEN', () => {
    expect(resolveApifyApiToken('config-token', { APIFY_TOKEN: 'env-token' })).toEqual({ token: 'config-token', source: 'config' });
    expect(resolveApifyApiToken('  ', { APIFY_TOKEN: 'env-token' })).toEqual({ token: 'env-token', source: 'env' });
    expect(resolveApifyApiToken(undefined, {})).toEqual({});
  });
});
