import { readFile } from 'node:fs/promises';
import type { TrendsFilter } from './filter.js';
import { BUILTIN_ANCHOR_TERMS } from './options.js';

export interface Anchor { term: string; dailySearches?: number; tolerance?: number; geo: string }
/** Optional per-window overrides; short = now 1-H / now 4-H / now 1-d, long = everything else. */
export interface WindowAnchors { short?: string; long?: string }
export interface Baselines { version: 2; anchors: Anchor[]; windowAnchors?: WindowAnchors }

/** Windows measured in hours or one day: dense, fast-moving, and better anchored by sudoku. */
export const SHORT_WINDOWS = ['now 1-H', 'now 4-H', 'now 1-d'] as const;
const DEFAULTS = { short: 'sudoku', long: 'gpts' } as const;

/**
 * Built-in US baselines. gpts ≈3,500/day is the long-window ruler (now 7-d and beyond),
 * back-derived from public keyword-tool volumes through measured 7-day Trends ratios.
 * sudoku ≈63,000/day is the same ruler measured through the 7-day sudoku/gpts ratio.
 */
export const BUILTIN_ANCHORS: readonly Anchor[] = [
  { term: BUILTIN_ANCHOR_TERMS[0], dailySearches: 3500, geo: 'US', tolerance: 0.5 },
  { term: BUILTIN_ANCHOR_TERMS[1], dailySearches: 63000, geo: 'US', tolerance: 0.5 },
];

function invalid(message: string): never { throw new Error(`Invalid baselines: ${message}`); }
const isShort = (time: string) => (SHORT_WINDOWS as readonly string[]).includes(time);

/** Anchor term for a window unless an explicit anchor overrides it. */
export function defaultAnchorFor(time: string, baselines?: Baselines): string {
  const window = isShort(time) ? 'short' : 'long';
  return baselines?.windowAnchors?.[window]?.trim() || DEFAULTS[window];
}
export function validateAnchor(a: Anchor): Anchor {
  if (!a || typeof a.term !== 'string' || !a.term.trim() || !Number.isFinite(a.dailySearches) || (a.dailySearches ?? 0) <= 0 || typeof a.geo !== 'string' || !a.geo.trim()) throw new Error('invalid baseline anchor');
  if (a.tolerance !== undefined && (typeof a.tolerance !== 'number' || !Number.isFinite(a.tolerance) || a.tolerance < 0 || a.tolerance > 1)) throw new Error('tolerance must be a number from 0 to 1');
  return a;
}
/** Daily searches for an anchor. */
export function anchorDailySearches(a: Anchor): number | null {
  const daily = a.dailySearches;
  return daily !== undefined && Number.isFinite(daily) && daily > 0 ? daily : null;
}
/** Calibration is published only for web search across all categories. */
function supportsBaseline(filter: Pick<TrendsFilter, 'category' | 'property'>): boolean {
  return filter.category === 0 && ['', 'web'].includes(filter.property.trim().toLowerCase());
}
/** Explain why an anchor must not be applied to the requested search scope. */
export function baselineScopeMismatch(filter: Pick<TrendsFilter, 'category' | 'property'>): string | undefined {
  if (supportsBaseline(filter)) return;
  const property = filter.property.trim().toLowerCase() || 'web';
  return `Baseline calibration applies only to web/all categories; requested category ${filter.category}, property ${property}`;
}
/** Match a calibration by term + normalized geo in user baselines first, then the built-in US anchors. */
export function findAnchor(
  baselines: Baselines | undefined,
  term: string,
  geo: string,
  filter: Pick<TrendsFilter, 'category' | 'property'> = { category: 0, property: '' },
): Anchor | undefined {
  if (!supportsBaseline(filter)) return undefined;
  const wanted = term.trim().toLowerCase();
  const wantedGeo = geo.trim().toUpperCase();
  return baselines?.anchors.find(a => a.term.trim().toLowerCase() === wanted && a.geo.trim().toUpperCase() === wantedGeo)
    ?? BUILTIN_ANCHORS.find(a => a.term === wanted && a.geo.trim().toUpperCase() === wantedGeo);
}
/** Validate a version 2 baselines value; version 1 is rejected rather than translated. */
export function parseBaselines(parsed: unknown, source = 'baselines'): Baselines {
  const label = source ? `${source}: ` : '';
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid(`${label}expected a JSON object`);
  const row = parsed as Record<string, unknown>;
  if (row.version === 1) invalid(`${label}version 1 is no longer supported; use version 2 with "anchors" and optional "windowAnchors"`);
  if (row.version !== 2) invalid(`${label}"version" must be 2`);
  const anchorRows = row.anchors;
  if (!Array.isArray(anchorRows) || !anchorRows.length) invalid(`${label}"anchors" must be a non-empty array`);
  anchorRows.forEach((anchor, i) => {
    try { validateAnchor(anchor as Anchor); }
    catch (e) { invalid(`${label}anchors[${i}]: ${e instanceof Error ? e.message : String(e)}`); }
  });
  const anchors = anchorRows as Anchor[];
  const known = (term: string) => anchors.some(a => a.term.trim().toLowerCase() === term.trim().toLowerCase())
    || BUILTIN_ANCHORS.some(a => a.term === term.trim().toLowerCase());
  if (row.windowAnchors !== undefined) {
    if (!row.windowAnchors || typeof row.windowAnchors !== 'object' || Array.isArray(row.windowAnchors)) invalid(`${label}"windowAnchors" must be an object`);
    const windows = row.windowAnchors as Record<string, unknown>;
    for (const key of Object.keys(windows)) if (key !== 'short' && key !== 'long') invalid(`${label}windowAnchors.${key} is not supported (use "short" or "long")`);
    for (const key of ['short', 'long'] as const) {
      const term = windows[key];
      if (term === undefined) continue;
      if (typeof term !== 'string') invalid(`${label}windowAnchors.${key} must be a non-empty term`);
      const trimmed = term.trim();
      if (!trimmed) invalid(`${label}windowAnchors.${key} must be a non-empty term`);
      if (!known(trimmed)) invalid(`${label}windowAnchors.${key} "${trimmed}" is not in anchors or the built-in anchors`);
    }
  }
  return { version: 2, anchors, ...(row.windowAnchors !== undefined ? { windowAnchors: row.windowAnchors as WindowAnchors } : {}) };
}

/** Load a version 2 baselines file; version 1 is rejected rather than translated. */
export async function loadBaselines(path: string): Promise<Baselines> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { invalid(`${path}: ${e instanceof Error ? e.message : String(e)}`); }
  return parseBaselines(parsed, path);
}
/** Optional GTFA_BASELINES override used by the CLI, MCP server, and Actor. */
export async function loadBaselinesFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Baselines | undefined> {
  const path = env.GTFA_BASELINES?.trim();
  if (!path) return undefined;
  try { return await loadBaselines(path); }
  catch (e) { throw new Error(`GTFA_BASELINES: ${e instanceof Error ? e.message : String(e)}`); }
}
