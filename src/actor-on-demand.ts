import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GTrendsError } from './core.js';
import { abortError, throwIfAborted } from './transport.js';
import { SnapshotStore, atomicJson } from './snapshot.js';
import { ACTOR_REQUEST_PROTOCOL, ACTOR_RESPONSE_KEY, storedSnapshotSchema, type ActorToolRequest } from './actor-request.js';
import { baselinesForActor, defaultAnchorFor } from './traffic.js';
import { BASELINE_CATALOG_REVISION } from './baseline-catalog.js';
import type { GtfaTool, ToolLiveSettings } from './tools.js';
import { parseActorRuntime } from './actor-runtime.js';
import { VERSION } from './version.js';

const API = 'https://api.apify.com/v2';
export const ACTOR_RUN_TIMEOUT_SECS = 300;
export const ACTOR_RUN_MEMORY_MB = 256;
const ACTIVE = new Set(['READY', 'RUNNING', 'ABORTING', 'TIMING-OUT']);
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export interface OnDemandOptions {
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  deadlineMs?: number;
}

/** Each call owns one bounded run. No Standby URL, health request, or heartbeat. */
export class OnDemandActorClient {
  private readonly fetch: typeof fetch;
  constructor(private readonly options: OnDemandOptions = {}) { this.fetch = options.fetch ?? globalThis.fetch; }

