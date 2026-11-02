import { describe, it, expect, vi, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), agent: vi.fn(function(this: object) {}) }));
vi.mock('undici', () => ({ ProxyAgent: mocks.agent, fetch: mocks.fetch }));
import { createDefaultTransport } from '../src/transport.js';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('proxy environment configuration', () => {
  it.each(['HTTPS_PROXY', 'https_proxy'])('uses a ProxyAgent for %s without accessing the network', async name => {
    vi.stubEnv('HTTPS_PROXY', '');
    vi.stubEnv('https_proxy', '');
    vi.stubEnv(name, 'http://proxy.example.test:8080');
    mocks.fetch.mockResolvedValue(new Response('proxied fixture'));
    const transport = createDefaultTransport();
    const result = await transport({ url: 'https://trends.google.com/trends/', headers: { accept: 'text/plain' }, timeoutMs: 1234 });
    expect(mocks.agent).toHaveBeenCalledWith('http://proxy.example.test:8080');
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual', dispatcher: expect.any(Object), headers: { accept: 'text/plain' } });
    expect(result.body).toBe('proxied fixture');
  });
});
