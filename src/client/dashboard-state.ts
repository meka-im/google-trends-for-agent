import type { EgressMode } from '../options.js';
import type { QueryRecord, SavedQuery } from '../query-history-types.js';
import type { QueryProgress } from '../query-progress.js';

export interface DashboardData { version: string; records: QueryRecord[]; settings: { egress: EgressMode; geo: string; cache: boolean } }
export interface DashboardView {
  tab: 'overview' | 'query' | 'records'; state: DashboardData | null; loading: boolean; error: string; fieldError: string;
  days: number; text: string; geo: string; time: string; reuse: boolean; result: SavedQuery | null; metric: string;
  search: string; status: string; source: string; page: number; selected: string[];
  operation: (QueryProgress & { terms: string[] }) | null;
}
const URL = 'api/gtfa.dashboard';
const SESSION_KEY = 'gtfa.dashboard.view.1';
const WINDOWS = new Set(['now 1-H', 'now 4-H', 'now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 12-m', 'today 5-y', 'all']);
const row = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const queryKeywords = (text: string) => text.split(/[,，]/).map(term => term.trim()).filter(Boolean);
export async function dashboardRequest<T>(suffix = '', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${URL}${suffix}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json() as T & { ok?: boolean; code?: string };
  if (!response.ok || value.ok !== true) {
    const message = value.code === 'ESTIMATE_UNAVAILABLE' ? 'dashEstimateUnavailable'
      : value.code === 'CURVE_UNAVAILABLE' ? 'dashRestoreUnavailable' : 'dashFailed';
    throw new Error(message);
  }
  return value;
}
function session(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; } catch { return undefined; }
}

