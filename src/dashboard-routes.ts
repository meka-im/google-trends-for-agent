import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { QueryHistoryStore, HISTORY_LIMIT } from './query-history.js';
import type { GtfaTool } from './tools.js';
import type { EgressMode } from './options.js';
import { VERSION } from './version.js';
import { normalizeTerm } from './dashboard-volume.js';
import type { SavedQuery, VolumeCheck } from './query-history-types.js';
import type { QueryPhase, QueryProgress } from './query-progress.js';

export const DASHBOARD_PATH = '/api/gtfa.dashboard';
export interface DashboardBoundary {
  settings(): { egress: EgressMode; geo: string; cache: boolean; snapshotDir: string };
  execute(name: GtfaTool['name'], input: unknown, signal?: AbortSignal, progress?: (phase: QueryPhase) => void): Promise<Record<string, unknown>>;
  estimate?(saved: SavedQuery, term: string, requestId: string, startedAt: number, egress: EgressMode,
    signal: AbortSignal, progress: (phase: QueryPhase) => void): Promise<VolumeCheck | undefined>;
}
const query = z.object({ action: z.literal('query'), name: z.enum(['trends_snapshot', 'trends_compare']), input: z.record(z.string(), z.unknown()), requestId: z.uuid().optional() }).strict();
const estimate = z.object({ action: z.literal('estimate'), id: z.uuid(), term: z.string().trim().min(1).max(100), requestId: z.uuid().optional() }).strict();
const clear = z.object({ action: z.literal('clear'), ids: z.array(z.uuid()).min(1).max(HISTORY_LIMIT) }).strict();
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

/** Owner-only dsh HTTP routes; opening/refreshing the panel never starts an Actor. */
export function dashboardRoute(boundary: DashboardBoundary, reject: (request: Request) => Response | undefined) {
  let querying = false;
  let progress: QueryProgress | null = null;
  return {
    path: DASHBOARD_PATH, methods: ['GET', 'POST'] as const, requestBody: 'buffered' as const,
    async fetch(request: Request): Promise<Response> {
      const denied = reject(request);
      if (denied) return denied;
      const settings = boundary.settings(), history = new QueryHistoryStore(settings.snapshotDir);
      if (request.method === 'GET') {
        const requestId = new URL(request.url).searchParams.get('progress');
        if (requestId !== null) return json({ ok: true, progress: progress?.requestId === requestId ? progress : null });
        const id = new URL(request.url).searchParams.get('id');
        if (id !== null) {
          try {
            const saved = await history.get(id);
            return saved ? json({ ok: true, ...saved }) : json({ ok: false, error: 'Record not found.' }, 404);
          } catch { return json({ ok: false, error: 'Could not read this local result.' }, 500); }
        }
        try { return json({ ok: true, version: VERSION, settings: { egress: settings.egress, geo: settings.geo, cache: settings.cache }, limit: HISTORY_LIMIT, records: await history.list() }); }
        catch { return json({ ok: false, error: 'Could not read local query history.' }, 500); }
      }
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
      let body: unknown;
      try {
        const raw = await request.text();
        if (raw.length > 64 * 1024) return json({ ok: false, error: 'Request too large.' }, 413);
        body = JSON.parse(raw);
      } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }
      const clearing = clear.safeParse(body);
      if (clearing.success) {
        try { return json({ ok: true, deleted: await history.clear(clearing.data.ids) }); }
        catch { return json({ ok: false, error: 'Could not clear local query history.' }, 500); }
      }
      const parsed = z.union([query, estimate]).safeParse(body);
      if (!parsed.success) return json({ ok: false, error: 'Invalid dashboard request.' }, 400);
      const operation = parsed.data;
      if (querying) return json({ ok: false, error: 'A query is already running.' }, 409);
      querying = true;
      const startedAt = Date.now(), requestId = operation.requestId ?? randomUUID();
      progress = { requestId, phase: 'requesting', startedAt };
      const report = (phase: QueryPhase) => { if (progress) progress = { ...progress, phase }; };
      try {
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]);
        if (operation.action === 'query') {
          const result = await boundary.execute(operation.name, operation.input, signal, report);
          return json({ ok: true, result });
        }
        const saved = await history.get(operation.id);
        if (!saved) return json({ ok: false, error: 'Record not found.' }, 404);
        const term = normalizeTerm(operation.term);
        // Replaying a request or a completed estimate must not start a second run.
        if (saved.volumeChecks?.some(check => normalizeTerm(check.keyword) === term && (!check.errorCode || check.requestId === requestId))) {
          return json({ ok: true, saved });
        }
        const check = await boundary.estimate?.(saved, operation.term, requestId, startedAt, settings.egress, signal, report);
        if (!check) return json({ ok: false, error: 'Search-volume estimate unavailable for this record.', code: 'ESTIMATE_UNAVAILABLE' }, 422);
        report('saving');
        const updated = await history.saveVolumeCheck(operation.id, check);
        return updated ? json({ ok: true, saved: updated }) : json({ ok: false, error: 'Record not found.' }, 404);
      } catch {
        return json({ ok: false, error: request.signal.aborted ? 'Query cancelled.' : 'Query did not complete.' }, 502);
      } finally { querying = false; progress = null; }
    },
  };
}
