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
  sources: readonly BaselineSource[];
}

export const BASELINE_CATALOG_REVISION = '2026-11-16';
export const BASELINE_REFERENCE_URL = 'https://github.com/meka-im/google-trends-for-agent/blob/main/docs/baselines.md';
const checkedAt = BASELINE_CATALOG_REVISION;
const seo = (term: string, geo: string, monthlySearches: number): BaselineSource => ({
  provider: 'seodata.dev', url: `https://api.seodata.dev/v1/keyword?q=${encodeURIComponent(term)}&country=${geo.toLowerCase()}`,
  monthlySearches, dataPeriod: null,
});
const semrush = (domain: string, monthlySearches: number, dataPeriod: string): BaselineSource => ({
  provider: 'Semrush', url: `https://www.semrush.com/website/${domain}/overview/`, monthlySearches, dataPeriod,
});

/**
 * Estimates for web search / all categories, never measured Google volumes.
 * New daily values use monthly / (365.25 / 12), rounded to two significant digits.
 * DE/FR use the geometric midpoint of the two direct keyword-volume estimates.
 * The wider ±75% band reflects source disagreement and unknown measurement periods;
 * it is an assumption, not a statistical confidence interval. See docs/baselines.md.
 */
export const BASELINE_CATALOG: readonly CatalogBaseline[] = [
  { term: 'gpts', geo: 'US', dailySearches: 3500, tolerance: 0.5, checkedAt, method: 'legacy-ratio',
    sources: [{ provider: 'GTFA calibration study', url: 'https://github.com/meka-im/google-trends-for-agent/blob/main/docs/reference.md#calibration-and-the-anchor', monthlySearches: null, dataPeriod: null }] },
  { term: 'sudoku', geo: 'US', dailySearches: 63000, tolerance: 0.5, checkedAt, method: 'legacy-ratio',
    sources: [semrush('sudoku.com', 1830000, '2026-10')] },
  { term: 'sudoku', geo: 'CA', dailySearches: 12000, tolerance: 0.75, checkedAt, method: 'monthly-estimate', sources: [seo('sudoku', 'CA', 368000)] },
  { term: 'sudoku', geo: 'GB', dailySearches: 27000, tolerance: 0.75, checkedAt, method: 'monthly-estimate', sources: [seo('sudoku', 'GB', 823000)] },
  { term: 'sudoku', geo: 'AU', dailySearches: 8100, tolerance: 0.75, checkedAt, method: 'monthly-estimate', sources: [seo('sudoku', 'AU', 246000)] },
  { term: 'sudoku', geo: 'DE', dailySearches: 27000, tolerance: 0.75, checkedAt, method: 'monthly-estimate',
    sources: [seo('sudoku', 'DE', 1000000), semrush('zeit.de', 673000, '2026-10')] },
  { term: 'sudoku', geo: 'FR', dailySearches: 20000, tolerance: 0.75, checkedAt, method: 'monthly-estimate',
    sources: [seo('sudoku', 'FR', 550000), semrush('e-sudoku.fr', 673000, '2026-10')] },
  { term: 'ナンプレ', geo: 'JP', dailySearches: 22000, tolerance: 0.75, checkedAt, method: 'monthly-estimate',
    sources: [{ provider: 'Semrush (indexed September report)', url: 'https://de.semrush.com/website/sudoku.name/overview/', monthlySearches: 673000, dataPeriod: '2026-09' }] },
  { term: 'calculator', geo: 'IN', dailySearches: 300000, tolerance: 0.75, checkedAt, method: 'monthly-estimate', sources: [seo('calculator', 'IN', 9140000)] },
  { term: 'sudoku', geo: '', dailySearches: 220000, tolerance: 0.75, checkedAt, method: 'monthly-estimate',
    sources: [{ provider: 'The Word Finder (reported Ahrefs export)', url: 'https://www.thewordfinder.com/blog/5000-years-of-games-how-we-got-from-senet-to-wordle/', monthlySearches: 6640000, dataPeriod: '2026-07' }] },
];

const automatic: Readonly<Record<string, { short: string; long: string }>> = {
  US: { short: 'sudoku', long: 'gpts' },
  CA: { short: 'sudoku', long: 'sudoku' }, GB: { short: 'sudoku', long: 'sudoku' },
  AU: { short: 'sudoku', long: 'sudoku' }, DE: { short: 'sudoku', long: 'sudoku' },
  FR: { short: 'sudoku', long: 'sudoku' }, JP: { short: 'ナンプレ', long: 'ナンプレ' },
  IN: { short: 'calculator', long: 'calculator' }, '': { short: 'sudoku', long: 'sudoku' },
};

/** Unknown regions retain the term defaults, but never borrow another region's volume. */
export function automaticAnchorFor(time: string, geo = 'US'): string {
  const window = ['now 1-H', 'now 4-H', 'now 1-d'].includes(time) ? 'short' : 'long';
  return (automatic[geo.trim().toUpperCase()] ?? automatic.US)![window];
}

export function catalogForGeo(geo: string): readonly CatalogBaseline[] {
  return BASELINE_CATALOG.filter(anchor => anchor.geo === geo.trim().toUpperCase());
}

export const CATALOG_ANCHOR_TERMS: readonly string[] = [...new Set(BASELINE_CATALOG.map(anchor => anchor.term))];

export const REGIONAL_CALIBRATION_GUIDANCE = 'Automatic anchors match region and window: US uses sudoku (63,000/day) for 1h/4h/24h and gpts (3,500/day) for 7d and longer; CA, GB, AU, DE, FR and Worldwide use their own sudoku baselines for both windows; JP uses ナンプレ; IN uses calculator. New regional baselines are rounded third-party estimates with a ±75% assumption band, not measured volumes or a statistical confidence interval. Unknown regions, unsupported search scopes and sparse anchors retain null traffic. Sources, measurement periods and validation: https://github.com/meka-im/google-trends-for-agent/blob/main/docs/baselines.md.';
