import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnDemandActorClient, callActorTool } from '../src/actor-on-demand.js';
import { runToolRequest } from '../src/actor-request.js';
import type { GtfaTool } from '../src/tools.js';
import { SnapshotStore, snapshotDiff, type TermSnapshot } from '../src/snapshot.js';
import { testConnection } from '../src/dsh-routes.js';
import { findAnchor, parseBaselines } from '../src/traffic.js';

const input = { protocol: 1 as const, name: 'trends_ask' as const, input: { term: 'ChatGPT' } };
const envelope = () => ({ ok: true, schemaVersion: 1, status: 'ok', term: 'ChatGPT', diff: null,
  interest: { latest: 50 }, meta: { fetchedAt: new Date().toISOString() } });
const json = (data: unknown, status = 200) => Response.json(data, { status });
const directories: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'gtfa-demand-')); directories.push(path); return path; }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

function service(result = envelope()) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('/runs?')) return json({ data: { id: 'run-1', status: 'RUNNING' } });
    if (String(url).endsWith('/actor-runs/run-1')) return json({ data: { id: 'run-1', status: 'SUCCEEDED', defaultKeyValueStoreId: 'store-1' } });
    if (String(url).endsWith('/records/TOOL_RESPONSE')) return json({ protocol: 1, result, snapshots: [] });
    throw new Error('Unexpected request');
  });
}

