import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { EgressMode } from './options.js';
import type { QueryRecord, QueryToolName, SavedQuery } from './query-history-types.js';
export type { QueryRecord, SavedQuery } from './query-history-types.js';

export const HISTORY_LIMIT = 1000;
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const queues = new Map<string, Promise<unknown>>();

/** Local query journal, separate from the calibration/cache store. No user paths are accepted by its API. */
export class QueryHistoryStore {
  readonly directory: string;
  constructor(snapshotDir: string) { this.directory = resolve(snapshotDir, '.query-history'); }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.directory) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    queues.set(this.directory, task);
    void task.finally(() => { if (queues.get(this.directory) === task) queues.delete(this.directory); }).catch(() => {});
    return task;
  }
  private async entries(): Promise<QueryRecord[]> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const metadata = names.filter(name => name.endsWith('.meta.json') && ID.test(name.slice(0, -10)));
    const rows: Array<QueryRecord | null> = [];
    for (let offset = 0; offset < metadata.length; offset += 32) {
      rows.push(...await Promise.all(metadata.slice(offset, offset + 32).map(async name => {
        try {
          const record = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as QueryRecord;
          return record?.id === name.slice(0, -10) && Array.isArray(record.terms) && Number.isFinite(Date.parse(record.createdAt)) ? record : null;
        } catch { return null; }
      })));
    }
    return rows.filter((row): row is QueryRecord => row !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  async list(): Promise<QueryRecord[]> { return this.serial(async () => (await this.entries()).slice(0, HISTORY_LIMIT)); }
  async get(id: string): Promise<SavedQuery | null> {
    if (!ID.test(id)) return null;
    return this.serial(async () => {
      try {
        const record = JSON.parse(await readFile(join(this.directory, `${id}.meta.json`), 'utf8')) as QueryRecord;
        const result = JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8')) as Record<string, unknown>;
        return record.id === id ? { record, result } : null;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
    });
  }
  async save(options: {
    tool: QueryToolName; input: Record<string, unknown>; result: Record<string, unknown>;
    source: QueryRecord['source']; egress: EgressMode; defaultGeo: string; startedAt: number;
  }): Promise<QueryRecord> {
    const { tool, input, result } = options;
    const meta = object(result.meta), filter = object(result.filter), error = object(result.error);
    const terms = typeof input.term === 'string' ? [input.term] : Array.isArray(input.keywords) ? input.keywords as string[] : Array.isArray(input.geos) ? input.geos as string[] : [String(input.geos ?? 'default')];
    const cached = meta.cached === true;
    const record: QueryRecord = {
      id: randomUUID(), tool, terms, source: options.source, egress: options.egress,
      geo: tool === 'trends_now' ? (Array.isArray(result.geos) ? result.geos.join(', ') : Array.isArray(input.geos) ? input.geos.join(', ') : String(input.geos ?? 'default')) : String(filter.geo ?? input.geo ?? options.defaultGeo),
      time: String(filter.time ?? input.time ?? (tool === 'trends_now' ? `${input.hours ?? 24}h` : 'now 1-d')),
      status: typeof result.status === 'string' ? result.status : 'error', cached,
      createdAt: new Date(options.startedAt).toISOString(), fetchedAt: typeof meta.fetchedAt === 'string' ? meta.fetchedAt : null,
      durationMs: Math.max(0, Date.now() - options.startedAt),
      actorRunId: !cached && typeof meta.actorRunId === 'string' ? meta.actorRunId : null,
      costUsd: options.egress === 'local' || cached ? 0 : typeof meta.actorUsageUsd === 'number' && Number.isFinite(meta.actorUsageUsd) && meta.actorUsageUsd >= 0 ? meta.actorUsageUsd : null,
      errorCode: typeof error.code === 'string' ? error.code : null,
    };
    return this.serial(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      for (const [suffix, value] of [['.json', result], ['.meta.json', record]] as const) {
        const path = join(this.directory, `${record.id}${suffix}`), temp = `${path}.tmp`;
        try {
          const safe = JSON.stringify(value).replace(/https?:\/\/[^\s/@"]+@/gi, 'https://***@').replace(/apify_api_[a-zA-Z0-9_-]+/g, '[redacted]');
          await writeFile(temp, safe, { mode: 0o600, flag: 'wx' });
          await rename(temp, path);
        } finally { await unlink(temp).catch(() => {}); }
      }
      const stale = (await this.entries()).slice(HISTORY_LIMIT);
      await Promise.all(stale.flatMap(row => ['.json', '.meta.json'].map(suffix => unlink(join(this.directory, `${row.id}${suffix}`)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }))));
      return record;
    });
  }
  async clear(ids: readonly string[]): Promise<number> {
    if (ids.some(id => !ID.test(id))) throw new Error('Invalid record id');
    return this.serial(async () => {
      let deleted = 0;
      for (const id of new Set(ids)) {
        let present = false;
        for (const suffix of ['.json', '.meta.json']) {
          try { await unlink(join(this.directory, `${id}${suffix}`)); present = true; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        if (present) deleted++;
      }
      return deleted;
    });
  }
}
