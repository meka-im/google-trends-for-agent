import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { estimateBatch, recoverComparisonCurves } from '../src/dashboard-batch.js';
import { calibratedComparison } from '../src/dashboard-comparison.js';
import { estimateRequest } from '../src/dashboard-estimate.js';
import { singleVolume } from '../src/dashboard-single.js';
import { calibratedSnapshot } from '../src/dashboard-volume.js';
import type { QueryRecord, SavedQuery } from '../src/query-history-types.js';

describe('on-demand batch calibration', () => {
  const terms = ['One', 'Two', 'Three', 'Four', 'Five'];
  const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, i + 1)).toISOString());
  const points = (value: number) => dates.map(t => ({ t, value }));
  const saved = {
    record: { terms, geo: 'US', time: 'today 1-m' },
    result: { series: terms.map(keyword => ({ keyword, points: points(40) })) },
  } as SavedQuery;

  it('infers the fifth term from the original comparison with one paid request', async () => {
    const compare = vi.fn(async (keywords: string[]) => ({ ok: true, series: keywords.map(keyword => ({ keyword, points: points(40) })) }));
    const state = await estimateBatch(saved, { geo: 'US' }, 'request', compare, async () => {}, async () => null);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0]![0]).toHaveLength(5);
    expect(state.series.every(row => row.traffic.average === 1600)).toBe(true);
    expect(state.series.filter(row => row.via)).toHaveLength(1);
  });

  it('rechecks weak terms, preserves dense low-score curves, and recovers older comparisons', async () => {
    const compare = vi.fn(async (keywords: string[]) => ({ ok: true, series: keywords.map(keyword => ({ keyword, points: points(keyword === 'Five' ? 0 : 40) })) }));
    const state = await estimateBatch(saved, { geo: 'US' }, 'request', compare, async () => {}, async () => null);
    expect(compare.mock.calls[1]![0]).toEqual(['Five', 'psi to bar']);
    expect(state.series.find(row => row.keyword === 'Five')).toMatchObject({ reason: 'samples', traffic: { average: null } });

    const scores = terms.slice(0, 2).map((keyword, i) => ({ keyword, points: dates.map((t, n) => ({ t, value: i ? 2 + (n % 2) : 50 })) }));
    const input = { ...saved, record: { ...saved.record, tool: 'trends_compare' as const, terms: ['One', 'Two'] }, result: { series: scores } };
    const dense = await estimateBatch(input, { geo: 'US' }, 'id', async keywords => ({
      ok: true, series: keywords.map(keyword => scores.find(s => s.keyword === keyword) ?? { keyword, points: points(25) }),
    }), async () => {}, async () => null);
    const weak = dense.series.find(s => s.keyword === 'Two')!;
    expect(weak.traffic.average).toBe(160);
    weak.traffic.average = null; weak.points = []; weak.reason = 'samples'; delete weak.anchor;
    recoverComparisonCurves({ ...input, result: { ...input.result, batchVolume: dense } });
    expect(dense.series.find(s => s.keyword === 'Two')).toMatchObject({ via: 'One', traffic: { average: 160 } });
  });

  it('never invents sample evidence on upstream errors and allows manual retry', async () => {
    const one = { ...saved, record: { ...saved.record, terms: ['One'] } };
    const compare = vi.fn(async (keywords: string[]) => ({ ok: true, series: keywords.map(keyword => ({ keyword, points: points(40) })) } as Record<string, unknown>));
    for (const code of ['NETWORK_ERROR', 'RATE_LIMITED', 'BLOCKED'] as const) {
      compare.mockResolvedValueOnce({ ok: false, meta: { actorRunId: 'one' }, error: { code } });
      const failed = await estimateBatch(one, { geo: 'US' }, `req-${code}`, compare, async () => {}, async () => null);
      expect(failed).toMatchObject({ complete: false, error: code, series: [] });
    }
    const recovered = await estimateBatch(one, { geo: 'US' }, 'manual-retry', compare, async () => {}, async () => null);
    expect(recovered.series[0]?.traffic.average).toBe(1600);
    expect(recovered.complete).toBe(true);
  });
});

