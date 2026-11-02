import { describe, expect, it } from 'vitest';
import { parseExploreUrl, parseSheetCsv, planTrendsRequest } from '../src/input.js';

describe('query and URL request planning', () => {
  it('compares by default and separates individual queries', async () => {
    expect((await planTrendsRequest({ queries: ['a', 'b'] })).inputs).toHaveLength(1);
    expect((await planTrendsRequest({ queries: ['a', 'b'], mode: 'individual' })).inputs.map(x => x.queries)).toEqual([['a'], ['b']]);
  });
  it('rejects ambiguous, excessive, or unsupported inputs', async () => {
    for (const raw of [{ queries: ['a'], urls: ['https://trends.google.com/trends/explore?q=b'] }, { queries: Array(21).fill('a'), mode: 'individual' }, { queries: ['a'], spreadsheetId: 'unused' }, { queries: ['a'], format: 'xlsx' }, { queries: ['a'], screenshot: true }]) {
      await expect(planTrendsRequest(raw)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });
  it('URL parameters override base options and decode topic IDs', () => {
    const v = parseExploreUrl('https://trends.google.com/trends/explore?q=%2Fm%2F02mjmr,pizza&geo=GB&date=2025-01-01%202025-02-01&tz=-480&gprop=froogle&cat=12', { geo: 'US', timeRange: 'all' });
    expect(v).toMatchObject({ queries: ['/m/02mjmr', 'pizza'], geo: 'GB', startDate: '2025-01-01', timezoneOffsetMinutes: 480, searchType: 'shopping', category: 12 });
  });
  it('rejects uncontrolled hosts, duplicate parameters and missing keywords', () => {
    for (const url of ['http://trends.google.com/trends/explore?q=a', 'https://trends.google.com.evil.test/trends/explore?q=a', 'https://trends.google.com/trends/api/explore?q=a', 'https://trends.google.com/trends/explore?q=a&q=b', 'https://trends.google.com/trends/explore']) expect(() => parseExploreUrl(url, {})).toThrow();
  });
  it('plans Explore URL lists', async () => {
    const plan = await planTrendsRequest({ urls: ['https://trends.google.com/trends/explore?q=coffee', 'https://trends.google.com/trends/explore?q=tea'] });
    expect(plan.batch).toBe(true);
    expect(plan.inputs.map(i => i.queries)).toEqual([['coffee'], ['tea']]);
  });
  it('parses quoted CSV cells and rejects malformed CSV', () => {
    expect(parseSheetCsv('"a,b","c"\r\n"a""b"\n')).toEqual([['a,b', 'c'], ['a"b']]);
    expect(() => parseSheetCsv('"pizza"bad\n')).toThrow();
  });
});
