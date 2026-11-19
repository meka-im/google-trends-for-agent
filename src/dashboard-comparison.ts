import { calibrateTraffic, nullTraffic, type CalibrationPoint, type CalibrationResult } from './calibration.js';
import { MEKA_BASELINE_VERSION, mekaAnchorsFor } from './dsh-baselines.js';
import { anchorDailySearches, defaultAnchorFor, dshBaselinesFor, findAnchor, SHORT_WINDOWS, type Anchor, type Baselines } from './traffic.js';
import type { TrendsFilter } from './filter.js';
import { summarizeInterest } from './gaps.js';

const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(row) : [];
const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const describeAnchor = (anchor: Anchor) => ({
  term: anchor.term, dailySearches: anchorDailySearches(anchor), tolerance: anchor.tolerance ?? .5,
});

function pointsOf(series: Record<string, unknown> | undefined): CalibrationPoint[] {
  return rows(series?.points).flatMap(point =>
    typeof point.t === 'string' && typeof point.value === 'number' && Number.isFinite(point.value)
      ? [{ time: point.t, value: point.value }]
      : []);
}

/** Use the user's pin first, then terms already in the comparison, then a spread of regional tiers. */
function selectReferences(keywords: string[], filter: TrendsFilter, baselines: Baselines | undefined, pinned?: string): Anchor[] {
  const lookup = (term: string) => findAnchor(baselines, term, filter.geo, filter);
  const found = (terms: string[]) => [...new Set(terms.flatMap(term => {
    const anchor = lookup(term);
    return anchor ? [anchor] : [];
  }))];
  if (pinned) return found([pinned]);
  const included = found(keywords);
  if (included.length) return included;
  const regional = mekaAnchorsFor(filter.geo);
  if (!regional.length) return found([defaultAnchorFor(filter.time, baselines, filter.geo)]);
  const slots = 5 - keywords.length;
  const fractions = slots <= 1 ? [.5] : slots === 2 ? [.25, .75] : [.15, .5, .75];
  return found(fractions.map(fraction => regional[Math.floor((regional.length - 1) * fraction)]!.term));
}

/** One shared comparison request. Every estimate uses the closest usable reference in that batch. */
export async function calibratedComparison(input: Record<string, unknown>, settings: { geo: string; anchor?: string; baselines?: Baselines },
  execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>, calibrating: () => void) {
  const keywords = input.keywords as string[];
  const geo = String(input.geo ?? settings.geo).trim().toUpperCase();
  const time = String(input.time ?? 'now 1-d');
  const filter: TrendsFilter = { geo, time, category: 0, property: '' };
  const window = (SHORT_WINDOWS as readonly string[]).includes(time) ? 'short' : 'long';
  const pinned = settings.anchor || settings.baselines?.windowAnchors?.[window]?.trim();
  const baselines = dshBaselinesFor(geo, settings.baselines);
  const candidates = selectReferences(keywords, filter, baselines, pinned);
  const requestedTerms = new Set(keywords.map(norm));
  const added = candidates.filter(anchor => !requestedTerms.has(norm(anchor.term))).slice(0, 5 - keywords.length);
  const sent = [...keywords, ...added.map(anchor => anchor.term)];
  const sentTerms = new Set(sent.map(norm));
  const references = candidates.filter(anchor => sentTerms.has(norm(anchor.term)));
  const result = await execute({ ...input, keywords: sent });
  calibrating();

  const seriesByTerm = new Map(rows(result.series).map(series => [norm(String(series.keyword)), series]));
  const selected = keywords.map(keyword => seriesByTerm.get(norm(keyword)) ?? { keyword, points: [] });
  const referenceSeries = references.map(anchor => ({
    anchor,
    points: new Map(pointsOf(seriesByTerm.get(norm(anchor.term))).map(point => [point.time, point])),
  }));
  const warnings = new Set<string>();
  const reason = !candidates.length ? 'No calibration baseline for ' + (geo || 'Worldwide') + '.'
    : !references.length ? 'Five terms fill the batch. Include a regional anchor or use up to four terms to estimate search volume.'
    : '';
  if (reason && result.ok) warnings.add(reason);

  const trafficSeries = selected.map((series, index) => {
    const keyword = keywords[index]!;
    const points = pointsOf(series);
    const termAverage = summarizeInterest(points, filter).average ?? 0;
    let best: { anchor: Anchor; estimate: CalibrationResult; distance: number } | undefined;
    let weakReference: string | undefined;
    if (result.ok && termAverage >= 1) {
      for (const reference of referenceSeries) {
        const matched = points.filter(point => reference.points.has(point.time));
        if ((summarizeInterest(matched, filter).average ?? 0) < 1) continue;
        const estimate = calibrateTraffic(matched, matched.map(point => reference.points.get(point.time)!), {
          filter, dailySearches: anchorDailySearches(reference.anchor), tolerance: reference.anchor.tolerance ?? .5,
        });
        if (estimate.ratio === null || estimate.ratio <= 0 || estimate.traffic.average === null) {
          if (estimate.warning) weakReference = estimate.note;
          continue;
        }
        const distance = Math.abs(Math.log(estimate.ratio));
        if (!best || distance < best.distance) best = { anchor: reference.anchor, estimate, distance };
      }
    }
    if (!best) {
      if (result.ok && references.length) warnings.add(keyword + ': ' + (weakReference ?? 'insufficient samples for estimated search volume.'));
      return { keyword, traffic: nullTraffic(), points: points.map(point => ({ t: point.time, value: null })) };
    }
    const { estimate, anchor } = best;
    return { keyword, anchor: describeAnchor(anchor), traffic: estimate.traffic,
      points: estimate.termMarked.map((point, i) => ({ t: point.time, value: point.gap ? null : estimate.seriesTraffic[i], ...(point.gap ? { gap: true } : {}) })) };
  });
  // The published relative chart only contains the user's selected terms.
  const maximum = Math.max(0, ...selected.flatMap(series => pointsOf(series).map(point => point.value)));
  const suppressed = added.length > 0 && selected.every(series => (summarizeInterest(pointsOf(series), filter).average ?? 0) < 1);
  const factor = added.length && maximum > 0 && !suppressed ? 100 / maximum : 1;
  const scale = (value: unknown) => typeof value === 'number' ? Math.round(value * factor * 10) / 10 : value;
  const series = selected.map((source, index) => ({ ...source, keyword: keywords[index],
    average: scale(source.average), latest: scale(source.latest), peak: scale(source.peak),
    points: rows(source.points).map(point => ({ ...point, value: scale(point.value) })) }));
  const firstAnchor = trafficSeries.find(series => series.anchor)?.anchor;
  const anchor = firstAnchor ?? (candidates[0] ? describeAnchor(candidates[0])
    : { term: pinned ?? defaultAnchorFor(time, baselines, geo), dailySearches: null, tolerance: null });
  const meta = row(result.meta);
  return {
    ...result,
    summary: keywords.join(' vs ') + ' (' + (geo || 'Worldwide') + ' · ' + time + ')',
    ...(result.ok && (maximum === 0 || suppressed) ? { status: 'no_data' } : {}),
    series,
    calibration: {
      status: firstAnchor ? 'ok' : 'unavailable',
      reason,
      reasonCode: firstAnchor ? 'ok' : !candidates.length ? 'baseline' : !references.length ? 'capacity' : 'samples',
      catalogVersion: MEKA_BASELINE_VERSION,
      anchor,
      series: trafficSeries,
    },
    meta: { ...meta, ...(warnings.size ? { warnings: [...(Array.isArray(meta.warnings) ? meta.warnings : []), ...warnings] } : {}) },
  };
}
