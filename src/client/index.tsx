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
 * with relative URLs. The token and all Apify/Google traffic stay on the Host;
 * the browser only receives usage numbers and reachability results.
 *
 * Every setting that has a finite set of values is a select, segmented control,
 * or switch. Only the token, a new anchor term, dailySearches, and directories
 * are typed inputs.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import {
  APIFY_EST_COST_PER_CALL_USD, APIFY_FREE_MONTHLY_CREDIT_USD, APIFY_PRICING_URL, APIFY_SIGNUP_URL,
  BUILTIN_ANCHOR_TERMS, DEFAULT_GEO, GEO_CODES, apifyEstimatedCalls, regionLabel,
} from '../options.js';

/** Cordis service name used by the client bundle. */
export const inject = ['slots', 'locale', 'configForms'];

const NS = 'gtfa';
const PACKAGE = 'google-trends-for-agent';
const ENTRY = 'gtfa';
const USAGE_URL = 'api/gtfa.apify-usage';
const ACTORS_URL = 'api/gtfa.apify-actors';
const DEPLOY_URL = 'api/gtfa.apify-deploy';
const TEST_URL = 'api/gtfa.test-connection';
const DEPLOY_MANUAL_URL = 'https://github.com/meka-im/google-trends-for-agent#deploy-to-apify';

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
  register(options: Record<string, unknown>, component: (props: PluginConfigViewProps) => ReactNode): unknown;
}

interface ClientContext {
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
  egress: 'local' | 'apify';
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
  /** Where the Host found the token: saved settings or the APIFY_TOKEN environment variable. */
  source: 'config' | 'env' | null;
}

export type ApifyUsageView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: 'no-token' | 'invalid-token' | 'network' | 'http'; httpStatus?: number }
  | { status: 'ready'; data: ApifyUsageData };

export interface TestConnectionView {
  ok: boolean;
  egress: 'local' | 'apify';
  status: number | null;
  latencyMs: number;
  code?: 'no-token' | 'no-actor' | 'invalid-token' | 'network' | 'http' | 'busy';
  message?: string;
  actorId?: string;
}

