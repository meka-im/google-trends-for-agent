import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Config, baselinesFromConfig, register, resolveGtfaSettings } from '../src/dsh.js';
import { ApifyProxyUrlProvider, resolveApifyCredentials } from '../src/egress.js';
import { createTools } from '../src/tools.js';
import type { Transport } from '../src/transport.js';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function askTransport(onExplore?: () => void): Transport {
  return async req => {
    const path = new URL(req.url).pathname;
    if (req.method === 'HEAD') return { status: 200, headers: { 'set-cookie': 'NID=x; Path=/' }, body: '' };
    if (path.endsWith('/explore')) {
      onExplore?.();
      return { status: 200, headers: {}, body: fixture('explore-single-world.txt') };
    }
    if (path.endsWith('/multiline')) return { status: 200, headers: {}, body: fixture('multiline-single-custom.txt') };
    if (path.endsWith('/comparedgeo')) return { status: 200, headers: {}, body: fixture('comparedgeo-country-world.txt') };
    if (path.endsWith('/relatedsearches')) return { status: 200, headers: {}, body: fixture('relatedsearches-single.txt') };
    throw new Error(`unexpected ${path}`);
  };
}

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gtfa-dsh-config-'));
  dirs.push(dir);
  return dir;
}

describe('dsh Config schema', () => {
  it('exposes defaults and the secret role on the Apify token', () => {
    const schema = Config! as unknown as { dict: Record<string, { meta: Record<string, unknown> }> };
    const values = Config!({}) as Record<string, { get(): unknown }>;
    expect(schema.dict.egress.meta.default).toBe('local');
    expect(schema.dict.apifyToken.meta.role).toBe('secret');
    expect(schema.dict.apifyToken.meta.default).toBeUndefined();
    expect(schema.dict.apifyProxyGroup.meta.default).toBe('RESIDENTIAL');
    expect(schema.dict.apifyProxyCountry.meta.default).toBe('US');
    expect(schema.dict.geo.meta.default).toBe('US');
    expect(schema.dict.cache.meta.default).toBe(true);
    expect(values.egress.get()).toBe('local');
    expect(values.apifyProxyGroup.get()).toBe('RESIDENTIAL');
    expect(values.apifyProxyCountry.get()).toBe('US');
    expect(values.geo.get()).toBe('US');
    expect(values.cache.get()).toBe(true);
  });

  it('rejects an unsupported egress value', () => {
    expect(() => Config!({ egress: 'mcp' } as never)).toThrow(/"local" \| "apify"/);
  });

  it('accepts only the shared proxy modes and curated countries', () => {
    expect(resolveGtfaSettings(Config!({ apifyProxyGroup: 'auto' }) as never).apifyProxyGroup).toBe('auto');
    expect(resolveGtfaSettings(Config!({ apifyProxyGroup: 'residential' }) as never).apifyProxyGroup).toBe('RESIDENTIAL');
    expect(() => Config!({ apifyProxyGroup: 'GOOGLE_SERP' } as never)).toThrow(/apifyProxyGroup/);
    expect(resolveGtfaSettings(Config!({ apifyProxyCountry: 'gb' }) as never).apifyProxyCountry).toBe('GB');
    expect(() => Config!({ apifyProxyCountry: 'XX' })).toThrow(/apifyProxyCountry/);
  });

  it('accepts Worldwide (empty geo) and rejects unknown geos', () => {
    expect(resolveGtfaSettings(Config!({ geo: '' }) as never).geo).toBe('');
    expect(resolveGtfaSettings(Config!({ geo: 'gb' }) as never).geo).toBe('GB');
    expect(() => Config!({ geo: 'ZZ' })).toThrow(/geo must be empty/);
  });

  it('validates inline baselines with the shared traffic rules', () => {
    expect(baselinesFromConfig({ anchors: [{ term: 'gpts', geo: 'US', dailySearches: 3500 }] })).toMatchObject({
      version: 2,
      anchors: [{ term: 'gpts', geo: 'US', dailySearches: 3500 }],
    });
    expect(baselinesFromConfig({ anchors: [], windowAnchors: {} })).toBeUndefined();
    expect(() => baselinesFromConfig({ anchors: [{ term: 'gpts', geo: 'US', dailySearches: 3500, tolerance: 2 }] }))
      .toThrow(/tolerance must be a number from 0 to 1/);
    expect(() => baselinesFromConfig({ anchors: [{ term: 'gpts', geo: 'US', dailySearches: 3500 }], windowAnchors: { short: 'chairs' } }))
      .toThrow(/not in anchors or the built-in anchors/);
    expect(Config!({ baselines: { anchors: [{ term: 'gpts', geo: 'US', dailySearches: 3500 }], windowAnchors: { short: 'gpts' } } }))
      .toBeTruthy();
  });

  it('rejects invalid baseline edits at Config time', () => {
    for (const dailySearches of [0, -1]) {
      expect(() => Config!({ baselines: { anchors: [{ term: 'gpts', geo: 'US', dailySearches }] } }))
        .toThrow(/dailySearches must be a positive number/);
    }
    expect(() => Config!({ baselines: { anchors: [{ term: 'gpts', geo: 'US', dailySearches: 3500 }], windowAnchors: { short: 'unknown' } } }))
      .toThrow(/not in anchors or the built-in anchors/);
    expect(() => resolveGtfaSettings(Config!({}) as never)).not.toThrow();
  });

  it('unwraps volatile values into runtime defaults', () => {
    expect(resolveGtfaSettings(Config!({}) as never)).toEqual({
      egress: 'local',
      apifyProxyGroup: 'RESIDENTIAL',
      apifyProxyCountry: 'US',
      geo: 'US',
      cache: true,
      snapshotDir: '.gtfa/snapshots',
      chartDir: '.gtfa/charts',
    });
  });

  it('applies live default geo and cache reads per call', async () => {
    const dir = tempDir();
    let explores = 0;
    let settings = { cache: false, defaultGeo: 'US' };
    const tools = createTools({
      transport: askTransport(() => { explores += 1; }),
      snapshotDir: dir,
      chartDir: null,
      settings: () => settings,
      minIntervalMs: 0,
    });
    const ask = tools.find(tool => tool.name === 'trends_ask')!;
    const first = await ask.execute({ term: 'bitcoin' });
    expect((first.filter as { geo: string }).geo).toBe('US');
    expect(explores).toBe(1);
    await ask.execute({ term: 'bitcoin' });
    expect(explores).toBe(2); // cache: false always fetches fresh
    settings = { cache: true, defaultGeo: 'US' };
    const cached = await ask.execute({ term: 'bitcoin' });
    expect((cached.filter as { geo: string }).geo).toBe('US');
    expect(explores).toBe(2); // cache: true reuses the fresh snapshot
    expect((cached.meta as { cached: boolean }).cached).toBe(true);
    settings = { cache: true, defaultGeo: 'GB' };
    const otherGeo = await ask.execute({ term: 'bitcoin' });
    expect((otherGeo.filter as { geo: string }).geo).toBe('GB');
    expect(explores).toBe(3); // a different geo has no cached snapshot
    settings = { cache: false, defaultGeo: '' };
    const worldwide = await ask.execute({ term: 'bitcoin' });
    expect((worldwide.filter as { geo: string }).geo).toBe('');
    expect(explores).toBe(4);
    const explicitWorldwide = await ask.execute({ term: 'bitcoin', geo: '' });
    expect((explicitWorldwide.filter as { geo: string }).geo).toBe('');
    expect(explores).toBe(5);
  });
});

