/**
 * Browser half of the gtfa dsh plugin.
 *
 * dsh's Plugins page renders a plugin's own page from `plugins.row.config`.
 * The page reads the Host's Config-derived form (only `.volatile()` fields are
 * exposed) and writes path operations. `role('secret')` redacts the Apify token
 * on reads; a submitted token is persisted by dsh in the profile's
 * `cordis.patch.yml`, so the UI says that instead of calling it a vault.
 *
 * The Apify usage card and Test connection button call owner-only Host routes
 * with relative URLs. Connection tests can submit an unsaved manual token to
 * the Host without persisting it. Stored tokens are never returned to the
 * browser; all Apify/Google traffic runs on the Host.
 *
 * Every setting that has a finite set of values is a select, segmented control,
 * or switch. Query-default pickers allow searching, but only selecting a listed
 * value changes the draft. Only the token, a new anchor term, dailySearches,
 * and directories accept free-form configuration text.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { Icon } from './icons.js';
import { ChoicePicker } from './choice-picker.js';
import { BaselineCatalog } from './baseline-catalog.js';
import { SETTINGS_CSS } from './theme.js';
import { Dashboard, TrendsMark } from './dashboard.js';
import { DashboardController } from './dashboard-state.js';
import { DASHBOARD_EN, DASHBOARD_ZH } from './dashboard-locale.js';
import { parseActorRuntime } from '../actor-runtime.js';
import { automaticAnchorFor, catalogForGeo, BASELINE_CATALOG_REVISION } from '../baseline-catalog.js';
import { mekaAnchorsFor, mekaDefaultAnchor } from '../dsh-baselines.js';
import { CONNECTION_KEYWORDS, type ConnectionCode, type ConnectionResult, type DataCheck } from '../connection-check.js';
import {
  APIFY_FREE_MONTHLY_CREDIT_USD, APIFY_PRICING_URL, APIFY_SIGNUP_URL,
  BUILTIN_ANCHOR_TERMS, DEFAULT_GEO, GEO_CODES, GTFA_PUBLIC_ACTOR_ID, GTFA_PUBLIC_ACTOR_LABEL, GTFA_SOURCE_URL,
  GTFA_STORE_URL, regionLabel, resolveEgress, type EgressMode, type EgressNotice,
} from '../options.js';

/** Cordis service name used by the client bundle. */
export const inject = ['slots', 'locale', 'configForms'];

const NS = 'gtfa';
const PACKAGE = 'google-trends-for-agent';
const ENTRY = 'gtfa';
const USAGE_URL = 'api/gtfa.apify-usage';
const ACTORS_URL = 'api/gtfa.apify-actors';
const DEPLOY_URL = 'api/gtfa.apify-deploy';
const UPDATE_URL = 'api/gtfa.apify-update';
const TEST_URL = 'api/gtfa.test-connection';
export const APIFY_OAUTH_STATUS_URL = 'api/gtfa.apify-oauth';
export const APIFY_OAUTH_START_URL = 'api/gtfa.apify-oauth-start';
export const APIFY_OAUTH_CANCEL_URL = 'api/gtfa.apify-oauth-cancel';
export const APIFY_OAUTH_LOGOUT_URL = 'api/gtfa.apify-oauth-logout';
/** Fixed official fallback when the Host status has no safe verification URL. */
export const APIFY_OAUTH_VERIFICATION_URL = 'https://console.apify.com/authorize/device';
const DEPLOY_MANUAL_URL = `${GTFA_SOURCE_URL}#deploy-it-yourself`;
/** Profile keys removed with the old egress; Save unsets them. */
const LEGACY_EGRESS_KEYS = ['apifyProxyGroup', 'apifyProxyCountry'] as const;

type Translate = (key: string) => string;

type PathOp = {
  op: 'set';
  path: string[];
  value: unknown;
} | {
  op: 'unset';
  path: string[];
};

interface ConfigSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable';
  value?: T | undefined;
  revision?: number | undefined;
  writable: boolean;
}

interface ConfigForm<T> {
  getSnapshot(): ConfigSnapshot<T>;
  subscribe(listener: () => void): () => void;
  mutate(ops: readonly PathOp[], expectedRevision?: number): Promise<boolean>;
}

interface SecretView {
  path: string[];
  set: boolean;
}

interface NamespaceView {
  ns: string;
  secrets?: SecretView[];
}

interface DescribeSnapshot {
  view?: {
    namespaces: NamespaceView[];
    writable: boolean;
  } | undefined;
}

interface DescribeFace {
  getSnapshot(): DescribeSnapshot;
  subscribe(listener: () => void): () => void;
}

interface LocaleService {
  register(ns: string, dictionaries: Record<string, Record<string, string>>): (() => void) | void;
  bind(ns: string): Translate;
}

interface SlotsService {
  inject(name: string, register: () => unknown): unknown;
  register<P extends object = PluginConfigViewProps>(options: Record<string, unknown>, component: (props: P) => ReactNode): unknown;
}

interface ClientContext {
  get?(name: string): unknown;
  effect(callback: () => void | (() => void), label?: string): unknown;
  locale: LocaleService;
  slots: SlotsService;
  configForms: {
    get<T>(entryId: string): ConfigForm<T>;
    describe(): DescribeFace;
  };
}

interface PluginConfigViewProps {
  view: 'summary' | 'page';
  form?: {
    state: ConfigSnapshot<Record<string, unknown>>;
    mutate: ConfigForm<Record<string, unknown>>['mutate'];
  } | undefined;
}

export interface AnchorDraft {
  term: string;
  geo: string;
  dailySearches: string;
  tolerance: string;
}

export interface Draft {
  egress: EgressMode;
  /** A saved old or unrecognized egress value migrated on read. */
  egressNotice?: EgressNotice;
  /** Removed profile keys still present; Save unsets them. */
  legacyKeys?: string[];
  token: string;
  clearToken: boolean;
  actor: string;
  geo: string;
  anchor: string;
  cache: boolean;
  snapshotDir: string;
  charts: boolean;
  chartDir: string;
  baselineOverride: boolean;
  anchors: AnchorDraft[];
  newAnchor: AnchorDraft;
  windowShort: string;
  windowLong: string;
}

export interface ApifyUsagePlan {
  tier: string | null;
  monthlyBasePriceUsd: number | null;
  monthlyUsageCreditsUsd: number | null;
}

export interface ApifyUsageData {
  plan: ApifyUsagePlan;
  usageUsd: number | null;
  limitUsd: number | null;
  cycle: { startAt: string | null; endAt: string | null };
  residentialGb: number | null;
  residentialGbLimit: number | null;
  fetchedAt: string;
  /** Where the Host found the token: OAuth, saved settings, or the APIFY_TOKEN environment variable. */
  source: 'oauth' | 'config' | 'env' | null;
}

export type ApifyUsageView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: 'no-token' | 'invalid-token' | 'network' | 'http'; httpStatus?: number }
  | { status: 'ready'; data: ApifyUsageData };

export type ApifyOAuthCode =
  | 'unavailable'
  | 'read-only'
  | 'network'
  | 'invalid-response'
  | 'access-denied'
  | 'expired'
  | 'storage'
  | 'reauth-required'
  | 'busy';

/** Safe fields returned by the Host OAuth status route. */
export interface ApifyOAuthStatus {
  available: boolean;
  connected: boolean;
  pending: boolean;
  verificationUri?: string;
  userCode?: string;
  expiresAt?: string;
  code?: ApifyOAuthCode;
  /** Retained only for contract compatibility; never rendered. */
  message?: string;
}

export type ApifyOAuthView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: ApifyOAuthCode }
  | { status: 'ready'; data: ApifyOAuthStatus };

export type ApifyOAuthAction = 'start' | 'cancel' | 'logout';

export interface TestConnectionView extends ConnectionResult {
  network?: ConnectionResult;
  data?: DataCheck;
  checkedAt?: string;
}

export interface ApifyActorView {
  id: string;
  name: string;
  username: string | null;
  title: string | null;
  standbyUrl: string | null;
  standbyEnabled: boolean;
  lastBuildId: string | null;
  lastBuildStatus: string | null;
}

export type ApifyActorsView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: 'no-token' | 'invalid-token' | 'network' | 'http'; httpStatus?: number }
  | { status: 'ready'; actors: ApifyActorView[] };

export type DeployActorView =
  | { ok: true; actorId: string; buildId: string }
  | { ok: false; code: string; message?: string };

/** The exact Actor build started by the one-click deploy. */
export interface DeployTarget {
  actorId: string;
  buildId: string;
}

export interface DeployBuildResolution {
  status: 'pending' | 'succeeded' | 'failed';
  /** The deployed Actor to select; set only when its build succeeded. */
  actorId?: string;
}

export const EN: Record<string, string> = {
  actorUpdate: 'Update selected Actor',
  actorUpdatingTitle: 'Updating your Actor',
  actorUpdatingHint: 'Rebuilding official main. Build usage applies to your Apify account.',
  actorUpdateSource: 'Custom or pinned source: update this Actor in Apify Console.',
  actorBuildWatchExpired: 'Build status is taking longer than expected. Check Builds in Apify Console, then refresh.',
  actorRuntimeAligned: 'Actor v{actor} · Plugin v{plugin}',
  actorRuntimeDifferent: 'Actor v{actor} · Plugin v{plugin} — versions differ. Update the older component.',
  actorRuntimeUnknown: 'Actor version unverified. Update the Actor and run the check again.',
  actorRuntimeCatalogDifferent: 'Actor calibration catalog differs. Update the Actor and run the check again.',
  actorUpdateStep: 'Prepare update',
  recommended: 'Recommended',
  routeLocalDescription: 'Use this machine · No account needed',
  routePublicDescription: 'Apify network · Nothing to deploy',
  routeOwnDescription: 'Use an Actor you deploy',
  localNetwork: 'Local network',
  localNetworkHint: 'Connect to Google Trends from this dsh host.',
  connectionUntested: 'Not tested',
  connectionReady: 'Data verified',
  connectionNetworkOnly: 'Network only',
  connectionFailed: 'Check failed',
  diagnosticRunning: 'Checking connection and data',
  diagnosticRunningHint: 'Fetching three keywords in one request',
  diagnosticPassed: 'All checks passed',
  diagnosticDataFailed: 'Keyword check needs attention',
  diagnosticConnectionFailed: 'Connection check failed',
  diagnosticKeywordCount: '{passed} of {total} keywords verified',
  diagnosticPass: 'Passed', diagnosticFailed: 'Failed', diagnosticAttention: 'Attention',
  diagnosticPending: 'Checking', diagnosticWaiting: 'Waiting', diagnosticReachable: 'Reachable',
  diagnosticCancelled: 'Cancelled', diagnosticUnfinished: 'Incomplete',
  diagnosticNetwork: 'Connectivity', diagnosticKeywords: 'Keyword data', diagnosticScope: 'US · Past 24 hours',
  diagnosticTerm: 'Keyword', diagnosticPoints: 'Data points', diagnosticNonzero: 'Nonzero', diagnosticResult: 'Result',
  diagnosticNoData: 'No data', diagnosticDuration: 'Total', diagnosticSeconds: '{seconds} s',
  diagnosticFresh: 'Fresh data · No cache', diagnosticNotComplete: 'Check not completed',
  connectionHostRestart: 'Backend reload required',
  testHostRestartRequired: 'The dsh backend has not loaded this plugin version. Fully quit dsh and reopen it, then run the check again.',
  testComplete: 'Network and all three keywords verified · {ms} ms',
  testIncomplete: 'Network checked; keyword data has not been verified.',
  testDataTitle: 'Keyword data · US · past 24 hours',
  testPoints: '{points} points · {nonzero} nonzero',
  testNoData: 'No usable data for this keyword',
  testSkipped: 'Not run',
  testDataError: 'Data request failed',
  testBlocked: 'Google returned a CAPTCHA or unusual-traffic challenge. The test stopped.',
  testRateLimited: 'Google rate-limited the request. The test stopped without retrying.',
  testTimeout: 'The check timed out.',
  testProtocol: 'The data response could not be validated.',
  testCancelled: 'Check cancelled.',
  testNoDataSummary: 'Network is reachable, but some keywords returned no usable data.',
  testCheckedAt: 'Checked {time}',
  testCancel: 'Cancel check',
  testActorCost: 'After preflight, Actor mode starts one usage-billed run and exits when done.',
  actorAccountHint: 'Runs start only for queries and exit when done. Platform usage is billed in your Apify account; credentials stay on the dsh host.',
  oauthActivePublic: 'OAuth authorized · Public Actor ready',
  oauthActiveOwn: 'OAuth authorized · Your own Actor',
  accountActions: 'Account actions',
  advancedAnchors: 'Calibration baselines',
  advancedToken: 'Manual Token',
  advancedFiles: 'Files and charts',
  allSaved: 'All changes saved',
  usageDetails: 'Usage details',
  signupCredit: '${amount} in free credits every month',
  signupPlan: 'APIFY · FREE PLAN',
  signupMonthly: 'Free credits, every month',
  signupEstimate: 'About 3,000–7,000 queries / month',
  signupCreditNote: 'Sample estimate · Credits shared across your account',
  actorLoginRequired: 'Sign in to choose an Actor',
  actorLoginHint: 'Your Actor list appears after authorization.',
  actorLoginAction: 'Sign in & load Actors',
  actorLoginPending: 'Waiting for authorization',
  actorManualAction: 'Use a manual token',
  actorListRetry: 'Reload Actors',
  actorRefreshLabel: 'Refresh Actor list',
  actorMissing: 'Your previous Actor is not in this list. Choose one below.',
  actorSelectionHint: 'Test this selection now. Save to use it for future queries.',
  actorCount: '{count} available',
  actorReady: 'Ready',
  actorBuilding: 'Building',
  actorBuildFailed: 'Build failed',
  actorNotBuilt: 'Not built',
  actorCreatingTitle: 'Creating your Actor',
  actorBuildingTitle: 'Building your Actor',
  actorCreatingHint: 'Setting up Google Trends in your Apify account.',
  actorBuildingHint: 'Usually 1–2 minutes. It will be selected when ready.',
  actorCreateStep: 'Create',
  actorBuildStep: 'Build',
  actorReadyStep: 'Ready',
  actorBuildCheckFailed: 'Could not check the build. Refresh to try again.',
  connectionPrivacy: 'On demand · Credentials stay on this device',
  connectionCostShort: 'Compute and proxy usage are billed to your Apify account.',
  publicActorDetails: 'Actor details',
  advancedFix: 'Review advanced settings before saving.',
  summary: 'Search trends, compare keywords, and create calibrated snapshots for your agent.',
  intro: 'OAuth is the preferred credential for Actor egress; a manual API Token remains under Advanced. Click Save to apply settings changes; no restart is needed. OAuth status, usage, Actor listing, deploy, and Test connection run on the dsh host, so credentials never reach the browser.',
  oauthTitle: 'Apify sign-in',
  oauthSignedOut: 'Authorize once to query trends through your Actor.',
  oauthSignIn: 'Sign in with Apify',
  oauthScope: 'Grants full_api_access to your whole Apify account. Calls use your Apify balance.',
  oauthStarting: 'Starting Apify sign-in…',
  oauthPendingTitle: 'Finish signing in at Apify',
  oauthPending: 'Open the official Apify page, then enter this code:',
  oauthOpen: 'Open Apify authorization',
  oauthUserCode: 'Code: {code}',
  oauthExpiresAt: 'This code expires at {time}.',
  oauthExpiresSoon: 'This code expires soon.',
  oauthCancel: 'Cancel',
  oauthCancelling: 'Cancelling…',
  oauthConnected: 'Signed in with Apify',
  oauthConnectedHint: 'OAuth takes priority over the advanced manual API Token and APIFY_TOKEN.',
  oauthLogout: 'Sign out of Apify',
  oauthLoggingOut: 'Signing out…',
  oauthLoading: 'Checking Apify sign-in status…',
  oauthRetry: 'Retry',
  oauthSignInAgain: 'Sign in again',
  oauthUnavailable: 'Apify sign-in is unavailable in this deployment. The advanced manual API Token remains available below.',
  oauthReadOnly: 'Apify sign-in cannot be saved because credentials are read-only here. The advanced manual API Token remains available below.',
  oauthNetwork: 'Could not reach the Apify sign-in service. Check connectivity and try again.',
  oauthInvalidResponse: 'Apify sign-in returned a response this page could not validate. Try again.',
  oauthAccessDenied: 'Apify authorization was denied. Sign in again when ready.',
  oauthExpired: 'The Apify authorization code expired. Sign in again.',
  oauthStorage: 'Could not save or clear the Apify sign-in credentials. Check dsh credential storage and try again.',
  oauthReauthRequired: 'The saved Apify sign-in expired or was revoked. Sign in again.',
  oauthBusy: 'Another Apify sign-in operation is in progress. Try again in a moment.',
  oauthManualFallback: 'You can also use Advanced → Manual Token.',
  connection: 'Connection',
  connectionDescription: 'Choose where Google Trends requests leave from.',
  egress: 'Egress',
  egressHint: 'Local: requests leave from the machine running dsh. Public Actor: relay through the meka.im Actor; runs and billing stay in your Apify account, nothing to deploy. My own Actor: deploy the same open-source code into your account and pick it below.',
  egressLocal: 'Local (this machine)',
  egressPublic: 'Public Actor',
  egressOwn: 'My own Actor',
  egressRenamed: 'Your saved egress "apify" selects My own Actor. Save to confirm this setting.',
  egressUnknown: 'Your saved egress value is not recognized; it now uses Local (this machine). Save to update the profile.',
  testConnection: 'Test connection',
  testing: 'Testing…',
  testNote: 'Tests the current connection and three keywords without saving. Allow up to 2 minutes.',
  testLocalOk: 'Google Trends reachable ({status}, {ms} ms)',
  testActorOk: 'Apify API, credentials and Actor available · {ms} ms',
  testNoToken: 'Sign in with Apify (or use the advanced manual API Token or APIFY_TOKEN) to use an Actor egress.',
  testNoActor: 'Select or deploy your google-trends-for-agent Actor first.',
  testVersionMismatch: 'This Actor build does not support the connection check. Rebuild the Actor.',
  testInvalidToken: 'Apify rejected the token or OAuth session. Sign in again or check the advanced manual token in Apify Console → Settings → API & Integrations.',
  testNetworkLocal: 'Could not reach Google Trends from this machine.',
  testDetail: ' Details: {detail}',
  testNetworkActor: 'Could not read your Apify Actor metadata. Check API access and the selected Actor.',
  testHttp: 'Target returned HTTP {status}.',
  testBusy: 'A test is already running. Try again in a moment.',
  actorConnection: 'Apify Actor',
  actorDescription: 'Apify sign-in, the Actor, and this cycle\'s Apify usage.',
  usageTitle: 'Apify usage',
  usageCycle: 'Used this cycle',
  usageRemaining: '{amount} remaining',
  usageOverBudget: '{amount} over limit',
  usagePercent: '{percent}% used',
  usageLoading: 'Loading Apify usage…',
  usageNoToken: 'Sign in with Apify (or use the advanced manual API Token or APIFY_TOKEN) to see usage.',
  usageInvalidToken: 'Apify rejected the token or OAuth session (401). Sign in again or check the advanced manual token in Apify Console → Settings → API & Integrations.',
  usageNetwork: 'Could not load Apify usage. Check connectivity and try again.',
  usageHttp: 'Apify API returned HTTP {status}.',
  usageRetry: 'Retry',
  usageRefresh: 'Refresh',
  usageUpdated: 'Updated {time}',
  usageResets: 'Resets {date}',
  usageResetsIn: 'Resets {date} (in {days} days)',
  usageResetsToday: 'Resets {date} (today)',
  usageResetsUnknown: 'Resets —',
  usagePlan: 'Plan: {tier} · {price}/mo',
  usagePlanUnknown: 'Plan: —',
  usageResidential: 'Residential proxy: {gb} GB this cycle',
  usageResidentialLimit: 'Residential proxy: {gb} GB this cycle of {limit} GB',
  usageResidentialUnknown: 'Residential proxy: —',
  usageSourceOAuth: 'Usage source: signed-in Apify OAuth session.',
  signupAction: 'Sign up →',
  pricingAction: 'Pricing',
  token: 'Apify token',
  tokenHint: 'OAuth takes priority. Leave blank to keep the current token or use APIFY_TOKEN. Manual tokens are stored in plaintext in the profile cordis.patch.yml (0600).',
  tokenPrefixWarning: 'Apify API tokens usually start with apify_api_. Double-check this one.',
  tokenStored: 'A token is stored. Type a new one to replace it.',
  tokenEmpty: 'No token stored.',
  clearToken: 'Clear the stored token',
  manualTokenSummary: 'Advanced: manual API Token',
  manualTokenDescription: 'Optional API token. A stored OAuth session takes priority.',
  actor: 'Actor',
  publicActor: 'Public Actor',
  publicActorHint: 'Fixed public Actor. Runs and billing stay in your Apify account; nothing to deploy.',
  publicActorCost: 'Billed for each run’s compute and proxy usage. No idle server; no Actor fee.',
  viewSource: 'View source on GitHub →',
  storePage: 'Apify Store page →',
  actorHint: 'One query starts one bounded Actor run using its residential proxy. The run exits when the result is ready.',
  actorNone: 'Select an Actor',
  actorRefresh: 'Refresh',
  actorLoading: 'Loading your Actors…',
  actorBuild: 'Build: {status}',
  actorBuildUnknown: '—',
  actorEmpty: 'No google-trends-for-agent Actor in your account yet.',
  actorLoadNetwork: 'Could not load your Actors. Check connectivity and try again.',
  actorLoadHttp: 'Apify API returned HTTP {status}.',
  deploy: 'Deploy to my Apify account →',
  deploying: 'Deploying…',
  deployManual: 'or deploy manually',
  deployBuilding: 'Building… (about 1–2 min)',
  deployExists: 'That Actor already exists. Refresh the list and select it.',
  deployFailed: 'Deploy failed. Try again or deploy manually.',
  deployBuildFailed: 'The build for the deployed Actor failed. Rebuild it in Apify Console (Actor → Builds), then refresh.',
  defaults: 'Query defaults',
  defaultsDescription: 'Defaults applied when a tool call omits them.',
  geo: 'Default geo',
  geoHint: 'Relative interest is available; no built-in volume baseline for this region.',
  geoBaselineHint: 'Regional volume estimate available; sparse data can still return null.',
  baselineSources: 'Baseline sources & validation',
  geoWorldwide: 'Worldwide',
  geoSearch: 'Search a country or code…',
  choiceEmpty: 'No matching options',
  anchorSearch: 'Search an anchor…',
  anchorAutoOption: 'Choose an anchor for the region and query window',
  anchorRegionalOption: 'Automatic anchor for this region',
  anchorShortOption: 'For 24-hour and shorter windows',
  anchorLongOption: 'For 7-day and longer windows',
  anchor: 'Traffic calibration',
  anchorHint: 'Automatic mode matches the region and query window.',
  anchorAutomatic: 'Automatically select an anchor',
  cache: 'Reuse saved snapshots',
  cacheHint: 'Reuse saved results for up to 6 hours to avoid repeated requests.',
  baselines: 'Anchors & baselines',
  baselinesDescription: 'Custom rows override the same term and region; other built-ins still apply.',
  baselinesHint: 'Using built-in regional baselines. Turn on to customize.',
  baselineBuiltin: 'Built-in baselines',
  baselineBuiltinHint: 'MEKA baselines from Google Ads Keyword Planner.',
  baselineDailyWindow: 'Daily comparisons and estimates for 30 days or longer',
  baselineAllRegions: 'All regions',
  baselineBrowseGeo: 'Browse baseline region',
  baselineDailyEstimate: 'Searches/day (estimate)',
  baselineCustomRows: 'Custom overrides',
  overrideBaselines: 'Custom baselines',
  anchorTerm: 'Anchor term',
  newAnchorTerm: 'New anchor term',
  newAnchorTermRequired: 'Enter an anchor term.',
  anchorGeo: 'Geo',
  anchorDaily: 'Searches/day',
  anchorTolerance: 'Tolerance',
  invalidDaily: 'Enter a positive daily searches value.',
  toleranceDefault: 'Default (±50%)',
  tolerance10: '±10%',
  tolerance25: '±25%',
  tolerance50: '±50%',
  tolerance75: '±75%',
  tolerance100: '±100%',
  addAnchor: 'Add anchor',
  remove: 'Remove',
  windowShort: 'Short-window anchor',
  windowLong: 'Long-window anchor',
  windowDefault: 'Default',
  windowShortHint: '24 hours and shorter',
  windowLongHint: '7 days and longer',
  advanced: 'Advanced',
  advancedDescription: 'Calibration baselines, manual token, and file locations.',
  snapshotDir: 'Snapshot directory',
  snapshotDirHint: 'Relative paths start from the dsh working directory.',
  chartDir: 'Chart directory',
  chartDirHint: 'Where SVG charts are written when chart files are on.',
  charts: 'Write chart files',
  chartsHint: 'Save SVG files alongside query results.',
  requiredDirectory: 'This directory must not be blank.',
  unsaved: 'Unsaved changes',
  discard: 'Discard',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'The Host refused the change. Reload the page and try again.',
  loading: 'Loading configuration…',
  unavailable: 'Configuration is unavailable in this deployment.',
  readOnly: 'This configuration is read-only.',
  invalidAnchor: 'Each anchor needs a term and a positive dailySearches value.',
  invalidTolerance: 'Choose a tolerance from the list.',
  invalidGeo: 'Choose a geo from the list.',
  duplicateAnchor: 'That anchor term is already in the list.',
  tokenConflict: 'Type a new token or clear the stored one, not both.',
  baselinesEmpty: 'Add at least one anchor, or turn off the override.',
  windowUnknown: 'A window anchor must be a term from the anchors list or a built-in anchor.',
  tokenStateSet: 'Stored',
  tokenStateUnset: 'Not set',
  tokenStateEnv: 'Not saved here; using APIFY_TOKEN from the environment.',
};

