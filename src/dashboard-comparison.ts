import { calibrateTraffic, nullTraffic } from './calibration.js';
import { anchorDailySearches, defaultAnchorFor, findAnchor, type Baselines } from './traffic.js';
import type { TrendsFilter } from './filter.js';
import { summarizeInterest } from './gaps.js';

const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(row) : [];
const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** One shared comparison request, including an anchor when an item slot is available. */
export async function calibratedComparison(input: Record<string, unknown>, settings: { geo: string; anchor?: string; baselines?: Baselines },
  execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>, calibrating: () => void) {
  const keywords = input.keywords as string[], geo = String(input.geo ?? settings.geo).trim().toUpperCase(), time = String(input.time ?? 'now 1-d');
  // Match trends_compare's scope; CLI config files and environment defaults do
  // not change this tool's web/all-categories requests.
  const filter: TrendsFilter = { geo, time, category: 0, property: '' };
  let anchor = settings.anchor || defaultAnchorFor(time, settings.baselines, geo);
  if (!settings.anchor && keywords.length === 5 && !keywords.some(term => norm(term) === norm(anchor))) {
    anchor = keywords.find(term => { const known = findAnchor(settings.baselines, term, geo, filter); return known && anchorDailySearches(known) !== null; }) ?? anchor;
  }
  const baseline = findAnchor(settings.baselines, anchor, geo, filter), daily = baseline ? anchorDailySearches(baseline) : null;
  const containsAnchor = keywords.some(term => norm(term) === norm(anchor));
  const canCalibrate = daily !== null && (keywords.length < 5 || containsAnchor);
  const sent = canCalibrate && !containsAnchor ? [...keywords, anchor] : keywords;
  const result = await execute({ ...input, keywords: sent });
  calibrating();
  const all = rows(result.series), selected = keywords.map(keyword => all.find(series => norm(String(series.keyword)) === norm(keyword)) ?? { keyword, points: [] });
  const anchorPoints = rows(all.find(series => norm(String(series.keyword)) === norm(anchor))?.points)
    .map(point => ({ time: String(point.t), value: Number(point.value) }));
  const warnings = new Set<string>();
  const reason = daily === null ? `No calibration baseline for ${geo || 'Worldwide'}; search-volume estimates omitted.`
    : !canCalibrate ? 'All five comparison slots are occupied. Include a known anchor or query at most four terms to estimate search volume in one request.' : '';
  if (reason) warnings.add(reason);
  const trafficSeries = selected.map((series, index) => {
    const points = rows(series.points).map(point => ({ time: String(point.t), value: Number(point.value) }));
    const lowSample = points.length === 0 || (summarizeInterest(points, filter).average ?? 0) < 1;
    if (!result.ok || !canCalibrate || lowSample) {
      if (lowSample && canCalibrate && result.ok) warnings.add(`${keywords[index]}: insufficient samples for calibrated search volume.`);
      return { keyword: keywords[index], traffic: nullTraffic(), points: points.map(point => ({ t: point.time, value: null })) };
    }
    const estimate = calibrateTraffic(points, anchorPoints, { filter, dailySearches: daily, tolerance: baseline?.tolerance ?? .5 });
    if (estimate.warning) warnings.add(`${keywords[index]}: ${estimate.note}`);
    return { keyword: keywords[index], traffic: estimate.traffic,
      points: estimate.termMarked.map((point, i) => ({ t: point.time, value: point.gap ? null : estimate.seriesTraffic[i], ...(point.gap ? { gap: true } : {}) })) };
  });
  // The anchor is a calibration reference, not an extra selected keyword. Keep
  // the displayed interest scale normalized across the user's selected terms.
  const maximum = Math.max(0, ...selected.flatMap(series => rows(series.points).map(point => Number(point.value))));
  const suppressed = sent.length !== keywords.length && selected.every(series => (summarizeInterest(rows(series.points).map(point => ({ time: String(point.t), value: Number(point.value) })), filter).average ?? 0) < 1);
  const factor = sent.length !== keywords.length && maximum > 0 && !suppressed ? 100 / maximum : 1;
  const scale = (value: unknown) => typeof value === 'number' ? Math.round(value * factor * 10) / 10 : value;
  const series = selected.map((source, index) => ({ ...source, keyword: keywords[index],
    average: scale(source.average), latest: scale(source.latest), peak: scale(source.peak),
    points: rows(source.points).map(point => ({ ...point, value: scale(point.value) })) }));
  const hasVolume = trafficSeries.some(series => series.traffic.average !== null);
  return { ...result, summary: `${keywords.join(' vs ')} (${geo || 'Worldwide'} · ${time})`, ...(result.ok && (maximum === 0 || suppressed) ? { status: 'no_data' } : {}), series,
    calibration: { status: hasVolume ? 'ok' : 'unavailable', reason, reasonCode: hasVolume ? 'ok' : daily === null ? 'baseline' : !canCalibrate ? 'capacity' : 'samples', anchor: { term: anchor, dailySearches: daily, tolerance: daily === null ? null : baseline?.tolerance ?? .5 }, series: trafficSeries },
    meta: { ...row(result.meta), ...(warnings.size ? { warnings: [...(Array.isArray(row(result.meta).warnings) ? row(result.meta).warnings as unknown[] : []), ...warnings] } : {}) } };
}
