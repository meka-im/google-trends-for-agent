import { readFile } from 'node:fs/promises';
export interface Anchor { term: string; dailySearches?: number; tolerance?: number; geo: string }
export interface Baselines { version: 1; anchors: Anchor[]; defaultAnchor?: string }
/** Calibrated default: ≈550 US searches/day for `gpts` (≈16.5k/month), ±50%. */
export const DEFAULT_ANCHOR: Anchor = { term: 'gpts', dailySearches: 550, geo: 'US', tolerance: 0.5 };
export function validateAnchor(a: Anchor): Anchor { if (!a || typeof a.term !== 'string' || !a.term.trim() || !Number.isFinite(a.dailySearches) || (a.dailySearches ?? 0) <= 0 || typeof a.geo !== 'string') throw new Error('invalid baseline anchor'); return a; }
export function chooseAnchor(b?: Baselines | Anchor[]): Anchor | undefined { if (!b) return; const rows = Array.isArray(b) ? b : b.anchors; return rows.find(a => !Array.isArray(b) && a.term === b.defaultAnchor) ?? rows[0]; }
/** Daily searches for an anchor. */
export function anchorDailySearches(a: Anchor): number | null {
  const daily = a.dailySearches;
  return daily !== undefined && Number.isFinite(daily) && daily > 0 ? daily : null;
}
/** Match a calibration by term + geo, then fall back to the built-in US `gpts` baseline. */
export function findAnchor(baselines: Baselines | undefined, term: string, geo: string): Anchor | undefined {
  const wanted = term.trim().toLowerCase();
  return baselines?.anchors.find(a => a.term.trim().toLowerCase() === wanted && a.geo === geo)
    ?? (wanted === DEFAULT_ANCHOR.term && geo === DEFAULT_ANCHOR.geo ? DEFAULT_ANCHOR : undefined);
}
export async function loadBaselines(path: string): Promise<Baselines> { const b = JSON.parse(await readFile(path, 'utf8')); if (b.version !== 1 || !Array.isArray(b.anchors) || !b.anchors.length) throw new Error('invalid baselines'); b.anchors.forEach(validateAnchor); if (b.defaultAnchor && !b.anchors.some((a: Anchor) => a.term === b.defaultAnchor)) throw new Error('defaultAnchor not found'); return b; }
