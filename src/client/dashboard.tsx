import type { BatchResult } from '../batch-types.js';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ChoicePicker } from './choice-picker.js';
import { Icon } from './icons.js';
import { SETTINGS_CSS } from './theme.js';
import { DASHBOARD_CSS } from './dashboard-theme.js';
import { BASELINE_REFERENCE_URL } from '../baseline-catalog.js';
import { GEO_CODES, regionLabel, type EgressMode } from '../options.js';
import type { ActorRunRecord, QueryRecord, SavedQuery } from '../query-history-types.js';
import { DashboardController, dashboardRequest, queryKeywords, type RecordsViewMode } from './dashboard-state.js';
import type { QueryProgress } from '../query-progress.js';
import { supportsVolumeWindow, type VolumeBandPoint } from '../volume-types.js';
import { TrendChart, hasChartPoints } from './trend-chart.js';
import {
  UpdateBanner,
  dismissKeyForStatus,
  effectiveUpdateFlags,
  loadVersionStatus,
  readDismissedUpdateKey,
  resolveUpdateMode,
  writeDismissedUpdateKey,
} from './update-banner.js';
import type { VersionStatusSnapshot } from '../version-check.js';

type Translate = (key: string) => string;
const TIME_KEYS = [['now 1-H', 'dashTime1h'], ['now 4-H', 'dashTime4h'], ['now 1-d', 'dashTime24h'], ['now 7-d', 'dashTime7d'],
  ['today 1-m', 'dashTime1m'], ['today 3-m', 'dashTime3m'], ['today 12-m', 'dashTime1y'], ['today 5-y', 'dashTime5y'], ['all', 'dashTimeAll']] as const;
const EMPTY_EXAMPLES = ['ChatGPT', 'ChatGPT, Gemini', 'Cursor, Claude, DeepSeek'] as const;
const colors = ['#2563eb', '#7c3aed', '#0d9488', '#d97706', '#e11d48'];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const array = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(object) : [];
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
const percent = (part: number, total: number) => total ? `${(part / total * 100).toFixed(0)}%` : '—';
const compactVolume = new Intl.NumberFormat(undefined, { notation: 'compact', maximumSignificantDigits: 2 });
const formatVolume = (value: unknown) => {
  const amount = number(value);
  return amount === null ? '—' : '≈ ' + compactVolume.format(amount);
};
const formatNumber = (value: unknown) => number(value)?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '—';
const timeLabel = (time: string, t: Translate) => { const key = TIME_KEYS.find(row => row[0] === time)?.[1]; return key ? t(key) : time; };
const egressLabel = (egress: EgressMode, t: Translate) => t(egress === 'local' ? 'dashLocal' : egress === 'actor-public' ? 'dashPublic' : 'dashOwn');
const toolKey: Record<string, string> = { trends_ask: 'dashToolAsk', trends_compare: 'dashToolCompare', trends_snapshot: 'dashToolSnapshot', trends_now: 'dashToolNow' };
const toolLabel = (tool: string, t: Translate) => { const key = toolKey[tool]; return key ? t(key) : tool.replace('trends_', ''); };
const statusKey: Record<string, string> = { ok: 'dashOk', error: 'dashError', blocked: 'dashBlocked', no_data: 'dashNoData', partial: 'dashPartial' };
const dateText = (raw: string | null, full = false) => raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toLocaleString(undefined,
  full ? { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const formatCostUsd = (cost: number | null | undefined, freeLabel = '$0.0000', pendingLabel = '—') => {
  if (cost == null || !Number.isFinite(cost)) return pendingLabel;
  if (cost === 0) return freeLabel;
  if (cost > 0 && cost < 0.0001) return '<$0.0001';
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
};
const exactCostTitle = (cost: number | null | undefined) =>
  typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? `$${cost.toFixed(6)} USD` : undefined;
const shortRunId = (runId: string) => runId.length > 12 ? `${runId.slice(0, 10)}…` : runId;
const runCountText = (count: number, t: Translate) => count === 1 ? t('dashRunCountSingle') : t('dashRunCountUnit').replace('{n}', String(count));
const runPurposeText = (run: Pick<ActorRunRecord, 'purpose' | 'round'>, t: Translate) => {
  switch (run.purpose) {
    case 'batch-round': return run.round ? t('dashPurposeBatchRound').replace('{n}', String(run.round)) : t('dashPurposeBatch');
    case 'single-retry': return t('dashPurposeSingleRetry');
    case 'estimate': return t('dashPurposeEstimate');
    case 'connection-test': return t('dashPurposeTest');
    default: return t('dashPurposeQuery');
  }
};
const runSourceText = (source: ActorRunRecord['source'], t: Translate) =>
  source === 'settings' ? t('dashSourceSettings') : t(source === 'manual' ? 'dashManual' : 'dashAgent');
const runStatusText = (status: ActorRunRecord['status'], t: Translate) => {
  switch (status) {
    case 'SUCCEEDED': return t('dashRunSucceeded');
    case 'FAILED': return t('dashRunFailed');
    case 'TIMED-OUT': return t('dashRunTimedOut');
    case 'ABORTED': return t('dashRunAborted');
    default: return t('dashRunError');
  }
};
const runStatusBadgeClass = (status: ActorRunRecord['status']) =>
  status === 'SUCCEEDED' ? 'ok' : status === 'ABORTED' ? 'warn' : 'error';
const toolStatusNote = (toolStatus: string | null | undefined, t: Translate) =>
  toolStatus === 'blocked' ? t('dashToolNoteBlocked')
    : toolStatus === 'no_data' ? t('dashToolNoteNoData')
      : toolStatus === 'error' ? t('dashToolNoteError')
        : null;

function resolveActorRuns(records: readonly QueryRecord[], supplied?: readonly ActorRunRecord[]): ActorRunRecord[] {
  if (Array.isArray(supplied)) return [...supplied];
  const byId = new Map<string, ActorRunRecord>();
  for (const record of records) {
    const egress = record.egress === 'actor-own' ? 'actor-own' : 'actor-public';
    if (record.egress !== 'local' && !record.cached && record.actorRunId && !byId.has(record.actorRunId)) {
      byId.set(record.actorRunId, {
        runId: record.actorRunId,
        actorId: null,
        egress,
        purpose: 'query',
        source: record.source,
        tool: record.tool,
        terms: [...record.terms],
        geo: record.geo,
        time: record.time,
        status: 'SUCCEEDED',
        toolStatus: record.status,
        startedAt: record.createdAt,
        finishedAt: record.fetchedAt ?? record.createdAt,
        durationMs: record.durationMs,
        costUsd: record.costUsd,
        queryRecordId: record.id,
        legacy: true,
      });
    }
    for (const vrun of record.volumeRuns ?? []) {
      if (!vrun.actorRunId || byId.has(vrun.actorRunId)) continue;
      byId.set(vrun.actorRunId, {
        runId: vrun.actorRunId,
        actorId: null,
        egress,
        purpose: record.tool === 'trends_snapshot' && record.singleVolume ? 'single-retry' : 'batch-round',
        source: record.source,
        tool: 'trends_compare',
        terms: [...record.terms],
        geo: record.geo,
        time: record.time,
        status: 'SUCCEEDED',
        toolStatus: null,
        startedAt: vrun.createdAt,
        finishedAt: vrun.createdAt,
        durationMs: null,
        costUsd: vrun.costUsd,
        queryRecordId: record.id,
        legacy: true,
      });
    }
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.runId.localeCompare(a.runId));
}

function groupRunsByQuery(actorRuns: readonly ActorRunRecord[]): Map<string, ActorRunRecord[]> {
  const grouped = new Map<string, ActorRunRecord[]>();
  for (const run of actorRuns) {
    if (!run.queryRecordId) continue;
    const list = grouped.get(run.queryRecordId);
    if (list) list.push(run);
    else grouped.set(run.queryRecordId, [run]);
  }
  return grouped;
}

function summarizeQueryCost(runs: readonly ActorRunRecord[]) {
  let pricedCount = 0;
  let totalCost = 0;
  for (const run of runs) {
    if (typeof run.costUsd === 'number' && Number.isFinite(run.costUsd)) {
      pricedCount++;
      totalCost += run.costUsd;
    }
  }
  return { runs, pricedCount, pendingCount: runs.length - pricedCount, totalCost };
}

export function TrendsMark({ size = 28 }: { size?: number }) {
  const id = useId();
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-s1`} x1="10" y1="50" x2="28" y2="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#1D4ED8" />
        <stop offset="55%" stopColor="#2563EB" />
        <stop offset="100%" stopColor="#38BDF8" />
      </linearGradient>
      <linearGradient id={`${id}-s2`} x1="22" y1="22" x2="39" y2="43" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#60A5FA" />
        <stop offset="48%" stopColor="#4F46E5" />
        <stop offset="100%" stopColor="#312E81" />
      </linearGradient>
      <linearGradient id={`${id}-s3`} x1="33" y1="43" x2="56" y2="12" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0284C7" />
        <stop offset="48%" stopColor="#06B6D4" />
        <stop offset="100%" stopColor="#34D399" />
      </linearGradient>
      <linearGradient id={`${id}-sh1`} x1="28" y1="26" x2="17" y2="38" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0B1120" stopOpacity="0.42" />
        <stop offset="100%" stopColor="#0B1120" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}-sh2`} x1="39" y1="38" x2="28" y2="27" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0B1120" stopOpacity="0.46" />
        <stop offset="100%" stopColor="#0B1120" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}-hi`} x1="36" y1="36" x2="54" y2="14" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
        <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0.34" />
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.1" />
      </linearGradient>
    </defs>
    <line x1="11.5" y1="46.5" x2="24.8" y2="23.5" stroke={`url(#${id}-s1)`} strokeWidth="12.4" strokeLinecap="round" />
    <line x1="11.5" y1="46.5" x2="24.8" y2="23.5" stroke={`url(#${id}-sh1)`} strokeWidth="12.4" strokeLinecap="round" />
    <line x1="24.8" y1="23.5" x2="36.8" y2="39.5" stroke={`url(#${id}-s2)`} strokeWidth="12.4" strokeLinecap="round" />
    <line x1="24.8" y1="23.5" x2="36.8" y2="39.5" stroke={`url(#${id}-sh2)`} strokeWidth="12.4" strokeLinecap="round" />
    <line x1="36.8" y1="39.5" x2="52.8" y2="16.2" stroke={`url(#${id}-s3)`} strokeWidth="12.4" strokeLinecap="round" />
    <line x1="38.4" y1="36.8" x2="51.2" y2="18.2" stroke={`url(#${id}-hi)`} strokeWidth="4.2" strokeLinecap="round" />
  </svg>;
}

function Button({ children, onClick, disabled, primary, ghost, compact, label, title }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; ghost?: boolean; compact?: boolean; label?: string; title?: string;
}) {
  return <button type="button" className={`gd-button${primary ? ' primary' : ''}${ghost ? ' ghost' : ''}${compact ? ' compact' : ''}`} disabled={disabled} onClick={onClick} aria-label={label} title={title}>{children}</button>;
}

