import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/mcp.js';
import { runBaselinesCli } from '../src/baselines-cli.js';
import { createTools, DEFAULTS } from '../src/tools.js';
import { DEFAULT_FILTER } from '../src/filter.js';
import { BASELINE_CATALOG_REVISION, automaticAnchorFor } from '../src/baseline-catalog.js';
import { MEKA_BASELINE_VERSION, setActiveMekaBaselines } from '../src/dsh-baselines.js';
import { GTFA_PUBLIC_ACTOR_ID } from '../src/options.js';
import type { Transport } from '../src/transport.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  setActiveMekaBaselines(null);
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function tempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('cross-surface alignment (API / CLI / MCP / Actor / DSH)', () => {
  it('shares the unified MEKA v1 baseline catalog and now 7-d default across surfaces', () => {
    expect(BASELINE_CATALOG_REVISION).toBe(MEKA_BASELINE_VERSION);
    expect(DEFAULTS.time).toBe('now 7-d');
    expect(DEFAULT_FILTER.time).toBe('now 7-d');
    expect(automaticAnchorFor('now 7-d', 'US')).toBe('sudoku');
    expect(automaticAnchorFor('now 7-d', 'JP')).toBe('テトリス');
    expect(automaticAnchorFor('now 7-d', '')).toBe('stopwatch');
  });

  it('routes MCP tool calls through Apify actor-public when configured with egress + token', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const onDemandFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/runs?')) {
        calls.push({ url: target, body: JSON.parse(String(init?.body)) });
        return Response.json({ data: { id: 'run-1', status: 'SUCCEEDED', defaultKeyValueStoreId: 'store-1' } });
      }
      if (target.endsWith('/records/TOOL_RESPONSE')) {
        return Response.json({
          protocol: 1,
          result: {
            ok: true,
            schemaVersion: 1,
            status: 'ok',
            filter: { geo: 'US', time: 'now 7-d' },
            summary: 'a vs b',
            series: [
              { keyword: 'a', points: [], average: 40, latest: 40, peak: 50 },
              { keyword: 'b', points: [], average: 20, latest: 20, peak: 30 },
            ],
            meta: { fetchedAt: new Date().toISOString(), upstreamRequests: 1, durationMs: 1, warnings: [] },
          },
          snapshots: [],
        });
      }
      throw new Error(`Unexpected URL: ${target}`);
    });

    const server = createServer({
      egress: 'actor-public',
      apifyToken: 'apify_api_test_token',
      onDemand: { fetch: onDemandFetch as unknown as typeof fetch, pollIntervalMs: 0 },
      snapshotDir: await tempDir('gtfa-mcp-egress-'),
      chartDir: null,
    });
    const client = new Client({ name: 'egress-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    cleanups.push(async () => { await client.close(); await server.close(); });
    await Promise.all([server.connect(b), client.connect(a)]);

    const result = await client.callTool({ name: 'trends_compare', arguments: { keywords: ['a', 'b'] } });
    expect(result.isError).not.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(encodeURIComponent(GTFA_PUBLIC_ACTOR_ID));
    expect((calls[0]!.body.toolRequest as { name: string }).name).toBe('trends_compare');
  });

  it('supports trends_compare calibrate=true with multi-tier MEKA batch volume estimation', async () => {
    const start = Date.UTC(2026, 10, 12, 0, 0, 0);
    let lastCount = 1;
    const transport: Transport = async req => {
      if (req.method === 'HEAD') return { status: 200, headers: { 'set-cookie': 'NID=x; Path=/' }, body: '' };
      const url = new URL(req.url);
      if (url.pathname.endsWith('/explore')) {
        const parsed = JSON.parse(url.searchParams.get('req') ?? '{}') as { comparisonItem?: Array<{ keyword: string }> };
        const items = parsed.comparisonItem ?? [];
        lastCount = Math.max(1, items.length);
        return {
          status: 200,
          headers: {},
          body: `)]}'\n${JSON.stringify({
            widgets: [{
              id: 'TIMESERIES',
              token: 'tok',
              request: {
                time: '2026-11-12 2026-11-19',
                resolution: 'HOUR',
                locale: 'en-US',
                requestOptions: { property: '', backend: 'IZG', category: 0 },
                comparisonItem: items.map(item => ({ geo: { country: 'US' }, complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: item.keyword }] } })),
              },
            }],
          })}`,
        };
      }
      if (url.pathname.endsWith('/multiline')) {
        const points = Array.from({ length: 12 }, (_, index) => ({
          time: String(Math.floor((start + index * 3600_000) / 1000)),
          formattedTime: `Nov 12 ${index}:00`,
          formattedAxisTime: `${index}:00`,
          value: Array.from({ length: lastCount }, (_, slot) => slot === 0 ? 50 : 25),
          hasData: Array.from({ length: lastCount }, () => true),
          formattedValue: Array.from({ length: lastCount }, (_, slot) => slot === 0 ? '50' : '25'),
          isPartial: index === 11,
        }));
        return {
          status: 200,
          headers: {},
          body: `)]}',\n${JSON.stringify({ default: { timelineData: points } })}`,
        };
      }
      throw new Error(`Unexpected request: ${req.url}`);
    };

    const compare = createTools({ transport, minIntervalMs: 0 }).find(t => t.name === 'trends_compare')!;
    const output = await compare.execute({ keywords: ['chatgpt'], geo: 'US', time: 'now 7-d', calibrate: true });
    expect(output.ok).toBe(true);
    const batchVolume = output.batchVolume as { complete: boolean; series: Array<{ keyword: string; traffic: { average: number | null }; anchor?: { term: string } }> };
    expect(batchVolume.complete).toBe(true);
    expect(batchVolume.series[0]?.keyword).toBe('chatgpt');
    expect(batchVolume.series[0]?.traffic.average).toBeGreaterThan(0);
    expect(batchVolume.series[0]?.anchor?.term).toBeTruthy();
  });

  it('rescues out-of-range trends_snapshot estimates with automatic second-round multi-tier MEKA retry', async () => {
    const start = Date.UTC(2026, 10, 12, 0, 0, 0);
    let lastKeywords: string[] = [];
    const transport: Transport = async req => {
      if (req.method === 'HEAD') return { status: 200, headers: { 'set-cookie': 'NID=x; Path=/' }, body: '' };
      const url = new URL(req.url);
      if (url.pathname.endsWith('/explore')) {
        const parsed = JSON.parse(url.searchParams.get('req') ?? '{}') as { comparisonItem?: Array<{ keyword: string }> };
        const items = parsed.comparisonItem ?? [];
        lastKeywords = items.map(item => item.keyword);
        return {
          status: 200,
          headers: {},
          body: `)]}'\n${JSON.stringify({
            widgets: [
              {
                id: 'TIMESERIES',
                token: 'tok-ts',
                request: {
                  time: '2026-11-12 2026-11-19',
                  resolution: 'HOUR',
                  locale: 'en-US',
                  requestOptions: { property: '', backend: 'IZG', category: 0 },
                  comparisonItem: items.map(item => ({ geo: { country: 'US' }, complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: item.keyword }] } })),
                },
              },
              ...items.map((item, index) => ({
                id: items.length === 1 ? 'RELATED_QUERIES' : `RELATED_QUERIES_${index}`,
                token: `tok-rq-${index}`,
                request: {
                  restriction: {
                    geo: { country: 'US' },
                    time: '2026-11-12 2026-11-19',
                    complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: item.keyword }] },
                  },
                  metric: ['TOP', 'RISING'],
                  requestOptions: { property: '', backend: 'IZG', category: 0 },
                },
              })),
            ],
          })}`,
        };
      }
      if (url.pathname.endsWith('/multiline')) {
        const hasGmail = lastKeywords.some(k => k.toLowerCase() === 'gmail');
        const points = Array.from({ length: 12 }, (_, index) => {
          const values = lastKeywords.map((keyword, slot) => {
            if (slot === 0) return hasGmail ? 60 : 100;
            if (keyword.toLowerCase() === 'gmail') return 40;
            return 1;
          });
          return {
            time: String(Math.floor((start + index * 3600_000) / 1000)),
            formattedTime: `Nov 12 ${index}:00`,
            formattedAxisTime: `${index}:00`,
            value: values,
            hasData: values.map(() => true),
            formattedValue: values.map(String),
            isPartial: index === 11,
          };
        });
        return { status: 200, headers: {}, body: `)]}',\n${JSON.stringify({ default: { timelineData: points } })}` };
      }
      if (url.pathname.endsWith('/relatedsearches')) {
        return { status: 200, headers: {}, body: `)]}',\n${JSON.stringify({ default: { rankedList: [{ rankedKeyword: [] }, { rankedKeyword: [] }] } })}` };
      }
      throw new Error(`Unexpected request: ${req.url}`);
    };

    const snapshotTool = createTools({
      transport,
      minIntervalMs: 0,
      snapshotDir: await tempDir('gtfa-snap-retry-'),
      chartDir: null,
    }).find(t => t.name === 'trends_snapshot')!;
    const output = await snapshotTool.execute({ term: 'mega-term', geo: 'US', time: 'now 7-d' });
    expect(output.ok).toBe(true);
    const calibration = output.calibration as { status: string; rounds: string[][] };
    expect(calibration.rounds).toHaveLength(2);
    expect(calibration.rounds[0]).toEqual(['sudoku']);
    expect(calibration.rounds[1]).toContain('gmail');
    expect(calibration.status).toBe('ok');
    expect((output.anchor as { term: string }).term).toBe('gmail');
    expect((output.traffic as { average: number | null }).average).toBeGreaterThan(500_000);
  });

  it('supports gtfa baselines status and --sync via CLI', async () => {
    const dir = await tempDir('gtfa-baselines-cli-');
    const before = await runBaselinesCli(['--store', dir, '--json']);
    expect(before.code).toBe(0);
    expect(JSON.parse(before.stdout)).toMatchObject({ source: 'bundled', version: MEKA_BASELINE_VERSION });

    const synced = await runBaselinesCli(['--sync', '--store', dir, '--json'], {
      fetch: (async () => Response.json({
        schemaVersion: 1,
        version: '2026-11-28',
        regions: [{
          geo: 'US',
          anchors: [{ term: 'sudoku', dailySearches: 90000, validation: { '7d': { pointCount: 168, nonzeroPoints: 168, peak: 85 } } }],
        }],
      })) as unknown as typeof fetch,
    });
    expect(synced.code).toBe(0);
    expect(JSON.parse(synced.stdout)).toMatchObject({
      ok: true,
      updated: true,
      status: { source: 'synced', version: '2026-11-28', count: 1 },
    });
  });
});
