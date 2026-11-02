import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { TrendsClient } from '../src/client.js';
import { RateLimiter, Session, createDefaultTransport, type Transport, type TransportRequest } from '../src/transport.js';
const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const response = (body = '', status = 200, headers: Record<string,string> = {}) => ({ body, status, headers });
const json = (value: unknown) => ")]}'\n" + JSON.stringify(value);
function fixtureTransport(explore = 'explore-single-world.txt') {
  const calls: TransportRequest[] = [];
  const transport: Transport = async req => {
    calls.push(req);
    const path = new URL(req.url).pathname;
    if (req.method === 'HEAD') return response('', 200, { 'Set-Cookie': 'NID=session; Path=/; Secure; HttpOnly' });
    if (path.endsWith('/explore')) return response(fx(explore));
    if (path.endsWith('/multiline')) return response(fx(explore === 'explore-multi.txt' ? 'multiline-multi.txt' : 'multiline-single-custom.txt'));
    if (path.endsWith('/comparedgeo')) {
      const request = JSON.parse(new URL(req.url).searchParams.get('req')!);
      return response(fx(request.resolution === 'DMA' ? 'comparedgeo-dma-single.txt' : request.resolution === 'CITY' ? 'comparedgeo-city-single.txt' : 'comparedgeo-country-world.txt'));
    }
    if (path.endsWith('/relatedsearches')) return response(fx('relatedsearches-empty.txt'));
    throw new Error('Unexpected request');
  };
  return { calls, transport };
}

