import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { apply, register, dshParameters, type GtfaConfig } from '../src/dsh.js';
import {
  GTFA_APIFY_OAUTH_SESSION,
  type OAuthCredentialsService,
} from '../src/apify-oauth.js';
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

function askTransport(): Transport {
  return async req => {
    const path = new URL(req.url).pathname;
    if (req.method === 'HEAD') return { status: 200, headers: { 'set-cookie': 'NID=x; Path=/' }, body: '' };
    if (path.endsWith('/explore')) return { status: 200, headers: {}, body: fixture('explore-single-world.txt') };
    if (path.endsWith('/multiline')) return { status: 200, headers: {}, body: fixture('multiline-single-custom.txt') };
    if (path.endsWith('/comparedgeo')) return { status: 200, headers: {}, body: fixture('comparedgeo-country-world.txt') };
    if (path.endsWith('/relatedsearches')) return { status: 200, headers: {}, body: fixture('relatedsearches-single.txt') };
    throw new Error(`unexpected ${path}`);
  };
}

function compareTransport(): Transport {
  return async req => {
    const path = new URL(req.url).pathname;
    if (req.method === 'HEAD') return { status: 200, headers: { 'set-cookie': 'NID=x; Path=/' }, body: '' };
    if (path.endsWith('/explore')) return { status: 200, headers: {}, body: fixture('explore-multi.txt') };
    if (path.endsWith('/multiline')) return { status: 200, headers: {}, body: fixture('multiline-multi.txt') };
    throw new Error(`unexpected ${path}`);
  };
}

function fakeCtx(initialCredentials?: OAuthCredentialsService) {
  interface Registered {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: { schema: unknown; render: (args: unknown, value: unknown) => unknown };
    execute: (args: unknown, exec: { signal?: AbortSignal }) => Promise<Record<string, unknown>>;
  }
  const tools = new Map<string, Registered>();
  let provider: { list(): Promise<{ name: string; description: string }[]>; get(): Promise<{ content: string }> } | undefined;
  const skills = {
    registerProvider(create: () => typeof provider) { provider = create(); return () => {}; },
  };
  let credentials = initialCredentials;
  const ctx = {
    tools: { register: (definition: Registered) => { tools.set(definition.name, definition); } },
    get: (name: string) => name === 'skills' ? skills : name === 'credentials' ? credentials : undefined,
  };
  return {
    ctx,
    tools,
    provider: () => provider,
    setCredentials(value: OAuthCredentialsService | undefined) { credentials = value; },
  };
}

function credentialsWithToken(token?: string): OAuthCredentialsService {
  const refs = new Map<string, string>();
  if (token) refs.set(GTFA_APIFY_OAUTH_SESSION, JSON.stringify({ access_token: token }));
  return {
    async resolve(ref) {
      const value = refs.get(ref);
      return value === undefined ? undefined : { value, source: 'test' };
    },
    async describe(ref) {
      return { configured: refs.has(ref), writable: true };
    },
    async set(ref, value) {
      refs.set(ref, value);
    },
    async unset(ref) {
      refs.delete(ref);
    },
  };
}

function config(extra: Partial<GtfaConfig> = {}): GtfaConfig {
  const dir = mkdtempSync(join(tmpdir(), 'gtfa-dsh-'));
  dirs.push(dir);
  return { egress: 'local', snapshotDir: join(dir, 'snapshots'), chartDir: null, ...extra };
}

function onDemandFixture(tokens: string[] = [], actors: string[] = []) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.includes('/runs?')) {
      tokens.push(String((init!.headers as Record<string, string>).authorization).replace('Bearer ', ''));
      actors.push(decodeURIComponent(new URL(target).pathname.split('/')[3]!));
      return Response.json({ data: { id: 'run', status: 'SUCCEEDED', defaultKeyValueStoreId: 'store' } });
    }
    if (target.endsWith('/records/TOOL_RESPONSE')) return Response.json({ protocol: 1, result: {
      ok: true, schemaVersion: 1, status: 'ok', filter: { geo: 'US', time: 'now 1-d' }, series: [], meta: { fetchedAt: new Date().toISOString() },
    }, snapshots: [] });
    throw new Error('Unexpected Actor request');
  }) as unknown as typeof fetch;
}