export const ZH: Record<string, string> = {
  actorUpdate: '更新选中的 Actor',
  actorUpdatingTitle: '正在更新你的 Actor',
  actorUpdatingHint: '重新构建官方 main，构建用量计入你的 Apify 账号。',
  actorUpdateSource: '此 Actor 使用自定义或固定版本源码，请在 Apify Console 更新。',
  actorBuildWatchExpired: '构建状态等待较久，请在 Apify Console 的 Builds 中查看，再刷新。',
  actorRuntimeAligned: 'Actor v{actor} · 插件 v{plugin}',
  actorRuntimeDifferent: 'Actor v{actor} · 插件 v{plugin}，版本不同，请更新较旧的一端。',
  actorRuntimeUnknown: '尚未核验 Actor 版本，请更新 Actor 后重新测试。',
  actorRuntimeCatalogDifferent: 'Actor 的校准基准版本不同，请更新后重新测试。',
  actorUpdateStep: '准备更新',
  recommended: '推荐',
  routeLocalDescription: '使用本机网络 · 无需账号',
  routePublicDescription: '使用 Apify 网络 · 无需部署',
  routeOwnDescription: '使用你部署的 Apify Actor',
  localNetwork: '本机网络',
  localNetworkHint: '从当前 dsh 主机连接 Google Trends。',
  connectionUntested: '未测试',
  connectionReady: '取数已验证',
  connectionNetworkOnly: '仅网络可达',
  connectionFailed: '检查未通过',
  diagnosticRunning: '正在检查连接与数据',
  diagnosticRunningHint: '合并获取三个关键词的实时结果',
  diagnosticPassed: '全部检查通过',
  diagnosticDataFailed: '关键词取数需要关注',
  diagnosticConnectionFailed: '连接检查未通过',
  diagnosticKeywordCount: '{passed} / {total} 个关键词通过',
  diagnosticPass: '通过', diagnosticFailed: '未通过', diagnosticAttention: '需关注',
  diagnosticPending: '检查中', diagnosticWaiting: '等待结果', diagnosticReachable: '可访问',
  diagnosticCancelled: '检查已取消', diagnosticUnfinished: '未完成',
  diagnosticNetwork: '基础连接', diagnosticKeywords: '关键词取数', diagnosticScope: '美国 · 近 24 小时',
  diagnosticTerm: '关键词', diagnosticPoints: '数据点', diagnosticNonzero: '非零点', diagnosticResult: '结果',
  diagnosticNoData: '暂无数据', diagnosticDuration: '总耗时', diagnosticSeconds: '{seconds} 秒',
  diagnosticFresh: '实时查询 · 不使用缓存', diagnosticNotComplete: '检查尚未完成',
  connectionHostRestart: '需重载后端',
  testHostRestartRequired: 'dsh 后端尚未加载当前插件。请完全退出 dsh 后重新打开，再测试连接。',
  testComplete: '网络和三个关键词取数均通过 · {ms} ms',
  testIncomplete: '已检查网络，尚未验证关键词取数。',
  testDataTitle: '关键词取数 · 美国 · 近 24 小时',
  testPoints: '{points} 个数据点 · {nonzero} 个非零点',
  testNoData: '该关键词没有可用数据',
  testSkipped: '未执行',
  testDataError: '取数失败',
  testBlocked: 'Google 返回验证码或异常流量挑战，测试已停止。',
  testRateLimited: 'Google 限流，测试已停止，没有自动重试。',
  testTimeout: '检查超时。',
  testProtocol: '数据响应未通过校验。',
  testCancelled: '检查已取消。',
  testNoDataSummary: '网络可达，但部分关键词没有可用数据。',
  testCheckedAt: '检查于 {time}',
  testCancel: '取消检查',
  testActorCost: '网络检查通过后，Actor 模式启动一次按量计费的运行，完成即退出。',
  actorAccountHint: '有查询才启动，完成即退出；计算和代理用量计入你的 Apify 账号，凭据保留在 dsh 主机。',
  oauthActivePublic: 'OAuth 授权 · 公共 Actor 已就绪',
  oauthActiveOwn: 'OAuth 授权 · 使用自己的 Actor',
  accountActions: '账号操作',
  advancedAnchors: '校准基线',
  advancedToken: '手动 Token',
  advancedFiles: '文件与图表',
  allSaved: '所有更改已保存',
  usageDetails: '用量详情',
  signupCredit: '每月 ${amount} 免费额度',
  signupPlan: 'APIFY · 免费计划',
  signupMonthly: '每月免费额度',
  signupEstimate: '约可查询 3,000–7,000 次 / 月',
  signupCreditNote: '按样本估算 · 额度全账号共享',
  actorLoginRequired: '登录后选择 Actor',
  actorLoginHint: '授权完成后，自动加载你账号中的 Actor。',
  actorLoginAction: '登录并加载',
  actorLoginPending: '等待授权完成',
  actorManualAction: '使用手动 Token',
  actorListRetry: '重新加载',
  actorRefreshLabel: '刷新 Actor 列表',
  actorMissing: '之前选择的 Actor 不在当前列表，请在下方重新选择。',
  actorSelectionHint: '可直接测试当前选择，保存后用于后续查询。',
  actorCount: '{count} 个可选',
  actorReady: '就绪',
  actorBuilding: '构建中',
  actorBuildFailed: '构建失败',
  actorNotBuilt: '未构建',
  actorCreatingTitle: '正在创建你的 Actor',
  actorBuildingTitle: '正在构建你的 Actor',
  actorCreatingHint: '正在将 Google Trends 部署到你的 Apify 账号。',
  actorBuildingHint: '通常需要 1–2 分钟，就绪后自动选中。',
  actorCreateStep: '创建',
  actorBuildStep: '构建',
  actorReadyStep: '就绪',
  actorBuildCheckFailed: '暂时无法检查构建状态，请刷新重试。',
  connectionPrivacy: '按需运行 · 凭据保留在本机',
  connectionCostShort: '计算和代理用量计入你的 Apify 账号。',
  publicActorDetails: 'Actor 详情',
  advancedFix: '请检查高级设置后再保存。',
  summary: '查询搜索趋势，比较关键词，生成带图快照。',
  intro: 'Actor 出口优先使用 OAuth 登录，也可在高级设置中保留手动 API Token。点击保存后应用设置变更，无需重启。OAuth 状态、用量、Actor 列表、部署和测试连接都在 dsh 主机端运行，凭据不会发送到浏览器。',
  oauthTitle: 'Apify 登录',
  oauthSignedOut: '一次授权，即可通过 Actor 查询趋势。',
  oauthSignIn: '登录 Apify',
  oauthScope: '授权 full_api_access（完整 Apify 账号权限），调用计入你的 Apify 账单。',
  oauthStarting: '正在开始 Apify 登录…',
  oauthPendingTitle: '请在 Apify 完成登录',
  oauthPending: '打开 Apify 官方页面，然后输入此代码：',
  oauthOpen: '打开 Apify 授权页面',
  oauthUserCode: '代码：{code}',
  oauthExpiresAt: '此代码将于 {time} 过期。',
  oauthExpiresSoon: '此代码即将过期。',
  oauthCancel: '取消',
  oauthCancelling: '正在取消…',
  oauthConnected: 'Apify 已连接',
  oauthConnectedHint: 'OAuth 优先于高级设置中的手动 API Token 和 APIFY_TOKEN。',
  oauthLogout: '退出 Apify 登录',
  oauthLoggingOut: '正在退出…',
  oauthLoading: '正在检查 Apify 登录状态…',
  oauthRetry: '重试',
  oauthSignInAgain: '重新登录',
  oauthUnavailable: '当前部署无法使用 Apify 登录。下方仍可使用高级设置中的手动 API Token。',
  oauthReadOnly: '此处的凭据为只读，无法保存 Apify 登录。下方仍可使用高级设置中的手动 API Token。',
  oauthNetwork: '无法连接 Apify 登录服务。请检查网络后重试。',
  oauthInvalidResponse: 'Apify 登录返回了此页面无法校验的响应。请重试。',
  oauthAccessDenied: 'Apify 授权被拒绝。准备好后请重新登录。',
  oauthExpired: 'Apify 授权代码已过期。请重新登录。',
  oauthStorage: '无法保存或清除 Apify 登录凭据。请检查 dsh 凭据存储后重试。',
  oauthReauthRequired: '已保存的 Apify 登录已过期或被撤销。请重新登录。',
  oauthBusy: '另一个 Apify 登录操作正在进行。请稍后再试。',
  oauthManualFallback: '也可在“高级 → 手动 Token”中配置 API Token。',
  connection: '连接方式',
  connectionDescription: '选择 Google Trends 请求从哪里发出。',
  egress: '出口',
  egressHint: '本机直连：请求从运行 dsh 的机器发出。公共 Actor：经 meka.im 的 Actor 转发，运行和计费都在你的 Apify 账号内，无需部署。我自己的 Actor：把同一份开源代码部署到你的账号，并在下方选择。',
  egressLocal: '本机直连',
  egressPublic: '公共 Actor',
  egressOwn: '我自己的 Actor',
  egressRenamed: '已保存的出口 "apify" 对应“我自己的 Actor”。保存以确认此设置。',
  egressUnknown: '无法识别已保存的出口值；现在使用本机直连。保存以更新配置。',
  testConnection: '测试连接',
  testing: '测试中…',
  testNote: '测试当前连接和三个关键词，不保存设置，最长约 2 分钟。',
  testLocalOk: 'Google Trends 可访问（{status}，{ms} ms）',
  testActorOk: 'Apify API、认证和 Actor 可用 · {ms} ms',
  testNoToken: '登录 Apify（或使用高级设置中的手动 API Token 或 APIFY_TOKEN）后可使用 Actor 出口。',
  testNoActor: '请先选择或部署你的 google-trends-for-agent Actor。',
  testVersionMismatch: '该 Actor 构建不支持完整连接检查，请重新构建 Actor。',
  testInvalidToken: 'Apify 拒绝了该 Token 或 OAuth 会话。请重新登录，或在 Apify Console → Settings → API & Integrations 中检查高级设置里的手动 Token。',
  testNetworkLocal: '本机无法连接 Google Trends。',
  testDetail: '详情：{detail}',
  testNetworkActor: '无法读取 Apify Actor 信息，请检查 API 权限和所选 Actor。',
  testHttp: '目标返回 HTTP {status}。',
  testBusy: '已有测试正在进行，请稍后再试。',
  actorConnection: 'Apify Actor',
  actorDescription: 'Apify 登录、Actor 和本计费周期的 Apify 用量。',
  usageTitle: 'Apify 用量',
  usageCycle: '本周期已用',
  usageRemaining: '剩余额度 {amount}',
  usageOverBudget: '超出额度 {amount}',
  usagePercent: '已用 {percent}%',
  usageLoading: '正在加载 Apify 用量…',
  usageNoToken: '登录 Apify（或使用高级设置中的手动 API Token 或 APIFY_TOKEN）后可查看用量。',
  usageInvalidToken: 'Apify 拒绝了该 Token 或 OAuth 会话（401）。请重新登录，或在 Apify Console → Settings → API & Integrations 中检查高级设置里的手动 Token。',
  usageNetwork: '无法加载 Apify 用量。请检查网络后重试。',
  usageHttp: 'Apify API 返回 HTTP {status}。',
  usageRetry: '重试',
  usageRefresh: '刷新',
  usageUpdated: '更新于 {time}',
  usageResets: '重置于 {date}',
  usageResetsIn: '重置于 {date}（{days} 天后）',
  usageResetsToday: '重置于 {date}（今天）',
  usageResetsUnknown: '重置于 —',
  usagePlan: '套餐：{tier} · {price}/月',
  usagePlanUnknown: '套餐：—',
  usageResidential: '住宅代理：本周期 {gb} GB',
  usageResidentialLimit: '住宅代理：本周期 {gb} GB，上限 {limit} GB',
  usageResidentialUnknown: '住宅代理：—',
  usageSourceOAuth: '用量来源：已登录的 Apify OAuth 会话。',
  signupAction: '注册 →',
  pricingAction: '价格',
  token: 'Apify Token',
  tokenHint: 'OAuth 登录优先。留空保持当前 Token，或使用 APIFY_TOKEN。手动 Token 以明文保存在 profile 的 cordis.patch.yml 中（权限 0600）。',
  tokenPrefixWarning: 'Apify API Token 通常以 apify_api_ 开头，请再确认。',
  tokenStored: '已保存 Token；输入新值可替换。',
  tokenEmpty: '未保存 Token。',
  clearToken: '清除已保存的 Token',
  manualTokenSummary: '高级：手动 API Token',
  manualTokenDescription: '可选的 API Token；已存储的 OAuth 会话优先。',
  actor: 'Actor',
  publicActor: '公共 Actor',
  publicActorHint: '固定的公共 Actor。运行和计费都在你的 Apify 账号内，无需部署。',
  publicActorCost: '按每次运行的计算和代理用量计费，无空闲常驻服务，无 Actor 费用。',
  viewSource: '在 GitHub 查看源码 →',
  storePage: 'Apify Store 页面 →',
  actorHint: '每次查询启动一个有时限的 Actor，使用平台内住宅代理，结果生成后立即退出。',
  actorNone: '选择 Actor',
  actorRefresh: '刷新',
  actorLoading: '正在加载你的 Actor…',
  actorBuild: '构建：{status}',
  actorBuildUnknown: '—',
  actorEmpty: '你的账号里还没有 google-trends-for-agent Actor。',
  actorLoadNetwork: '无法加载你的 Actor 列表。请检查网络后重试。',
  actorLoadHttp: 'Apify API 返回 HTTP {status}。',
  deploy: '部署到我的 Apify 账号 →',
  deploying: '部署中…',
  deployManual: '或手动部署',
  deployBuilding: '构建中…（约 1–2 分钟）',
  deployExists: '该 Actor 已存在。请刷新列表并选择它。',
  deployFailed: '部署失败。请重试或手动部署。',
  deployBuildFailed: '刚部署的 Actor 构建失败。请在 Apify Console（Actor → Builds）中重新构建，然后刷新。',
  defaults: '查询默认值',
  defaultsDescription: '查询时未指定的参数，使用这里的设置。',
  geo: '默认地区',
  geoHint: '可查询相对热度，此地区暂无内置搜索量基准。',
  geoBaselineHint: '已内置地区估算基准；数据稀疏时搜索量仍可能为空。',
  baselineSources: '基准来源与校验',
  geoWorldwide: '全球',
  geoSearch: '搜索地区或代码…',
  choiceEmpty: '没有匹配的选项',
  anchorSearch: '搜索锚点…',
  anchorAutoOption: '根据查询地区和时间窗口选择锚点',
  anchorRegionalOption: '此地区的自动校准锚点',
  anchorShortOption: '适合 24 小时及更短窗口',
  anchorLongOption: '适合 7 天及更长窗口',
  anchor: '流量校准',
  anchorHint: '自动模式按地区和时间窗口选择。',
  anchorAutomatic: '自动选择锚点',
  cache: '复用近期快照',
  cacheHint: '6 小时内复用结果，减少重复请求。',
  baselines: '锚点与基线',
  baselinesDescription: '自定义项覆盖相同词和地区，其余内置基准继续使用。',
  baselinesHint: '当前使用内置地区基线，开启后可自定义。',
  baselineBuiltin: '内置基准',
  baselineBuiltinHint: 'MEKA 基准来自 Google Ads Keyword Planner。',
  baselineDailyWindow: '用于 30 天及以上的日粒度对比和补估',
  baselineAllRegions: '全部地区',
  baselineBrowseGeo: '查看基准地区',
  baselineDailyEstimate: '每日搜索量（估算）',
  baselineCustomRows: '自定义覆盖',
  overrideBaselines: '自定义基线',
  anchorTerm: '锚点词',
  newAnchorTerm: '新锚点词',
  newAnchorTermRequired: '请输入锚点词。',
  anchorGeo: '地区',
  anchorDaily: '每日搜索量',
  anchorTolerance: '容差',
  invalidDaily: '请输入大于 0 的每日搜索量。',
  toleranceDefault: '默认（±50%）',
  tolerance10: '±10%',
  tolerance25: '±25%',
  tolerance50: '±50%',
  tolerance75: '±75%',
  tolerance100: '±100%',
  addAnchor: '添加锚点',
  remove: '删除',
  windowShort: '短窗口锚点',
  windowLong: '长窗口锚点',
  windowDefault: '默认',
  windowShortHint: '24 小时及以内',
  windowLongHint: '7 天及以上',
  advanced: '高级',
  advancedDescription: '自定义锚点、手动 Token 与文件位置。',
  snapshotDir: '快照目录',
  snapshotDirHint: '相对路径以 dsh 的工作目录为起点。',
  chartDir: '图表目录',
  chartDirHint: '开启图表文件时 SVG 的写入位置。',
  charts: '写入图表文件',
  chartsHint: '查询时同时保存 SVG 图表。',
  requiredDirectory: '目录不能为空。',
  unsaved: '未保存的修改',
  discard: '还原',
  save: '保存更改',
  saving: '保存中…',
  saved: '已保存',
  failed: 'Host 拒绝了修改。请刷新页面后重试。',
  loading: '正在加载配置…',
  unavailable: '当前部署不提供配置。',
  readOnly: '此配置为只读。',
  invalidAnchor: '每个锚点都需要词和大于 0 的每日搜索量。',
  invalidTolerance: '请选择列表中的容差。',
  invalidGeo: '请选择列表中的地区。',
  duplicateAnchor: '该锚点词已在列表中。',
  tokenConflict: '只能输入新 Token 或清除已保存的 Token，二者选其一。',
  baselinesEmpty: '请至少添加一个锚点，或关闭基线覆盖。',
  windowUnknown: '窗口锚点必须来自锚点列表或内置锚点。',
  tokenStateSet: '已保存',
  tokenStateUnset: '未设置',
  tokenStateEnv: '此处未保存；正在使用环境变量 APIFY_TOKEN。',
};

