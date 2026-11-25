import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGTrendsInput, publicInput, canonicalJson, cacheKey, cacheTtlSec, EMPTY_TTL_CAP_SEC, exploreUrl, widgetUrl, refererUrl, acceptLanguage, googleTz, BOOTSTRAP_URL, stripXssi, selectWidgets, cityRequest, parseTimeline, parseGeo, parseRelated, parseRelatedTopics, safeRelatedLink, ProtocolMismatch, GTrendsError, TIME_RANGES } from '../src/core.js';
const FIX = new URL('./fixtures/', import.meta.url);
const fx = (name: string) => readFileSync(new URL(name, FIX), 'utf8');
const NOW = new Date('2026-09-19T12:00:00Z');
const input = (raw: Record<string, unknown>) => parseGTrendsInput(raw, NOW);
const errOf = (fn: () => unknown): GTrendsError => {
  try { fn(); } catch (e) { if (e instanceof GTrendsError) return e; throw e; }
  throw new Error('expected GTrendsError');
};
describe('parseGTrendsInput', () => {
  it('normalizes defaults', () => {
    expect(input({ queries: ['pizza'] })).toEqual({
      maxRetries: 1, queries: ['pizza'], geo: '', timeRange: 'today 12-m', startDate: null, endDate: null, category: 0,
      searchType: 'web', locale: 'en-US', timezoneOffsetMinutes: 0, dataTypes: ['interestOverTime'],
    });
  });

  it('trims and deduplicates queries', () => {
    expect(input({ queries: ['  b ', 'a', 'b', 'a ', 'c'] }).queries).toEqual(['b', 'a', 'c']);
  });

  it('limits distinct query count', () => {
    expect(errOf(() => input({ queries: [] })).code).toBe('INVALID_INPUT');
    expect(errOf(() => input({ queries: ['a', 'b', 'c', 'd', 'e', 'f'] })).code).toBe('INVALID_INPUT');
    expect(input({ queries: ['a', 'b', 'c', 'd', 'e', 'a'] }).queries).toHaveLength(5);
    expect(errOf(() => input({ queries: 'pizza' })).code).toBe('INVALID_INPUT');
    expect(errOf(() => input({ queries: [1] })).code).toBe('INVALID_INPUT');
  });

  it('counts Unicode code points and rejects controls', () => {
    expect(errOf(() => input({ queries: ['   '] })).code).toBe('INVALID_INPUT');
    expect(input({ queries: ['😀'.repeat(100)] }).queries[0]).toHaveLength(200);
    expect(errOf(() => input({ queries: ['😀'.repeat(101)] })).code).toBe('INVALID_INPUT');
    expect(errOf(() => input({ queries: ['a'.repeat(101)] })).code).toBe('INVALID_INPUT');
    expect(errOf(() => input({ queries: [`a${String.fromCharCode(0)}b`] })).code).toBe('INVALID_INPUT');
  });

  it('rejects unknown fields', () => {
    for (const k of ['cookies', 'cookie', 'token', 'headers', 'url', 'relatedTopics', 'region']) {
      expect(errOf(() => input({ queries: ['a'], [k]: 'x' })).code).toBe('INVALID_INPUT');
    }
    expect(errOf(() => parseGTrendsInput([], NOW)).code).toBe('INVALID_INPUT');
    expect(errOf(() => parseGTrendsInput(null, NOW)).code).toBe('INVALID_INPUT');
  });

  it('validates country and region codes', () => {
    expect(input({ queries: ['a'], geo: '' }).geo).toBe('');
    expect(input({ queries: ['a'], geo: 'us' }).geo).toBe('US');
    expect(input({ queries: ['a'], geo: 'US-CA' }).geo).toBe('US-CA');
    expect(input({ queries: ['a'], geo: 'GB-ENG' }).geo).toBe('GB-ENG');
    expect(input({ queries: ['a'], geo: 'US-CA-807' }).geo).toBe('US-CA-807');
    for (const g of ['ZZ', 'USA', 'U', 'US-', 'US-CALIF', 'ZZ-CA', 'US CA', 1]) {
      expect(errOf(() => input({ queries: ['a'], geo: g })).code).toBe('INVALID_INPUT');
    }
  });

  it('validates relative time ranges', () => {
    for (const t of TIME_RANGES) expect(input({ queries: ['a'], timeRange: t }).timeRange).toBe(t);
    for (const t of ['today 2-y', 'now 2-H', 'TODAY 12-M', '', 7]) {
      expect(errOf(() => input({ queries: ['a'], timeRange: t })).code).toBe('INVALID_INPUT');
    }
  });

  it('validates explicit date pairs', () => {
    const d = input({ queries: ['a'], startDate: '2025-01-01', endDate: '2025-12-31' });
    expect([d.timeRange, d.startDate, d.endDate]).toEqual([null, '2025-01-01', '2025-12-31']);
    expect(errOf(() => input({ queries: ['a'], timeRange: 'today 3-m', startDate: '2025-01-01', endDate: '2025-02-01' })).code).toBe('INVALID_COMBINATION');
    expect(errOf(() => input({ queries: ['a'], startDate: '2025-01-01' })).code).toBe('INVALID_INPUT');
    expect(errOf(() => input({ queries: ['a'], startDate: '2025-02-30', endDate: '2025-03-01' })).code).toBe('INVALID_INPUT');
    expect(errOf(() => input({ queries: ['a'], startDate: '2025-3-1', endDate: '2025-03-02' })).code).toBe('INVALID_INPUT');
    expect(errOf(() => input({ queries: ['a'], startDate: '2025-03-02', endDate: '2025-03-01' })).code).toBe('INVALID_INPUT');
    expect(errOf(() => input({ queries: ['a'], startDate: '2003-12-31', endDate: '2004-03-01' })).code).toBe('INVALID_INPUT');
    expect(errOf(() => input({ queries: ['a'], startDate: '2026-09-01', endDate: '2026-09-20' })).code).toBe('INVALID_INPUT');
    expect(input({ queries: ['a'], startDate: '2020-01-01', endDate: '2025-01-01' }).endDate).toBe('2025-01-01');
    expect(input({ queries: ['a'], startDate: '2004-01-01', endDate: '2025-01-02' }).startDate).toBe('2004-01-01');
  });

  it('validates category', () => {
    expect(input({ queries: ['a'], category: 71 }).category).toBe(71);
    for (const c of [-1, 1.5, '71', null, 1e9]) expect(errOf(() => input({ queries: ['a'], category: c })).code).toBe('INVALID_INPUT');
  });

  it('maps search properties', () => {
    for (const s of ['web', 'images', 'news', 'youtube', 'shopping']) expect(input({ queries: ['a'], searchType: s }).searchType).toBe(s);
    for (const s of ['froogle', 'WEB', '']) expect(errOf(() => input({ queries: ['a'], searchType: s })).code).toBe('INVALID_INPUT');
  });

  it('normalizes locale', () => {
    expect(input({ queries: ['a'], locale: 'zh-cn' }).locale).toBe('zh-CN');
    expect(errOf(() => input({ queries: ['a'], locale: 'xx-YY' })).code).toBe('INVALID_INPUT');
  });

  it('validates timezone offsets', () => {
    expect(input({ queries: ['a'], timezoneOffsetMinutes: 480 }).timezoneOffsetMinutes).toBe(480);
    expect(input({ queries: ['a'], timezoneOffsetMinutes: -840 }).timezoneOffsetMinutes).toBe(-840);
    for (const t of [841, -841, 1.5, '480']) expect(errOf(() => input({ queries: ['a'], timezoneOffsetMinutes: t })).code).toBe('INVALID_INPUT');
  });

  it('sorts and deduplicates data types', () => {
    expect(input({ queries: ['a'], dataTypes: ['relatedQueries', 'interestOverTime', 'relatedQueries', 'interestByCity', 'interestBySubregion'] }).dataTypes)
      .toEqual(['interestByCity', 'interestBySubregion', 'interestOverTime', 'relatedQueries']);
    expect(input({ queries: ['a'], dataTypes: ['relatedTopics'] }).dataTypes).toEqual(['relatedTopics']);
    expect(errOf(() => input({ queries: ['a'], dataTypes: [] })).code).toBe('INVALID_INPUT');
    expect(errOf(() => input({ queries: ['a'], dataTypes: ['timeline'] })).code).toBe('INVALID_INPUT');
  });

  it('preserves comparison keyword order', () => {
    expect(input({ queries: ['a', 'b'], dataTypes: ['interestOverTime', 'relatedQueries'] }).queries).toEqual(['a', 'b']);
    expect(input({ queries: ['a', ' a'], dataTypes: ['relatedQueries'] }).queries).toEqual(['a']);
  });

  it('echoes only the selected time representation', () => {
    expect(publicInput(input({ queries: ['a'] }))).not.toHaveProperty('startDate');
    const p = publicInput(input({ queries: ['a'], startDate: '2025-01-01', endDate: '2025-02-01' }));
    expect(p).not.toHaveProperty('timeRange');
    expect(p).toMatchObject({ startDate: '2025-01-01', endDate: '2025-02-01' });
  });

  it('maps public errors to HTTP status', () => {
    const cases: Array<[GTrendsError['code'], number]> = [
      ['INVALID_INPUT', 400], ['INVALID_COMBINATION', 400], ['REQUEST_TOO_LARGE', 413], ['RATE_LIMITED', 429],
      ['TRENDS_PROTOCOL_CHANGED', 502], ['TRENDS_TEMPORARILY_UNAVAILABLE', 503], ['TRENDS_TIMEOUT', 504],
    ];
    for (const [code, http] of cases) expect(new GTrendsError(code, 'x').httpStatus).toBe(http);
    expect(new GTrendsError('RATE_LIMITED', 'x', 30).toBody()).toEqual({ status: 'error', code: 'RATE_LIMITED', error: 'x', retryAfterSec: 30 });
  });
});


