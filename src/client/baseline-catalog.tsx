import { useMemo, useState } from 'react';
import { BASELINE_CATALOG } from '../baseline-catalog.js';
import { regionLabel } from '../options.js';
import { ChoicePicker } from './choice-picker.js';

/** Browsing built-ins never adds them to the user's overrides or changes query defaults. */
export function BaselineCatalog({ t, locale }: { t: (key: string) => string; locale: string }) {
  const [geo, setGeo] = useState('all');
  const name = (code: string) => code ? regionLabel(code, locale) : t('geoWorldwide');
  const options = useMemo(() => [
    { value: 'all', label: t('baselineAllRegions') },
    ...['', ...new Set(BASELINE_CATALOG.map(anchor => anchor.geo).filter(Boolean))].map(code => ({
      value: code, label: code ? regionLabel(code, locale) : t('geoWorldwide'),
      search: code ? `${code} ${regionLabel(code, 'en')} ${regionLabel(code, 'zh-CN')}` : 'world worldwide global 全球',
    })),
  ], [locale, t]);
  const anchors = BASELINE_CATALOG.filter(anchor => geo === 'all' || anchor.geo === geo)
    .slice().sort((a, b) => Number(Boolean(a.geo)) - Number(Boolean(b.geo)));
  const numbers = new Intl.NumberFormat(locale);
  return <section className="gtfa-baseline-catalog" aria-label={t('baselineBuiltin')}>
    <div className="gtfa-catalog-heading">
      <h4>{t('baselineBuiltin')} <span>{anchors.length} / {BASELINE_CATALOG.length}</span></h4>
      <div className="gtfa-catalog-filter">
        <ChoicePicker compact hideLabel label={t('baselineBrowseGeo')} value={geo} disabled={false}
          options={options} placeholder={t('geoSearch')} emptyText={t('choiceEmpty')} onChange={setGeo} />
      </div>
    </div>
    <p className="gtfa-catalog-hint">{t('baselineBuiltinHint')}</p>
    <table className="gtfa-catalog-table" aria-label={t('baselineBuiltin')}>
      <thead><tr><th scope="col">{t('anchorGeo')}</th><th scope="col">{t('anchorTerm')}</th>
        <th scope="col">{t('baselineDailyEstimate')}</th><th scope="col">{t('anchorTolerance')}</th></tr></thead>
      <tbody>{anchors.map(anchor => <tr key={`${anchor.geo}:${anchor.term}`}>
        <th scope="row">{name(anchor.geo)}</th><td>{anchor.term}</td>
        <td>{numbers.format(anchor.dailySearches)}</td><td>±{numbers.format(anchor.tolerance * 100)}%</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