const styles: Record<string, CSSProperties> = {
  page: { display: 'grid', gap: 18, width: '100%', minWidth: 0, maxWidth: 920, padding: '8px 0 24px' },
  section: { display: 'grid', gap: 18, padding: 24, border: '1px solid var(--gtfa-line)', borderRadius: 16, background: 'var(--gtfa-surface)' },
  sectionHeader: { display: 'grid', gap: 4 },
  sectionTitle: { margin: 0, fontSize: 15, lineHeight: 1.5, fontWeight: 650 },
  sectionDescription: { margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--gtfa-muted)' },
  field: { display: 'grid', minWidth: 0 },
  label: { marginBottom: 8, fontSize: 12, fontWeight: 550 },
  hint: { margin: '6px 0 0', fontSize: 11, lineHeight: 1.6, color: 'var(--gtfa-muted)' },
  fieldError: { margin: '6px 0 0', fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-state-error-primary, #c55151)' },
  warning: { margin: '6px 0 0', fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-state-warning-primary, #a87921)' },
  input: { boxSizing: 'border-box', width: '100%', minWidth: 0, minHeight: 36, padding: '7px 11px', border: '1px solid var(--gtfa-line)',
    borderRadius: 8, background: 'var(--gtfa-surface)', color: 'var(--gtfa-ink)', font: 'inherit', fontSize: 13 },
  segment: { position: 'relative', display: 'grid', gap: 12, padding: '14px 16px', minHeight: 102, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--gtfa-line)',
    borderRadius: 11, background: 'var(--gtfa-surface)', color: 'var(--gtfa-ink)', font: 'inherit', fontSize: 13, cursor: 'pointer' },
  segmentActive: { borderColor: 'var(--gtfa-accent)', background: 'var(--gtfa-accent-soft)', boxShadow: 'inset 0 0 0 .5px var(--gtfa-accent)' },
  switchRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, minHeight: 32, fontSize: 13 },
  switch: { boxSizing: 'border-box', flex: '0 0 auto', width: 34, height: 20, padding: 2, border: 0, borderRadius: 12,
    background: 'var(--gtfa-hover)', cursor: 'pointer' },
  switchOn: { background: 'var(--gtfa-accent)' },
  switchThumb: { display: 'block', width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.08)', transition: 'transform 120ms ease' },
  switchThumbOn: { transform: 'translateX(14px)' },
  readOnlyTerm: { boxSizing: 'border-box', minWidth: 0, padding: '7px 0', fontFamily: 'var(--ds-font-family-code, Menlo, monospace)',
    fontSize: 12, overflowWrap: 'anywhere' },
  saveBar: { position: 'sticky', bottom: 12, zIndex: 2, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
    marginTop: 0, marginBottom: 12, padding: '14px 18px', border: '1px solid var(--gtfa-save-border)', borderRadius: 12,
    background: 'var(--gtfa-save-surface)', boxShadow: 'var(--gtfa-save-shadow)' },
  button: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '7px 13px', minHeight: 34,
    border: '1px solid var(--gtfa-line)', borderRadius: 8, background: 'var(--gtfa-surface)', color: 'var(--gtfa-ink)', font: 'inherit', fontSize: 12, cursor: 'pointer' },
  buttonSmall: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '5px 9px', minHeight: 28,
    border: '1px solid var(--gtfa-line)', borderRadius: 7, background: 'var(--gtfa-surface)', color: 'var(--gtfa-ink)', font: 'inherit', fontSize: 11, cursor: 'pointer' },
  primary: { background: 'var(--gtfa-accent)', borderColor: 'var(--gtfa-accent)', color: '#fff' },
  pill: { display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 500,
    color: 'var(--gtfa-green)', background: 'var(--gtfa-green-soft)' },
  status: { margin: 0, fontSize: 13 },
  error: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #c55151)' },
  summary: { display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px', cursor: 'pointer' },
  connectionPanel: { border: '1px solid var(--gtfa-line)', borderRadius: 12, background: 'var(--gtfa-soft)' },
  signupPrimary: { color: 'var(--gtfa-accent)', fontWeight: 550, textDecoration: 'none' },
  signupSecondary: { color: 'var(--gtfa-muted)', textDecoration: 'underline' },
  oauthCard: { display: 'grid', gap: 0 },
  oauthActions: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  oauthCode: { display: 'inline-block', padding: '7px 11px', borderRadius: 7, border: '1px solid var(--gtfa-line)',
    background: 'var(--gtfa-surface)', fontFamily: 'var(--ds-font-family-code, Menlo, monospace)', fontSize: 17, fontWeight: 600, letterSpacing: '.06em', overflowWrap: 'anywhere' },
  oauthLink: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 34, padding: '7px 13px',
    borderRadius: 8, background: 'var(--gtfa-accent)', color: '#fff', fontSize: 12, fontWeight: 550, textDecoration: 'none' },
  usageMeta: { margin: 0, fontSize: 11, lineHeight: 1.6, color: 'var(--gtfa-muted)' },
  testLine: { margin: '8px 0 0', fontSize: 12, lineHeight: 1.6 },
};

