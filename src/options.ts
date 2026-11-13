import { TRENDING_GEOS } from './geos.js';

/** `local` sends Google requests from this machine; the Actor routes relay them through Apify. */
export type EgressMode = 'local' | 'actor-public' | 'actor-own';
/** Every supported egress value, in display order. */
export const EGRESS_MODES = ['local', 'actor-public', 'actor-own'] as const;

/** The Actor this package ships; the plugin deploys or selects this name. */
export const GTFA_ACTOR_NAME = 'google-trends-for-agent';
/** Public Store Actor API id (username~name, as Apify returns it). */
export const GTFA_PUBLIC_ACTOR_ID = 'meka.im~google-trends-for-agent';
/** Human-readable public Actor id. */
export const GTFA_PUBLIC_ACTOR_LABEL = 'meka.im/google-trends-for-agent';
/** Open-source repository; also the Git source used for one-click and manual deploys. */
export const GTFA_SOURCE_URL = 'https://github.com/meka-im/google-trends-for-agent';
/** Apify Store page for the published public Actor. */
export const GTFA_STORE_URL = 'https://apify.com/meka.im/google-trends-for-agent';
/** Git repository the one-click deploy and the manual Git-repo deploy build from. */
export const GTFA_ACTOR_GIT_URL = 'https://github.com/meka-im/google-trends-for-agent';
/** Standby idle timeout in the deploy payload, seconds. Keep in sync with GTFA_IDLE_EXIT_SECS. */
export const GTFA_ACTOR_STANDBY_IDLE_SECS = 60;

/**
 * Apify sign-up facts, checked 2026-11-12:
 * - https://apify.com/pricing — Free is $0 and includes $5 of platform usage per
 *   month; Starter is $19/mo. On-platform residential proxy is available to Free
 *   users, so the Actor path works without a paid plan.
 * - https://docs.apify.com/academy/expert-scraping-with-apify/solutions/rotating-proxies
 *   — "All users have access to the BUYPROXIES94952, GOOGLE_SERP and RESIDENTIAL
 *   groups. Free users cannot access the proxy from outside the Apify platform."
 * - Sign-up: https://console.apify.com/sign-up
 */
export const APIFY_SIGNUP_URL = 'https://console.apify.com/sign-up';
export const APIFY_PRICING_URL = 'https://apify.com/pricing';
export const APIFY_FREE_MONTHLY_CREDIT_USD = 5;
/**
 * Estimated cost of one isolated `trends_ask` through the Actor, measured on
 * build 0.1.7 (Nov 2026): ~65 KB residential ($8/GB) plus a 512 MB Standby run
 * that exits after 60 s idle ($0.2/CU). Calls in a warm run cost less.
 */
export const APIFY_EST_COST_PER_CALL_USD = 0.0025;

/** Rough monthly call allowance: floor(credit / cost) rounded down to the nearest 100. */
export function apifyEstimatedCalls(
  creditUsd = APIFY_FREE_MONTHLY_CREDIT_USD,
  costPerCallUsd = APIFY_EST_COST_PER_CALL_USD,
): number {
  if (!(creditUsd > 0) || !(costPerCallUsd > 0)) return 0;
  return Math.floor(Math.floor(creditUsd / costPerCallUsd) / 100) * 100;
}

/** Built-in calibration anchor terms, shared by the host and the browser form without importing baselines. */
export const BUILTIN_ANCHOR_TERMS = ['gpts', 'sudoku'] as const;

/** Empty geo means Worldwide in Google Trends Explore. */
export const WORLDWIDE_GEO = '';
/** Explore geos supported by the existing Trending Now list; Worldwide is included as ''. */
export const GEO_CODES: readonly string[] = [WORLDWIDE_GEO, ...TRENDING_GEOS.map(geo => geo.code)];
export const DEFAULT_GEO = 'US';

const geoSet = new Set<string>(GEO_CODES);

/** Normalize a Trending/Explore geo against the shared list; '' is Worldwide. */
export function normalizeGeo(value: string | null | undefined): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (!geoSet.has(code)) throw new Error('geo must be empty (Worldwide) or a supported Google Trends country code');
  return code;
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
