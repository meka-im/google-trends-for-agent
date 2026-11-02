import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { queryTrends, compareTrends, batchTrends, type Transport } from '../src/index.js';
const response = (body = '', status = 200, headers = {}) => ({ body, status, headers });
const fixture: Transport = async req => {
  if (req.method === 'HEAD') return response();
  const file = req.url.includes('/multiline') ? 'multiline-single-custom.txt' : 'explore-single-world.txt';
  return response(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
};
describe('public API', () => {
  it('returns stable input errors without requesting upstream', async () => {
    const transport = vi.fn<Transport>();
    const result = await queryTrends({ queries: [] }, { transport });
    expect(result).toMatchObject({ status: 'error', input: { queries: [] }, error: { code: 'INVALID_INPUT' }, meta: { upstreamRequests: 0, warnings: [] } });
    expect(Number.isFinite(Date.parse(result.meta.fetchedAt))).toBe(true);
    expect(transport).not.toHaveBeenCalled();
    expect((await queryTrends({ queries: ['x'] }, { minIntervalMs: -1 })).error?.code).toBe('INVALID_INPUT');
  });
  it('queries and compares using a custom transport', async () => {
    const result = await compareTrends(['bitcoin'], { dataTypes: ['interestOverTime'], transport: fixture, minIntervalMs: 0 });
    expect(result.status).toBe('ok');
    expect(result.data?.interestOverTime).toBeTruthy();
    expect(result.meta.upstreamRequests).toBe(3);
  });
  it('stops after a block and can explicitly continue', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(response('captcha'));
    const items = [{ queries: ['x'] }, { queries: ['y'] }];
    const batch = await batchTrends(items, { transport, minIntervalMs: 0 });
    expect(batch.status).toBe('error');
    expect(batch.results[1]).toMatchObject({ index: 1, error: { code: 'BLOCKED', message: 'skipped after upstream block' }, meta: { upstreamRequests: 0 } });
    expect(transport).toHaveBeenCalledTimes(1);
    await batchTrends(items, { transport, minIntervalMs: 0, sleep: async () => {}, stopOnBlocked: false });
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('shares the request limiter across sequential queries', async () => {
    let now = 0;
    const starts: number[] = [];
    const result = await batchTrends([{ queries: ['bitcoin'], dataTypes: ['interestOverTime'] }, { queries: ['bitcoin'], dataTypes: ['interestOverTime'] }], {
      transport: async req => { starts.push(now); return fixture(req); }, now: () => now, sleep: async ms => { now += ms; },
    });
    expect(result.status).toBe('ok');
    expect(starts).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
  });
  it('distinguishes network, timeout, rate limiting, and partial batch failures', async () => {
    const input = { queries: ['x'], maxRetries: 0 };
    expect((await queryTrends(input, { transport: async () => { throw new Error('offline'); } })).error?.code).toBe('NETWORK_ERROR');
    expect((await queryTrends(input, { transport: async () => { throw new DOMException('timeout', 'TimeoutError'); } })).error?.code).toBe('TRENDS_TIMEOUT');
    const rate = await queryTrends(input, { transport: async () => response('', 429, { 'retry-after': '5' }) });
    expect(rate.error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 5 });
    const batch = await batchTrends([{ queries: [] }, { queries: ['bitcoin'], dataTypes: ['interestOverTime'] }], { transport: fixture, minIntervalMs: 0 });
    expect(batch.status).toBe('partial');
  });
});