const TOLERANCE_OPTIONS = [
  { value: '0.1', label: 'tolerance10' },
  { value: '0.25', label: 'tolerance25' },
  { value: '0.5', label: 'tolerance50' },
  { value: '0.75', label: 'tolerance75' },
  { value: '1', label: 'tolerance100' },
] as const;
const GEO_SET = new Set<string>(GEO_CODES);

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return value === undefined || value === null ? fallback : String(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function template(value: string, vars: Record<string, string | number>): string {
  return value.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const OAUTH_CODES = new Set<string>([
  'unavailable', 'read-only', 'network', 'invalid-response', 'access-denied',
  'expired', 'storage', 'reauth-required', 'busy',
]);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function boundedOAuthText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

/** Accept only the exact Apify Console device-authorization URL. */
export function normalizeApifyOAuthVerificationUri(value: unknown): string | undefined {
  const raw = boundedOAuthText(value, 2048);
  if (!raw) return undefined;
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { return undefined; }
  if (parsed.protocol !== 'https:') return undefined;
  if (parsed.hostname !== 'console.apify.com') return undefined;
  if (parsed.pathname !== '/authorize/device' && parsed.pathname !== '/authorize/device/') return undefined;
  if (parsed.username || parsed.password || parsed.port || parsed.hash) return undefined;
  const authority = /^https:\/\/([^/?#]*)/i.exec(raw)?.[1];
  if (!authority || authority.includes('@') || authority.includes(':')) return undefined;
  return parsed.toString();
}

/** Validate the Host's safe OAuth view and discard malformed or unsafe optional fields. */
export function normalizeApifyOAuthStatus(value: unknown): ApifyOAuthStatus | null {
  const row = record(value);
  if (typeof row.available !== 'boolean' || typeof row.connected !== 'boolean' || typeof row.pending !== 'boolean') return null;
  let code: ApifyOAuthCode | undefined;
  if (row.code !== undefined) {
    if (typeof row.code !== 'string' || !OAUTH_CODES.has(row.code)) return null;
    code = row.code as ApifyOAuthCode;
  }
  const verificationUri = normalizeApifyOAuthVerificationUri(row.verificationUri);
  const userCode = (() => {
    const text = boundedOAuthText(row.userCode, 64);
    return text && /^[A-Za-z0-9-]{4,64}$/.test(text) ? text : undefined;
  })();
  const expiresAt = (() => {
    const text = boundedOAuthText(row.expiresAt, 64);
    if (!text || !ISO_INSTANT.test(text)) return undefined;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  })();
  const message = (() => {
    const text = boundedOAuthText(row.message, 512);
    return text?.replace(/[\u0000-\u001f\u007f]/g, '');
  })();
  return {
    available: row.available,
    connected: row.connected,
    pending: row.pending,
    ...(verificationUri ? { verificationUri } : {}),
    ...(userCode ? { userCode } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
  };
}

async function requestApifyOAuth(
  url: string,
  method: 'GET' | 'POST',
  signal?: AbortSignal,
): Promise<ApifyOAuthView> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { accept: 'application/json' },
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted || (error as { name?: unknown })?.name === 'AbortError') throw error;
    return { status: 'error', code: 'network' };
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  const data = normalizeApifyOAuthStatus(body);
  if (!data) return { status: 'error', code: 'invalid-response' };
  return { status: 'ready', data };
}

/** Read OAuth status only; this GET never starts a device login. */
export function loadApifyOAuth(signal?: AbortSignal): Promise<ApifyOAuthView> {
  return requestApifyOAuth(APIFY_OAUTH_STATUS_URL, 'GET', signal);
}

/** Start an Apify device login. Only an explicit user action should call this. */
export function startApifyOAuth(signal?: AbortSignal): Promise<ApifyOAuthView> {
  return requestApifyOAuth(APIFY_OAUTH_START_URL, 'POST', signal);
}

export function cancelApifyOAuth(signal?: AbortSignal): Promise<ApifyOAuthView> {
  return requestApifyOAuth(APIFY_OAUTH_CANCEL_URL, 'POST', signal);
}

export function logoutApifyOAuth(signal?: AbortSignal): Promise<ApifyOAuthView> {
  return requestApifyOAuth(APIFY_OAUTH_LOGOUT_URL, 'POST', signal);
}

/** Keep the stored tolerance exactly; '' means omitted (the built-in ±50% default). */
function normalizeTolerance(value: unknown): string {
  const raw = text(value).trim();
  if (!raw) return '';
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? String(numeric) : '';
}

function defaultRegionalBaselineAnchors(geo: string): AnchorDraft[] {
  const reference = mekaDefaultAnchor(geo);
  if (reference) return [{ term: reference.term, geo: reference.geo, dailySearches: String(reference.dailySearches), tolerance: '0.5' }];
  return [];
}

function blankAnchor(geo = DEFAULT_GEO): AnchorDraft {
  return { term: '', geo, dailySearches: '', tolerance: '0.5' };
}

function anchorsFrom(value: unknown): AnchorDraft[] {
  if (!Array.isArray(value)) return [];
  return value.map(row => {
    const anchor = record(row);
    return {
      term: text(anchor.term),
      geo: text(anchor.geo, DEFAULT_GEO).toUpperCase(),
      dailySearches: text(anchor.dailySearches),
      tolerance: normalizeTolerance(anchor.tolerance),
    };
  });
}

export function fromSnapshot(value: Record<string, unknown> | undefined): Draft {
  const source = value ?? {};
  const baselines = record(source.baselines);
  const anchors = anchorsFrom(baselines.anchors);
  const windows = record(baselines.windowAnchors);
  const chartDir = source.chartDir === null ? '' : text(source.chartDir, '.gtfa/charts');
  const egress = resolveEgress(source.egress);
  const legacyKeys = LEGACY_EGRESS_KEYS.filter(key => key in source);
  return {
    egress: egress.egress,
    ...(egress.notice ? { egressNotice: egress.notice } : {}),
    ...(legacyKeys.length ? { legacyKeys } : {}),
    token: '',
    clearToken: false,
    actor: text(source.apifyActor),
    geo: text(source.geo, DEFAULT_GEO).toUpperCase(),
    anchor: text(source.anchor),
    cache: source.cache !== false,
    snapshotDir: text(source.snapshotDir, '.gtfa/snapshots'),
    charts: source.charts !== false && source.chartDir !== null,
    chartDir: chartDir || '.gtfa/charts',
    baselineOverride: anchors.length > 0 || Boolean(text(windows.short) || text(windows.long)),
    anchors,
    newAnchor: blankAnchor(text(source.geo, DEFAULT_GEO).toUpperCase()),
    windowShort: text(windows.short),
    windowLong: text(windows.long),
  };
}

/** Enable a complete editable baseline without replacing saved anchors or window choices. */
export function setBaselineOverride(draft: Draft, enabled: boolean): Draft {
  return {
    ...draft,
    baselineOverride: enabled,
    anchors: enabled && draft.anchors.length === 0 ? defaultRegionalBaselineAnchors(draft.geo) : draft.anchors,
  };
}

function draftKey(draft: Draft): string {
  return JSON.stringify(draft);
}

/** A filled-in "new anchor" row counts as added, so Save never drops it. */
export function withPendingAnchor(draft: Draft): Draft {
  const term = draft.baselineOverride ? draft.newAnchor.term.trim() : '';
  if (!term) return draft;
  const anchor = { ...draft.newAnchor, term, dailySearches: String(Number(draft.newAnchor.dailySearches)) };
  return { ...draft, anchors: [...draft.anchors, anchor], newAnchor: blankAnchor(draft.geo) };
}

export function opsFor(draft: Draft, t: Translate): PathOp[] | string {
  const ops: PathOp[] = [];
  const set = (path: string[], value: unknown) => ops.push({ op: 'set', path, value });
  const unset = (path: string[]) => ops.push({ op: 'unset', path });
  const textOrUnset = (path: string[], value: string) => value.trim() ? set(path, value.trim()) : unset(path);

  if (draft.token && draft.clearToken) return t('tokenConflict');
  set(['egress'], draft.egress);
  for (const key of draft.legacyKeys ?? []) {
    if ((LEGACY_EGRESS_KEYS as readonly string[]).includes(key)) unset([key]);
  }
  // Local egress leaves the saved Apify token and Actor untouched.
  if (draft.egress !== 'local') {
    if (draft.token.trim()) set(['apifyToken'], draft.token.trim());
    else if (draft.clearToken) unset(['apifyToken']);
  }
  // The Actor select is only meaningful for the user's own deployment.
  if (draft.egress === 'actor-own') textOrUnset(['apifyActor'], draft.actor);
  if (!GEO_SET.has(draft.geo)) return t('invalidGeo');
  set(['geo'], draft.geo);
  textOrUnset(['anchor'], draft.anchor);
  set(['cache'], draft.cache);
  textOrUnset(['snapshotDir'], draft.snapshotDir);
  set(['charts'], draft.charts);
  if (draft.charts) textOrUnset(['chartDir'], draft.chartDir);
  else unset(['chartDir']);

  if (!draft.baselineOverride) {
    unset(['baselines']);
    return ops;
  }
  if (draft.anchors.length === 0) return t('baselinesEmpty');
  const anchors = draft.anchors.map(row => {
    const term = row.term.trim();
    const dailySearches = Number(row.dailySearches);
    const tolerance = row.tolerance.trim() === '' ? undefined : Number(row.tolerance);
    if (!term || !Number.isFinite(dailySearches) || dailySearches <= 0) throw new Error(t('invalidAnchor'));
    if (tolerance !== undefined && !(Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 1)) throw new Error(t('invalidTolerance'));
    if (!GEO_SET.has(row.geo)) throw new Error(t('invalidGeo'));
    return { term, geo: row.geo, dailySearches, ...(tolerance === undefined ? {} : { tolerance }) };
  });
  const windowAnchors = {
    ...(draft.windowShort.trim() ? { short: draft.windowShort.trim() } : {}),
    ...(draft.windowLong.trim() ? { long: draft.windowLong.trim() } : {}),
  };
  const known = new Set([...anchors.map(anchor => anchor.term.toLowerCase()), ...BUILTIN_ANCHOR_TERMS]);
  for (const term of Object.values(windowAnchors)) {
    if (!known.has(term.toLowerCase())) throw new Error(t('windowUnknown'));
  }
  set(['baselines'], {
    anchors,
    ...(Object.keys(windowAnchors).length ? { windowAnchors } : {}),
  });
  return ops;
}

export interface DraftValidation {
  anchorRows: Record<number, string>;
  newAnchorTerm?: string;
  newAnchorDaily?: string;
  tokenWarning?: string;
  snapshotDir?: string;
  chartDir?: string;
  baselines?: string;
  window?: string;
}

function isPositiveNumber(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
}

/** Field-level validation. The token-prefix warning is informative and never blocks Save. */
export function validateDraft(draft: Draft, t: Translate): DraftValidation {
  const validation: DraftValidation = { anchorRows: {} };
  if (!draft.snapshotDir.trim()) validation.snapshotDir = t('requiredDirectory');
  if (draft.charts && !draft.chartDir.trim()) validation.chartDir = t('requiredDirectory');
  if (draft.token.trim() && !draft.token.trim().startsWith('apify_api_')) validation.tokenWarning = t('tokenPrefixWarning');

  if (draft.baselineOverride) {
    if (draft.anchors.length === 0 && !draft.newAnchor.term.trim()) validation.baselines = t('baselinesEmpty');
    draft.anchors.forEach((anchor, index) => {
      if (!isPositiveNumber(anchor.dailySearches)) validation.anchorRows[index] = t('invalidDaily');
    });
    const term = draft.newAnchor.term.trim();
    const daily = draft.newAnchor.dailySearches.trim();
    if (term || daily) {
      if (!term) validation.newAnchorTerm = t('newAnchorTermRequired');
      else if (draft.anchors.some(anchor =>
        anchor.term.trim().toLowerCase() === term.toLowerCase() &&
        anchor.geo.trim().toUpperCase() === draft.newAnchor.geo.trim().toUpperCase()
      )) {
        validation.newAnchorTerm = t('duplicateAnchor');
      }
      if (!isPositiveNumber(daily)) validation.newAnchorDaily = t('invalidDaily');
    }
    const known = new Set([
      ...BUILTIN_ANCHOR_TERMS.map(value => value.toLowerCase()),
      ...draft.anchors.map(anchor => anchor.term.trim().toLowerCase()).filter(Boolean),
    ]);
    for (const value of [draft.windowShort, draft.windowLong]) {
      const window = value.trim();
      if (window && !known.has(window.toLowerCase())) {
        validation.window = t('windowUnknown');
        break;
      }
    }
  }
  return validation;
}

export function hasBlockingValidation(validation: DraftValidation): boolean {
  return Boolean(
    validation.snapshotDir ||
    validation.chartDir ||
    validation.newAnchorTerm ||
    validation.newAnchorDaily ||
    validation.baselines ||
    validation.window ||
    Object.keys(validation.anchorRows).length,
  );
}

/** Disabled buttons read as disabled (inline styles bypass :disabled). */
function dim(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, opacity: 0.45, cursor: 'default' } : style;
}

function money(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

/** Usage rounds down to the cent, as Apify Console shows it. */
function usageMoney(value: number | null): string {
  return value === null ? '—' : money(Math.floor(value * 100 + 1e-9) / 100);
}

function compactMoney(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function tierTitle(value: string | null): string {
  if (!value) return '—';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function statusLabel(value: number | null): string {
  return value === null ? '—' : String(value);
}

function usageErrorText(state: Extract<ApifyUsageView, { status: 'error' }>, t: Translate): string {
  if (state.code === 'no-token') return t('usageNoToken');
  if (state.code === 'invalid-token') return t('usageInvalidToken');
  if (state.code === 'network') return t('usageNetwork');
  return template(t('usageHttp'), { status: statusLabel(state.httpStatus ?? null) });
}

function testLine(result: TestConnectionView, t: Translate): { ok: boolean; text: string } {
  if (result.data?.ok && result.network?.ok && result.ok) return { ok: true, text: template(t('testComplete'), { ms: result.latencyMs }) };
  const diagnosticKeys: Partial<Record<ConnectionCode, string>> = {
    blocked: 'testBlocked', 'rate-limited': 'testRateLimited', timeout: 'testTimeout', protocol: 'testProtocol',
    cancelled: 'testCancelled', 'no-data': 'testNoDataSummary',
    'host-restart-required': 'testHostRestartRequired',
  };
  if (result.code && diagnosticKeys[result.code]) return { ok: false, text: t(diagnosticKeys[result.code]!) };
  if (result.network?.ok && result.data && !result.data.ok && (result.code === 'network' || result.code === 'http')) return { ok: false, text: t('testDataError') };
  if (result.ok) {
    return { ok: false, text: t('testIncomplete') };
  }
  let key = result.egress !== 'local' ? 'testNetworkActor' : 'testNetworkLocal';
  if (result.code === 'no-token') key = 'testNoToken';
  else if (result.code === 'no-actor') key = 'testNoActor';
  else if (result.code === 'invalid-token') key = 'testInvalidToken';
  else if (result.code === 'version-mismatch') key = 'testVersionMismatch';
  else if (result.code === 'http') key = 'testHttp';
  else if (result.code === 'busy') key = 'testBusy';
  const base = key === 'testHttp' ? template(t(key), { status: statusLabel(result.status) }) : t(key);
  const detail = (result.code === 'network' || result.code === 'version-mismatch') && result.message
    ? template(t('testDetail'), { detail: result.message })
    : '';
  return { ok: false, text: base + detail };
}

export function ConnectionTestResults({ result, t, locale, testing = false }: {
  result?: TestConnectionView; t: Translate; locale: string; testing?: boolean;
}) {
  const network = result?.network ?? result;
  const line = result ? testLine(result, t) : null;
  const checks = result?.data?.keywords ?? CONNECTION_KEYWORDS.map(keyword => ({ keyword, status: 'skipped' as const, points: 0, nonzeroPoints: 0 }));
  const passed = checks.filter(check => check.status === 'ok').length;
  const positive = !testing && line?.ok;
  const cancelled = !testing && result?.code === 'cancelled';
  const warning = !testing && (result?.code === 'host-restart-required' || result?.code === 'no-data' || result?.code === 'rate-limited');
  const tone = testing ? 'pending' : cancelled ? 'quiet' : positive ? 'positive' : warning ? 'warning' : 'negative';
  const title = testing ? 'diagnosticRunning' : cancelled ? 'diagnosticCancelled' : positive ? 'diagnosticPassed' : result?.code === 'host-restart-required'
    ? 'connectionHostRestart' : result?.network?.ok ? 'diagnosticDataFailed' : 'diagnosticConnectionFailed';
  const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : template(t('diagnosticSeconds'), {
    seconds: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ms / 1000),
  });
  return <div className={`gtfa-diagnostic ${tone}`} role="status" aria-live="polite" aria-busy={testing}>
    <div className="gtfa-diagnostic-heading">
      <span className={`gtfa-diagnostic-symbol ${testing ? 'spinning' : ''}`}><Icon name={testing ? 'refresh' : positive ? 'check' : 'alert'} size={19} /></span>
      <div className="gtfa-diagnostic-heading-copy"><h4>{t(title)}</h4>
        <span>{testing ? t('diagnosticRunningHint') : template(t('diagnosticKeywordCount'), { passed, total: checks.length })}</span>
      </div>
      <span className="gtfa-diagnostic-badge">{t(testing ? 'diagnosticPending' : cancelled ? 'diagnosticCancelled' : positive ? 'diagnosticPass' : warning ? 'diagnosticAttention' : 'diagnosticFailed')}</span>
    </div>
    <div className="gtfa-diagnostic-network" role="group" aria-label={network?.ok && !testing
      ? template(t(result?.egress === 'local' ? 'testLocalOk' : 'testActorOk'), { status: statusLabel(network.status), ms: network.latencyMs }) : t('diagnosticNetwork')}>
      <span className="gtfa-diagnostic-label"><Icon name={result?.egress && result.egress !== 'local' ? 'cloud' : 'plug'} size={15} />{t('diagnosticNetwork')}</span>
      <span className={`gtfa-diagnostic-network-state ${!testing && network?.ok ? 'positive' : testing || cancelled ? 'pending' : 'negative'}`}>
        {!testing && !cancelled ? <Icon name={network?.ok ? 'check' : 'alert'} size={13} /> : null}
        {t(testing ? 'diagnosticPending' : cancelled ? 'diagnosticUnfinished' : network?.ok ? 'diagnosticReachable' : 'diagnosticFailed')}
      </span>
      <span className="gtfa-diagnostic-network-meta">{!testing && network ? `HTTP ${statusLabel(network.status)} · ${duration(network.latencyMs)}` : '—'}</span>
    </div>
    <div className="gtfa-diagnostic-table-heading"><span>{t('diagnosticKeywords')}</span><span>{t('diagnosticScope')}</span></div>
    <table className="gtfa-diagnostic-table">
      <caption className="gtfa-sr-only">{t('testDataTitle')}</caption>
      <thead><tr><th scope="col">{t('diagnosticTerm')}</th><th scope="col">{t('diagnosticPoints')}</th><th scope="col">{t('diagnosticNonzero')}</th><th scope="col">{t('diagnosticResult')}</th></tr></thead>
      <tbody>{checks.map(check => {
        const known = !testing && (check.status === 'ok' || check.status === 'no_data');
        const state = testing ? 'pending' : check.status === 'ok' ? 'positive' : check.status === 'skipped' ? 'quiet' : check.status === 'no_data' ? 'warning' : 'negative';
        return <tr key={check.keyword}>
          <th scope="row">{check.keyword}</th>
          <td className="gtfa-diagnostic-number">{known ? check.points : <span className="gtfa-diagnostic-empty">—</span>}</td>
          <td className="gtfa-diagnostic-number muted">{known ? check.nonzeroPoints : <span className="gtfa-diagnostic-empty">—</span>}</td>
          <td><span className={`gtfa-diagnostic-row-state ${state}`}>
            {!testing && check.status === 'ok' ? <Icon name="check" size={13} /> : null}
            {t(testing ? 'diagnosticWaiting' : check.status === 'ok' ? 'diagnosticPass' : check.status === 'skipped' ? 'testSkipped' : check.status === 'no_data' ? 'diagnosticNoData' : 'testDataError')}
          </span></td>
        </tr>;
      })}</tbody>
    </table>
    {!testing && line && !line.ok && !cancelled ? <p className="gtfa-diagnostic-note"><Icon name="alert" size={14} /><span>{line.text}</span></p> : null}
    {cancelled ? <span className="gtfa-sr-only">{t('testCancelled')}</span> : null}
    {!testing && result?.egress !== 'local' && result?.data ? <p className="gtfa-runtime-note">
      <Icon name={result.actorRuntime && result.actorRuntime.version === result.pluginVersion && result.actorRuntime.baselineCatalogRevision === BASELINE_CATALOG_REVISION ? 'check' : 'alert'} size={13} />
      {result.actorRuntime && result.actorRuntime.baselineCatalogRevision !== BASELINE_CATALOG_REVISION ? t('actorRuntimeCatalogDifferent') : result.actorRuntime && result.pluginVersion ? template(t(result.actorRuntime.version === result.pluginVersion ? 'actorRuntimeAligned' : 'actorRuntimeDifferent'),
        { actor: result.actorRuntime.version, plugin: result.pluginVersion }) : t('actorRuntimeUnknown')}
    </p> : null}
    <div className="gtfa-diagnostic-footer">
      <span><Icon name="clock" size={13} />{t('diagnosticDuration')} <strong>{testing || !result ? '—' : duration(result.latencyMs)}</strong></span>
      {result?.checkedAt && !testing ? <time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleString(locale)}</time> : <span>{t(testing ? 'diagnosticFresh' : 'diagnosticNotComplete')}</span>}
    </div>
    {!testing && line?.ok ? <span className="gtfa-sr-only">{line.text}</span> : null}
  </div>;
}

function normalizeActor(value: unknown): ApifyActorView | null {
  const row = record(value);
  const id = stringOrNull(row.id);
  const name = stringOrNull(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    username: stringOrNull(row.username),
    title: stringOrNull(row.title),
    standbyUrl: stringOrNull(row.standbyUrl),
    standbyEnabled: row.standbyEnabled === true,
    lastBuildId: stringOrNull(row.lastBuildId),
    lastBuildStatus: stringOrNull(row.lastBuildStatus),
  };
}

function normalizeUsage(value: Record<string, unknown>): ApifyUsageData {
  const plan = record(value.plan);
  const cycle = record(value.cycle);
  return {
    plan: {
      tier: stringOrNull(plan.tier),
      monthlyBasePriceUsd: numberOrNull(plan.monthlyBasePriceUsd),
      monthlyUsageCreditsUsd: numberOrNull(plan.monthlyUsageCreditsUsd),
    },
    usageUsd: numberOrNull(value.usageUsd),
    limitUsd: numberOrNull(value.limitUsd),
    cycle: { startAt: stringOrNull(cycle.startAt), endAt: stringOrNull(cycle.endAt) },
    residentialGb: numberOrNull(value.residentialGb),
    residentialGbLimit: numberOrNull(value.residentialGbLimit),
    fetchedAt: text(value.fetchedAt),
    source: value.source === 'oauth' || value.source === 'config' || value.source === 'env' ? value.source : null,
  };
}

/** Load the Host-rendered usage card state over the owner-authenticated API. */
export async function loadApifyUsage(refresh = false): Promise<ApifyUsageView> {
  try {
    const response = await fetch(`${USAGE_URL}${refresh ? '?refresh=1' : ''}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    const row = record(body);
    if (row.ok === false) {
      const code = row.code === 'no-token' || row.code === 'invalid-token' || row.code === 'network' || row.code === 'http'
        ? row.code
        : 'http';
      const httpStatus = numberOrNull(row.status) ?? (!response.ok ? response.status : null);
      return { status: 'error', code, ...(httpStatus === null ? {} : { httpStatus }) };
    }
    if (response.ok && row.ok === true) return { status: 'ready', data: normalizeUsage(row) };
    return { status: 'error', code: 'http', httpStatus: response.status };
  } catch {
    return { status: 'error', code: 'network' };
  }
}

/** Load the Actor list for the saved token. */
export async function loadApifyActors(refresh = false, signal?: AbortSignal): Promise<ApifyActorsView> {
  const deadline = AbortSignal.timeout(45_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const response = await fetch(`${ACTORS_URL}${refresh ? '?refresh=1' : ''}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: requestSignal,
    });
    let body: unknown;
    try { body = await response.json(); } catch (error) {
      if (requestSignal.aborted) throw error;
      body = undefined;
    }
    const row = record(body);
    if (row.ok === false) {
      const code = row.code === 'no-token' || row.code === 'invalid-token' || row.code === 'network' || row.code === 'http'
        ? row.code
        : 'http';
      const httpStatus = numberOrNull(row.status) ?? (!response.ok ? response.status : null);
      return { status: 'error', code, ...(httpStatus === null ? {} : { httpStatus }) };
    }
    if (response.ok && row.ok === true && Array.isArray(row.actors)) {
      const actors = row.actors.map(normalizeActor).filter((actor): actor is ApifyActorView => actor !== null);
      return { status: 'ready', actors };
    }
    return { status: 'error', code: 'http', httpStatus: response.status };
  } catch {
    return { status: 'error', code: 'network' };
  }
}

/** Deploy this package's Actor into the user's account. */
export async function deployApifyActor(signal?: AbortSignal, update?: { actorId: string; apifyToken?: string }): Promise<DeployActorView> {
  try {
    const response = await fetch(update ? UPDATE_URL : DEPLOY_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(update ? { apifyActor: update.actorId, ...(update.apifyToken !== undefined ? { apifyToken: update.apifyToken } : {}) } : {}),
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
    });
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    const row = record(body);
    if (row.ok === true && typeof row.actorId === 'string' && typeof row.buildId === 'string') {
      return { ok: true, actorId: row.actorId, buildId: row.buildId };
    }
    return {
      ok: false,
      code: typeof row.code === 'string' ? row.code : 'http',
      ...(typeof row.message === 'string' ? { message: row.message } : {}),
    };
  } catch {
    return { ok: false, code: 'network' };
  }
}

/** Resolve only the deployed Actor's exact build; unrelated Actors never affect it. */
export function resolveDeployBuild(actors: ApifyActorsView, target: DeployTarget | null): DeployBuildResolution {
  if (!target || actors.status !== 'ready') return { status: 'pending' };
  const actor = actors.actors.find(row => row.id === target.actorId);
  if (!actor || actor.lastBuildId !== target.buildId) return { status: 'pending' };
  const status = (actor.lastBuildStatus ?? '').trim().toUpperCase().replace(/_/g, '-');
  if (status === 'SUCCEEDED') return { status: 'succeeded', actorId: target.actorId };
  if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') return { status: 'failed' };
  return { status: 'pending' };
}

/** Test the current connection without applying it to the Host configuration. */
export async function runConnectionTest(settings: {
  egress: EgressMode;
  apifyActor?: string;
  apifyToken?: string;
} = { egress: 'local' }, signal?: AbortSignal): Promise<TestConnectionView> {
  const { egress } = settings;
  const deadline = AbortSignal.timeout(135_000);
  try {
    const response = await fetch(TEST_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(settings),
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    const row = record(body);
    // Older Hosts ignore the body and can silently check a different saved route or Actor.
    if (typeof row.ok === 'boolean' && row.settingsSource !== 'draft') {
      return { ok: false, egress, status: null, latencyMs: 0, code: 'host-restart-required' };
    }
    if (typeof row.ok === 'boolean' && row.egress === egress) {
      const basic: TestConnectionView = {
        ok: row.ok,
        egress,
        status: numberOrNull(row.status),
        latencyMs: numberOrNull(row.latencyMs) ?? 0,
        ...(typeof row.code === 'string' ? { code: row.code as TestConnectionView['code'] } : {}),
        ...(typeof row.message === 'string' ? { message: row.message } : {}),
        ...(typeof row.actorId === 'string' ? { actorId: row.actorId } : {}),
        ...('actorRuntime' in row ? { actorRuntime: parseActorRuntime(row.actorRuntime) } : {}),
        ...(typeof row.pluginVersion === 'string' && /^\d+\.\d+\.\d+$/.test(row.pluginVersion) ? { pluginVersion: row.pluginVersion } : {}),
      };
      if (row.ok && row.network === undefined && row.data === undefined) return { ...basic, ok: false, code: 'host-restart-required' };
      if ((row.network === undefined) !== (row.data === undefined)) return { ...basic, ok: false, code: 'protocol' };
      if (row.network !== undefined) {
        const net = record(row.network);
        if (typeof net.ok !== 'boolean' || net.egress !== egress) return { ...basic, ok: false, code: 'protocol' };
        basic.network = { ok: net.ok, egress, status: numberOrNull(net.status), latencyMs: numberOrNull(net.latencyMs) ?? 0,
          ...(typeof net.code === 'string' ? { code: net.code as ConnectionCode } : {}),
          ...(typeof net.message === 'string' ? { message: net.message } : {}) };
      }
      if (row.data !== undefined) {
        const data = record(row.data);
        const keywords = Array.isArray(data.keywords) ? data.keywords.map(record) : [];
        const valid = typeof data.ok === 'boolean' && data.geo === 'US' && data.time === 'now 1-d'
          && keywords.length === CONNECTION_KEYWORDS.length && keywords.every((check, index) =>
            check.keyword === CONNECTION_KEYWORDS[index] && ['ok', 'no_data', 'error', 'skipped'].includes(String(check.status))
            && Number.isInteger(check.points) && Number(check.points) >= 0 && Number(check.points) <= 10000
            && Number.isInteger(check.nonzeroPoints) && Number(check.nonzeroPoints) >= 0 && Number(check.nonzeroPoints) <= Number(check.points)
            && (check.status === 'ok' ? Number(check.nonzeroPoints) > 0 : Number(check.nonzeroPoints) === 0))
          && data.ok === keywords.every(check => check.status === 'ok');
        if (!valid) return { ...basic, ok: false, code: 'protocol' };
        basic.data = { ok: data.ok as boolean, geo: 'US', time: 'now 1-d', latencyMs: numberOrNull(data.latencyMs) ?? 0,
          keywords: keywords.map(check => ({ keyword: String(check.keyword), status: check.status as DataCheck['keywords'][number]['status'],
            points: Number(check.points), nonzeroPoints: Number(check.nonzeroPoints) })),
          ...(typeof data.code === 'string' ? { code: data.code as ConnectionCode } : {}),
          ...(typeof data.fetchedAt === 'string' && Number.isFinite(Date.parse(data.fetchedAt)) ? { fetchedAt: data.fetchedAt } : {}) };
        if (basic.ok && (!basic.network?.ok || !basic.data.ok)) return { ...basic, ok: false, code: 'protocol' };
      }
      if (typeof row.checkedAt === 'string' && Number.isFinite(Date.parse(row.checkedAt))) basic.checkedAt = row.checkedAt;
      return basic;
    }
    return { ok: false, egress, status: response.status, latencyMs: 0, code: 'http' };
  } catch {
    return { ok: false, egress, status: null, latencyMs: 0, code: signal?.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'network' };
  }
}

const OAUTH_ERROR_KEYS: Record<ApifyOAuthCode, string> = {
  unavailable: 'oauthUnavailable',
  'read-only': 'oauthReadOnly',
  network: 'oauthNetwork',
  'invalid-response': 'oauthInvalidResponse',
  'access-denied': 'oauthAccessDenied',
  expired: 'oauthExpired',
  storage: 'oauthStorage',
  'reauth-required': 'oauthReauthRequired',
  busy: 'oauthBusy',
};

function oauthErrorText(code: ApifyOAuthCode, t: Translate): string {
  return t(OAUTH_ERROR_KEYS[code]);
}

function oauthIssueCode(state: ApifyOAuthView): ApifyOAuthCode | undefined {
  if (state.status === 'error') return state.code;
  if (state.status !== 'ready') return undefined;
  if (state.data.code) return state.data.code;
  return state.data.available ? undefined : 'unavailable';
}

function oauthExpiryText(value: string | undefined, t: Translate, locale: string): string {
  if (!value) return t('oauthExpiresSoon');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('oauthExpiresSoon');
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  return template(t('oauthExpiresAt'), { time });
}

export interface ApifyOAuthCardProps {
  state: ApifyOAuthView;
  t: Translate;
  locale: string;
  busy?: ApifyOAuthAction | null;
  onStart?: () => void;
  onCancel?: () => void;
  onLogout?: () => void;
  onRetry?: () => void;
  connectionAction?: ReactNode;
  connectionDescription?: string;
  signInLabel?: string;
}

/** SSR-safe Apify sign-in card. Buttons only call explicit parent actions. */
export function ApifyOAuthCard({
  state, t, locale, busy = null, onStart, onCancel, onLogout, onRetry,
  connectionAction, connectionDescription, signInLabel,
}: ApifyOAuthCardProps) {
  const accountMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: Event) => {
      const menu = accountMenu.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('focusin', dismiss);
    };
  }, []);
  const data = state.status === 'ready' ? state.data : undefined;
  const issue = oauthIssueCode(state);
  const verificationUri = normalizeApifyOAuthVerificationUri(data?.verificationUri) ?? APIFY_OAUTH_VERIFICATION_URL;
  const signIn = <button type="button" className="gtfa-button" style={dim({ ...styles.button, ...styles.primary }, busy !== null)}
    disabled={busy !== null} onClick={onStart}>
    <Icon name="external" size={13} />
    {busy === 'start' ? t('oauthStarting') : issue ? t('oauthSignInAgain') : signInLabel ?? t('oauthSignIn')}
  </button>;
  const alert = issue ? <p style={styles.fieldError} role="alert">{oauthErrorText(issue, t)}</p> : null;
  const loading = state.status === 'loading';
  const restart = issue === 'access-denied' || issue === 'expired' || issue === 'reauth-required';
  const title = loading
    ? t(busy === 'logout' ? 'oauthLoggingOut' : busy === 'start' ? 'oauthStarting' : 'oauthLoading')
    : data?.connected ? t('oauthConnected') : data?.pending ? t('oauthPendingTitle') : t('oauthTitle');

  return <div style={styles.oauthCard} aria-label={t('oauthTitle')}>
    <div className="gtfa-connection-top">
      <span className={`gtfa-status-icon${data?.connected ? '' : ' login'}`}>
        <Icon name={data?.connected ? 'check' : data?.pending ? 'external' : issue ? 'alert' : 'plug'} size={18} />
      </span>
      <div className="gtfa-connection-copy">
        <div className="gtfa-connection-title" role="status">{title}</div>
        {!loading ? <p className="gtfa-connection-subtitle">{data?.connected
          ? connectionDescription ?? t('oauthConnectedHint')
          : data?.pending ? t('oauthPending') : signInLabel ? t('actorLoginHint') : t('oauthSignedOut')}</p> : null}
      </div>
      <div className="gtfa-connection-actions">
        {data?.connected ? <>
          {connectionAction}
          <details ref={accountMenu} className="gtfa-account-menu" onKeyDown={event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.open = false;
            event.currentTarget.querySelector<HTMLElement>('summary')?.focus();
          }}>
            <summary aria-label={t('accountActions')}><Icon name="more" size={16} /></summary>
            <div><button type="button" disabled={busy !== null} onClick={event => {
              const menu = event.currentTarget.closest('details');
              if (menu) menu.open = false;
              onLogout?.();
            }}>{busy === 'logout' ? t('oauthLoggingOut') : t('oauthLogout')}</button></div>
          </details>
        </> : loading ? null : data?.pending ? <>
          <a style={styles.oauthLink} href={verificationUri} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={13} />{t('oauthOpen')}
          </a>
          <button type="button" className="gtfa-button" style={dim(styles.button, busy !== null)}
            disabled={busy !== null} onClick={onCancel}>
            {busy === 'cancel' ? t('oauthCancelling') : t('oauthCancel')}
          </button>
        </> : issue && !restart ? <button type="button" className="gtfa-button" style={dim(styles.button, busy !== null)}
          disabled={busy !== null} onClick={onRetry}><Icon name="refresh" size={13} />{t('oauthRetry')}</button> : signIn}
      </div>
    </div>
    {data?.pending ? <div className="gtfa-oauth-foot">
      <div className="gtfa-oauth-code-row">
        {data.userCode ? <span style={styles.oauthCode}>{template(t('oauthUserCode'), { code: data.userCode })}</span> : null}
        <span style={styles.usageMeta}>{oauthExpiryText(data.expiresAt, t, locale)}</span>
      </div>
      {alert}
    </div> : alert || (!loading && !data?.connected) ? <div className="gtfa-oauth-foot">
      {alert}
      {issue === 'unavailable' || issue === 'read-only' ? <p style={styles.hint}>{t('oauthManualFallback')}</p> : null}
      {!data?.connected ? <p style={styles.usageMeta}>{t('oauthScope')}</p> : null}
    </div> : null}
  </div>;
}

