import { describe, expect, it, vi } from 'vitest';
import { runDoctor } from '../src/doctor.js';
import type { TrendsResponse } from '../src/api.js';
import type { Transport } from '../src/transport.js';
const response = (status = 200, body = '', headers: Record<string, string> = {}) => ({ status, body, headers });
const okQuery = async (): Promise<TrendsResponse> => ({
  status: 'ok', input: { queries: ['gpts'] },
  data: { interestOverTime: { timeline: Array.from({ length: 12 }, (_, i) => ({ time: String(i), values: [50] })) } },
  meta: { upstreamRequests: 3, durationMs: 10, warnings: [], fetchedAt: '2026-01-01T00:00:00.000Z' },
});
const okTransport: Transport = async () => response();
describe('gtfa doctor', () => {
  it('passes node, reachability, literal direct proxy, and one gpts fetch', async () => {
    const r = await runDoctor({ env: {}, nodeVersion: 'v20.11.0', transport: okTransport, query: okQuery });
    expect(r.ok).toBe(true);
    expect(r.checks.map(c => c.name)).toEqual(['node', 'reachability', 'proxy', 'fetch']);
    expect(r.checks.every(c => c.ok)).toBe(true);
    expect(r.summary).toEqual({ passed: 4, failed: 0 });
    expect(r.checks[0].detail).toContain('v20.11.0');
    expect(r.checks[2].detail).toContain('direct');
    expect(r.checks[3].detail).toContain('12 interest points');
    expect(r.proxy).toEqual({ source: 'none', url: null, direct: true });
  });
  it('honors HTTP_PROXY and redacts credentials', async () => {
    const r = await runDoctor({ env: { HTTP_PROXY: 'http://alice:secret@proxy.example.test:8080' }, nodeVersion: 'v22.0.0', transport: okTransport, query: okQuery });
    expect(r.ok).toBe(true);
    expect(r.checks[2].detail).toContain('HTTP_PROXY=');
    expect(r.checks[2].detail).toContain('proxy.example.test:8080');
    expect(r.checks[2].detail).not.toContain('alice');
    expect(r.checks[2].detail).not.toContain('secret');
    expect(r.proxy).toMatchObject({ source: 'HTTP_PROXY', direct: false });
  });
  it('fails old Node, bad proxy config, unreachable host, and skips the fetch', async () => {
    const r = await runDoctor({ env: { HTTPS_PROXY: 'socks5://alice:secret@proxy.example.test:1080' }, nodeVersion: '18.19.0', transport: async () => response(429) });
    expect(r.ok).toBe(false);
    expect(r.summary).toEqual({ passed: 0, failed: 4 });
    expect(r.checks[0]).toMatchObject({ name: 'node', ok: false });
    expect(r.checks[0].hint).toContain('nodejs.org');
    expect(r.checks[1]).toMatchObject({ name: 'reachability', ok: false });
    expect(r.checks[2]).toMatchObject({ name: 'proxy', ok: false });
    expect(r.checks[2].hint).toContain('http://host:port');
    expect(r.checks[3]).toMatchObject({ name: 'fetch', ok: false });
    expect(r.checks[2].detail).not.toContain('alice');
    expect(r.checks[2].detail).not.toContain('secret');
  });
  it('reports actionable fetch failures', async () => {
    const rate = await runDoctor({ env: {}, nodeVersion: 'v20.0.0', transport: okTransport, query: async () => ({ status: 'error', input: {}, error: { code: 'RATE_LIMITED', message: 'rate limit' }, meta: { upstreamRequests: 1, durationMs: 1, warnings: [], fetchedAt: '2026-01-01T00:00:00.000Z' } }) });
    expect(rate.ok).toBe(false);
    expect(rate.checks[3]).toMatchObject({ name: 'fetch', ok: false, detail: expect.stringContaining('RATE_LIMITED'), hint: expect.stringContaining('retryAfterSec') });
  });

  it.each([
    ['redirect', 302, '', { location: 'https://www.google.com/sorry/index' }],
    ['challenge page', 200, '<html>unusual traffic captcha</html>', {}],
    ['rate limit', 429, '', {}],
  ] as const)('stops the gpts fetch after a reachability %s', async (_name, status, body, headers) => {
    const query = vi.fn(okQuery);
    const r = await runDoctor({ env: {}, nodeVersion: 'v20.0.0', transport: async () => response(status, body, headers), query });
    expect(r.ok).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(r.checks[1]).toMatchObject({ name: 'reachability', ok: false });
    expect(r.checks[3]).toMatchObject({ name: 'fetch', ok: false, detail: expect.stringContaining('skipped after upstream') });
  });

  it('keeps rate-limit semantics for a 429 that also contains challenge text', async () => {
    const query = vi.fn(okQuery);
    const r = await runDoctor({ env: {}, nodeVersion: 'v20.0.0', transport: async () => response(429, 'captcha'), query });
    expect(query).not.toHaveBeenCalled();
    expect(r.checks[1]).toMatchObject({ ok: false, hint: expect.stringContaining('retryAfterSec') });
    expect(r.checks[3].detail).toContain('RATE_LIMITED');
  });

  it('passes the selected timeout to both reachability and fetch', async () => {
    const transportTimeouts: number[] = [];
    const queryTimeouts: number[] = [];
    const r = await runDoctor({
      env: {},
      nodeVersion: 'v20.0.0',
      timeoutMs: 1500,
      transport: async request => { transportTimeouts.push(request.timeoutMs); return response(); },
      query: async input => { queryTimeouts.push(Number(input.timeoutMs)); return okQuery(); },
    });
    expect(r.ok).toBe(true);
    expect(transportTimeouts).toEqual([1500]);
    expect(queryTimeouts).toEqual([1500]);
  });
});
