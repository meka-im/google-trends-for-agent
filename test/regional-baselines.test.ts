import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { automaticAnchorFor, BASELINE_CATALOG, catalogForGeo } from '../src/baseline-catalog.js';
import { baselinesForActor, defaultAnchorFor, findAnchor, parseBaselines } from '../src/traffic.js';
import { snapshotTrafficTerm, trafficSnapshotEnvelope } from '../src/trends-snapshot.js';
import { calibrateTraffic } from '../src/calibration.js';
import { DEFAULT_FILTER } from '../src/filter.js';
import type { queryTrends, TrendsResponse } from '../src/api.js';

type RecordedComparison = {
  ok: boolean; filter: { geo: string; time: string };
  series: Array<{ keyword: string; points: Array<{ t: string; value: number }> }>;
  meta: { fetchedAt: string; upstreamRequests: number; durationMs: number; warnings: string[] };
};
const recorded = (file: string): RecordedComparison => JSON.parse(readFileSync(new URL(`../validation/2026-11-16-regional-baselines/${file}`, import.meta.url), 'utf8'));

describe('regional calibration', () => {
  it('selects verified regional anchors while retaining US window defaults', () => {
    expect(defaultAnchorFor('now 1-d')).toBe('sudoku');
    expect(defaultAnchorFor('now 7-d')).toBe('gpts');
    for (const time of ['now 1-d', 'now 7-d']) {
      expect(defaultAnchorFor(time, undefined, ' ca ')).toBe('sudoku');
      expect(defaultAnchorFor(time, undefined, 'JP')).toBe('ナンプレ');
      expect(defaultAnchorFor(time, undefined, 'IN')).toBe('calculator');
      expect(defaultAnchorFor(time, undefined, '')).toBe('sudoku');
    }
    expect(findAnchor(undefined, 'sudoku', 'CA')?.dailySearches).toBe(12000);
    expect(findAnchor(undefined, 'sudoku', '')?.dailySearches).toBe(220000);
    expect(findAnchor(undefined, 'sudoku', 'US')?.dailySearches).toBe(63000);
    expect(findAnchor(undefined, 'sudoku', 'SG')).toBeUndefined();
    expect(findAnchor(undefined, 'gpts', 'CA')).toBeUndefined();
  });

  it('allows explicit Worldwide overrides without treating a missing geo as Worldwide', () => {
    const custom = parseBaselines({ version: 2, anchors: [{ term: 'sudoku', geo: '', dailySearches: 1000 }] });
    expect(findAnchor(custom, 'sudoku', '')?.dailySearches).toBe(1000);
    expect(findAnchor(custom, 'sudoku', 'US')?.dailySearches).toBe(63000);
    expect(() => parseBaselines({ version: 2, anchors: [{ term: 'sudoku', dailySearches: 1000 }] })).toThrow('invalid baseline anchor');
    expect(findAnchor(custom, 'sudoku', '', { category: 1, property: 'web' })).toBeUndefined();
  });

  it('pins country defaults into Actor requests without a default empty-geo row', () => {
    const custom = parseBaselines({ version: 2, anchors: [{ term: 'sudoku', geo: ' ca ', dailySearches: 1234 }], windowAnchors: { short: 'gpts' } });
    const request = baselinesForActor('CA', custom);
    expect(request.windowAnchors).toEqual({ short: 'gpts', long: 'sudoku' });
    expect(request.anchors.some(anchor => anchor.geo === '')).toBe(false);
    expect(findAnchor(request, 'sudoku', 'CA')?.dailySearches).toBe(1234);
    expect(() => parseBaselines(request)).not.toThrow();
    const worldwide = baselinesForActor('');
    expect(findAnchor(worldwide, 'sudoku', '')?.dailySearches).toBe(220000);
    expect(worldwide.windowAnchors).toEqual({ short: 'sudoku', long: 'sudoku' });
    expect(baselinesForActor('JP').windowAnchors).toEqual({ short: 'ナンプレ', long: 'ナンプレ' });
  });

  it('keeps source periods separate from source-check dates and has no duplicate term/geo keys', () => {
    const keys = BASELINE_CATALOG.map(anchor => JSON.stringify([anchor.term, anchor.geo]));
    expect(new Set(keys).size).toBe(keys.length);
    for (const anchor of BASELINE_CATALOG) {
      expect(anchor.sources.length).toBeGreaterThan(0);
      expect(anchor.dailySearches).toBeGreaterThan(0);
      expect(anchor.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const source of anchor.sources) expect(new URL(source.url).protocol).toBe('https:');
    }
    expect(catalogForGeo('')[0].sources[0]).toMatchObject({ monthlySearches: 6640000, dataPeriod: '2026-07' });
    expect(catalogForGeo('CA')[0].sources[0].dataPeriod).toBeNull();
    expect(catalogForGeo('SG')).toEqual([]);
  });

  for (const geo of ['CA', 'GB', 'AU', 'DE', 'FR', 'JP', 'IN', '']) {
    for (const time of ['now 1-d', 'now 7-d']) {
      it(`replays the real ${geo || 'Worldwide'} ${time} comparison through the snapshot path`, async () => {
        const suffix = time === 'now 7-d' ? '7d' : geo === 'IN' ? '1d-calculator' : '1d';
        const data = recorded(`trends-${geo.toLowerCase() || 'world'}-${suffix}.json`);
        expect(data.ok).toBe(true);
        expect(data.filter).toEqual({ geo, time });
        const anchor = automaticAnchorFor(time, geo);
        let observed: unknown;
        const query: typeof queryTrends = async request => {
          observed = request;
          return { status: 'ok', input: request, meta: data.meta, data: {
            interestOverTime: { timeline: data.series[0].points.map((point, index) => ({
              time: point.t, formattedTime: point.t, values: data.series.map(series => series.points[index].value),
            })) },
          } } as unknown as TrendsResponse;
        };
        const snapshot = await snapshotTrafficTerm('ChatGPT', { filter: { geo, time }, query });
        expect(observed).toMatchObject({ queries: ['ChatGPT', anchor], geo, timeRange: time });
        const result = await trafficSnapshotEnvelope(snapshot, { cached: false, ageMin: 0, chartDir: null });
        expect(result.ok).toBe(true);
        expect(result.schemaVersion).toBe(1);
        expect(result.anchor.term).toBe(anchor);
        expect(result.anchor.dailySearches).toBe(findAnchor(undefined, anchor, geo)?.dailySearches);
        expect(result.traffic.average).toBeGreaterThan(0);
        expect(result.series.points.every(point => point.traffic === null || Number.isFinite(point.traffic))).toBe(true);
      });
    }
  }

  it('rejects the sparse Indian sudoku probe instead of inventing a conversion', () => {
    const data = recorded('trends-in-1d.json');
    const points = (index: number) => data.series[index].points.map(point => ({ time: point.t, value: point.value }));
    const result = calibrateTraffic(points(0), points(1), { filter: { ...DEFAULT_FILTER, geo: 'IN' }, dailySearches: 18000, tolerance: 0.75 });
    expect(result.weakAnchor).toBe(true);
    expect(result.traffic.average).toBeNull();
  });
});