function ApifyCardArt({ className = 'gtfa-credit-art' }: { className?: string }) {
  const artId = useId().replace(/:/g, '');
  return <svg className={className} viewBox="0 0 340 300" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${artId}-signal`} x1="0" y1="0" x2="210" y2="160" gradientUnits="userSpaceOnUse"><stop stopColor="#e2f3ef" /><stop offset="1" stopColor="#bfd9f9" /></linearGradient>
        <linearGradient id={`${artId}-blue`} x1="0" y1="0" x2="170" y2="110" gradientUnits="userSpaceOnUse"><stop stopColor="#e9f3ff" /><stop offset="1" stopColor="#c1d9ff" /></linearGradient>
      </defs>
      <g transform="translate(40 -30) rotate(-24 150 150)">
        <rect x="0" y="0" width="142" height="85" rx="12" fill={`url(#${artId}-blue)`} />
        <path d="M16 22h65M16 34h37" stroke="#6e93c8" strokeOpacity=".45" strokeWidth="5" strokeLinecap="round" />
        <rect x="154" y="0" width="150" height="85" rx="12" fill={`url(#${artId}-signal)`} />
        <path d="m170 59 25-21 20 8 30-24 39 10" stroke="#6e93c8" strokeOpacity=".6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="0" y="97" width="234" height="112" rx="13" fill={`url(#${artId}-signal)`} />
        <path d="M18 119h79M18 132h45" stroke="#6e93c8" strokeOpacity=".55" strokeWidth="5" strokeLinecap="round" />
        <path d="m18 181 29-13 29 7 34-29 29 12 33-24 39-3" stroke="#6e93c8" strokeOpacity=".85" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="246" y="97" width="100" height="112" rx="13" fill={`url(#${artId}-blue)`} />
        <rect x="0" y="221" width="102" height="100" rx="12" fill={`url(#${artId}-signal)`} />
        <rect x="114" y="221" width="190" height="100" rx="12" fill={`url(#${artId}-blue)`} />
        <path d="M133 244h76M133 257h42" stroke="#6e93c8" strokeOpacity=".5" strokeWidth="5" strokeLinecap="round" />
        <circle cx="24" cy="283" r="9" fill="#88acd4" fillOpacity=".3" />
        <path d="M44 282h36" stroke="#6e93c8" strokeOpacity=".4" strokeWidth="5" strokeLinecap="round" />
      </g>
    </svg>;
}

function ApifySignupBar({ t }: { t: Translate; locale: string }) {
  return <aside className="gtfa-free-credit" aria-label={template(t('signupCredit'), { amount: APIFY_FREE_MONTHLY_CREDIT_USD })}>
    <ApifyCardArt />
    <div className="gtfa-free-credit-copy">
      <span className="gtfa-credit-eyebrow">{t('signupPlan')}</span>
      <div className="gtfa-credit-value"><strong>${APIFY_FREE_MONTHLY_CREDIT_USD}</strong><span>{t('signupMonthly')}</span></div>
      <p className="gtfa-free-credit-estimate">{t('signupEstimate')}</p>
      <div className="gtfa-free-credit-actions">
        <a className="gtfa-credit-cta" href={APIFY_SIGNUP_URL} target="_blank" rel="noopener noreferrer">{t('signupAction')}</a>
        <a className="gtfa-credit-pricing" href={APIFY_PRICING_URL} target="_blank" rel="noopener noreferrer">{t('pricingAction')}</a>
      </div>
      <small>{t('signupCreditNote')}</small>
    </div>
  </aside>;
}

function actorErrorText(state: Extract<ApifyActorsView, { status: 'error' }>, t: Translate): string {
  if (state.code === 'no-token') return t('testNoToken');
  if (state.code === 'invalid-token') return t('testInvalidToken');
  if (state.code === 'network') return t('actorLoadNetwork');
  return template(t('actorLoadHttp'), { status: statusLabel(state.httpStatus ?? null) });
}

function actorBuildState(status: string | null, buildId: string | null): { label: string; tone: string } {
  const normalized = status?.trim().toUpperCase().replace(/_/g, '-');
  if (normalized === 'SUCCEEDED') return { label: 'actorReady', tone: 'ready' };
  if (normalized === 'RUNNING' || normalized === 'READY') return { label: 'actorBuilding', tone: 'building' };
  if (normalized === 'FAILED' || normalized === 'ABORTED' || normalized === 'TIMED-OUT') return { label: 'actorBuildFailed', tone: 'failed' };
  return { label: buildId ? 'actorBuildUnknown' : 'actorNotBuilt', tone: 'unknown' };
}

/** Keep deployment progress and available Actor choices in one consistent panel. */
export function ActorSelection({ state, value, t, disabled, pending = false, refreshing = false,
  deployment = null, updating = false, notice, onChange, onRefresh, onManual, onDeploy, onUpdate }: {
  state: ApifyActorsView; value: string; t: Translate; disabled: boolean; pending?: boolean;
  refreshing?: boolean; deployment?: 'creating' | 'building' | null; notice?: string | null;
  updating?: boolean;
  onChange: (value: string) => void; onRefresh: () => void; onManual: () => void;
  onDeploy: () => void;
  onUpdate?: () => void;
}) {
  const loading = state.status === 'idle' || state.status === 'loading';
  const needsLogin = state.status === 'error' && (state.code === 'no-token' || state.code === 'invalid-token');
  const selected = state.status === 'ready' ? state.actors.find(actor => actor.id === value) : undefined;
  const chooseWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || state.status !== 'ready' || !state.actors.length) return;
    const current = state.actors.findIndex(actor => actor.id === value);
    const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? current + 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? current < 0 ? state.actors.length - 1 : current - 1
        : event.key === 'Home' ? 0 : event.key === 'End' ? state.actors.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const index = (next + state.actors.length) % state.actors.length;
    const target = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index];
    onChange(state.actors[index]!.id);
    target?.focus();
  };
  return <div className="gtfa-actor-picker">
    <div className="gtfa-picker-heading"><span><Icon name="server" size={15} />{t('actor')}
      {!deployment && state.status === 'ready' && state.actors.length > 0 ? <small>{template(t('actorCount'), { count: state.actors.length })}</small> : null}</span>
      {!needsLogin ? <button type="button" className="gtfa-button gtfa-quiet-button" style={styles.buttonSmall}
        aria-label={t('actorRefreshLabel')} disabled={disabled || loading || refreshing || deployment === 'creating'} onClick={onRefresh}>
        <span className={refreshing ? 'gtfa-spin' : undefined}><Icon name="refresh" size={12} /></span>{t('actorRefresh')}</button> : null}
    </div>
    {deployment ? <div className="gtfa-deployment-card" role="status">
      <div className="gtfa-deployment-intro"><span className="gtfa-deployment-icon gtfa-spin"><Icon name="refresh" size={20} /></span>
        <div><strong>{t(updating ? 'actorUpdatingTitle' : deployment === 'creating' ? 'actorCreatingTitle' : 'actorBuildingTitle')}</strong>
          <p>{t(updating ? 'actorUpdatingHint' : deployment === 'creating' ? 'actorCreatingHint' : 'actorBuildingHint')}</p></div></div>
      <ol className="gtfa-deployment-steps">
        {[updating ? 'actorUpdateStep' : 'actorCreateStep', 'actorBuildStep', 'actorReadyStep'].map((step, index) => {
          const active = index === (deployment === 'creating' ? 0 : 1);
          const done = deployment === 'building' && index === 0;
          return <li key={step} className={done ? 'done' : active ? 'active' : ''} aria-current={active ? 'step' : undefined}>
            <span>{done ? <Icon name="check" size={12} /> : index + 1}</span>{t(step)}</li>;
        })}
      </ol>
      {state.status === 'error' ? <p className="gtfa-picker-meta">{t('actorBuildCheckFailed')}</p> : null}
    </div> : state.status === 'ready' && state.actors.length > 0 ? <>
      {value && !selected ? <p className="gtfa-actor-missing" role="status"><Icon name="alert" size={14} />{t('actorMissing')}</p> : null}
      <div className="gtfa-actor-choices" role="radiogroup" aria-label={t('actor')} aria-busy={refreshing} onKeyDown={chooseWithKeyboard}>
        {state.actors.map((actor, index) => {
          const active = actor.id === value;
          const build = actorBuildState(actor.lastBuildStatus, actor.lastBuildId);
          return <button key={actor.id} type="button" role="radio" aria-checked={active} className="gtfa-actor-choice"
            disabled={disabled} tabIndex={active || !selected && index === 0 ? 0 : -1} onClick={() => onChange(actor.id)}>
            <span className="gtfa-actor-choice-icon"><Icon name="server" size={18} /></span>
            <span className="gtfa-actor-choice-copy"><strong>{actor.title ?? actor.name}</strong>
              <span>{[actor.username, actor.name].filter(Boolean).join('/')}</span></span>
            <span className={`gtfa-actor-build ${build.tone}`}><span className="gtfa-dot" />{t(build.label)}</span>
            <span className="gtfa-actor-radio" aria-hidden="true">{active ? <Icon name="check" size={11} /> : null}</span>
          </button>;
        })}
      </div>
      <div className="gtfa-actor-update-row"><p className="gtfa-picker-meta">{t('actorSelectionHint')}</p>
        {selected && onUpdate ? <button type="button" className="gtfa-button gtfa-quiet-button" style={styles.buttonSmall}
          disabled={disabled || refreshing || ['RUNNING', 'READY'].includes(selected.lastBuildStatus ?? '')} onClick={onUpdate}>
          <Icon name="refresh" size={12} />{t('actorUpdate')}</button> : null}</div>
    </> : <div className={`gtfa-picker-state${needsLogin ? ' login' : ''}`} role={state.status === 'error' && !needsLogin ? 'alert' : 'status'}>
      <span className="gtfa-picker-state-icon"><Icon name={loading ? 'refresh' : needsLogin ? 'plug' : state.status === 'error' ? 'alert' : 'server'} size={19} /></span>
      <div className="gtfa-picker-state-copy"><strong>{loading ? t('actorLoading') : needsLogin ? t(pending ? 'actorLoginPending' : state.code === 'invalid-token' ? 'oauthReauthRequired' : 'actorLoginRequired') : state.status === 'error' ? actorErrorText(state, t) : t('actorEmpty')}</strong>
      </div>
      {needsLogin ? <div className="gtfa-picker-actions">
        <button type="button" className="gtfa-text-button" disabled={disabled} onClick={onManual}>{t('actorManualAction')}</button>
      </div> : state.status === 'error' ? <button type="button" className="gtfa-button" style={styles.buttonSmall} disabled={disabled} onClick={onRefresh}>{t('actorListRetry')}</button> : null}
    </div>}
    {!deployment && state.status === 'ready' && state.actors.length === 0 ? <div className="gtfa-actor-empty-actions">
      <button type="button" className="gtfa-button" style={{ ...styles.button, ...styles.primary }} disabled={disabled} onClick={onDeploy}>{t('deploy')}</button>
      <a style={styles.signupSecondary} href={DEPLOY_MANUAL_URL} target="_blank" rel="noopener noreferrer">{t('deployManual')}</a>
    </div> : null}
    {!deployment && notice ? <p style={styles.fieldError} role="alert">{notice}</p> : null}
  </div>;
}

