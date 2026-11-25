import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  MEKA_BASELINES_URL,
  getActiveMekaBaselines,
  parseMekaBaselinesJson,
  setActiveMekaBaselines,
  summarizeMekaCatalog,
  type MekaAnchor,
  type MekaBaselineStatus,
  type MekaCatalogState,
} from './dsh-baselines.js';

const CACHE_FILE = '.meka-baselines.json';
const SYNC_TIMEOUT_MS = 10_000;
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

export interface MekaBaselineSyncResult {
  ok: boolean;
  updated?: boolean;
  code?: 'network' | 'http' | 'invalid';
  httpStatus?: number;
  message?: string;
  status: MekaBaselineStatus;
}

export interface MekaBaselineBoundary {
  status(): Promise<MekaBaselineStatus>;
  sync(signal?: AbortSignal): Promise<MekaBaselineSyncResult>;
  ensureInitialSync(): void;
}

export interface MekaBaselineSyncOptions {
  getSnapshotDir: () => string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

interface StoredBaselineCache {
  schemaVersion: 1;
  version: string;
  syncedAt: string;
  anchors: MekaAnchor[];
}

function parseCacheFile(raw: unknown): MekaCatalogState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;
  if (doc.schemaVersion !== 1) return null;
  const version = typeof doc.version === 'string' ? doc.version.trim() : '';
  const syncedAt = typeof doc.syncedAt === 'string' && Number.isFinite(Date.parse(doc.syncedAt)) ? doc.syncedAt : '';
  if (!version || !syncedAt || !Array.isArray(doc.anchors) || doc.anchors.length === 0) return null;
  const anchors: MekaAnchor[] = [];
  for (const item of doc.anchors) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.geo !== 'string' || typeof row.term !== 'string' || !row.term.trim()) continue;
    if (typeof row.dailySearches !== 'number' || !Number.isFinite(row.dailySearches) || row.dailySearches <= 0) continue;
    anchors.push({
      geo: row.geo.trim().toUpperCase(),
      term: row.term.trim(),
      dailySearches: Math.round(row.dailySearches),
      dailyOnly: row.dailyOnly === true,
    });
  }
  if (!anchors.length) return null;
  return { source: 'synced', version, syncedAt, anchors };
}

async function writeCacheAtomically(path: string, payload: StoredBaselineCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(payload), { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

function anchorsChanged(prev: readonly MekaAnchor[], next: readonly MekaAnchor[]): boolean {
  if (prev.length !== next.length) return true;
  return prev.some((item, index) => {
    const other = next[index]!;
    return item.geo !== other.geo || item.term !== other.term || item.dailySearches !== other.dailySearches || item.dailyOnly !== other.dailyOnly;
  });
}

/**
 * Manages MEKA calibration baselines for dsh:
 * - Loads a local cached snapshot from `.meka-baselines.json` when present.
 * - Syncs once on initial install/first boot when no local cache exists yet.
 * - Never auto-syncs again afterwards; users trigger subsequent updates manually.
 */
export function createMekaBaselinesSync(options: MekaBaselineSyncOptions): MekaBaselineBoundary {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  let loadedFromPath: string | null = null;
  let inFlight: Promise<MekaBaselineSyncResult> | null = null;
  let initialTriggered = false;

  const cachePath = () => resolve(options.getSnapshotDir(), CACHE_FILE);

  const loadFromDisk = async (): Promise<boolean> => {
    const path = cachePath();
    if (loadedFromPath === path && getActiveMekaBaselines().source === 'synced') return true;
    try {
      const text = await readFile(path, 'utf8');
      const parsed = parseCacheFile(JSON.parse(text));
      if (!parsed) return false;
      setActiveMekaBaselines(parsed);
      loadedFromPath = path;
      return true;
    } catch {
      return false;
    }
  };

  const runSync = async (signal?: AbortSignal): Promise<MekaBaselineSyncResult> => {
    await loadFromDisk();
    const before = getActiveMekaBaselines();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), SYNC_TIMEOUT_MS);
    const onCallerAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    try {
      const response = await fetchImpl(MEKA_BASELINES_URL, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          ok: false,
          code: 'http',
          httpStatus: response.status,
          message: `meka.im returned HTTP ${response.status}.`,
          status: summarizeMekaCatalog(),
        };
      }
      const text = await response.text();
      if (text.length > MAX_PAYLOAD_BYTES) {
        return {
          ok: false,
          code: 'invalid',
          message: 'MEKA baselines response exceeded size limit.',
          status: summarizeMekaCatalog(),
        };
      }
      let parsed: { version: string; anchors: MekaAnchor[] };
      try {
        parsed = parseMekaBaselinesJson(JSON.parse(text));
      } catch (error) {
        return {
          ok: false,
          code: 'invalid',
          message: error instanceof Error ? error.message : 'Invalid MEKA baselines payload.',
          status: summarizeMekaCatalog(),
        };
      }
      const syncedAt = now().toISOString();
      const nextState: MekaCatalogState = {
        source: 'synced',
        version: parsed.version,
        syncedAt,
        anchors: parsed.anchors,
      };
      const updated = before.version !== parsed.version || anchorsChanged(before.anchors, parsed.anchors);
      const path = cachePath();
      try {
        await writeCacheAtomically(path, {
          schemaVersion: 1,
          version: parsed.version,
          syncedAt,
          anchors: parsed.anchors,
        });
        loadedFromPath = path;
      } catch {
        // Keep in-memory updated catalog even if disk is read-only.
      }
      setActiveMekaBaselines(nextState);
      return {
        ok: true,
        updated,
        status: summarizeMekaCatalog(nextState),
      };
    } catch {
      return {
        ok: false,
        code: 'network',
        message: 'Could not reach meka.im to sync baselines.',
        status: summarizeMekaCatalog(),
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  };

  return {
    async status() {
      await loadFromDisk();
      return summarizeMekaCatalog();
    },
    sync(signal?: AbortSignal) {
      if (inFlight) return inFlight;
      const promise = runSync(signal).finally(() => {
        if (inFlight === promise) inFlight = null;
      });
      inFlight = promise;
      return promise;
    },
    ensureInitialSync() {
      if (initialTriggered) return;
      initialTriggered = true;
      void loadFromDisk().then(hasCache => {
        if (!hasCache) void this.sync();
      }).catch(() => {});
    },
  };
}
