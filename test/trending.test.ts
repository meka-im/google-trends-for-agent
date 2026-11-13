import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fetchTrending, listTrending, diffTrending, trendsNowToTrendingResponses, diffTrendsNow, trendsNowItemToTrendingItem, parseTrendingResponse, trendingVolumeLabel, normalizeTrendingGeos, TRENDING_GEOS, DEFAULT_TRENDING_GEOS, type Transport } from '../src/index.js';
import { runTrendingCli, trendingExitCode } from '../src/trending-cli.js';
const fixture = (geo = 'SG') => readFileSync(new URL(`./fixtures/trending/${geo}-24.html`, import.meta.url), 'utf8');
const transport: Transport = async () => ({ status: 200, headers: {}, body: fixture() });
const opts = { transport, minIntervalMs: 0 };
const page = (data: unknown) => `<script>AF_initDataCallback({ key : 'ds:0' , hash : '7' , data : ${JSON.stringify(data)} , sideChannel : {} });</script>`;
function dataOf(geo = 'SG'): unknown[] {
  const match = fixture(geo).match(/data\s*:\s*(\[.*\])\s*,\s*sideChannel/s);
  if (!match) throw new Error('fixture has no ds:0 data');
  return JSON.parse(match[1]);
}
function protocolCode(fn: () => unknown): string | undefined {
  try { fn(); } catch (error) { return (error as { code?: string }).code; }
}
describe('Trending Now offline', () => {
  it.each(['SG', 'US', 'JP'])('parses the %s live page', geo => {
    const rows = parseTrendingResponse(fixture(geo));
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3]);
    expect(rows.every(r => r.geo === geo && !isNaN(Date.parse(r.startedAt)))).toBe(true);
    expect(rows[0].newsCount).toBeGreaterThan(0);
  });
  it('gets the exact page request and filters without changing ranks', async () => {
    const response = await fetchTrending({ geo: 'sg', minVolume: 5000, categories: [17], limit: 1 }, { ...opts, transport: async req => {
      expect(req.method).toBe('GET');
      expect(req.body).toBeUndefined();
      expect(req.url).toBe('https://trends.google.com/trending?geo=SG&hours=24&hl=en');
      expect(req.headers.accept).toContain('text/html');
      expect(req.headers['user-agent']).toContain('Mozilla/5.0');
      expect(req.timeoutMs).toBe(15_000);
      return transport(req);
    } });
    expect(response.status).toBe('ok');
    expect(response.items[0]).toMatchObject({ rank: 3, volume: 5000, volumeLabel: '5K+', categories: ['Sports'], active: true, endedAt: null });
    expect(response.meta.upstreamRequests).toBe(1);
  });
  it('passes hours and language through and keeps an empty page valid', async () => {
    const seen: string[] = [];
    const empty = await fetchTrending({ geo: 'DE', hours: 168, lang: 'de' }, { ...opts, transport: async req => {
      seen.push(req.url);
      return { status: 200, headers: {}, body: page([null, []]) };
    } });
    expect(seen).toEqual(['https://trends.google.com/trending?geo=DE&hours=168&hl=de']);
    expect(empty).toMatchObject({ status: 'ok', items: [], meta: { upstreamRequests: 1 } });
    expect(empty.error).toBeUndefined();
  });
  it('handles ended trends, unknown categories and volume labels', () => {
    const data = dataOf();
    const rows = data[1] as unknown[][];
    rows[0]![4] = [1793339400]; rows[0]![10] = [18, 999];
    const item = parseTrendingResponse(page(data))[0];
    expect(item).toMatchObject({ active: false, endedAt: '2026-10-30T05:50:00.000Z', categoryIds: [18, 999], categories: ['Technology', 'Category 999'] });
    rows[0]![4] = 1793339400;
    expect(parseTrendingResponse(page(data))[0].endedAt).toBe(item.endedAt);
    expect([200, 20000, 1500000].map(trendingVolumeLabel)).toEqual(['200+', '20K+', '1.5M+']);
  });
  it('treats missing, null, or malformed ds:0 payloads as protocol changes', async () => {
    expect(protocolCode(() => parseTrendingResponse('<html>consent</html>'))).toBe('TRENDS_PROTOCOL_CHANGED');
    expect(protocolCode(() => parseTrendingResponse(page([null, null])))).toBe('TRENDS_PROTOCOL_CHANGED');
    const malformed = dataOf();
    (malformed[1] as unknown[][])[0]![12] = 42;
    expect(protocolCode(() => parseTrendingResponse(page(malformed)))).toBe('TRENDS_PROTOCOL_CHANGED');
    const r = await fetchTrending({ geo: 'US' }, { transport: async () => ({ status: 200, headers: {}, body: '<html>no payload</html>' }) });
    expect(r.status).toBe('error');
    expect(r.error?.code).toBe('TRENDS_PROTOCOL_CHANGED');
    expect(r.error?.message).toMatch(/ds:0|endpoint may have changed/);
  });
  it.each([[429, '', 'RATE_LIMITED'], [200, '<html>captcha</html>', 'BLOCKED'], [200, 'unusual traffic', 'BLOCKED'], [200, 'garbage', 'TRENDS_PROTOCOL_CHANGED']])('maps upstream %s %s', async (status, body, code) => {
    const r = await fetchTrending({ geo: 'US' }, { transport: async () => ({ status: Number(status), body: String(body), headers: { 'retry-after': '30' } }) });
    expect(r.error?.code).toBe(code);
    if (status === 429) expect(r.error?.retryAfterSec).toBe(30);
  });
  it('does not mistake the live page\'s reCAPTCHA badge CSS for a challenge', async () => {
    const body = `<style>.grecaptcha-badge{visibility:hidden}</style>${fixture('US')}`;
    const r = await fetchTrending({ geo: 'US' }, { transport: async () => ({ status: 200, body, headers: {} }), minIntervalMs: 0 });
    expect(r.status).toBe('ok');
    expect(r.items).toHaveLength(3);
  });
  it.each(['TimeoutError', 'AbortError', 'Error'])('maps transport %s', async name => {
    const r = await fetchTrending({ geo: 'JP' }, { transport: async () => { const e = new Error('offline'); e.name = name; throw e; } });
    expect(r.error?.code).toBe(name === 'Error' ? 'NETWORK_ERROR' : 'TRENDS_TIMEOUT');
  });
  it('retries a bounded 429 before parsing Trending Now', async () => {
    let calls = 0, now = 0;
    const sleeps: number[] = [];
    const r = await fetchTrending({ geo: 'SG' }, { minIntervalMs: 0, maxRetries: 1, now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; }, transport: async req => {
      if (++calls === 1) return { status: 429, body: '', headers: { 'retry-after': '2' } };
      return transport(req);
    } });
    expect(r.status).toBe('ok');
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
    expect(r.meta.upstreamRequests).toBe(2);
  });
  it('rejects invalid input before transport', async () => {
    for (const input of [{ geo: 'ZZ' }, { geo: 'SG', hours: 12 }, { geo: 'SG', minVolume: -1 }, { geo: 'SG', limit: NaN }]) {
      const r = await fetchTrending(input as Parameters<typeof fetchTrending>[0], opts);
      expect(r.error?.code).toBe('INVALID_INPUT'); expect(r.meta.upstreamRequests).toBe(0);
    }
    expect(DEFAULT_TRENDING_GEOS).toHaveLength(30);
    expect(new Set(TRENDING_GEOS.map(g => g.code)).size).toBe(TRENDING_GEOS.length);
  });
  it('uppercases, dedupes in order, and caps explicit geos at 30', async () => {
    expect(normalizeTrendingGeos([' us', 'US', 'Gb', 'sg'])).toEqual(['US', 'GB', 'SG']);
    expect(normalizeTrendingGeos('default')).toHaveLength(30);
    expect(normalizeTrendingGeos('all')).toEqual(TRENDING_GEOS.map(g => g.code));
    expect(() => normalizeTrendingGeos(TRENDING_GEOS.slice(0, 31).map(g => g.code))).toThrow(/at most 30/);
    const calls: string[] = [];
    const batch = await listTrending({ geos: ['sg', 'SG', 'us'] }, { ...opts, transport: async req => { calls.push(req.url); return transport(req); } });
    expect(batch.summary).toEqual({ geos: 2, ok: 2, failed: 0 });
    expect(calls).toEqual([
      'https://trends.google.com/trending?geo=SG&hours=24&hl=en',
      'https://trends.google.com/trending?geo=US&hours=24&hl=en',
    ]);
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
  it('stops on rate limit and can opt out', async () => {
    let calls = 0, clock = 0;
    const limited: Transport = async req => ++calls === 2 ? { status: 429, headers: { 'retry-after': '30' }, body: '' } : transport(req);
    const timed = { ...opts, transport: limited, now: () => clock, sleep: async (ms: number) => { clock += ms; } };
    const batch = await listTrending({ geos: ['SG', 'US', 'JP'] }, timed);
    expect(calls).toBe(2); expect(batch.status).toBe('partial');
    expect(batch.results[1].error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 30 });
    expect(batch.results[2].error).toEqual({ code: 'RATE_LIMITED', message: 'skipped after upstream rate limit' });
    calls = 0; clock = 0;
    await listTrending({ geos: ['SG', 'US', 'JP'] }, { ...timed, stopOnBlocked: false });
    expect(calls).toBe(3);
  });
  it('diffs by normalized query', async () => {
    const prev = await fetchTrending({ geo: 'SG' }, opts);
    const next = structuredClone(prev);
    next.items.shift(); next.items[0].volume++; next.items[0].query = ` ${next.items[0].query.toUpperCase()} `;
    next.items.push({ ...prev.items[0], query: 'new' });
    const diff = diffTrending(prev, next);
    expect(diff.added.map(i => i.query)).toEqual(['new']); expect(diff.removed).toHaveLength(1); expect(diff.rising).toHaveLength(1); expect(diff.unchanged).toBe(1);
  });
  it('supports CLI flags, output and exit codes using a fake transport', async () => {
    const r = await runTrendingCli(['--geo', 'sg', '--hours', '24', '--category', '18,17', '--limit', '1', '--min-volume', '5000', '--lang', 'en', '--pretty'], opts);
    expect(r.code).toBe(0); expect(JSON.parse(r.stdout).items[0].rank).toBe(3);
    expect((await runTrendingCli(['--geo', 'SG,US', '--format', 'csv'], opts)).stdout).toContain('volumeLabel');
    expect((await runTrendingCli(['--list-geos'], opts)).stdout).toContain('Singapore');
    expect((await runTrendingCli(['--default-geos'], opts)).code).toBe(0);
    expect((await runTrendingCli(['--all-geos'], opts)).code).toBe(0);
    expect((await runTrendingCli(['--geo', 'us,US,gb', '--json'], opts)).stdout).toContain('"geos":["US","GB"]');
    const tooMany = TRENDING_GEOS.slice(0, 31).map(g => g.code).join(',');
    for (const args of [[], ['--geo', 'ZZ'], ['--geo', 'SG', '--hours', '12'], ['--geo', 'SG', '--category', 'x'], ['--geo', 'SG', '--all-geos'], ['--geo', tooMany]]) expect((await runTrendingCli(args, opts)).code).toBe(4);
    for (const [body, status, code] of [['captcha', 200, 3], ['', 429, 3], ['garbage', 200, 1]] as const) expect((await runTrendingCli(['--geo', 'SG'], { transport: async () => ({ status, body, headers: {} }) })).code).toBe(code);
    const ok = await fetchTrending({ geo: 'SG' }, opts); const fail = { ...ok, status: 'error' as const, error: { code: 'NETWORK_ERROR' as const, message: 'offline' } };
    expect(trendingExitCode([ok, fail])).toBe(2);
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
