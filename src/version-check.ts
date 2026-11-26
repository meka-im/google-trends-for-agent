import type { ActorRuntime } from './actor-runtime.js';
import { parseActorRuntime } from './actor-runtime.js';
import { GTFA_SOURCE_URL, type EgressMode } from './options.js';

export const GTFA_RELEASES_URL = `${GTFA_SOURCE_URL}/releases`;
export const GTFA_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/meka-im/google-trends-for-agent/releases/latest';
export const GTFA_UPGRADE_COMMAND = 'dsh plugin --profile web add google-trends-for-agent@latest';
export const VERSION_STATUS_PATH = '/api/gtfa.version';

export interface ReleaseInfo {
  version: string;
  tagName: string;
  url: string;
  publishedAt: string | null;
  highlights: string[];
}

export interface ObservedActorRuntime extends ActorRuntime {
  actorId: string;
  observedAt: string;
}

export type VersionCheckErrorCode = 'network' | 'rate-limited' | 'http';

export interface VersionStatusSnapshot {
  pluginVersion: string;
  baselineCatalogRevision: string;
  egress: EgressMode;
  actorId: string | null;
  latestRelease: ReleaseInfo | null;
  pluginUpdateAvailable: boolean;
  observedActor: ObservedActorRuntime | null;
  actorUpdateAvailable: boolean;
  checkedAt: string | null;
  checkError: VersionCheckErrorCode | null;
}

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const SEMVER_RE = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:-([a-zA-Z0-9.-]{1,40}))?$/;

/** Parse a bounded X.Y.Z(-prerelease) version string. */
export function parseSemver(raw: string | null | undefined): ParsedSemver | null {
  if (typeof raw !== 'string') return null;
  const match = SEMVER_RE.exec(raw.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/** Compare two semver strings: -1 if a < b, 0 if equal, 1 if a > b, null if invalid. */
export function compareSemver(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

export type RuntimeDriftStatus = 'aligned' | 'actor-behind' | 'plugin-behind' | 'catalog-behind' | 'unknown';

export interface RuntimeDriftInfo {
  status: RuntimeDriftStatus;
  warning: string | null;
}

/** Direction-aware version and baseline drift check between an Actor run and this client. */
export function describeActorRuntimeDrift(
  runtime: ActorRuntime | null | undefined,
  pluginVersion: string,
  baselineCatalogRevision: string,
  egress?: EgressMode,
): RuntimeDriftInfo {
  if (!runtime) {
    return {
      status: 'unknown',
      warning: 'Actor version is unverified; update the Actor before checking version parity.',
    };
  }
  const cmp = compareSemver(runtime.version, pluginVersion);
  if (cmp !== null && cmp < 0) {
    return {
      status: 'actor-behind',
      warning: egress === 'actor-public'
        ? `Public Actor (v${runtime.version}) is behind client v${pluginVersion}; retry shortly or check the latest Actor build.`
        : `Your Apify Actor (v${runtime.version}) is behind client v${pluginVersion}; update your Actor in Plugins → Google Trends or switch to the Public Actor.`,
    };
  }
  if (cmp !== null && cmp > 0) {
    return {
      status: 'plugin-behind',
      warning: `Client v${pluginVersion} is behind Apify Actor v${runtime.version}; upgrade google-trends-for-agent and restart dsh.`,
    };
  }
  if (runtime.baselineCatalogRevision !== baselineCatalogRevision) {
    const olderActor = runtime.baselineCatalogRevision < baselineCatalogRevision;
    return {
      status: 'catalog-behind',
      warning: olderActor
        ? `Apify Actor baseline catalog (${runtime.baselineCatalogRevision}) is behind client (${baselineCatalogRevision}); update your Actor or switch to the Public Actor.`
        : `Client baseline catalog (${baselineCatalogRevision}) is behind Apify Actor (${runtime.baselineCatalogRevision}); sync MEKA baselines or upgrade google-trends-for-agent.`,
    };
  }
  return { status: 'aligned', warning: null };
}

export function isSafeReleaseUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith('/meka-im/google-trends-for-agent/');
  } catch {
    return false;
  }
}

/** Validate a version status payload crossing the Host → browser boundary. */
export function parseVersionStatus(value: unknown): VersionStatusSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.pluginVersion !== 'string' || !parseSemver(row.pluginVersion)) return null;
  if (typeof row.baselineCatalogRevision !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.baselineCatalogRevision)) return null;
  const egress = row.egress === 'local' || row.egress === 'actor-public' || row.egress === 'actor-own' ? row.egress : null;
  if (!egress) return null;

  let latestRelease: ReleaseInfo | null = null;
  if (row.latestRelease && typeof row.latestRelease === 'object' && !Array.isArray(row.latestRelease)) {
    const rel = row.latestRelease as Record<string, unknown>;
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

  let observedActor: ObservedActorRuntime | null = null;
  if (row.observedActor && typeof row.observedActor === 'object' && !Array.isArray(row.observedActor)) {
    const obs = row.observedActor as Record<string, unknown>;
    const parsedRuntime = parseActorRuntime(obs);
    if (parsedRuntime && typeof obs.actorId === 'string' && obs.actorId.trim() && typeof obs.observedAt === 'string' && Number.isFinite(Date.parse(obs.observedAt))) {
      observedActor = {
        ...parsedRuntime,
        actorId: obs.actorId.trim(),
        observedAt: obs.observedAt,
      };
    }
  }

  const checkError = row.checkError === 'network' || row.checkError === 'rate-limited' || row.checkError === 'http'
    ? row.checkError : null;

  return {
    pluginVersion: row.pluginVersion,
    baselineCatalogRevision: row.baselineCatalogRevision,
    egress,
    actorId: typeof row.actorId === 'string' && row.actorId.trim() ? row.actorId.trim() : null,
    latestRelease,
    pluginUpdateAvailable: row.pluginUpdateAvailable === true,
    observedActor,
    actorUpdateAvailable: row.actorUpdateAvailable === true,
    checkedAt: typeof row.checkedAt === 'string' && Number.isFinite(Date.parse(row.checkedAt)) ? row.checkedAt : null,
    checkError,
  };
}
