import { TRENDING_GEOS } from './geos.js';

/** Apify proxy modes exposed by dsh: residential IPs or Apify's automatic datacenter selection. */
export const APIFY_PROXY_GROUPS = ['RESIDENTIAL', 'auto'] as const;
export type ApifyProxyGroup = (typeof APIFY_PROXY_GROUPS)[number];
export const DEFAULT_APIFY_PROXY_GROUP: ApifyProxyGroup = 'RESIDENTIAL';

/**
 * Apify sign-up facts, checked 2026-11-12:
 * - https://apify.com/pricing — Free is $0 and includes $5 of platform usage per
 *   month; Starter is $19/mo and includes $19. Residential proxy is $8/GB on both.
 * - https://docs.apify.com/platform/proxy (External connection) — "To connect to
 *   Apify Proxy from outside the Apify platform, you need a paid Apify plan."
 *   This plugin's Apify egress is an external connection, so it needs a paid plan.
 * - Sign-up: https://console.apify.com/sign-up
 */
export const APIFY_SIGNUP_URL = 'https://console.apify.com/sign-up';
export const APIFY_PRICING_URL = 'https://apify.com/pricing';
export const APIFY_FREE_MONTHLY_CREDIT_USD = 5;
export const APIFY_STARTER_MONTHLY_USD = 19;

/** Curated Apify proxy countries; the UI shows localized names next to the code. */
export const PROXY_COUNTRY_CODES = [
  'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'KR', 'SG', 'IN', 'BR', 'MX', 'ES', 'IT', 'NL', 'SE',
  'CH', 'IE', 'HK', 'TW', 'ID', 'MY', 'PH', 'TH', 'VN', 'TR', 'AE', 'SA', 'ZA', 'NG', 'AR', 'PL',
] as const;
export const DEFAULT_PROXY_COUNTRY = 'US';

/** Built-in calibration anchor terms, shared by the host and the browser form without importing baselines. */
export const BUILTIN_ANCHOR_TERMS = ['gpts', 'sudoku'] as const;

/** Empty geo means Worldwide in Google Trends Explore. */
export const WORLDWIDE_GEO = '';
/** Explore geos supported by the existing Trending Now list; Worldwide is included as ''. */
export const GEO_CODES: readonly string[] = [WORLDWIDE_GEO, ...TRENDING_GEOS.map(geo => geo.code)];
export const DEFAULT_GEO = 'US';

const proxyGroupSet = new Set<string>(APIFY_PROXY_GROUPS);
const proxyCountrySet = new Set<string>(PROXY_COUNTRY_CODES);
const geoSet = new Set<string>(GEO_CODES);

/** Normalize an Apify proxy group, accepting case variants. */
export function normalizeApifyProxyGroup(value: string | null | undefined): ApifyProxyGroup {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'AUTO') return 'auto';
  if (normalized === 'RESIDENTIAL') return 'RESIDENTIAL';
  throw new Error('apifyProxyGroup must be "RESIDENTIAL" or "auto"');
}

/** Normalize an Apify proxy country against the curated list. */
export function normalizeProxyCountry(value: string | null | undefined): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (!proxyCountrySet.has(code)) throw new Error(`apifyProxyCountry must be one of: ${PROXY_COUNTRY_CODES.join(', ')}`);
  return code;
}

/** Normalize a Trending/Explore geo against the shared list; '' is Worldwide. */
export function normalizeGeo(value: string | null | undefined): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (!geoSet.has(code)) throw new Error('geo must be empty (Worldwide) or a supported Google Trends country code');
  return code;
}

export function isApifyProxyGroup(value: unknown): value is ApifyProxyGroup {
  return typeof value === 'string' && proxyGroupSet.has(value);
}

export function isProxyCountry(value: unknown): value is string {
  return typeof value === 'string' && proxyCountrySet.has(value);
}

export function isGeo(value: unknown): value is string {
  return typeof value === 'string' && geoSet.has(value);
}

const displayNames = new Map<string, Intl.DisplayNames>();

/** Localized region name from Intl.DisplayNames, with the code as a safe fallback. */
export function regionName(code: string, locale = 'en'): string {
  if (!code) return '';
  let names = displayNames.get(locale);
  if (!names) {
    try { names = new Intl.DisplayNames([locale], { type: 'region' }); }
    catch { names = new Intl.DisplayNames(['en'], { type: 'region' }); }
    displayNames.set(locale, names);
  }
  try { return names.of(code) ?? code; }
  catch { return code; }
}

/** "United States (US)" style label used by country and geo selects. */
export function regionLabel(code: string, locale = 'en'): string {
  return code ? `${regionName(code, locale)} (${code})` : '';
}
