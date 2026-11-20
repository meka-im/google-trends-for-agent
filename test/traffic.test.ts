import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TIME_RANGES } from '../src/core.js';
import { automaticAnchorFor, BASELINE_CATALOG, catalogForGeo } from '../src/baseline-catalog.js';
import { calibrateTraffic } from '../src/calibration.js';
import { DEFAULT_FILTER } from '../src/filter.js';
import { anchorDailySearches, baselinesForActor, defaultAnchorFor, findAnchor, loadBaselines, loadBaselinesFromEnv, parseBaselines, type Baselines } from '../src/traffic.js';
import { snapshotTrafficTerm, trafficSnapshotEnvelope } from '../src/trends-snapshot.js';
import type { queryTrends, TrendsResponse } from '../src/api.js';

const dirs: string[] = [];
const original = process.env.GTFA_BASELINES;
const write = (value: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), 'gtfa-baselines-'));
  dirs.push(dir);
  const path = join(dir, 'baselines.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (original === undefined) delete process.env.GTFA_BASELINES;
  else process.env.GTFA_BASELINES = original;
});

describe('window anchor defaults', () => {
  it('uses MEKA regional default anchors for US across all windows', () => {
    for (const time of TIME_RANGES) expect(defaultAnchorFor(time)).toBe('sudoku');
  });

  it('honors windowAnchors and custom anchor terms', async () => {
    const b = await loadBaselines(write({ version: 2, anchors: [
      { term: 'chairs', geo: ' us ', dailySearches: 143000, tolerance: 0.5 },
      { term: 'thesaurus', geo: 'US', dailySearches: 25700 },
    ], windowAnchors: { short: 'chairs', long: 'thesaurus' } }));
    expect(defaultAnchorFor('now 1-H', b)).toBe('chairs');
    expect(defaultAnchorFor('now 1-d', b)).toBe('chairs');
    expect(defaultAnchorFor('now 7-d', b)).toBe('thesaurus');
    expect(defaultAnchorFor('all', b)).toBe('thesaurus');
    expect(findAnchor(b, 'chairs', ' US ')).toMatchObject({ term: 'chairs', dailySearches: 143000 });
  });

  it('prefers a user anchor over the built-in anchor with the same term and geo', () => {
    const b: Baselines = { version: 2, anchors: [{ term: 'sudoku', geo: 'US', dailySearches: 12000, tolerance: 0.2 }] };
    expect(findAnchor(b, 'sudoku', 'US')).toMatchObject({ dailySearches: 12000, tolerance: 0.2 });
    expect(findAnchor(undefined, 'sudoku', 'US')).toMatchObject({ dailySearches: 88000, tolerance: 0.5 });
    expect(anchorDailySearches(findAnchor(b, 'sudoku', 'US')!)).toBe(12000);
  });

  it('applies both built-in and custom anchors only to web search across all categories', () => {
    expect(findAnchor(undefined, 'sudoku', 'US', { category: 0, property: '' })).toMatchObject({ dailySearches: 88000 });
    expect(findAnchor(undefined, 'sudoku', 'US', { category: 0, property: 'web' })).toMatchObject({ dailySearches: 88000 });
    const custom: Baselines = { version: 2, anchors: [{ term: 'sudoku', geo: 'US', dailySearches: 12000 }] };
    expect(findAnchor(custom, 'sudoku', 'US', { category: 0, property: 'youtube' })).toBeUndefined();
    expect(findAnchor(custom, 'sudoku', 'US', { category: 1, property: 'web' })).toBeUndefined();
    expect(findAnchor(undefined, 'sudoku', 'US', { category: 1, property: 'web' })).toBeUndefined();
  });
});

describe('baselines file validation', () => {
  it('rejects version 1 instead of translating it', async () => {
    await expect(loadBaselines(write({ version: 1, anchors: [{ term: 'gpts', geo: 'US', dailySearches: 3500 }] })))
      .rejects.toThrow(/version 1 is no longer supported/);
  });

  it('rejects a window anchor that is not in anchors or the built-ins', async () => {
    await expect(loadBaselines(write({ version: 2, anchors: [{ term: 'gpts', geo: 'US', dailySearches: 3500 }], windowAnchors: { short: 'chairs' } })))
      .rejects.toThrow(/not in anchors or the built-in anchors/);
  });

  it('rejects malformed, negative, and excessive tolerances', async () => {
    for (const tolerance of ['oops', -0.1, 1.5]) {
      await expect(loadBaselines(write({ version: 2, anchors: [{ term: 'sudoku', geo: 'US', dailySearches: 63000, tolerance }] })))
        .rejects.toThrow(/tolerance must be a number from 0 to 1/);
    }
    await expect(loadBaselines(write({ version: 2, anchors: [{ term: 'sudoku', geo: 'US', dailySearches: 63000, tolerance: 0 }] }))).resolves.toBeTruthy();
  });

  it('loads the shipped examples/baselines.json', async () => {
    const b = await loadBaselines('examples/baselines.json');
    expect(findAnchor(b, 'sudoku', 'US')).toMatchObject({ dailySearches: 63000 });
    expect(findAnchor(b, 'gpts', 'US')).toMatchObject({ dailySearches: 3500 });
    expect(defaultAnchorFor('now 1-d', b)).toBe('sudoku');
    expect(defaultAnchorFor('now 7-d', b)).toBe('gpts');
  });

  it('loads GTFA_BASELINES and reports invalid files clearly', async () => {
    const path = write({ version: 2, anchors: [{ term: 'sudoku', geo: 'US', dailySearches: 12345 }] });
    process.env.GTFA_BASELINES = path;
    await expect(loadBaselinesFromEnv()).resolves.toMatchObject({ version: 2, anchors: [{ term: 'sudoku', dailySearches: 12345 }] });
    process.env.GTFA_BASELINES = join(path, 'missing.json');
    await expect(loadBaselinesFromEnv()).rejects.toThrow(/GTFA_BASELINES: Invalid baselines:/);
  });
});

