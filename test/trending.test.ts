import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fetchTrending, listTrending, diffTrending, trendsNowToTrendingResponses, diffTrendsNow, trendsNowItemToTrendingItem, parseTrendingResponse, trendingVolumeLabel, TRENDING_GEOS, DEFAULT_TRENDING_GEOS, type Transport } from '../src/index.js';
import { runTrendingCli, trendingExitCode } from '../src/trending-cli.js';
const fixture = (geo = 'SG') => readFileSync(new URL(`./fixtures/trending/${geo}-24.txt`, import.meta.url), 'utf8');
const transport: Transport = async () => ({ status: 200, headers: {}, body: fixture() });
const opts = { transport, minIntervalMs: 0 };
describe('Trending Now offline', () => {
  it.each(['SG', 'US', 'JP'])('parses the %s live envelope', geo => {
    const rows = parseTrendingResponse(fixture(geo));
    expect(rows).toHaveLength(5);
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every(r => r.geo === geo && !isNaN(Date.parse(r.startedAt)))).toBe(true);
    expect(rows[0].newsCount).toBeGreaterThan(0);
  });
  it('posts exactly the RPC request and filters without changing ranks', async () => {
    const response = await fetchTrending({ geo: 'sg', minVolume: 5000, categories: [17], limit: 1 }, { ...opts, transport: async req => {
      expect(req.method).toBe('POST');
      expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded;charset=UTF-8');
      const rpc = JSON.parse(new URLSearchParams(req.body).get('f.req')!);
      expect(rpc).toEqual([[['i0OFE', JSON.stringify([null, null, 'SG', 0, 'en', 24, 1]), null, 'generic']]]);
      return transport(req);
    } });
    expect(response.status).toBe('ok');
    expect(response.items[0]).toMatchObject({ rank: 3, volume: 5000, volumeLabel: '5K+', categories: ['Sports'], active: true, endedAt: null });
    expect(response.meta.upstreamRequests).toBe(1);
  });
  it('handles ended trends, unknown categories, empty payloads and volume labels', () => {
    const env = JSON.parse(fixture().split('\n')[2]);
    const payload = JSON.parse(env[0][2]);
    payload[1][0][4] = [1793339400]; payload[1][0][10] = [18, 999];
    env[0][2] = JSON.stringify(payload);
    const item = parseTrendingResponse(JSON.stringify(env))[0];
    expect(item).toMatchObject({ active: false, endedAt: '2026-10-30T05:50:00.000Z', categoryIds: [18, 999], categories: ['Technology', 'Category 999'] });
    payload[1][0][4] = 1793339400; env[0][2] = JSON.stringify(payload);
    expect(parseTrendingResponse(JSON.stringify(env))[0].endedAt).toBe(item.endedAt);
    expect([200, 20000, 1500000].map(trendingVolumeLabel)).toEqual(['200+', '20K+', '1.5M+']);
    expect(parseTrendingResponse(JSON.stringify([['wrb.fr', 'i0OFE', '[null,[]]']]))).toEqual([]);
  });
  it.each([[429, '', 'RATE_LIMITED'], [200, '<html>captcha</html>', 'BLOCKED'], [200, 'unusual traffic', 'BLOCKED'], [200, 'garbage', 'TRENDS_PROTOCOL_CHANGED']])('maps upstream %s %s', async (status, body, code) => {
    const r = await fetchTrending({ geo: 'US' }, { transport: async () => ({ status: Number(status), body: String(body), headers: { 'retry-after': '30' } }) });
    expect(r.error?.code).toBe(code);
    if (status === 429) expect(r.error?.retryAfterSec).toBe(30);
  });
  it.each(['TimeoutError', 'AbortError', 'Error'])('maps transport %s', async name => {
    const r = await fetchTrending({ geo: 'JP' }, { transport: async () => { const e = new Error('offline'); e.name = name; throw e; } });
    expect(r.error?.code).toBe(name === 'Error' ? 'NETWORK_ERROR' : 'TRENDS_TIMEOUT');
  });
  it('rejects invalid input before transport', async () => {
    for (const input of [{ geo: 'ZZ' }, { geo: 'SG', hours: 12 }, { geo: 'SG', minVolume: -1 }, { geo: 'SG', limit: NaN }]) {
      const r = await fetchTrending(input as Parameters<typeof fetchTrending>[0], opts);
      expect(r.error?.code).toBe('INVALID_INPUT'); expect(r.meta.upstreamRequests).toBe(0);
    }
    expect(DEFAULT_TRENDING_GEOS).toHaveLength(30);
    expect(new Set(TRENDING_GEOS.map(g => g.code)).size).toBe(TRENDING_GEOS.length);
  });
  it('runs sequentially with shared default spacing', async () => {
    let clock = 0; const starts: number[] = []; let active = false;
    const batch = await listTrending({ geos: ['SG', 'US', 'JP'] }, { now: () => clock, sleep: async ms => { clock += ms; }, transport: async req => {
      expect(active).toBe(false); active = true; starts.push(clock); await Promise.resolve(); active = false; return transport(req);
    } });
    expect(starts).toEqual([0, 1500, 3000]); expect(batch.summary).toEqual({ geos: 3, ok: 3, failed: 0 });
  });
  it('stops on block and can opt out', async () => {
    let calls = 0;
    const blocked: Transport = async req => ++calls === 2 ? { status: 200, headers: {}, body: 'captcha' } : transport(req);
    const batch = await listTrending({ geos: ['SG', 'US', 'JP'] }, { ...opts, transport: blocked });
    expect(calls).toBe(2); expect(batch.status).toBe('partial');
    expect(batch.results[2].error?.message).toBe('skipped after upstream block');
    calls = 0;
    await listTrending({ geos: ['SG', 'US', 'JP'] }, { ...opts, transport: blocked, stopOnBlocked: false });
    expect(calls).toBe(3);
  });
  it('diffs by normalized query', async () => {
    const prev = await fetchTrending({ geo: 'SG' }, opts);
    const next = structuredClone(prev);
    next.items.shift(); next.items[0].volume++; next.items[0].query = ` ${next.items[0].query.toUpperCase()} `;
    next.items.push({ ...prev.items[0], query: 'new' });
    const diff = diffTrending(prev, next);
    expect(diff.added.map(i => i.query)).toEqual(['new']); expect(diff.removed).toHaveLength(1); expect(diff.rising).toHaveLength(1); expect(diff.unchanged).toBe(3);
  });
  it('supports CLI flags, output and exit codes using a fake transport', async () => {
    const r = await runTrendingCli(['--geo', 'sg', '--hours', '24', '--category', '18,17', '--limit', '1', '--min-volume', '5000', '--lang', 'en', '--pretty'], opts);
    expect(r.code).toBe(0); expect(JSON.parse(r.stdout).items[0].rank).toBe(3);
    expect((await runTrendingCli(['--geo', 'SG,US', '--format', 'csv'], opts)).stdout).toContain('volumeLabel');
    expect((await runTrendingCli(['--list-geos'], opts)).stdout).toContain('Singapore');
    expect((await runTrendingCli(['--default-geos'], opts)).code).toBe(0);
    expect((await runTrendingCli(['--all-geos'], opts)).code).toBe(0);
    for (const args of [[], ['--geo', 'ZZ'], ['--geo', 'SG', '--hours', '12'], ['--geo', 'SG', '--category', 'x'], ['--geo', 'SG', '--all-geos']]) expect((await runTrendingCli(args, opts)).code).toBe(4);
    for (const [body, status, code] of [['captcha', 200, 3], ['', 429, 3], ['garbage', 200, 1]] as const) expect((await runTrendingCli(['--geo', 'SG'], { transport: async () => ({ status, body, headers: {} }) })).code).toBe(code);
    const ok = await fetchTrending({ geo: 'SG' }, opts); const fail = { ...ok, status: 'error' as const, error: { code: 'NETWORK_ERROR' as const, message: 'offline' } };
    expect(trendingExitCode([ok, fail])).toBe(2);
  });
});