describe('on-demand Actor execution', () => {
  it('starts one bounded run, polls it, and returns the complete tool envelope without Standby traffic', async () => {
    const expected = envelope(), fetch = service(expected);
    const result = await new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch, pollIntervalMs: 0 }).call('secret', 'owner~actor', input);
    expect(result.result).toEqual(expected);
    const starts = fetch.mock.calls.filter(([url]) => String(url).includes('/runs?'));
    expect(starts).toHaveLength(1);
    const url = new URL(String(starts[0]![0]));
    expect(url.searchParams.get('timeout')).toBe('300');
    expect(url.searchParams.get('memory')).toBe('256');
    expect(JSON.parse(String(starts[0]![1]!.body))).toEqual({ toolRequest: input });
    expect(fetch.mock.calls.every(([url]) => String(url).startsWith('https://api.apify.com/v2/'))).toBe(true);
  });

  it('aborts the owned run when a caller cancels, using an independent cleanup signal', async () => {
    const caller = new AbortController();
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('/runs?')) { queueMicrotask(() => caller.abort()); return json({ data: { id: 'cancel-me', status: 'RUNNING' } }); }
      expect(String(url)).toContain('/actor-runs/cancel-me/abort?gracefully=false');
      expect(init!.signal!.aborted).toBe(false);
      return json({ data: { status: 'ABORTED' } });
    });
    await expect(new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch, pollIntervalMs: 0 }).call('secret', 'actor', input, caller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('cleans up a known run on a polling failure and does not duplicate paid work', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/runs?')) return json({ data: { id: 'known', status: 'RUNNING' } });
      if (String(url).includes('/abort?')) return json({ data: { status: 'ABORTED' } });
      throw new TypeError('private upstream text');
    });
    await expect(new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch, pollIntervalMs: 0 }).call('secret', 'actor', input))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR', message: 'Could not complete the on-demand Apify run.' });
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/runs?'))).toHaveLength(1);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/actor-runs/known/abort?'))).toBe(true);
  });

  it('does not retry an ambiguous run-start response', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('connection lost'); });
    await expect(new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch }).call('secret', 'actor', input)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('checks only Actor metadata and never starts a run', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.apify.com/v2/acts/actor');
      expect(init!.method).toBe('GET');
      return json({ data: { taggedBuilds: { latest: { buildId: 'build' } } } });
    });
    await new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch }).check('secret', 'actor');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('the production connection check uses metadata and cannot create paid work', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.apify.com/v2/acts/meka.im~google-trends-for-agent');
      expect(init!.method).toBe('GET');
      return json({ data: { taggedBuilds: { latest: { buildId: 'built' } } } });
    });
    expect(await testConnection({ egress: 'actor-public', apifyToken: 'secret', fetch: fetch as typeof globalThis.fetch }))
      .toMatchObject({ ok: true, actorId: 'meka.im~google-trends-for-agent' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses successful snapshots without a cloud run and honors fresh', async () => {
    const fetch = service();
    const client = new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch, pollIntervalMs: 0 });
    const settings = { snapshotDir: await directory(), chartDir: null, cache: true };
    const options = { token: 'secret', actorId: 'actor', name: 'trends_ask' as const, input: { term: 'ChatGPT' }, settings };
    await callActorTool(client, options);
    expect(await callActorTool(client, options)).toMatchObject({ meta: { cached: true } });
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/runs?'))).toHaveLength(1);
    await callActorTool(client, { ...options, input: { ...options.input, fresh: true } });
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/runs?'))).toHaveLength(2);
  });

  it.each([
    { geo: 'CA', anchor: 'sudoku', daily: 12000 },
    { geo: 'JP', anchor: 'ナンプレ', daily: 22000 },
    { geo: 'IN', anchor: 'calculator', daily: 300000 },
    { geo: '', anchor: 'sudoku', daily: 220000 },
  ])('forwards $geo regional calibration to both native cloud tools', async ({ geo, anchor, daily }) => {
    const fetch = service(), client = new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch, pollIntervalMs: 0 });
    for (const name of ['trends_ask', 'trends_snapshot'] as const) {
      await callActorTool(client, { token: 'secret', actorId: 'actor', name,
        input: { term: 'ChatGPT', geo, validate: true, fresh: true },
        settings: { defaultGeo: 'US', snapshotDir: await directory(), chartDir: null },
      });
    }
    const starts = fetch.mock.calls.filter(([url]) => String(url).includes('/runs?'));
    expect(starts).toHaveLength(2);
    for (const [, init] of starts) {
      const request = JSON.parse(String(init!.body)).toolRequest;
      expect(request.input.geo).toBe(geo);
      const baselines = parseBaselines(request.settings.baselines);
      expect(baselines.windowAnchors).toEqual({ short: anchor, long: anchor });
      expect(findAnchor(baselines, anchor, geo)?.dailySearches).toBe(daily);
    }
  });

  it('keeps a user regional override when preparing a calibrated cloud request', async () => {
    const fetch = service();
    await callActorTool(new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch, pollIntervalMs: 0 }), {
      token: 'secret', actorId: 'actor', name: 'trends_ask', input: { term: 'ChatGPT', validate: true },
      settings: { defaultGeo: 'CA', snapshotDir: await directory(), chartDir: null,
        baselines: { version: 2, anchors: [{ term: 'sudoku', geo: ' ca ', dailySearches: 4321, tolerance: 0.2 }] } },
    });
    const start = fetch.mock.calls.find(([url]) => String(url).includes('/runs?'))!;
    const baselines = parseBaselines(JSON.parse(String(start[1]!.body)).toolRequest.settings.baselines);
    expect(findAnchor(baselines, 'sudoku', 'CA')).toMatchObject({ dailySearches: 4321, tolerance: 0.2 });
  });

  it('writes returned charts locally and projects inline SVG according to the caller', async () => {
    const result = { ...envelope(), chart: { path: '/remote/chart.svg', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' } };
    const fetch = service(result);
    const output = await callActorTool(new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch, pollIntervalMs: 0 }), {
      token: 'secret', actorId: 'actor', name: 'trends_snapshot', input: { term: 'ChatGPT', svg: false },
      settings: { snapshotDir: await directory(), chartDir: await directory() },
    });
    const chart = output.chart as { path: string; svg: string };
    expect(chart.path).not.toBe('/remote/chart.svg');
    expect(await readFile(chart.path, 'utf8')).toBe(result.chart.svg);
    expect(chart.svg).toBe('');
  });

  it('never reuses failed or partial results', async () => {
    const fetch = service({ ...envelope(), ok: false, status: 'blocked' });
    const client = new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch, pollIntervalMs: 0 });
    const options = { token: 'secret', actorId: 'actor', name: 'trends_ask' as const, input: { term: 'ChatGPT' }, settings: { snapshotDir: await directory(), chartDir: null } };
    await callActorTool(client, options); await callActorTool(client, options);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/runs?'))).toHaveLength(2);
  });

  it('preserves snapshot history and diffs across separate cloud processes', async () => {
    let response: unknown;
    let number = 0;
    const ids: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('/runs?')) {
        number++;
        const cloudDir = await directory();
        const toolRequest = JSON.parse(String(init!.body)).toolRequest;
        if (number === 2) expect(toolRequest.history).toHaveLength(1);
        response = await runToolRequest(toolRequest, { snapshotDir: cloudDir, chartDir: cloudDir,
          create: () => [{ name: 'trends_ask', execute: async () => {
            const store = new SnapshotStore(cloudDir);
            const snapshot: TermSnapshot = { schema: 'term-snapshot/1', id: randomUUID(), term: 'ChatGPT',
              filter: { geo: 'US', time: 'now 1-d', category: 0, property: '' }, fetchedAt: new Date().toISOString(), status: 'ok',
              interest: { points: [{ time: '2026-11-15T00:00:00Z', value: 50 }], latest: 50, settledLatest: 50, peak: 50 },
              popular: [], rising: [], regions: [] };
            ids.push(snapshot.id); await store.save(snapshot);
            return { ...envelope(), filter: { ...snapshot.filter, property: 'web' }, meta: { fetchedAt: snapshot.fetchedAt, snapshotId: snapshot.id },
              ...snapshotDiff(snapshot, await store.history('ChatGPT', snapshot.filter)) };
          } } as unknown as GtfaTool] });
        return json({ data: { id: `run-${number}`, status: 'SUCCEEDED', defaultKeyValueStoreId: `store-${number}` } });
      }
      return json(response);
    });
    const client = new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch });
    const options = { token: 'secret', actorId: 'actor', name: 'trends_ask' as const, input: { term: 'ChatGPT', fresh: true },
      settings: { snapshotDir: await directory(), chartDir: null } };
    const first = await callActorTool(client, options);
    expect(first.diff).toBeNull();
    const second = await callActorTool(client, options);
    expect(second.diff).toMatchObject({ from: ids[0], to: ids[1] });
    expect(number).toBe(2);
  });
});