describe('single-keyword automatic calibration', () => {
  const real = JSON.parse(readFileSync(new URL('./fixtures/single-jensen-us-month.json', import.meta.url), 'utf8'));
  const points = (values: number[]) => values.map((score, i) => ({ t: new Date(Date.parse(real.start) + i * 86400000).toISOString(), score }));
  const snapshot = (target: number[], reference: number[], anchor = 'word search') => ({
    ok: true, status: 'ok', series: { points: points(target), anchorPoints: points(reference) }, anchor: { term: anchor },
  });
  const input = { term: 'Jensen', geo: 'US', time: 'today 1-m' };
  const constant = (x: number) => Array(32).fill(x);

  it('uses observed signal to select second-round references and recovers archived estimate', async () => {
    const execute = vi.fn().mockResolvedValueOnce(snapshot(real.first.points, real.first.anchorPoints))
      .mockResolvedValueOnce({
        ok: true, series: Object.entries(real.second).map(([keyword, values]) => ({
          keyword, points: points(values as number[]).map(({ t, score }) => ({ t, value: score })),
        })),
      });
    const output = await singleVolume(input, { geo: 'US' }, null, execute, vi.fn());
    expect(execute.mock.calls.map(call => call[1].anchor ?? call[1].keywords)).toEqual([
      'word search', ['Jensen', 'youtube music', 'instagram'],
    ]);
    expect(output.calibration).toMatchObject({ status: 'ok', series: [{ anchor: { term: 'instagram' }, traffic: { average: 260730 } }] });
  });

  it('stops after a usable first sample, avoids uninformative retries, and respects pinned anchors', async () => {
    const good = vi.fn().mockResolvedValue(snapshot(constant(10), constant(60)));
    const ok = await singleVolume(input, { geo: 'US' }, null, good, vi.fn());
    expect(good).toHaveBeenCalledTimes(1);
    expect(ok.calibration).toMatchObject({ status: 'ok', series: [{ traffic: { average: 2500 } }] });

    for (const first of [snapshot(constant(0), constant(0)), snapshot(constant(8), []), { ok: false, status: 'blocked' }]) {
      const exec = vi.fn().mockResolvedValue(first);
      await singleVolume(input, { geo: 'US' }, null, exec, vi.fn());
      expect(exec).toHaveBeenCalledOnce();
    }

    const pinned = vi.fn().mockResolvedValue(snapshot(constant(0), constant(75), 'sudoku'));
    await singleVolume({ ...input, anchor: 'sudoku' }, { geo: 'US' }, null, pinned, vi.fn());
    expect(pinned).toHaveBeenCalledExactlyOnceWith('trends_snapshot', { ...input, anchor: 'sudoku' });
  });

  it.each([[0, 60, ['psi to bar', 'kph to mph']], [60, 0, ['gmail', 'amazon']]] as const)(
    'changes scale for scores %i and %i and surfaces retry errors',
    async (a, b, anchors) => {
      const execute = vi.fn().mockResolvedValueOnce(snapshot(constant(a), constant(b))).mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED' } });
      const output = await singleVolume(input, { geo: 'US' }, null, execute, vi.fn());
      expect(execute.mock.calls[1][1].keywords).toEqual(['Jensen', ...anchors]);
      expect(output).toMatchObject({ ok: true, calibration: { retryError: 'RATE_LIMITED' } });
    },
  );
});