import { parseTrendingResponse as _p } from '../src/trending.js';
import { describe as _d, it as _i, expect as _e } from 'vitest';
_d('unsupported geo envelope', () => {
  _i('maps a null i0OFE payload to INVALID_INPUT', () => {
    const body = `)]}'\n\n[["wrb.fr","i0OFE",null,null,null,[3],"generic"],["di",18]]`;
    _e(() => _p(body)).toThrowError(/not available for this geo/);
  });
});

describe("trends_now converter", () => {
  const item = { rank: 1, title: "Foo", query: "foo", traffic: 20000, trafficLabel: "20K+", growthPct: 100, startedAt: "2026-01-01T00:00:00.000Z", endedAt: null, active: true, categories: ["Tech"], relatedQueries: ["bar"], newsCount: 2 };
  it("maps traffic fields to volume for diffTrending", () => {
    const mapped = trendsNowItemToTrendingItem(item, "SG");
    expect(mapped).toMatchObject({ geo: "SG", volume: 20000, volumeLabel: "20K+", query: "foo" });
    const [resp] = trendsNowToTrendingResponses({ hours: 24, byGeo: [{ geo: "SG", ok: true, fetchedAt: "t", items: [item] }] });
    expect(resp.items[0].volume).toBe(20000);
    const next = { ...item, traffic: 50000, trafficLabel: "50K+" };
    const prevR = trendsNowToTrendingResponses({ hours: 24, byGeo: [{ geo: "SG", items: [item] }] })[0];
    const nextR = trendsNowToTrendingResponses({ hours: 24, byGeo: [{ geo: "SG", items: [next, { ...item, query: "new", title: "New", traffic: 1000, trafficLabel: "1K+" }] }] })[0];
    expect(diffTrending(prevR, nextR)).toMatchObject({ rising: [expect.objectContaining({ query: "foo", volume: 50000 })], added: [expect.objectContaining({ query: "new" })], unchanged: 0 });
  });
  it("diffTrendsNow diffs per geo", () => {
    const prev = { hours: 24 as const, byGeo: [{ geo: "SG", items: [item] }, { geo: "US", items: [{ ...item, query: "us-only", title: "US" }] }] };
    const next = { hours: 24 as const, byGeo: [{ geo: "SG", items: [{ ...item, traffic: 90000 }] }, { geo: "JP", items: [{ ...item, query: "jp", title: "JP" }] }] };
    const diffs = diffTrendsNow(prev, next);
    expect(diffs.map(d => d.geo).sort()).toEqual(["JP", "SG", "US"]);
    expect(diffs.find(d => d.geo === "SG")!.rising[0].volume).toBe(90000);
    expect(diffs.find(d => d.geo === "US")!.removed[0].query).toBe("us-only");
    expect(diffs.find(d => d.geo === "JP")!.added[0].query).toBe("jp");
  });
});
