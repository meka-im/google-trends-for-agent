import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseActorRuntime, type ActorRuntime } from './actor-runtime.js';
import { BASELINE_CATALOG_REVISION } from './baseline-catalog.js';
import { GTFA_PUBLIC_ACTOR_ID, type EgressMode } from './options.js';
import { QueryHistoryStore } from './query-history.js';
import { VERSION } from './version.js';
import {
  GTFA_LATEST_RELEASE_API_URL,
  GTFA_RELEASES_URL,
  compareSemver,
  isSafeReleaseUrl,
  parseSemver,
  type ObservedActorRuntime,
  type ReleaseInfo,
  type VersionCheckErrorCode,
  type VersionStatusSnapshot,
} from './version-check.js';

const CACHE_FILE = '.version-status.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_PAYLOAD_BYTES = 512 * 1024;
const MAX_OBSERVED_ACTORS = 16;

interface StoredVersionCache {
  schemaVersion: 1;
  checkedAt: string | null;
  latestRelease: ReleaseInfo | null;
  observedActors: Record<string, ObservedActorRuntime>;
  clearedActors?: Record<string, string>;
}

export interface VersionStatusQuery {
  egress: EgressMode;
  apifyActor?: string;
  refresh?: boolean;
  signal?: AbortSignal;
}

export interface VersionStatusBoundary {
  status(query: VersionStatusQuery): Promise<VersionStatusSnapshot>;
  recordActorRuntime(actorId: string, runtime: ActorRuntime | null | undefined): Promise<void>;
  markActorRebuilt(actorId: string): Promise<void>;
  clearActorRuntime(actorId: string): Promise<void>;
}

export interface VersionStatusMonitorOptions {
  getSnapshotDir: () => string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  ttlMs?: number;
  pluginVersion?: string;
  baselineCatalogRevision?: string;
  releaseApiUrl?: string;
}

function emptyCache(): StoredVersionCache {
  return { schemaVersion: 1, checkedAt: null, latestRelease: null, observedActors: {}, clearedActors: {} };
}