export function ApifyUsageCard({ state, t, locale, onRefresh, onRetry, refreshing = false }: {
  state: ApifyUsageView;
  t: Translate;
  locale: string;
  onRefresh: () => void;
  onRetry: () => void;
  refreshing?: boolean;
}) {
  const refresh = <button type="button" className="gtfa-button gtfa-usage-refresh" style={styles.buttonSmall}
    aria-label={t('usageRefresh')} title={t('usageRefresh')} disabled={refreshing || state.status === 'loading'} onClick={onRefresh}>
    <Icon name="refresh" size={13} /><span className="gtfa-sr-only">{t('usageRefresh')}</span>
  </button>;
  if (state.status === 'ready') return <section className="gtfa-usage-banner" aria-label={t('usageTitle')}>
    <UsageDetails data={state.data} t={t} locale={locale} actions={refresh} />
  </section>;
  return <section className="gtfa-usage-banner" aria-label={t('usageTitle')}>
    <ApifyCardArt className="gtfa-credit-art gtfa-usage-art" />
    <div className="gtfa-usage-header"><span className="gtfa-credit-eyebrow">{t('usageTitle')}</span>{refresh}</div>
    <div className="gtfa-usage-state" role={state.status === 'error' ? 'alert' : 'status'}>
      <Icon name={state.status === 'error' ? 'alert' : 'refresh'} size={18} />
      <p>{state.status === 'error' ? usageErrorText(state, t) : t('usageLoading')}</p>
      {state.status === 'error' && (state.code === 'network' || state.code === 'http')
        ? <button type="button" className="gtfa-button gtfa-usage-retry" style={styles.buttonSmall} onClick={onRetry}>{t('usageRetry')}</button> : null}
    </div>
  </section>;
}

function UsageDetails({ data, t, locale, actions }: { data: ApifyUsageData; t: Translate; locale: string; actions: ReactNode }) {
  const hasProgress = data.usageUsd !== null && data.limitUsd !== null && data.limitUsd > 0;
  const percent = hasProgress ? Math.min(100, Math.max(0, (data.usageUsd! / data.limitUsd!) * 100)) : 0;
  const color = !hasProgress
    ? 'rgba(46,97,233,.15)'
    : percent > 90
      ? 'var(--gtfa-card-error)'
      : percent >= 70
        ? 'var(--gtfa-card-warning)'
        : 'var(--gtfa-card-progress)';
  const balance = data.usageUsd !== null && data.limitUsd !== null ? data.limitUsd - data.usageUsd : null;
  const remaining = template(t(balance !== null && balance < 0 ? 'usageOverBudget' : 'usageRemaining'), { amount: money(balance === null ? null : Math.abs(balance)) });

  const planPrice = compactMoney(data.plan.monthlyBasePriceUsd);
  const plan = data.plan.tier === null && data.plan.monthlyBasePriceUsd === null
    ? t('usagePlanUnknown')
    : template(t('usagePlan'), { tier: tierTitle(data.plan.tier), price: planPrice });
  const residential = data.residentialGb === null
    ? t('usageResidentialUnknown')
    : data.residentialGbLimit !== null && data.residentialGbLimit < 1000
      ? template(t('usageResidentialLimit'), { gb: data.residentialGb.toFixed(3), limit: data.residentialGbLimit.toFixed(3) })
      : template(t('usageResidential'), { gb: data.residentialGb.toFixed(3) });
  const source = data.source === 'oauth' ? t('usageSourceOAuth') : null;

  const end = data.cycle.endAt ? new Date(new Date(data.cycle.endAt).getTime() + 1) : null;
  const validEnd = end !== null && !Number.isNaN(end.getTime());
  const date = validEnd
    ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(end!)
    : null;
  const days = validEnd ? Math.max(0, Math.ceil((end!.getTime() - Date.now()) / 86_400_000)) : 0;
  const resets = date === null
    ? t('usageResetsUnknown')
    : days === 0
      ? template(t('usageResetsToday'), { date })
      : template(t('usageResetsIn'), { date, days });
  const fetched = data.fetchedAt ? new Date(data.fetchedAt) : null;
  const updated = fetched !== null && !Number.isNaN(fetched.getTime())
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(fetched)
    : null;

  return <>
    <ApifyCardArt className="gtfa-credit-art gtfa-usage-art" />
    <div className="gtfa-usage-header">
      <span className="gtfa-credit-eyebrow">{t('usageTitle')}</span>
      {data.plan.tier ? <span className="gtfa-usage-plan">{tierTitle(data.plan.tier)}</span> : null}
      {actions}
    </div>
    <div className="gtfa-usage-content">
      <span className="gtfa-usage-cycle">{t('usageCycle')}</span>
      <p className="gtfa-usage-total">
        <span className="gtfa-sr-only">{usageMoney(data.usageUsd)} / {money(data.limitUsd)}</span>
        <strong aria-hidden="true">{usageMoney(data.usageUsd)}</strong>
        <span className="gtfa-usage-limit" aria-hidden="true"><span>/</span> {money(data.limitUsd)}</span>
      </p>
      <div className="gtfa-usage-meter">
        <div className="gtfa-usage-progress" role="progressbar" aria-label={t('usageTitle')}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={hasProgress ? Math.round(percent) : undefined}>
          <div style={{ width: `${percent}%`, background: color }} />
        </div>
        <div className="gtfa-usage-balance"><span className={balance !== null && balance < 0 ? 'over-limit' : ''}>{remaining}</span>
          <span>{hasProgress ? template(t('usagePercent'), { percent: Math.round(percent) }) : '—'}</span></div>
      </div>
    </div>
    <details className="gtfa-usage-details">
      <summary>{t('usageDetails')}</summary>
      <div className="gtfa-usage-detail-grid">
        <p style={styles.usageMeta}>{resets}</p>
        <p style={styles.usageMeta}>{plan}</p>
        <p style={styles.usageMeta}>{residential}</p>
        {source ? <p style={styles.usageMeta}>{source}</p> : null}
        {updated ? <span>{template(t('usageUpdated'), { time: updated })}</span> : null}
      </div>
    </details>
  </>;
}

function useStore<T>(store: { getSnapshot(): T; subscribe(listener: () => void): () => void }): T {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const snapshot = useCallback(() => store.getSnapshot(), [store]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div style={styles.field}>
    <span style={styles.label}>{label}</span>
    {children}
    {hint ? <p style={styles.hint}>{hint}</p> : null}
  </div>;
}

function AnchorCell({ label, children }: { label: string; children: ReactNode }) {
  return <div className="gtfa-anchor-cell"><span className="gtfa-anchor-cell-label" aria-hidden="true">{label}</span>{children}</div>;
}

function Segmented<V extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: V;
  options: readonly { value: V; label: string; description?: string; icon?: string; recommended?: string }[];
  onChange: (value: V) => void;
  disabled: boolean;
}) {
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex(option => option.value === value);
    const next = event.key === 'ArrowRight' ? index + 1
      : event.key === 'ArrowLeft' ? index - 1
        : event.key === 'Home' ? 0
          : event.key === 'End' ? options.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const target = options[(next + options.length) % options.length]!;
    const list = event.currentTarget;
    if (target.value !== value) onChange(target.value);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
    }
  };
  return <div role="tablist" aria-label={label} className="gtfa-route-grid"
    onKeyDown={disabled ? undefined : walk}>
    {options.map(option => {
      const active = option.value === value;
      return <button key={option.value} type="button" role="tab" aria-label={option.label}
        aria-selected={active} tabIndex={active ? 0 : -1} className="gtfa-route-card"
        disabled={disabled} style={{ ...styles.segment, ...(active ? styles.segmentActive : null) }}
        onClick={() => { if (!active) onChange(option.value); }}>
        <span className="gtfa-route-card-top" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="gtfa-route-icon" style={{ color: active ? 'var(--gtfa-accent)' : 'var(--gtfa-muted)' }}><Icon name={option.icon ?? 'cloud'} size={22} /></span>
          <span className="gtfa-route-radio" aria-hidden="true" />
        </span>
        <span className="gtfa-route-card-body">
          <span className="gtfa-route-title" style={{ fontWeight: 600 }}>{option.label}{option.recommended ? <span className="gtfa-recommended">{option.recommended}</span> : null}</span>
          {option.description ? <span style={{ ...styles.hint, display: 'block', marginTop: 4 }}>{option.description}</span> : null}
        </span>
      </button>;
    })}
  </div>;
}

function Switch({ label, checked, onChange, disabled }: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
    style={{ ...styles.switch, ...(checked ? styles.switchOn : null) }}
    onClick={() => onChange(!checked)}>
    <span style={{ ...styles.switchThumb, ...(checked ? styles.switchThumbOn : null) }} />
  </button>;
}

function Toggle({ label, hint, checked, onChange, disabled }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  return <div className="gtfa-toggle-field">
    <div><span style={{ ...styles.label, marginBottom: 0 }}>{label}</span>
      {hint ? <p style={styles.hint}>{hint}</p> : null}</div>
    <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
  </div>;
}

function SectionHeader({ title, description, icon }: { title: string; description: string; icon?: string }) {
  return <div className="gtfa-section-heading">
    {icon ? <span className="gtfa-section-icon"><Icon name={icon} size={18} /></span> : null}
    <div style={styles.sectionHeader}><h3 style={styles.sectionTitle}>{title}</h3>
      <p style={styles.sectionDescription}>{description}</p></div>
  </div>;
}

export interface ConfigPageProps {
  ctx: ClientContext;
  t: Translate;
  /** Test seam: start from an edited draft for server-render coverage. */
  initialDraft?: Partial<Draft>;
  /** Test seam: start the usage card in a specific state for server-render coverage. */
  initialUsage?: ApifyUsageView;
  /** Test seam: start the Actor list in a specific state for server-render coverage. */
  initialActors?: ApifyActorsView;
  /** Test seam: start the Apify OAuth card in a specific state for server-render coverage. */
  initialOAuth?: ApifyOAuthView;
  /** Test seam for the initially selected advanced panel. */
  initialAdvancedTab?: 'anchors' | 'token' | 'files';
  /** Preview/test seam; the Host settings page keeps Advanced collapsed by default. */
  initialAdvancedOpen?: boolean;
}