/** Owned by the browser plugin, so leaving its main panel does not cancel work. */
export class DashboardController {
  private value: DashboardView = { tab: 'overview', state: null, loading: false, error: '', fieldError: '', days: 30,
    text: '', geo: 'US', time: 'now 1-d', reuse: true, result: null, metric: 'interest', search: '', status: 'all', source: 'all', page: 1, selected: [], operation: null };
  private listeners = new Set<() => void>();
  private queryController: AbortController | null = null;
  private loadController: AbortController | null = null;
  private viewController: AbortController | null = null;
  private progressTimer: ReturnType<typeof setTimeout> | undefined;
  private initialized = false;
  private restored = false;
  private lastId: string | null = null;
  private disposed = false;
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = session()) {
    try {
      const saved = row(JSON.parse(storage?.getItem(SESSION_KEY) ?? '{}'));
      if (['overview', 'query', 'records'].includes(String(saved.tab))) this.value.tab = saved.tab as DashboardView['tab'];
      if ([7, 30].includes(Number(saved.days))) this.value.days = Number(saved.days);
      if (typeof saved.text === 'string' && saved.text.length <= 520) this.value.text = saved.text;
      if (typeof saved.geo === 'string' && /^(?:[A-Z]{2}|)$/.test(saved.geo)) { this.value.geo = saved.geo; this.restored = true; }
      if (typeof saved.time === 'string' && WINDOWS.has(saved.time)) this.value.time = saved.time;
      if (typeof saved.reuse === 'boolean') this.value.reuse = saved.reuse;
      if (saved.metric === 'traffic') this.value.metric = 'traffic';
      if (typeof saved.lastId === 'string' && ID.test(saved.lastId)) this.lastId = saved.lastId;
    } catch { /* A damaged/disabled browser store must not prevent queries. */ }
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set<K extends keyof DashboardView>(key: K, value: DashboardView[K]) {
    this.commit({ [key]: value, ...(['text', 'geo', 'time'].includes(key) ? { fieldError: '' } : {}) }, true);
  }
  private commit(patch: Partial<DashboardView>, persist = false) {
    if (this.disposed) return;
    this.value = { ...this.value, ...patch };
    if (patch.result !== undefined) this.lastId = patch.result?.record.id || null;
    if (persist) {
      const { tab, days, text, geo, time, reuse, metric } = this.value;
      try { this.storage?.setItem(SESSION_KEY, JSON.stringify({ tab, days, text, geo, time, reuse, metric, lastId: this.lastId })); } catch { /* Storage is optional. */ }
    }
    for (const listener of this.listeners) listener();
  }
  async refresh(): Promise<DashboardData | null> {
    if (this.disposed) return null;
    this.loadController?.abort();
    const operation = new AbortController(); this.loadController = operation;
    this.commit({ loading: true });
    try {
      const state = await dashboardRequest<DashboardData>('', undefined, operation.signal);
      if (this.disposed || operation.signal.aborted) return null;
      const firstVisit = !this.initialized && !this.restored;
      const defaults = firstVisit ? { geo: state.settings.geo, reuse: state.settings.cache } : {};
      this.initialized = true;
      this.commit({ state, ...defaults, loading: false, error: '' });
      if (this.lastId && !this.value.result && !this.value.operation) await this.view(this.lastId, false);
      else if (firstVisit && !this.value.operation && !this.value.text) {
        const previous = state.records.find(record => record.source === 'manual');
        if (previous) await this.view(previous.id);
      }
      return state;
    } catch {
      if (!operation.signal.aborted) this.commit({ error: 'dashFailed', loading: false });
      return null;
    }
  }
  private pollProgress(requestId: string, signal: AbortSignal) {
    this.progressTimer = setTimeout(async () => {
      if (this.disposed || signal.aborted || this.value.operation?.requestId !== requestId) return;
      try {
        const reply = await dashboardRequest<{ progress: QueryProgress | null }>(`?progress=${encodeURIComponent(requestId)}`, undefined, signal);
        if (reply.progress && this.value.operation?.requestId === requestId) this.commit({ operation: { ...this.value.operation, ...reply.progress } });
      } catch { /* The original query owns errors; progress never starts or retries work. */ }
      if (!this.disposed && !signal.aborted && this.value.operation?.requestId === requestId) this.pollProgress(requestId, signal);
    }, 1000);
  }
  private async operate(terms: string[], send: (signal: AbortSignal, requestId: string, startedAt: number) => Promise<void>) {
    if (this.queryController || this.disposed) return false;
    this.viewController?.abort();
    const operation = new AbortController(), requestId = crypto.randomUUID(), startedAt = Date.now();
    this.queryController = operation;
    const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(130_000)]);
    this.commit({ fieldError: '', error: '', operation: { requestId, startedAt, phase: 'requesting', terms } }, true);
    this.pollProgress(requestId, signal);
    try { await send(signal, requestId, startedAt); }
    catch (error) {
      if (!this.disposed) {
        await this.refresh();
        this.commit({ error: signal.aborted ? operation.signal.aborted ? 'dashCancelled' : 'dashTimedOut'
          : error instanceof Error && ['dashEstimateUnavailable', 'dashRestoreUnavailable'].includes(error.message) ? error.message : 'dashFailed' });
      }
    } finally {
      clearTimeout(this.progressTimer); this.queryController = null;
      this.commit({ operation: null });
    }
    return true;
  }
  async run(): Promise<boolean> {
    const { text, geo, time, reuse, state } = this.value;
    const terms = queryKeywords(text), distinct = new Set(terms.map(term => term.toLowerCase().replace(/\s+/g, ' ')));
    if (!terms.length || terms.length > 5 || terms.some(term => term.length > 100) || distinct.size !== terms.length) {
      this.commit({ fieldError: 'dashInputError', error: '' });
      return false;
    }
    const name = terms.length === 1 ? 'trends_ask' : 'trends_compare';
    return this.operate(terms, async (signal, requestId, startedAt) => {
      const output = await dashboardRequest<{ result: Record<string, unknown> }>('', { action: 'query', name, requestId,
        input: { ...(terms.length === 1 ? { term: terms[0], points: true, validate: false, fresh: !reuse } : { keywords: terms }), geo, time, timeoutMs: 60000 } }, signal);
      if (this.disposed || signal.aborted) return;
      const next = await this.refresh(), id = row(output.result.meta).queryRecordId;
      const record = next?.records.find(record => record.id === id);
      this.commit({ result: { record: record ?? { id: typeof id === 'string' && ID.test(id) ? id : '', tool: name, terms, geo, time, source: 'manual', egress: state?.settings.egress ?? 'local', status: String(output.result.status ?? 'error'), cached: row(output.result.meta).cached === true,
        createdAt: new Date(startedAt).toISOString(), fetchedAt: String(row(output.result.meta).fetchedAt ?? ''), durationMs: Date.now() - startedAt, actorRunId: null, costUsd: null, errorCode: null }, result: output.result }, metric: 'interest' }, true);
    });
  }
  async estimate(term: string, action: 'estimate' | 'restore' | 'batch' = 'estimate') {
    const id = this.value.result?.record.id;
    if (!id || !ID.test(id)) return;
    await this.operate(action === 'batch' ? this.value.result!.record.terms : [term], async (signal, requestId) => {
      const reply = await dashboardRequest<{ saved: SavedQuery }>('', { action, id, ...(action === 'batch' ? {} : {term}), requestId }, signal);
      if (this.disposed || signal.aborted) return;
      this.commit({ result: reply.saved, metric: action === 'batch' ? 'interest' : 'traffic' }, true);
      await this.refresh();
    });
  }
  cancel = () => { this.queryController?.abort(); };
  async view(id: string, prefill = true) {
    if (this.value.operation || this.disposed) return;
    this.viewController?.abort();
    const operation = new AbortController(); this.viewController = operation;
    try {
      const saved = await dashboardRequest<SavedQuery>(`?id=${encodeURIComponent(id)}`, undefined, operation.signal);
      if (operation.signal.aborted) return;
      const input = prefill && saved.record.tool !== 'trends_now' ? { text: saved.record.terms.join(', '), geo: saved.record.geo,
        ...(WINDOWS.has(saved.record.time) ? { time: saved.record.time } : {}) } : {};
      this.commit({ result: saved, ...input, ...(prefill ? { metric: 'interest', tab: 'query' as const } : {}), error: '' }, true);
    } catch {
      if (!operation.signal.aborted) { this.lastId = null; this.commit({ error: 'dashFailed' }, true); }
    }
  }
  clearResult(ids: readonly string[]) {
    if (this.value.result && ids.includes(this.value.result.record.id)) this.commit({ result: null }, true);
    this.commit({ selected: [] });
  }
  dispose() {
    this.disposed = true; this.queryController?.abort(); this.loadController?.abort(); this.viewController?.abort();
    clearTimeout(this.progressTimer); this.listeners.clear();
  }
}
