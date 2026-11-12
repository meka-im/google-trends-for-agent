import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TIME_RANGES } from '../src/core.js';
import { anchorDailySearches, defaultAnchorFor, findAnchor, loadBaselines, loadBaselinesFromEnv, type Baselines } from '../src/traffic.js';

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
  it('uses sudoku for 1-hour/4-hour/1-day and gpts for 7 days and longer', () => {
    const short = new Set(['now 1-H', 'now 4-H', 'now 1-d']);
    for (const time of TIME_RANGES) expect(defaultAnchorFor(time)).toBe(short.has(time) ? 'sudoku' : 'gpts');
  });

  it('honors windowAnchors and custom anchor terms', async () => {
    const b = await loadBaselines(write({ version: 2, anchors: [
      { term: 'chairs', geo: 'US', dailySearches: 22500, tolerance: 0.5 },
      { term: 'thesaurus', geo: 'US', dailySearches: 4000 },
    ], windowAnchors: { short: 'chairs', long: 'thesaurus' } }));
    expect(defaultAnchorFor('now 1-H', b)).toBe('chairs');
    expect(defaultAnchorFor('now 1-d', b)).toBe('chairs');
    expect(defaultAnchorFor('now 7-d', b)).toBe('thesaurus');
    expect(defaultAnchorFor('all', b)).toBe('thesaurus');
    expect(findAnchor(b, 'chairs', 'US')).toMatchObject({ term: 'chairs', dailySearches: 22500 });
  });

  it('prefers a user anchor over the built-in anchor with the same term and geo', () => {
    const b: Baselines = { version: 2, anchors: [{ term: 'sudoku', geo: 'US', dailySearches: 12000, tolerance: 0.2 }] };
    expect(findAnchor(b, 'sudoku', 'US')).toMatchObject({ dailySearches: 12000, tolerance: 0.2 });
    expect(findAnchor(undefined, 'sudoku', 'US')).toMatchObject({ dailySearches: 9900, tolerance: 0.5 });
    expect(anchorDailySearches(findAnchor(b, 'sudoku', 'US')!)).toBe(12000);
  });
});

describe('baselines file validation', () => {
  it('rejects version 1 instead of translating it', async () => {
    await expect(loadBaselines(write({ version: 1, anchors: [{ term: 'gpts', geo: 'US', dailySearches: 550 }] })))
      .rejects.toThrow(/version 1 is no longer supported/);
  });

  it('rejects a window anchor that is not in anchors or the built-ins', async () => {
    await expect(loadBaselines(write({ version: 2, anchors: [{ term: 'gpts', geo: 'US', dailySearches: 550 }], windowAnchors: { short: 'chairs' } })))
      .rejects.toThrow(/not in anchors or the built-in anchors/);
  });

  it('loads GTFA_BASELINES and reports invalid files clearly', async () => {
    const path = write({ version: 2, anchors: [{ term: 'sudoku', geo: 'US', dailySearches: 12345 }] });
    process.env.GTFA_BASELINES = path;
    await expect(loadBaselinesFromEnv()).resolves.toMatchObject({ version: 2, anchors: [{ term: 'sudoku', dailySearches: 12345 }] });
    process.env.GTFA_BASELINES = join(path, 'missing.json');
    await expect(loadBaselinesFromEnv()).rejects.toThrow(/GTFA_BASELINES: Invalid baselines:/);
  });
});