  private async request(path: string, token: string, signal: AbortSignal, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    const response = await this.fetch(`${API}${path}`, {
      method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GTrendsError(response.status === 401 || response.status === 403 || response.status === 404 ? 'INVALID_INPUT' : 'NETWORK_ERROR',
        response.status === 401 || response.status === 403 ? 'Apify rejected the token or OAuth session. Sign in again.' : `Apify API returned HTTP ${response.status}.`);
    }
    // Bound both the response and its body; never forward API error text or secrets.
    const text = await response.text();
    if (text.length > 8_000_000) throw new GTrendsError('NETWORK_ERROR', 'Apify response is too large.');
    try { return row(JSON.parse(text)); }
    catch { throw new GTrendsError('NETWORK_ERROR', 'Apify returned invalid JSON.'); }
  }

  async check(token: string, actorId: string, signal = new AbortController().signal) {
    if (!actorId.trim()) throw new GTrendsError('INVALID_INPUT', 'Select or deploy your google-trends-for-agent Actor in Plugins → Google Trends.');
    const data = row((await this.request(`/acts/${encodeURIComponent(actorId)}`, token, signal)).data);
    if (!row(row(data.taggedBuilds).latest).buildId) throw new GTrendsError('INVALID_INPUT', 'Build this Actor before running a query.');
  }

  async call(token: string, actorId: string, input: ActorToolRequest, callerSignal?: AbortSignal) {
    throwIfAborted(callerSignal);
    if (!actorId.trim()) throw new GTrendsError('INVALID_INPUT', 'Select or deploy your google-trends-for-agent Actor in Plugins → Google Trends.');
    const deadline = AbortSignal.timeout(this.options.deadlineMs ?? 330_000);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    let runId: string | undefined, terminal = false;
    try {
      // Never retry this POST: an ambiguous response must not duplicate paid work.
      let run = row((await this.request(`/acts/${encodeURIComponent(actorId)}/runs?timeout=${ACTOR_RUN_TIMEOUT_SECS}&memory=${ACTOR_RUN_MEMORY_MB}&waitForFinish=0`, token, signal, 'POST', { toolRequest: input })).data);
      if (typeof run.id !== 'string') throw new GTrendsError('NETWORK_ERROR', 'Apify returned no run id.');
      runId = run.id;
      while (ACTIVE.has(String(run.status))) {
        await new Promise<void>((done, reject) => {
          const onAbort = () => { clearTimeout(timer); reject(abortError(signal)); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); done(); }, this.options.pollIntervalMs ?? 1500);
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        run = row((await this.request(`/actor-runs/${encodeURIComponent(runId)}`, token, signal)).data);
      }
      if (!TERMINAL.has(String(run.status))) throw new GTrendsError('NETWORK_ERROR', 'Apify returned an unknown run state.');
      terminal = true;
      if (run.status !== 'SUCCEEDED') throw new GTrendsError(run.status === 'TIMED-OUT' ? 'TRENDS_TIMEOUT' : 'NETWORK_ERROR', `Apify run ended with ${String(run.status)}. Update the Actor if it does not support on-demand tool requests.`);
      if (typeof run.defaultKeyValueStoreId !== 'string') throw new GTrendsError('NETWORK_ERROR', 'Apify returned no result store.');
      const output = await this.request(`/key-value-stores/${encodeURIComponent(run.defaultKeyValueStoreId)}/records/${ACTOR_RESPONSE_KEY}`, token, signal);
      if (output.protocol !== input.protocol || typeof row(output.result).ok !== 'boolean') throw new GTrendsError('INVALID_INPUT', `This Actor build does not support on-demand protocol v${input.protocol}. Rebuild the Actor.`);
      return { result: row(output.result), runtime: parseActorRuntime(output.runtime), snapshots: Array.isArray(output.snapshots) ? output.snapshots : [], runId };
    } catch (error) {
      if (callerSignal?.aborted) throw abortError(callerSignal);
      if (deadline.aborted) throw new GTrendsError('TRENDS_TIMEOUT', 'On-demand Actor run exceeded its deadline.');
      if (error instanceof GTrendsError) throw error;
      throw new GTrendsError('NETWORK_ERROR', 'Could not complete the on-demand Apify run.');
    } finally {
      if (runId && !terminal) {
        // Cancellation also stops cloud billing. A separate cleanup signal is
        // essential because the caller's signal may already be aborted.
        await this.request(`/actor-runs/${encodeURIComponent(runId)}/abort?gracefully=false`, token, AbortSignal.timeout(10_000), 'POST').catch(() => {});
      }
    }
  }
}

/** Local result reuse avoids starting an Actor at all on a snapshot cache hit. */
export async function callActorTool(client: OnDemandActorClient, options: {
  token: string; actorId: string; name: GtfaTool['name']; input: Record<string, unknown>;
  settings: ToolLiveSettings; signal?: AbortSignal;
}) {
  throwIfAborted(options.signal);
  const { input, settings, name } = options;
  const store = new SnapshotStore(settings.snapshotDir);
  const geo = String(input.geo ?? settings.defaultGeo ?? 'US');
  const calibrates = name === 'trends_snapshot' || name === 'trends_ask' && input.validate === true;
  const cloudSettings = { defaultGeo: settings.defaultGeo, anchor: settings.anchor,
    baselines: calibrates ? baselinesForActor(geo, settings.baselines) : settings.baselines,
    cache: settings.cache, charts: settings.chartDir !== null };
  const { fresh: _fresh, ...cacheInput } = input;
  const cacheable = name === 'trends_ask' || name === 'trends_snapshot';
  const key = createHash('sha256').update(JSON.stringify([VERSION, BASELINE_CATALOG_REVISION, options.actorId, createHash('sha256').update(options.token).digest('hex'), name, cacheInput, cloudSettings])).digest('hex');
  const cachePath = join(store.dir, '.actor-results', `${key}.json`);
  let result: Record<string, unknown> | undefined;
  if (cacheable && settings.cache !== false && !input.fresh) {
    try {
      const cached = row(JSON.parse(await readFile(cachePath, 'utf8')));
      const envelope = row(cached.result), meta = row(envelope.meta);
      const age = Date.now() - Date.parse(String(meta.fetchedAt));
      if (age >= 0 && age < 360 * 60_000 && ['ok', 'no_data'].includes(String(envelope.status)) && !envelope.error) {
        result = { ...envelope, meta: { ...meta, cached: true, ageMin: Math.round(age / 6000) / 10 } };
      }
    } catch { /* A missing or damaged local cache is fetched again. */ }
  }
  if (!result) {
    const history: NonNullable<ActorToolRequest['history']> = [];
    if (cacheable && typeof input.term === 'string') {
      for (const time of [input.time ?? 'now 1-d', 'now 7-d']) for (const anchor of [undefined, defaultAnchorFor(String(time), cloudSettings.baselines, geo), 'gpts', 'sudoku', settings.anchor, input.anchor, settings.baselines?.windowAnchors?.short, settings.baselines?.windowAnchors?.long]) {
        const saved = await store.history(input.term, { geo: String(input.geo ?? settings.defaultGeo ?? 'US'), time: String(time) } as never, 2, typeof anchor === 'string' ? anchor : undefined);
        for (const snapshot of saved) {
          const parsed = storedSnapshotSchema.safeParse(snapshot);
          if (parsed.success && !history.some(row => row.id === snapshot.id)) history.push(parsed.data);
        }
      }
    }
    const output = await client.call(options.token, options.actorId, {
      protocol: ACTOR_REQUEST_PROTOCOL, name, input: name === 'trends_snapshot' ? { ...input, svg: true } : input,
      settings: cloudSettings, history: history.slice(0, 12),
    }, options.signal);
    throwIfAborted(options.signal);
    result = { ...output.result, meta: { ...row(output.result.meta), actorRunId: output.runId, execution: 'on-demand', actorRuntime: output.runtime } };
    const runtimeWarning = !output.runtime ? 'Actor version is unverified; update the Actor before checking version parity.'
      : output.runtime.version !== VERSION || output.runtime.baselineCatalogRevision !== BASELINE_CATALOG_REVISION
        ? `Actor v${output.runtime.version} and client v${VERSION} differ in package or baseline revision; update the older component.` : null;
    if (runtimeWarning) result.warnings = [...(Array.isArray(result.warnings) ? result.warnings : []), runtimeWarning];
    for (const snapshot of output.snapshots) {
      const parsed = storedSnapshotSchema.safeParse(snapshot);
      if (parsed.success) await store.save(parsed.data as never);
    }
    if (cacheable && ['ok', 'no_data'].includes(String(result.status)) && !result.error) await atomicJson(cachePath, { result });
  }
  if (name === 'trends_snapshot') {
    result = structuredClone(result);
    for (const field of ['chart', 'chart7d']) {
      const chart = row(result[field]);
      if (!Object.keys(chart).length) continue;
      let path: string | null = null;
      if (settings.chartDir !== null && typeof chart.svg === 'string' && chart.svg) {
        const directory = resolve(settings.chartDir ?? '.gtfa/charts');
        await mkdir(directory, { recursive: true });
        path = join(directory, `${randomUUID()}.svg`);
        await writeFile(path, chart.svg);
      }
      result[field] = { ...chart, path, svg: input.svg ? chart.svg ?? '' : '' };
    }
  }
  throwIfAborted(options.signal);
  return result;
}