function Checkbox({ checked, indeterminate = false, disabled = false, label, ariaLabel, onChange }: {
  checked: boolean; indeterminate?: boolean; disabled?: boolean; label?: string; ariaLabel?: string; onChange: (checked: boolean) => void;
}) {
  return <label className={`gd-check${disabled ? ' disabled' : ''}`}>
    <input type="checkbox" checked={checked} disabled={disabled} aria-label={ariaLabel ?? label} onChange={event => onChange(event.target.checked)} />
    <span className={`gd-check-box${checked ? ' checked' : ''}${indeterminate ? ' indeterminate' : ''}`} aria-hidden="true">
      {indeterminate
        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M5 12h14" /></svg>
        : checked
          ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          : null}
    </span>
    {label ? <span>{label}</span> : null}
  </label>;
}

function Picker({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: { value: string; label: string; badge?: string }[]; onChange: (v: string) => void; disabled?: boolean;
}) {
  return <ChoicePicker label={label} value={value} options={options} placeholder={label} emptyText="—" disabled={disabled} hideLabel compact searchable={options.length > 10} onChange={onChange} />;
}

function Badge({ record, t }: { record: Pick<QueryRecord, 'status' | 'cached'>; t: Translate }) {
  return <span className="gd-badges"><span className={`gd-badge ${record.status}`}>{t(statusKey[record.status] ?? 'dashError')}</span>{record.cached ? <span className="gd-badge cache">{t('dashCached')}</span> : null}</span>;
}

function QueryProgressCard({ operation, t, cancel }: { operation: QueryProgress & { terms: string[] }; t: Translate; cancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [operation.requestId]);
  const elapsed = Math.max(0, Math.floor((now - operation.startedAt) / 1000));
  const phase = t(`dashPhase${operation.phase[0]!.toUpperCase()}${operation.phase.slice(1)}`);
  return <div className="gd-progress" role="status" aria-live="polite"><div className="gd-progress-top"><div className="gd-progress-copy"><span className="gd-spinner"><Icon name="refresh" size={16} /></span><div><strong>{phase}</strong><p>{operation.terms.join(' · ')} · {t('dashElapsed')} {elapsed} s</p></div></div><Button compact onClick={cancel}>{t('dashCancel')}</Button></div><div className="gd-progress-track" role="progressbar" aria-label={phase} aria-valuetext={`${t('dashElapsed')} ${elapsed} s`}><i /></div></div>;
}

function HistorySummaryStrip({ records, actorRuns, mode, days, setDays, loading, refresh, t }: {
  records: QueryRecord[]; actorRuns: ActorRunRecord[]; mode: RecordsViewMode; days: number; setDays: (d: number) => void; loading: boolean; refresh: () => void; t: Translate;
}) {
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - days + 1);
  const now = Date.now();
  const rows = records.filter(row => Date.parse(row.createdAt) >= start.getTime() && Date.parse(row.createdAt) <= now);
  const success = rows.filter(row => row.status === 'ok').length;
  const cached = rows.filter(row => row.cached).length;
  const avgMs = rows.length ? duration(rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length) : '—';
  const windowRuns = actorRuns.filter(run => Date.parse(run.startedAt) >= start.getTime() && Date.parse(run.startedAt) <= now);
  const succeededRuns = windowRuns.filter(run => run.status === 'SUCCEEDED').length;
  const timedRuns = windowRuns.filter(run => run.durationMs !== null);
  const avgRunMs = timedRuns.length ? duration(timedRuns.reduce((sum, run) => sum + run.durationMs!, 0) / timedRuns.length) : '—';
  const priced = windowRuns.filter(run => run.costUsd !== null);
  const pendingCount = windowRuns.length - priced.length;
  const cost = priced.reduce((sum, run) => sum + run.costUsd!, 0);
  const costText = windowRuns.length && !priced.length ? t('dashCostPending') : formatCostUsd(cost);
  const costTitle = priced.length ? exactCostTitle(cost) : undefined;
  const avgRunCost = priced.length ? cost / priced.length : null;
  const avgRunCostText = avgRunCost === null ? '—' : formatCostUsd(avgRunCost);
  return <div className="gd-summary-strip" aria-label={t('dashUsage')}>
    <div className="gd-summary-window" role="group" aria-label={t('dashWindow')}>
      {([7, 30] as const).map(value => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{t(value === 7 ? 'dash7' : 'dash30')}</button>)}
    </div>
    {mode === 'queries' ? <div className="gd-summary-stats">
      <span className="gd-summary-stat"><span>{t('dashCount')}</span><strong>{rows.length}</strong></span>
      <span className="gd-summary-sep" aria-hidden="true" />
      <span className="gd-summary-stat"><span>{t('dashSuccess')}</span><strong>{percent(success, rows.length)}</strong></span>
      <span className="gd-summary-sep" aria-hidden="true" />
      <span className="gd-summary-stat"><span>{t('dashCacheRate')}</span><strong>{percent(cached, rows.length)}</strong></span>
      <span className="gd-summary-sep" aria-hidden="true" />
      <span className="gd-summary-stat"><span>{t('dashDuration')}</span><strong>{avgMs}</strong></span>
      <span className="gd-summary-sep" aria-hidden="true" />
      <span className="gd-summary-stat"><span>{t('dashActorCalls')}</span><strong>{windowRuns.length}</strong></span>
      <span className="gd-summary-sep" aria-hidden="true" />
      <span className="gd-summary-stat"><span>{t('dashTotalSpend')}</span><strong className="accent" title={costTitle}>{costText}</strong>{pendingCount > 0 && priced.length > 0 ? <small>{t('dashPendingCount').replace('{n}', String(pendingCount))}</small> : null}</span>
    </div> : <div className="gd-summary-stats">
      <span className="gd-summary-stat"><span>{t('dashActorCalls')}</span><strong>{windowRuns.length}</strong></span>
      <span className="gd-summary-sep" aria-hidden="true" />
      <span className="gd-summary-stat"><span>{t('dashSuccess')}</span><strong>{percent(succeededRuns, windowRuns.length)}</strong></span>
      <span className="gd-summary-sep" aria-hidden="true" />
      <span className="gd-summary-stat"><span>{t('dashDuration')}</span><strong>{avgRunMs}</strong></span>
      <span className="gd-summary-sep" aria-hidden="true" />
      <span className="gd-summary-stat"><span>{t('dashPricedRuns')}</span><strong>{windowRuns.length ? `${priced.length} / ${windowRuns.length}` : '0'}</strong></span>
      <span className="gd-summary-sep" aria-hidden="true" />
      <span className="gd-summary-stat"><span>{t('dashAvgCost')}</span><strong title={avgRunCost !== null ? exactCostTitle(avgRunCost) : undefined}>{avgRunCostText}</strong></span>
      <span className="gd-summary-sep" aria-hidden="true" />
      <span className="gd-summary-stat"><span>{t('dashTotalSpend')}</span><strong className="accent" title={costTitle}>{costText}</strong>{pendingCount > 0 && priced.length > 0 ? <small>{t('dashPendingCount').replace('{n}', String(pendingCount))}</small> : null}</span>
    </div>}
    <Button compact ghost disabled={loading} onClick={refresh} label={t('dashRefresh')} title={t('dashRefresh')}><Icon name="refresh" size={14} /></Button>
  </div>;
}

