import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { queryTrends, TrendsResponse } from '../src/api.js';
import { SnapshotStore, askTerm } from '../src/snapshot.js';
import { validateTerms } from '../src/validate.js';

const dirs: string[] = [];
const store = () => {
  const snapshots = new SnapshotStore(mkdtempSync(join(tmpdir(), 'gtfa-validation-stop-')));
  dirs.push(snapshots.dir);
  return snapshots;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const meta = () => ({ upstreamRequests: 1, durationMs: 0, warnings: [] as string[], fetchedAt: new Date().toISOString() });
const success: typeof queryTrends = async input => {
  const queries = (input as { queries: string[] }).queries;
  return {
    status: 'ok',
    input,
    meta: meta(),
    data: {
      interestOverTime: {
        timeline: Array.from({ length: 12 }, (_, i) => ({
          time: new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
          values: queries.map((_, j) => j === queries.length - 1 ? 10 : 20),
        })),
      },
      relatedQueries: { top: [{ query: 'related', value: 100 }], rising: [] },
      interestBySubregion: { rows: [] },
    },
  };
};
const blocked = (input: unknown, code: 'BLOCKED' | 'RATE_LIMITED', retryAfterSec: number): TrendsResponse => ({
  status: 'error',
  input,
  error: { code, message: `${code} for test`, retryAfterSec },
  meta: meta(),
});

describe('validation stop propagation', () => {
  it.each(['BLOCKED', 'RATE_LIMITED'] as const)(
    'does not query terms or accept cached data after Trending Now reports %s',
    async code => {
      const snapshots = store();
      await askTerm('cached', { store: snapshots, query: success });
      const query = vi.fn(success);
      const rows = await validateTerms(['fresh', 'cached'], {
        store: snapshots,
        query,
        trending: true,
        trendingFetch: async () => ({
          status: 'error',
          geo: 'US',
          hours: 24,
          items: [],
          fetchedAt: meta().fetchedAt,
          error: { code, message: `trending ${code}`, retryAfterSec: 31 },
          meta: { upstreamRequests: 1, durationMs: 0 },
        }),
      });
      expect(query).not.toHaveBeenCalled();
      expect(rows.every(r => r.verdict === 'blocked' && r.confidence === 'low' && r.retryAfterSec === 31)).toBe(true);
      expect(rows.every(r => r.reasons.includes(code) && r.anchor.traffic.average === null)).toBe(true);
    },
  );

  it('blocks prior pending leads and does not let cached rows bypass an earlier term block', async () => {
    const snapshots = store();
    await askTerm('cached', { store: snapshots, query: success });
    const query = vi.fn<typeof queryTrends>(async input => {
      const first = (input as { queries: string[] }).queries[0];
      return first === 'blocked' ? blocked(input, 'RATE_LIMITED', 41) : success(input);
    });
    const rows = await validateTerms(['ready', 'blocked', 'cached'], { store: snapshots, query });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.map(([input]) => (input as { queries: string[] }).queries[0])).toEqual(['ready', 'blocked']);
    expect(rows.every(r => r.verdict === 'blocked' && r.confidence === 'low' && r.retryAfterSec === 41)).toBe(true);
    expect(rows.every(r => r.reasons.includes('RATE_LIMITED') && r.anchor.traffic.average === null)).toBe(true);
    expect(rows[2].source).toBe('live');
  });

  it('marks the blocked comparison batch and future pending rows while preserving completed batches', async () => {
    let comparisons = 0;
    const query = vi.fn<typeof queryTrends>(async input => {
      const queries = (input as { queries: string[] }).queries;
      if (queries.includes('sudoku') && ++comparisons === 2) return blocked(input, 'RATE_LIMITED', 23);
      return success(input);
    });
    const terms = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const rows = await validateTerms(terms, { store: store(), query });
    expect(query).toHaveBeenCalledTimes(11);
    expect(rows.slice(0, 4).every(r => r.verdict !== 'blocked' && r.anchor.traffic.average !== null)).toBe(true);
    expect(rows.slice(4).every(r => r.verdict === 'blocked' && r.confidence === 'low' && r.retryAfterSec === 23)).toBe(true);
    expect(rows.slice(4).every(r => r.reasons.includes('RATE_LIMITED') && r.anchor.traffic.average === null)).toBe(true);
  });

  it('marks every duplicate lead row when its shared comparison is blocked', async () => {
    const query = vi.fn<typeof queryTrends>(async input =>
      (input as { queries: string[] }).queries.length > 1
        ? blocked(input, 'BLOCKED', 19)
        : success(input));
    const rows = await validateTerms([
      { name: 'same', source: 'first' },
      { name: 'same', source: 'second' },
    ], { store: store(), query });
    expect(query).toHaveBeenCalledTimes(2);
    expect(rows.map(r => r.input.source)).toEqual(['first', 'second']);
    expect(rows.every(r => r.verdict === 'blocked' && r.confidence === 'low' && r.retryAfterSec === 19)).toBe(true);
    expect(rows.every(r => r.reasons.includes('BLOCKED') && r.anchor.traffic.average === null)).toBe(true);
  });

  it('keeps stopOnBlocked=false semantics by continuing to later comparison batches', async () => {
    let comparisons = 0;
    const query = vi.fn<typeof queryTrends>(async input => {
      const queries = (input as { queries: string[] }).queries;
      if (queries.includes('sudoku') && ++comparisons === 1) return blocked(input, 'BLOCKED', 17);
      return success(input);
    });
    const rows = await validateTerms(['a', 'b', 'c', 'd', 'e'], {
      store: store(),
      query,
      stopOnBlocked: false,
    });
    expect(query).toHaveBeenCalledTimes(7);
    expect(rows.slice(0, 4).every(r => r.verdict === 'blocked' && r.retryAfterSec === 17)).toBe(true);
    expect(rows[4].verdict).not.toBe('blocked');
    expect(rows[4].anchor.traffic.average).not.toBeNull();
  });
});
