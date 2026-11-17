/** Kept separate from Dataset rows so their public shape remains stable. */
export const ACTOR_RUNTIME_KEY = 'GTFA_RUNTIME';
export interface ActorRuntime {
  version: string;
  baselineCatalogRevision: string;
}

/** Only bounded, non-secret version identifiers cross the Host/browser boundary. */
export function parseActorRuntime(value: unknown): ActorRuntime | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.version === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[a-zA-Z0-9.-]{1,40})?$/.test(row.version)
    && typeof row.baselineCatalogRevision === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.baselineCatalogRevision)
    ? { version: row.version, baselineCatalogRevision: row.baselineCatalogRevision } : null;
}
