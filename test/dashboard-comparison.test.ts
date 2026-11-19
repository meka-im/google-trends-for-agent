import { describe, expect, it, vi } from 'vitest';
import { calibratedComparison } from '../src/dashboard-comparison.js';
import { estimateRequest } from '../src/dashboard-estimate.js';
import { calibratedSnapshot } from '../src/dashboard-volume.js';
import type { QueryRecord } from '../src/query-history-types.js';

function source(anchorValue?: number, scores: Record<string, number> = {}) {
  const anchors: Record<string, number> = {
    'psi to bar': 15, 'kph to mph': 11, 'oz to ml': 35, 'word search': 100, sudoku: 38, instagram: 70, gpts: 8,
  };
  return vi.fn(async (input: Record<string, unknown>) => ({ ok: true, status: 'ok', filter: { geo: input.geo ?? 'US', time: input.time ?? 'now 1-d' },
    series: (input.keywords as string[]).map(keyword => {
      const anchor = anchors[keyword.toLowerCase()];
      const value = scores[keyword] ?? (anchor === undefined ? keyword === 'Alpha' ? 40 : 60 : anchorValue ?? anchor);
      return { keyword, average: value, latest: value, peak: value, points: Array.from({ length: 24 }, (_, index) => ({ t: new Date(Date.UTC(2026, 10, 1, index)).toISOString(), value })) };
    }), meta: { actorRunId: 'one-run', fetchedAt: '2026-11-02T00:00:00Z' } }));
}
describe('one-batch dashboard comparison', () => {
  it('selects the nearest usable reference for each term in one shared request', async () => {
    const searches: Record<string, number> = {
      Alpha: 2400, Beta: 13500, 'kph to mph': 1600, 'oz to ml': 5300, 'word search': 15000, sudoku: 88000, instagram: 990000,
    };
    const execute = vi.fn(async (input: Record<string, unknown>) => {
      const terms = input.keywords as string[];
      const peak = Math.max(...terms.map(term => searches[term]!));
      return source(undefined, Object.fromEntries(terms.map(term => [term, Math.round(100 * searches[term]! / peak)])))(input);
    });
    const progress = vi.fn();
    const result = await calibratedComparison({ keywords: ['Alpha', 'Beta'], time: 'now 1-d' }, { geo: 'US' }, execute, progress);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![0].keywords).toEqual(['Alpha', 'Beta', 'word search', 'oz to ml', 'kph to mph']);
    expect(result.series.map(row => row.keyword)).toEqual(['Alpha', 'Beta']);
    expect(result.series[1]!.peak).toBe(100);
    expect(result.calibration.series.map(row => row.anchor?.term)).toEqual(['kph to mph', 'word search']);
    expect(result.calibration.series.map(row => row.traffic.average)).toEqual([2327, 13500]);
    expect(result.meta.actorRunId).toBe('one-run'); expect(progress).toHaveBeenCalledOnce();
  });
  it('returns a volume for the strong term when the same batch suppresses the weak term', async () => {
    const execute = source(undefined, { DSH: 0, 'GTA 6': 100, 'oz to ml': 0, sudoku: 2, instagram: 50 });
    const result = await calibratedComparison({ keywords: ['DSH', 'GTA 6'] }, { geo: 'US', anchor: 'instagram' }, execute, () => {});
    expect(execute).toHaveBeenCalledOnce();
    expect(result.calibration.series.map(row => [row.keyword, row.anchor?.term, row.traffic.average])).toEqual([
      ['DSH', undefined, null], ['GTA 6', 'instagram', 1980000],
    ]);
  });
  it('uses the first batch to guide a follow-up for a visible term with weak anchors', async () => {
    const keywords = ['Alpha', 'Beta'], time = 'today 1-m', geo = 'US';
    const execute = source(undefined, { Alpha: 0, Beta: 14, 'word search': 2, 'oz to ml': 1, 'kph to mph': 0 });
    const result = await calibratedComparison({ keywords, time, geo }, { geo }, execute, () => {});
    const record: QueryRecord = {
      id: 'first-batch', tool: 'trends_compare', terms: keywords, source: 'manual', egress: 'actor-own',
      geo, time, status: 'ok', cached: false, createdAt: '2026-11-02T00:00:00Z', fetchedAt: null,
      durationMs: 100, actorRunId: 'one-run', costUsd: null, errorCode: null,
    };
    expect(execute).toHaveBeenCalledOnce();
    expect(result.calibration.series[1]).toMatchObject({ reason: 'anchor', traffic: { average: null } });
    expect(estimateRequest({ record, result }, 'Beta', { geo })?.references.map(anchor => anchor.term))
      .toEqual(['sudoku', 'youtube music']);
    expect(estimateRequest({ record, result }, 'Alpha', { geo })?.references.map(anchor => anchor.term))
      .toEqual(['psi to bar', 'kph to mph']);
  });
  it('calibrates sustained low scores from a single-term snapshot with a strong reference', () => {
    const points = Array.from({ length: 32 }, (_, i) => ({ t: new Date(Date.UTC(2026, 9, 19 + i)).toISOString(), score: 5 }));
    const result = calibratedSnapshot({
      ok: true, anchor: { term: 'sudoku' }, series: { points, anchorPoints: points.map(point => ({ ...point, score: 88 })) },
    }, { term: 'Alpha', geo: 'US', time: 'today 1-m' }, { geo: 'US' });
    expect(result).toMatchObject({ calibration: { status: 'ok', series: [{ traffic: { average: 5000, peak: 5000 } }] } });
  });
  it('reports the anchor spread when compatible samples imply materially different volumes', async () => {
    const execute = source(undefined, { 'word search': 0, 'oz to ml': 20, 'kph to mph': 60 });
    const result = await calibratedComparison({ keywords: ['Alpha', 'Beta'] }, { geo: 'US' }, execute, () => {});
    expect(result.calibration.series[0]).toMatchObject({
      reason: 'disagreement', traffic: { average: null }, range: { low: 1067, high: 10600 },
    });
  });
  it('uses settled daily samples for both the mean and peak', async () => {
    const base = source(undefined, { Alpha: 10, 'word search': 10 });
    const execute = async (input: Record<string, unknown>) => {
      const result = await base(input);
      for (const term of result.series) {
        term.points.forEach((point, i) => { point.t = new Date(Date.UTC(2026, 10, i + 1)).toISOString(); });
        if (term.keyword === 'Alpha') term.points.slice(-2).forEach(point => { point.value = 100; });
      }
      return result;
    };
    const result = await calibratedComparison({ keywords: ['Alpha', 'Beta'], time: 'today 1-m' }, { geo: 'US', anchor: 'word search' }, execute, () => {});
    const alpha = result.calibration.series[0]!;
    expect(alpha.traffic).toMatchObject({ average: 15000, latest: 15000, peak: 15000, settledLatest: 15000 });
    expect(alpha.points).toHaveLength(22);
    expect(alpha.points.at(-1)?.t).toBe('2026-11-22T00:00:00.000Z');
  });
  it('uses the US low anchor only in eligible daily comparisons', async () => {
    const daily = source(undefined, { Alpha: 15 });
    const input = { keywords: ['Alpha', 'Beta'], time: 'today 1-m' };
    const settings = { geo: 'US', anchor: 'psi to bar' };
    const result = await calibratedComparison(input, settings, daily, () => {});
    expect(daily).toHaveBeenCalledExactlyOnceWith({ ...input, keywords: ['Alpha', 'Beta', 'psi to bar'] });
    expect(result.calibration.series[0]).toMatchObject({ anchor: { term: 'psi to bar' }, traffic: { average: 480 } });
    const hourly = source();
    await calibratedComparison({ ...input, time: 'now 7-d' }, settings, hourly, () => {});
    expect(hourly.mock.calls[0]![0].keywords).toEqual(['Alpha', 'Beta', 'word search', 'oz to ml', 'kph to mph']);
  });
  it('keeps the actual score when auto-added anchors overwhelm every requested term', async () => {
    const execute = source(undefined, { Alpha: 1, Beta: 2, 'word search': 100 });
    const result = await calibratedComparison({ keywords: ['Alpha', 'Beta'] }, { geo: 'US' }, execute, () => {});
    expect(result.calibration.weakComparison).toBe(true);
    expect(result.series.map(row => row.peak)).toEqual([1, 2]);
  });
  it('accepts four user terms plus one anchor, without a second query', async () => {
    const execute = source();
    const result = await calibratedComparison({ keywords: ['Alpha', 'Beta', 'Gamma', 'Delta'] }, { geo: 'US' }, execute, () => {});
    expect(execute).toHaveBeenCalledOnce(); expect(execute.mock.calls[0]![0].keywords).toHaveLength(5);
    expect(result.calibration.series).toHaveLength(4);
  });
  it('keeps five user terms in one request and reports the occupied anchor slot honestly', async () => {
    const execute = source(), keywords = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
    const result = await calibratedComparison({ keywords }, { geo: 'US' }, execute, () => {});
    expect(execute).toHaveBeenCalledExactlyOnceWith({ keywords });
    expect(result.series).toHaveLength(5); expect(result.calibration.reasonCode).toBe('capacity');
    expect(result.calibration.series.every(series => series.traffic.average === null)).toBe(true);
  });
  it('can calibrate five selected terms when they already include a known regional anchor', async () => {
    const execute = source(), keywords = ['Alpha', 'Beta', 'Gamma', 'Delta', 'sudoku'];
    const result = await calibratedComparison({ keywords, time: 'today 1-m' }, { geo: 'US' }, execute, () => {});
    expect(execute).toHaveBeenCalledOnce(); expect(execute.mock.calls[0]![0].keywords).toEqual(keywords);
    expect(result.calibration.anchor.term).toBe('sudoku');
    expect(result.calibration.series.at(-1)!.traffic.average).toBe(88000);
  });
  it('returns null for a weak anchor or an unsupported region and never retries', async () => {
    const weak = source(0);
    const result = await calibratedComparison({ keywords: ['Alpha', 'Beta'] }, { geo: 'US' }, weak, () => {});
    expect(weak).toHaveBeenCalledOnce(); expect(result.calibration.series.every(series => series.traffic.average === null)).toBe(true);
    expect(result.calibration.series.map(series => series.reason)).toEqual(['anchor', 'anchor']);
    for (const geo of ['NZ', 'AU', 'IN']) {
      const unsupported = source();
      const input = { keywords: ['Alpha', 'Beta'], geo };
      const other = await calibratedComparison(input, { geo: 'US' }, unsupported, () => {});
      expect(unsupported).toHaveBeenCalledExactlyOnceWith(input);
      expect(other.calibration.reasonCode).toBe('baseline');
      expect(other.series[0]!.peak).toBe(40);
    }
  });
  it('uses the selected region and a user baseline in the same shared batch', async () => {
    const execute = source(20);
    const result = await calibratedComparison({ keywords: ['Alpha', 'Beta'], geo: ' ca ' }, {
      geo: 'US', anchor: 'sudoku', baselines: { version: 2, anchors: [{ term: 'sudoku', geo: 'CA', dailySearches: 10000, tolerance: .25 }] },
    }, execute, () => {});
    expect(execute).toHaveBeenCalledOnce();
    expect(result.calibration.series[0]!.traffic).toMatchObject({ average: 20000, low: 15000, high: 25000 });
  });
  it('preserves blocking codes without starting a follow-up query', async () => {
    const execute = vi.fn(async () => ({ ok: false, status: 'blocked', error: { code: 'RATE_LIMITED', retryAfterSec: 600 }, series: [] }));
    const result = await calibratedComparison({ keywords: ['Alpha', 'Beta'] }, { geo: 'US' }, execute, () => {});
    expect(execute).toHaveBeenCalledOnce(); expect(result).toMatchObject({ ok: false, status: 'blocked', error: { code: 'RATE_LIMITED', retryAfterSec: 600 } });
  });
});
