import { useMemo, useState } from 'react';
import { summarizeMekaCatalog, type MekaBaselineStatus } from '../dsh-baselines.js';
import { regionLabel } from '../options.js';
import { ChoicePicker } from './choice-picker.js';
import { Icon } from './icons.js';

export interface BaselineSyncFeedback {
  tone: 'ok' | 'error';
  text: string;
}

const MEKA_DATASET_URL = 'https://meka.im/datasets/google-trends-anchors';

function template(value: string, vars: Record<string, string | number>): string {
  return value.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}

function formatSyncTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

/** Browsing built-ins never adds them to the user's overrides or changes query defaults. */
export function BaselineCatalog({ t, locale, catalog, syncing = false, feedback, onSync }: {
  t: (key: string) => string;
  locale: string;
  catalog?: MekaBaselineStatus;
  syncing?: boolean;
  feedback?: BaselineSyncFeedback | null;
  onSync?: () => void;
}) {
  const active = catalog ?? summarizeMekaCatalog();
  const [geo, setGeo] = useState('all');
  const name = (code: string) => code ? regionLabel(code, locale) : t('geoWorldwide');
  const shortGeo = (code: string) => code || t('geoWorldwide');
  const options = useMemo(() => [
    { value: 'all', label: t('baselineAllRegions') },
    ...active.regions.map(code => ({
      value: code,
      label: code ? regionLabel(code, locale) : t('geoWorldwide'),
      search: code ? `${code} ${regionLabel(code, 'en')} ${regionLabel(code, 'zh-CN')}` : 'world worldwide global 全球',
    })),
  ], [active.regions, locale, t]);
  const anchors = useMemo(
    () => active.anchors.filter(anchor => geo === 'all' || anchor.geo === geo),
    [active.anchors, geo],
  );
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const isSynced = active.source === 'synced';
  const metaSummary = template(t('baselineMeta'), { regions: active.regions.length, count: active.count });
  const syncNote = active.syncedAt
    ? template(t('baselineSyncedAt'), { time: formatSyncTime(active.syncedAt, locale) })
    : t('baselineSyncPolicy');

  return <section className="gtfa-baseline-catalog" aria-label={t('baselineBuiltin')}>
    <div className="gtfa-catalog-top">
      <div className="gtfa-catalog-meta">
        <div className="gtfa-catalog-title-row">
          <h4>{t('baselineBuiltin')}</h4>
          <span className={`gtfa-catalog-badge${isSynced ? ' synced' : ''}`}>
            {isSynced ? t('baselineSourceSynced') : t('baselineSourceBundled')} · {active.version}
          </span>
        </div>
        <p className="gtfa-catalog-sub">
          <span>{t('baselineBuiltinHint')}</span>
          <span className="gtfa-catalog-sep" aria-hidden="true">·</span>
          <span>{metaSummary}</span>
          <span className="gtfa-catalog-sep" aria-hidden="true">·</span>
          <span>{syncNote}</span>
          <span className="gtfa-catalog-sep" aria-hidden="true">·</span>
          <a href={MEKA_DATASET_URL} target="_blank" rel="noopener noreferrer">{t('baselineSources')}</a>
        </p>
      </div>
      {onSync ? <div className="gtfa-catalog-actions">
        <button type="button" className="gtfa-button gtfa-catalog-sync" disabled={syncing} onClick={onSync}>
          <span className={syncing ? 'gtfa-spin' : undefined}><Icon name="refresh" size={13} /></span>
          {syncing ? t('baselineSyncing') : t('baselineSync')}
        </button>
      </div> : null}
    </div>
    {feedback ? <p className={`gtfa-catalog-feedback ${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
      {feedback.text}
    </p> : null}
    <details className="gtfa-catalog-details">
      <summary className="gtfa-catalog-summary">
        <span className="gtfa-catalog-summary-label">{t('baselineInspect')} ({active.count})</span>
        <span className="gtfa-catalog-regions" aria-hidden="true">
          {active.regions.map(code => <span key={code || 'world'} className="gtfa-catalog-chip">{shortGeo(code)}</span>)}
        </span>
        <span className="gtfa-catalog-chevron"><Icon name="chevron" size={14} /></span>
      </summary>
      <div className="gtfa-catalog-body">
        <div className="gtfa-catalog-toolbar">
          <span className="gtfa-catalog-count">{anchors.length} / {active.count}</span>
          <div className="gtfa-catalog-filter">
            <ChoicePicker compact hideLabel label={t('baselineBrowseGeo')} value={geo} disabled={false}
              options={options} placeholder={t('geoSearch')} emptyText={t('choiceEmpty')} onChange={setGeo} />
          </div>
        </div>
        <div className="gtfa-catalog-scroll">
          <table className="gtfa-catalog-table" aria-label={t('baselineBuiltin')}>
            <thead><tr><th scope="col">{t('anchorGeo')}</th><th scope="col">{t('anchorTerm')}</th>
              <th scope="col">{t('baselineDailyEstimate')}</th></tr></thead>
            <tbody>{anchors.map(anchor => <tr key={`${anchor.geo}:${anchor.term}`}>
              <th scope="row">{name(anchor.geo)}</th>
              <td>
                {anchor.term}
                {anchor.dailyOnly ? <small className="gtfa-catalog-window" title={t('baselineDailyWindow')}>30d+</small> : null}
              </td>
              <td>{numbers.format(anchor.dailySearches)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>
    </details>
  </section>;
}
