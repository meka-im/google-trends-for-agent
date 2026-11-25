import { describe, expect, it } from 'vitest';
import { formatGTrendsExport } from '../src/export.js';
const result = {
  status: 'partial', input: { queries: ['猫 😺', '=HYPERLINK("https://bad")'], geo: 'US', timeRange: 'today 12-m' },
  data: {
    interestOverTime: { timeline: [{ time: '2026-09-01T00:00:00Z', formattedTime: 'Sep 1', values: [0, 20], formattedValues: ['0', '20'], hasData: [true, true], isPartial: false }], averages: [0, 20] },
    interestBySubregion: { resolution: 'REGION', valueMode: 'PERCENTAGES', omittedNoDataRows: 3, rows: [{ geoCode: 'US-CA', geoName: '<img src=x onerror=alert(1)>', values: [null, 100], formattedValues: ['', '100%'], hasData: [false, true] }] },
    relatedQueriesByQuery: [{ query: '猫 😺', top: [{ query: ' +SUM(1,2)', value: 100, formattedValue: '100' }], rising: [{ query: 'x', value: 9999, formattedValue: 'Breakout' }] }, { query: '=HYPERLINK("https://bad")', top: null, rising: null }],
    relatedTopics: { top: [{ mid: '/m/cat', title: '猫 & 犬', type: 'Animal', value: 100, formattedValue: '100', link: 'https://trends.google.com/trends/explore?q=/m/cat' }], rising: [] },
    interestByCity: null,
    interestByMetro: { resolution: 'DMA', valueMode: 'RELATIVE', omittedNoDataRows: 0, rows: [{ geoCode: 'US-CA-807', geoName: 'San Francisco-Oakland-San Jose CA', values: [10, 0], formattedValues: ['10', '0'], hasData: [true, true] }] },
  }, meta: { fetchedAt: '2026-10-08T10:00:00Z', warnings: ['relatedQueries: failed second keyword'], cached: false },
};
const batch = { status: 'partial', results: [{ index: 0, input: result.input, status: 'partial', httpStatus: 200, result }, { index: 1, input: { queries: ['failed'] }, status: 'error', httpStatus: 503, error: { code: 'TRENDS_TEMPORARILY_UNAVAILABLE', error: 'try later', retryAfterSec: 12 } }, { index: 2, input: { queries: ['later'] }, status: 'unprocessed', httpStatus: 0, error: { code: 'BUDGET_EXCEEDED', error: 'remaining budget exhausted' } }], meta: { total: 3, processed: 2, unprocessed: 1 } };
const text = async (format: 'csv' | 'html' | 'xml', body: unknown = batch) => String((await formatGTrendsExport(body, format)).body);
function csvRows(csv: string): Record<string, string>[] {
  // Fixtures have no embedded newlines; parse RFC-4180 quoting and commas.
  const lines = csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replace(/""/g, '"')));
  return lines.slice(1).map(values => Object.fromEntries(lines[0].map((key, index) => [key, values[index]])));
}


describe('Google Trends exports', () => {
  it('CSV separates keywords and metrics, preserves zeros/nulls, and escapes formulas', async () => {
    const csv = await text('csv');
    const rows = csvRows(csv);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const points = rows.filter(row => row.type === 'timeline' && row.time);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ keyword: '猫 😺', value: '0', hasData: 'true' });
    expect(points[1].keyword).toBe('\'=HYPERLINK("https://bad")');
    const geo = rows.filter(row => row.type === 'geo');
    expect(geo[0]).toMatchObject({ value: '', hasData: 'false', resolution: 'REGION', valueMode: 'PERCENTAGES' });
    expect(geo[1].value).toBe('100');
    expect(geo.find(row => row.dataType === 'interestByMetro')).toMatchObject({ resolution: 'DMA', geoCode: 'US-CA-807', value: '10' });
    expect(rows.find(row => row.type === 'related_queries' && row.metric === 'top')).toMatchObject({ keyword: '猫 😺', query: "' +SUM(1,2)", valueMode: 'RELATIVE' });
    expect(rows.find(row => row.type === 'related_queries' && row.metric === 'rising')).toMatchObject({ formattedValue: 'Breakout', valueMode: 'SOURCE_GROWTH' });
    expect(rows.some(row => row.path === 'data.relatedQueriesByQuery.top' && row.queryIndex === '1' && row.value === '')).toBe(true);
    expect(rows.find(row => row.type === 'errors')).toMatchObject({ resultIndex: '1', 'input.queries[0]': 'failed', 'error.retryAfterSec': '12' });
    expect(rows.find(row => row.type === 'unprocessed')).toMatchObject({ resultIndex: '2', 'error.code': 'BUDGET_EXCEEDED' });
    expect(rows.find(row => row.type === 'related_topics')).toMatchObject({ sourceType: 'Animal', title: '猫 & 犬' });
    expect(csv).toContain('2026-10-08T10:00:00Z');
  });
  it('HTML escapes data and XML preserves scalar types and nested failures', async () => {
    const html = await text('html');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('data-null="true"');
    const xml = await text('xml');
    expect(xml).toContain('<field name="interestByCity"><null/></field>');
    expect(xml).toContain('<number>0</number>');
    expect(xml).toContain('<boolean>false</boolean>');
    expect(xml).toContain('猫 &amp; 犬');
    expect(xml).toContain('TRENDS_TEMPORARILY_UNAVAILABLE');
  });
});
