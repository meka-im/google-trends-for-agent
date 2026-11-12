/**
 * Browser half of the gtfa dsh plugin.
 *
 * dsh's Plugins page renders a plugin's own page from `plugins.row.config`.
 * The page reads the Host's Config-derived form (only `.volatile()` fields are
 * exposed) and writes path operations. `role('secret')` redacts the Apify token
 * on reads; a submitted token is persisted by dsh in the profile's
 * `cordis.patch.yml`, so the UI says that instead of calling it a vault.
 *
 * Every setting that has a finite set of values is a select, segmented control,
 * or switch. Only the token, a new anchor term, dailySearches, and directories
 * are typed inputs.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import {
  APIFY_PROXY_GROUPS, BUILTIN_ANCHOR_TERMS, DEFAULT_APIFY_PROXY_GROUP, DEFAULT_GEO, DEFAULT_PROXY_COUNTRY,
  GEO_CODES, PROXY_COUNTRY_CODES, regionLabel, type ApifyProxyGroup,
} from '../options.js';

/** Cordis service name used by the client bundle. */
export const inject = ['slots', 'locale', 'configForms'];

const NS = 'gtfa';
const PACKAGE = 'google-trends-for-agent';
const ENTRY = 'gtfa';

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

interface AnchorDraft {
  term: string;
  geo: string;
  dailySearches: string;
  tolerance: string;
}