/** Settings page. Exported for server-render tests. */
export function ConfigPage({ ctx, t, initialDraft, initialUsage, initialActors, initialOAuth, initialAdvancedTab = 'anchors', initialAdvancedOpen = false }: ConfigPageProps) {
  const form = useMemo(() => ctx.configForms.get<Record<string, unknown>>(ENTRY), [ctx]);
  const describe = useMemo(() => ctx.configForms.describe(), [ctx]);
  const snapshot = useStore(form);
  const described = useStore(describe);
  const namespace = described.view?.namespaces.find(row => row.ns === ENTRY);
  const tokenSet = namespace?.secrets?.some(secret => secret.path.join('.') === 'apifyToken' && secret.set) ?? false;
  const [draft, setDraft] = useState<Draft>(() => ({ ...fromSnapshot(snapshot.value), ...initialDraft }));
  const [baseline, setBaseline] = useState<string>(() => draftKey(fromSnapshot(snapshot.value)));
  const [busy, setBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(initialAdvancedOpen);
  const [advancedTab, setAdvancedTab] = useState<'anchors' | 'token' | 'files'>(initialAdvancedTab);
  const advancedId = useId();
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [usage, setUsage] = useState<ApifyUsageView>(initialUsage ?? { status: 'idle' });
  const [usageRequest, setUsageRequest] = useState({ id: 0, refresh: false });
  const [actors, setActors] = useState<ApifyActorsView>(initialActors ?? { status: 'idle' });
  const [actorsRequest, setActorsRequest] = useState({ id: 0, refresh: false });
  const [actorsRefreshing, setActorsRefreshing] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [updatingActor, setUpdatingActor] = useState(false);
  const [building, setBuilding] = useState(false);
  const [deployTarget, setDeployTarget] = useState<DeployTarget | null>(null);
  const [deployNotice, setDeployNotice] = useState<string | null>(null);
  const deployAbort = useRef<AbortController | null>(null);
  const deployGeneration = useRef(0);
  useEffect(() => () => { deployGeneration.current++; deployAbort.current?.abort(); }, []);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionView | null>(null);
  const testAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { testAbort.current?.abort(); testAbort.current = null; }, []);
  const [oauth, setOauth] = useState<ApifyOAuthView>(initialOAuth ?? { status: 'idle' });
  const [oauthBusy, setOauthBusy] = useState<ApifyOAuthAction | null>(null);
  const [oauthPoll, setOauthPoll] = useState({ id: 0, delay: 0, egress: draft.egress });
  const lastRevision = useRef<number | undefined>(snapshot.revision);
  const oauthBusyRef = useRef(false);
  const oauthConnectedRef = useRef(initialOAuth?.status === 'ready' ? initialOAuth.data.connected : false);
  const oauthKnownRef = useRef(initialOAuth?.status === 'ready');
  const oauthPollGeneration = useRef(0);
  const oauthPollAbort = useRef<AbortController | null>(null);
  const oauthPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intlLocale = useMemo(() => {
    const raw = typeof document !== 'undefined' ? document.documentElement.lang : '';
    const fallback = typeof navigator !== 'undefined' ? navigator.language : 'en';
    return /^zh/i.test(raw || fallback) ? 'zh-CN' : 'en';
  }, []);
  const validation = useMemo(() => validateDraft(draft, t), [draft, t]);
  const dirty = draftKey(draft) !== baseline || Boolean(draft.egressNotice || draft.legacyKeys?.length);
  const blocking = hasBlockingValidation(validation);

  const resetDeployment = useCallback(() => {
    deployGeneration.current++;
    deployAbort.current?.abort();
    deployAbort.current = null;
    setDeploying(false);
    setUpdatingActor(false);
    setBuilding(false);
    setDeployTarget(null);
    setDeployNotice(null);
  }, []);

  useEffect(() => { if (draft.egress !== 'actor-own') resetDeployment(); }, [draft.egress, resetDeployment]);

  const stopOAuthPolling = useCallback(() => {
    oauthPollGeneration.current++;
    if (oauthPollTimer.current !== null) {
      clearTimeout(oauthPollTimer.current);
      oauthPollTimer.current = null;
    }
    oauthPollAbort.current?.abort();
    oauthPollAbort.current = null;
  }, []);

  const applyOAuthView = useCallback((next: ApifyOAuthView) => {
    const wasConnected = oauthConnectedRef.current;
    const wasKnown = oauthKnownRef.current;
    if (next.status === 'ready') { oauthConnectedRef.current = next.data.connected; oauthKnownRef.current = true; }
    setOauth(next);
    if (next.status === 'ready' && next.data.connected !== wasConnected) {
      if (wasKnown) resetDeployment();
      testAbort.current?.abort();
      testAbort.current = null;
      setTesting(false);
      setTestResult(null);
      setUsageRequest(current => ({ id: current.id + 1, refresh: false }));
      if (draft.egress === 'actor-own') {
        if (wasKnown) setActors({ status: 'loading' });
        setActorsRequest(current => ({ id: current.id + 1, refresh: true }));
      }
    }
  }, [draft.egress, resetDeployment]);

  useEffect(() => {
    if (snapshot.status !== 'ready') return;
    if (lastRevision.current === snapshot.revision) return;
    lastRevision.current = snapshot.revision;
    testAbort.current?.abort();
    testAbort.current = null;
    setTesting(false);
    setTestResult(null);
    const next = fromSnapshot(snapshot.value);
    setDraft(next);
    setBaseline(draftKey(next));
    setFailure(null);
  }, [snapshot.status, snapshot.revision, snapshot.value]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (draft.egress === 'local') {
      stopOAuthPolling();
      setOauth(current => current.status === 'idle' ? current : { status: 'idle' });
      setOauthPoll(current => current.egress === 'local'
        ? current
        : { id: current.id + 1, delay: 0, egress: 'local' });
      return;
    }
    const generation = ++oauthPollGeneration.current;
    const controller = new AbortController();
    oauthPollAbort.current = controller;
    let cancelled = false;

    const run = async () => {
      oauthPollTimer.current = null;
      if (cancelled || generation !== oauthPollGeneration.current) return;
      let next: ApifyOAuthView;
      try {
        next = await loadApifyOAuth(controller.signal);
      } catch {
        return;
      }
      if (cancelled || generation !== oauthPollGeneration.current) return;
      applyOAuthView(next);
      if (next.status === 'ready' && next.data.pending) {
        oauthPollTimer.current = setTimeout(() => { void run(); }, 2000);
      } else if (oauthPollAbort.current === controller) {
        oauthPollAbort.current = null;
      }
    };

    const initialDelay = oauthPoll.egress === draft.egress ? oauthPoll.delay : 0;
    if (initialDelay === 0) setOauth({ status: 'loading' });
    oauthPollTimer.current = setTimeout(() => { void run(); }, initialDelay);
    return () => {
      cancelled = true;
      if (oauthPollTimer.current !== null) {
        clearTimeout(oauthPollTimer.current);
        oauthPollTimer.current = null;
      }
      controller.abort();
      if (oauthPollAbort.current === controller) oauthPollAbort.current = null;
    };
  }, [draft.egress, oauthPoll, applyOAuthView, stopOAuthPolling]);

  useEffect(() => {
    if (draft.egress === 'local') {
      setUsage({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setUsage({ status: 'loading' });
    void loadApifyUsage(usageRequest.refresh).then(next => {
      if (!cancelled) setUsage(next);
    });
    return () => { cancelled = true; };
  }, [draft.egress, usageRequest]);

  useEffect(() => {
    if (draft.egress !== 'actor-own') {
      setActors({ status: 'idle' });
      setActorsRefreshing(false);
      return;
    }
    const controller = new AbortController();
    setActors(current => current.status === 'ready' ? current : { status: 'loading' });
    setActorsRefreshing(true);
    void loadApifyActors(actorsRequest.refresh, controller.signal).then(next => {
      if (!controller.signal.aborted) { setActors(next); setActorsRefreshing(false); }
    });
    return () => { controller.abort(); };
  }, [draft.egress, actorsRequest]);

  // Auto-select the first matching Actor only before a deploy chooses one.
  useEffect(() => {
    if (deployTarget || building || actors.status !== 'ready' || actors.actors.length === 0) return;
    setDraft(current => current.actor ? current : { ...current, actor: actors.actors[0]!.id });
  }, [actors, building, deployTarget]);

  // While a deploy build runs, re-list every 15 s until it succeeds.
  useEffect(() => {
    if (!building || !deployTarget) return;
    const timer = setInterval(() => setActorsRequest(current => ({ id: current.id + 1, refresh: true })), 15_000);
    const deadline = setTimeout(() => { setBuilding(false); setDeployNotice(t('actorBuildWatchExpired')); }, 10 * 60_000);
    return () => { clearInterval(timer); clearTimeout(deadline); };
  }, [building, deployTarget]);

  useEffect(() => {
    if (!building) return;
    const resolved = resolveDeployBuild(actors, deployTarget);
    if (resolved.status === 'succeeded' && resolved.actorId) {
      setDraft(current => ({ ...current, actor: resolved.actorId! }));
      setBuilding(false);
      setDeployNotice(null);
      setTestResult(null);
      return;
    }
    if (resolved.status === 'failed') {
      setBuilding(false);
      setDeployNotice(t('deployBuildFailed'));
    }
  }, [building, actors, deployTarget, t]);

  const edit = (patch: Partial<Draft>) => { setTestResult(null); setDraft(current => ({ ...current, ...patch })); };
  const editAnchor = (index: number, patch: Partial<AnchorDraft>) => setDraft(current => ({
    ...current,
    anchors: current.anchors.map((anchor, i) => i === index ? { ...anchor, ...patch } : anchor),
  }));
  const requestUsage = (refresh: boolean) => setUsageRequest(current => ({ id: current.id + 1, refresh }));
  const requestActors = (refresh: boolean) => setActorsRequest(current => ({ id: current.id + 1, refresh }));

  const runOAuthAction = async (action: ApifyOAuthAction, request: () => Promise<ApifyOAuthView>) => {
    if (oauthBusyRef.current) return;
    if (action === 'logout') resetDeployment();
    oauthBusyRef.current = true;
    setOauthBusy(action);
    stopOAuthPolling();
    setOauth({ status: 'loading' });
    try {
      const next = await request();
      applyOAuthView(next);
      if (action === 'start' && next.status === 'ready' && next.data.pending) {
        setOauthPoll(current => ({ id: current.id + 1, delay: 2000, egress: draft.egress }));
      }
    } catch {
      applyOAuthView({ status: 'error', code: 'network' });
    } finally {
      oauthBusyRef.current = false;
      setOauthBusy(null);
    }
  };

  const startOAuth = () => runOAuthAction('start', () => startApifyOAuth());
  const cancelOAuth = () => runOAuthAction('cancel', () => cancelApifyOAuth());
  const logoutOAuth = () => runOAuthAction('logout', () => logoutApifyOAuth());
  const retryOAuth = () => {
    if (oauthBusyRef.current) return;
    stopOAuthPolling();
    setOauth({ status: 'loading' });
    setOauthPoll(current => ({ id: current.id + 1, delay: 0, egress: draft.egress }));
  };

  const addAnchor = () => {
    if (validation.newAnchorTerm || validation.newAnchorDaily) return;
    const term = draft.newAnchor.term.trim();
    const dailySearches = Number(draft.newAnchor.dailySearches);
    if (!term || !Number.isFinite(dailySearches) || dailySearches <= 0) return;
    edit({
      baselineOverride: true,
      anchors: [...draft.anchors, { ...draft.newAnchor, term, dailySearches: String(dailySearches) }],
      newAnchor: blankAnchor(draft.geo),
    });
    setFailure(null);
  };

  const discard = () => {
    resetDeployment();
    const next = fromSnapshot(snapshot.value);
    setDraft(next);
    setBaseline(draftKey(next));
    setFailure(null);
    setNotice(null);
    setTestResult(null);
  };

  const save = async () => {
    if (draft.egress === 'actor-own' && (deploying || building)) return;
    setFailure(null);
    setNotice(null);
    if (blocking) {
      setFailure(validation.snapshotDir ?? validation.chartDir ?? validation.anchorRows[0] ?? validation.newAnchorTerm ?? validation.newAnchorDaily ?? validation.baselines ?? validation.window ?? t('failed'));
      return;
    }
    const toSave = withPendingAnchor(draft);
    let ops: PathOp[] | string;
    try { ops = opsFor(toSave, t); }
    catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return;
    }
    if (typeof ops === 'string') { setFailure(ops); return; }
    const savedEgress = resolveEgress(snapshot.value?.egress).egress;
    const tokenChanged = Boolean(draft.token.trim() || draft.clearToken);
    const egressChanged = draft.egress !== savedEgress;
    setBusy(true);
    try {
      const accepted = await form.mutate(ops, snapshot.revision);
      if (!accepted) setFailure(t('failed'));
      else {
        const cleaned: Draft = {
          ...toSave, token: '', clearToken: false, newAnchor: blankAnchor(toSave.geo),
          egressNotice: undefined, legacyKeys: undefined,
        };
        setDraft(cleaned);
        setBaseline(draftKey(cleaned));
        setNotice(t('saved'));
        if (draft.egress !== 'local' && (tokenChanged || egressChanged)) {
          requestUsage(false);
          if (draft.egress === 'actor-own') requestActors(true);
        }
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (testAbort.current) return;
    const controller = new AbortController();
    testAbort.current = controller;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await runConnectionTest({
        egress: draft.egress,
        ...(draft.egress === 'actor-own' ? { apifyActor: draft.actor.trim() } : {}),
        ...(draft.egress !== 'local' && (draft.token.trim() || draft.clearToken)
          ? { apifyToken: draft.clearToken ? '' : draft.token.trim() } : {}),
      }, controller.signal);
      if (testAbort.current === controller) setTestResult(result);
    } finally {
      if (testAbort.current === controller) { testAbort.current = null; setTesting(false); }
    }
  };

  const deploy = async (update = false) => {
    if (deployAbort.current || building) return;
    const controller = new AbortController();
    const generation = ++deployGeneration.current;
    deployAbort.current = controller;
    testAbort.current?.abort();
    testAbort.current = null;
    setTesting(false);
    setTestResult(null);
    setDeploying(true);
    setUpdatingActor(update);
    setDeployTarget(null);
    setDeployNotice(null);
    try {
      const result = await deployApifyActor(controller.signal, update ? { actorId: draft.actor,
        ...(draft.token.trim() || draft.clearToken ? { apifyToken: draft.clearToken ? '' : draft.token.trim() } : {}) } : undefined);
      if (controller.signal.aborted || generation !== deployGeneration.current) return;
      if (result.ok) {
        setDeployTarget({ actorId: result.actorId, buildId: result.buildId });
        setBuilding(true);
        requestActors(true);
      } else if (result.code === 'exists') {
        setDeployNotice(t('deployExists'));
        requestActors(true);
      } else if (result.code === 'no-token') {
        setDeployNotice(t('testNoToken'));
      } else if (result.code === 'invalid-token') {
        setDeployNotice(t('testInvalidToken'));
      } else if (result.code === 'unsupported-source') {
        setDeployNotice(t('actorUpdateSource'));
      } else {
        setDeployNotice(t('deployFailed'));
      }
    } finally {
      if (deployAbort.current === controller) {
        deployAbort.current = null;
        setDeploying(false);
      }
    }
  };

  const anchorTerms = useMemo(() => {
    const seen = new Set<string>(), terms: string[] = [];
    for (const term of [
      ...catalogForGeo(draft.geo).map(anchor => anchor.term),
      ...draft.anchors.map(anchor => anchor.term),
      draft.anchor,
      draft.windowShort,
      draft.windowLong,
    ]) {
      const trimmed = term.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) continue;
      seen.add(key);
      terms.push(trimmed);
    }
    return terms;
  }, [draft.geo, draft.anchors, draft.anchor, draft.windowShort, draft.windowLong]);

  const anchorOptions = useMemo(() =>
    anchorTerms.map(term => ({ value: term, label: term,
      description: automaticAnchorFor('now 1-d', draft.geo) === term && automaticAnchorFor('now 7-d', draft.geo) === term
        ? t('anchorRegionalOption') : term.toLowerCase() === 'sudoku' ? t('anchorShortOption') : term.toLowerCase() === 'gpts' ? t('anchorLongOption') : undefined,
    })), [anchorTerms, draft.geo, t]);
  const fixedAnchorOptions = useMemo(() => [
    { value: '', label: t('anchorAutomatic'), description: t('anchorAutoOption'), badge: t('recommended') },
    ...anchorOptions,
    ...mekaAnchorsFor(draft.geo)
      .filter(anchor => !anchorTerms.some(term => term.toLowerCase() === anchor.term.toLowerCase()))
      .map(anchor => ({ value: anchor.term, label: anchor.term, ...(anchor.dailyOnly ? { description: t('baselineDailyWindow') } : {}) })),
  ], [anchorOptions, anchorTerms, draft.geo, t]);
  const regionalAnchor = mekaDefaultAnchor(draft.geo)?.term;
  const defaultWindowLabel = regionalAnchor ? `${t('windowDefault')} · ${regionalAnchor}` : t('windowDefault');
  const shortWindowOptions = useMemo(() =>
    [{ value: '', label: defaultWindowLabel }, ...anchorOptions], [anchorOptions, defaultWindowLabel]);
  const longWindowOptions = useMemo(() =>
    [{ value: '', label: defaultWindowLabel }, ...anchorOptions], [anchorOptions, defaultWindowLabel]);
  const geoOptions = useMemo(() => {
    const options = [
      { value: '', label: t('geoWorldwide'), search: 'world worldwide global 全球' },
      ...GEO_CODES.filter(Boolean).map(code => ({ value: code, label: regionLabel(code, intlLocale),
        search: `${regionLabel(code, 'en')} ${regionLabel(code, 'zh-CN')}` }))
        .sort((a, b) => a.label.localeCompare(b.label, intlLocale)),
    ];
    if (draft.geo && !GEO_SET.has(draft.geo)) {
      options.push({ value: draft.geo, label: regionLabel(draft.geo, intlLocale) || draft.geo, search: draft.geo });
    }
    return options;
  }, [draft.geo, intlLocale, t]);
  const toleranceOptions = useMemo(() =>
    [{ value: '', label: t('toleranceDefault') }, ...TOLERANCE_OPTIONS.map(option => ({ value: option.value, label: t(option.label) }))], [t]);
  // A stored value outside the presets stays selectable so saving other settings never rewrites it.
  const toleranceChoices = (current: string) => current === '' || toleranceOptions.some(option => option.value === current)
    ? toleranceOptions
    : [...toleranceOptions, { value: current, label: `±${Math.round(Number(current) * 100)}%` }];
  const anchorGeoOptions = geoOptions;

  if (snapshot.status === 'loading') return <p style={styles.status}>{t('loading')}</p>;
  if (snapshot.status === 'unavailable') return <p style={styles.status}>{t('unavailable')}</p>;
  const editable = snapshot.writable && !busy && !testing;
  const preparingActor = draft.egress === 'actor-own' && (deploying || building);
  const canSave = editable && dirty && !blocking && !preparingActor;
  const newAnchorReady = Boolean(draft.newAnchor.term.trim()) && isPositiveNumber(draft.newAnchor.dailySearches) && !validation.newAnchorTerm && !validation.newAnchorDaily;
  const line = testResult ? testLine(testResult, t) : null;
  const actorEgress = draft.egress !== 'local';
  const ownEgress = draft.egress === 'actor-own';

  const oauthConnected = oauth.status === 'ready' && oauth.data.connected;
  const activeAdvancedTab = advancedTab === 'token' && !actorEgress ? 'anchors' : advancedTab;
  const advancedTabs = [
    { id: 'anchors' as const, label: t('advancedAnchors') },
    ...(actorEgress ? [{ id: 'token' as const, label: t('advancedToken') }] : []),
    { id: 'files' as const, label: t('advancedFiles') },
  ];
  const tokenConflict = actorEgress && Boolean(draft.token.trim() && draft.clearToken);
  const testButton = <><button type="button" className="gtfa-button" style={dim(styles.button, !editable || tokenConflict || preparingActor)}
    disabled={!editable || tokenConflict || preparingActor} title={tokenConflict ? t('tokenConflict') : preparingActor ? t('actorBuildingHint') : t('testNote')} onClick={() => { void test(); }}>
    <Icon name="play" size={13} />{testing ? t('testing') : t('testConnection')}
  </button>{testing ? <button type="button" className="gtfa-button" style={styles.button} onClick={() => testAbort.current?.abort()}>{t('testCancel')}</button> : null}</>;
  const walkAdvanced = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = advancedTabs.findIndex(tab => tab.id === activeAdvancedTab);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? advancedTabs.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setAdvancedTab(advancedTabs[(next + advancedTabs.length) % advancedTabs.length]!.id);
    const list = event.currentTarget;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() =>
      list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };
  const openInvalidPanel = () => {
    setAdvancedOpen(true);
    setAdvancedTab(validation.snapshotDir || validation.chartDir ? 'files' : 'anchors');
  };
  const openManualToken = () => {
    setAdvancedOpen(true);
    setAdvancedTab('token');
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
      document.getElementById(`${advancedId}-token-panel`)?.querySelector<HTMLInputElement>('input')?.focus();
    });
  };

  return <form className="gtfa-settings" style={styles.page} onSubmit={event => { event.preventDefault(); void save(); }}>
    <style dangerouslySetInnerHTML={{ __html: SETTINGS_CSS }} />
    <section className="gtfa-section" style={styles.section}>
      <SectionHeader icon="plug" title={t('connection')} description={t('connectionDescription')} />
      <Segmented label={t('egress')} value={draft.egress} disabled={!editable}
        options={[
          { value: 'local', label: t('egressLocal'), description: t('routeLocalDescription'), icon: 'laptop' },
          { value: 'actor-public', label: t('egressPublic'), description: t('routePublicDescription'), icon: 'cloud', recommended: t('recommended') },
          { value: 'actor-own', label: t('egressOwn'), description: t('routeOwnDescription'), icon: 'server' },
        ]}
        onChange={value => { if (value !== 'actor-own') resetDeployment(); edit({ egress: value, egressNotice: undefined }); setTestResult(null); }} />
      {draft.egressNotice ? <p style={styles.warning} role="status">
        {t(draft.egressNotice === 'renamed' ? 'egressRenamed' : 'egressUnknown')}
      </p> : null}
      <div className="gtfa-connection-panel" style={styles.connectionPanel}>
        {actorEgress ? <>
          <ApifyOAuthCard state={oauth} t={t} locale={intlLocale} busy={oauthBusy}
            signInLabel={ownEgress ? t('actorLoginAction') : undefined}
            connectionAction={testButton} connectionDescription={t(ownEgress ? 'oauthActiveOwn' : 'oauthActivePublic')}
            onStart={() => { void startOAuth(); }} onCancel={() => { void cancelOAuth(); }}
            onLogout={() => { void logoutOAuth(); }} onRetry={retryOAuth} />
          {!oauthConnected && (tokenSet || usage.status === 'ready' || draft.token.trim()) ? <div style={{ padding: '0 18px 14px' }}>{testButton}</div> : null}
          {usage.status === 'error' && usage.code === 'no-token' && !oauthConnected ? null :
            <ApifyUsageCard state={usage} t={t} locale={intlLocale}
              onRefresh={() => requestUsage(true)} onRetry={() => requestUsage(true)} refreshing={busy} />}
          {ownEgress ? <ActorSelection state={actors} value={draft.actor} t={t} disabled={!editable || oauthBusy !== null}
            pending={oauth.status === 'ready' && oauth.data.pending}
            refreshing={actorsRefreshing} deployment={deploying ? 'creating' : building ? 'building' : null} updating={updatingActor} notice={deployNotice}
            onChange={value => edit({ actor: value })} onRefresh={() => requestActors(true)}
            onManual={openManualToken} onDeploy={() => { void deploy(); }} onUpdate={() => { void deploy(true); }} /> : null}
          {usage.status === 'error' && usage.code === 'no-token' && !oauthConnected ? <ApifySignupBar t={t} locale={intlLocale} /> : null}
        </> : <div className="gtfa-connection-top">
          <span className="gtfa-status-icon neutral"><Icon name="laptop" size={18} /></span>
          <div className="gtfa-connection-copy"><div className="gtfa-connection-title">{t('localNetwork')}
            <span style={{ ...styles.pill, color: line?.ok ? 'var(--gtfa-green)' : 'var(--gtfa-muted)', background: line?.ok ? 'var(--gtfa-green-soft)' : 'var(--gtfa-hover)' }}>
              {testing ? t('testing') : line?.ok ? t('connectionReady') : testResult?.code === 'host-restart-required' ? t('connectionHostRestart') : testResult?.network?.ok ? t('connectionNetworkOnly') : testResult ? t('connectionFailed') : t('connectionUntested')}
            </span></div><p className="gtfa-connection-subtitle">{t('localNetworkHint')}</p></div>
          <div className="gtfa-connection-actions">{testButton}</div>
        </div>}
      </div>
      <p className="gtfa-test-help">{t('testNote')}{actorEgress ? <span>{t('connectionCostShort')}</span> : null}</p>
      {testing || testResult ? <ConnectionTestResults result={testResult ?? undefined} testing={testing} t={t} locale={intlLocale} /> : null}
      {actorEgress ? <>
        <p className="gtfa-privacy-note"><Icon name="shield" size={13} />{t('connectionPrivacy')}</p>
        {!ownEgress ? <details className="gtfa-public-details" style={styles.hint}><summary style={{ cursor: 'pointer', width: 'fit-content' }}>{t('publicActorDetails')} · {GTFA_PUBLIC_ACTOR_LABEL}</summary>
          <Field label={t('publicActor')} hint={t('publicActorHint')}>
            <span style={styles.readOnlyTerm}>Actor: {GTFA_PUBLIC_ACTOR_LABEL}</span>
            <p style={styles.hint}><a style={styles.signupPrimary} href={GTFA_SOURCE_URL} target="_blank" rel="noopener noreferrer">{t('viewSource')}</a> · <a style={styles.signupPrimary} href={GTFA_STORE_URL} target="_blank" rel="noopener noreferrer">{t('storePage')}</a></p>
            <p style={styles.hint}>{t('publicActorCost')}</p>
          </Field>
        </details> : null}
      </> : null}
    </section>

    <section className="gtfa-section" style={styles.section}>
      <SectionHeader icon="sliders" title={t('defaults')} description={t('defaultsDescription')} />
      <div className="gtfa-defaults-grid">
        <ChoicePicker label={t('geo')} hint={t(regionalAnchor ? 'geoBaselineHint' : 'geoHint')} icon="globe" placeholder={t('geoSearch')} emptyText={t('choiceEmpty')} value={draft.geo} disabled={!editable}
          options={geoOptions} onChange={value => edit({ geo: value,
            ...(!draft.newAnchor.term.trim() && !draft.newAnchor.dailySearches.trim() && draft.newAnchor.geo === draft.geo
              ? { newAnchor: { ...draft.newAnchor, geo: value } } : {}),
          })} />
        <ChoicePicker label={t('anchor')} hint={t('anchorHint')} icon="sliders" placeholder={t('anchorSearch')} emptyText={t('choiceEmpty')} value={draft.anchor} disabled={!editable}
          options={fixedAnchorOptions} onChange={value => edit({ anchor: value })} />
      </div>
      <p style={{ ...styles.hint, margin: 0 }}><a href="https://meka.im/datasets/google-trends-anchors" target="_blank" rel="noopener noreferrer">{t('baselineSources')}</a></p>
      <Toggle label={t('cache')} hint={t('cacheHint')} checked={draft.cache} disabled={!editable}
        onChange={checked => edit({ cache: checked })} />
    </section>

    <details className="gtfa-advanced" open={advancedOpen}
      onToggle={event => { if (event.target === event.currentTarget) setAdvancedOpen(event.currentTarget.open); }}>
      <summary style={styles.summary}>
        <span className="gtfa-section-icon"><Icon name="sliders" size={18} /></span>
        <span style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{t('advanced')}</span>
          <span style={styles.sectionDescription}>{t('advancedDescription')}</span></span>
        <span className="gtfa-advanced-chevron" style={{ marginLeft: 'auto', color: 'var(--gtfa-quiet)' }}><Icon name="chevron" size={15} /></span>
      </summary>
      <div role="tablist" aria-label={t('advanced')} className="gtfa-advanced-tabs" onKeyDown={walkAdvanced}>
        {advancedTabs.map(tab => <button key={tab.id} type="button" role="tab" id={`${advancedId}-${tab.id}-tab`}
          aria-selected={activeAdvancedTab === tab.id} aria-controls={`${advancedId}-${tab.id}-panel`}
          tabIndex={activeAdvancedTab === tab.id ? 0 : -1} onClick={() => setAdvancedTab(tab.id)}>{tab.label}</button>)}
      </div>
      <div role="tabpanel" id={`${advancedId}-anchors-panel`} aria-labelledby={`${advancedId}-anchors-tab`}
        className="gtfa-advanced-panel" hidden={activeAdvancedTab !== 'anchors'} style={{ paddingBottom: 24 }}>
        <div className="gtfa-baseline-heading">
          <SectionHeader icon="sliders" title={t('baselines')}
            description={t(draft.baselineOverride ? 'baselinesDescription' : 'baselinesHint')} />
          <div className="gtfa-baseline-toggle"><span>{t('overrideBaselines')}</span>
            <Switch label={t('overrideBaselines')} checked={draft.baselineOverride} disabled={!editable}
              onChange={checked => edit(setBaselineOverride(draft, checked))} /></div>
        </div>
        <BaselineCatalog t={t} locale={intlLocale} />
        {validation.baselines ? <p style={styles.fieldError} role="alert">{validation.baselines}</p> : null}
        {draft.baselineOverride ? <>
          <h4 className="gtfa-custom-baseline-title">{t('baselineCustomRows')}</h4>
          <div className="gtfa-baseline-editor">
            <div className="gtfa-anchor-head gtfa-anchor-grid" aria-hidden="true">
              <span>{t('anchorTerm')}</span><span>{t('anchorGeo')}</span><span>{t('anchorDaily')}</span><span>{t('anchorTolerance')}</span><span />
            </div>
            {draft.anchors.map((anchor, index) => <div className="gtfa-anchor-block" key={`${anchor.term}-${index}`}>
              <div className="gtfa-anchor-row gtfa-anchor-grid">
                <AnchorCell label={t('anchorTerm')}><span className="gtfa-anchor-term" title={anchor.term}>{anchor.term}</span></AnchorCell>
                <AnchorCell label={t('anchorGeo')}>
                  <ChoicePicker compact hideLabel label={`${t('anchorGeo')} ${anchor.term}`} placeholder={t('geoSearch')} emptyText={t('choiceEmpty')}
                    value={anchor.geo} disabled={!editable} options={anchorGeoOptions}
                    onChange={value => editAnchor(index, { geo: value })} /></AnchorCell>
                <AnchorCell label={t('anchorDaily')}>
                <input className="gtfa-anchor-input number" type="number" min={1} step={1} aria-label={`${t('anchorDaily')} ${anchor.term}`}
                  aria-invalid={Boolean(validation.anchorRows[index])}
                  value={anchor.dailySearches} disabled={!editable}
                  onChange={event => editAnchor(index, { dailySearches: event.target.value })} /></AnchorCell>
                <AnchorCell label={t('anchorTolerance')}>
                  <ChoicePicker compact hideLabel searchable={false} label={`${t('anchorTolerance')} ${anchor.term}`}
                    placeholder={t('anchorTolerance')} emptyText={t('choiceEmpty')} value={anchor.tolerance} disabled={!editable}
                    options={toleranceChoices(anchor.tolerance)} onChange={value => editAnchor(index, { tolerance: value })} /></AnchorCell>
                <button type="button" className="gtfa-anchor-action remove" disabled={!editable}
                  aria-label={`${t('remove')} ${anchor.term}`} title={`${t('remove')} ${anchor.term}`}
                  onClick={() => edit({ anchors: draft.anchors.filter((_, i) => i !== index) })}><Icon name="trash" size={16} /></button>
              </div>
              {validation.anchorRows[index] ? <p style={styles.fieldError} role="alert">{validation.anchorRows[index]}</p> : null}
            </div>)}
            <div className="gtfa-anchor-block gtfa-anchor-new">
              <div className="gtfa-anchor-row gtfa-anchor-grid">
                <AnchorCell label={t('anchorTerm')}>
                <input className="gtfa-anchor-input" type="text" aria-label={t('newAnchorTerm')} placeholder={t('newAnchorTerm')}
                  aria-invalid={Boolean(validation.newAnchorTerm)}
                  value={draft.newAnchor.term} disabled={!editable}
                  onChange={event => edit({ newAnchor: { ...draft.newAnchor, term: event.target.value } })} /></AnchorCell>
                <AnchorCell label={t('anchorGeo')}>
                  <ChoicePicker compact hideLabel label={`${t('anchorGeo')} ${t('newAnchorTerm')}`} placeholder={t('geoSearch')} emptyText={t('choiceEmpty')}
                    value={draft.newAnchor.geo} disabled={!editable} options={anchorGeoOptions}
                    onChange={value => edit({ newAnchor: { ...draft.newAnchor, geo: value } })} /></AnchorCell>
                <AnchorCell label={t('anchorDaily')}>
                <input className="gtfa-anchor-input number" type="number" min={1} step={1} aria-label={`${t('anchorDaily')} ${t('newAnchorTerm')}`}
                  aria-invalid={Boolean(validation.newAnchorDaily)}
                  value={draft.newAnchor.dailySearches} disabled={!editable}
                  onChange={event => edit({ newAnchor: { ...draft.newAnchor, dailySearches: event.target.value } })} /></AnchorCell>
                <AnchorCell label={t('anchorTolerance')}>
                  <ChoicePicker compact hideLabel searchable={false} label={`${t('anchorTolerance')} ${t('newAnchorTerm')}`}
                    placeholder={t('anchorTolerance')} emptyText={t('choiceEmpty')} value={draft.newAnchor.tolerance} disabled={!editable}
                    options={toleranceChoices(draft.newAnchor.tolerance)} onChange={value => edit({ newAnchor: { ...draft.newAnchor, tolerance: value } })} /></AnchorCell>
                <button type="button" className="gtfa-anchor-action add" disabled={!editable || !newAnchorReady}
                  aria-label={t('addAnchor')} title={t('addAnchor')} onClick={addAnchor}><Icon name="plus" size={17} /></button>
              </div>
              {validation.newAnchorTerm ? <p style={styles.fieldError} role="alert">{validation.newAnchorTerm}</p> : null}
              {validation.newAnchorDaily ? <p style={styles.fieldError} role="alert">{validation.newAnchorDaily}</p> : null}
            </div>
          </div>
          <div className="gtfa-window-grid">
            <ChoicePicker label={t('windowShort')} hint={t('windowShortHint')} icon="clock" value={draft.windowShort} disabled={!editable}
              placeholder={t('anchorSearch')} emptyText={t('choiceEmpty')} options={shortWindowOptions}
              onChange={value => edit({ windowShort: value })} />
            <ChoicePicker label={t('windowLong')} hint={t('windowLongHint')} icon="clock" value={draft.windowLong} disabled={!editable}
              placeholder={t('anchorSearch')} emptyText={t('choiceEmpty')} options={longWindowOptions}
              onChange={value => edit({ windowLong: value })} />
          </div>
          {validation.window ? <p style={styles.fieldError} role="alert">{validation.window}</p> : null}
        </> : null}
      </div>
      {actorEgress ? <div role="tabpanel" id={`${advancedId}-token-panel`} aria-labelledby={`${advancedId}-token-tab`}
        className="gtfa-advanced-panel" hidden={activeAdvancedTab !== 'token'} style={{ paddingBottom: 24 }}>
        <SectionHeader title={t('manualTokenSummary')} description={t('manualTokenDescription')} />
        <Field label={t('token')} hint={t('tokenHint')}>
          <input style={styles.input} type="password" aria-label={t('token')} autoComplete="new-password" value={draft.token} disabled={!editable}
            placeholder={tokenSet ? t('tokenStored') : t('tokenEmpty')}
            onChange={event => edit({ token: event.target.value })} />
          <p style={styles.hint}>{tokenSet
            ? t('tokenStateSet')
            : usage.status === 'ready' && usage.data.source === 'env' ? t('tokenStateEnv') : t('tokenStateUnset')}</p>
          {validation.tokenWarning ? <p style={styles.warning}>{validation.tokenWarning}</p> : null}
          {tokenSet ? <div style={styles.switchRow}>
            <span>{t('clearToken')}</span>
            <Switch label={t('clearToken')} checked={draft.clearToken} disabled={!editable}
              onChange={checked => edit({ clearToken: checked })} />
          </div> : null}
        </Field>
      </div> : null}
      <div role="tabpanel" id={`${advancedId}-files-panel`} aria-labelledby={`${advancedId}-files-tab`}
        className="gtfa-advanced-panel" hidden={activeAdvancedTab !== 'files'} style={{ paddingBottom: 24 }}>
        <Toggle label={t('charts')} hint={t('chartsHint')} checked={draft.charts} disabled={!editable}
          onChange={checked => edit({ charts: checked })} />
        <Field label={t('snapshotDir')} hint={t('snapshotDirHint')}>
          <input style={styles.input} type="text" aria-label={t('snapshotDir')} value={draft.snapshotDir} disabled={!editable}
            aria-invalid={Boolean(validation.snapshotDir)}
            onChange={event => edit({ snapshotDir: event.target.value })} />
          {validation.snapshotDir ? <p style={styles.fieldError} role="alert">{validation.snapshotDir}</p> : null}
        </Field>
        <Field label={t('chartDir')} hint={t('chartDirHint')}>
          <input style={styles.input} type="text" aria-label={t('chartDir')} value={draft.chartDir} disabled={!editable || !draft.charts}
            aria-invalid={Boolean(validation.chartDir)}
            onChange={event => edit({ chartDir: event.target.value })} />
          {validation.chartDir ? <p style={styles.fieldError} role="alert">{validation.chartDir}</p> : null}
        </Field>
      </div>
    </details>

    <div className="gtfa-save-bar" style={styles.saveBar}>
      <span className={`gtfa-save-state${dirty ? ' dirty' : ''}`} role="status" aria-live="polite">
        {dirty ? <span aria-hidden="true">●</span> : <Icon name="check" size={12} />}
        {dirty ? t('unsaved') : notice ?? t('allSaved')}
      </span>
      <button type="button" className="gtfa-button" style={dim(styles.button, !editable || !dirty)} disabled={!editable || !dirty} onClick={discard}>{t('discard')}</button>
      <button type="submit" className="gtfa-button" style={dim({ ...styles.button, ...styles.primary }, !canSave)} disabled={!canSave}>
        {busy ? t('saving') : t('save')}
      </button>
      {blocking ? <button type="button" style={{ ...styles.buttonSmall, color: 'var(--dsw-alias-state-error-primary, #c55151)', flexBasis: '100%' }}
        onClick={openInvalidPanel}>{t('advancedFix')}</button> : null}
      {failure ? <p style={{ ...styles.error, flexBasis: '100%' }} role="alert">{failure}</p> : null}
      {!snapshot.writable ? <p style={styles.hint}>{t('readOnly')}</p> : null}
    </div>
  </form>;
}

