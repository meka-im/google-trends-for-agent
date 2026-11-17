import { describe, expect, it, vi } from 'vitest';
import { ApifyActorClient } from '../src/apify-actor.js';
import { OnDemandActorClient } from '../src/actor-on-demand.js';
import { parseActorRuntime } from '../src/actor-runtime.js';
import { runToolRequest } from '../src/actor-request.js';
import { VERSION } from '../src/version.js';
import { BASELINE_CATALOG_REVISION } from '../src/baseline-catalog.js';
import type { GtfaTool } from '../src/tools.js';

const API = 'https://api.apify.com/v2';
const SOURCE = 'https://github.com/meka-im/google-trends-for-agent';
function backend(source: string = SOURCE, owned = true) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).slice(API.length);
    if (path === '/acts?my=1&limit=1000') return Response.json({ data: { items: owned ? [{ id: 'mine', name: 'google-trends-for-agent' }] : [] } });
    if (path === '/acts/mine/builds?desc=1&limit=1') return Response.json({ data: { items: [] } });
    if (path === '/acts/mine/versions/0.1') return Response.json({ data: { sourceType: 'GIT_REPO', gitRepoUrl: source, envVars: [{ name: 'CUSTOM', value: 'keep' }] } });
    if (path === '/acts/mine/builds?version=0.1&tag=latest' && init?.method === 'POST') return Response.json({ data: { id: 'new-build' } });
    throw new Error('Unexpected request');
  });
}
describe('own Actor updates', () => {
  it('starts one official-source build without creating or overwriting an Actor', async () => {
    const fetch = backend();
    const client = new ApifyActorClient({ fetch: fetch as typeof globalThis.fetch });
    expect(await client.updateActor('secret', 'mine')).toEqual({ ok: true, actorId: 'mine', buildId: 'new-build' });
    const mutations = fetch.mock.calls.filter(([, init]) => init?.method !== 'GET');
    expect(mutations).toHaveLength(1);
    expect(mutations[0]![1]!.body).toBeUndefined();
  });
  it.each([`${SOURCE}#fixed-sha`, `${SOURCE}#dev`, 'https://github.com/someone/custom'])('refuses custom or pinned source %s', async source => {
    const fetch = backend(source);
    expect(await new ApifyActorClient({ fetch: fetch as typeof globalThis.fetch }).updateActor('secret', 'mine')).toMatchObject({ ok: false, code: 'unsupported-source' });
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
  it('does no writes for an Actor outside the current account', async () => {
    const fetch = backend(SOURCE, false);
    expect(await new ApifyActorClient({ fetch: fetch as typeof globalThis.fetch }).updateActor('secret', 'mine')).toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not retry an ambiguous build POST or leak credentials', async () => {
    const fetch = backend(); const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, init) => { if (init?.method === 'POST') throw new Error('secret'); return original(url, init); });
    const result = await new ApifyActorClient({ fetch: fetch as typeof globalThis.fetch }).updateActor('secret', 'mine');
    expect(result).toMatchObject({ ok: false, code: 'network' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});

describe('actual Actor runtime metadata', () => {
  it('reports the code version from a completed native tool request', async () => {
    const result = await runToolRequest({ protocol: 1, name: 'trends_compare', input: {} }, {
      snapshotDir: '/unused', chartDir: '/unused',
      create: () => [{ name: 'trends_compare', execute: async () => ({ ok: true }) } as unknown as GtfaTool],
    });
    expect(result).toMatchObject({ runtime: { version: VERSION, baselineCatalogRevision: BASELINE_CATALOG_REVISION } });
  });
  it.each([undefined, { version: 'secret', baselineCatalogRevision: 'today' }, { version: '0.2.23', baselineCatalogRevision: '2026-11-16' }])('normalizes runtime without guessing from buildNumber', async runtime => {
    const fetch = vi.fn(async (url: string | URL | Request) => String(url).includes('/runs?')
      ? Response.json({ data: { id: 'run', status: 'SUCCEEDED', buildNumber: '0.1.1', defaultKeyValueStoreId: 'store' } })
      : Response.json({ protocol: 1, runtime, result: { ok: true }, snapshots: [] }));
    const output = await new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch }).call('secret', 'mine', { protocol: 1, name: 'trends_compare', input: {} });
    expect(output.runtime).toEqual(parseActorRuntime(runtime));
    expect(JSON.stringify(output)).not.toContain('secret');
  });
});