describe('offline client sessions', () => {
  it('bootstraps cookies, explores, and collects only requested widgets', async () => {
    const f = fixtureTransport();
    const result = await new TrendsClient({ transport: f.transport, minIntervalMs: 0 }).query({ queries: ['bitcoin'], dataTypes: ['interestOverTime'] });
    expect(result.status).toBe('ok');
    expect(result.meta.upstreamRequests).toBe(3);
    expect((result.data.interestOverTime as any).timeline.length).toBeGreaterThan(0);
    expect(f.calls[0].method).toBe('HEAD');
    expect(f.calls.every(c => c.headers['user-agent'] === 'Mozilla/5.0')).toBe(true);
    expect(f.calls[1].headers.cookie).toBe('NID=session');
    expect(f.calls[2].headers.cookie).toBe('NID=session');
    expect(f.calls.every(c => c.timeoutMs === 8000)).toBe(true);
  });
  it('collects metro and city requests with explicit resolution', async () => {
    const f = fixtureTransport();
    const result = await new TrendsClient({ transport: f.transport, minIntervalMs: 0 }).query({ queries: ['bitcoin'], geo: 'US', dataTypes: ['interestByMetro', 'interestByCity'] });
    expect(result.status).toBe('ok');
    expect((result.data.interestByMetro as any).resolution).toBe('DMA');
    expect((result.data.interestByCity as any).resolution).toBe('CITY');
    const req = JSON.parse(new URL(f.calls[2].url).searchParams.get('req')!);
    expect(req.includeLowSearchVolumeGeos).toBe(true);
  });
  it('preserves comparison keyword order for related queries', async () => {
    const f = fixtureTransport('explore-multi.txt');
    const r = await new TrendsClient({ transport: f.transport, minIntervalMs: 0 }).query({ queries: ['chatgpt', 'claude'], geo: 'US', dataTypes: ['relatedQueries'] });
    expect(r.status).toBe('ok');
    expect(r.data.relatedQueriesByQuery).toEqual([{ query: 'chatgpt', top: [], rising: [] }, { query: 'claude', top: [], rising: [] }]);
  });
  it('explores each keyword separately for comparison topics', async () => {
    const calls: TransportRequest[] = [];
    const transport: Transport = async req => {
      calls.push(req);
      if (req.method === 'HEAD') return response();
      if (new URL(req.url).pathname.endsWith('/explore')) {
        const queries = JSON.parse(new URL(req.url).searchParams.get('req')!).comparisonItem;
        if (queries.length > 1) return response(json({ widgets: [] }));
        const ex = JSON.parse(fx('explore-single-world.txt').replace(/^\)\]\}'[,]?\s*/, ''));
        ex.widgets = ex.widgets.filter((w: any) => w.id === 'RELATED_TOPICS');
        ex.widgets[0].request.restriction.complexKeywordsRestriction.keyword[0].value = queries[0].keyword;
        return response(json(ex));
      }
      return response(fx('relatedsearches-empty.txt'));
    };
    const r = await new TrendsClient({ transport, minIntervalMs: 0 }).query({ queries: ['a', 'b'], dataTypes: ['relatedTopics'] });
    expect(r.status).toBe('ok');
    expect(r.meta.upstreamRequests).toBe(6);
    expect(r.data.relatedTopicsByQuery).toEqual([{ query: 'a', top: [], rising: [] }, { query: 'b', top: [], rising: [] }]);
  });
  it.each(['<html>unusual traffic from your computer network</html>', '<form id="captcha-form">', '<html>/sorry/index</html>'])('returns BLOCKED without retrying a challenge', async body => {
    const transport = vi.fn<Transport>().mockResolvedValue(response(body));
    const r = await new TrendsClient({ transport, minIntervalMs: 0 }).query({ queries: ['coffee'] });
    expect(r.error?.code).toBe('BLOCKED');
    expect(r.meta.upstreamRequests).toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).not.toContain(body);
  });
  it('reports rate limits and rejects invalid input before any request', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(response('', 429));
    const client = new TrendsClient({ transport, minIntervalMs: 0 });
    expect((await client.query({ queries: [] })).meta.upstreamRequests).toBe(0);
    expect((await client.query({ queries: ['coffee'] })).error?.code).toBe('RATE_LIMITED');
  });
  it('preserves successful keywords when a later related widget is malformed', async () => {
    const f = fixtureTransport('explore-multi.txt');
    let related = 0;
    const transport: Transport = async req => {
      if (req.url.includes('/relatedsearches') && ++related === 2) return response(json({ default: {} }));
      return f.transport(req);
    };
    const r = await new TrendsClient({ transport, minIntervalMs: 0 }).query({ queries: ['chatgpt', 'claude'], geo: 'US', dataTypes: ['relatedQueries'] });
    expect(r.status).toBe('partial');
    expect(r.data.relatedQueriesByQuery).toEqual([{ query: 'chatgpt', top: [], rising: [] }, { query: 'claude', top: null, rising: null }]);
    expect(r.meta.warnings).toEqual(['relatedQueries[queryIndex=1]: TRENDS_PROTOCOL_CHANGED']);
  });
  it('stops subsequent widgets on a blocked response and keeps collected data', async () => {
    const f = fixtureTransport();
    const transport: Transport = async req => req.url.includes('/relatedsearches') ? response('captcha') : f.transport(req);
    const r = await new TrendsClient({ transport, minIntervalMs: 0 }).query({ queries: ['bitcoin'], dataTypes: ['interestOverTime', 'relatedQueries', 'relatedTopics'] });
    expect(r.status).toBe('error');
    expect(r.error?.code).toBe('BLOCKED');
    expect(r.data.interestOverTime).toBeTruthy();
    expect(r.meta.upstreamRequests).toBe(4);
  });
  it('keeps cookies within a single query session', async () => {
    const f = fixtureTransport();
    const client = new TrendsClient({ transport: f.transport, minIntervalMs: 0 });
    await client.query({ queries: ['bitcoin'] });
    await client.query({ queries: ['bitcoin'] });
    expect(f.calls[3].headers.cookie).toBeUndefined();
  });
  it('retries transient failures only up to maxRetries', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(response('', 503));
    const r = await new TrendsClient({ transport, minIntervalMs: 0 }).query({ queries: ['coffee'], maxRetries: 2 });
    expect(r.error?.code).toBe('TRENDS_TEMPORARILY_UNAVAILABLE');
    expect(transport).toHaveBeenCalledTimes(3);
  });
});

