import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { askEnvelope } from '../src/mcp.js';
import { SnapshotStore, type TermSnapshot } from '../src/snapshot.js';
import { runAskCli } from '../src/ask-cli.js';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/gap-snapshot.json', import.meta.url), 'utf8')) as TermSnapshot;
describe('low-sample interest gaps', () => {
  it('marks zero points between the first and last nonzero point, never leading/trailing zeros', () => {
    const snap = fixture();
    const e = askEnvelope(snap, { cached: false, ageMin: 0, diff: null, includePoints: true });
    expect(e.interest.points.map(p => p.gap ?? false)).toEqual([false, false, true, false, true, false, true, false, true, false, false, true, false]);
    expect(e.interest.gapCount).toBe(5);
    expect(e.interest.points.filter(p => p.gap).every(p => p.value === 0)).toBe(true);
    expect(e.meta.warnings).toHaveLength(1);
    expect(e.meta.warnings[0]).toContain('5 low-sample gap points');
  });
  it('excludes gaps from average and peak', () => {
    const e = askEnvelope(fixture(), { cached: false, ageMin: 0, diff: null });
    // The leading zero is a real zero (not a gap); 410 over the 8 non-gap points. Including
    // the five gap zeros too would give 31.5 instead of 51.3.
    expect(e.interest.average).toBe(51.3);
    expect(e.interest.peak).toBe(70);
  });
  it('skips a gap at the end of the settled window for settledLatest', () => {
    const e = askEnvelope(fixture(), { cached: false, ageMin: 0, diff: null });
    // The final 60 is the unsettled point; the point before it is a gap, so 55 is the settled latest.
    expect(e.interest.latest).toBe(60);
    expect(e.interest.settledLatest).toBe(55);
  });
  it('adds no gap warning and keeps raw stats when no gaps exist', () => {
    const snap = { ...fixture(), interest: { points: [{ time: '2026-10-30T00:00:00.000Z', value: 0 }, { time: '2026-10-30T01:00:00.000Z', value: 10 }, { time: '2026-10-30T02:00:00.000Z', value: 20 }], latest: 20, peak: 20, settledLatest: 10 } };
    const e = askEnvelope(snap, { cached: false, ageMin: 0, diff: null });
    expect(e.interest).toMatchObject({ average: 10, gapCount: 0, settledLatest: 10 });
    expect(e.meta).not.toHaveProperty('warnings');
  });
});
describe('CLI ask --json', () => {
  it('emits the same ask envelope shape as MCP instead of the raw snapshot wrapper', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gtfa-gap-')); dirs.push(dir);
    await new SnapshotStore(dir).save(fixture());
    const r = await runAskCli(['low sample', '--json', '--points', '--refresh', 'never', '--store', dir]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    const plain = JSON.parse((await runAskCli(['low sample', '--json', '--refresh', 'never', '--store', dir])).stdout);
    expect(plain.interest).not.toHaveProperty('points');
    expect(plain.interest).toMatchObject({ average: 51.3, peak: 70, gapCount: 5 });
    expect(out).toMatchObject({ ok: true, schemaVersion: 1, status: 'ok', term: 'low sample', filter: { geo: 'US', time: 'now 1-d', category: 0, property: 'web' },
      interest: { gapCount: 5, average: 51.3, latest: 60, settledLatest: 55, peak: 70 }, diff: null, diffReason: 'Need two snapshots', meta: { cached: true, snapshotId: 'gap-fixture' } });
    expect(out.interest.points[2]).toEqual({ t: '2026-10-30T02:00:00.000Z', value: 0, gap: true });
    expect(out).not.toHaveProperty('snapshot');
    expect(out).not.toHaveProperty('source');
  });
});
describe('gap-aware diff and thresholds', () => {
  it('diff.interestDelta uses gap-aware settledLatest', async () => {
    const { diffSnapshots } = await import('../src/snapshot.js');
    const a = fixture(), b = { ...fixture(), id: 'gap-fixture-2' };
    const d = diffSnapshots(a, b);
    expect(d.interestDelta).toEqual({ latestFrom: 55, latestTo: 55, delta: 0 });
  });
  it('does not mark zeros when half or more of the series is zero', async () => {
    const { detectGaps } = await import('../src/gaps.js');
    expect(detectGaps([{ value: 10 }, { value: 0 }, { value: 0 }, { value: 10 }])).toEqual([false, false, false, false]);
    expect(detectGaps([{ value: 10 }, { value: 0 }, { value: 10 }, { value: 10 }, { value: 0 }])).toEqual([false, true, false, false, false]);
  });
});
describe('now --json input rejection', () => {
  it('uses the schema-rejection envelope for unknown flags and invalid hours', async () => {
    const { runTrendingCli } = await import('../src/trending-cli.js');
    for (const args of [['--json', '--bogus'], ['--json', '--geo', 'US', '--hours', '5']]) {
      const r = await runTrendingCli(args, { fetch: (async () => { throw new Error('no network'); }) as typeof fetch } as never);
      expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(r.code).toBe(4);
    }
  });
});
