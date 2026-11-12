import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), agent: vi.fn(function(this: object) {}) }));
vi.mock('undici', () => ({ ProxyAgent: mocks.agent, fetch: mocks.fetch }));

import { createDefaultTransport } from '../src/transport.js';
import { ACTOR_PROXY_DEFAULTS, ApifyProxySession, actorProxyInput, createRotatingTransport } from '../src/actor-proxy.js';

afterEach(() => vi.clearAllMocks());

const request = { url: 'https://trends.google.com/trends/api/explore', headers: {}, timeoutMs: 1000 };

describe('Actor proxy wiring', () => {
  it('defaults to US residential and preserves an explicit proxy choice', () => {
    expect(actorProxyInput(undefined)).toEqual({
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
      apifyProxyCountry: 'US',
    });
    expect(ACTOR_PROXY_DEFAULTS.apifyProxyCountry).toBe('US');
    const custom = { useApifyProxy: true, apifyProxyGroups: ['DATACENTER'], apifyProxyCountry: 'GB' };
    expect(actorProxyInput(custom)).toBe(custom);
  });

  it('rotates the proxy session id without mutating process.env', async () => {
    const before = { ...process.env };
    const ids: string[] = [];
    const provider = {
      newUrl: vi.fn(async (id?: string | number) => {
        ids.push(String(id));
        return `http://user:secret@proxy.example:8000?session=${id}`;
      }),
    };
    const session = new ApifyProxySession(provider, counter => `gtfa_test_${counter}`);
    await session.rotate();
    await session.rotate();

    expect(ids).toEqual(['gtfa_test_1', 'gtfa_test_2']);
    expect(session.currentUrl).toContain('session=gtfa_test_2');
    expect(process.env).toEqual(before);
    expect(process.env.https_proxy).toBe(before.https_proxy);
  });

  it('rotates and rebuilds the existing transport on HTTP 429', async () => {
    const provider = {
      newUrl: vi.fn(async (id?: string | number) => `http://user:secret@proxy.example:8000?session=${id}`),
    };
    const session = new ApifyProxySession(provider, counter => `gtfa_${counter}`);
    await session.rotate();

    mocks.fetch
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const reasons: string[] = [];
    const urls: string[] = [];
    const transport = createRotatingTransport(session, {
      createTransport: url => { urls.push(url); return createDefaultTransport({ HTTPS_PROXY: url }); },
      onRotate: reason => reasons.push(reason),
    });

    expect((await transport(request)).status).toBe(429);
    expect(reasons).toEqual(['rate_limited']);
    expect(provider.newUrl).toHaveBeenCalledTimes(2);
    expect(urls.at(-1)).toContain('session=gtfa_2');
    expect(mocks.agent).toHaveBeenCalledTimes(2);

    expect((await transport(request)).status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('rotates on a CAPTCHA challenge without changing the returned response', async () => {
    const provider = { newUrl: vi.fn(async (id?: string | number) => `http://user:secret@proxy.example:8000?session=${id}`) };
    const session = new ApifyProxySession(provider, counter => `gtfa_${counter}`);
    await session.rotate();

    mocks.fetch.mockResolvedValueOnce(new Response('<html>unusual traffic captcha</html>', { status: 200 }));
    const reasons: string[] = [];
    const transport = createRotatingTransport(session, {
      createTransport: url => createDefaultTransport({ HTTPS_PROXY: url }),
      onRotate: reason => reasons.push(reason),
    });

    const response = await transport(request);
    expect(response.status).toBe(200);
    expect(response.body).toContain('captcha');
    expect(reasons).toEqual(['challenge']);
    expect(provider.newUrl).toHaveBeenCalledTimes(2);
  });
});
