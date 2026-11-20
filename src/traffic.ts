import { readFile } from 'node:fs/promises';
import type { TrendsFilter } from './filter.js';
import { automaticAnchorFor, BASELINE_CATALOG } from './baseline-catalog.js';
import { getActiveMekaBaselines, mekaAnchorsFor } from './dsh-baselines.js';

export interface Anchor { term: string; dailySearches?: number; tolerance?: number; geo: string }
/** Optional per-window overrides; short = now 1-H / now 4-H / now 1-d, long = everything else. */
export interface WindowAnchors { short?: string; long?: string }
export interface Baselines { version: 2; anchors: Anchor[]; windowAnchors?: WindowAnchors }

/** Windows measured in hours or one day. */
export const SHORT_WINDOWS = ['now 1-H', 'now 4-H', 'now 1-d'] as const;

/** Runtime calibration fields; source metadata stays in the shared catalog. */
export const BUILTIN_ANCHORS: readonly Anchor[] = BASELINE_CATALOG.map(({ term, geo, dailySearches, tolerance }) => ({ term, geo, dailySearches, tolerance }));

function activeBuiltins(): Anchor[] {
  return getActiveMekaBaselines().anchors.map(({ term, geo, dailySearches }) => ({
    term, geo, dailySearches, tolerance: 0.5,
  }));
}

function invalid(message: string): never { throw new Error(`Invalid baselines: ${message}`); }
const isShort = (time: string) => (SHORT_WINDOWS as readonly string[]).includes(time);

/** Anchor term for a window unless an explicit anchor overrides it. */
export function defaultAnchorFor(time: string, baselines?: Baselines, geo = 'US'): string {
  const window = isShort(time) ? 'short' : 'long';
  return baselines?.windowAnchors?.[window]?.trim() || automaticAnchorFor(time, geo);
}
export function validateAnchor(a: Anchor): Anchor {
  if (!a || typeof a.term !== 'string' || !a.term.trim() || !Number.isFinite(a.dailySearches) || (a.dailySearches ?? 0) <= 0 || typeof a.geo !== 'string') throw new Error('invalid baseline anchor');
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
/** Match term + normalized geo exactly; explicit empty geo is Worldwide, never US. */
export function findAnchor(
  baselines: Baselines | undefined,
  term: string,
  geo: string,
  filter: Pick<TrendsFilter, 'category' | 'property'> = { category: 0, property: '' },
): Anchor | undefined {
  if (!supportsBaseline(filter)) return undefined;
  const wanted = term.trim().toLowerCase();
  const wantedGeo = geo.trim().toUpperCase();
  const custom = baselines?.anchors.find(a => a.term.trim().toLowerCase() === wanted && a.geo.trim().toUpperCase() === wantedGeo);
  if (custom) return custom;
  const meka = mekaAnchorsFor(wantedGeo).find(a => a.term.trim().toLowerCase() === wanted);
  return meka ? { term: meka.term, geo: meka.geo, dailySearches: meka.dailySearches, tolerance: 0.5 } : undefined;
}

/**
 * Pin regional defaults into an on-demand request, including for existing Actors.
 * Country requests omit the built-in Worldwide rows for older v2 parsers, which
 * rejected empty anchor geos. User-provided rows are preserved and always win.
 */
export function baselinesForActor(geo: string, baselines?: Baselines): Baselines {
  const user = baselines?.anchors ?? [];
  const key = (anchor: Anchor) => JSON.stringify([anchor.term.trim().toLowerCase(), anchor.geo.trim().toUpperCase()]);
  const overridden = new Set(user.map(key));
  const builtins = activeBuiltins();
  return {
    version: 2,
    anchors: [...user, ...builtins.filter(anchor => (anchor.geo !== '' || geo.trim() === '') && !overridden.has(key(anchor)))],
    windowAnchors: {
      short: defaultAnchorFor('now 1-d', baselines, geo),
      long: defaultAnchorFor('now 7-d', baselines, geo),
    },
  };
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
  const builtins = activeBuiltins();
  const known = (term: string) => anchors.some(a => a.term.trim().toLowerCase() === term.trim().toLowerCase())
    || builtins.some(a => a.term.trim().toLowerCase() === term.trim().toLowerCase());
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
