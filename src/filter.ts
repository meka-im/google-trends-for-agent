import { readFileSync } from 'node:fs';
import type { GTrendsSearchType } from './core.js';
export interface TrendsFilter { geo: string; time: string; category: number; property: string; hl?: string }
export const DEFAULT_FILTER: TrendsFilter = { geo: 'US', time: 'now 1-d', category: 0, property: '' };
export function resolveFilter(args: Partial<TrendsFilter> = {}, config?: Partial<TrendsFilter>, env: NodeJS.ProcessEnv = process.env): TrendsFilter {
  if (config === undefined) {
    try { const data = JSON.parse(readFileSync('gtfa.config.json', 'utf8')); config = data.filter ?? data; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  const defined = (x: object) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined));
  const resolved = { ...DEFAULT_FILTER, ...defined({ geo: env.GTFA_GEO, time: env.GTFA_TIME }), ...defined(config ?? {}), ...defined(args) };
  return { ...resolved, geo: resolved.geo.trim().toUpperCase() };
}
export function filterInput(f: TrendsFilter) {
  return { geo: f.geo, timeRange: f.time, category: f.category, searchType: (f.property === 'froogle' ? 'shopping' : f.property || 'web') as GTrendsSearchType, ...(f.hl ? { locale: f.hl } : {}) };
}
/** Hourly windows lose one partial point; daily windows lose two unsettled points.
 * Weekly/monthly series lose only their partial final point. */
export function settledPoints<T extends { time: string }>(points: T[], filter: TrendsFilter): T[] {
  const step = points.length > 1 ? (Date.parse(points[1].time) - Date.parse(points[0].time)) / 86400000 : 0;
  const daily = step >= .9 && step <= 1.1;
  return points.slice(0, Math.max(0, points.length - (daily && !/^now /.test(filter.time) ? 2 : 1)));
}
