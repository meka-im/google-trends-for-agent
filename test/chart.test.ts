import { describe, expect, it } from 'vitest';
import { renderTrafficChart, type TrafficChartPoint } from '../src/chart.js';

const at = (iso: string, traffic: number): TrafficChartPoint => ({ t: iso, traffic });

describe('renderTrafficChart time axis', () => {
  it('shows Asia/Shanghai X-axis times and timed peak/latest callouts', () => {
    const points = [
      at('2026-10-31T00:00:00.000Z', 40),
      at('2026-10-31T01:00:00.000Z', 0),
      at('2026-10-31T02:00:00.000Z', 50),
      at('2026-10-31T03:00:00.000Z', 60),
      at('2026-10-31T04:00:00.000Z', 60),
      at('2026-10-31T05:00:00.000Z', 80),
    ];
    const svg = renderTrafficChart({ term: 'Astra', points });
    expect(svg).toContain('Astra — searches/day (Asia/Shanghai)');
    expect(svg).toContain('<title>Astra searches/day (Asia/Shanghai)</title>');
    expect(svg).toContain('10/31 08:00');
    expect(svg).toContain('>13:00<');
    expect(svg).toMatch(/peak 80 · 10\/31 13:00/);
    expect(svg).toMatch(/latest 80 · 10\/31 13:00/);
    expect(svg).toContain('class="term-line"');
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('includes the date when the Shanghai calendar day changes and keeps the legend', () => {
    const points = Array.from({ length: 9 }, (_, i) => at(new Date(Date.UTC(2026, 9, 31, 14 + i)).toISOString(), 10 + i * 10));
    const svg = renderTrafficChart({ term: 'Astra', points, anchorPoints: points });
    expect(svg).toContain('10/31 22:00');
    expect(svg).toContain('>11/1 00:00<');
    expect(svg).toContain('>01:00<');
    expect(svg).toContain('>anchor</text>');
    expect(svg).not.toMatch(/NaN|undefined/);
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
    expect(svg).toMatch(/peak 120 · 2026-12-15 08:00/);
    expect(svg).not.toMatch(/NaN|undefined/);
  });
});
