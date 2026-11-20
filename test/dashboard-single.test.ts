import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { singleVolume } from '../src/dashboard-single.js';

const real = JSON.parse(readFileSync(new URL('./fixtures/single-jensen-us-month.json', import.meta.url), 'utf8'));
const points = (values: number[]) => values.map((score, i) => ({ t: new Date(Date.parse(real.start) + i * 86400000).toISOString(), score }));
const snapshot = (target: number[], reference: number[], anchor = 'word search') => ({
  ok: true, status: 'ok', series: { points: points(target), anchorPoints: points(reference) }, anchor: { term: anchor },
});
const input = { term: 'Jensen', geo: 'US', time: 'today 1-m' };
const constant = (x: number) => Array(32).fill(x);

describe('single-keyword automatic calibration', () => {
  it('uses the observed Jensen signal to select both second-round references and recovers the archived estimate', async () => {
    const execute = vi.fn().mockResolvedValueOnce(snapshot(real.first.points, real.first.anchorPoints))
      .mockResolvedValueOnce({ ok: true, series: Object.entries(real.second).map(([keyword, values]) => ({
        keyword, points: points(values as number[]).map(({t, score}) => ({ t, value: score })),
      })) });
    const output = await singleVolume(input, { geo: 'US' }, null, execute, vi.fn());
    expect(execute.mock.calls.map(call => call[1].anchor ?? call[1].keywords)).toEqual([
      'word search', ['Jensen', 'youtube music', 'instagram'],
    ]);
    expect(output.calibration).toMatchObject({ status: 'ok', series: [{ anchor: { term: 'instagram' }, traffic: { average: 260730 } }] });
  });
  it('stops after a usable first sample', async () => {
    const execute = vi.fn().mockResolvedValue(snapshot(constant(10), constant(60)));
    const output = await singleVolume(input, { geo: 'US' }, null, execute, vi.fn());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(output.calibration).toMatchObject({ status: 'ok', series: [{ traffic: { average: 2500 } }] });
  });
  it.each([[0,60,['psi to bar','kph to mph']], [2,60,['psi to bar','kph to mph']],
    [60,0,['gmail','amazon']]] as const)('changes scale for scores %i and %i', async (a,b,anchors) => {
    const execute = vi.fn().mockResolvedValueOnce(snapshot(constant(a), constant(b))).mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED' } });
    const output = await singleVolume(input, { geo: 'US' }, null, execute, vi.fn());
    expect(execute.mock.calls[1][1].keywords).toEqual(['Jensen', ...anchors]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(output).toMatchObject({ ok: true, calibration: { retryError: 'RATE_LIMITED' } });
  });
  it.each([snapshot(constant(0),constant(0)), snapshot(constant(8),[]), { ok:false,status:'blocked' }])('avoids an uninformative retry', async first => {
    const execute = vi.fn().mockResolvedValue(first);
    await singleVolume(input, {geo:'US'}, null, execute, vi.fn());
    expect(execute).toHaveBeenCalledOnce();
  });
  it('respects a pinned anchor and never tries a different tier', async () => {
    const execute = vi.fn().mockResolvedValue(snapshot(constant(0),constant(75),'sudoku'));
    await singleVolume({...input,anchor:'sudoku'}, {geo:'US'}, null, execute, vi.fn());
    expect(execute).toHaveBeenCalledExactlyOnceWith('trends_snapshot',{...input,anchor:'sudoku'});
  });
});