function sanitizeHighlight(line: string): string {
  const cleaned = line
    .replace(/^[-*•+]\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(^|\s)__([^_]+)__(?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= 120) return cleaned;
  const slice = cleaned.slice(0, 120);
  const boundary = slice.lastIndexOf(' ');
  const trimmed = (boundary >= 60 ? slice.slice(0, boundary) : slice).replace(/[.,;:(\-\s]+$/, '');
  return `${trimmed}…`;
}

/** Extract up to 3 concise highlights from a GitHub Release body. */
export function extractReleaseHighlights(body: unknown, fallbackName?: unknown): string[] {
  const out: string[] = [];
  if (typeof body === 'string' && body.trim()) {
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('```') || line.startsWith('>')) continue;
      if (!/^[-*•+]\s+/.test(line)) continue;
      const cleaned = sanitizeHighlight(line);
      if (cleaned.length >= 6 && !out.includes(cleaned)) out.push(cleaned);
      if (out.length >= 3) break;
    }
  }
  if (!out.length && typeof fallbackName === 'string' && fallbackName.trim()) {
    const cleaned = sanitizeHighlight(fallbackName);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

function parseReleasePayload(raw: unknown): ReleaseInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;
  if (doc.draft === true || doc.prerelease === true) return null;
  const tagName = typeof doc.tag_name === 'string' ? doc.tag_name.trim() : '';
  const parsed = parseSemver(tagName);
  if (!parsed) return null;
  const version = `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ''}`;
  const url = isSafeReleaseUrl(doc.html_url) ? doc.html_url : `${GTFA_RELEASES_URL}/tag/${encodeURIComponent(tagName)}`;
  const publishedAt = typeof doc.published_at === 'string' && Number.isFinite(Date.parse(doc.published_at))
    ? doc.published_at : null;
  return {
    version,
    tagName,
    url,
    publishedAt,
    highlights: extractReleaseHighlights(doc.body, doc.name),
  };
}

function parseStoredCache(raw: unknown): StoredVersionCache {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyCache();
  const doc = raw as Record<string, unknown>;
  if (doc.schemaVersion !== 1) return emptyCache();
  const checkedAt = typeof doc.checkedAt === 'string' && Number.isFinite(Date.parse(doc.checkedAt))
    ? doc.checkedAt : null;
  let latestRelease: ReleaseInfo | null = null;
  if (doc.latestRelease && typeof doc.latestRelease === 'object' && !Array.isArray(doc.latestRelease)) {
    const rel = doc.latestRelease as Record<string, unknown>;
    if (typeof rel.version === 'string' && parseSemver(rel.version) && isSafeReleaseUrl(rel.url)) {
      latestRelease = {
        version: rel.version,
        tagName: typeof rel.tagName === 'string' && rel.tagName.trim() ? rel.tagName.trim() : `v${rel.version}`,
        url: rel.url,
        publishedAt: typeof rel.publishedAt === 'string' && Number.isFinite(Date.parse(rel.publishedAt)) ? rel.publishedAt : null,
        highlights: Array.isArray(rel.highlights)
          ? rel.highlights.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 3)
          : [],
      };
    }
  }
  const observedActors: Record<string, ObservedActorRuntime> = {};
  if (doc.observedActors && typeof doc.observedActors === 'object' && !Array.isArray(doc.observedActors)) {
    for (const [key, entry] of Object.entries(doc.observedActors as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      const runtime = parseActorRuntime(item);
      if (!runtime) continue;
      const actorId = typeof item.actorId === 'string' && item.actorId.trim() ? item.actorId.trim() : key.trim();
      const observedAt = typeof item.observedAt === 'string' && Number.isFinite(Date.parse(item.observedAt))
        ? item.observedAt : null;
      if (actorId && observedAt) {
        observedActors[actorId] = { ...runtime, actorId, observedAt };
      }
    }
  }
  const clearedActors: Record<string, string> = {};
  if (doc.clearedActors && typeof doc.clearedActors === 'object' && !Array.isArray(doc.clearedActors)) {
    for (const [key, value] of Object.entries(doc.clearedActors as Record<string, unknown>)) {
      if (key.trim() && typeof value === 'string' && Number.isFinite(Date.parse(value))) {
        clearedActors[key.trim()] = value;
      }
    }
  }
  return { schemaVersion: 1, checkedAt, latestRelease, observedActors, clearedActors };
}

async function writeCacheAtomically(path: string, payload: StoredVersionCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(payload), { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

function pruneObservedActors(map: Record<string, ObservedActorRuntime>): Record<string, ObservedActorRuntime> {
  const entries = Object.entries(map);
  if (entries.length <= MAX_OBSERVED_ACTORS) return map;
  entries.sort((a, b) => Date.parse(b[1].observedAt) - Date.parse(a[1].observedAt));
  return Object.fromEntries(entries.slice(0, MAX_OBSERVED_ACTORS));
}

/**
 * Tracks plugin release updates (24 h local cache, fetched lazily on UI demand)
 * and the latest observed Actor runtime per Actor id so the dsh UI can surface
 * directional upgrade prompts without blocking boot or offline profiles.
 */
export function createVersionStatusMonitor(options: VersionStatusMonitorOptions): VersionStatusBoundary {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const ttlMs = options.ttlMs ?? CACHE_TTL_MS;
  const pluginVersion = options.pluginVersion ?? VERSION;
  const baselineCatalogRevision = options.baselineCatalogRevision ?? BASELINE_CATALOG_REVISION;
  const releaseApiUrl = options.releaseApiUrl ?? GTFA_LATEST_RELEASE_API_URL;

  let loadedPath: string | null = null;
  let cache: StoredVersionCache = emptyCache();
  let inFlight: Promise<{ error: VersionCheckErrorCode | null }> | null = null;

  const cachePath = () => resolve(options.getSnapshotDir(), CACHE_FILE);

  const ensureLoaded = async (): Promise<void> => {
    const path = cachePath();
    if (loadedPath === path) return;
    loadedPath = path;
    try {
      const text = await readFile(path, 'utf8');
      cache = parseStoredCache(JSON.parse(text));
    } catch {
      cache = emptyCache();
    }
  };

  const persist = async (): Promise<void> => {
    try {
      await writeCacheAtomically(cachePath(), cache);
    } catch {
      /* Cache persistence is best-effort and must never fail queries or UI. */
    }
  };

  const fetchLatestRelease = async (signal?: AbortSignal): Promise<{ error: VersionCheckErrorCode | null }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), FETCH_TIMEOUT_MS);
    const onCallerAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    try {
      const response = await fetchImpl(releaseApiUrl, {
        cache: 'no-store',
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `google-trends-for-agent/${pluginVersion}`,
        },
        signal: controller.signal,
      });
      if (response.status === 403 || response.status === 429) {
        return { error: 'rate-limited' };
      }
      if (!response.ok) {
        return { error: 'http' };
      }
      const text = await response.text();
      if (text.length > MAX_PAYLOAD_BYTES) {
        return { error: 'http' };
      }
      const parsed = parseReleasePayload(JSON.parse(text));
      cache = {
        ...cache,
        checkedAt: now().toISOString(),
        ...(parsed ? { latestRelease: parsed } : {}),
      };
      await persist();
      return { error: null };
    } catch {
      return { error: 'network' };
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
  };

  const buildSnapshot = (
    egress: EgressMode,
    apifyActor: string | undefined,
    checkError: VersionCheckErrorCode | null,
  ): VersionStatusSnapshot => {
    const actorId = egress === 'actor-public'
      ? GTFA_PUBLIC_ACTOR_ID
      : egress === 'actor-own'
        ? (apifyActor?.trim() || null)
        : null;
    const observedActor = actorId ? (cache.observedActors[actorId] ?? null) : null;

    const releaseNewer = Boolean(
      cache.latestRelease && (compareSemver(cache.latestRelease.version, pluginVersion) ?? 0) > 0,
    );
    const publicActorNewer = Boolean(
      egress === 'actor-public'
      && observedActor
      && (compareSemver(observedActor.version, pluginVersion) ?? 0) > 0,
    );
    const pluginUpdateAvailable = releaseNewer || publicActorNewer;

    const actorUpdateAvailable = Boolean(
      egress === 'actor-own'
      && observedActor
      && (
        (compareSemver(observedActor.version, pluginVersion) ?? 0) < 0
        || observedActor.baselineCatalogRevision < baselineCatalogRevision
      ),
    );

    return {
      pluginVersion,
      baselineCatalogRevision,
      egress,
      actorId,
      latestRelease: cache.latestRelease,
      pluginUpdateAvailable,
      observedActor,
      actorUpdateAvailable,
      checkedAt: cache.checkedAt,
      checkError,
    };
  };

  const bootstrapObservedActorFromHistory = async (actorId: string): Promise<void> => {
    const trimmed = actorId.trim();
    if (!trimmed || trimmed in cache.observedActors) return;
    const clearedAtMs = cache.clearedActors?.[trimmed] ? Date.parse(cache.clearedActors[trimmed]!) : Number.NaN;
    try {
      const store = new QueryHistoryStore(options.getSnapshotDir());
      const records = await store.list();
      let inspected = 0;
      for (const record of records) {
        if (record.egress !== 'actor-own') continue;
        if (Number.isFinite(clearedAtMs) && Date.parse(record.createdAt) <= clearedAtMs) break;
        if (++inspected > 5) break;
        const saved = await store.get(record.id);
        const meta = saved?.result && typeof saved.result.meta === 'object' && saved.result.meta !== null
          ? saved.result.meta as Record<string, unknown> : null;
        const runtime = parseActorRuntime(meta?.actorRuntime);
        if (!runtime) continue;
        cache = {
          ...cache,
          observedActors: pruneObservedActors({
            ...cache.observedActors,
            [trimmed]: { ...runtime, actorId: trimmed, observedAt: record.createdAt },
          }),
        };
        await persist();
        return;
      }
    } catch {
      /* History bootstrap is best-effort and must never fail version status reads. */
    }
  };

  return {
    async status(query: VersionStatusQuery): Promise<VersionStatusSnapshot> {
      await ensureLoaded();
      if (query.egress === 'actor-own' && query.apifyActor?.trim()) {
        await bootstrapObservedActorFromHistory(query.apifyActor.trim());
      }
      const checkedMs = cache.checkedAt ? Date.parse(cache.checkedAt) : Number.NaN;
      const stale = !Number.isFinite(checkedMs) || (now().getTime() - checkedMs) >= ttlMs;
      let checkError: VersionCheckErrorCode | null = null;
      if (query.refresh || stale) {
        if (!inFlight) {
          inFlight = fetchLatestRelease(query.signal).finally(() => { inFlight = null; });
        }
        const outcome = await inFlight;
        if (query.refresh) checkError = outcome.error;
      }
      return buildSnapshot(query.egress, query.apifyActor, checkError);
    },

    async recordActorRuntime(actorId: string, runtime: ActorRuntime | null | undefined): Promise<void> {
      const trimmed = actorId.trim();
      if (!trimmed || !runtime) return;
      const parsed = parseActorRuntime(runtime);
      if (!parsed) return;
      await ensureLoaded();
      const nextCleared = { ...(cache.clearedActors ?? {}) };
      delete nextCleared[trimmed];
      cache = {
        ...cache,
        clearedActors: nextCleared,
        observedActors: pruneObservedActors({
          ...cache.observedActors,
          [trimmed]: { ...parsed, actorId: trimmed, observedAt: now().toISOString() },
        }),
      };
      await persist();
    },

    async markActorRebuilt(actorId: string): Promise<void> {
      const trimmed = actorId.trim();
      if (!trimmed) return;
      await ensureLoaded();
      const at = now().toISOString();
      cache = {
        ...cache,
        clearedActors: { ...(cache.clearedActors ?? {}), [trimmed]: at },
        observedActors: pruneObservedActors({
          ...cache.observedActors,
          [trimmed]: {
            actorId: trimmed,
            version: pluginVersion,
            baselineCatalogRevision,
            observedAt: at,
          },
        }),
      };
      await persist();
    },

    async clearActorRuntime(actorId: string): Promise<void> {
      const trimmed = actorId.trim();
      if (!trimmed) return;
      await ensureLoaded();
      const next = { ...cache.observedActors };
      delete next[trimmed];
      cache = {
        ...cache,
        observedActors: next,
        clearedActors: { ...(cache.clearedActors ?? {}), [trimmed]: now().toISOString() },
      };
      await persist();
    },
  };
}
