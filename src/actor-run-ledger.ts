import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ActorRunRecord, ActorRunStatus, QueryRecord } from './query-history-types.js';

export const ACTOR_RUN_LEDGER_LIMIT = 2000;
const queues = new Map<string, Promise<unknown>>();
const PURPOSES = new Set(['query', 'batch-round', 'single-retry', 'estimate', 'connection-test']);
const SOURCES = new Set(['manual', 'agent', 'settings']);
const STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED', 'ERROR']);

const validCost = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const validDuration = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

function sanitizeEntry(raw: unknown): ActorRunRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.runId !== 'string' || !item.runId.trim()) return null;
  if (typeof item.startedAt !== 'string' || !Number.isFinite(Date.parse(item.startedAt))) return null;
  if (!PURPOSES.has(String(item.purpose)) || !SOURCES.has(String(item.source)) || !STATUSES.has(String(item.status))) return null;
  const egress = item.egress === 'actor-own' ? 'actor-own' : 'actor-public';
  const finishedAt = typeof item.finishedAt === 'string' && Number.isFinite(Date.parse(item.finishedAt)) ? item.finishedAt : item.startedAt;
  return {
    runId: item.runId.trim(),
    actorId: typeof item.actorId === 'string' && item.actorId.trim() ? item.actorId.trim() : null,
    egress,
    purpose: item.purpose as ActorRunRecord['purpose'],
    ...(typeof item.round === 'number' && Number.isInteger(item.round) && item.round > 0 ? { round: item.round } : {}),
    ...(typeof item.anchor === 'string' && item.anchor.trim() ? { anchor: item.anchor.trim() } : {}),
    source: item.source as ActorRunRecord['source'],
    tool: (typeof item.tool === 'string' ? item.tool : 'trends_ask') as ActorRunRecord['tool'],
    terms: Array.isArray(item.terms) ? item.terms.map(v => String(v)) : [],
    geo: typeof item.geo === 'string' ? item.geo : '',
    time: typeof item.time === 'string' ? item.time : '',
    status: item.status as ActorRunStatus,
    ...(item.toolStatus !== undefined ? { toolStatus: typeof item.toolStatus === 'string' ? item.toolStatus : null } : {}),
    startedAt: item.startedAt,
    finishedAt,
    durationMs: validDuration(item.durationMs),
    costUsd: validCost(item.costUsd),
    queryRecordId: typeof item.queryRecordId === 'string' && item.queryRecordId.trim() ? item.queryRecordId.trim() : null,
    ...(item.legacy === true ? { legacy: true } : {}),
  };
}