interface Draft {
  egress: 'local' | 'apify';
  token: string;
  clearToken: boolean;
  proxyGroup: ApifyProxyGroup;
  proxyCountry: string;
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

export const EN: Record<string, string> = {
  summary: 'Configure egress, the Apify token, default geo, anchors, and snapshot cache.',
  intro: 'Changes apply without restarting dsh. The token you enter is saved in plaintext in the profile\'s cordis.patch.yml (mode 0600), hidden here and never logged or returned. Leave it blank and set APIFY_TOKEN to keep it out of the profile.',
  egress: 'Egress',
  egressHint: 'Local sends Google requests from the machine running dsh. Apify proxy uses the Apify proxy.',
  egressLocal: 'Local (this machine)',
  egressApify: 'Apify proxy',
  apify: 'Apify proxy',
  token: 'Apify token',
  tokenHint: 'Leave blank to keep the current token or use APIFY_TOKEN / APIFY_PROXY_PASSWORD. A saved token is written to the profile\'s cordis.patch.yml (mode 0600).',
  tokenStored: 'A token is stored. Type a new one to replace it.',
  tokenEmpty: 'No token stored.',
  clearToken: 'Clear the stored token',
  proxyGroup: 'Proxy group',
  proxyGroupHint: 'Residential uses residential IPs. Datacenter (automatic) uses Apify\'s auto mode and lets Apify pick datacenter IPs; no group or account-specific proxy is used.',
  proxyResidential: 'Residential',
  proxyDatacenter: 'Datacenter (automatic)',
  country: 'Proxy country',
  countryHint: 'Country for Apify proxy sessions. Default US.',
  defaults: 'Defaults',
  geo: 'Default geo',
  geoHint: 'Used when a tool call omits geo. Worldwide has no built-in calibration, so traffic is null.',
  geoWorldwide: 'Worldwide',
  anchor: 'Fixed anchor',
  anchorHint: 'Automatic uses sudoku for ≤1 day and gpts for 7 days and longer.',
  anchorAutomatic: 'Automatic (sudoku for ≤1 day, gpts for 7 days+)',
  cache: 'Reuse saved snapshots',
  cacheHint: 'On reuses snapshots up to 360 minutes old. Off always fetches fresh data.',
  baselines: 'Baselines override',
  baselinesHint: 'Same format and validation as a version 2 baselines.json. Empty keeps the built-in US anchors.',
  overrideBaselines: 'Override or add anchors',
  anchorTerm: 'Term',
  newAnchorTerm: 'New anchor term',
  anchorGeo: 'Geo',
  anchorDaily: 'Searches/day',
  anchorTolerance: 'Tolerance',
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
  snapshotDir: 'Snapshot directory',
  chartDir: 'Chart directory',
  charts: 'Write chart files',
  chartsHint: 'Turning this off disables SVG chart files; the tool still returns chart paths as null.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved. Changes are live.',
  failed: 'The Host refused the change. Reload the page and try again.',
  loading: 'Loading configuration…',
  unavailable: 'Configuration is unavailable in this deployment.',
  readOnly: 'This configuration is read-only.',
  invalidAnchor: 'Each anchor needs a term and a positive dailySearches value.',
  invalidTolerance: 'Choose a tolerance from the list.',
  invalidCountry: 'Choose a proxy country from the list.',
  invalidGeo: 'Choose a geo from the list.',
  duplicateAnchor: 'That anchor term is already in the list.',
  tokenConflict: 'Type a new token or clear the stored one, not both.',
  baselinesEmpty: 'Add at least one anchor, or turn off the override.',
  windowUnknown: 'A window anchor must be a term from the anchors list or a built-in anchor.',
  tokenStateSet: 'Stored',
  tokenStateUnset: 'Not set',
};

export const ZH: Record<string, string> = {
  summary: '配置出口、Apify Token、默认地区、基线与快照缓存。',
  intro: '修改无需重启 dsh。输入的 Token 会以明文保存在 profile 的 cordis.patch.yml（权限 0600），此界面不回显，也不会写入日志或返回给客户端。留空并设置 APIFY_TOKEN 可让它不进入 profile。',
  egress: '出口',
  egressHint: 'local 从运行 dsh 的机器直接请求 Google；apify 使用 Apify 代理。',
  egressLocal: '本机直连',
  egressApify: 'Apify 代理',
  apify: 'Apify 代理',
  token: 'Apify Token',
  tokenHint: '留空表示保持当前 Token，或使用环境变量 APIFY_TOKEN / APIFY_PROXY_PASSWORD。保存的 Token 会写入 profile 的 cordis.patch.yml（权限 0600）。',
  tokenStored: '已保存 Token；输入新值可替换。',
  tokenEmpty: '未保存 Token。',
  clearToken: '清除已保存的 Token',
  proxyGroup: '代理分组',
  proxyGroupHint: '住宅使用住宅 IP；数据中心（自动）使用 Apify 的 auto 模式，由 Apify 选择数据中心 IP，不使用分组或账户专属代理。',
  proxyResidential: '住宅',
  proxyDatacenter: '数据中心（自动）',
  country: '代理国家',
  countryHint: 'Apify 代理会话使用的国家，默认 US。',
  defaults: '默认值',
  geo: '默认地区',
  geoHint: '工具调用未传 geo 时使用；全球没有内置校准锚点，流量为 null。',
  geoWorldwide: '全球',
  anchor: '固定锚点',
  anchorHint: '自动：1 天及更短窗口用 sudoku，7 天及更长用 gpts。',
  anchorAutomatic: '自动（≤1 天用 sudoku，7 天+ 用 gpts）',
  cache: '复用已保存快照',
  cacheHint: '开启时复用 360 分钟内的快照；关闭时每次都重新抓取。',
  baselines: '基线覆盖',
  baselinesHint: '格式和校验与 version 2 的 baselines.json 相同；留空使用内置美国基线。',
  overrideBaselines: '覆盖或新增锚点',
  anchorTerm: '词',
  newAnchorTerm: '新锚点词',
  anchorGeo: '地区',
  anchorDaily: '每日搜索量',
  anchorTolerance: '容差',
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
  snapshotDir: '快照目录',
  chartDir: '图表目录',
  charts: '写入图表文件',
  chartsHint: '关闭后不再写 SVG 文件，工具返回的图表路径为 null。',
  save: '保存',
  saving: '保存中…',
  saved: '已保存，修改已生效。',
  failed: 'Host 拒绝了修改。请刷新页面后重试。',
  loading: '正在加载配置…',
  unavailable: '当前部署不提供配置。',
  readOnly: '此配置为只读。',
  invalidAnchor: '每个锚点都需要词和大于 0 的每日搜索量。',
  invalidTolerance: '请选择列表中的容差。',
  invalidCountry: '请选择列表中的代理国家。',
  invalidGeo: '请选择列表中的地区。',
  duplicateAnchor: '该锚点词已在列表中。',
  tokenConflict: '只能输入新 Token 或清除已保存的 Token，二者选其一。',
  baselinesEmpty: '请至少添加一个锚点，或关闭基线覆盖。',
  windowUnknown: '窗口锚点必须来自锚点列表或内置锚点。',
  tokenStateSet: '已保存',
  tokenStateUnset: '未设置',
};

const styles: Record<string, CSSProperties> = {
  page: { display: 'grid', gap: 22, maxWidth: 760, padding: '4px 0 24px' },
  intro: { margin: 0, opacity: 0.75, lineHeight: 1.5 },
  section: { display: 'grid', gap: 12, paddingTop: 4 },
  sectionTitle: { margin: 0, fontSize: 15, fontWeight: 650 },
  field: { display: 'grid', gap: 5 },
  label: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, inherit)' },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--dsw-alias-label-tertiary, inherit)', opacity: 0.8 },
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
  anchorRow: { display: 'grid', gridTemplateColumns: 'minmax(100px,1fr) minmax(130px,1fr) 118px 110px auto', gap: 8, alignItems: 'center' },
  readOnlyTerm: {
    boxSizing: 'border-box', minWidth: 0, padding: '7px 9px', border: '0.5px solid transparent', borderRadius: 8,
    fontFamily: 'var(--ds-font-family-code, Menlo, monospace)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  windowRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  actions: { display: 'flex', gap: 10, alignItems: 'center', paddingTop: 4 },
  button: {
    padding: '7px 14px', border: '0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.45))', borderRadius: 8,
    background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer',
  },
  primary: { background: 'var(--dsw-alias-brand-primary, #2f6fed)', borderColor: 'var(--dsw-alias-brand-primary, #2f6fed)', color: 'var(--dsw-alias-label-primary-foreground, #fff)' },
  status: { margin: 0, fontSize: 13 },
  error: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-state-error-primary, #d14343)' },
};