describe('one-batch dashboard comparison', () => {
  function source(anchorValue?: number, scores: Record<string, number> = {}) {
    const anchors: Record<string, number> = {
      'psi to bar': 15, 'kph to mph': 11, 'oz to ml': 35, 'word search': 100, sudoku: 38, instagram: 70, gpts: 8,
    };
    return vi.fn(async (input: Record<string, unknown>) => ({
      ok: true, status: 'ok', filter: { geo: input.geo ?? 'US', time: input.time ?? 'now 1-d' },
      series: (input.keywords as string[]).map(keyword => {
        const anchor = anchors[keyword.toLowerCase()];
        const value = scores[keyword] ?? (anchor === undefined ? keyword === 'Alpha' ? 40 : 60 : anchorValue ?? anchor);
        return { keyword, average: value, latest: value, peak: value, points: Array.from({ length: 24 }, (_, index) => ({ t: new Date(Date.UTC(2026, 10, 1, index)).toISOString(), value })) };
      }),
      meta: { actorRunId: 'one-run', fetchedAt: '2026-11-02T00:00:00Z' },
    }));
  }

  it('selects the nearest usable reference per term and handles strong/weak suppression and spread', async () => {
    const searches: Record<string, number> = {
      Alpha: 2400, Beta: 13500, 'kph to mph': 1600, 'oz to ml': 5300, 'word search': 15000, sudoku: 88000, instagram: 990000,
    };
    const execute = vi.fn(async (input: Record<string, unknown>) => {
      const terms = input.keywords as string[];
      const peak = Math.max(...terms.map(term => searches[term]!));
      return source(undefined, Object.fromEntries(terms.map(term => [term, Math.round(100 * searches[term]! / peak)])))(input);
    });
    const result = await calibratedComparison({ keywords: ['Alpha', 'Beta'], time: 'now 1-d' }, { geo: 'US' }, execute, vi.fn());
    expect(execute).toHaveBeenCalledOnce();
    expect(result.calibration.series.map(row => row.anchor?.term)).toEqual(['kph to mph', 'word search']);
    expect(result.calibration.series.map(row => row.traffic.average)).toEqual([2327, 13500]);

    const suppressed = await calibratedComparison({ keywords: ['DSH', 'GTA 6'] }, { geo: 'US', anchor: 'instagram' },
      source(undefined, { DSH: 0, 'GTA 6': 100, 'oz to ml': 0, sudoku: 2, instagram: 50 }), () => {});
    expect(suppressed.calibration.series.map(row => [row.keyword, row.anchor?.term, row.traffic.average])).toEqual([
      ['DSH', undefined, null], ['GTA 6', 'instagram', 1980000],
    ]);

    const spread = await calibratedComparison({ keywords: ['Alpha', 'Beta'] }, { geo: 'US' },
      source(undefined, { 'word search': 0, 'oz to ml': 20, 'kph to mph': 60 }), () => {});
    expect(spread.calibration.series[0]).toMatchObject({ reason: 'disagreement', traffic: { average: null }, range: { low: 1067, high: 10600 } });
  });

  it('guides follow-up estimates, handles daily-only anchors, and calibrates sustained low single snapshots', async () => {
    const keywords = ['Alpha', 'Beta'], time = 'today 1-m', geo = 'US';
    const result = await calibratedComparison({ keywords, time, geo }, { geo },
      source(undefined, { Alpha: 0, Beta: 14, 'word search': 2, 'oz to ml': 1, 'kph to mph': 0 }), () => {});
    const record: QueryRecord = {
      id: 'first-batch', tool: 'trends_compare', terms: keywords, source: 'manual', egress: 'actor-own',
      geo, time, status: 'ok', cached: false, createdAt: '2026-11-02T00:00:00Z', fetchedAt: null,
      durationMs: 100, actorRunId: 'one-run', costUsd: null, errorCode: null,
    };
    expect(estimateRequest({ record, result }, 'Beta', { geo })?.references.map(a => a.term)).toEqual(['sudoku', 'youtube music']);
    expect(estimateRequest({ record, result }, 'Alpha', { geo })?.references.map(a => a.term)).toEqual(['psi to bar', 'kph to mph']);

    const daily = source(undefined, { Alpha: 15 });
    const dailyRes = await calibratedComparison({ keywords, time }, { geo, anchor: 'psi to bar' }, daily, () => {});
    expect(dailyRes.calibration.series[0]).toMatchObject({ anchor: { term: 'psi to bar' }, traffic: { average: 480 } });
    const hourly = source();
    await calibratedComparison({ keywords, time: 'now 7-d' }, { geo, anchor: 'psi to bar' }, hourly, () => {});
    expect(hourly.mock.calls[0]![0].keywords).toEqual(['Alpha', 'Beta', 'word search', 'oz to ml', 'kph to mph']);

    const pts = Array.from({ length: 32 }, (_, i) => ({ t: new Date(Date.UTC(2026, 9, 19 + i)).toISOString(), score: 5 }));
    expect(calibratedSnapshot({ ok: true, anchor: { term: 'sudoku' }, series: { points: pts, anchorPoints: pts.map(p => ({ ...p, score: 88 })) } },
      { term: 'Alpha', geo, time }, { geo })).toMatchObject({ calibration: { status: 'ok', series: [{ traffic: { average: 5000, peak: 5000 } }] } });
  });

  it('enforces 5-slot capacity, unsupported regions, user overrides, and upstream blocking', async () => {
    const five = await calibratedComparison({ keywords: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'] }, { geo: 'US' }, source(), () => {});
    expect(five.calibration.reasonCode).toBe('capacity');

    const withAnchor = await calibratedComparison({ keywords: ['Alpha', 'Beta', 'Gamma', 'Delta', 'sudoku'], time: 'today 1-m' }, { geo: 'US' }, source(), () => {});
    expect(withAnchor.calibration.anchor.term).toBe('sudoku');
    expect(withAnchor.calibration.series.at(-1)!.traffic.average).toBe(88000);

    const unsupported = await calibratedComparison({ keywords: ['Alpha', 'Beta'], geo: 'IN' }, { geo: 'US' }, source(), () => {});
    expect(unsupported.calibration.reasonCode).toBe('baseline');

    const custom = await calibratedComparison({ keywords: ['Alpha', 'Beta'], geo: ' ca ' }, {
      geo: 'US', anchor: 'sudoku', baselines: { version: 2, anchors: [{ term: 'sudoku', geo: 'CA', dailySearches: 10000, tolerance: 0.25 }] },
    }, source(20), () => {});
    expect(custom.calibration.series[0]!.traffic).toMatchObject({ average: 20000, low: 15000, high: 25000 });

    const blocked = await calibratedComparison({ keywords: ['Alpha', 'Beta'] }, { geo: 'US' },
      vi.fn(async () => ({ ok: false, status: 'blocked', error: { code: 'RATE_LIMITED', retryAfterSec: 600 }, series: [] })), () => {});
    expect(blocked).toMatchObject({ ok: false, status: 'blocked', error: { code: 'RATE_LIMITED', retryAfterSec: 600 } });
  });
});