describe('regional MEKA calibration catalog', () => {
  type RecordedComparison = {
    ok: boolean; filter: { geo: string; time: string };
    series: Array<{ keyword: string; points: Array<{ t: string; value: number }> }>;
    meta: { fetchedAt: string; upstreamRequests: number; durationMs: number; warnings: string[] };
  };
  const recorded = (file: string): RecordedComparison =>
    JSON.parse(readFileSync(new URL(`../validation/2026-11-16-regional-baselines/${file}`, import.meta.url), 'utf8'));

  it('selects MEKA regional defaults, pins Actor baselines, and validates catalog integrity', () => {
    expect(defaultAnchorFor('now 7-d', undefined, ' ca ')).toBe('sudoku');
    expect(defaultAnchorFor('now 7-d', undefined, 'JP')).toBe('テトリス');
    expect(defaultAnchorFor('now 7-d', undefined, 'GB')).toBe('crossword solver');
    expect(defaultAnchorFor('now 7-d', undefined, '')).toBe('stopwatch');
    expect(findAnchor(undefined, 'sudoku', 'SG')).toBeUndefined();

    const custom = parseBaselines({ version: 2, anchors: [{ term: 'sudoku', geo: '', dailySearches: 1000 }] });
    expect(findAnchor(custom, 'sudoku', '')?.dailySearches).toBe(1000);
    expect(findAnchor(custom, 'sudoku', 'US')?.dailySearches).toBe(88000);
    expect(() => parseBaselines({ version: 2, anchors: [{ term: 'sudoku', dailySearches: 1000 }] })).toThrow('invalid baseline anchor');

    const actorCa = baselinesForActor('CA', parseBaselines({ version: 2, anchors: [{ term: 'sudoku', geo: ' ca ', dailySearches: 1234 }], windowAnchors: { short: 'stopwatch' } }));
    expect(actorCa.windowAnchors).toEqual({ short: 'stopwatch', long: 'sudoku' });
    expect(actorCa.anchors.some(a => a.geo === '')).toBe(false);
    expect(findAnchor(actorCa, 'sudoku', 'CA')?.dailySearches).toBe(1234);
    expect(baselinesForActor('').windowAnchors).toEqual({ short: 'stopwatch', long: 'stopwatch' });

    const keys = BASELINE_CATALOG.map(a => JSON.stringify([a.term, a.geo]));
    expect(new Set(keys).size).toBe(keys.length);
    expect(catalogForGeo('').length).toBe(10);
    expect(catalogForGeo('CA').length).toBe(7);
    expect(catalogForGeo('SG')).toEqual([]);
  });

  it('replays recorded regional comparisons through the snapshot path and rejects sparse India probe', async () => {
    for (const geo of ['CA', 'GB', 'DE', 'FR', 'JP', '']) {
      for (const time of ['now 1-d', 'now 7-d']) {
        const data = recorded(`trends-${geo.toLowerCase() || 'world'}-${time === 'now 7-d' ? '7d' : '1d'}.json`);
        const anchor = automaticAnchorFor(time, geo);
        const query: typeof queryTrends = async request => ({
          status: 'ok', input: request, meta: data.meta,
          data: { interestOverTime: { timeline: data.series[0].points.map((p, i) => ({ time: p.t, formattedTime: p.t, values: data.series.map(s => s.points[i].value) })) } },
        }) as unknown as TrendsResponse;
        const snapshot = await snapshotTrafficTerm('ChatGPT', { filter: { geo, time }, query });
        const result = await trafficSnapshotEnvelope(snapshot, { cached: false, ageMin: 0, chartDir: null });
        expect(result.ok).toBe(true);
        expect(result.anchor.term).toBe(anchor);
        expect(result.traffic.average).toBeGreaterThan(0);
      }
    }

    const india = recorded('trends-in-1d.json');
    const pts = (index: number) => india.series[index].points.map(p => ({ time: p.t, value: p.value }));
    const res = calibrateTraffic(pts(0), pts(1), { filter: { ...DEFAULT_FILTER, geo: 'IN' }, dailySearches: 18000, tolerance: 0.75 });
    expect(res.weakAnchor).toBe(true);
    expect(res.traffic.average).toBeNull();
  });
});
