import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTOR_RUN_LEDGER_LIMIT, ActorRunStore } from '../src/actor-run-ledger.js';
import { OnDemandActorClient, type ActorRunOutcome } from '../src/actor-on-demand.js';
import { register } from '../src/dsh.js';
import { QueryHistoryStore } from '../src/query-history.js';
import { TEST_CONNECTION_PATH } from '../src/dsh-routes.js';
import { CONNECTION_KEYWORDS } from '../src/connection-check.js';

const dirs: string[] = [];
async function makeDir() {
  const dir = await mkdtemp(join(tmpdir(), 'gtfa-ledger-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
});

describe('ActorRunStore and end-to-end Actor ledger', () => {
  it('persists entries, links queries, updates billing, merges legacy runs once, and enforces retention cap', async () => {
    const dir = await makeDir();
    const store = new ActorRunStore(dir);
    await store.record({
      runId: 'run-new-1',
      actorId: 'owner~gtfa',
      egress: 'actor-own',
      purpose: 'query',
      source: 'manual',
      tool: 'trends_compare',
      terms: ['Alpha', 'Beta'],
      geo: 'US',
      time: 'today 1-m',
      status: 'SUCCEEDED',
      toolStatus: 'ok',
      startedAt: '2026-11-20T10:00:00.000Z',
      finishedAt: '2026-11-20T10:00:04.000Z',
      durationMs: 4000,
      costUsd: null,
      queryRecordId: null,
    });
    await store.linkQuery(['run-new-1'], 'q-111');
    await store.updateCost('run-new-1', { costUsd: 0.00025 });
    const persisted = await store.list();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ runId: 'run-new-1', queryRecordId: 'q-111', costUsd: 0.00025 });

    const merged = await store.listMerged([
      {
        id: 'q-111',
        tool: 'trends_compare',
        terms: ['Alpha', 'Beta'],
        geo: 'US',
        time: 'today 1-m',
        source: 'manual',
        egress: 'actor-own',
        status: 'ok',
        cached: false,
        createdAt: '2026-11-20T10:00:00.000Z',
        fetchedAt: '2026-11-20T10:00:04.000Z',
        durationMs: 4000,
        actorRunId: 'run-new-1',
        costUsd: 0.00025,
        errorCode: null,
        volumeRuns: [{ actorRunId: 'legacy-round-1', costUsd: 0.00012, createdAt: '2026-11-20T10:00:10.000Z' }],
      },
      {
        id: 'q-cached',
        tool: 'trends_snapshot',
        terms: ['Alpha'],
        geo: 'US',
        time: 'now 7-d',
        source: 'manual',
        egress: 'actor-own',
        status: 'ok',
        cached: true,
        createdAt: '2026-11-20T10:05:00.000Z',
        fetchedAt: '2026-11-20T10:05:00.000Z',
        durationMs: 25,
        actorRunId: null,
        costUsd: 0,
        errorCode: null,
      },
    ]);
    expect(merged.map(r => r.runId)).toEqual(['legacy-round-1', 'run-new-1']);
    expect(merged[0]).toMatchObject({ purpose: 'batch-round', durationMs: null, legacy: true, costUsd: 0.00012 });

    // Retention limit keeps the newest ACTOR_RUN_LEDGER_LIMIT entries.
    const bulk = Array.from({ length: ACTOR_RUN_LEDGER_LIMIT + 5 }, (_, i) => ({
      runId: `bulk-${i}`,
      actorId: null,
      egress: 'actor-public',
      purpose: 'query',
      source: 'agent',
      tool: 'trends_ask',
      terms: ['test'],
      geo: 'US',
      time: 'now 1-d',
      status: 'SUCCEEDED',
      startedAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
      finishedAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
      durationMs: 100,
      costUsd: 0.0001,
      queryRecordId: null,
    }));
    await writeFile(store.path, JSON.stringify(bulk), 'utf8');
    const retained = await store.list();
    expect(retained).toHaveLength(ACTOR_RUN_LEDGER_LIMIT);
    expect(retained[0]!.runId).toBe(`bulk-${ACTOR_RUN_LEDGER_LIMIT + 4}`);
    expect(retained.at(-1)!.runId).toBe('bulk-5');
  });

  it('invokes finished callback for FAILED, TIMED-OUT, and ABORTED runs without extra HTTP calls', async () => {
    for (const terminal of ['FAILED', 'TIMED-OUT'] as const) {
      const outcomes: ActorRunOutcome[] = [];
      const fetch = vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes('/runs?')) return Response.json({ data: { id: `run-${terminal}`, status: terminal, usageTotalUsd: 0.00017 } });
        throw new Error('Unexpected URL');
      });
      await expect(new OnDemandActorClient({ fetch: fetch as typeof globalThis.fetch }).call(
        'secret', 'actor-1', { protocol: 1, name: 'trends_ask', input: { term: 'AI' } },
        undefined, undefined, undefined, o => { outcomes.push(o); },
      )).rejects.toThrow();
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ runId: `run-${terminal}`, actorId: 'actor-1', status: terminal, usageUsd: 0.00017 });
    }

    const abortController = new AbortController();
    const abortedOutcomes: ActorRunOutcome[] = [];
    const abortFetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/runs?')) {
        queueMicrotask(() => abortController.abort());
        return Response.json({ data: { id: 'abort-run', status: 'RUNNING' } });
      }
      return Response.json({ data: { status: 'ABORTED', usageTotalUsd: 0.00004 } });
    });
    await expect(new OnDemandActorClient({ fetch: abortFetch as typeof globalThis.fetch, pollIntervalMs: 0 }).call(
      'secret', 'actor-1', { protocol: 1, name: 'trends_ask', input: { term: 'AI' } },
      abortController.signal, undefined, undefined, o => { abortedOutcomes.push(o); },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(abortFetch).toHaveBeenCalledTimes(2);
    expect(abortedOutcomes).toHaveLength(1);
    expect(abortedOutcomes[0]).toMatchObject({ runId: 'abort-run', status: 'ABORTED', usageUsd: 0.00004 });
  });

  it('records query, calibration rounds, connection tests, pending reconciliation, and preserves ledger after clearing queries', async () => {
    const dir = await makeDir();
    type Route = { path: string; fetch(req: Request): Promise<Response> };
    const routes = new Map<string, Route>();
    let runSeq = 0;
    let lastKeywords: string[] = [];
    let filter = { geo: 'US', time: 'today 1-m' };
    const billingLookups: string[] = [];

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/builds/default')) return Response.json({ data: { taggedBuilds: { latest: { buildId: 'b-1' } } } });
      if (target.includes('/runs?')) {
        const body = JSON.parse(String(init!.body)).toolRequest;
        lastKeywords = body.input.keywords ?? [body.input.term];
        filter = { geo: body.input.geo ?? 'US', time: body.input.time ?? 'today 1-m' };
        runSeq++;
        // First batch calibration round omits usageTotalUsd to test reconcileRuns.
        const usageTotalUsd = runSeq === 2 ? undefined : Number((runSeq * 0.0001).toFixed(4));
        return Response.json({ data: { id: `run-${runSeq}`, status: 'SUCCEEDED', defaultKeyValueStoreId: `kv-${runSeq}`, ...(usageTotalUsd !== undefined ? { usageTotalUsd } : {}) } });
      }
      if (target.endsWith('/records/TOOL_RESPONSE')) {
        return Response.json({
          protocol: bodyProtocol(target),
          runtime: { version: '0.2.40', baselineCatalogRevision: '2026-11-19' },
          snapshots: [],
          result: {
            ok: true,
            schemaVersion: 1,
            status: 'ok',
            filter,
            meta: { fetchedAt: new Date().toISOString() },
            series: lastKeywords.map((keyword, index) => ({
              keyword,
              points: Array.from({ length: 12 }, (_, d) => ({
                t: new Date(Date.UTC(2026, 10, d + 1)).toISOString(),
                value: lastKeywords.length === 3 && lastKeywords.includes('weather')
                  ? 40
                  : (runSeq === 1 ? [0, 60] : [60, 22])[index] ?? 50,
              })),
            })),
          },
        });
      }
      if (target.endsWith('/actor-runs/run-2')) {
        billingLookups.push(target);
        return Response.json({ data: { id: 'run-2', status: 'SUCCEEDED', usageTotalUsd: 0.00021, startedAt: '2026-11-22T01:00:00.000Z', finishedAt: '2026-11-22T01:00:05.000Z' } });
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    function bodyProtocol(_target: string) { return runSeq === 3 ? 2 : 1; }

    const ctx = {
      tools: { register() {} },
      get: (name: string) => name === 'connection'
        ? { fetch: { register(route: Route) { routes.set(route.path, route); return async () => {}; } } }
        : undefined,
    };
    await register(ctx as never, { egress: 'actor-own', apifyActor: 'owner~gtfa', apifyToken: 'apify_api_secret', snapshotDir: dir, chartDir: null }, {
      onDemand: { fetch: fetchMock as unknown as typeof globalThis.fetch },
      routes: { fetch: fetchMock as unknown as typeof globalThis.fetch },
    });

    const dash = routes.get('/api/gtfa.dashboard')!;
    const testConn = routes.get(TEST_CONNECTION_PATH)!;
    const postDash = (body: unknown) => dash.fetch(new Request('http://localhost/api/gtfa.dashboard', { method: 'POST', body: JSON.stringify(body) }));

    // 1. Primary manual comparison query
    const queryRes = await (await postDash({ action: 'query', name: 'trends_compare', input: { keywords: ['Alpha', 'Beta'], time: 'today 1-m' } })).json();
    expect(queryRes.ok).toBe(true);
    const queryId = queryRes.result.meta.queryRecordId as string;

    // 2. Batch calibration round (run-2 omits usageTotalUsd)
    const batchRes = await (await postDash({ action: 'batch', id: queryId, requestId: randomUUID() })).json();
    expect(batchRes.ok).toBe(true);
    expect(batchRes.saved.actorRuns.map((r: { runId: string; purpose: string }) => [r.runId, r.purpose])).toEqual([
      ['run-1', 'query'],
      ['run-2', 'batch-round'],
    ]);

    // 3. Settings connection test records run-3 with queryRecordId: null
    const probeRes = await (await testConn.fetch(new Request(`http://localhost${TEST_CONNECTION_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ egress: 'actor-own', apifyActor: 'owner~gtfa', apifyToken: 'apify_api_secret' }),
    }))).json();
    expect(probeRes).toMatchObject({ ok: true, actorRunId: 'run-3', costUsd: 0.0003 });

    // 4. GET dashboard merges all 3 runs, even after clearing the query history row
    const initialDash = await (await dash.fetch(new Request('http://localhost/api/gtfa.dashboard'))).json();
    expect(initialDash.actorRuns).toHaveLength(3);
    expect(initialDash.actorRuns.map((r: { purpose: string; runId: string }) => `${r.purpose}:${r.runId}`)).toEqual([
      'connection-test:run-3',
      'batch-round:run-2',
      'query:run-1',
    ]);
    expect(initialDash.actorRuns.find((r: { runId: string }) => r.runId === 'run-3')).toMatchObject({
      source: 'settings',
      terms: [...CONNECTION_KEYWORDS],
      costUsd: 0.0003,
      queryRecordId: null,
    });

    // 5. Reconcile pending run-2 without starting any new paid Actor run
    const runsBeforeReconcile = runSeq;
    const reconcileRes = await (await postDash({ action: 'reconcileRuns' })).json();
    expect(reconcileRes).toMatchObject({ ok: true, updated: 1, remaining: 0 });
    expect(runSeq).toBe(runsBeforeReconcile);
    expect(billingLookups).toHaveLength(1);
    expect(reconcileRes.actorRuns.find((r: { runId: string }) => r.runId === 'run-2')).toMatchObject({ costUsd: 0.00021, durationMs: 5000 });

    // 6. Clearing the query deletes QueryRecord while preserving all ActorRunRecord entries
    expect((await (await postDash({ action: 'clear', ids: [queryId] })).json()).deleted).toBe(1);
    const afterClear = await (await dash.fetch(new Request('http://localhost/api/gtfa.dashboard'))).json();
    expect(afterClear.records).toEqual([]);
    expect(afterClear.actorRuns).toHaveLength(3);
    expect(new QueryHistoryStore(dir).directory).toBeTruthy();
  });
});
