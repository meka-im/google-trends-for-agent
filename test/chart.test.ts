import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderTrafficChart, type TrafficChartPoint } from '../src/chart.js';

const at = (iso: string, traffic: number): TrafficChartPoint => ({ t: iso, traffic });
const originalTz = process.env.GTFA_TZ;
beforeEach(() => { delete process.env.GTFA_TZ; });
afterEach(() => {
  if (originalTz === undefined) delete process.env.GTFA_TZ;
  else process.env.GTFA_TZ = originalTz;
});

describe('renderTrafficChart time axis', () => {
  it('defaults to UTC X-axis times and timed peak/latest callouts', () => {
    const points = [
      at('2026-10-31T00:00:00.000Z', 40),
      at('2026-10-31T01:00:00.000Z', 0),
      at('2026-10-31T02:00:00.000Z', 50),
      at('2026-10-31T03:00:00.000Z', 60),
      at('2026-10-31T04:00:00.000Z', 60),
      at('2026-10-31T05:00:00.000Z', 80),
    ];
    const svg = renderTrafficChart({ term: 'Astra', points });
    expect(svg).toContain('Astra — searches/day (UTC)');
    expect(svg).toContain('<title>Astra searches/day (UTC)</title>');
    expect(svg).toContain('aria-label="Astra traffic chart (UTC)"');
    expect(svg).toContain('10/31 00:00');
    expect(svg).toContain('>05:00<');
    expect(svg).toMatch(/peak 80 · 10\/31 05:00/);
    expect(svg).toMatch(/latest 80 · 10\/31 05:00/);
    expect(svg).toContain('class="term-line"');
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('uses Asia/Shanghai when requested explicitly and includes the date when its calendar day changes', () => {
    const points = Array.from({ length: 9 }, (_, i) => at(new Date(Date.UTC(2026, 9, 31, 14 + i)).toISOString(), 10 + i * 10));
    const svg = renderTrafficChart({ term: 'Astra', points, anchorPoints: points, timeZone: 'Asia/Shanghai' });
    expect(svg).toContain('Astra — searches/day (Asia/Shanghai)');
    expect(svg).toContain('<title>Astra searches/day (Asia/Shanghai)</title>');
    expect(svg).toContain('10/31 22:00');
    expect(svg).toContain('>11/1 00:00<');
    expect(svg).toContain('>01:00<');
    expect(svg).toContain('>anchor</text>');
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('uses GTFA_TZ when no explicit time zone is given', () => {
    process.env.GTFA_TZ = 'Asia/Shanghai';
    const svg = renderTrafficChart({ term: 'Astra', points: [at('2026-10-31T00:00:00.000Z', 40)] });
    expect(svg).toContain('Astra — searches/day (Asia/Shanghai)');
    expect(svg).toContain('10/31 08:00');
  });

  it('uses month-oriented labels for long spans and still includes first and last ticks', () => {
    const points = [
      at('2026-01-15T00:00:00.000Z', 10),
      at('2026-04-15T00:00:00.000Z', 30),
      at('2026-07-15T00:00:00.000Z', 60),
      at('2026-10-15T00:00:00.000Z', 90),
      at('2026-12-15T00:00:00.000Z', 120),
    ];
    const svg = renderTrafficChart({ term: 'Astra', points });
    expect(svg).toContain('>2026-01<');
    expect(svg).toContain('>2026-12<');
    expect(svg).toMatch(/peak 120 · 2026-12-15 00:00/);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('rejects an invalid IANA time zone with INVALID_INPUT', () => {
    let error: unknown;
    try { renderTrafficChart({ term: 'Astra', points: [at('2026-10-31T00:00:00.000Z', 40)], timeZone: 'Not/AZone' }); }
    catch (e) { error = e; }
    expect(error).toMatchObject({ code: 'INVALID_INPUT' });
  });
});