describe('transport and request spacing', () => {
  it('spaces concurrent requests and caps adaptive penalties at sixty seconds', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const limiter = new RateLimiter({ now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; } });
    const starts: number[] = [];
    await Promise.all([1,2,3].map(() => limiter.run(async () => { starts.push(now); })));
    expect(starts).toEqual([0,1000,2000]);
    limiter.penalize();
    await limiter.run(async () => {});
    limiter.penalize();
    await limiter.run(async () => {});
    limiter.penalize(120000);
    await limiter.run(async () => {});
    expect(sleeps).toEqual([1000,1000,2000,4000,60000]);
  });
  it('parses combined cookies, expiration, scope, and replacements', async () => {
    const calls: TransportRequest[] = [];
    const transport: Transport = async req => {
      calls.push(req);
      return response('', 200, calls.length === 1 ? { 'set-cookie': 'A=1; Path=/; Secure, B=2; Expires=Mon, 01 Jan 2040 00:00:00 GMT; Path=/trends' } : { 'set-cookie': 'A=gone; Max-Age=0; Path=/' });
    };
    const s = new Session(transport, new RateLimiter({ minIntervalMs: 0 }));
    const request = (url: string) => s.request({ url, headers: {}, timeoutMs: 1000 });
    await request('https://trends.google.com/trends/');
    await request('https://trends.google.com/trends/api/explore');
    expect(calls[1].headers.cookie).toContain('A=1');
    expect(calls[1].headers.cookie).toContain('B=2');
    await request('https://trends.google.com/other');
    expect(calls[2].headers.cookie).toBeUndefined();
  });
  it('honors Retry-After within the cap and detects redirect challenges', async () => {
    let now = 0;
    const delays: number[] = [];
    const limiter = new RateLimiter({ now: () => now, sleep: async ms => { delays.push(ms); now += ms; } });
    const transport = vi.fn<Transport>().mockResolvedValueOnce(response('', 429, { 'Retry-After': '120' })).mockResolvedValueOnce(response('', 302, { location: 'https://trends.google.com/sorry/index' }));
    const session = new Session(transport, limiter);
    const req = { url: 'https://trends.google.com/trends/', headers: {}, timeoutMs: 1000 };
    await expect(session.request(req)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(session.request(req)).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(delays).toEqual([60000]);
  });
  it('does not treat JSON query text as a challenge page', async () => {
    const body = json({ query: 'captcha unusual traffic /sorry/index' });
    const session = new Session(async () => response(body), new RateLimiter({ minIntervalMs: 0 }));
    await expect(session.request({ url: 'https://trends.google.com/trends/', headers: {}, timeoutMs: 1000 })).resolves.toBe(body);
  });
  it('maps aborted transport requests to timeout errors', async () => {
    const session = new Session(async () => { throw new DOMException('aborted', 'TimeoutError'); }, new RateLimiter({ minIntervalMs: 0 }));
    await expect(session.request({ url: 'https://trends.google.com/trends/', headers: {}, timeoutMs: 1000 })).rejects.toMatchObject({ code: 'TRENDS_TIMEOUT' });
  });
  it('uses global fetch with manual redirects and preserves Set-Cookie headers', async () => {
    const upper = process.env.HTTPS_PROXY, lower = process.env.https_proxy;
    delete process.env.HTTPS_PROXY; delete process.env.https_proxy;
    const mock = vi.fn().mockResolvedValue(new Response('body', { headers: { 'set-cookie': 'NID=x; Path=/' } }));
    vi.stubGlobal('fetch', mock);
    try {
      const r = await createDefaultTransport()({ url: 'https://example.test', headers: {}, timeoutMs: 1000 });
      expect(r.body).toBe('body');
      expect(r.headers['set-cookie']).toContain('NID=x');
      expect(mock.mock.calls[0][1].redirect).toBe('manual');
    } finally {
      if (upper !== undefined) process.env.HTTPS_PROXY = upper;
      if (lower !== undefined) process.env.https_proxy = lower;
      vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is disabled in tests'); }));
    }
  });
});
