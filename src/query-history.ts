import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { EgressMode } from './options.js';
import type { QueryRecord, QueryToolName, SavedQuery, VolumeCheck } from './query-history-types.js';
export type { QueryRecord, SavedQuery } from './query-history-types.js';

export const HISTORY_LIMIT = 1000;
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const queues = new Map<string, Promise<unknown>>();
const VOLUME_SUFFIX = '.volume.json';
const FILE_SUFFIXES = ['.json', '.meta.json', VOLUME_SUFFIX];

async function writeJson(path: string, value: unknown) {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    const safe = JSON.stringify(value).replace(/https?:\/\/[^\s/@"]+@/gi, 'https://***@').replace(/apify_api_[a-zA-Z0-9_-]+/g, '[redacted]');
    await writeFile(temp, safe, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}

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
  private async entries(includeVolume = false): Promise<QueryRecord[]> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const files = new Set(names);
    const metadata = names.filter(name => name.endsWith('.meta.json') && ID.test(name.slice(0, -10)));
    const rows: Array<QueryRecord | null> = [];
    for (let offset = 0; offset < metadata.length; offset += 32) {
      rows.push(...await Promise.all(metadata.slice(offset, offset + 32).map(async name => {
        try {
          const record = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as QueryRecord;
          if (record?.id !== name.slice(0, -10) || !Array.isArray(record.terms) || !Number.isFinite(Date.parse(record.createdAt))) return null;
          if (!includeVolume || !files.has(record.id + VOLUME_SUFFIX)) return record;
          const checks = await this.volumeChecks(record.id);
          const volumeRuns = checks.filter(check => check.actorRunId).map(({ actorRunId, costUsd, createdAt }) => ({ actorRunId, costUsd, createdAt }));
          return { ...record, volumeRuns };
        } catch { return null; }
      })));
    }
    return rows.filter((row): row is QueryRecord => row !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  async list(): Promise<QueryRecord[]> { return this.serial(async () => (await this.entries(true)).slice(0, HISTORY_LIMIT)); }
  private async volumeChecks(id: string): Promise<VolumeCheck[]> {
    try {
      const value = JSON.parse(await readFile(join(this.directory, id + VOLUME_SUFFIX), 'utf8')) as unknown;
      return Array.isArray(value) ? value as VolumeCheck[] : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  }
  private async read(id: string): Promise<SavedQuery | null> {
    try {
      const record = JSON.parse(await readFile(join(this.directory, `${id}.meta.json`), 'utf8')) as QueryRecord;
      const result = JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8')) as Record<string, unknown>;
      if (record.id !== id) return null;
      const volumeChecks = await this.volumeChecks(id);
      return { record, result, ...(volumeChecks.length ? { volumeChecks } : {}) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }
  async get(id: string): Promise<SavedQuery | null> {
    return ID.test(id) ? this.serial(() => this.read(id)) : null;
  }
  async saveVolumeCheck(id: string, check: VolumeCheck): Promise<SavedQuery | null> {
    if (!ID.test(id)) return null;
    return this.serial(async () => {
      const saved = await this.read(id);
      if (!saved) return null;
      const volumeChecks = [...(saved.volumeChecks ?? []), check];
      await writeJson(join(this.directory, id + VOLUME_SUFFIX), volumeChecks);
      return { ...saved, volumeChecks };
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
      await writeJson(join(this.directory, record.id + '.json'), result);
      await writeJson(join(this.directory, record.id + '.meta.json'), record);
      const stale = (await this.entries()).slice(HISTORY_LIMIT);
      await Promise.all(stale.flatMap(row => FILE_SUFFIXES.map(suffix => unlink(join(this.directory, `${row.id}${suffix}`)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }))));
      return record;
    });
  }
  async clear(ids: readonly string[]): Promise<number> {
    if (ids.some(id => !ID.test(id))) throw new Error('Invalid record id');
    return this.serial(async () => {
      let deleted = 0;
      for (const id of new Set(ids)) {
        let present = false;
        for (const suffix of FILE_SUFFIXES) {
          try { await unlink(join(this.directory, `${id}${suffix}`)); present = true; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        if (present) deleted++;
      }
      return deleted;
    });
  }
}