function compareRunsDesc(a: ActorRunRecord, b: ActorRunRecord): number {
  const diff = Date.parse(b.startedAt) - Date.parse(a.startedAt);
  if (Number.isFinite(diff) && diff !== 0) return diff;
  return b.runId.localeCompare(a.runId);
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const safe = JSON.stringify(value)
      .replace(/https?:\/\/[^\s/@"]+@/gi, 'https://***@')
      .replace(/apify_api_[a-zA-Z0-9_-]+/g, '[redacted]');
    await writeFile(temp, safe, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

/** Independent persistent ledger for every real Apify Actor run initiated by this Host. */
export class ActorRunStore {
  readonly directory: string;
  readonly path: string;

  constructor(snapshotDir: string) {
    this.directory = resolve(snapshotDir, '.query-history');
    this.path = join(this.directory, '.actor-runs.json');
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.path) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    queues.set(this.path, task);
    void task.finally(() => { if (queues.get(this.path) === task) queues.delete(this.path); }).catch(() => {});
    return task;
  }

  private async readEntries(): Promise<ActorRunRecord[]> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      if (!Array.isArray(raw)) return [];
      const byId = new Map<string, ActorRunRecord>();
      for (const item of raw) {
        const clean = sanitizeEntry(item);
        if (clean) byId.set(clean.runId, clean);
      }
      return [...byId.values()].sort(compareRunsDesc).slice(0, ACTOR_RUN_LEDGER_LIMIT);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  private async writeEntries(entries: readonly ActorRunRecord[]): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const sorted = [...entries].sort(compareRunsDesc).slice(0, ACTOR_RUN_LEDGER_LIMIT);
    await writeAtomicJson(this.path, sorted);
  }

  async list(): Promise<ActorRunRecord[]> {
    return this.serial(() => this.readEntries());
  }

  async record(entry: ActorRunRecord): Promise<ActorRunRecord> {
    const clean = sanitizeEntry(entry);
    if (!clean) throw new Error('Invalid Actor run ledger entry');
    return this.serial(async () => {
      const existing = await this.readEntries();
      const index = existing.findIndex(item => item.runId === clean.runId);
      let next = clean;
      if (index !== -1) {
        const prev = existing[index]!;
        next = {
          ...prev,
          ...clean,
          actorId: clean.actorId ?? prev.actorId,
          round: clean.round ?? prev.round,
          anchor: clean.anchor ?? prev.anchor,
          costUsd: clean.costUsd ?? prev.costUsd,
          durationMs: clean.durationMs ?? prev.durationMs,
          toolStatus: clean.toolStatus !== undefined ? clean.toolStatus : prev.toolStatus,
          queryRecordId: clean.queryRecordId ?? prev.queryRecordId,
          legacy: false,
        };
        existing[index] = next;
      } else {
        existing.unshift(next);
      }
      await this.writeEntries(existing);
      return next;
    });
  }

  async linkQuery(runIds: readonly string[], queryRecordId: string): Promise<void> {
    const targets = new Set(runIds.map(id => id.trim()).filter(Boolean));
    if (!targets.size || !queryRecordId.trim()) return;
    await this.serial(async () => {
      const existing = await this.readEntries();
      let changed = false;
      const updated = existing.map(entry => {
        if (!targets.has(entry.runId) || entry.queryRecordId === queryRecordId) return entry;
        changed = true;
        return { ...entry, queryRecordId };
      });
      if (changed) await this.writeEntries(updated);
    });
  }

  async updateCost(runId: string, patch: {
    costUsd: number | null;
    status?: ActorRunStatus;
    finishedAt?: string;
    durationMs?: number | null;
  }): Promise<ActorRunRecord | null> {
    return this.serial(async () => {
      const existing = await this.readEntries();
      const index = existing.findIndex(item => item.runId === runId);
      if (index === -1) return null;
      const prev = existing[index]!;
      const next: ActorRunRecord = {
        ...prev,
        costUsd: validCost(patch.costUsd) ?? prev.costUsd,
        status: patch.status ?? prev.status,
        finishedAt: patch.finishedAt && Number.isFinite(Date.parse(patch.finishedAt)) ? patch.finishedAt : prev.finishedAt,
        durationMs: patch.durationMs !== undefined ? validDuration(patch.durationMs) : prev.durationMs,
      };
      existing[index] = next;
      await this.writeEntries(existing);
      return next;
    });
  }

  /** Merge authoritative ledger entries with historical runs embedded in `.query-history`. */
  async listMerged(records: readonly QueryRecord[]): Promise<ActorRunRecord[]> {
    const persisted = await this.list();
    const byId = new Map<string, ActorRunRecord>(persisted.map(entry => [entry.runId, entry]));
    for (const record of records) {
      const egress = record.egress === 'actor-own' ? 'actor-own' : 'actor-public';
      if (record.egress !== 'local' && !record.cached && record.actorRunId && !byId.has(record.actorRunId)) {
        byId.set(record.actorRunId, {
          runId: record.actorRunId,
          actorId: null,
          egress,
          purpose: 'query',
          source: record.source,
          tool: record.tool,
          terms: [...record.terms],
          geo: record.geo,
          time: record.time,
          status: 'SUCCEEDED',
          toolStatus: record.status,
          startedAt: record.createdAt,
          finishedAt: record.fetchedAt ?? record.createdAt,
          durationMs: validDuration(record.durationMs),
          costUsd: validCost(record.costUsd),
          queryRecordId: record.id,
          legacy: true,
        });
      }
      for (const vrun of record.volumeRuns ?? []) {
        if (!vrun.actorRunId || byId.has(vrun.actorRunId)) continue;
        byId.set(vrun.actorRunId, {
          runId: vrun.actorRunId,
          actorId: null,
          egress,
          purpose: record.tool === 'trends_snapshot' && record.singleVolume ? 'single-retry' : 'batch-round',
          source: record.source,
          tool: 'trends_compare',
          terms: [...record.terms],
          geo: record.geo,
          time: record.time,
          status: 'SUCCEEDED',
          toolStatus: null,
          startedAt: vrun.createdAt,
          finishedAt: vrun.createdAt,
          durationMs: null,
          costUsd: validCost(vrun.costUsd),
          queryRecordId: record.id,
          legacy: true,
        });
      }
    }
    return [...byId.values()].sort(compareRunsDesc);
  }

  async forQuery(queryRecordId: string, record?: QueryRecord): Promise<ActorRunRecord[]> {
    const merged = await this.listMerged(record ? [record] : []);
    return merged
      .filter(entry => entry.queryRecordId === queryRecordId)
      .sort((a, b) => {
        const diff = Date.parse(a.startedAt) - Date.parse(b.startedAt);
        if (Number.isFinite(diff) && diff !== 0) return diff;
        if (a.purpose === 'query' && b.purpose !== 'query') return -1;
        if (b.purpose === 'query' && a.purpose !== 'query') return 1;
        return a.runId.localeCompare(b.runId);
      });
  }
}
