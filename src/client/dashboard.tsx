import type { BatchResult } from '../batch-types.js';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ChoicePicker } from './choice-picker.js';
import { Icon } from './icons.js';
import { SETTINGS_CSS } from './theme.js';
import { DASHBOARD_CSS } from './dashboard-theme.js';
import { GEO_CODES, regionLabel, type EgressMode } from '../options.js';
import type { QueryRecord, SavedQuery } from '../query-history-types.js';
import { DashboardController, dashboardRequest, queryKeywords } from './dashboard-state.js';
import type { QueryProgress } from '../query-progress.js';
import { supportsVolumeWindow, type VolumeBandPoint } from '../volume-types.js';
import { TrendChart, hasChartPoints } from './trend-chart.js';

type Translate = (key: string) => string;
const TIME_KEYS = [['now 1-H', 'dashTime1h'], ['now 4-H', 'dashTime4h'], ['now 1-d', 'dashTime24h'], ['now 7-d', 'dashTime7d'],
  ['today 1-m', 'dashTime1m'], ['today 3-m', 'dashTime3m'], ['today 12-m', 'dashTime1y'], ['today 5-y', 'dashTime5y'], ['all', 'dashTimeAll']] as const;
const colors = ['#2563eb', '#7c3aed', '#0d9488', '#d97706', '#e11d48'];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const array = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(object) : [];
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
const percent = (part: number, total: number) => total ? `${(part / total * 100).toFixed(1)}%` : '—';
const compactVolume = new Intl.NumberFormat(undefined, { notation: 'compact', maximumSignificantDigits: 2 });
const formatVolume = (value: unknown) => {
  const amount = number(value);
  return amount === null ? '—' : '≈ ' + compactVolume.format(amount);
};
const formatNumber = (value: unknown) => number(value)?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '—';
const timeLabel = (time: string, t: Translate) => { const key = TIME_KEYS.find(row => row[0] === time)?.[1]; return key ? t(key) : time; };
const egressLabel = (egress: EgressMode, t: Translate) => t(egress === 'local' ? 'dashLocal' : egress === 'actor-public' ? 'dashPublic' : 'dashOwn');
const statusKey: Record<string, string> = { ok: 'dashOk', error: 'dashError', blocked: 'dashBlocked', no_data: 'dashNoData', partial: 'dashPartial' };
const dateText = (raw: string | null, full = false) => raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toLocaleString(undefined,
  full ? { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export function TrendsMark({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#2563eb" /><path d="m14 42 10-13a3 3 0 0 1 4.7 0l5.1 6.6a2.9 2.9 0 0 0 4.9-.5L49 17" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="49" cy="17" r="4.4" fill="#99f6e4" /></svg>;
}

function Button({ children, onClick, disabled, primary, ghost, compact, label }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; ghost?: boolean; compact?: boolean; label?: string;
}) {
  return <button type="button" className={`gd-button${primary ? ' primary' : ''}${ghost ? ' ghost' : ''}${compact ? ' compact' : ''}`} disabled={disabled} onClick={onClick} aria-label={label}>{children}</button>;
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

export function Dashboard({ t, openSettings, controller: supplied }: { t: Translate; openSettings?: () => void; controller?: DashboardController }) {
  const own = useRef<DashboardController | null>(null);
  if (!supplied && !own.current) own.current = new DashboardController();
  const controller = supplied ?? own.current!;
  const stateView = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { tab, state, loading, error, fieldError, days, text, geo, time, reuse, result, metric, search, status, source, page, selected, operation } = stateView;
  const setTab = (value: typeof tab) => controller.set('tab', value);
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
  const [clearing, setClearing] = useState<string[] | null>(null), [deleting, setDeleting] = useState(false);
  const keywordInput = useRef<HTMLInputElement>(null);
  const busy = operation !== null, terms = queryKeywords(text);
  const refresh = () => controller.refresh();
  useEffect(() => {
    void controller.refresh();
    const focus = () => { void controller.refresh(); };
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('focus', focus); if (!supplied) controller.dispose(); };
  }, [controller, supplied]);
  const run = async () => { if (!await controller.run()) keywordInput.current?.focus(); };
  const view = (id: string) => controller.view(id);
  const clear = async () => {
    if (!clearing || deleting) return;
    setDeleting(true);
    try { await dashboardRequest('', { action: 'clear', ids: clearing }); controller.clearResult(clearing); setClearing(null); await refresh(); }
    catch { controller.set('error', 'dashFailed'); }
    finally { setDeleting(false); }
  };
  const records = state?.records ?? [];
  const filtered = records.filter(record => (!search || record.terms.join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && (source === 'all' || source === record.source) && (status === 'all' || (status === 'failed' ? ['blocked', 'error'].includes(record.status) : status === record.status)));
  const pages = Math.max(1, Math.ceil(filtered.length / 10)), currentPage = Math.min(page, pages), rows = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const allRowsSelected = Boolean(rows.length) && rows.every(row => selected.includes(row.id));
  const someRowsSelected = rows.some(row => selected.includes(row.id)) && !allRowsSelected;
  const isZh = t('dashGeo') === '地区';
  return <div className="gtfa-settings gtfa-dashboard"><style>{SETTINGS_CSS + DASHBOARD_CSS}</style>
    <header className="gd-topbar">
      <div className="gd-brand"><TrendsMark size={28} /><h1>Google Trends</h1></div>
      <nav className="gd-tabs" role="tablist" aria-label="Google Trends" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const tabs = ['overview', 'query', 'records'] as const, index = tabs.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
        setTab(tabs[next]!); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
      }}>{(['overview', 'query', 'records'] as const).map(key => <button type="button" role="tab" id={`gd-tab-${key}`} aria-controls={`gd-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} key={key} onClick={() => { setTab(key); void refresh(); }}>{t(key === 'overview' ? 'dashOverview' : key === 'query' ? 'dashQuery' : 'dashRecords')}{key === 'records' ? <small>{records.length}</small> : null}</button>)}</nav>
      <div className="gd-topbar-right">
        {state ? <button type="button" className="gd-route-pill" disabled={!openSettings} onClick={openSettings}><i className="gd-route-dot" />{egressLabel(state.settings.egress, t)}</button> : null}
        <Button compact disabled={!openSettings} onClick={openSettings}><Icon name="sliders" size={14} />{t('dashSettings')}</Button>
      </div>
    </header>
    <div className="gd-workspace">
      {error ? <div className="gd-error" role="alert">{t(error)}<Button compact disabled={loading} onClick={() => { void refresh(); }}>{t('dashRefresh')}</Button></div> : null}
      {operation && tab !== 'query' ? <QueryProgressCard operation={operation} t={t} cancel={controller.cancel} /> : null}
      <section id="gd-panel-overview" role="tabpanel" aria-labelledby="gd-tab-overview" hidden={tab !== 'overview'}>
        <div className="gd-toolbar"><div><h2>{t('dashUsage')}</h2></div><div className="gd-actions"><Picker label={t('dashWindow')} value={String(days)} options={[{ value: '7', label: t('dash7') }, { value: '30', label: t('dash30') }]} onChange={value => setDays(Number(value))} /><Button compact disabled={loading} onClick={() => { void refresh(); }}><Icon name="refresh" size={14} />{t('dashRefresh')}</Button></div></div>
        <Overview records={records} days={days} t={t} />
      </section>
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
        {result ? <Result key={result.record.id} saved={operation?.batch && operation.recordId === result.record.id ? { ...result, result: { ...result.result, batchVolume: operation.batch } } : result} metric={metric} setMetric={setMetric} busy={busy} egress={state?.settings.egress} estimate={(term, action) => void controller.estimate(term, action)} onPickRelated={term => { setText(term); keywordInput.current?.focus(); }} t={t} /> : <div className="gd-card gd-empty"><Icon name="chart" size={30} /><h3>{t('dashEmptyResult')}</h3><p>{t('dashEmptyHint')}</p></div>}
      </section>
      <section id="gd-panel-records" role="tabpanel" aria-labelledby="gd-tab-records" hidden={tab !== 'records'}>
        <div className="gd-record-tools">
          <input className="gd-input" aria-label={t('dashSearch')} placeholder={t('dashSearch')} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
          <Picker label={t('dashAllStatus')} value={status} options={['all', 'ok', 'failed', 'no_data', 'partial'].map(value => ({ value, label: t(value === 'all' ? 'dashAllStatus' : value === 'failed' ? 'dashFailure' : statusKey[value]!) }))} onChange={value => { setStatus(value); setPage(1); }} />
          <Picker label={t('dashAllSource')} value={source} options={['all', 'manual', 'agent'].map(value => ({ value, label: t(value === 'all' ? 'dashAllSource' : value === 'manual' ? 'dashManual' : 'dashAgent') }))} onChange={value => { setSource(value); setPage(1); }} />
          <div className="gd-record-clear">
            <Button disabled={!selected.length} onClick={() => setClearing(selected)}>{t('dashClearSelected')}{selected.length ? ` (${selected.length})` : ''}</Button>
            <Button disabled={!records.length} onClick={() => setClearing(records.map(row => row.id))}>{t('dashClearAll')}</Button>
          </div>
        </div>
        <div className="gd-card gd-records"><div className="gd-scroll"><table><thead><tr><th><Checkbox ariaLabel={t('dashClearSelected')} checked={allRowsSelected} indeterminate={someRowsSelected} onChange={checked => setSelected(checked ? [...new Set([...selected, ...rows.map(row => row.id)])] : selected.filter(id => !rows.some(row => row.id === id)))} /></th><th>{t('dashKeyword')}</th><th>{t('dashGeo')} / {t('dashWindow')}</th><th>{t('dashSources')}</th><th>{t('dashEgress')}</th><th>{t('dashCalledAt')}</th><th /></tr></thead><tbody>{rows.map(record => <tr key={record.id}><td><Checkbox ariaLabel={`${t('dashSelected')} ${record.terms.join(', ')} ${record.id}`} checked={selected.includes(record.id)} onChange={checked => setSelected(checked ? [...selected, record.id] : selected.filter(id => id !== record.id))} /></td><td><strong>{record.terms.join(' vs ')}</strong><small>{record.tool.replace('trends_', '')} · {duration(record.durationMs)}</small><Badge record={record} t={t} /></td><td>{regionLabel(record.geo, isZh ? 'zh' : 'en')}<small>{timeLabel(record.time, t)}</small></td><td>{t(record.source === 'manual' ? 'dashManual' : 'dashAgent')}</td><td>{egressLabel(record.egress, t)}</td><td>{dateText(record.createdAt)}</td><td><div className="gd-actions"><Button ghost disabled={busy} onClick={() => { void view(record.id); }}>{t('dashView')}</Button><Button ghost label={`${t('dashClear')} ${record.terms.join(', ')} ${record.id}`} onClick={() => setClearing([record.id])}><Icon name="trash" size={14} /></Button></div></td></tr>)}</tbody></table></div>{!rows.length ? <div className="gd-empty"><Icon name="clock" size={26} /><h3>{t(records.length ? 'dashNoMatches' : 'dashEmptyHistory')}</h3><Button primary onClick={() => setTab('query')}>{t('dashRun')}</Button></div> : null}<footer className="gd-table-footer"><span>{filtered.length} · {selected.length} {t('dashSelected')}</span><div className="gd-actions"><Button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t('dashPrevious')}</Button><span>{currentPage} / {pages}</span><Button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>{t('dashNext')}</Button></div></footer></div>
      </section>
      <footer className="gd-footer"><span>{t('dashHistoryLimit')}</span><span>{state ? `v${state.version}` : t('dashLoading')}</span></footer>
      {clearing ? <ClearDialog count={clearing.length} t={t} busy={deleting} cancel={() => { if (!deleting) setClearing(null); }} confirm={() => { void clear(); }} /> : null}
    </div>
  </div>;
}

function Overview({ records, days, t }: { records: QueryRecord[]; days: number; t: Translate }) {
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - days + 1);
  const rows = records.filter(row => Date.parse(row.createdAt) >= start.getTime() && Date.parse(row.createdAt) <= Date.now());
  const success = rows.filter(row => row.status === 'ok').length, cached = rows.filter(row => row.cached).length;
  const average = rows.length ? duration(rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length) : '—';
  const ranking = new Map<string, number>();
  rows.filter(row => row.tool !== 'trends_now').forEach(row => row.terms.forEach(term => ranking.set(term, (ranking.get(term) ?? 0) + 1)));
  const top = [...ranking].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const singles = rows.filter(r => r.singleVolume);
  const cacheHits = singles.filter(r => r.cached && r.singleVolume!.calls === 0);
  const measured = singles.filter(r => !cacheHits.includes(r));
  const successful = measured.filter(r => r.singleVolume!.hit !== 'none');
  const callCount = (items: QueryRecord[]) => items.reduce((sum, r) => sum + r.singleVolume!.calls, 0);
  const routes = (['actor-public', 'actor-own', 'local'] as const).map(value => ({ value, count: rows.filter(row => row.egress === value).length }));
  const checks = records.flatMap(record => record.volumeRuns ?? []).filter(run => Date.parse(run.createdAt) >= start.getTime() && Date.parse(run.createdAt) <= Date.now());
  const runs = new Map([...rows, ...checks].filter(run => run.actorRunId).map(run => [run.actorRunId, run]));
  const priced = [...runs.values()].filter(row => row.costUsd !== null), cost = priced.reduce((sum, row) => sum + row.costUsd!, 0);
  const routeColors = ['#2563eb', '#7c3aed', '#94a3b8'];
  return <>
    <div className="gd-metrics">{[['dashCount', String(rows.length), 'dashSources'], ['dashSuccess', percent(success, rows.length), 'dashOk'], ['dashCacheRate', percent(cached, rows.length), 'dashReuse'], ['dashDuration', average, 'dashCount']].map(([label, value, note]) => <article className="gd-card gd-metric" key={label}><span>{t(label!)}</span><strong>{value}</strong><small>{t(note!)}</small></article>)}</div>
    {singles.length > 0 && <article className="gd-card gd-single-card"><h3>{t('dashSingleStats')}</h3>
      <p>{t('dashFirstHit')} · {percent(measured.filter(r => r.singleVolume!.hit === 'first').length, measured.length)}
        {' · '}{t('dashVolumeHits')} {successful.length}/{measured.length}{' · '}{t('dashCached')} {cacheHits.length}</p>
      <p>{t('dashMeanCalls')} · {successful.length ? (callCount(successful) / successful.length).toFixed(2) : '—'}
        {' · '}{t('dashAllCallsPerHit')} · {successful.length ? (callCount(measured) / successful.length).toFixed(2) : '—'}</p>
    </article>}
    <div className="gd-overview-grid">
      <article className="gd-card"><h3>{t('dashDaily')}</h3><DailyChart records={rows} days={days} t={t} /><div className="gd-legend" style={{ paddingTop: 6 }}>{['dashLive', 'dashCached', 'dashFailure'].map((key, index) => <span key={key} style={{ border: 0, padding: 0, background: 'none' }}><i style={{ background: ['#2563eb', '#10b981', '#f43f5e'][index] }} />{t(key)}</span>)}</div></article>
      <article className="gd-card"><h3>{t('dashTop')}</h3><div className="gd-ranking">{top.map(([term, count], index) => <div key={term}><p><span>{String(index + 1).padStart(2, '0')}</span><strong>{term}</strong><span>{count}</span></p><div className="gd-rail"><i style={{ width: `${count / top[0]![1] * 100}%` }} /></div></div>)}{!top.length ? <p className="gd-muted">—</p> : null}</div></article>
    </div>
    <div className="gd-bottom-grid">
      <article className="gd-card"><h3>{t('dashEgress')}</h3><div className="gd-mix-card"><div className="gd-mix-bar">{routes.map((row, i) => <div key={row.value} style={{ width: `${rows.length ? row.count / rows.length * 100 : 0}%`, background: routeColors[i] }} />)}</div><div className="gd-mix-legend">{routes.map((row, i) => <span key={row.value}><i style={{ background: routeColors[i] }} />{egressLabel(row.value, t)} <strong>{row.count}</strong></span>)}</div></div></article>
      <article className="gd-card"><h3>{t('dashSources')}</h3><div className="gd-mix-card"><div className="gd-mix-bar">{(['manual', 'agent'] as const).map((key, i) => { const count = rows.filter(row => row.source === key).length; return <div key={key} style={{ width: `${rows.length ? count / rows.length * 100 : 0}%`, background: i === 0 ? '#2563eb' : '#10b981' }} />; })}</div><div className="gd-mix-legend">{(['manual', 'agent'] as const).map((key, i) => <span key={key}><i style={{ background: i === 0 ? '#2563eb' : '#10b981' }} />{t(key === 'manual' ? 'dashManual' : 'dashAgent')} <strong>{rows.filter(row => row.source === key).length}</strong></span>)}</div></div></article>
      <article className="gd-card gd-cost"><h3>{t('dashCosts')}</h3><strong>{runs.size && !priced.length ? '—' : `$${cost.toFixed(4)}`}</strong><p>{runs.size ? `${priced.length} / ${runs.size} ${t('dashRuns')}` : t('dashNoRuns')}</p><small>{t('dashCostHint')}</small></article>
    </div>
  </>;
}

function DailyChart({ records, days, t }: { records: QueryRecord[]; days: number; t: Translate }) {
  const buckets = Array.from({ length: days }, (_, i) => {
    const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - days + 1 + i);
    const end = new Date(date); end.setDate(end.getDate() + 1);
    const rows = records.filter(row => Date.parse(row.createdAt) >= date.getTime() && Date.parse(row.createdAt) < end.getTime());
    return { date, counts: [rows.filter(row => row.status === 'ok' && !row.cached).length, rows.filter(row => row.status === 'ok' && row.cached).length, rows.filter(row => row.status !== 'ok').length] };
  });
  const max = Math.max(4, ...buckets.map(bucket => bucket.counts.reduce((a, b) => a + b, 0))), ceiling = Math.ceil(max / 4) * 4;
  const step = 610 / days;
  return <svg className="gd-daily-chart" viewBox="0 0 670 225" role="img" aria-label={`${t('dashDaily')} ${records.length}`}>
    {Array.from({ length: 5 }, (_, i) => <g key={i}><line x1="38" x2="648" y1={188 - i * 42} y2={188 - i * 42} stroke="var(--gtfa-line)" strokeDasharray={i === 0 ? undefined : '2 3'} /><text x="28" y={192 - i * 42} textAnchor="end">{i * ceiling / 4}</text></g>)}
    {buckets.map((bucket, i) => { let base = 188; const barW = Math.min(26, Math.max(6, step * .52)); return <g key={i}>{bucket.counts.map((count, j) => { const height = count / ceiling * 168; base -= height; return count > 0 ? <rect key={j} x={38 + step * i + (step - barW) / 2} y={base} width={barW} height={height} rx="3" fill={['#2563eb', '#10b981', '#f43f5e'][j]}><title>{bucket.date.toLocaleDateString()} · {t(['dashLive', 'dashCached', 'dashFailure'][j]!)} {count}</title></rect> : null; })}{i === 0 || i === days - 1 || i % (days === 7 ? 1 : 5) === 0 ? <text x={38 + step * (i + .5)} y="214" textAnchor="middle">{bucket.date.getMonth() + 1}/{bucket.date.getDate()}</text> : null}</g>; })}
  </svg>;
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
  </div>;
}

function Result({ saved, metric, setMetric, t, egress, estimate, busy, onPickRelated }: {
  saved: SavedQuery; metric: string; setMetric: (v: string) => void; t: Translate; egress?: EgressMode; estimate: EstimateAction; busy: boolean; onPickRelated?: (term: string) => void;
}) {
  const { record, result } = saved, meta = object(result.meta);
  const [focused, focusTerm] = useState<string | null>(null);
  const [relatedTab, setRelatedTab] = useState<'popular' | 'rising'>('popular');
  const trafficSeries = resultSeries(saved, true), hasTraffic = trafficSeries.some(row => row.average !== null || row.range);
  const currentMetric = metric === 'traffic' && hasTraffic ? 'traffic' : 'interest';
  const series = currentMetric === 'traffic' ? trafficSeries : resultSeries(saved);
  const legend = series.map((row, index) => ({ ...row, color: colors[index]! }));
  const chartSeries = legend.filter(hasChartPoints);
  const visible = focused && chartSeries.some(row => row.term === focused) ? chartSeries.filter(row => row.term === focused) : chartSeries;
  const format = currentMetric === 'traffic' ? formatVolume : formatNumber;
  const comparison = record.tool === 'trends_compare';
  const warnings = [...new Set([...arrayOfStrings(meta.warnings), ...arrayOfStrings(result.warnings)])];
  const error = object(result.error), tables = object(result.tables);
  const hasRelated = !comparison && (array(tables.popular).length > 0 || array(tables.rising).length > 0);
  const isZh = t('dashGeo') === '地区';
  if (record.tool === 'trends_now') return <div className="gd-results"><div className="gd-toolbar"><div><h2>{t('dashNow')} <Badge record={record} t={t} /></h2><p>{record.geo} · {record.time} · {t('dashReadSaved')}</p></div></div><div className="gd-related">{array(result.byGeo).map((region, index) => <article className="gd-card" key={index}><h3>{regionLabel(String(region.geo), isZh ? 'zh' : 'en')}</h3>{array(region.items).map((item, i) => <p key={i}><span>{i + 1}. {String(item.title ?? item.query ?? '')}</span><strong>{String(item.trafficLabel ?? item.traffic ?? '—')}</strong></p>)}{!array(region.items).length ? <p className="gd-muted">{t('dashUnavailable')}</p> : null}</article>)}</div>{typeof error.message === 'string' ? <p className="gd-error" role="alert">{error.message}</p> : null}</div>;
  const showLegend = legend.length > 1 || legend.some(row => !hasChartPoints(row) || row.range?.points.length);
  return <div className="gd-results">
    <div className="gd-result-grid">
      <article className="gd-card gd-chart-card">
        <div className="gd-result-head">
          <div className="gd-result-title-block">
            <div className="gd-result-title-row"><h2>{record.terms.join(' vs ')}</h2><Badge record={record} t={t} /></div>
            <div className="gd-result-meta">
              <span>{regionLabel(record.geo, isZh ? 'zh' : 'en')}</span><span>·</span>
              <span>{timeLabel(record.time, t)}</span><span>·</span>
              <span>{egressLabel(record.egress, t)}</span><span>·</span>
              <span>{duration(record.durationMs)}</span>
            </div>
          </div>
          {(!result.onDemand || hasTraffic) && <div className="gd-metric-switch">{(['interest', 'traffic'] as const).map(value =>
            <button type="button" key={value} aria-pressed={currentMetric === value} disabled={value === 'traffic' && !hasTraffic}
              onClick={() => { focusTerm(null); setMetric(value); }}>{t(value === 'interest' ? 'dashInterest' : 'dashTraffic')}</button>
          )}</div>}
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
        <TrendChart perDay={t('dashPerDay')} series={visible} traffic={currentMetric === 'traffic'}
          label={t(currentMetric === 'traffic' ? 'dashTraffic' : 'dashTrend')} empty={t('dashUnavailable')} logLabel={t('dashLogScale')} />
        {currentMetric === 'interest' && object(result.calibration).weakComparison === true ?
          <p className="gd-chart-note">{t('dashWeakComparison')}</p> : null}
        <table className="gd-result-stats"><thead><tr><th>{t('dashKeyword')}</th>
          <th>{t('dashAverage')}</th><th>{t(currentMetric === 'traffic' ? 'dashLatestUsable' : 'dashLatest')}</th><th>{t('dashPeak')}</th>
          {hasTraffic && currentMetric === 'interest' ? <th>{t('dashDailyVolume')}</th> : null}
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
      </article>
      <aside className="gd-side-stack">
        <div className="gd-card gd-result-info">
          <VolumeCards saved={saved} t={t} busy={busy} egress={egress} estimate={estimate} />
          {typeof error.code === 'string' ? <p className="gd-error-code">{error.code}</p> : null}
          <details className="gd-query-details"><summary><span>{t('dashQueryDetails')}</span><svg className="gd-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></summary><dl>{[[t('dashFetchedAt'), dateText(record.fetchedAt, true)], [t('dashCalledAt'), dateText(record.createdAt, true)], [t('dashRunDuration'), duration(record.durationMs)], [t('dashEgress'), egressLabel(record.egress, t)], [t('dashSources'), t(record.source === 'manual' ? 'dashManual' : 'dashAgent')]].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details>
        </div>
        {hasRelated ? <div className="gd-card gd-related-card">
          <div className="gd-related-head">
            <h3>{t(relatedTab === 'popular' ? 'dashPopular' : 'dashRising')}</h3>
            <div className="gd-related-tabs" role="tablist">
              {(['popular', 'rising'] as const).map(key => <button key={key} type="button" role="tab" aria-selected={relatedTab === key} onClick={() => setRelatedTab(key)}>{t(key === 'popular' ? 'dashPopular' : 'dashRising')}</button>)}
            </div>
          </div>
          {array(tables[relatedTab]).slice(0, 8).map((row, i) => {
            const term = String(row.query ?? '');
            return <div className="gd-related-row" key={i} style={{ cursor: onPickRelated && term ? 'pointer' : undefined }} onClick={() => term && onPickRelated?.(term)}>
              <span>{term}</span><strong>{String(row.formattedValue ?? row.value ?? '—')}</strong>
            </div>;
          })}
          {!array(tables[relatedTab]).length ? <p className="gd-muted" style={{ fontSize: 12 }}>{t('dashNoRelated')}</p> : null}
        </div> : null}
      </aside>
    </div>
    {typeof error.message === 'string' ? <p className="gd-error" style={{ marginTop: 14 }} role="alert">{error.message}</p> : null}
    {warnings.length ? <details className="gd-warnings"><summary>{t('dashResultInfo')} · {warnings.length}</summary>{warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details> : null}
  </div>;
}
const arrayOfStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function ClearDialog({ count, t, busy, cancel, confirm }: { count: number; t: Translate; busy: boolean; cancel: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog className="gd-dialog" ref={dialog} onCancel={event => { event.preventDefault(); cancel(); }} onClick={event => { if (event.target === event.currentTarget) cancel(); }} aria-label={t('dashClearTitle')}><div onClick={event => event.stopPropagation()}><Icon name="trash" size={22} /><h2>{t('dashClearTitle')}</h2><p className="gd-clear-count">{count}</p><p>{t('dashClearNote')}</p><div className="gd-dialog-actions"><Button disabled={busy} onClick={cancel}>{t('dashCancel')}</Button><Button disabled={busy} onClick={confirm}>{busy ? t('dashLoading') : t('dashConfirm')}</Button></div></div></dialog>;
}
