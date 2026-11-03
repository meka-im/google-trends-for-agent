import { describe, it, expect, vi, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), agent: vi.fn(function(this: object) {}) }));
vi.mock('undici', () => ({ ProxyAgent: mocks.agent, fetch: mocks.fetch }));
import { createDefaultTransport, describeProxy, getProxyConfig } from '../src/transport.js';
const clearProxy = () => { for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) vi.stubEnv(name, ''); };
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('proxy environment configuration', () => {
  it.each(['HTTPS_PROXY', 'https_proxy'])('uses a ProxyAgent for %s without accessing the network', async name => {
    clearProxy();
    vi.stubEnv(name, 'http://proxy.example.test:8080');
    mocks.fetch.mockResolvedValue(new Response('proxied fixture'));
    const transport = createDefaultTransport();
    const result = await transport({ url: 'https://trends.google.com/trends/', headers: { accept: 'text/plain' }, timeoutMs: 1234 });
    expect(mocks.agent).toHaveBeenCalledWith('http://proxy.example.test:8080');
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual', dispatcher: expect.any(Object), headers: { accept: 'text/plain' } });
    expect(result.body).toBe('proxied fixture');
  });
  it.each(['HTTP_PROXY', 'http_proxy'])('uses a ProxyAgent for %s when HTTPS_PROXY is unset', async name => {
    clearProxy();
    vi.stubEnv(name, 'http://proxy.example.test:8080');
    mocks.fetch.mockResolvedValue(new Response('http proxy'));
    const result = await createDefaultTransport()({ url: 'https://trends.google.com/trends/', headers: {}, timeoutMs: 1000 });
    expect(mocks.agent).toHaveBeenCalledWith('http://proxy.example.test:8080');
    expect(result.body).toBe('http proxy');
  });
  it('prefers HTTPS_PROXY over HTTP_PROXY and is direct when both are unset', () => {
    clearProxy();
    expect(getProxyConfig({})).toEqual({ source: 'none', url: null });
    expect(describeProxy({})).toContain('direct');
    expect(getProxyConfig({ HTTP_PROXY: 'http://http.example:8080', HTTPS_PROXY: 'http://https.example:8080' })).toEqual({ source: 'HTTPS_PROXY', url: 'http://https.example:8080' });
  });
  it('redacts credentials and rejects invalid proxy URLs before any request', () => {
    expect(describeProxy({ HTTP_PROXY: 'http://alice:secret@proxy.example:8080' })).not.toContain('secret');
    expect(() => createDefaultTransport({ HTTPS_PROXY: 'socks5://proxy.example:1080' })).toThrow(/Invalid HTTPS_PROXY.*http:\/\/host:port/s);
  });
});