export interface ApifyActorView {
  id: string;
  name: string;
  username: string | null;
  title: string | null;
  standbyUrl: string | null;
  standbyEnabled: boolean;
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

export const EN: Record<string, string> = {
  summary: 'Configure egress, the Apify token and Actor, usage, default geo, anchors, and snapshot cache.',
  intro: 'Changes apply live, no restart needed. Usage, Actor listing, deploy, and Test connection run on the dsh host, so the token never reaches the browser.',
  connection: 'Connection',
  connectionDescription: 'Where Google Trends requests leave from, plus a one-click reachability check.',
  egress: 'Egress',
  egressHint: 'Local: requests leave from the machine running dsh. Apify: requests go through your own google-trends-for-agent Actor, which uses its on-platform residential proxy (works on the Free plan).',
  egressLocal: 'Local (this machine)',
  egressApify: 'Apify Actor',
  testConnection: 'Test connection',
  testing: 'Testing…',
  testSavedNote: 'Tests the saved settings — save first.',
  testLocalOk: 'Google Trends reachable ({status}, {ms} ms)',
  testApifyOk: 'Apify Actor OK — HTTP {status}, {ms} ms',
  testNoToken: 'Add an Apify token (or set APIFY_TOKEN) to use apify egress.',
  testNoActor: 'Select or deploy your google-trends-for-agent Actor first.',
  testInvalidToken: 'Apify rejected the token. Check it in Apify Console → Settings → API & Integrations.',
  testNetworkLocal: 'Could not reach Google Trends from this machine.',
  testDetail: ' Details: {detail}',
  testNetworkApify: 'Could not reach your Apify Actor (or it returned no Standby response).',
  testHttp: 'Target returned HTTP {status}.',
  testBusy: 'A test is already running. Try again in a moment.',
  apify: 'Apify',
  apifyDescription: 'Token, your Actor, and this cycle\'s Apify usage.',
  usageTitle: 'Apify usage',
  usageLoading: 'Loading Apify usage…',
  usageNoToken: 'Add an Apify token (or set APIFY_TOKEN) to see usage.',
  usageInvalidToken: 'Apify rejected the token (401). Check it in Apify Console → Settings → API & Integrations.',
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
  signupBar: 'No Apify account? Sign up free — the Free plan\'s {free} monthly credit is enough for this plugin (roughly {calls} calls a month at about ${cost} per call, estimated).',
  signupAction: 'Sign up →',
  pricingAction: 'Pricing',
  token: 'Apify token',
  tokenHint: 'Leave blank to keep the current token or use APIFY_TOKEN. A saved token is written to the profile\'s cordis.patch.yml (mode 0600).',
  tokenPrefixWarning: 'Apify API tokens usually start with apify_api_. Double-check this one.',
  tokenStored: 'A token is stored. Type a new one to replace it.',
  tokenEmpty: 'No token stored.',
  clearToken: 'Clear the stored token',
  actor: 'Actor',
  actorHint: 'Your google-trends-for-agent Actor. It fetches Google Trends with its on-platform residential proxy and exits after 60 s idle.',
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
  deployBuilding: 'Building… (about 2–4 min)',
  deployExists: 'That Actor already exists. Refresh the list and select it.',
  deployFailed: 'Deploy failed. Try again or deploy manually.',
  deployBuildFailed: 'The build failed. Check the build log in Apify Console.',
  defaults: 'Defaults',
  defaultsDescription: 'Defaults applied when a tool call omits them.',
  geo: 'Default geo',
  geoHint: 'Used when a tool call omits geo. Worldwide has no built-in calibration, so traffic is null.',
  geoWorldwide: 'Worldwide',
  anchor: 'Fixed anchor',
  anchorHint: 'Automatic uses sudoku for ≤1 day and gpts for 7 days and longer.',
  anchorAutomatic: 'Automatic (sudoku for ≤1 day, gpts for 7 days+)',
  cache: 'Reuse saved snapshots',
  cacheHint: 'On reuses snapshots up to 360 minutes old. Off always fetches fresh data.',
  baselines: 'Anchors & baselines',
  baselinesDescription: 'Override the built-in calibration anchors or add your own.',
  baselinesHint: 'Same format and validation as a version 2 baselines.json. Empty keeps the built-in US anchors.',
  overrideBaselines: 'Override or add anchors',
  anchorTerm: 'Term',
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
  windowHint: 'Optional. Short covers now 1-H, now 4-H, and now 1-d; long covers now 7-d and longer. Each term must be in the anchors list or the built-in anchors.',
  advanced: 'Advanced',
  advancedDescription: 'File locations and chart output.',
  snapshotDir: 'Snapshot directory',
  snapshotDirHint: 'Where snapshots are stored, resolved against the dsh process working directory.',
  chartDir: 'Chart directory',
  chartDirHint: 'Where SVG charts are written when chart files are on.',
  charts: 'Write chart files',
  chartsHint: 'Turning this off disables SVG chart files; the tool still returns chart paths as null.',
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
  summary: '配置出口、Apify Token 与 Actor、用量、默认地区、基线和快照缓存。',
  intro: '修改即时生效，无需重启。用量、Actor 列表、部署和测试连接都在 dsh 主机端运行，Apify Token 不会发送到浏览器。',
  connection: '连接',
  connectionDescription: 'Google Trends 请求的出口，以及一键连通性检查。',
  egress: '出口',
  egressHint: '本机直连：请求从运行 dsh 的机器发出；Apify：请求经你自己的 google-trends-for-agent Actor 转发，使用平台内住宅代理（免费版可用）。',
  egressLocal: '本机直连',
  egressApify: 'Apify Actor',
  testConnection: '测试连接',
  testing: '测试中…',
  testSavedNote: '测试的是已保存设置 — 请先保存。',
  testLocalOk: 'Google Trends 可访问（{status}，{ms} ms）',
  testApifyOk: 'Apify Actor 正常 — HTTP {status}，{ms} ms',
  testNoToken: '添加 Apify Token（或设置 APIFY_TOKEN）后可使用 Apify 出口。',
  testNoActor: '请先选择或部署你的 google-trends-for-agent Actor。',
  testInvalidToken: 'Apify 拒绝了该 Token。请在 Apify Console → Settings → API & Integrations 中检查。',
  testNetworkLocal: '本机无法连接 Google Trends。',
  testDetail: '详情：{detail}',
  testNetworkApify: '无法连接你的 Apify Actor（或它没有返回 Standby 响应）。',
  testHttp: '目标返回 HTTP {status}。',
  testBusy: '已有测试正在进行，请稍后再试。',
  apify: 'Apify',
  apifyDescription: 'Token、你的 Actor 和本计费周期的 Apify 用量。',
  usageTitle: 'Apify 用量',
  usageLoading: '正在加载 Apify 用量…',
  usageNoToken: '添加 Apify Token（或设置 APIFY_TOKEN）后可查看用量。',
  usageInvalidToken: 'Apify 拒绝了该 Token（401）。请在 Apify Console → Settings → API & Integrations 中检查。',
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
  signupBar: '还没有 Apify 账号？免费注册 — 免费版每月 {free} 额度足够本插件使用（估算约每月 {calls} 次调用，每次约 ${cost}）。',
  signupAction: '注册 →',
  pricingAction: '价格',
  token: 'Apify Token',
  tokenHint: '留空表示保持当前 Token，或使用环境变量 APIFY_TOKEN。保存的 Token 会写入 profile 的 cordis.patch.yml（权限 0600）。',
  tokenPrefixWarning: 'Apify API Token 通常以 apify_api_ 开头，请再确认。',
  tokenStored: '已保存 Token；输入新值可替换。',
  tokenEmpty: '未保存 Token。',
  clearToken: '清除已保存的 Token',
  actor: 'Actor',
  actorHint: '你的 google-trends-for-agent Actor。它使用平台内住宅代理访问 Google Trends，并在空闲 60 秒后退出。',
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
  deployBuilding: '构建中…（约 2–4 分钟）',
  deployExists: '该 Actor 已存在。请刷新列表并选择它。',
  deployFailed: '部署失败。请重试或手动部署。',
  deployBuildFailed: '构建失败。请在 Apify Console 查看构建日志。',
  defaults: '默认值',
  defaultsDescription: '工具调用未指定时使用的默认值。',
  geo: '默认地区',
  geoHint: '工具调用未传 geo 时使用；全球没有内置校准锚点，流量为 null。',
  geoWorldwide: '全球',
  anchor: '固定锚点',
  anchorHint: '自动：1 天及更短窗口用 sudoku，7 天及更长用 gpts。',
  anchorAutomatic: '自动（≤1 天用 sudoku，7 天+ 用 gpts）',
  cache: '复用已保存快照',
  cacheHint: '开启时复用 360 分钟内的快照；关闭时每次都重新抓取。',
  baselines: '锚点与基线',
  baselinesDescription: '覆盖内置校准锚点或添加自定义锚点。',
  baselinesHint: '格式和校验与 version 2 的 baselines.json 相同；留空使用内置美国基线。',
  overrideBaselines: '覆盖或新增锚点',
  anchorTerm: '词',
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
  windowHint: '可选。短窗口包括 now 1-H、now 4-H、now 1-d；长窗口包括 now 7-d 及更长。词必须在锚点列表或内置锚点中。',
  advanced: '高级',
  advancedDescription: '文件位置和图表输出。',
  snapshotDir: '快照目录',
  snapshotDirHint: '快照存放位置，相对于 dsh 进程的工作目录解析。',
  chartDir: '图表目录',
  chartDirHint: '开启图表文件时 SVG 的写入位置。',
  charts: '写入图表文件',
  chartsHint: '关闭后不再写 SVG 文件，工具返回的图表路径为 null。',
  requiredDirectory: '目录不能为空。',
  unsaved: '未保存的修改',
  discard: '放弃修改',
  save: '保存',
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
  page: { display: 'grid', gap: 28, maxWidth: 760, padding: '4px 0 24px' },
  intro: { margin: 0, opacity: 0.75, lineHeight: 1.5 },
  section: { display: 'grid', gap: 20, paddingTop: 0 },
  sectionHeader: { display: 'grid', gap: 4 },
  sectionTitle: { margin: 0, fontSize: 15, fontWeight: 650 },
  sectionDescription: { margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--dsw-alias-label-tertiary, inherit)', opacity: 0.8 },
  field: { display: 'grid' },
  label: { marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, inherit)' },
  hint: { margin: '4px 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--dsw-alias-label-tertiary, inherit)', opacity: 0.8 },
  fieldError: { margin: '4px 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--dsw-alias-state-error-primary, #d14343)' },
  warning: { margin: '4px 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--dsw-alias-state-warning-primary, #b7791f)' },
  input: {
    boxSizing: 'border-box', width: '100%', minWidth: 0, padding: '7px 9px', border: '0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.38))',
    borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'var(--dsw-alias-label-primary, inherit)', font: 'inherit', fontSize: 14,
  },
  select: {
    boxSizing: 'border-box', width: '100%', minWidth: 0, height: 32, padding: '0 28px 0 8px', border: '0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.38))',
    borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'var(--dsw-alias-label-primary, inherit)', font: 'inherit', fontSize: 14,
  },
  segmented: {
    boxSizing: 'border-box', display: 'grid', gap: 2, width: '100%', maxWidth: 420, padding: 3, borderRadius: 9,
    background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))',
  },
  segment: {
    height: 28, padding: '0 16px', border: 0, borderRadius: 7, background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, inherit)', font: 'inherit', fontSize: 13, lineHeight: '20px', fontWeight: 500,
    whiteSpace: 'nowrap', cursor: 'pointer',
  },
  segmentActive: {
    color: 'var(--dsw-alias-label-primary, inherit)', background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.22))',
    boxShadow: 'var(--dsw-elevation-soft, 0 1px 2px rgba(0,0,0,.12))',
  },
  switchRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 32, fontSize: 13 },
  switch: {
    boxSizing: 'border-box', flex: '0 0 auto', width: 36, height: 20, padding: 2, border: 0, borderRadius: 10,
    background: 'var(--dsw-alias-border-l3, rgba(127,127,127,.45))', cursor: 'pointer',
  },
  switchOn: { background: 'var(--dsw-alias-brand-primary, #2f6fed)' },
  switchThumb: {
    display: 'block', width: 16, height: 16, borderRadius: '50%',
    background: 'var(--dsw-alias-label-primary-foreground, #fff)', transition: 'transform 120ms ease',
  },
  switchThumbOn: { transform: 'translateX(16px)' },
  anchorHead: { display: 'grid', gridTemplateColumns: 'minmax(100px,1fr) minmax(130px,1fr) 118px 110px auto', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--dsw-alias-label-tertiary, inherit)' },
  anchorBlock: { display: 'grid' },
  anchorRow: { display: 'grid', gridTemplateColumns: 'minmax(100px,1fr) minmax(130px,1fr) 118px 110px auto', gap: 8, alignItems: 'center' },
  readOnlyTerm: {
    boxSizing: 'border-box', minWidth: 0, padding: '7px 9px', border: '0.5px solid transparent', borderRadius: 8,
    fontFamily: 'var(--ds-font-family-code, Menlo, monospace)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  windowRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  saveBar: {
    position: 'sticky', bottom: 0, zIndex: 2, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
    marginTop: 4, padding: '12px 0 4px', borderTop: '0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.28))',
    background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.96))',
  },
  button: {
    padding: '7px 14px', border: '0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.45))', borderRadius: 8,
    background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer',
  },
  buttonSmall: {
    padding: '3px 9px', border: '0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.45))', borderRadius: 7,
    background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 12, cursor: 'pointer',
  },
  primary: { background: 'var(--dsw-alias-brand-primary, #2f6fed)', borderColor: 'var(--dsw-alias-brand-primary, #2f6fed)', color: 'var(--dsw-alias-label-primary-foreground, #fff)' },
  pill: {
    display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, fontSize: 12,
    color: 'var(--dsw-alias-state-warning-primary, #8a5a00)', background: 'var(--dsw-alias-state-warning-bg, rgba(219,154,43,.16))',
  },
  status: { margin: 0, fontSize: 13 },
  error: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-state-error-primary, #d14343)' },
  summary: { display: 'grid', gap: 4, cursor: 'pointer' },
  usageCard: {
    display: 'grid', gap: 10, padding: 14, borderRadius: 10,
    border: '0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.28))',
    background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06))',
  },
  signupBar: {
    display: 'grid', gap: 6, padding: '10px 12px', borderRadius: 10,
    // Translucent info blue reads in both light and dark themes.
    border: '0.5px solid rgba(47,111,237,.28)',
    background: 'rgba(47,111,237,.07)',
  },
  signupText: { margin: 0, fontSize: 12, lineHeight: 1.5 },
  signupLinks: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', fontSize: 12 },
  signupPrimary: { color: '#2f6fed', fontWeight: 600, textDecoration: 'none' },
  signupSecondary: { color: 'var(--dsw-alias-label-tertiary, inherit)', textDecoration: 'underline' },
  usageBlock: { display: 'grid', gap: 6 },
  usageHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  usageTitle: { fontSize: 13, fontWeight: 650 },
  usageAmount: { fontSize: 24, lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.02em' },
  usageMeta: { margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--dsw-alias-label-tertiary, inherit)', opacity: 0.85 },
  progressTrack: { width: '100%', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.18))' },
  progressFill: { height: '100%', borderRadius: 4, transition: 'width 180ms ease' },
  usageFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--dsw-alias-label-tertiary, inherit)' },
  testLine: { margin: '4px 0 0', fontSize: 13, lineHeight: 1.45 },
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