export function Dashboard({ t, openSettings, renderSettings, controller: supplied }: { t: Translate; openSettings?: () => void; renderSettings?: () => ReactNode; controller?: DashboardController }) {
  const own = useRef<DashboardController | null>(null);
  if (!supplied && !own.current) own.current = new DashboardController();
  const controller = supplied ?? own.current!;
  const stateView = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { tab, recordsMode, state, loading, reconciling, error, fieldError, days, text, geo, time, reuse, result, metric, search, status, source, page, selected, runSearch, runPurpose, runStatus, runSource, runPage, operation } = stateView;
  const setTab = (value: typeof tab) => controller.set('tab', value);
  const setRecordsMode = (value: RecordsViewMode) => controller.set('recordsMode', value);
  const setDays = (value: number) => controller.set('days', value);
  const setText = (value: string) => controller.set('text', value);
  const setGeo = (value: string) => controller.set('geo', value);
  const setTime = (value: string) => controller.set('time', value);
  const setReuse = (value: boolean) => controller.set('reuse', value);
  const setMetric = (value: string) => controller.set('metric', value);
  const setSearch = (value: string) => controller.set('search', value);
  const setStatus = (value: string) => controller.set('status', value);
  const setSource = (value: string) => controller.set('source', value);
  const setPage = (value: number) => controller.set('page', value);
  const setSelected = (value: string[]) => controller.set('selected', value);
  const setRunSearch = (value: string) => controller.set('runSearch', value);
  const setRunPurpose = (value: string) => controller.set('runPurpose', value);
  const setRunStatus = (value: string) => controller.set('runStatus', value);
  const setRunSource = (value: string) => controller.set('runSource', value);
  const setRunPage = (value: number) => controller.set('runPage', value);
  const [clearing, setClearing] = useState<string[] | null>(null), [deleting, setDeleting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionStatus, setVersionStatus] = useState<VersionStatusSnapshot | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => readDismissedUpdateKey());
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keywordInput = useRef<HTMLInputElement>(null);
  const busy = operation !== null, terms = queryKeywords(text);
  const refresh = () => controller.refresh();
  const copyRunId = (id: string) => {
    void navigator.clipboard?.writeText?.(id).catch(() => {});
    setCopiedRunId(id);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedRunId(null), 1600);
  };
  useEffect(() => {
    void controller.refresh();
    const versionAbort = new AbortController();
    const loadVersion = () => {
      void loadVersionStatus(false, versionAbort.signal).then(next => {
        if (!versionAbort.signal.aborted && next) setVersionStatus(next);
      });
    };
    loadVersion();
    const focus = () => { void controller.refresh(); loadVersion(); };
    window.addEventListener('focus', focus);
    return () => {
      clearTimeout(copyTimer.current);
      versionAbort.abort();
      window.removeEventListener('focus', focus);
      if (!supplied) controller.dispose();
    };
  }, [controller, supplied]);
  const run = async () => { if (!await controller.run()) keywordInput.current?.focus(); };
  const runTerm = async (term: string) => {
    setText(term);
    if (!await controller.run()) keywordInput.current?.focus();
  };
  const appendCompare = (term: string) => {
    const existing = queryKeywords(text);
    if (existing.length >= 5 || existing.some(item => item.toLowerCase() === term.toLowerCase())) return;
    setText([...existing, term].join(', '));
    keywordInput.current?.focus();
  };
  const view = (id: string) => controller.view(id);
  const clear = async () => {
    if (!clearing || deleting) return;
    setDeleting(true);
    try { await dashboardRequest('', { action: 'clear', ids: clearing }); controller.clearResult(clearing); setClearing(null); await refresh(); }
    catch { controller.set('error', 'dashFailed'); }
    finally { setDeleting(false); }
  };
  const records = state?.records ?? [];
  const actorRuns = resolveActorRuns(records, state?.actorRuns);
  const runsByQuery = groupRunsByQuery(actorRuns);
  const recordIdSet = new Set(records.map(record => record.id));
  const pendingRunsCount = actorRuns.filter(run => run.costUsd === null).length;
  const filtered = records.filter(record => (!search || record.terms.join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && (source === 'all' || source === record.source) && (status === 'all' || (status === 'failed' ? ['blocked', 'error'].includes(record.status) : status === record.status)));
  const pages = Math.max(1, Math.ceil(filtered.length / 10)), currentPage = Math.min(page, pages), rows = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const runNeedle = runSearch.trim().toLocaleLowerCase();
  const filteredRuns = actorRuns.filter(run =>
    (!runNeedle || run.terms.join(' ').toLocaleLowerCase().includes(runNeedle) || run.runId.toLocaleLowerCase().includes(runNeedle) || (run.anchor ?? '').toLocaleLowerCase().includes(runNeedle))
    && (runPurpose === 'all' || run.purpose === runPurpose)
    && (runSource === 'all' || run.source === runSource)
    && (runStatus === 'all' || (runStatus === 'FAILED' ? (run.status === 'FAILED' || run.status === 'ERROR') : run.status === runStatus)));
  const runPages = Math.max(1, Math.ceil(filteredRuns.length / 10)), currentRunPage = Math.min(runPage, runPages), visibleRuns = filteredRuns.slice((currentRunPage - 1) * 10, currentRunPage * 10);
  const allRowsSelected = Boolean(rows.length) && rows.every(row => selected.includes(row.id));
  const someRowsSelected = rows.some(row => selected.includes(row.id)) && !allRowsSelected;
  const resultRuns = result
    ? (result.actorRuns?.length ? result.actorRuns : runsByQuery.get(result.record.id) ?? resolveActorRuns([result.record]))
    : [];
  const isZh = t('dashGeo') === '地区';
  const updateMode = versionStatus ? resolveUpdateMode(versionStatus, undefined, state?.settings.egress) : 'up-to-date';
  const updateFlags = versionStatus ? effectiveUpdateFlags(versionStatus, state?.settings.egress) : null;
  const currentDismissKey = versionStatus ? dismissKeyForStatus(versionStatus, updateMode, updateFlags?.targetPluginVersion ?? null) : null;
  const updateDismissed = Boolean(currentDismissKey && dismissedKey === currentDismissKey);
  const actorWarnDot = updateMode === 'actor-outdated' || updateMode === 'both-outdated';
  const dismissUpdate = () => {
    if (!currentDismissKey) return;
    writeDismissedUpdateKey(currentDismissKey);
    setDismissedKey(currentDismissKey);
  };
  const canOpenSettings = Boolean(renderSettings || openSettings);
  const handleOpenSettings = renderSettings ? () => { setSettingsOpen(true); } : openSettings;
  const reopenUpdate = () => {
    if (updateDismissed) {
      writeDismissedUpdateKey(null);
      setDismissedKey(null);
    } else if (updateMode !== 'up-to-date' && handleOpenSettings) {
      handleOpenSettings();
    }
  };
  return <div className="gtfa-settings gtfa-dashboard"><style>{SETTINGS_CSS + DASHBOARD_CSS}</style>
    <header className="gd-topbar">
      <div className="gd-brand"><TrendsMark size={28} /><h1>Google Trends</h1></div>
      <nav className="gd-tabs" role="tablist" aria-label="Google Trends" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const tabs = ['query', 'records'] as const, index = tabs.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + 1) % 2;
        setSettingsOpen(false); setTab(tabs[next]!); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
      }}>{(['query', 'records'] as const).map(key => <button type="button" role="tab" id={`gd-tab-${key}`} aria-controls={`gd-panel-${key}`} aria-selected={!settingsOpen && tab === key} tabIndex={!settingsOpen && tab === key ? 0 : -1} key={key} onClick={() => { setSettingsOpen(false); setTab(key); void refresh(); }}>{t(key === 'query' ? 'dashQuery' : 'dashRecords')}{key === 'records' ? <small>{records.length}</small> : null}</button>)}</nav>
      <div className="gd-topbar-right">
        {state ? <button type="button" className="gd-route-pill" disabled={!canOpenSettings} onClick={handleOpenSettings}><i className={`gd-route-dot${actorWarnDot ? ' warn' : ''}`} />{egressLabel(state.settings.egress, t)}</button> : null}
        <button type="button" className={`gd-button compact${settingsOpen ? ' active' : ''}`} disabled={!canOpenSettings}
          aria-pressed={renderSettings ? settingsOpen : undefined}
          onClick={renderSettings ? () => setSettingsOpen(open => !open) : openSettings}>
          <Icon name="sliders" size={14} />{t('dashSettings')}
        </button>
      </div>
    </header>
    <div className="gd-workspace">
      {settingsOpen && renderSettings ? <section className="gd-settings-view" aria-label={t('dashSettings')}>
        <div className="gd-settings-bar">
          <button type="button" className="gd-button compact" onClick={() => { setSettingsOpen(false); void refresh(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            {t('dashBackToQuery')}
          </button>
          <h2>{t('dashSettings')}</h2>
        </div>
        {renderSettings()}
      </section> : <>
      <UpdateBanner
        surface="dashboard"
        status={versionStatus}
        t={t}
        locale={isZh ? 'zh-CN' : 'en'}
        egressOverride={state?.settings.egress}
        dismissed={updateDismissed}
        onDismiss={dismissUpdate}
        onUpdateActor={handleOpenSettings}
        onSwitchPublic={handleOpenSettings}
      />
      {error ? <div className="gd-error" role="alert">{t(error)}<Button compact disabled={loading} onClick={() => { void refresh(); }}>{t('dashRefresh')}</Button></div> : null}
      {operation && tab !== 'query' ? <QueryProgressCard operation={operation} t={t} cancel={controller.cancel} /> : null}
      <section id="gd-panel-query" role="tabpanel" aria-labelledby="gd-tab-query" hidden={tab !== 'query'}>
        <div className="gd-query-shell">
          <form className="gd-command-bar" onSubmit={event => { event.preventDefault(); void run(); }}>
            <label className="gd-cmd-input-wrap">
              <span className="gtfa-sr-only">{t('dashKeywords')}</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              <input ref={keywordInput} className="gd-cmd-input" value={text} maxLength={520} disabled={busy} autoComplete="off" placeholder={t('dashKeywords')} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? 'gd-keyword-error' : 'gd-keyword-hint'} onChange={event => setText(event.target.value)} />
              {terms.length > 0 ? <span className={`gd-term-badge${terms.length > 5 ? ' over' : ''}`}>{terms.length} / 5</span> : null}
            </label>
            <span className="gd-cmd-sep" aria-hidden="true" />
            <Picker label={t('dashGeo')} value={geo} options={GEO_CODES.map(value => ({ value, label: regionLabel(value, isZh ? 'zh' : 'en') }))} onChange={setGeo} disabled={busy} />
            <span className="gd-cmd-sep" aria-hidden="true" />
            <Picker label={t('dashWindow')} value={time} options={TIME_KEYS.map(([value, key]) => ({ value, label: t(key), ...(supportsVolumeWindow(value) ? {} : { badge: isZh ? '仅指数' : 'Index' }) }))} onChange={setTime} disabled={busy} />
            <button className="gd-button primary" type="submit" disabled={busy || !state}>{busy ? t('dashRunning') : t('dashRun')}<Icon name="play" size={13} /></button>
            {fieldError ? <p className="gd-field-error" id="gd-keyword-error" role="alert">{t(fieldError)}</p> : null}
          </form>
          <div className="gd-query-sub" id="gd-keyword-hint">
            {terms.length <= 1 ? <Checkbox checked={reuse && state?.settings.cache !== false} disabled={busy || state?.settings.cache === false} label={t('dashReuse')} onChange={setReuse} /> : null}
            <span className="gd-query-sub-note">{t('dashOnDemand')}</span>
          </div>
        </div>
        {operation && tab === 'query' ? <QueryProgressCard operation={operation} t={t} cancel={controller.cancel} /> : null}
        {result ? <Result key={result.record.id} saved={operation?.batch && operation.recordId === result.record.id ? { ...result, result: { ...result.result, batchVolume: operation.batch } } : result} actorRuns={resultRuns} metric={metric} setMetric={setMetric} busy={busy} currentTerms={terms} egress={state?.settings.egress} estimate={(term, action) => void controller.estimate(term, action)} onRunRelated={term => { void runTerm(term); }} onAddCompare={appendCompare} openSettings={handleOpenSettings} t={t} />
          : operation ? <div className="gd-loading-grid" aria-hidden="true">
            <div className="gd-card gd-skeleton-card">
              <div className="gd-skel title" />
              <div className="gd-skel sub" />
              <div className="gd-skel chart" />
              <div className="gd-skel row" />
            </div>
            <div className="gd-card gd-skeleton-card">
              <div className="gd-skel side-title" />
              <div className="gd-skel side-btn" />
              <div className="gd-skel row" />
            </div>
          </div>
          : <div className="gd-card gd-empty">
            <Icon name="chart" size={30} />
            <h3>{t('dashEmptyResult')}</h3>
            <p>{t('dashEmptyHint')}</p>
            <div className="gd-empty-chips">
              <span>{t('dashTryExamples')}</span>
              {EMPTY_EXAMPLES.map(sample => <button key={sample} type="button" className="gd-chip" disabled={busy} onClick={() => { setText(sample); keywordInput.current?.focus(); }}>{sample}</button>)}
            </div>
          </div>}
      </section>
      <section id="gd-panel-records" role="tabpanel" aria-labelledby="gd-tab-records" hidden={tab !== 'records'}>
        <div className="gd-records-bar">
          <div className="gd-mode-switch" role="group" aria-label={t('dashRecordsView')}>
            <button type="button" aria-pressed={recordsMode === 'queries'} onClick={() => setRecordsMode('queries')}>{t('dashViewByQuery')}<small>{records.length}</small></button>
            <button type="button" aria-pressed={recordsMode === 'runs'} onClick={() => setRecordsMode('runs')}>{t('dashViewByRun')}<small>{actorRuns.length}</small></button>
          </div>
          {pendingRunsCount > 0 ? <div className="gd-records-actions">
            <Button compact disabled={reconciling || loading} onClick={() => { void controller.reconcileRuns(); }}>
              <Icon name="refresh" size={13} />
              {reconciling ? t('dashSyncingPending') : t('dashSyncPending').replace('{n}', String(pendingRunsCount))}
            </Button>
          </div> : null}
        </div>
        <HistorySummaryStrip records={records} actorRuns={actorRuns} mode={recordsMode} days={days} setDays={setDays} loading={loading} refresh={() => { void refresh(); }} t={t} />
        {recordsMode === 'queries' ? <>
          <div className="gd-record-tools">
            <input className="gd-input" aria-label={t('dashSearch')} placeholder={t('dashSearch')} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
            <Picker label={t('dashAllStatus')} value={status} options={['all', 'ok', 'failed', 'no_data', 'partial'].map(value => ({ value, label: t(value === 'all' ? 'dashAllStatus' : value === 'failed' ? 'dashFailure' : statusKey[value]!) }))} onChange={value => { setStatus(value); setPage(1); }} />
            <Picker label={t('dashAllSource')} value={source} options={['all', 'manual', 'agent'].map(value => ({ value, label: t(value === 'all' ? 'dashAllSource' : value === 'manual' ? 'dashManual' : 'dashAgent') }))} onChange={value => { setSource(value); setPage(1); }} />
            <div className="gd-record-clear">
              <Button disabled={!selected.length} onClick={() => setClearing(selected)}>{t('dashClearSelected')}{selected.length ? ` (${selected.length})` : ''}</Button>
              <Button disabled={!records.length} onClick={() => setClearing(records.map(row => row.id))}>{t('dashClearAll')}</Button>
            </div>
          </div>
          <div className="gd-card gd-records gd-queries-table"><div className="gd-scroll"><table><thead><tr><th><Checkbox ariaLabel={t('dashClearSelected')} checked={allRowsSelected} indeterminate={someRowsSelected} onChange={checked => setSelected(checked ? [...new Set([...selected, ...rows.map(row => row.id)])] : selected.filter(id => !rows.some(row => row.id === id)))} /></th><th>{t('dashKeyword')}</th><th>{t('dashGeo')} / {t('dashWindow')}</th><th>{t('dashSources')}</th><th>{t('dashEgress')}</th><th className="gd-num-col">{t('dashCostCol')}</th><th>{t('dashCalledAt')}</th><th /></tr></thead><tbody>{rows.map(record => {
            const costInfo = summarizeQueryCost(runsByQuery.get(record.id) ?? []);
            return <tr key={record.id} className="gd-record-row" onClick={() => { if (!busy) void view(record.id); }}><td onClick={event => event.stopPropagation()}><Checkbox ariaLabel={`${t('dashSelected')} ${record.terms.join(', ')} ${record.id}`} checked={selected.includes(record.id)} onChange={checked => setSelected(checked ? [...selected, record.id] : selected.filter(id => id !== record.id))} /></td><td><strong>{record.terms.join(' vs ')}</strong><small>{toolLabel(record.tool, t)} · {duration(record.durationMs)}</small><span className="gd-badges"><span className={`gd-badge ${record.status}`}>{t(statusKey[record.status] ?? 'dashError')}</span>{record.cached ? <span className="gd-badge cache">{t('dashCached')}</span> : null}{record.dailyVolume != null ? <span className="gd-badge vol">{formatVolume(record.dailyVolume)}/{isZh ? '天' : 'd'}</span> : null}</span></td><td>{regionLabel(record.geo, isZh ? 'zh' : 'en')}<small>{timeLabel(record.time, t)}</small></td><td>{t(record.source === 'manual' ? 'dashManual' : 'dashAgent')}</td><td>{egressLabel(record.egress, t)}</td><td className="gd-num-col"><div className="gd-cost-cell">{record.egress === 'local' ? <><strong className="gd-cost-val muted">$0</strong><small>{t('dashRunFreeLocalSub')}</small></> : record.cached ? <><strong className="gd-cost-val muted">$0</strong><small>{t('dashRunFreeCacheSub')}</small></> : costInfo.runs.length === 0 ? <><strong className="gd-cost-val muted">—</strong><small>{t('dashRunUnused')}</small></> : costInfo.pricedCount > 0 ? <><strong className="gd-cost-val" title={exactCostTitle(costInfo.totalCost)}>{formatCostUsd(costInfo.totalCost)}</strong><small>{runCountText(costInfo.runs.length, t)}{costInfo.pendingCount > 0 ? ` · ${t('dashPendingCount').replace('{n}', String(costInfo.pendingCount))}` : ''}</small></> : <><span className="gd-badge warn">{t('dashCostPending')}</span><small>{runCountText(costInfo.runs.length, t)}</small></>}</div></td><td>{dateText(record.createdAt)}</td><td onClick={event => event.stopPropagation()}><div className="gd-actions"><Button ghost disabled={busy} onClick={() => { void view(record.id); }}>{t('dashView')}</Button><Button ghost label={`${t('dashClear')} ${record.terms.join(', ')} ${record.id}`} onClick={() => setClearing([record.id])}><Icon name="trash" size={14} /></Button></div></td></tr>;
          })}</tbody></table></div>{!rows.length ? <div className="gd-empty"><Icon name="clock" size={26} /><h3>{t(records.length ? 'dashNoMatches' : 'dashEmptyHistory')}</h3><Button primary onClick={() => setTab('query')}>{t('dashRun')}</Button></div> : null}<footer className="gd-table-footer"><span>{filtered.length} · {selected.length} {t('dashSelected')}</span><div className="gd-actions"><Button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t('dashPrevious')}</Button><span>{currentPage} / {pages}</span><Button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>{t('dashNext')}</Button></div></footer></div>
        </> : <>
          <div className="gd-record-tools">
            <input className="gd-input" aria-label={t('dashRunSearch')} placeholder={t('dashRunSearch')} value={runSearch} onChange={event => { setRunSearch(event.target.value); setRunPage(1); }} />
            <Picker label={t('dashPurposeAll')} value={runPurpose} options={[
              { value: 'all', label: t('dashPurposeAll') },
              { value: 'query', label: t('dashPurposeQuery') },
              { value: 'batch-round', label: t('dashPurposeBatch') },
              { value: 'single-retry', label: t('dashPurposeSingleRetry') },
              { value: 'estimate', label: t('dashPurposeEstimate') },
              { value: 'connection-test', label: t('dashPurposeTest') },
            ]} onChange={value => { setRunPurpose(value); setRunPage(1); }} />
            <Picker label={t('dashAllStatus')} value={runStatus} options={[
              { value: 'all', label: t('dashAllStatus') },
              { value: 'SUCCEEDED', label: t('dashRunSucceeded') },
              { value: 'FAILED', label: t('dashRunFailed') },
              { value: 'TIMED-OUT', label: t('dashRunTimedOut') },
              { value: 'ABORTED', label: t('dashRunAborted') },
            ]} onChange={value => { setRunStatus(value); setRunPage(1); }} />
            <Picker label={t('dashAllSource')} value={runSource} options={[
              { value: 'all', label: t('dashAllSource') },
              { value: 'manual', label: t('dashManual') },
              { value: 'agent', label: t('dashAgent') },
              { value: 'settings', label: t('dashSourceSettings') },
            ]} onChange={value => { setRunSource(value); setRunPage(1); }} />
          </div>
          <div className="gd-card gd-records"><div className="gd-scroll"><table><thead><tr><th>{t('dashRunTarget')}</th><th>{t('dashRunConnSource')}</th><th>{t('dashRunStatus')}</th><th className="gd-num-col">{t('dashRunDurationCol')}</th><th className="gd-num-col">{t('dashRunCostCol')}</th><th>{t('dashRunActionCol')}</th><th /></tr></thead><tbody>{visibleRuns.map(run => {
            const linkedQuery = Boolean(run.queryRecordId && recordIdSet.has(run.queryRecordId));
            const subToolNote = run.status === 'SUCCEEDED' ? toolStatusNote(run.toolStatus, t) : null;
            return <tr key={run.runId} className={linkedQuery ? 'gd-record-row' : undefined} onClick={() => { if (linkedQuery && !busy) void view(run.queryRecordId!); }}>
              <td>
                <div className="gd-run-title">
                  <span className={`gd-purpose-pill ${run.purpose}`}>{runPurposeText(run, t)}</span>
                  <strong>{run.terms.join(' vs ') || toolLabel(run.tool, t)}</strong>
                </div>
                <div className="gd-run-sub">
                  <span>{regionLabel(run.geo, isZh ? 'zh' : 'en')} · {timeLabel(run.time, t)}</span>
                  {run.anchor ? <span>· {t('dashAnchorTag')} {run.anchor}</span> : null}
                  <button type="button" className="gd-run-id-btn" title={`${t('dashCopyRunId')}: ${run.runId}`} onClick={event => { event.stopPropagation(); copyRunId(run.runId); }}>
                    {copiedRunId === run.runId ? t('dashCopiedShort') : shortRunId(run.runId)}
                  </button>
                </div>
              </td>
              <td>{egressLabel(run.egress, t)}<small>{runSourceText(run.source, t)}</small></td>
              <td>
                <span className={`gd-badge ${runStatusBadgeClass(run.status)}`}>{runStatusText(run.status, t)}</span>
                {subToolNote ? <small>{subToolNote}</small> : null}
              </td>
              <td className="gd-num-col">{run.durationMs != null ? duration(run.durationMs) : '—'}</td>
              <td className="gd-num-col">{run.costUsd !== null
                ? <strong className="gd-cost-val" title={exactCostTitle(run.costUsd)}>{formatCostUsd(run.costUsd)}</strong>
                : <span className="gd-badge warn">{t('dashCostPending')}</span>}</td>
              <td>{dateText(run.startedAt)}</td>
              <td onClick={event => event.stopPropagation()}>
                {linkedQuery
                  ? <Button ghost disabled={busy} onClick={() => { void view(run.queryRecordId!); }}>{t('dashView')}</Button>
                  : <span className="gd-muted-action">{run.purpose === 'connection-test' ? t('dashProbeOnly') : run.queryRecordId ? t('dashQueryCleared') : '—'}</span>}
              </td>
            </tr>;
          })}</tbody></table></div>{!visibleRuns.length ? <div className="gd-empty"><Icon name="clock" size={26} /><h3>{t(actorRuns.length ? 'dashNoMatches' : 'dashEmptyRuns')}</h3>{!actorRuns.length ? <p>{t('dashEmptyRunsHint')}</p> : null}<Button primary onClick={() => setTab('query')}>{t('dashRun')}</Button></div> : null}<footer className="gd-table-footer"><span>{filteredRuns.length} / {actorRuns.length}</span><div className="gd-actions"><Button disabled={currentRunPage <= 1} onClick={() => setRunPage(currentRunPage - 1)}>{t('dashPrevious')}</Button><span>{currentRunPage} / {runPages}</span><Button disabled={currentRunPage >= runPages} onClick={() => setRunPage(currentRunPage + 1)}>{t('dashNext')}</Button></div></footer></div>
        </>}
      </section>
      <footer className="gd-footer"><span>{t(tab === 'records' && recordsMode === 'runs' ? 'dashLedgerNote' : 'dashHistoryLimit')}</span>{state ? (updateMode !== 'up-to-date' ? <button type="button" className="gd-footer-ver" onClick={reopenUpdate}><span>v{state.version}</span><span className={`gd-footer-dot${actorWarnDot ? ' warn' : ''}`} /><span className={`gd-footer-tag${actorWarnDot ? ' warn' : ''}`}>{updateMode === 'actor-outdated' && versionStatus?.observedActor ? t('updateFooterActorOld').replace('{version}', versionStatus.observedActor.version) : updateFlags?.targetPluginVersion ? t('updateFooterAvailable').replace('{version}', updateFlags.targetPluginVersion) : t('updatePluginTitle')}</span></button> : <span>v{state.version}</span>) : <span>{t('dashLoading')}</span>}</footer>
      {clearing ? <ClearDialog count={clearing.length} t={t} busy={deleting} cancel={() => { if (!deleting) setClearing(null); }} confirm={() => { void clear(); }} /> : null}
      </>}
    </div>
  </div>;
}

