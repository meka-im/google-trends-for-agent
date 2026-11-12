import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEgressTransport, ApifyProxyUrlProvider } from '../src/egress.js';
import { redactProxyUrl, type Transport, type TransportResponse } from '../src/transport.js';

const request = { url: 'https://trends.google.com/trends/api/explore', headers: {}, timeoutMs: 1000 };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function proxyPasswordResponse(password = 'proxy-pass') {
  return new Response(JSON.stringify({ data: { proxy: { password } } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Apify egress transport', () => {
  it('builds the documented residential proxy URL', async () => {
    const provider = new ApifyProxyUrlProvider({ proxyPassword: 'secret', country: 'US' });
    expect(await provider.newUrl('s1')).toBe('http://groups-RESIDENTIAL,session-s1,country-US:secret@proxy.apify.com:8000');
    expect(await new ApifyProxyUrlProvider({ proxyPassword: 'secret', country: 'gb' }).newUrl('s2'))
      .toBe('http://groups-RESIDENTIAL,session-s2,country-GB:secret@proxy.apify.com:8000');
  });

  it('fetches data.proxy.password once with the API token and never logs it', async () => {
    const fetchMock = vi.fn(async () => proxyPasswordResponse('pw-from-api'));
    const urls: string[] = [];
    const egress = createEgressTransport({
      egress: 'apify', apifyToken: 'api-token', fetch: fetchMock as unknown as typeof fetch,
      sessionId: counter => `sess_${counter}`,
      createTransport: url => { urls.push(url); return async () => ({ status: 200, headers: {}, body: 'ok' }); },
    });
    expect((await egress(request)).status).toBe(200);
    expect(urls).toEqual(['http://groups-RESIDENTIAL,session-sess_1,country-US:pw-from-api@proxy.apify.com:8000']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.apify.com/v2/users/me', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer api-token' }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('api-token@proxy');
  });

  it('rotates the session on HTTP 429 and reuses the cached proxy password', async () => {
    const fetchMock = vi.fn(async () => proxyPasswordResponse('pw'));
    const urls: string[] = [];
    let call = 0;
    const egress = createEgressTransport({
      egress: 'apify', apifyToken: 'token', fetch: fetchMock as unknown as typeof fetch,
      sessionId: counter => `s${counter}`,
      createTransport: url => {
        urls.push(url);
        call += 1;
        const status = call === 1 ? 429 : 200;
        return async (): Promise<TransportResponse> => ({ status, headers: {}, body: status === 200 ? 'ok' : 'rate limited' });
      },
    });
    expect((await egress(request)).status).toBe(429);
    expect(urls.at(-1)).toContain('session-s2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await egress(request)).status).toBe(200);
  });

  it('rotates the session on a Google challenge', async () => {
    const fetchMock = vi.fn(async () => proxyPasswordResponse('pw'));
    const urls: string[] = [];
    let call = 0;
    const egress = createEgressTransport({
      egress: 'apify', apifyToken: 'token', fetch: fetchMock as unknown as typeof fetch,
      sessionId: counter => `s${counter}`,
      createTransport: url => {
        urls.push(url);
        call += 1;
        const body = call === 1 ? '<html>unusual traffic captcha</html>' : 'ok';
        return async (): Promise<TransportResponse> => ({ status: 200, headers: {}, body });
      },
    });
    expect((await egress(request)).body).toContain('captcha');
    expect(urls.at(-1)).toContain('session-s2');
    expect((await egress(request)).body).toBe('ok');
  });

  it('does not mutate process.env', async () => {
    const before = { ...process.env };
    const fetchMock = vi.fn(async () => proxyPasswordResponse('pw'));
    const egress = createEgressTransport({
      egress: 'apify', apifyToken: 'token', fetch: fetchMock as unknown as typeof fetch,
      createTransport: () => async () => ({ status: 200, headers: {}, body: 'ok' }),
    });
    await egress(request);
    expect(process.env).toEqual(before);
  });

  it('returns a clear error when apify egress has neither password nor token', async () => {
    vi.stubEnv('APIFY_TOKEN', '');
    vi.stubEnv('APIFY_PROXY_PASSWORD', '');
    const egress = createEgressTransport({ egress: 'apify', apifyToken: '', apifyProxyPassword: '', fetch: vi.fn() as unknown as typeof fetch });
    await expect(egress(request)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/APIFY_TOKEN/),
    });
  });

  it('redacts proxy credentials in diagnostics', () => {
    const redacted = redactProxyUrl('http://groups-RESIDENTIAL,session-s1,country-US:pw@proxy.apify.com:8000');
    expect(redacted).not.toContain('pw');
    expect(redacted).toContain('***');
  });

  it('honors an explicit proxy password without calling the API', async () => {
    vi.stubEnv('APIFY_TOKEN', '');
    const fetchMock = vi.fn();
    const urls: string[] = [];
    const egress = createEgressTransport({
      egress: 'apify', apifyProxyPassword: 'direct-pass', fetch: fetchMock as unknown as typeof fetch,
      createTransport: url => { urls.push(url); return async () => ({ status: 200, headers: {}, body: 'ok' }); },
    });
    expect((await egress(request)).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(urls[0]).toContain('direct-pass@proxy.apify.com:8000');
  });
});
