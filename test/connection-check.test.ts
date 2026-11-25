import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_FILTER, CONNECTION_KEYWORDS, summarizeConnectionProbe } from '../src/connection-check.js';
import { diagnoseConnection } from '../src/dsh-routes.js';
import type { Transport } from '../src/transport.js';

const instant = '2026-11-16T00:00:00.000Z';
function comparison() {
  return { ok: true, schemaVersion: 1, status: 'ok', filter: { ...CONNECTION_FILTER }, meta: { fetchedAt: instant },
    series: CONNECTION_KEYWORDS.map(keyword => ({ keyword, points: [{ t: instant, value: 50 }] })) };
}
const head: Transport = async () => ({ status: 200, headers: {}, body: '' });
afterEach(() => vi.restoreAllMocks());

describe('connection diagnostics', () => {
  it('uses the production local parser to fetch all three terms in one fresh comparison', async () => {
    const exploreText = readFileSync(new URL('./fixtures/explore-multi.txt', import.meta.url), 'utf8');
    const explore = JSON.parse(exploreText.slice(exploreText.indexOf('{')));
    const widget = explore.widgets.find((widget: { id: string }) => widget.id === 'TIMESERIES');
    widget.request.comparisonItem = CONNECTION_KEYWORDS.map(keyword => ({ geo: { country: 'US' }, complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: keyword }] } }));
    const transport = vi.fn(async (request: Parameters<Transport>[0]) => {
      if (request.method === 'HEAD') return { status: 200, headers: {}, body: '' };
      const path = new URL(request.url).pathname;
      if (path.endsWith('/explore')) {
        const query = JSON.parse(new URL(request.url).searchParams.get('req')!);
        expect(query.comparisonItem.map((item: { keyword: string }) => item.keyword)).toEqual(CONNECTION_KEYWORDS);
        return { status: 200, headers: {}, body: ")]}'\n" + JSON.stringify({ widgets: [widget] }) };
      }
      expect(path).toContain('/multiline');
      return { status: 200, headers: {}, body: ")]}'\n" + JSON.stringify({ default: { timelineData: [
        { time: '1794787200', formattedTime: 'Nov 16', value: [50, 20, 100], formattedValue: ['50', '20', '100'], hasData: [true, true, true] },
      ] } }) };
    });
    const result = await diagnoseConnection({ egress: 'local', localTransport: transport });
    expect(result).toMatchObject({ ok: true, network: { ok: true, status: 200 }, data: { ok: true, keywords: CONNECTION_KEYWORDS.map(keyword =>
      ({ keyword, status: 'ok', points: 1, nonzeroPoints: 1 })) } });
    expect(transport.mock.calls.filter(([request]) => request.url.includes('/explore'))).toHaveLength(1);
    expect(transport.mock.calls.filter(([request]) => request.url.includes('/multiline'))).toHaveLength(1);
  }, 15000);

  it.each([429, 503])('never retries a data probe after upstream HTTP %i', async status => {
    const transport = vi.fn(async (request: Parameters<Transport>[0]) => request.method === 'HEAD'
      ? { status: 200, headers: {}, body: '' } : { status, headers: {}, body: '' });
    const result = await diagnoseConnection({ egress: 'local', localTransport: transport });
    expect(result.ok).toBe(false);
    expect(result.network.ok).toBe(true);
    expect(result.data.code).toBe(status === 429 ? 'rate-limited' : 'network');
    expect(transport.mock.calls.filter(([request]) => request.method !== 'HEAD')).toHaveLength(1);
  }, 15000);

  it.each([429, 403])('stops before keyword queries on preflight HTTP %i', async status => {
    const probe = vi.fn(async () => comparison());
    const result = await diagnoseConnection({ egress: 'local', localTransport: async () => ({ status, headers: {}, body: status === 403 ? 'unusual traffic captcha' : '' }), connectionProbe: probe });
    expect(result).toMatchObject({ ok: false, network: { ok: false }, data: { ok: false } });
    expect(result.data.keywords.every(check => check.status === 'skipped')).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it('keeps network success separate from zero, absent and malformed keyword data', async () => {
    const zero = comparison(); zero.series[1]!.points[0]!.value = 0;
    expect(summarizeConnectionProbe(zero, 4)).toMatchObject({ ok: false, code: 'no-data', keywords: [
      { keyword: 'ChatGPT', status: 'ok' }, { keyword: 'Gemini', status: 'no_data' }, { keyword: 'weather', status: 'ok' },
    ] });
    const missing = comparison(); missing.series.pop();
    expect(summarizeConnectionProbe(missing, 1)).toMatchObject({ ok: false, code: 'protocol' });
    const invalid = comparison(); invalid.series[0]!.points[0]!.value = Number.NaN;
    expect(summarizeConnectionProbe(invalid, 1)).toMatchObject({ ok: false, code: 'protocol' });
    const duplicate = comparison(); duplicate.series[2]!.keyword = 'ChatGPT';
    expect(summarizeConnectionProbe(duplicate, 1).ok).toBe(false);
    const wrongGeo = comparison(); wrongGeo.filter.geo = 'GB' as 'US';
    expect(summarizeConnectionProbe(wrongGeo, 1).code).toBe('protocol');
    const result = await diagnoseConnection({ egress: 'local', localTransport: head, connectionProbe: async () => zero });
    expect(result).toMatchObject({ ok: false, network: { ok: true }, code: 'no-data' });
  });

  it('bounds and cancels an in-flight diagnostic instead of returning success', async () => {
    const controller = new AbortController();
    const probe = vi.fn(() => new Promise<unknown>(() => {}));
    const pending = diagnoseConnection({ egress: 'local', localTransport: head, connectionProbe: probe, signal: controller.signal });
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled', network: { ok: true } });
    expect(await diagnoseConnection({ egress: 'local', localTransport: head, connectionProbe: probe, diagnosticTimeoutMs: 5 }))
      .toMatchObject({ ok: false, code: 'timeout' });
  });

  it('starts exactly one bounded cloud probe and returns only validated counts', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      expect(init!.headers).toMatchObject({ authorization: 'Bearer test-secret' });
      if (path.endsWith('/acts/meka.im~google-trends-for-agent/builds/default')) return Response.json({ data: { id: 'build' } });
      if (path.includes('/runs?')) {
        expect(path).toContain('timeout=300&memory=256');
        expect(JSON.parse(String(init!.body))).toMatchObject({ toolRequest: { protocol: 2, name: 'trends_compare',
          input: { keywords: CONNECTION_KEYWORDS, ...CONNECTION_FILTER }, settings: { cache: false, charts: false } } });
        return Response.json({ data: { id: 'run', status: 'SUCCEEDED', defaultKeyValueStoreId: 'store' } });
      }
      expect(path).toContain('/records/TOOL_RESPONSE');
      return Response.json({ protocol: 2, result: { ...comparison(), private: 'test-secret' }, snapshots: [] });
    });
    const result = await diagnoseConnection({ egress: 'actor-public', apifyToken: 'test-secret', fetch: fetch as typeof globalThis.fetch });
    expect(result.ok).toBe(true);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/runs?'))).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('test-secret');
    expect(JSON.stringify(result)).not.toContain('snapshots');
  });

  it('reports an unsupported cloud probe without silently accepting a v1 response', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/runs?')) return Response.json({ data: { id: 'run', status: 'SUCCEEDED', defaultKeyValueStoreId: 'store' } });
      if (String(url).includes('/records/')) return Response.json({ protocol: 1, result: comparison() });
      return Response.json({ data: { taggedBuilds: { latest: { buildId: 'build' } } } });
    });
    expect(await diagnoseConnection({ egress: 'actor-public', apifyToken: 'secret', fetch: fetch as typeof globalThis.fetch }))
      .toMatchObject({ ok: false, code: 'version-mismatch', network: { ok: true } });
  });
});
