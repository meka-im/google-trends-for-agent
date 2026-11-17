import { z } from 'zod';
import { QueryHistoryStore, HISTORY_LIMIT } from './query-history.js';
import type { GtfaTool } from './tools.js';
import type { EgressMode } from './options.js';
import { VERSION } from './version.js';

export const DASHBOARD_PATH = '/api/gtfa.dashboard';
export interface DashboardBoundary {
  settings(): { egress: EgressMode; geo: string; cache: boolean; snapshotDir: string };
  execute(name: GtfaTool['name'], input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
}
const query = z.object({ action: z.literal('query'), name: z.enum(['trends_snapshot', 'trends_compare']), input: z.record(z.string(), z.unknown()) }).strict();
const clear = z.object({ action: z.literal('clear'), ids: z.array(z.uuid()).min(1).max(HISTORY_LIMIT) }).strict();
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

/** Owner-only dsh HTTP routes; opening/refreshing the panel never starts an Actor. */
export function dashboardRoute(boundary: DashboardBoundary, reject: (request: Request) => Response | undefined) {
  let querying = false;
  return {
    path: DASHBOARD_PATH, methods: ['GET', 'POST'] as const, requestBody: 'buffered' as const,
    async fetch(request: Request): Promise<Response> {
      const denied = reject(request);
      if (denied) return denied;
      const settings = boundary.settings(), history = new QueryHistoryStore(settings.snapshotDir);
      if (request.method === 'GET') {
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
      const parsed = query.safeParse(body);
      if (!parsed.success) return json({ ok: false, error: 'Invalid dashboard request.' }, 400);
      if (querying) return json({ ok: false, error: 'A query is already running.' }, 409);
      querying = true;
      try {
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]);
        const result = await boundary.execute(parsed.data.name, parsed.data.input, signal);
        return json({ ok: true, result });
      } catch {
        return json({ ok: false, error: request.signal.aborted ? 'Query cancelled.' : 'Query did not complete.' }, 502);
      } finally { querying = false; }
    },
  };
}