/** Keep the stored tolerance exactly; '' means omitted (the built-in ±50% default). */
function normalizeTolerance(value: unknown): string {
  const raw = text(value).trim();
  if (!raw) return '';
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? String(numeric) : '';
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
  return {
    egress: source.egress === 'apify' ? 'apify' : 'local',
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
    newAnchor: blankAnchor(),
    windowShort: text(windows.short),
    windowLong: text(windows.long),
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
  return { ...draft, anchors: [...draft.anchors, anchor], newAnchor: blankAnchor() };
}

export function opsFor(draft: Draft, t: Translate): PathOp[] | string {
  const ops: PathOp[] = [];
  const set = (path: string[], value: unknown) => ops.push({ op: 'set', path, value });
  const unset = (path: string[]) => ops.push({ op: 'unset', path });
  const textOrUnset = (path: string[], value: string) => value.trim() ? set(path, value.trim()) : unset(path);

  if (draft.token && draft.clearToken) return t('tokenConflict');
  set(['egress'], draft.egress);
  // Local egress leaves the saved Apify token and Actor untouched.
  if (draft.egress === 'apify') {
    if (draft.token.trim()) set(['apifyToken'], draft.token.trim());
    else if (draft.clearToken) unset(['apifyToken']);
    textOrUnset(['apifyActor'], draft.actor);
  }
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
    if (!row.geo || !GEO_SET.has(row.geo)) throw new Error(t('invalidGeo'));
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
      else if (
        draft.anchors.some(anchor => anchor.term.trim().toLowerCase() === term.toLowerCase() && anchor.geo === draft.newAnchor.geo) ||
        (draft.newAnchor.geo === DEFAULT_GEO && BUILTIN_ANCHOR_TERMS.some(value => value.toLowerCase() === term.toLowerCase()))
      ) {
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
  if (result.ok) {
    if (result.egress === 'apify') {
      return { ok: true, text: template(t('testApifyOk'), { status: statusLabel(result.status), ms: result.latencyMs }) };
    }
    return { ok: true, text: template(t('testLocalOk'), { status: statusLabel(result.status), ms: result.latencyMs }) };
  }
  let key = result.egress === 'apify' ? 'testNetworkApify' : 'testNetworkLocal';
  if (result.code === 'no-token') key = 'testNoToken';
  else if (result.code === 'no-actor') key = 'testNoActor';
  else if (result.code === 'invalid-token') key = 'testInvalidToken';
  else if (result.code === 'http') key = 'testHttp';
  else if (result.code === 'busy') key = 'testBusy';
  const base = key === 'testHttp' ? template(t(key), { status: statusLabel(result.status) }) : t(key);
  const detail = result.code === 'network' && result.message ? template(t('testDetail'), { detail: result.message }) : '';
  return { ok: false, text: base + detail };
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
    source: value.source === 'config' || value.source === 'env' ? value.source : null,
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
export async function loadApifyActors(refresh = false): Promise<ApifyActorsView> {
  try {
    const response = await fetch(`${ACTORS_URL}${refresh ? '?refresh=1' : ''}`, {
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
export async function deployApifyActor(): Promise<DeployActorView> {
  try {
    const response = await fetch(DEPLOY_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{}',
      cache: 'no-store',
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

/** Send exactly one owner-authenticated test request for the saved egress. */
export async function runConnectionTest(egress: 'local' | 'apify' = 'local'): Promise<TestConnectionView> {
  try {
    const response = await fetch(TEST_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    });
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    const row = record(body);
    if (typeof row.ok === 'boolean' && (row.egress === 'local' || row.egress === 'apify')) {
      return {
        ok: row.ok,
        egress: row.egress,
        status: numberOrNull(row.status),
        latencyMs: numberOrNull(row.latencyMs) ?? 0,
        ...(typeof row.code === 'string' ? { code: row.code as TestConnectionView['code'] } : {}),
        ...(typeof row.message === 'string' ? { message: row.message } : {}),
        ...(typeof row.actorId === 'string' ? { actorId: row.actorId } : {}),
      };
    }
    return { ok: false, egress, status: response.status, latencyMs: 0, code: 'http' };
  } catch {
    return { ok: false, egress, status: null, latencyMs: 0, code: 'network' };
  }
}

function ApifySignupBar({ t, locale }: { t: Translate; locale: string }) {
  const calls = new Intl.NumberFormat(locale).format(apifyEstimatedCalls());
  const cost = new Intl.NumberFormat(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    .format(APIFY_EST_COST_PER_CALL_USD);
  const amounts = { free: `$${APIFY_FREE_MONTHLY_CREDIT_USD}`, calls, cost };
  return <div style={styles.signupBar}>
    <p style={styles.signupText}>{template(t('signupBar'), amounts)}</p>
    <div style={styles.signupLinks}>
      <a style={styles.signupPrimary} href={APIFY_SIGNUP_URL} target="_blank" rel="noopener noreferrer">{t('signupAction')}</a>
      <a style={styles.signupSecondary} href={APIFY_PRICING_URL} target="_blank" rel="noopener noreferrer">{t('pricingAction')}</a>
    </div>
  </div>;
}

function actorErrorText(state: Extract<ApifyActorsView, { status: 'error' }>, t: Translate): string {
  if (state.code === 'no-token') return t('testNoToken');
  if (state.code === 'invalid-token') return t('testInvalidToken');
  if (state.code === 'network') return t('actorLoadNetwork');
  return template(t('actorLoadHttp'), { status: statusLabel(state.httpStatus ?? null) });
}

export function ApifyUsageCard({ state, t, locale, onRefresh, onRetry, refreshing = false }: {
  state: ApifyUsageView;
  t: Translate;
  locale: string;
  onRefresh: () => void;
  onRetry: () => void;
  refreshing?: boolean;
}) {
  const error = state.status === 'error' ? state : undefined;
  return <div style={styles.usageCard} aria-label={t('usageTitle')}>
    <div style={styles.usageHead}>
      <span style={styles.usageTitle}>{t('usageTitle')}</span>
      <button type="button" style={styles.buttonSmall} disabled={refreshing || state.status === 'loading'}
        onClick={onRefresh}>{t('usageRefresh')}</button>
    </div>
    {state.status === 'idle' || state.status === 'loading'
      ? <p style={styles.usageMeta}>{t('usageLoading')}</p>
      : error
        ? <>
          <p style={error.code === 'no-token' || error.code === 'invalid-token' ? styles.usageMeta : styles.fieldError} role="alert">
            {usageErrorText(error, t)}
          </p>
          {error.code === 'network' || error.code === 'http'
            ? <div><button type="button" style={styles.buttonSmall} onClick={onRetry}>{t('usageRetry')}</button></div>
            : null}
        </>
        : state.status === 'ready' ? <UsageDetails data={state.data} t={t} locale={locale} /> : null}
  </div>;
}

function UsageDetails({ data, t, locale }: { data: ApifyUsageData; t: Translate; locale: string }) {
  const hasProgress = data.usageUsd !== null && data.limitUsd !== null && data.limitUsd > 0;
  const percent = hasProgress ? Math.min(100, Math.max(0, (data.usageUsd! / data.limitUsd!) * 100)) : 0;
  const color = !hasProgress
    ? 'var(--dsw-alias-border-l3, rgba(127,127,127,.45))'
    : percent > 90
      ? 'var(--dsw-alias-state-error-primary, #d14343)'
      : percent >= 70
        ? 'var(--dsw-alias-state-warning-primary, #d99a2b)'
        : 'var(--dsw-alias-state-success-primary, #2f9e5f)';

  const planPrice = compactMoney(data.plan.monthlyBasePriceUsd);
  const plan = data.plan.tier === null && data.plan.monthlyBasePriceUsd === null
    ? t('usagePlanUnknown')
    : template(t('usagePlan'), { tier: tierTitle(data.plan.tier), price: planPrice });
  const residential = data.residentialGb === null
    ? t('usageResidentialUnknown')
    : data.residentialGbLimit !== null && data.residentialGbLimit < 1000
      ? template(t('usageResidentialLimit'), { gb: data.residentialGb.toFixed(3), limit: data.residentialGbLimit.toFixed(3) })
      : template(t('usageResidential'), { gb: data.residentialGb.toFixed(3) });

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
    <div style={styles.usageAmount}>{usageMoney(data.usageUsd)} / {money(data.limitUsd)}</div>
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} style={styles.progressTrack}>
      <div style={{ ...styles.progressFill, width: `${percent}%`, background: color }} />
    </div>
    <p style={styles.usageMeta}>{resets}</p>
    <p style={styles.usageMeta}>{plan}</p>
    <p style={styles.usageMeta}>{residential}</p>
    <div style={styles.usageFoot}>
      <span>{updated === null ? '' : template(t('usageUpdated'), { time: updated })}</span>
    </div>
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

function Select({ label, hint, value, options, onChange, disabled, ariaLabel }: {
  label: string;
  hint?: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled: boolean;
  ariaLabel?: string;
}) {
  return <Field label={label} hint={hint}>
    <select style={styles.select} aria-label={ariaLabel ?? label} value={value} disabled={disabled}
      onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value || '__worldwide__'} value={option.value}>{option.label}</option>)}
    </select>
  </Field>;
}

function Segmented<V extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
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
  return <div role="tablist" aria-label={label} style={{ ...styles.segmented, gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    onKeyDown={disabled ? undefined : walk}>
    {options.map(option => {
      const active = option.value === value;
      return <button key={option.value} type="button" role="tab" aria-selected={active} tabIndex={active ? 0 : -1}
        disabled={disabled} style={{ ...styles.segment, ...(active ? styles.segmentActive : null) }}
        onClick={() => { if (!active) onChange(option.value); }}>{option.label}</button>;
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
  return <div style={styles.field}>
    <div style={styles.switchRow}>
      <span style={{ ...styles.label, marginBottom: 0 }}>{label}</span>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
    {hint ? <p style={styles.hint}>{hint}</p> : null}
  </div>;
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return <div style={styles.sectionHeader}>
    <h3 style={styles.sectionTitle}>{title}</h3>
    <p style={styles.sectionDescription}>{description}</p>
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
}

/** Settings page. Exported for server-render tests. */
export function ConfigPage({ ctx, t, initialDraft, initialUsage, initialActors }: ConfigPageProps) {
  const form = useMemo(() => ctx.configForms.get<Record<string, unknown>>(ENTRY), [ctx]);
  const describe = useMemo(() => ctx.configForms.describe(), [ctx]);
  const snapshot = useStore(form);
  const described = useStore(describe);
  const namespace = described.view?.namespaces.find(row => row.ns === ENTRY);
  const tokenSet = namespace?.secrets?.some(secret => secret.path.join('.') === 'apifyToken' && secret.set) ?? false;
  const [draft, setDraft] = useState<Draft>(() => ({ ...fromSnapshot(snapshot.value), ...initialDraft }));
  const [baseline, setBaseline] = useState<string>(() => draftKey(fromSnapshot(snapshot.value)));
  const [busy, setBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [usage, setUsage] = useState<ApifyUsageView>(initialUsage ?? { status: 'idle' });
  const [usageRequest, setUsageRequest] = useState({ id: 0, refresh: false });
  const [actors, setActors] = useState<ApifyActorsView>(initialActors ?? { status: 'idle' });
  const [actorsRequest, setActorsRequest] = useState({ id: 0, refresh: false });
  const [deploying, setDeploying] = useState(false);
  const [building, setBuilding] = useState(false);
  const [deployNotice, setDeployNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionView | null>(null);
  const lastRevision = useRef<number | undefined>(snapshot.revision);
  const intlLocale = useMemo(() => {
    const raw = typeof document !== 'undefined' ? document.documentElement.lang : '';
    const fallback = typeof navigator !== 'undefined' ? navigator.language : 'en';
    return /^zh/i.test(raw || fallback) ? 'zh-CN' : 'en';
  }, []);
  const validation = useMemo(() => validateDraft(draft, t), [draft, t]);
  const dirty = draftKey(draft) !== baseline;
  const blocking = hasBlockingValidation(validation);

  useEffect(() => {
    if (snapshot.status !== 'ready') return;
    if (lastRevision.current === snapshot.revision) return;
    lastRevision.current = snapshot.revision;
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
    if (draft.egress !== 'apify') {
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
    if (draft.egress !== 'apify') {
      setActors({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setActors({ status: 'loading' });
    void loadApifyActors(actorsRequest.refresh).then(next => {
      if (!cancelled) setActors(next);
    });
    return () => { cancelled = true; };
  }, [draft.egress, actorsRequest]);

  // Auto-select the first matching Actor into the draft when none is saved yet.
  useEffect(() => {
    if (actors.status !== 'ready' || actors.actors.length === 0) return;
    setDraft(current => current.actor ? current : { ...current, actor: actors.actors[0]!.id });
  }, [actors]);

  // While a deploy build runs, re-list every 15 s until it succeeds.
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => setActorsRequest(current => ({ id: current.id + 1, refresh: true })), 15_000);
    return () => clearInterval(timer);
  }, [building]);

  useEffect(() => {
    if (!building || actors.status !== 'ready') return;
    const succeeded = actors.actors.find(actor => actor.lastBuildStatus?.toUpperCase() === 'SUCCEEDED');
    if (succeeded) {
      setDraft(current => ({ ...current, actor: succeeded.id }));
      setBuilding(false);
      setDeployNotice(null);
      return;
    }
    if (actors.actors.some(actor => ['FAILED', 'ABORTED', 'TIMED-OUT'].includes(actor.lastBuildStatus?.toUpperCase() ?? ''))) {
      setBuilding(false);
      setDeployNotice(t('deployBuildFailed'));
    }
  }, [building, actors, t]);

  const edit = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const editAnchor = (index: number, patch: Partial<AnchorDraft>) => setDraft(current => ({
    ...current,
    anchors: current.anchors.map((anchor, i) => i === index ? { ...anchor, ...patch } : anchor),
  }));
  const requestUsage = (refresh: boolean) => setUsageRequest(current => ({ id: current.id + 1, refresh }));
  const requestActors = (refresh: boolean) => setActorsRequest(current => ({ id: current.id + 1, refresh }));

  const addAnchor = () => {
    if (validation.newAnchorTerm || validation.newAnchorDaily) return;
    const term = draft.newAnchor.term.trim();
    const dailySearches = Number(draft.newAnchor.dailySearches);
    if (!term || !Number.isFinite(dailySearches) || dailySearches <= 0) return;
    edit({
      baselineOverride: true,
      anchors: [...draft.anchors, { ...draft.newAnchor, term, dailySearches: String(dailySearches) }],
      newAnchor: blankAnchor(),
    });
    setFailure(null);
  };

  const discard = () => {
    const next = fromSnapshot(snapshot.value);
    setDraft(next);
    setBaseline(draftKey(next));
    setFailure(null);
    setNotice(null);
  };

  const save = async () => {
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
    const savedEgress = snapshot.value?.egress === 'apify' ? 'apify' : 'local';
    const tokenChanged = Boolean(draft.token.trim() || draft.clearToken);
    const egressChanged = draft.egress !== savedEgress;
    setBusy(true);
    try {
      const accepted = await form.mutate(ops, snapshot.revision);
      if (!accepted) setFailure(t('failed'));
      else {
        const cleaned = { ...toSave, token: '', clearToken: false, newAnchor: blankAnchor() };
        setDraft(cleaned);
        setBaseline(draftKey(cleaned));
        setNotice(t('saved'));
        if (draft.egress === 'apify' && (tokenChanged || egressChanged)) {
          requestUsage(false);
          requestActors(true);
        }
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await runConnectionTest(draft.egress));
    } finally {
      setTesting(false);
    }
  };

  const deploy = async () => {
    setDeploying(true);
    setDeployNotice(null);
    try {
      const result = await deployApifyActor();
      if (result.ok) {
        setBuilding(true);
        requestActors(true);
      } else if (result.code === 'exists') {
        setDeployNotice(t('deployExists'));
      } else if (result.code === 'no-token') {
        setDeployNotice(t('testNoToken'));
      } else if (result.code === 'invalid-token') {
        setDeployNotice(t('testInvalidToken'));
      } else {
        setDeployNotice(t('deployFailed'));
      }
    } finally {
      setDeploying(false);
    }
  };

  const anchorTerms = useMemo(() => {
    const seen = new Set<string>(), terms: string[] = [];
    for (const term of [
      ...BUILTIN_ANCHOR_TERMS,
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
  }, [draft.anchors, draft.anchor, draft.windowShort, draft.windowLong]);

  const anchorOptions = useMemo(() =>
    anchorTerms.map(term => ({ value: term, label: term })), [anchorTerms]);
  const fixedAnchorOptions = useMemo(() =>
    [{ value: '', label: t('anchorAutomatic') }, ...anchorOptions], [anchorOptions, t]);
  const windowOptions = useMemo(() =>
    [{ value: '', label: t('windowDefault') }, ...anchorOptions], [anchorOptions, t]);
  const actorOptions = useMemo(() => actors.status === 'ready'
    ? actors.actors.map(actor => ({
      value: actor.id,
      label: `${[actor.username, actor.name].filter(Boolean).join('/')}${actor.title ? ` — ${actor.title}` : ''}`,
    }))
    : [], [actors]);
  const selectedActor = actors.status === 'ready' ? actors.actors.find(actor => actor.id === draft.actor) : undefined;
  const geoOptions = useMemo(() => {
    const options = [
      { value: '', label: t('geoWorldwide') },
      ...GEO_CODES.filter(Boolean).map(code => ({ value: code, label: regionLabel(code, intlLocale) }))
        .sort((a, b) => a.label.localeCompare(b.label, intlLocale)),
    ];
    if (draft.geo && !GEO_SET.has(draft.geo)) {
      options.push({ value: draft.geo, label: regionLabel(draft.geo, intlLocale) || draft.geo });
    }
    return options;
  }, [draft.geo, intlLocale, t]);
  const toleranceOptions = useMemo(() =>
    [{ value: '', label: t('toleranceDefault') }, ...TOLERANCE_OPTIONS.map(option => ({ value: option.value, label: t(option.label) }))], [t]);
  // A stored value outside the presets stays selectable so saving other settings never rewrites it.
  const toleranceChoices = (current: string) => current === '' || toleranceOptions.some(option => option.value === current)
    ? toleranceOptions
    : [...toleranceOptions, { value: current, label: `±${Math.round(Number(current) * 100)}%` }];
  // Anchors calibrate one country; Worldwide is not an anchor geo.
  const anchorGeoOptions = useMemo(() => geoOptions.filter(option => option.value !== ''), [geoOptions]);

  if (snapshot.status === 'loading') return <p style={styles.status}>{t('loading')}</p>;
  if (snapshot.status === 'unavailable') return <p style={styles.status}>{t('unavailable')}</p>;
  const editable = snapshot.writable && !busy;
  const canSave = editable && dirty && !blocking;
  const newAnchorReady = Boolean(draft.newAnchor.term.trim()) && isPositiveNumber(draft.newAnchor.dailySearches) && !validation.newAnchorTerm && !validation.newAnchorDaily;
  const line = testResult ? testLine(testResult, t) : null;

  return <form style={styles.page} onSubmit={event => { event.preventDefault(); void save(); }}>
    <p style={styles.intro}>{t('intro')}</p>

    <section style={styles.section}>
      <SectionHeader title={t('connection')} description={t('connectionDescription')} />
      <Field label={t('egress')} hint={t('egressHint')}>
        <Segmented label={t('egress')} value={draft.egress} disabled={!editable}
          options={[
            { value: 'local', label: t('egressLocal') },
            { value: 'apify', label: t('egressApify') },
          ]}
          onChange={value => { edit({ egress: value }); setTestResult(null); }} />
      </Field>
      <div style={styles.field}>
        <div style={styles.switchRow}>
          <button type="button" style={dim(styles.button, !editable || testing)} disabled={!editable || testing} onClick={() => { void test(); }}>
            {testing ? t('testing') : t('testConnection')}
          </button>
          {dirty ? <span style={styles.hint}>{t('testSavedNote')}</span> : null}
        </div>
        {line ? <p style={{ ...styles.testLine, color: line.ok ? 'var(--dsw-alias-state-success-primary, #2f9e5f)' : 'var(--dsw-alias-state-error-primary, #d14343)' }} role="status">
          {line.ok ? '✓ ' : '✗ '}{line.text}
        </p> : null}
      </div>
    </section>

    {draft.egress === 'apify' ? <section style={styles.section}>
      <SectionHeader title={t('apify')} description={t('apifyDescription')} />
      {usage.status === 'error' && usage.code === 'no-token' ? <ApifySignupBar t={t} locale={intlLocale} /> : null}
      <div style={styles.usageBlock}>
        <ApifyUsageCard state={usage} t={t} locale={intlLocale}
          onRefresh={() => requestUsage(true)} onRetry={() => requestUsage(true)} refreshing={busy} />
      </div>
      <Field label={t('token')} hint={t('tokenHint')}>
        <input style={styles.input} type="password" autoComplete="new-password" value={draft.token} disabled={!editable}
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
      <div style={styles.field}>
        <div style={styles.switchRow}>
          <span style={{ ...styles.label, marginBottom: 0 }}>{t('actor')}</span>
          <button type="button" style={styles.buttonSmall} disabled={!editable || actors.status === 'loading'}
            onClick={() => requestActors(true)}>{t('actorRefresh')}</button>
        </div>
        <select style={styles.select} aria-label={t('actor')} value={draft.actor}
          disabled={!editable || actors.status !== 'ready' || actors.actors.length === 0}
          onChange={event => edit({ actor: event.target.value })}>
          <option value="">{t('actorNone')}</option>
          {actorOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <p style={styles.hint}>{t('actorHint')}</p>
        {selectedActor ? <p style={styles.hint}>{template(t('actorBuild'), {
          status: (selectedActor.lastBuildStatus ?? t('actorBuildUnknown')).toLowerCase(),
        })}</p> : null}
        {actors.status === 'loading' ? <p style={styles.hint}>{t('actorLoading')}</p> : null}
        {actors.status === 'error' ? <p style={styles.fieldError} role="alert">{actorErrorText(actors, t)}</p> : null}
      </div>
      {actors.status === 'ready' && actors.actors.length === 0 ? <div style={styles.usageBlock}>
        <p style={styles.usageMeta}>{t('actorEmpty')}</p>
        <div>
          <button type="button" style={dim({ ...styles.button, ...styles.primary }, !editable || deploying)}
            disabled={!editable || deploying} onClick={() => { void deploy(); }}>
            {deploying ? t('deploying') : t('deploy')}
          </button>
        </div>
        <div><a style={styles.signupSecondary} href={DEPLOY_MANUAL_URL} target="_blank" rel="noopener noreferrer">{t('deployManual')}</a></div>
      </div> : null}
      {building ? <p style={styles.usageMeta}>{t('deployBuilding')}</p> : null}
      {deployNotice ? <p style={styles.fieldError} role="alert">{deployNotice}</p> : null}
    </section> : null}

    <section style={styles.section}>
      <SectionHeader title={t('defaults')} description={t('defaultsDescription')} />
      <Select label={t('geo')} hint={t('geoHint')} value={draft.geo} disabled={!editable}
        options={geoOptions}
        onChange={value => edit({ geo: value })} />
      <Select label={t('anchor')} hint={t('anchorHint')} value={draft.anchor} disabled={!editable}
        options={fixedAnchorOptions}
        onChange={value => edit({ anchor: value })} />
      <Toggle label={t('cache')} hint={t('cacheHint')} checked={draft.cache} disabled={!editable}
        onChange={checked => edit({ cache: checked })} />
    </section>

    <section style={styles.section}>
      <SectionHeader title={t('baselines')} description={t('baselinesDescription')} />
      <Toggle label={t('overrideBaselines')} hint={t('baselinesHint')} checked={draft.baselineOverride} disabled={!editable}
        onChange={checked => edit({
          baselineOverride: checked,
          anchors: checked && draft.anchors.length === 0
            ? [{ term: BUILTIN_ANCHOR_TERMS[0], geo: DEFAULT_GEO, dailySearches: '3500', tolerance: '0.5' }]
            : draft.anchors,
        })} />
      {validation.baselines ? <p style={styles.fieldError} role="alert">{validation.baselines}</p> : null}
      {draft.baselineOverride ? <>
        <div style={styles.anchorHead}>
          <span>{t('anchorTerm')}</span><span>{t('anchorGeo')}</span><span>{t('anchorDaily')}</span><span>{t('anchorTolerance')}</span><span />
        </div>
        {draft.anchors.map((anchor, index) => <div style={styles.anchorBlock} key={`${anchor.term}-${index}`}>
          <div style={styles.anchorRow}>
            <span style={styles.readOnlyTerm} title={anchor.term}>{anchor.term}</span>
            <select style={styles.select} aria-label={`${t('anchorGeo')} ${anchor.term}`} value={anchor.geo} disabled={!editable}
              onChange={event => editAnchor(index, { geo: event.target.value })}>
              {anchorGeoOptions.map(option => <option key={option.value || '__worldwide__'} value={option.value}>{option.label}</option>)}
            </select>
            <input style={styles.input} type="number" min={1} step={1} aria-label={`${t('anchorDaily')} ${anchor.term}`}
              aria-invalid={Boolean(validation.anchorRows[index])}
              value={anchor.dailySearches} disabled={!editable}
              onChange={event => editAnchor(index, { dailySearches: event.target.value })} />
            <select style={styles.select} aria-label={`${t('anchorTolerance')} ${anchor.term}`} value={anchor.tolerance} disabled={!editable}
              onChange={event => editAnchor(index, { tolerance: event.target.value })}>
              {toleranceChoices(anchor.tolerance).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button type="button" style={styles.button} disabled={!editable}
              onClick={() => edit({ anchors: draft.anchors.filter((_, i) => i !== index) })}>{t('remove')}</button>
          </div>
          {validation.anchorRows[index] ? <p style={styles.fieldError} role="alert">{validation.anchorRows[index]}</p> : null}
        </div>)}
        <div style={styles.anchorBlock}>
          <div style={styles.anchorRow}>
            <input style={styles.input} type="text" aria-label={t('newAnchorTerm')} placeholder={t('newAnchorTerm')}
              aria-invalid={Boolean(validation.newAnchorTerm)}
              value={draft.newAnchor.term} disabled={!editable}
              onChange={event => edit({ newAnchor: { ...draft.newAnchor, term: event.target.value } })} />
            <select style={styles.select} aria-label={`${t('anchorGeo')} ${t('newAnchorTerm')}`} value={draft.newAnchor.geo} disabled={!editable}
              onChange={event => edit({ newAnchor: { ...draft.newAnchor, geo: event.target.value } })}>
              {anchorGeoOptions.map(option => <option key={option.value || '__worldwide__'} value={option.value}>{option.label}</option>)}
            </select>
            <input style={styles.input} type="number" min={1} step={1} aria-label={`${t('anchorDaily')} ${t('newAnchorTerm')}`}
              aria-invalid={Boolean(validation.newAnchorDaily)}
              value={draft.newAnchor.dailySearches} disabled={!editable}
              onChange={event => edit({ newAnchor: { ...draft.newAnchor, dailySearches: event.target.value } })} />
            <select style={styles.select} aria-label={`${t('anchorTolerance')} ${t('newAnchorTerm')}`} value={draft.newAnchor.tolerance} disabled={!editable}
              onChange={event => edit({ newAnchor: { ...draft.newAnchor, tolerance: event.target.value } })}>
              {toleranceChoices(draft.newAnchor.tolerance).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button type="button" style={dim(styles.button, !editable || !newAnchorReady)} disabled={!editable || !newAnchorReady} onClick={addAnchor}>{t('addAnchor')}</button>
          </div>
          {validation.newAnchorTerm ? <p style={styles.fieldError} role="alert">{validation.newAnchorTerm}</p> : null}
          {validation.newAnchorDaily ? <p style={styles.fieldError} role="alert">{validation.newAnchorDaily}</p> : null}
        </div>
        <div style={styles.windowRow}>
          <Select label={t('windowShort')} value={draft.windowShort} disabled={!editable}
            options={windowOptions}
            onChange={value => edit({ windowShort: value })} />
          <Select label={t('windowLong')} value={draft.windowLong} disabled={!editable}
            options={windowOptions}
            onChange={value => edit({ windowLong: value })} />
        </div>
        {validation.window ? <p style={styles.fieldError} role="alert">{validation.window}</p> : null}
        <p style={styles.hint}>{t('windowHint')}</p>
      </> : null}
    </section>

    <details style={styles.section} onToggle={event => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary style={styles.summary}>
        <span style={styles.sectionTitle}><span aria-hidden="true" style={{ display: 'inline-block', width: 14, opacity: 0.6 }}>{advancedOpen ? '▾' : '▸'}</span>{t('advanced')}</span>
        <span style={styles.sectionDescription}>{t('advancedDescription')}</span>
      </summary>
      <Toggle label={t('charts')} hint={t('chartsHint')} checked={draft.charts} disabled={!editable}
        onChange={checked => edit({ charts: checked })} />
      <Field label={t('snapshotDir')} hint={t('snapshotDirHint')}>
        <input style={styles.input} type="text" value={draft.snapshotDir} disabled={!editable}
          aria-invalid={Boolean(validation.snapshotDir)}
          onChange={event => edit({ snapshotDir: event.target.value })} />
        {validation.snapshotDir ? <p style={styles.fieldError} role="alert">{validation.snapshotDir}</p> : null}
      </Field>
      <Field label={t('chartDir')} hint={t('chartDirHint')}>
        <input style={styles.input} type="text" value={draft.chartDir} disabled={!editable || !draft.charts}
          aria-invalid={Boolean(validation.chartDir)}
          onChange={event => edit({ chartDir: event.target.value })} />
        {validation.chartDir ? <p style={styles.fieldError} role="alert">{validation.chartDir}</p> : null}
      </Field>
    </details>

    <div style={styles.saveBar}>
      <button type="submit" style={dim({ ...styles.button, ...styles.primary }, !canSave)} disabled={!canSave}>
        {busy ? t('saving') : t('save')}
      </button>
      <button type="button" style={dim(styles.button, !editable || !dirty)} disabled={!editable || !dirty} onClick={discard}>{t('discard')}</button>
      {dirty ? <span style={styles.pill}>{t('unsaved')}</span> : null}
      {!dirty && notice ? <p style={styles.status} role="status">{notice}</p> : null}
      {failure ? <p style={styles.error} role="alert">{failure}</p> : null}
      {!snapshot.writable ? <p style={styles.hint}>{t('readOnly')}</p> : null}
    </div>
  </form>;
}

function ConfigView({ ctx, t, view }: { ctx: ClientContext; t: Translate; view: 'summary' | 'page' }) {
  return view === 'page' ? <ConfigPage ctx={ctx} t={t} /> : <>{t('summary')}</>;
}

/** Register the row configuration page while the Plugins page declares its slot. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'gtfa: dictionaries');
  const t = ctx.locale.bind(NS);
  ctx.effect(() => {
    ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
      name: 'plugins.row.config',
      key: `${PACKAGE}#${ENTRY}`,
      locale: NS,
    }, (props: PluginConfigViewProps) => <ConfigView ctx={ctx} t={t} view={props.view} />));
  }, 'gtfa: row configuration page');
}