interface Series {
  term: string;
  points: { t: string; value: number | null }[];
  average: number | null;
  latest: number | null;
  peak: number | null;
  range?: { low: number; high: number; points: VolumeBandPoint[] };
}

function volumeRows(saved: SavedQuery) {
  const { record, result, volumeChecks } = saved;
  const calibration = object(result.calibration), rows = array(calibration.series);
  return record.terms.map(term => {
    const last = [...(volumeChecks ?? [])].reverse().find(check => check.keyword === term);
    const primary = array(object(result.batchVolume).series).find(row => row.keyword === term) ?? rows.find(row => row.keyword === term) ?? (record.tool === 'trends_compare' ? {} : { traffic: result.traffic, anchor: result.anchor });
    const reading = last?.estimate ? { ...last.estimate } : primary;
    const legacy = !last?.estimate && calibration.settledOnly !== true && number(object(primary.traffic).average) !== null;
    return { term, reading, primary, last, legacy };
  });
}

export function resultSeries(saved: SavedQuery, traffic = false): Series[] {
  const data = saved.result;
  if (traffic) return volumeRows(saved).map(({ term, primary, reading, last }) => {
    const displayed = last?.estimate && !last.sameWindow ? primary : reading;
    const stats = object(displayed.traffic);
    const range = object(displayed.range), low = number(range.low), high = number(range.high);
    const values = Array.isArray(displayed.points) ? array(displayed.points)
      : !Array.isArray(data.series)
        ? array(object(data.series).points).map(point => ({ t: point.t, value: point.traffic, gap: point.gap })) : [];
    return { term, points: values.map(point => ({ t: String(point.t), value: point.gap ? null : number(point.value) })),
      average: number(stats.average), latest: number(stats.settledLatest ?? stats.latest), peak: number(stats.peak),
      ...(low !== null && high !== null ? {
        range: { low, high, points: array(range.points).map(point => ({ t: String(point.t), low: number(point.low), high: number(point.high) })) },
      } : {}) };
  });
  if (Array.isArray(data.series)) return array(data.series).map(row => {
    const points = array(row.points);
    const visible = points.some(point => (number(point.value) ?? 0) > 0);
    return { term: String(row.keyword), points: points.map(point => ({ t: String(point.t), value: visible && !point.gap ? number(point.value) : null })),
      average: visible ? number(row.average) : null, latest: visible ? number(row.latest) : null, peak: visible ? number(row.peak) : null };
  });
  const points = array(object(data.series).points ?? object(data.interest).points).map(row => ({ t: String(row.t), value: row.gap ? null : number(row.score ?? row.value) }));
  const visible = points.some(point => (point.value ?? 0) > 0);
  const usable = visible ? points.flatMap(point => point.value === null ? [] : [point.value]) : [];
  const stats = object(data.interest);
  return [{ term: saved.record.terms.join(', '), points: visible ? points : points.map(point => ({ ...point, value: null })),
    average: usable.length ? number(stats.average) ?? usable.reduce((a, b) => a + b, 0) / usable.length : null,
    latest: usable.length ? number(stats.settledLatest ?? stats.latest) ?? usable.at(-1)! : null,
    peak: usable.length ? number(stats.peak) ?? Math.max(...usable) : null }];
}