function ConfigView({ ctx, t, view }: { ctx: ClientContext; t: Translate; view: 'summary' | 'page' }) {
  return view === 'page' ? <ConfigPage ctx={ctx} t={t} /> : <>{t('summary')}</>;
}

/** Register the row configuration page while the Plugins page declares its slot. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en: { ...EN, ...DASHBOARD_EN }, zh: { ...ZH, ...DASHBOARD_ZH } }), 'gtfa: dictionaries');
  const t = ctx.locale.bind(NS);
  const dashboard = new DashboardController();
  ctx.effect(() => () => dashboard.dispose(), 'gtfa: dashboard query lifecycle');
  ctx.effect(() => {
    ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
      name: 'plugins.row.config',
      key: `${PACKAGE}#${ENTRY}`,
      locale: NS,
    }, (props: PluginConfigViewProps) => <ConfigView ctx={ctx} t={t} view={props.view} />));
  }, 'gtfa: row configuration page');
  ctx.effect(() => {
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'google-trends', locale: NS },
      () => <Dashboard t={t} controller={dashboard} openSettings={() => {
        const navigation = ctx.get?.('pluginNavigation') as { openBundle?: (name: string) => void } | undefined;
        navigation?.openBundle?.(PACKAGE);
      }} />));
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'google-trends', order: 25, label: () => t('dashboardTitle'), locale: NS },
      (props: { size?: number }) => <TrendsMark size={props.size ?? 20} />));
  }, 'gtfa: dashboard and sidebar');
}