const TOLERANCE_OPTIONS = [
  { value: '0.1', label: 'tolerance10' },
  { value: '0.25', label: 'tolerance25' },
  { value: '0.5', label: 'tolerance50' },
  { value: '0.75', label: 'tolerance75' },
  { value: '1', label: 'tolerance100' },
] as const;
const TOLERANCE_VALUES = TOLERANCE_OPTIONS.map(option => option.value);
const GEO_SET = new Set<string>(GEO_CODES);
const COUNTRY_SET = new Set<string>(PROXY_COUNTRY_CODES);

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return value === undefined || value === null ? fallback : String(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeTolerance(value: unknown): string {
  const numeric = Number(text(value));
  if (!Number.isFinite(numeric)) return '0.5';
  return TOLERANCE_VALUES.reduce((best, candidate) =>
    Math.abs(Number(candidate) - numeric) < Math.abs(Number(best) - numeric) ? candidate : best, '0.5');
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

function fromSnapshot(value: Record<string, unknown> | undefined): Draft {
  const source = value ?? {};
  const baselines = record(source.baselines);
  const anchors = anchorsFrom(baselines.anchors);
  const windows = record(baselines.windowAnchors);
  const chartDir = source.chartDir === null ? '' : text(source.chartDir, '.gtfa/charts');
  return {
    egress: source.egress === 'apify' ? 'apify' : 'local',
    token: '',
    clearToken: false,
    proxyGroup: text(source.apifyProxyGroup).toUpperCase() === 'AUTO' ? 'auto' : DEFAULT_APIFY_PROXY_GROUP,
    proxyCountry: text(source.apifyProxyCountry, DEFAULT_PROXY_COUNTRY).toUpperCase(),
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

function opsFor(draft: Draft, t: Translate): PathOp[] | string {
  const ops: PathOp[] = [];
  const set = (path: string[], value: unknown) => ops.push({ op: 'set', path, value });
  const unset = (path: string[]) => ops.push({ op: 'unset', path });
  const textOrUnset = (path: string[], value: string) => value.trim() ? set(path, value.trim()) : unset(path);

  if (draft.token && draft.clearToken) return t('tokenConflict');
  set(['egress'], draft.egress);
  if (draft.token.trim()) set(['apifyToken'], draft.token.trim());
  else if (draft.clearToken) unset(['apifyToken']);

  set(['apifyProxyGroup'], draft.proxyGroup);
  if (!COUNTRY_SET.has(draft.proxyCountry)) return t('invalidCountry');
  set(['apifyProxyCountry'], draft.proxyCountry);
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
    const tolerance = Number(row.tolerance);
    if (!term || !Number.isFinite(dailySearches) || dailySearches <= 0) throw new Error(t('invalidAnchor'));
    if (!TOLERANCE_VALUES.includes(row.tolerance as typeof TOLERANCE_VALUES[number])) throw new Error(t('invalidTolerance'));
    if (!GEO_SET.has(row.geo)) throw new Error(t('invalidGeo'));
    return { term, geo: row.geo, dailySearches, tolerance };
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
      <span style={styles.label}>{label}</span>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
    {hint ? <p style={styles.hint}>{hint}</p> : null}
  </div>;
}

/** Settings page. Exported for server-render tests. */
export function ConfigPage({ ctx, t }: { ctx: ClientContext; t: Translate }) {
  const form = useMemo(() => ctx.configForms.get<Record<string, unknown>>(ENTRY), [ctx]);
  const describe = useMemo(() => ctx.configForms.describe(), [ctx]);
  const snapshot = useStore(form);
  const described = useStore(describe);
  const namespace = described.view?.namespaces.find(row => row.ns === ENTRY);
  const tokenSet = namespace?.secrets?.some(secret => secret.path.join('.') === 'apifyToken' && secret.set) ?? false;
  const [draft, setDraft] = useState<Draft>(() => fromSnapshot(snapshot.value));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const lastRevision = useRef<number | undefined>(snapshot.revision);
  const intlLocale = useMemo(() => {
    const raw = typeof document !== 'undefined' ? document.documentElement.lang : '';
    const fallback = typeof navigator !== 'undefined' ? navigator.language : 'en';
    return /^zh/i.test(raw || fallback) ? 'zh-CN' : 'en';
  }, []);

  useEffect(() => {
    if (snapshot.status !== 'ready') return;
    if (lastRevision.current === snapshot.revision) return;
    lastRevision.current = snapshot.revision;
    setDraft(fromSnapshot(snapshot.value));
    setNotice(null);
    setFailure(null);
  }, [snapshot.status, snapshot.revision, snapshot.value]);

  const edit = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const editAnchor = (index: number, patch: Partial<AnchorDraft>) => setDraft(current => ({
    ...current,
    anchors: current.anchors.map((anchor, i) => i === index ? { ...anchor, ...patch } : anchor),
  }));

  const addAnchor = () => {
    const term = draft.newAnchor.term.trim();
    const dailySearches = Number(draft.newAnchor.dailySearches);
    if (!term || !Number.isFinite(dailySearches) || dailySearches <= 0) {
      setFailure(t('invalidAnchor'));
      return;
    }
    if (draft.anchors.some(anchor => anchor.term.trim().toLowerCase() === term.toLowerCase())) {
      setFailure(t('duplicateAnchor'));
      return;
    }
    setFailure(null);
    edit({
      baselineOverride: true,
      anchors: [...draft.anchors, { ...draft.newAnchor, term, dailySearches: String(dailySearches) }],
      newAnchor: blankAnchor(),
    });
  };

  const save = async () => {
    setFailure(null);
    setNotice(null);
    let ops: PathOp[] | string;
    try { ops = opsFor(draft, t); }
    catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return;
    }
    if (typeof ops === 'string') { setFailure(ops); return; }
    setBusy(true);
    try {
      const accepted = await form.mutate(ops, snapshot.revision);
      if (!accepted) setFailure(t('failed'));
      else {
        setDraft(current => ({ ...current, token: '', clearToken: false, newAnchor: blankAnchor() }));
        setNotice(t('saved'));
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t('failed'));
    } finally {
      setBusy(false);
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
  const countryOptions = useMemo(() => {
    const options: { value: string; label: string }[] = PROXY_COUNTRY_CODES.map(code => ({ value: code, label: regionLabel(code, intlLocale) }));
    if (draft.proxyCountry && !COUNTRY_SET.has(draft.proxyCountry)) {
      options.unshift({ value: draft.proxyCountry, label: regionLabel(draft.proxyCountry, intlLocale) || draft.proxyCountry });
    }
    return options;
  }, [draft.proxyCountry, intlLocale]);
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
    TOLERANCE_OPTIONS.map(option => ({ value: option.value, label: t(option.label) })), [t]);

  if (snapshot.status === 'loading') return <p style={styles.status}>{t('loading')}</p>;
  if (snapshot.status === 'unavailable') return <p style={styles.status}>{t('unavailable')}</p>;
  const editable = snapshot.writable && !busy;

  return <form style={styles.page} onSubmit={event => { event.preventDefault(); void save(); }}>
    <p style={styles.intro}>{t('intro')}</p>

    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{t('egress')}</h3>
      <Field label={t('egress')} hint={t('egressHint')}>
        <Segmented label={t('egress')} value={draft.egress} disabled={!editable}
          options={[
            { value: 'local', label: t('egressLocal') },
            { value: 'apify', label: t('egressApify') },
          ]}
          onChange={value => edit({ egress: value })} />
      </Field>
    </section>

    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{t('apify')}</h3>
      <Field label={t('token')} hint={t('tokenHint')}>
        <input style={styles.input} type="password" autoComplete="new-password" value={draft.token} disabled={!editable}
          placeholder={tokenSet ? t('tokenStored') : t('tokenEmpty')}
          onChange={event => edit({ token: event.target.value })} />
        <p style={styles.hint}>{tokenSet ? t('tokenStateSet') : t('tokenStateUnset')}</p>
        {tokenSet ? <div style={styles.switchRow}>
          <span>{t('clearToken')}</span>
          <Switch label={t('clearToken')} checked={draft.clearToken} disabled={!editable}
            onChange={checked => edit({ clearToken: checked })} />
        </div> : null}
      </Field>
      <Select label={t('proxyGroup')} hint={t('proxyGroupHint')} value={draft.proxyGroup} disabled={!editable}
        options={[
          { value: APIFY_PROXY_GROUPS[0], label: t('proxyResidential') },
          { value: APIFY_PROXY_GROUPS[1], label: t('proxyDatacenter') },
        ]}
        onChange={value => edit({ proxyGroup: value === 'auto' ? 'auto' : 'RESIDENTIAL' })} />
      <Select label={t('country')} hint={t('countryHint')} value={draft.proxyCountry} disabled={!editable}
        options={countryOptions}
        onChange={value => edit({ proxyCountry: value })} />
    </section>

    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{t('defaults')}</h3>
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
      <h3 style={styles.sectionTitle}>{t('baselines')}</h3>
      <p style={styles.hint}>{t('baselinesHint')}</p>
      <Toggle label={t('overrideBaselines')} checked={draft.baselineOverride} disabled={!editable}
        onChange={checked => edit({
          baselineOverride: checked,
          anchors: checked && draft.anchors.length === 0
            ? [{ term: BUILTIN_ANCHOR_TERMS[0], geo: DEFAULT_GEO, dailySearches: '3500', tolerance: '0.5' }]
            : draft.anchors,
        })} />
      {draft.baselineOverride ? <>
        <div style={styles.anchorHead}>
          <span>{t('anchorTerm')}</span><span>{t('anchorGeo')}</span><span>{t('anchorDaily')}</span><span>{t('anchorTolerance')}</span><span />
        </div>
        {draft.anchors.map((anchor, index) => <div style={styles.anchorRow} key={`${anchor.term}-${index}`}>
          <span style={styles.readOnlyTerm} title={anchor.term}>{anchor.term}</span>
          <select style={styles.select} aria-label={`${t('anchorGeo')} ${anchor.term}`} value={anchor.geo} disabled={!editable}
            onChange={event => editAnchor(index, { geo: event.target.value })}>
            {geoOptions.map(option => <option key={option.value || '__worldwide__'} value={option.value}>{option.label}</option>)}
          </select>
          <input style={styles.input} type="number" min={1} step={1} aria-label={`${t('anchorDaily')} ${anchor.term}`}
            value={anchor.dailySearches} disabled={!editable}
            onChange={event => editAnchor(index, { dailySearches: event.target.value })} />
          <select style={styles.select} aria-label={`${t('anchorTolerance')} ${anchor.term}`} value={anchor.tolerance} disabled={!editable}
            onChange={event => editAnchor(index, { tolerance: event.target.value })}>
            {toleranceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button type="button" style={styles.button} disabled={!editable}
            onClick={() => edit({ anchors: draft.anchors.filter((_, i) => i !== index) })}>{t('remove')}</button>
        </div>)}
        <div style={styles.anchorRow}>
          <input style={styles.input} type="text" aria-label={t('newAnchorTerm')} placeholder={t('newAnchorTerm')}
            value={draft.newAnchor.term} disabled={!editable}
            onChange={event => edit({ newAnchor: { ...draft.newAnchor, term: event.target.value } })} />
          <select style={styles.select} aria-label={`${t('anchorGeo')} ${t('newAnchorTerm')}`} value={draft.newAnchor.geo} disabled={!editable}
            onChange={event => edit({ newAnchor: { ...draft.newAnchor, geo: event.target.value } })}>
            {geoOptions.map(option => <option key={option.value || '__worldwide__'} value={option.value}>{option.label}</option>)}
          </select>
          <input style={styles.input} type="number" min={1} step={1} aria-label={`${t('anchorDaily')} ${t('newAnchorTerm')}`}
            value={draft.newAnchor.dailySearches} disabled={!editable}
            onChange={event => edit({ newAnchor: { ...draft.newAnchor, dailySearches: event.target.value } })} />
          <select style={styles.select} aria-label={`${t('anchorTolerance')} ${t('newAnchorTerm')}`} value={draft.newAnchor.tolerance} disabled={!editable}
            onChange={event => edit({ newAnchor: { ...draft.newAnchor, tolerance: event.target.value } })}>
            {toleranceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button type="button" style={styles.button} disabled={!editable} onClick={addAnchor}>{t('addAnchor')}</button>
        </div>
        <div style={styles.windowRow}>
          <Select label={t('windowShort')} value={draft.windowShort} disabled={!editable}
            options={windowOptions}
            onChange={value => edit({ windowShort: value })} />
          <Select label={t('windowLong')} value={draft.windowLong} disabled={!editable}
            options={windowOptions}
            onChange={value => edit({ windowLong: value })} />
        </div>
        <p style={styles.hint}>{t('windowHint')}</p>
      </> : null}
    </section>

    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{t('advanced')}</h3>
      <Field label={t('snapshotDir')}>
        <input style={styles.input} type="text" value={draft.snapshotDir} disabled={!editable}
          onChange={event => edit({ snapshotDir: event.target.value })} />
      </Field>
      <Toggle label={t('charts')} hint={t('chartsHint')} checked={draft.charts} disabled={!editable}
        onChange={checked => edit({ charts: checked })} />
      <Field label={t('chartDir')}>
        <input style={styles.input} type="text" value={draft.chartDir} disabled={!editable || !draft.charts}
          onChange={event => edit({ chartDir: event.target.value })} />
      </Field>
    </section>

    <div style={styles.actions}>
      <button type="submit" style={{ ...styles.button, ...styles.primary }} disabled={!editable}>
        {busy ? t('saving') : t('save')}
      </button>
      {notice ? <p style={styles.status} role="status">{notice}</p> : null}
      {failure ? <p style={styles.error} role="alert">{failure}</p> : null}
    </div>
    {!snapshot.writable ? <p style={styles.hint}>{t('readOnly')}</p> : null}
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