const reasonKey: Record<string, string> = { baseline: 'dashVolumeNoBaseline', capacity: 'dashVolumeCapacity', window: 'dashVolumeLongWindow',
  samples: 'dashEstimateMissing', anchor: 'dashVolumeWeakAnchor', disagreement: 'dashVolumeDisagreement' };

type EstimateAction = (term: string, action?: 'restore' | 'batch') => void;

function VolumeCards({ saved, t, egress, estimate, busy }: { saved: SavedQuery; t: Translate; egress?: EgressMode; estimate: EstimateAction; busy: boolean }) {
  const { record, result } = saved;
  if (!result.ok) {
    const calibration = object(result.calibration);
    const batch = result.batchVolume as BatchResult | undefined;
    const hasCalibration = Array.isArray(calibration.series) && calibration.series.length > 0;
    const hasBatch = Boolean(batch?.series?.some(item => item.traffic?.average != null));
    const hasFollowUps = Array.isArray(saved.volumeChecks) && saved.volumeChecks.some(c => c.estimate?.traffic?.average != null || c.estimate?.range);
    if (!hasCalibration && !hasBatch && !hasFollowUps) return null;
  }
  if (result.onDemand && result.ok && supportsVolumeWindow(record.time)) {
    const batch = result.batchVolume as BatchResult | undefined;
    const current = batch?.rounds.at(-1);
    const running = busy && batch && !batch.complete && !batch.error;
    const singleHero = record.terms.length === 1;
    return <section className="gd-estimate" aria-live="polite">
      <h4>{t('dashDailyVolume')}</h4>
      {running && current && <p role="status" className="gd-estimate-step"><span className="gd-spinner"><Icon name="refresh" size={14} /></span>{t('dashRound')} {current.round} · {current.targets.join('、')}</p>}
      {batch && record.terms.map((term, index) => {
        const reading = batch.series.find(item => item.keyword === term);
        const daily = reading?.traffic.average;
        const round = [...batch.rounds].reverse().find(step => step.targets.includes(term));
        if (batch.error && daily == null && !reading?.below) return null;
        const anchor = reading?.anchor?.term ?? round?.anchor;
        const value = daily != null ? '≈ ' + formatNumber(daily) + ' ' + t('dashPerDay')
          : reading?.below ? t('dashBelowFloor') + '（' + formatNumber(reading.below) + ' ' + t('dashPerDay') + '）'
          : running ? t('dashPhaseCalibrating') : t(reasonKey[reading?.reason ?? 'samples'] ?? 'dashEstimateMissing');
        return <div className="gd-estimate-line" key={term}>
          <span className="gd-estimate-term"><i style={{ background: colors[index] }} />{term}</span>
          <div><strong className={daily == null ? 'gd-muted' : singleHero ? 'hero' : undefined}>{value}</strong>
            {reading?.reused ? <small>{t('dashCached')}</small> : reading?.via || anchor ? <small>{t(reading?.via ? 'dashVia' : 'dashEstimateAnchor')} · {reading?.via ?? anchor}</small> : null}
          </div>
        </div>;
      })}
      {batch && batch.rounds.length > 0 && <div className="gd-anchor-list">
        <div className="gd-anchor-head"><b>{t('dashEstimateAnchor')}</b><small>{t('dashAnchorBaseline')}</small></div>
        {batch.rounds.map(step => <div className="gd-anchor-line" key={step.round}>
          <span className="gd-anchor-round">R{step.round}</span>
          <div><b>{step.anchor}</b>{record.terms.length > 1 && <small>{step.targets.join('、')}</small>}{step.error && <small>{step.error}</small>}</div>
          <span>{formatNumber(step.daily)} {t('dashPerDay')}</span>
        </div>)}
        <div className="gd-anchor-source">
          <span>{t('dashAnchorSource')}</span>
          <a href={BASELINE_REFERENCE_URL} target="_blank" rel="noopener noreferrer" title={BASELINE_REFERENCE_URL}>
            {t('dashAnchorSourceLink')}
            <Icon name="external" size={11} />
          </a>
        </div>
      </div>}
      {batch?.error && <p role="alert" className="gd-error-code">{t(batch.error === 'NETWORK_ERROR' ? 'dashBatchNetwork' : 'dashEstimateFailed')} · {batch.error}</p>}
      {(!batch?.complete || batch.error) && !running && <button type="button" className="gd-button primary gd-estimate-action" disabled={busy || !record.id} onClick={() => estimate('', 'batch')}>{t(batch?.error ? 'dashRetryEstimate' : 'dashBatchEstimate')}</button>}
    </section>;
  }
  if (record.tool !== 'trends_compare' && record.tool !== 'trends_snapshot' && !result.onDemand) return null;
  const showChecks = Boolean(result.ok) && record.status !== 'blocked' && supportsVolumeWindow(record.time);
  const volume = volumeRows(saved);
  if (!supportsVolumeWindow(record.time) && !volume.some(({ legacy }) => legacy)) {
    return <p className="gd-volume-note">{t('dashVolumeLongWindow')}</p>;
  }
  return <div className="gd-volume-list">
    <span>{t('dashCompareVolume')}</span>
    {volume.map(({ term, reading, last, legacy }) => {
      const average = number(object(reading.traffic).average), reference = object(reading.anchor).term;
      const range = object(reading.range), low = number(range.low), high = number(range.high), period = object(reading.period);
      const reason = String(reading.reason ?? object(result.calibration).reasonCode ?? '');
      const legacyBand = last?.estimate?.range && !last.estimate.range.points;
      const restore = Boolean(legacyBand && last?.actorRunId);
      const adaptive = Array.isArray(object(result.calibration).rounds);
      const compactRange = adaptive && low !== null && high !== null && low > 0 && high <= 3 * low;
      const canCheck = !adaptive && showChecks && Boolean(record.id) &&
        (restore || ((!last || last.errorCode || (legacyBand && last.egress === 'local')) && (average === null || legacy) && reason !== 'baseline'));
      const button = restore ? 'dashRestoreCurve' : last?.errorCode ? 'dashRetryEstimate' : legacy || legacyBand ? 'dashReestimate' : 'dashEstimateTerm';
      return <div className="gd-volume-row" key={term}>
        <span>{term}</span>
        <strong>{compactRange ? formatVolume(Number(Math.sqrt(low! * high!).toPrecision(1))) : low !== null && high !== null ? compactVolume.format(low) + '–' + compactVolume.format(high) : formatVolume(average)}</strong>
        {average !== null && typeof reference === 'string' ? <small>{t('dashEstimateAnchor')} · {reference}{legacy ? ' · ' + t('dashEstimateLegacy') : ''}</small> : null}
        {low !== null && high !== null ? <small>{compactRange ? formatNumber(low) + '–' + formatNumber(high) + ' · ' : ''}{t('dashVolumeDisagreement')} · {Array.isArray(range.anchors) ? range.anchors.join(' / ') : ''}</small> : null}
        {average === null && low === null ? <small>{t(reasonKey[reason] ?? (result.ok ? 'dashEstimateMissing' : 'dashUnavailable'))}</small> : null}
        {adaptive && object(result.calibration).retryError ? <small role="alert">{t(object(result.calibration).retryError === 'WINDOW_MISMATCH' ? 'dashEstimateNewWindow' : 'dashEstimateFailed')}</small> : null}
        {last?.errorCode ? <small role="alert">{t(last.errorCode === 'BLOCKED' || last.errorCode === 'RATE_LIMITED' ? 'dashEstimateBlocked' : 'dashEstimateFailed')}</small> : null}
        {last?.estimate && typeof period.from === 'string' && typeof period.to === 'string' ?
          <small>{t(last.sameWindow ? 'dashEstimateSaved' : 'dashEstimateNewWindow')} · {dateText(period.from, true)} – {dateText(period.to, true)}</small> : null}
        {canCheck ? <div className="gd-volume-action">
          <Button disabled={busy || !egress} onClick={() => estimate(term, restore ? 'restore' : undefined)} label={t(button) + ' · ' + term}>{t(button)}</Button>
          {restore ? <small>{t('dashRestoreSource')}</small> : egress && egress !== 'local' ? <small>{t('dashEstimateCost')}</small> : null}
        </div> : null}
      </div>;
    })}
    <small>{t('dashEstimateNote')}</small>
    <div className="gd-anchor-source">
      <span>{t('dashAnchorSource')}</span>
      <a href={BASELINE_REFERENCE_URL} target="_blank" rel="noopener noreferrer" title={BASELINE_REFERENCE_URL}>
        {t('dashAnchorSourceLink')}
        <Icon name="external" size={11} />
      </a>
    </div>
  </div>;
}