describe('Apify token resolution', () => {
  it('prefers the configured token, then APIFY_TOKEN, then APIFY_PROXY_PASSWORD', () => {
    vi.stubEnv('APIFY_TOKEN', 'env-token');
    vi.stubEnv('APIFY_PROXY_PASSWORD', 'env-password');
    expect(resolveApifyCredentials({ token: 'config-token' })).toEqual({ token: 'config-token' });
    expect(resolveApifyCredentials()).toEqual({ token: 'env-token' });
    vi.stubEnv('APIFY_TOKEN', '');
    expect(resolveApifyCredentials()).toEqual({ proxyPassword: 'env-password' });
    vi.stubEnv('APIFY_PROXY_PASSWORD', '');
    expect(resolveApifyCredentials()).toEqual({});
  });

  it('builds the proxy URL for residential and automatic datacenter modes', async () => {
    const residential = new ApifyProxyUrlProvider({ proxyPassword: 'secret', group: 'RESIDENTIAL', country: 'gb' });
    expect(await residential.newUrl('s1')).toBe('http://groups-RESIDENTIAL,session-s1,country-GB:secret@proxy.apify.com:8000');
    const automatic = new ApifyProxyUrlProvider({ proxyPassword: 'secret', group: 'auto', country: 'us' });
    expect(await automatic.newUrl('s2')).toBe('http://session-s2,country-US:secret@proxy.apify.com:8000');
    expect(await new ApifyProxyUrlProvider({ proxyPassword: 'secret', group: 'auto' }).newUrl())
      .toBe('http://country-US:secret@proxy.apify.com:8000');
  });

  it('never puts the configured token in a tool envelope or an error message', async () => {
    const token = 'super-secret-apify-token';
    const fetchMock = vi.fn(async () => new Response('nope', { status: 401 }));
    const logged = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const tools = await (async () => {
      const registered: { execute: (args: unknown, exec: { signal?: AbortSignal }) => Promise<Record<string, unknown>> }[] = [];
      const ctx = { tools: { register: (definition: unknown) => registered.push(definition as never) } };
      await register(ctx, { egress: 'apify', apifyToken: token, chartDir: null }, {
        egress: { fetch: fetchMock as unknown as typeof fetch },
        minIntervalMs: 0,
      });
      return registered;
    })();
    const compare = tools.find(tool => (tool as unknown as { name?: string }).name === 'trends_compare');
    const result = await compare!.execute({ keywords: ['alpha', 'beta'] }, { signal: new AbortController().signal });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(String((result.error as { message?: string })?.message)).not.toContain(token);
    for (const spy of logged) expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
  });
});