describe('dsh plugin registration', () => {
  it('registers exactly the four tools with JSON-schema parameters and renders JSON text', async () => {
    const { ctx, tools } = fakeCtx();
    await apply(ctx, config());
    expect([...tools.keys()].sort()).toEqual(['trends_ask', 'trends_compare', 'trends_now', 'trends_snapshot']);
    expect(Object.keys(tools.get('trends_compare')!.parameters.properties as object).sort()).toEqual(['geo', 'keywords', 'time', 'timeoutMs']);
    for (const tool of tools.values()) {
      expect(tool.description).toMatch(/Output: ok, schemaVersion/);
      expect(tool.parameters).toMatchObject({ type: 'object', properties: expect.any(Object) });
      expect(tool.parameters).not.toHaveProperty('$schema');
      expect(tool.parameters).not.toHaveProperty('minItems');
      const rendered = tool.output.render({}, { ok: true, schemaVersion: 1, status: 'ok' }) as { type: string; text: string }[];
      expect(JSON.parse(rendered[0].text)).toEqual({ ok: true, schemaVersion: 1, status: 'ok' });
    }
    expect(tools.get('trends_now')!.parameters).toMatchObject({
      properties: { geos: { oneOf: expect.any(Array) } },
    });
    expect((tools.get('trends_now')!.parameters.properties as Record<string, Record<string, unknown>>).geos).not.toHaveProperty('anyOf');
  });

  it('still registers tools when the profile has no skills service', async () => {
    const tools = new Map<string, unknown>();
    await apply({ tools: { register: definition => { tools.set((definition as { name: string }).name, definition); } } }, config());
    expect(tools.size).toBe(4);
  });

  it('registers the gtfa skill provider when skills exists', async () => {
    const { ctx, provider } = fakeCtx();
    await apply(ctx, config());
    const listed = await provider()!.list();
    expect(listed.map(skill => skill.name)).toEqual(['gtfa']);
    const skill = listed[0] as unknown as { path: string; resourceBase: { kind: string; path: string } };
    expect(skill.path.endsWith('/dsh/skill.md')).toBe(true);
    expect(existsSync(skill.path)).toBe(true);
    expect(skill.resourceBase).toMatchObject({ kind: 'directory' });
    expect(existsSync(skill.resourceBase.path)).toBe(true);
    expect((await provider()!.get()).content).toMatch(/trends_ask/);
    expect((await provider()!.get()).content).toMatch(/63,000|gpts/);
  });

  it('uses JSON-schema parameters that dsh can validate', () => {
    const params = dshParameters(
      // The shared schemas are the source; this narrow schema covers the union path.
      z.object({ geos: z.union([z.array(z.string()), z.literal('all')]) }),
    );
    expect(params).toMatchObject({ type: 'object', properties: { geos: { oneOf: expect.any(Array) } } });
  });
});