function LocalFailureBanner({ errorCode, t, openSettings }: {
  errorCode: string | null; t: Translate; openSettings?: () => void;
}) {
  const titleKey = errorCode === 'RATE_LIMITED'
    ? 'dashLocalFailRateLimited'
    : errorCode === 'BLOCKED'
      ? 'dashLocalFailBlocked'
      : 'dashLocalFailGeneric';
  return <section className="gd-local-alert" role="alert">
    <div className="gd-local-alert-main">
      <span className="gd-local-alert-icon"><Icon name="alert" size={17} /></span>
      <div className="gd-local-alert-copy">
        <div className="gd-local-alert-head">
          <h3>{t(titleKey)}</h3>
          {errorCode ? <span className="gd-local-alert-code">{errorCode}</span> : null}
        </div>
        <p>{t('dashLocalFailBody')}</p>
      </div>
    </div>
    <button type="button" className="gd-button primary gd-local-alert-cta" disabled={!openSettings} onClick={openSettings}>
      <Icon name="sliders" size={14} />{t('dashLocalFailCta')}
    </button>
  </section>;
}

function Result({ saved, actorRuns, metric, setMetric, t, egress, estimate, busy, currentTerms, onRunRelated, onAddCompare, openSettings }: {
  saved: SavedQuery; actorRuns: ActorRunRecord[]; metric: string; setMetric: (v: string) => void; t: Translate; egress?: EgressMode; estimate: EstimateAction; busy: boolean;
  currentTerms: string[]; onRunRelated?: (term: string) => void; onAddCompare?: (term: string) => void; openSettings?: () => void;
}) {
  const { record, result } = saved, meta = object(result.meta);
  const costInfo = summarizeQueryCost(actorRuns);
  const costSummaryValue = record.egress === 'local'
    ? t('dashRunFreeLocal')
    : record.cached
      ? t('dashRunFreeCache')
      : costInfo.runs.length === 0
        ? t('dashRunUnused')
        : costInfo.pricedCount > 0
          ? `${runCountText(costInfo.runs.length, t)} · ${formatCostUsd(costInfo.totalCost)}`
          : `${runCountText(costInfo.runs.length, t)} · ${t('dashCostPending')}`;
  const [focused, focusTerm] = useState<string | null>(null);
  const [relatedTab, setRelatedTab] = useState<'popular' | 'rising'>('popular');
  const [copied, setCopied] = useState(false);
  const interestSeries = resultSeries(saved);
  const trafficSeries = resultSeries(saved, true), hasTraffic = trafficSeries.some(row => row.average !== null || row.range);
  const currentMetric = metric === 'traffic' && hasTraffic ? 'traffic' : 'interest';
  const series = currentMetric === 'traffic' ? trafficSeries : interestSeries;
  const legend = series.map((row, index) => ({ ...row, color: colors[index]! }));
  const chartSeries = legend.filter(hasChartPoints);
  const visible = focused && chartSeries.some(row => row.term === focused) ? chartSeries.filter(row => row.term === focused) : chartSeries;
  const format = currentMetric === 'traffic' ? formatVolume : formatNumber;
  const comparison = record.tool === 'trends_compare';
  const warnings = [...new Set([...arrayOfStrings(meta.warnings), ...arrayOfStrings(result.warnings)])];
  const error = object(result.error), tables = object(result.tables);
  const errorCode = typeof error.code === 'string' ? error.code : null;
  const errorMessage = typeof error.message === 'string' ? error.message : null;
  const isLocalFailure = !result.ok && record.egress === 'local' && errorCode !== 'INVALID_INPUT';
  const showLocalSwitchBanner = isLocalFailure && (!egress || egress === 'local');
  const failedEmpty = !result.ok && chartSeries.length === 0;
  const hasRelated = !comparison && (array(tables.popular).length > 0 || array(tables.rising).length > 0);
  const isZh = t('dashGeo') === '地区';

  const copySummary = () => {
    const header = `${record.terms.join(' vs ')} (${regionLabel(record.geo, isZh ? 'zh' : 'en')} · ${timeLabel(record.time, t)})`;
    const lines = interestSeries.map((row, index) => {
      const vol = trafficSeries[index];
      const est = vol?.range ? `${compactVolume.format(vol.range.low)}–${compactVolume.format(vol.range.high)} ${t('dashPerDay')}`
        : vol?.average != null ? `≈ ${Math.round(vol.average).toLocaleString()} ${t('dashPerDay')}` : null;
      return `- ${row.term}: ${t('dashAverage')} ${formatNumber(row.average)}, ${t('dashLatest')} ${formatNumber(row.latest)}, ${t('dashPeak')} ${formatNumber(row.peak)}${est ? ` | ${est}` : ''}`;
    });
    const payload = [header, ...lines].join('\n');
    void navigator.clipboard?.writeText?.(payload).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  const downloadCsv = () => {
    const timestamps = [...new Set(series.flatMap(row => row.points.map(point => point.t)))].sort();
    const header = ['timestamp', ...series.map(row => currentMetric === 'traffic' ? `${row.term} (${t('dashPerDay')})` : row.term)];
    const lines = [header.map(csvCell).join(','), ...timestamps.map(ts => {
      const values = series.map(row => row.points.find(point => point.t === ts)?.value ?? '');
      return [ts, ...values].map(csvCell).join(',');
    })];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trends-${record.terms.join('-').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_').slice(0, 48)}-${record.geo || 'world'}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (record.tool === 'trends_now') return <div className="gd-results">{showLocalSwitchBanner ? <LocalFailureBanner errorCode={errorCode} t={t} openSettings={openSettings} /> : null}<div className="gd-toolbar"><div><h2>{t('dashNow')} <Badge record={record} t={t} /></h2><p>{record.geo} · {record.time} · {t('dashReadSaved')}</p></div></div><div className="gd-related">{array(result.byGeo).map((region, index) => <article className="gd-card" key={index}><h3>{regionLabel(String(region.geo), isZh ? 'zh' : 'en')}</h3>{array(region.items).map((item, i) => <p key={i}><span>{i + 1}. {String(item.title ?? item.query ?? '')}</span><strong>{String(item.trafficLabel ?? item.traffic ?? '—')}</strong></p>)}{!array(region.items).length ? <p className="gd-muted">{t('dashUnavailable')}</p> : null}</article>)}</div>{errorMessage && !isLocalFailure ? <p className="gd-error" role="alert">{errorMessage}</p> : null}</div>;
  const showLegend = !failedEmpty && (legend.length > 1 || legend.some(row => !hasChartPoints(row) || row.range?.points.length));
  return <div className="gd-results">
    {showLocalSwitchBanner ? <LocalFailureBanner errorCode={errorCode} t={t} openSettings={openSettings} /> : null}
    <div className="gd-result-grid">
      <article className="gd-card gd-chart-card">
        <div className="gd-result-head">
          <div className="gd-result-title-block">
            <div className="gd-result-title-row"><h2>{record.terms.join(' vs ')}</h2><Badge record={record} t={t} /></div>
            <div className="gd-result-meta">
              <span>{t(currentMetric === 'traffic' ? 'dashMetricVolume' : 'dashMetricIndex')}</span><span>·</span>
              <span>{regionLabel(record.geo, isZh ? 'zh' : 'en')}</span><span>·</span>
              <span>{timeLabel(record.time, t)}</span><span>·</span>
              <span>{egressLabel(record.egress, t)}</span><span>·</span>
              <span>{duration(record.durationMs)}</span>
              {record.egress === 'local'
                ? <><span>·</span><span>{t('dashRunFreeLocal')}</span></>
                : record.cached
                  ? <><span>·</span><span>{t('dashRunFreeCache')}</span></>
                  : costInfo.runs.length > 0
                    ? <><span>·</span><span className="gd-meta-cost" title={costInfo.pricedCount > 0 ? exactCostTitle(costInfo.totalCost) : undefined}>{costInfo.pricedCount > 0 ? `${runCountText(costInfo.runs.length, t)} · ${formatCostUsd(costInfo.totalCost)}` : `${runCountText(costInfo.runs.length, t)} · ${t('dashCostPending')}`}</span></>
                    : null}
            </div>
          </div>
          {!failedEmpty ? <div className="gd-result-tools">
            {(!result.onDemand || hasTraffic) && <div className="gd-metric-switch">{(['interest', 'traffic'] as const).map(value =>
              <button type="button" key={value} aria-pressed={currentMetric === value} disabled={value === 'traffic' && !hasTraffic}
                onClick={() => { focusTerm(null); setMetric(value); }}>{t(value === 'interest' ? 'dashInterest' : 'dashTraffic')}</button>
            )}</div>}
            <Button compact ghost onClick={copySummary} title={t('dashCopySummary')}>{copied ? t('dashCopiedSummary') : t('dashCopySummary')}</Button>
            {chartSeries.length > 0 ? <Button compact ghost onClick={downloadCsv} title={t('dashExportCsv')}>{t('dashExportCsv')}</Button> : null}
          </div> : null}
        </div>
        {showLegend ? <div className="gd-legend gd-chart-legend">
          {legend.map(row => {
            const available = hasChartPoints(row);
            const marker = <><i className={row.range?.points.length ? 'gd-band-marker' : undefined} style={{ color: row.color }} />{row.term}</>;
            if (!available) return <span key={row.term} className="gd-legend-missing">{marker}
              <small>{t(currentMetric === 'interest' && comparison ? 'dashNoSharedSeries' : 'dashNoCurve')}</small></span>;
            if (chartSeries.length === 1) return <span key={row.term}>{marker}{row.range?.points.length ? <small>{t('dashAnchorBand')}</small> : null}</span>;
            return <button key={row.term} type="button" aria-pressed={visible.some(item => item.term === row.term)}
              onClick={() => focusTerm(focused === row.term ? null : row.term)}>
              {marker}{row.range?.points.length ? <small>{t('dashAnchorBand')}</small> : null}
            </button>;
          })}
        </div> : null}
        {failedEmpty ? <div className="gd-failed-empty">
          <span className="gd-failed-empty-icon"><Icon name="chart" size={20} /></span>
          <h4>{t('dashFailedEmptyTitle')}</h4>
          <p>{t(showLocalSwitchBanner ? 'dashFailedEmptyHintLocal' : isLocalFailure ? 'dashFailedEmptyHintSwitched' : 'dashFailedEmptyHintActor')}</p>
          <div className="gd-failed-terms">
            {record.terms.map((term, index) => <span key={term}><i style={{ background: colors[index] }} />{term}</span>)}
          </div>
        </div> : <>
          <TrendChart perDay={t('dashPerDay')} series={visible} traffic={currentMetric === 'traffic'}
            label={t(currentMetric === 'traffic' ? 'dashTraffic' : 'dashTrend')} empty={t('dashUnavailable')} logLabel={t('dashLogScale')} />
          {currentMetric === 'interest' && object(result.calibration).weakComparison === true ?
            <p className="gd-chart-note">{t('dashWeakComparison')}</p> : null}
          <table className="gd-result-stats"><thead><tr><th>{t('dashKeyword')}</th>
            <th>{t('dashAverage')}</th><th>{t(currentMetric === 'traffic' ? 'dashLatestUsable' : 'dashLatest')}</th><th>{t('dashPeak')}</th>
            {hasTraffic && currentMetric === 'interest' ? <th>{t('dashVolumeEstimate')}</th> : null}
          </tr></thead><tbody>{series.map((row, index) => {
            const vol = trafficSeries[index];
            return <tr key={row.term}>
              <td><span className="gd-stat-term"><i style={{ background: colors[index] }} />{row.term}</span></td>
              <td>{row.range ? compactVolume.format(row.range.low) + '–' + compactVolume.format(row.range.high) : format(row.average)}</td>
              <td>{format(row.latest)}</td>
              <td>{format(row.peak)}</td>
              {hasTraffic && currentMetric === 'interest' ? <td className={vol?.average != null ? 'gd-stat-vol' : 'gd-muted'}>{vol?.range ? compactVolume.format(vol.range.low) + '–' + compactVolume.format(vol.range.high) : formatVolume(vol?.average)}</td> : null}
            </tr>;
          })}</tbody></table>
        </>}
      </article>
      <aside className="gd-side-stack">
        <div className="gd-card gd-result-info">
          <VolumeCards saved={saved} t={t} busy={busy} egress={egress} estimate={estimate} />
          {!result.ok && errorCode ? <div className="gd-status-box">
            <span>{t('dashQueryStatus')}</span>
            <span className="gd-badge blocked">{errorCode}</span>
          </div> : null}
          <details className="gd-query-details" open={!result.ok}><summary><span>{t('dashQueryDetails')}</span><svg className="gd-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></summary><dl>{[[t('dashFetchedAt'), dateText(record.fetchedAt, true)], [t('dashCalledAt'), dateText(record.createdAt, true)], [t('dashRunDuration'), duration(record.durationMs)], [t('dashEgress'), egressLabel(record.egress, t)], [t('dashSources'), t(record.source === 'manual' ? 'dashManual' : 'dashAgent')], [t('dashDetailActorCost'), costSummaryValue], ...(errorMessage ? [[t('dashRawErrorLabel'), errorMessage]] : [])].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{costInfo.runs.length > 0 ? <div className="gd-detail-runs"><span className="gd-detail-runs-head">{t('dashDetailRunsList')} ({costInfo.runs.length})</span>{costInfo.runs.map(item => <div className="gd-detail-run-row" key={item.runId}><span className="gd-detail-run-meta"><span>{runPurposeText(item, t)}{item.anchor ? ` · ${t('dashAnchorTag')} ${item.anchor}` : ''}</span><code>{shortRunId(item.runId)}</code></span><span className="gd-detail-run-cost" title={exactCostTitle(item.costUsd)}>{item.costUsd !== null ? formatCostUsd(item.costUsd) : t('dashCostPending')}</span></div>)}</div> : null}</details>
        </div>
        {hasRelated ? <div className="gd-card gd-related-card">
          <div className="gd-related-head">
            <h3>{t('dashRelated')}</h3>
            <div className="gd-related-tabs" role="tablist">
              {(['popular', 'rising'] as const).map(key => <button key={key} type="button" role="tab" aria-selected={relatedTab === key} onClick={() => setRelatedTab(key)}>{t(key === 'popular' ? 'dashPopularShort' : 'dashRisingShort')}</button>)}
            </div>
          </div>
          <div className="gd-related-list">
            {array(tables[relatedTab]).slice(0, 8).map((row, i) => {
              const term = String(row.query ?? '');
              const rawVal = number(row.value);
              const barPct = relatedTab === 'popular' && rawVal !== null ? Math.max(4, Math.min(100, rawVal)) : 0;
              const canAdd = Boolean(term && onAddCompare && currentTerms.length < 5 && !currentTerms.some(item => item.toLowerCase() === term.toLowerCase()));
              return <div className="gd-related-row" key={i}>
                {barPct > 0 ? <i className="gd-related-bar" style={{ width: `${barPct}%` }} aria-hidden="true" /> : null}
                <span className="gd-related-rank" aria-hidden="true">{i + 1}</span>
                <button type="button" className="gd-related-term" disabled={busy || !term} onClick={() => term && onRunRelated?.(term)}><span>{term}</span></button>
                <strong className={relatedTab === 'rising' ? 'rising' : undefined}>{String(row.formattedValue ?? row.value ?? '—')}</strong>
                {canAdd ? <button type="button" className="gd-related-add" disabled={busy} aria-label={`${t('dashAddCompare')} ${term}`} title={t('dashAddCompare')} onClick={() => onAddCompare?.(term)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </button> : null}
              </div>;
            })}
          </div>
          {!array(tables[relatedTab]).length ? <p className="gd-muted" style={{ fontSize: 12, padding: '8px 4px' }}>{t('dashNoRelated')}</p> : null}
        </div> : null}
      </aside>
    </div>
    {errorMessage && !isLocalFailure ? <p className="gd-error" role="alert">{errorMessage}</p> : null}
    {warnings.length ? <details className="gd-warnings"><summary>{t('dashResultInfo')} · {warnings.length}</summary>{warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details> : null}
  </div>;
}
const arrayOfStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function ClearDialog({ count, t, busy, cancel, confirm }: { count: number; t: Translate; busy: boolean; cancel: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog className="gd-dialog" ref={dialog} onCancel={event => { event.preventDefault(); cancel(); }} onClick={event => { if (event.target === event.currentTarget) cancel(); }} aria-label={t('dashClearTitle')}><div onClick={event => event.stopPropagation()}><Icon name="trash" size={22} /><h2>{t('dashClearTitle')}</h2><p className="gd-clear-count">{count}</p><p>{t('dashClearNote')}</p><div className="gd-dialog-actions"><Button disabled={busy} onClick={cancel}>{t('dashCancel')}</Button><Button disabled={busy} onClick={confirm}>{busy ? t('dashLoading') : t('dashConfirm')}</Button></div></div></dialog>;
}