describe('one-off native tool request', () => {
  it('requires diagnostic protocol v2 for a no-retry comparison and rejects other probe tools', async () => {
    const execute = vi.fn(async () => ({ ok: true, schemaVersion: 1, status: 'ok' }));
    const create = vi.fn(() => [{ name: 'trends_compare', execute } as unknown as GtfaTool]);
    const probe = { protocol: 2, name: 'trends_compare', input: { keywords: ['ChatGPT', 'Gemini', 'weather'] } };
    expect(await runToolRequest(probe, { snapshotDir: await directory(), chartDir: await directory(), create }))
      .toMatchObject({ protocol: 2, result: { ok: true }, snapshots: [] });
    expect(execute).toHaveBeenCalledExactlyOnceWith(probe.input, { maxRetries: 0 });
    const wrongTool = await runToolRequest({ ...probe, name: 'trends_ask' }, { snapshotDir: await directory(), chartDir: await directory(), create });
    expect(wrongTool.result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('validates the protocol and history before executing a tool', async () => {
    const create = vi.fn(() => []);
    const result = await runToolRequest({ ...input, protocol: 9 }, { snapshotDir: await directory(), chartDir: await directory(), create });
    expect(result.result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('retains tool arguments, runtime defaults and the full response', async () => {
    const execute = vi.fn(async () => envelope());
    const create = vi.fn(settings => {
      expect(settings.defaultGeo).toBe('US'); expect(settings.chartDir).toBeNull();
      return [{ name: 'trends_ask', execute } as unknown as GtfaTool];
    });
    const result = await runToolRequest({ ...input, settings: { charts: false } }, { snapshotDir: await directory(), chartDir: await directory(), create });
    expect(execute).toHaveBeenCalledWith(input.input);
    expect(result).toMatchObject({ protocol: 1, result: { interest: { latest: 50 }, diff: null } });
  });
});
