import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TrendsClient } from '../src/client.js';
import { errorLabel, type Transport, type TransportRequest } from '../src/transport.js';
import { GTrendsError } from '../src/core.js';
const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const response = (body = '', status = 200, headers: Record<string, string> = {}) => ({ body, status, headers });
const json = (value: unknown) => ")]}'\n" + JSON.stringify(value);
function fixtureTransport(first: Transport): Transport {
  let usedFirst = false;
  return async (req: TransportRequest) => {
    if (!usedFirst) { usedFirst = true; return first(req); }
    const path = new URL(req.url).pathname;
    if (req.method === 'HEAD') return response('', 200, { 'Set-Cookie': 'NID=session; Path=/; Secure; HttpOnly' });
    if (path.endsWith('/explore')) return response(fx('explore-single-world.txt'));
    if (path.endsWith('/multiline')) return response(fx('multiline-single-custom.txt'));
    if (path.endsWith('/relatedsearches')) return response(fx('relatedsearches-empty.txt'));
    if (path.endsWith('/comparedgeo')) return response(fx('comparedgeo-country-world.txt'));
    throw new Error('Unexpected request');
  };
}
describe('safe error labels', () => {
  it('logs only a code or class, never the raw message', () => {
    const upstream = new GTrendsError('BLOCKED', 'challenge at https://trends.google.com/?q=private+term&token=secret');
    expect(errorLabel(upstream)).toBe('BLOCKED');
    const network = new TypeError('proxy failed for https://user:pass@proxy.test/?q=private');
    expect(errorLabel(network)).toBe('TypeError');
    expect(errorLabel('raw text')).toBe('Error');
  });
});

describe('bounded retries', () => {
  it('backs off on 429, honors Retry-After, then succeeds', async () => {
    let calls = 0, now = 0;
    const sleeps: number[] = [];
    const transport: Transport = fixtureTransport(async () => {
      calls++;
      return response('', 429, { 'retry-after': '2' });
    });
    const r = await new TrendsClient({ transport, minIntervalMs: 0, now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; } })
      .query({ queries: ['bitcoin'], dataTypes: ['interestOverTime'] });
    expect(r.status).toBe('ok');
    expect(calls).toBe(1);
    expect(sleeps).toEqual([2000]);
    expect(r.meta.upstreamRequests).toBe(4);
  });
  it('caps 429 retries and uses exponential backoff without Retry-After', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const transport = vi.fn<Transport>().mockResolvedValue(response('', 429));
    const r = await new TrendsClient({ transport, minIntervalMs: 0, now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; } })
      .query({ queries: ['bitcoin'], dataTypes: ['interestOverTime'], maxRetries: 2 });
    expect(r.error?.code).toBe('RATE_LIMITED');
    expect(transport).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect(r.error?.message).toContain('HTTPS_PROXY/HTTP_PROXY');
  });
  it('does not wait for a Retry-After outside the bounded window', async () => {
    const sleeps: number[] = [];
    const transport = vi.fn<Transport>().mockResolvedValue(response('', 429, { 'retry-after': '120' }));
    const r = await new TrendsClient({ transport, minIntervalMs: 0, sleep: async ms => { sleeps.push(ms); } })
      .query({ queries: ['bitcoin'], dataTypes: ['interestOverTime'], maxRetries: 2 });
    expect(r.error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 120 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect(r.error?.message).toContain('Wait 120s');
  });
  it('does not retry a challenge page', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(response('<html>captcha</html>'));
    const r = await new TrendsClient({ transport, minIntervalMs: 0 }).query({ queries: ['bitcoin'], maxRetries: 2 });
    expect(r.error?.code).toBe('BLOCKED');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(r.error?.message).toContain('HTTPS_PROXY/HTTP_PROXY');
  });
  it('cancels a retry sleep when the caller aborts', async () => {
    const controller = new AbortController();
    const transport = vi.fn<Transport>().mockResolvedValue(response('', 429, { 'retry-after': '2' }));
    const client = new TrendsClient({
      transport, minIntervalMs: 0, signal: controller.signal,
      sleep: async () => { controller.abort(); await new Promise<void>(() => {}); },
    });
    await expect(client.query({ queries: ['bitcoin'], dataTypes: ['interestOverTime'], maxRetries: 2 }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('keeps protocol errors actionable', async () => {
    let calls = 0;
    const transport: Transport = async req => {
      const path = new URL(req.url).pathname;
      if (req.method === 'HEAD') return response('', 200);
      if (path.endsWith('/explore')) return response('not json');
      calls++;
      return response(json({ widgets: [] }));
    };
    const r = await new TrendsClient({ transport, minIntervalMs: 0 }).query({ queries: ['bitcoin'] });
    expect(calls).toBe(0);
    expect(r.error?.code).toBe('TRENDS_PROTOCOL_CHANGED');
    expect(r.error?.message).toContain('newer gtfa');
  });
});
