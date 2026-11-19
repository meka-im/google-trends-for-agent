import { supportsVolumeWindow } from './volume-types.js';
import { summarizeInterest } from './gaps.js';
import { estimateVolume, normalizeTerm, pointsOf, row, rows, volumeCalibration, volumeFilter, volumeReferences, type VolumeSettings } from './dashboard-volume.js';
import type { Anchor } from './traffic.js';

function selectReferences(keywords: string[], refs: ReturnType<typeof volumeReferences>): Anchor[] {
  const { pinned, lookup, available } = refs;
  if (pinned) {
    const known = lookup(pinned);
    return known ? [known] : [];
  }
  const included = keywords.flatMap(term => {
    const known = lookup(term);
    return known ? [known] : [];
  });
  if (included.length) return included;
  const slots = 5 - keywords.length;
  const fractions = slots === 1 ? [.5] : slots === 2 ? [.25, .75] : slots === 3 ? [.15, .5, .75] : [];
  return [...new Set(fractions.flatMap(fraction => {
    const anchor = available[Math.floor((available.length - 1) * fraction)];
    return anchor ? [anchor] : [];
  }))];
}

/** Prefer shared-batch estimates so an ordinary comparison needs one Actor run. */
export async function calibratedComparison(
  input: Record<string, unknown>, settings: VolumeSettings,
  execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>, calibrating: () => void,
) {
  const keywords = input.keywords as string[];
  const filter = volumeFilter(String(input.geo ?? settings.geo), String(input.time ?? 'now 1-d'));
  const refs = volumeReferences(filter, settings);
  const candidates = supportsVolumeWindow(filter.time) ? selectReferences(keywords, refs) : [];
  const requested = new Set(keywords.map(normalizeTerm));
  const added = candidates.filter(anchor => !requested.has(normalizeTerm(anchor.term))).slice(0, 5 - keywords.length);
  const result = await execute({ ...input, keywords: [...keywords, ...added.map(anchor => anchor.term)] });
  calibrating();

  const byTerm = new Map(rows(result.series).map(series => [normalizeTerm(String(series.keyword)), series]));
  const selected = keywords.map(keyword => ({ keyword, points: pointsOf(byTerm.get(normalizeTerm(keyword))?.points) }));
  const references = candidates.filter(anchor => byTerm.has(normalizeTerm(anchor.term))).map(anchor => ({
    anchor, points: pointsOf(byTerm.get(normalizeTerm(anchor.term))?.points),
  }));
  const reason = !(refs.pinned ? refs.lookup(refs.pinned) : refs.available.length) ? 'baseline' : keywords.length === 5 ? 'capacity' : 'anchor';
  const estimates = result.ok ? selected.map(({ keyword, points }) => estimateVolume(keyword, points, references, filter, reason)) : [];
  const maximum = Math.max(0, ...selected.flatMap(series => series.points.map(point => point.value)));
  const weakComparison = added.length > 0 && maximum > 0 && maximum < 10;
  const scale = added.length && maximum >= 10 ? 100 / maximum : 1;
  const series = selected.map(({ keyword, points }) => {
    const summary = summarizeInterest(points, filter);
    // An all-zero result is a censored curve. Keep the timestamps for a possible follow-up.
    const visible = points.some(point => point.value > 0);
    const index = (value: number | null) => value === null || !visible ? null : Math.round(value * scale * 10) / 10;
    return {
      keyword, average: index(summary.average), latest: index(summary.settledLatest), peak: index(summary.peak),
      points: summary.points.map(point => ({ t: point.time, value: index(point.value), ...(point.gap ? { gap: true } : {}) })),
    };
  });
  return {
    ...result,
    summary: keywords.join(' vs ') + ' (' + (filter.geo || 'Worldwide') + ' · ' + filter.time + ')',
    ...(result.ok && maximum === 0 ? { status: 'no_data' } : {}),
    series,
    calibration: { ...volumeCalibration(estimates, reason), ...(weakComparison ? { weakComparison } : {}) },
    meta: row(result.meta),
  };
}