describe('dsh plugin execution', () => {
  it('keeps local egress independent from credentials and OAuth networking', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      const body = path.endsWith('/explore')
        ? fixture('explore-multi.txt')
        : path.endsWith('/multiline')
          ? fixture('multiline-multi.txt')
          : '';
      return new Response(body, { status: 200, headers: { 'set-cookie': 'NID=x; Path=/' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    let credentialReads = 0;
    const skills = { registerProvider: () => () => {} };
    const tools = new Map<string, {
      execute: (args: unknown, exec: { signal?: AbortSignal }) => Promise<Record<string, unknown>>;
    }>();
    const ctx = {
      tools: { register: (definition: { name: string } & typeof tools extends Map<string, infer T> ? T : never) => {
        tools.set(definition.name, definition);
      } },
      get(name: string) {
        if (name === 'skills') return skills;
        if (name === 'credentials') {
          credentialReads++;
          throw new Error('credentials must not be read for local egress');
        }
        return undefined;
      },
    };
    await register(ctx as never, config({ egress: 'local' }), { minIntervalMs: 0 });
    const result = await tools.get('trends_compare')!.execute(
      { keywords: ['chatgpt', 'claude'] },
      { signal: new AbortController().signal },
    );
    expect(result).toMatchObject({ ok: true, status: 'ok' });
    expect(credentialReads).toBe(0);
  });

  it('resolves OAuth for each on-demand run when its token changes', async () => {
    const credentials = credentialsWithToken('oauth-a'), tokens: string[] = [];
    const { ctx, tools } = fakeCtx(credentials);
    await register(ctx, config({ egress: 'actor-own', apifyToken: 'config-token', apifyActor: 'actor-1' }), {
      onDemand: { fetch: onDemandFixture(tokens), pollIntervalMs: 0 },
    });
    const compare = tools.get('trends_compare')!;
    expect(await compare.execute({ keywords: ['chatgpt', 'claude'] }, {})).toMatchObject({ ok: true });
    await credentials.set(GTFA_APIFY_OAUTH_SESSION, JSON.stringify({ access_token: 'oauth-b' }));
    expect(await compare.execute({ keywords: ['chatgpt', 'claude'] }, {})).toMatchObject({ ok: true });
    expect(tokens).toEqual(['oauth-a', 'oauth-b']);
  });

  it('picks up credentials mounted after registration for on-demand runs', async () => {
    const { ctx, tools, setCredentials } = fakeCtx();
    const tokens: string[] = [];
    await register(ctx, config({ egress: 'actor-own', apifyActor: 'actor-1' }), { onDemand: { fetch: onDemandFixture(tokens) } });
    const compare = tools.get('trends_compare')!;
    expect(await compare.execute({ keywords: ['chatgpt', 'claude'] }, {})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    setCredentials(credentialsWithToken('late-oauth'));
    expect(await compare.execute({ keywords: ['chatgpt', 'claude'] }, {})).toMatchObject({ ok: true });
    expect(tokens).toEqual(['late-oauth']);
  });

  it('executes trends_compare against a fixture transport', async () => {
    const { ctx, tools } = fakeCtx();
    await register(ctx, config(), { transport: compareTransport(), minIntervalMs: 0 });
    const result = await tools.get('trends_compare')!.execute({ keywords: ['chatgpt', 'claude'] }, { signal: new AbortController().signal });
    expect(result).toMatchObject({ ok: true, schemaVersion: 1, status: 'ok', filter: { geo: 'US', time: 'now 1-d' } });
    expect((result.series as { keyword: string }[]).map(row => row.keyword)).toEqual(['chatgpt', 'claude']);
  });

  it('executes trends_ask against a fixture transport and writes snapshots', async () => {
    const { ctx, tools } = fakeCtx();
    const cfg = config();
    await register(ctx, cfg, { transport: askTransport(), minIntervalMs: 0 });
    const result = await tools.get('trends_ask')!.execute({ term: 'bitcoin', fresh: true }, { signal: new AbortController().signal });
    expect(result).toMatchObject({ ok: true, schemaVersion: 1, status: 'ok', term: 'bitcoin' });
    expect(result.interest).not.toHaveProperty('points');
  });

  it('returns the shared error envelope when an Actor egress has no token', async () => {
    vi.stubEnv('APIFY_TOKEN', '');
    const { ctx, tools } = fakeCtx();
    await register(ctx, config({ egress: 'actor-own' }));
    const result = await tools.get('trends_compare')!.execute({ keywords: ['a', 'b'] }, { signal: new AbortController().signal });
    expect(result).toMatchObject({
      ok: false,
      status: 'error',
      error: {
        code: 'INVALID_INPUT',
        message: 'Sign in with Apify to run an Actor query.',
      },
    });
  });

  it('returns a clear error when actor-own egress has a token but no Actor', async () => {
    vi.stubEnv('APIFY_TOKEN', '');
    const { ctx, tools } = fakeCtx();
    await register(ctx, config({ egress: 'actor-own', apifyToken: 'apify_api_token', chartDir: null }));
    const result = await tools.get('trends_compare')!.execute({ keywords: ['a', 'b'] }, { signal: new AbortController().signal });
    expect(result).toMatchObject({
      ok: false,
      status: 'error',
      error: { code: 'INVALID_INPUT', message: expect.stringMatching(/Select or deploy your google-trends-for-agent Actor/) },
    });
  });

  it('runs the whole native tool in one on-demand Actor call', async () => {
    const actors: string[] = [], tokens: string[] = [];
    const { ctx, tools } = fakeCtx();
    await register(ctx, config({ egress: 'actor-own', apifyToken: 'apify_api_token', apifyActor: 'actor-1' }), {
      onDemand: { fetch: onDemandFixture(tokens, actors) },
    });
    expect(await tools.get('trends_compare')!.execute({ keywords: ['chatgpt', 'claude'] }, {})).toMatchObject({ ok: true, schemaVersion: 1 });
    expect(actors).toEqual(['actor-1']); expect(tokens).toEqual(['apify_api_token']);
  });

  it('uses the public Actor id for on-demand actor-public queries', async () => {
    const actors: string[] = [];
    const { ctx, tools } = fakeCtx();
    await register(ctx, config({ egress: 'actor-public', apifyToken: 'apify_api_token', chartDir: null }), {
      onDemand: { fetch: onDemandFixture([], actors) },
    });
    expect(await tools.get('trends_compare')!.execute({ keywords: ['chatgpt', 'claude'] }, {})).toMatchObject({ ok: true });
    expect(actors).toEqual(['meka.im~google-trends-for-agent']);
  });

  it('respects an aborted exec.signal', async () => {
    const { ctx, tools } = fakeCtx();
    await register(ctx, config(), { transport: compareTransport(), minIntervalMs: 0 });
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(tools.get('trends_compare')!.execute({ keywords: ['a', 'b'] }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError', message: 'cancelled' });
  });

  it('stops trends_now during the first country when the caller aborts', async () => {
    const { ctx, tools } = fakeCtx();
    const controller = new AbortController();
    let calls = 0;
    const transport: Transport = async () => {
      calls++;
      controller.abort();
      return { status: 200, headers: {}, body: fixture('trending/US-24.html') };
    };
    await register(ctx, config(), { transport, minIntervalMs: 0 });
    await expect(tools.get('trends_now')!.execute({ geos: ['US', 'GB', 'JP'] }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
  });

  it('migrates old egress values instead of rejecting registration', async () => {
    const { ctx } = fakeCtx();
    await expect(register(ctx, config({ egress: 'apify' as never, chartDir: null }))).resolves.toBeUndefined();
    await expect(register(ctx, config({ egress: 'mcp' as never, chartDir: null }))).resolves.toBeUndefined();
  });
});
