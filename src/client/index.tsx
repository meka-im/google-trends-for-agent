/**
 * Browser half of the gtfa dsh plugin.
 *
 * dsh's Plugins page renders a plugin's own page from `plugins.row.config`.
 * The page reads the Host's Config-derived form (only `.volatile()` fields are
 * exposed) and writes path operations; the Apify token stays write-only because
 * dsh-settings redacts `role('secret')` values before they cross the wire.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';

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
  groups: string;
  country: string;
  geo: string;
  anchor: string;
  cache: boolean;
  snapshotDir: string;
  charts: boolean;
  chartDir: string;
  baselineOverride: boolean;
  anchors: AnchorDraft[];
  windowShort: string;
  windowLong: string;
}

const EN: Record<string, string> = {
  summary: 'Configure egress, the Apify token, default geo, baselines, and snapshot cache.',
  intro: 'Changes apply without restarting dsh. The Apify token is stored as a dsh secret and is never shown again.',
  egress: 'Egress',
  egressHint: 'local sends Google requests from the machine running dsh. apify uses the Apify proxy.',
  egressLocal: 'Local (this machine)',
  egressApify: 'Apify proxy',
  apify: 'Apify proxy',
  token: 'Apify token',
  tokenHint: 'Leave blank to keep the current token, or to use APIFY_TOKEN / APIFY_PROXY_PASSWORD from the environment.',
  tokenStored: 'A token is stored. Type a new one to replace it.',
  tokenEmpty: 'No token stored.',
  clearToken: 'Clear the stored token',
  groups: 'Proxy groups',
  groupsHint: 'Comma-separated, for example RESIDENTIAL. Leave blank for RESIDENTIAL.',
  country: 'Proxy country',
  countryHint: 'Two-letter country code, for example US.',
  defaults: 'Defaults',
  geo: 'Default geo',
  geoHint: 'Used when a tool call omits geo. Default US.',
  anchor: 'Fixed anchor (advanced)',
  anchorHint: 'Blank picks sudoku for short windows and gpts for 7-day and longer windows.',
  cache: 'Reuse saved snapshots',
  cacheHint: 'On reuses snapshots up to 360 minutes old. Off always fetches fresh data.',
  baselines: 'Baselines override',
  baselinesHint: 'Same format and validation as a version 2 baselines.json. Empty keeps the built-in US anchors.',
  overrideBaselines: 'Override or add anchors',
  anchorTerm: 'Term',
  anchorGeo: 'Geo',
  anchorDaily: 'Searches/day',
  anchorTolerance: 'Tolerance',
  addAnchor: 'Add anchor',
  remove: 'Remove',
  windowShort: 'Short-window anchor',
  windowLong: 'Long-window anchor',
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
  invalidTolerance: 'Tolerance must be a number from 0 to 1.',
  invalidGroups: 'Proxy groups may contain only letters, digits, and underscores.',
  tokenConflict: 'Type a new token or clear the stored one, not both.',
  baselinesEmpty: 'Add at least one anchor, or turn off the override.',
  windowUnknown: 'A window anchor must be a term from the anchors list or a built-in anchor.',
  secretSet: 'Stored',
  secretUnset: 'Not set',
};

const ZH: Record<string, string> = {
  summary: '配置出口、Apify Token、默认地区、基线与快照缓存。',
  intro: '修改无需重启 dsh。Apify Token 以 dsh 密钥保存，之后不会再显示。',
  egress: '出口',
  egressHint: 'local 从运行 dsh 的机器直接请求 Google；apify 使用 Apify 代理。',
  egressLocal: '本机直连',
  egressApify: 'Apify 代理',
  apify: 'Apify 代理',
  token: 'Apify Token',
  tokenHint: '留空表示保持当前 Token，或使用环境变量 APIFY_TOKEN / APIFY_PROXY_PASSWORD。',
  tokenStored: '已保存 Token；输入新值可替换。',
  tokenEmpty: '未保存 Token。',
  clearToken: '清除已保存的 Token',
  groups: '代理分组',
  groupsHint: '逗号分隔，例如 RESIDENTIAL。留空即 RESIDENTIAL。',
  country: '代理国家',
  countryHint: '两位国家代码，例如 US。',
  defaults: '默认值',
  geo: '默认地区',
  geoHint: '工具调用未传 geo 时使用，默认 US。',
  anchor: '固定锚点（高级）',
  anchorHint: '留空时短窗口用 sudoku，7 天及更长窗口用 gpts。',
  cache: '复用已保存快照',
  cacheHint: '开启时复用 360 分钟内的快照；关闭时每次都重新抓取。',
  baselines: '基线覆盖',
  baselinesHint: '格式和校验与 version 2 的 baselines.json 相同；留空使用内置美国基线。',
  overrideBaselines: '覆盖或新增锚点',
  anchorTerm: '词',
  anchorGeo: '地区',
  anchorDaily: '每日搜索量',
  anchorTolerance: '容差',
  addAnchor: '添加锚点',
  remove: '删除',
  windowShort: '短窗口锚点',
  windowLong: '长窗口锚点',
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
  invalidTolerance: '容差必须是 0 到 1 之间的数字。',
  invalidGroups: '代理分组只能包含字母、数字和下划线。',
  tokenConflict: '只能输入新 Token 或清除已保存的 Token，二者选其一。',
  baselinesEmpty: '请至少添加一个锚点，或关闭基线覆盖。',
  windowUnknown: '窗口锚点必须来自锚点列表或内置锚点。',
  secretSet: '已保存',
  secretUnset: '未设置',
};

const styles: Record<string, CSSProperties> = {
  page: { display: 'grid', gap: 22, maxWidth: 760, padding: '4px 0 24px' },
  intro: { margin: 0, opacity: 0.75, lineHeight: 1.5 },
  section: { display: 'grid', gap: 12, paddingTop: 4 },
  sectionTitle: { margin: 0, fontSize: 15, fontWeight: 650 },
  field: { display: 'grid', gap: 5 },
  label: { fontSize: 13, fontWeight: 600 },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.45, opacity: 0.65 },
  input: {
    boxSizing: 'border-box', width: '100%', padding: '7px 9px', border: '1px solid rgba(127,127,127,.38)',
    borderRadius: 6, background: 'transparent', color: 'inherit', font: 'inherit',
  },
  checkboxRow: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 },
  anchorRow: { display: 'grid', gridTemplateColumns: 'minmax(110px,1.4fr) 64px 108px 80px auto', gap: 8, alignItems: 'end' },
  windowRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  actions: { display: 'flex', gap: 10, alignItems: 'center', paddingTop: 4 },
  button: {
    padding: '7px 14px', border: '1px solid rgba(127,127,127,.45)', borderRadius: 6,
    background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer',
  },
  primary: { background: '#2f6fed', borderColor: '#2f6fed', color: '#fff' },
  status: { margin: 0, fontSize: 13 },
  error: { margin: 0, fontSize: 13, color: '#d14343' },
};

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return value === undefined || value === null ? fallback : String(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function anchorsFrom(value: unknown): AnchorDraft[] {
  if (!Array.isArray(value)) return [];
  return value.map(row => {
    const anchor = record(row);
    return {
      term: text(anchor.term),
      geo: text(anchor.geo, 'US'),
      dailySearches: text(anchor.dailySearches),
      tolerance: text(anchor.tolerance),
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
    groups: Array.isArray(source.apifyProxyGroups) ? source.apifyProxyGroups.map(group => text(group)).join(', ') : 'RESIDENTIAL',
    country: text(source.apifyProxyCountry, 'US'),
    geo: text(source.geo, 'US'),
    anchor: text(source.anchor),
    cache: source.cache !== false,
    snapshotDir: text(source.snapshotDir, '.gtfa/snapshots'),
    charts: source.charts !== false && source.chartDir !== null,
    chartDir: chartDir || '.gtfa/charts',
    baselineOverride: anchors.length > 0 || Boolean(text(windows.short) || text(windows.long)),
    anchors,
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

  const groups = draft.groups.split(',').map(group => group.trim().toUpperCase()).filter(Boolean);
  if (groups.some(group => !/^[A-Z0-9_]+$/.test(group))) return t('invalidGroups');
  if (groups.length) set(['apifyProxyGroups'], groups);
  else unset(['apifyProxyGroups']);
  textOrUnset(['apifyProxyCountry'], draft.country.toUpperCase());
  textOrUnset(['geo'], draft.geo.toUpperCase());
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
    if (tolerance !== undefined && (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1)) throw new Error(t('invalidTolerance'));
    return {
      term,
      geo: (row.geo.trim() || 'US').toUpperCase(),
      dailySearches,
      ...(tolerance === undefined ? {} : { tolerance }),
    };
  });
  const windowAnchors = {
    ...(draft.windowShort.trim() ? { short: draft.windowShort.trim() } : {}),
    ...(draft.windowLong.trim() ? { long: draft.windowLong.trim() } : {}),
  };
  const known = new Set([...anchors.map(anchor => anchor.term.toLowerCase()), 'sudoku', 'gpts']);
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

function ConfigPage({ ctx, t }: { ctx: ClientContext; t: Translate }) {
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
        setDraft(current => ({ ...current, token: '', clearToken: false }));
        setNotice(t('saved'));
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  if (snapshot.status === 'loading') return <p style={styles.status}>{t('loading')}</p>;
  if (snapshot.status === 'unavailable') return <p style={styles.status}>{t('unavailable')}</p>;
  const editable = snapshot.writable && !busy;

  return <form style={styles.page} onSubmit={event => { event.preventDefault(); void save(); }}>
    <p style={styles.intro}>{t('intro')}</p>

    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{t('egress')}</h3>
      <Field label={t('egress')} hint={t('egressHint')}>
        <select style={styles.input} value={draft.egress} disabled={!editable}
          onChange={event => edit({ egress: event.target.value === 'apify' ? 'apify' : 'local' })}>
          <option value="local">{t('egressLocal')}</option>
          <option value="apify">{t('egressApify')}</option>
        </select>
      </Field>
    </section>

    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{t('apify')}</h3>
      <Field label={t('token')} hint={t('tokenHint')}>
        <input style={styles.input} type="password" autoComplete="new-password" value={draft.token} disabled={!editable}
          placeholder={tokenSet ? t('tokenStored') : t('tokenEmpty')}
          onChange={event => edit({ token: event.target.value })} />
        <p style={styles.hint}>{tokenSet ? t('secretSet') : t('secretUnset')}</p>
        {tokenSet ? <label style={styles.checkboxRow}>
          <input type="checkbox" checked={draft.clearToken} disabled={!editable}
            onChange={event => edit({ clearToken: event.target.checked })} />
          {t('clearToken')}
        </label> : null}
      </Field>
      <Field label={t('groups')} hint={t('groupsHint')}>
        <input style={styles.input} value={draft.groups} disabled={!editable}
          onChange={event => edit({ groups: event.target.value })} />
      </Field>
      <Field label={t('country')} hint={t('countryHint')}>
        <input style={styles.input} value={draft.country} disabled={!editable}
          onChange={event => edit({ country: event.target.value })} />
      </Field>
    </section>

    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{t('defaults')}</h3>
      <Field label={t('geo')} hint={t('geoHint')}>
        <input style={styles.input} value={draft.geo} disabled={!editable}
          onChange={event => edit({ geo: event.target.value })} />
      </Field>
      <Field label={t('anchor')} hint={t('anchorHint')}>
        <input style={styles.input} value={draft.anchor} disabled={!editable}
          onChange={event => edit({ anchor: event.target.value })} />
      </Field>
      <label style={styles.checkboxRow}>
        <input type="checkbox" checked={draft.cache} disabled={!editable}
          onChange={event => edit({ cache: event.target.checked })} />
        {t('cache')}
      </label>
      <p style={styles.hint}>{t('cacheHint')}</p>
    </section>

    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{t('baselines')}</h3>
      <p style={styles.hint}>{t('baselinesHint')}</p>
      <label style={styles.checkboxRow}>
        <input type="checkbox" checked={draft.baselineOverride} disabled={!editable}
          onChange={event => edit({ baselineOverride: event.target.checked, anchors: event.target.checked && draft.anchors.length === 0 ? [{ term: 'gpts', geo: 'US', dailySearches: '3500', tolerance: '0.5' }] : draft.anchors })} />
        {t('overrideBaselines')}
      </label>
      {draft.baselineOverride ? <>
        {draft.anchors.map((anchor, index) => <div style={styles.anchorRow} key={index}>
          <input style={styles.input} aria-label={t('anchorTerm')} placeholder={t('anchorTerm')} value={anchor.term} disabled={!editable}
            onChange={event => editAnchor(index, { term: event.target.value })} />
          <input style={styles.input} aria-label={t('anchorGeo')} placeholder={t('anchorGeo')} value={anchor.geo} disabled={!editable}
            onChange={event => editAnchor(index, { geo: event.target.value })} />
          <input style={styles.input} aria-label={t('anchorDaily')} placeholder={t('anchorDaily')} inputMode="numeric" value={anchor.dailySearches} disabled={!editable}
            onChange={event => editAnchor(index, { dailySearches: event.target.value })} />
          <input style={styles.input} aria-label={t('anchorTolerance')} placeholder={t('anchorTolerance')} inputMode="decimal" value={anchor.tolerance} disabled={!editable}
            onChange={event => editAnchor(index, { tolerance: event.target.value })} />
          <button type="button" style={styles.button} disabled={!editable}
            onClick={() => edit({ anchors: draft.anchors.filter((_, i) => i !== index) })}>{t('remove')}</button>
        </div>)}
        <div>
          <button type="button" style={styles.button} disabled={!editable}
            onClick={() => edit({ anchors: [...draft.anchors, { term: '', geo: 'US', dailySearches: '', tolerance: '0.5' }] })}>
            {t('addAnchor')}
          </button>
        </div>
        <div style={styles.windowRow}>
          <Field label={t('windowShort')}>
            <input style={styles.input} value={draft.windowShort} disabled={!editable}
              onChange={event => edit({ windowShort: event.target.value })} />
          </Field>
          <Field label={t('windowLong')}>
            <input style={styles.input} value={draft.windowLong} disabled={!editable}
              onChange={event => edit({ windowLong: event.target.value })} />
          </Field>
        </div>
        <p style={styles.hint}>{t('windowHint')}</p>
      </> : null}
    </section>

    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{t('advanced')}</h3>
      <Field label={t('snapshotDir')}>
        <input style={styles.input} value={draft.snapshotDir} disabled={!editable}
          onChange={event => edit({ snapshotDir: event.target.value })} />
      </Field>
      <label style={styles.checkboxRow}>
        <input type="checkbox" checked={draft.charts} disabled={!editable}
          onChange={event => edit({ charts: event.target.checked })} />
        {t('charts')}
      </label>
      <p style={styles.hint}>{t('chartsHint')}</p>
      <Field label={t('chartDir')}>
        <input style={styles.input} value={draft.chartDir} disabled={!editable || !draft.charts}
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
