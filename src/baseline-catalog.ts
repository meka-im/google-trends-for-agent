import {
  MEKA_BASELINES,
  MEKA_BASELINES_URL,
  MEKA_BASELINE_VERSION,
  getActiveMekaBaselines,
  mekaAnchorsFor,
  mekaDefaultAnchor,
  type MekaAnchor,
} from './dsh-baselines.js';

/** Browser-safe calibration data shared by the CLI, MCP server, Actor and dsh. */
export interface BaselineSource {
  provider: string;
  url: string;
  monthlySearches: number | null;
  /** A provider's measurement period, not the date we fetched its page. */
  dataPeriod: string | null;
}

export interface CatalogBaseline {
  term: string;
  geo: string;
  dailySearches: number;
  tolerance: number;
  /** Date sources were checked. Does not claim their measurements are this recent. */
  checkedAt: string;
  method: 'legacy-ratio' | 'monthly-estimate';
  dailyOnly?: boolean;
  sources: readonly BaselineSource[];
}

export const BASELINE_CATALOG_REVISION = MEKA_BASELINE_VERSION;
export const BASELINE_REFERENCE_URL = 'https://meka.im/datasets/google-trends-anchors';

function toCatalogBaseline(anchor: MekaAnchor, checkedAt: string): CatalogBaseline {
  return {
    term: anchor.term,
    geo: anchor.geo,
    dailySearches: anchor.dailySearches,
    tolerance: 0.5,
    checkedAt,
    method: 'monthly-estimate',
    ...(anchor.dailyOnly ? { dailyOnly: true } : {}),
    sources: [{
      provider: 'Google Ads Keyword Planner (MEKA)',
      url: MEKA_BASELINES_URL,
      monthlySearches: Math.round(anchor.dailySearches * (365.25 / 12)),
      dataPeriod: '2025-11..2026-10',
    }],
  };
}

/**
 * Estimates for web search / all categories, derived from the MEKA Google Ads
 * Keyword Planner multi-tier anchor catalog. Never measured real-time Google volumes.
 */
export const BASELINE_CATALOG: readonly CatalogBaseline[] = MEKA_BASELINES.map(anchor =>
  toCatalogBaseline(anchor, MEKA_BASELINE_VERSION));

/** Unknown regions retain the US fallback term, but never borrow another region's volume. */
export function automaticAnchorFor(time: string, geo = 'US'): string {
  const active = getActiveMekaBaselines().anchors;
  const pick = mekaDefaultAnchor(geo, time, active) ?? mekaDefaultAnchor('US', time, active);
  return pick?.term ?? 'sudoku';
}

export function catalogForGeo(geo: string): readonly CatalogBaseline[] {
  const active = getActiveMekaBaselines();
  return mekaAnchorsFor(geo, undefined, active.anchors).map(anchor => toCatalogBaseline(anchor, active.version));
}

export const CATALOG_ANCHOR_TERMS: readonly string[] = [...new Set(MEKA_BASELINES.map(anchor => anchor.term))];

export const REGIONAL_CALIBRATION_GUIDANCE = `Automatic calibration uses MEKA multi-tier Google Ads Keyword Planner baselines (${BASELINE_REFERENCE_URL}) covering Worldwide, US, CA, GB, DE, FR, and JP. Anchors marked 30d+ apply to 30-day and longer daily windows. Explicit anchors and user baseline overrides take priority. Unknown regions, unsupported search scopes, and sparse samples retain null traffic.`;