describe('Cache keys and TTL', () => {
  it('canonicalizes data type order for cache keys', async () => {
    const a = await cacheKey(input({ queries: ['x', 'y'], dataTypes: ['interestBySubregion', 'interestOverTime'] }));
    const b = await cacheKey(input({ queries: ['x', 'y'], dataTypes: ['interestOverTime', 'interestBySubregion', 'interestOverTime'] }));
    const c = await cacheKey(input({ queries: ['y', 'x'], dataTypes: ['interestBySubregion', 'interestOverTime'] }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^gtrends:v2:[0-9a-f]{64}$/);
  });

  it('includes every data parameter in cache keys', async () => {
    const base = { queries: ['x'] };
    const keys = await Promise.all([
      base, { ...base, geo: 'US' }, { ...base, timeRange: 'today 3-m' }, { ...base, startDate: '2025-01-01', endDate: '2025-02-01' },
      { ...base, category: 71 }, { ...base, searchType: 'news' }, { ...base, locale: 'ja' }, { ...base, timezoneOffsetMinutes: 480 },
      { ...base, dataTypes: ['interestByCity'] },
    ].map((r) => cacheKey(input(r))));
    expect(new Set(keys).size).toBe(keys.length);
    expect(JSON.parse(canonicalJson(input(base)))).toEqual({
      queries: ['x'], dataTypes: ['interestOverTime'], geo: '', time: 'today 12-m', category: 0, searchType: 'web', locale: 'en-US', timezoneOffsetMinutes: 0,
    });
  });

  it('sets TTL by time range', () => {
    const ttl = (timeRange: string) => cacheTtlSec(input({ queries: ['x'], timeRange }), false, NOW);
    expect(ttl('now 1-H')).toBe(300);
    expect(ttl('now 4-H')).toBe(600);
    expect(ttl('now 1-d')).toBe(900);
    expect(ttl('now 7-d')).toBe(3600);
    expect(ttl('today 1-m')).toBe(3 * 3600);
    expect(ttl('today 3-m')).toBe(6 * 3600);
    expect(ttl('today 12-m')).toBe(86_400);
    expect(ttl('today 5-y')).toBe(86_400);
    expect(ttl('all')).toBe(86_400);
  });

  it('sets historical date TTL', () => {
    const ttl = (startDate: string, endDate: string) => cacheTtlSec(input({ queries: ['x'], startDate, endDate }), false, NOW);
    expect(ttl('2025-01-01', '2025-01-03')).toBe(86_400);
    expect(ttl('2026-09-14', '2026-09-19')).toBe(3600);
    expect(ttl('2026-08-25', '2026-09-19')).toBe(3 * 3600);
    expect(ttl('2026-07-01', '2026-09-18')).toBe(6 * 3600);
    expect(ttl('2025-09-19', '2026-09-19')).toBe(86_400);
  });

  it('caps empty response TTL', () => {
    expect(cacheTtlSec(input({ queries: ['x'] }), true, NOW)).toBe(EMPTY_TTL_CAP_SEC);
    expect(cacheTtlSec(input({ queries: ['x'], timeRange: 'now 1-H' }), true, NOW)).toBe(300);
  });
});

// ---------------------------------------------------------------- URL

describe('Endpoint URLs', () => {
  const reqOf = (url: string) => JSON.parse(new URL(url).searchParams.get('req')!);

  it('constructs explore parameters', () => {
    const i = input({ queries: ['a b', 'tea'], geo: 'US', timeRange: 'now 7-d', category: 71, searchType: 'shopping', locale: 'zh-CN', timezoneOffsetMinutes: 480 });
    const u = new URL(exploreUrl(i));
    expect(u.origin + u.pathname).toBe('https://trends.google.com/trends/api/explore');
    expect(u.searchParams.get('hl')).toBe('zh-CN');
    expect(u.searchParams.get('tz')).toBe('-480');
    expect(reqOf(exploreUrl(i))).toEqual({
      comparisonItem: [{ keyword: 'a b', geo: 'US', time: 'now 7-d' }, { keyword: 'tea', geo: 'US', time: 'now 7-d' }],
      category: 71, property: 'froogle',
    });
    expect(reqOf(exploreUrl(input({ queries: ['a'], startDate: '2025-01-01', endDate: '2025-12-31' }))).comparisonItem[0].time).toBe('2025-01-01 2025-12-31');
    expect(googleTz(input({ queries: ['a'] }))).toBe('0');
    expect(googleTz(input({ queries: ['a'], timezoneOffsetMinutes: -300 }))).toBe('300');
  });

  it('encodes widget tokens', () => {
    const i = input({ queries: ['a'] });
    const u = new URL(widgetUrl('multiline', { x: 1 }, 'T/+=', i));
    expect(u.pathname).toBe('/trends/api/widgetdata/multiline');
    expect(u.searchParams.get('req')).toBe('{"x":1}');
    expect(u.searchParams.get('token')).toBe('T/+=');
  });

  it('bootstrap / referer / accept-language', () => {
    expect(BOOTSTRAP_URL).toBe('https://trends.google.com/trends/?geo=US');
    const r = new URL(refererUrl(input({ queries: ['a', 'b'], geo: 'US', searchType: 'youtube', timeRange: 'today 3-m' })));
    expect(r.pathname).toBe('/trends/explore');
    expect(r.searchParams.get('q')).toBe('a,b');
    expect(r.searchParams.get('gprop')).toBe('youtube');
    expect(acceptLanguage('en-US')).toBe('en-US,en;q=0.9');
    expect(acceptLanguage('ja')).toBe('ja,en;q=0.8');
    expect(acceptLanguage('zh-CN')).toBe('zh-CN,zh;q=0.9,en;q=0.8');
  });
});


describe('XSSI and widget selection', () => {
  it('accepts supported XSSI prefixes', () => {
    expect(stripXssi(")]}'\n{\"a\":1}")).toEqual({ a: 1 });
    expect(stripXssi(")]}',\n{\"a\":1}")).toEqual({ a: 1 });
    for (const b of ['{"a":1}', '<html>Error 429</html>', ")]}'\n{bad", '', undefined]) {
      expect(() => stripXssi(b)).toThrow(ProtocolMismatch);
    }
  });

  const multi = input({ queries: ['chatgpt', 'claude'], geo: 'US', dataTypes: ['interestOverTime', 'interestBySubregion', 'interestByCity'] });
  const single = input({ queries: ['bitcoin'], timeRange: 'today 3-m', dataTypes: ['interestOverTime', 'interestBySubregion', 'relatedQueries'] });

  it('selects widgets by ID', () => {
    const m = selectWidgets(stripXssi(fx('explore-multi.txt')), multi);
    expect([m.timeseries?.id, m.geoMap?.id, m.relatedQueries]).toEqual(['TIMESERIES', 'GEO_MAP', undefined]);
    expect(m.geoMap!.request.dataMode).toBe('PERCENTAGES');
    const s = selectWidgets(stripXssi(fx('explore-single-world.txt')), single);
    expect([s.timeseries?.id, s.geoMap?.id, s.relatedQueries?.id]).toEqual(['TIMESERIES', 'GEO_MAP', 'RELATED_QUERIES']);
  });

  it('rejects mismatched comparison keywords', () => {
    const ex = stripXssi(fx('explore-single-world.txt')) as any;
    ex.widgets.reverse();
    const s = selectWidgets(ex, single);
    expect(s.relatedQueries!.request.keywordType).toBe('QUERY');
    expect(s.timeseries!.request.resolution).toBe('DAY');
  });

  it('validates widget properties', () => {
    const ex = stripXssi(fx('explore-single-world.txt')) as any;
    ex.widgets = ex.widgets.filter((w: any) => w.id !== 'GEO_MAP');
    expect(selectWidgets(ex, input({ queries: ['bitcoin'], timeRange: 'today 3-m' })).geoMap).toBeUndefined();
    expect(() => selectWidgets(ex, single)).toThrow(ProtocolMismatch);
  });

  it('validates related query widgets', () => {
    const ex = () => stripXssi(fx('explore-multi.txt')) as any;
    expect(() => selectWidgets(ex(), input({ queries: ['claude', 'chatgpt'], geo: 'US' }))).toThrow(/keyword order/);
    expect(() => selectWidgets(ex(), input({ queries: ['chatgpt', 'claude', 'gemini'], geo: 'US' }))).toThrow(/width/);
    expect(() => selectWidgets(ex(), input({ queries: ['chatgpt', 'claude'], geo: 'US', searchType: 'news' }))).toThrow(/requestOptions/);
    expect(() => selectWidgets(ex(), input({ queries: ['chatgpt', 'claude'], geo: 'US', category: 5 }))).toThrow(/requestOptions/);
    const noToken = ex();
    delete noToken.widgets.find((w: any) => w.id === 'TIMESERIES').token;
    expect(() => selectWidgets(noToken, multi)).toThrow(/token/);
    expect(() => selectWidgets({}, multi)).toThrow(ProtocolMismatch);
    expect(selectWidgets(ex(), input({ queries: ['ChatGPT', ' Claude '], geo: 'US' })).timeseries?.id).toBe('TIMESERIES');
  });

  it('handles low-volume explore widgets', () => {
    const m = selectWidgets(stripXssi(fx('explore-multi.txt')), multi);
    const c = cityRequest(m.geoMap!);
    expect(c.resolution).toBe('CITY');
    expect(c.includeLowSearchVolumeGeos).toBe(true);
    expect(m.geoMap!.request.resolution).toBe('REGION');
  });
});

describe('parseTimeline', () => {
  it('parses single timeline values', () => {
    const t = parseTimeline(stripXssi(fx('multiline-multi.txt')), 2);
    expect(t.timeline.length).toBeGreaterThan(50);
    expect(t.timeline.every((p) => p.values.length === 2 && p.formattedValues.length === 2 && p.hasData.length === 2)).toBe(true);
    expect(t.averages).toHaveLength(2);
    expect(t.timeline.at(-1)!.isPartial).toBe(true);
    expect(t.timeline[0].isPartial).toBe(false);
    expect(t.timeline[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  });

  it('parses comparison timeline values', () => {
    const t = parseTimeline(stripXssi(fx('multiline-single-custom.txt')), 1);
    expect(t.averages).toBeNull();
    expect(t.timeline[0]).toMatchObject({ time: '2024-12-29T00:00:00.000Z', values: [99] });
    const low = parseTimeline(stripXssi(fx('multiline-single-lowvol.txt')), 1);
    expect(low.timeline.every((p) => !/[\u2009\u202f]/.test(p.formattedTime))).toBe(true);
    expect(low.timeline).toHaveLength(58);
    expect(low.timeline.filter((p) => p.hasData[0]).length).toBe(1);
  });

  it('preserves empty timeline data', () => {
    expect(parseTimeline({ default: { timelineData: [], averages: [] } }, 1)).toEqual({ timeline: [], averages: null });
    expect(() => parseTimeline({ default: {} }, 1)).toThrow(ProtocolMismatch);
    expect(() => parseTimeline({}, 1)).toThrow(ProtocolMismatch);
  });

  it('rejects malformed timeline data', () => {
    const j = stripXssi(fx('multiline-multi.txt'));
    expect(() => parseTimeline(j, 3)).toThrow(/width/);
    const p = { time: '1789257600', formattedTime: 'x', value: [101], formattedValue: ['101'], hasData: [true] };
    expect(() => parseTimeline({ default: { timelineData: [p] } }, 1)).toThrow(/range/);
    const ok = { ...p, value: [5], formattedValue: ['5'], hasData: [true, true].slice(0, 1) };
    expect(() => parseTimeline({ default: { timelineData: [{ ...ok, value: [5, 6], formattedValue: ['5', '6'], hasData: [true, true] }], averages: [1, 2, 3] } }, 2)).toThrow(/averages/);
    expect(() => parseTimeline({ default: { timelineData: [{ ...ok, time: 'soon' }] } }, 1)).toThrow(ProtocolMismatch);
  });
});

describe('parseGeo', () => {
  it('parses percentage region comparisons', () => {
    const g = parseGeo(stripXssi(fx('comparedgeo-region-multi.txt')), 2, { resolution: 'REGION', dataMode: 'PERCENTAGES' });
    expect(g.resolution).toBe('REGION');
    expect(g.valueMode).toBe('PERCENTAGES');
    expect(g.rows.length).toBeGreaterThan(0);
    expect(g.rows.every((r: any) => /^US-[A-Z]{2}$/.test(r.geoCode) && r.values.length === 2 && r.hasData.some(Boolean))).toBe(true);
    expect(g.rows[0].formattedValues[0]).toMatch(/%$/);
  });

  it('counts omitted country rows', () => {
    const j = stripXssi(fx('comparedgeo-country-world.txt')) as any;
    const noData = j.default.geoMapData.filter((r: any) => !r.hasData[0]).length;
    const g = parseGeo(j, 1, { resolution: 'COUNTRY' });
    expect(g.resolution).toBe('COUNTRY');
    expect(g.valueMode).toBe('RELATIVE');
    expect(g.omittedNoDataRows).toBe(noData);
    expect(g.rows.length + noData).toBe(j.default.geoMapData.length);
  });

  it('parses city coordinates', () => {
    const g = parseGeo(stripXssi(fx('comparedgeo-city-single.txt')), 1, { resolution: 'CITY', includeLowSearchVolumeGeos: true });
    expect(g.resolution).toBe('CITY');
    expect(g.rows.length).toBeGreaterThan(10);
    for (const r of g.rows as any[]) {
      expect(r.geoCode).toBeUndefined();
      expect(typeof r.coordinates.lat).toBe('number');
      expect(typeof r.coordinates.lng).toBe('number');
    }
  });

  it('rejects inconsistent geographic rows', () => {
    const region = stripXssi(fx('comparedgeo-region-multi.txt'));
    expect(() => parseGeo(region, 2, { resolution: 'CITY' })).toThrow(/city row/);
    expect(() => parseGeo(region, 1, { resolution: 'REGION' })).toThrow(/width/);
    expect(() => parseGeo(region, 2, { resolution: 'PLANET' })).toThrow(/resolution/);
    expect(() => parseGeo({ default: {} }, 1, { resolution: 'REGION' })).toThrow(ProtocolMismatch);
    expect(parseGeo({ default: { geoMapData: [] } }, 1, { resolution: 'REGION' }).rows).toEqual([]);
  });

  it('parses numeric metro codes', () => {
    const g = parseGeo(stripXssi(fx('comparedgeo-dma-single.txt')), 1, { resolution: 'DMA' });
    expect((g.rows[0] as any).geoCode).toMatch(/^\d+$/);
  });
});

describe('parseRelated', () => {
  it('maps related metrics', () => {
    const r = parseRelated(stripXssi(fx('relatedsearches-single.txt')), ['TOP', 'RISING']);
    expect(r.top.length).toBe(25);
    expect(r.top[0]).toEqual({ query: 'bitcoin price', value: 100, formattedValue: '100' });
    expect(r.rising[0].formattedValue).toBe('Breakout');
    expect(JSON.stringify(r)).not.toContain('link');
  });

  it('respects related metric ordering', () => {
    const j = stripXssi(fx('relatedsearches-single.txt'));
    const a = parseRelated(j, ['TOP', 'RISING']);
    const b = parseRelated(j, ['RISING', 'TOP']);
    expect(b.top).toEqual(a.rising);
  });

  it('distinguishes legitimate empty related data', () => {
    expect(parseRelated(stripXssi(fx('relatedsearches-empty.txt')), ['TOP', 'RISING'])).toEqual({ top: [], rising: [] });
    expect(() => parseRelated({ default: { rankedList: [{ rankedKeyword: [] }] } }, ['TOP', 'RISING'])).toThrow(ProtocolMismatch);
    expect(() => parseRelated({ default: { rankedList: [{ rankedKeyword: [{ query: 1 }] }, { rankedKeyword: [] }] } }, ['TOP', 'RISING'])).toThrow(ProtocolMismatch);
  });
});


