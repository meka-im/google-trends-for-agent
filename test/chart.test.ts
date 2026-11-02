import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderTrafficChart, type TrafficChartPoint } from '../src/chart.js';

const at = (iso: string, traffic: number): TrafficChartPoint => ({ t: iso, traffic });
const CHART_LEFT = 58, CHART_RIGHT = 20, CHART_TOP = 32, CHART_AXIS_Y = 242;
const labelOf = (svg: string, kind: 'peak' | 'latest') => {
  const match = svg.match(new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"(?: text-anchor="(start|end)")?[^>]*font-size="([\\d.]+)"[^>]*>${kind} ([^<]*)</text>`));
  expect(match).not.toBeNull();
  const [, rawX, rawY, rawAnchor, rawFontSize, callout] = match!;
  const text = `${kind} ${callout}`;
  const x = Number(rawX), y = Number(rawY), anchor = (rawAnchor as 'start' | 'end' | undefined) ?? 'start';
  const fontSize = Number(rawFontSize);
  const width = text.length * fontSize * 0.6;
  const left = anchor === 'end' ? x - width : x;
  return { x, y, anchor, text, fontSize, width, left, right: left + width, top: y - 10, bottom: y + 3 };
};
const conservativeCallout = (svg: string, color: string) => {
  const match = svg.match(new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"(?: text-anchor="(start|end)")?[^>]*font-size="([\\d.]+)"[^>]*fill="${color}">([^<]*)</text>`));
  expect(match).not.toBeNull();
  const [, rawX, rawY, rawAnchor, rawFontSize, text] = match!;
  const x = Number(rawX), y = Number(rawY), anchor = (rawAnchor as 'start' | 'end' | undefined) ?? 'start';
  const fontSize = Number(rawFontSize);
  const width = text.length * fontSize;
  const left = anchor === 'end' ? x - width : x;
  return { x, y, anchor, text, fontSize, width, left, right: left + width, top: y - 10, bottom: y + 3 };
};
const intersects = (a: ReturnType<typeof labelOf>, b: ReturnType<typeof labelOf>) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
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

describe('renderTrafficChart label placement', () => {
  const series = (values: number[], start = '2026-10-26T08:00:00.000Z') =>
    values.map((traffic, i) => at(new Date(Date.parse(start) + i * 60 * 60 * 1000).toISOString(), traffic));

  it('places a top-left peak below the title band and inside the plot', () => {
    const svg = renderTrafficChart({ term: 'Claude Code', points: series([100, 30, 40, 50, 60, 70]) });
    const peak = labelOf(svg, 'peak');
    expect(peak.anchor).toBe('start');
    expect(peak.top).toBeGreaterThanOrEqual(CHART_TOP);
    expect(peak.y).toBeGreaterThan(CHART_TOP);
    expect(peak.y).toBeLessThanOrEqual(CHART_AXIS_Y - 4);
    expect(peak.left).toBeGreaterThanOrEqual(CHART_LEFT);
    expect(peak.right).toBeLessThanOrEqual(720 - CHART_RIGHT);
  });

  it('keeps a right-edge peak label inside the plot', () => {
    const svg = renderTrafficChart({ term: 'Claude Code', points: series([10, 20, 30, 40, 50, 100]) });
    const peak = labelOf(svg, 'peak');
    expect(peak.anchor).toBe('end');
    expect(peak.x).toBeLessThanOrEqual(720 - CHART_RIGHT);
    expect(peak.left).toBeGreaterThanOrEqual(CHART_LEFT);
    expect(peak.right).toBeLessThanOrEqual(720 - CHART_RIGHT);
    expect(peak.top).toBeGreaterThanOrEqual(CHART_TOP);
    expect(peak.y).toBeLessThanOrEqual(CHART_AXIS_Y - 4);
  });

  it('separates peak and latest labels when they share or nearly share a point', () => {
    const same = renderTrafficChart({ term: 'Claude Code', points: series([10, 20, 30, 40, 50, 100]) });
    expect(intersects(labelOf(same, 'peak'), labelOf(same, 'latest'))).toBe(false);

    const adjacent = renderTrafficChart({ term: 'Claude Code', points: series(Array.from({ length: 20 }, (_, i) => i === 18 ? 100 : i === 19 ? 99 : 10 + i)) });
    expect(intersects(labelOf(adjacent, 'peak'), labelOf(adjacent, 'latest'))).toBe(false);
  });

  it('keeps the usual above-peak and below-latest placement when there is room', () => {
    const points = series([10, 20, 80, 30, 20, 10]);
    const anchorPoints = points.map((p, i) => ({ ...p, traffic: i === 5 ? 100 : 0 }));
    const svg = renderTrafficChart({ term: 'Claude Code', points, anchorPoints });
    const peak = labelOf(svg, 'peak'), latest = labelOf(svg, 'latest');
    const peakPointY = CHART_TOP + 210 - (80 / 100) * 210;
    const latestPointY = CHART_TOP + 210 - (10 / 100) * 210;
    expect(peak.y).toBeCloseTo(peakPointY - 8);
    expect(latest.y).toBeCloseTo(latestPointY + 16);
    expect(peak.y).toBeLessThan(peakPointY);
    expect(latest.y).toBeGreaterThan(latestPointY);
  });

  it('fits both labels inside a narrow plot and drops the date when needed', () => {
    const svg = renderTrafficChart({ term: 'Claude Code', points: series([100]), width: 180, height: 110 });
    const peak = labelOf(svg, 'peak'), latest = labelOf(svg, 'latest');
    for (const label of [peak, latest]) {
      expect(label.text).not.toContain('·');
      expect(label.fontSize).toBeLessThanOrEqual(11);
      expect(label.left).toBeGreaterThanOrEqual(CHART_LEFT);
      expect(label.right).toBeLessThanOrEqual(180 - CHART_RIGHT);
      expect(label.top).toBeGreaterThanOrEqual(CHART_TOP);
      expect(label.bottom).toBeLessThanOrEqual(110 - 58);
    }
    expect(intersects(peak, latest)).toBe(false);
  });

  it('compacts long labels instead of overflowing the plot', () => {
    const svg = renderTrafficChart({ term: 'Claude Code', points: series([1_250_000]), width: 300, height: 110 });
    const peak = labelOf(svg, 'peak'), latest = labelOf(svg, 'latest');
    expect(peak.text).toContain('1.3M');
    expect(latest.text).toContain('1.3M');
    expect(peak.text).not.toContain('·');
    expect(latest.text).not.toContain('·');
    expect(peak.right).toBeLessThanOrEqual(300 - CHART_RIGHT);
    expect(latest.left).toBeGreaterThanOrEqual(CHART_LEFT);
    expect(Math.max(peak.bottom, latest.bottom)).toBeLessThanOrEqual(110 - 58);
    expect(intersects(peak, latest)).toBe(false);
  });

  it('places coincident labels side-by-side when vertical space is insufficient', () => {
    const svg = renderTrafficChart({ term: 'Claude Code', points: series([100]), height: 110 });
    const peak = labelOf(svg, 'peak'), latest = labelOf(svg, 'latest');
    expect(peak.y).toBeCloseTo(latest.y);
    expect(peak.top).toBeGreaterThanOrEqual(CHART_TOP);
    expect(Math.max(peak.bottom, latest.bottom)).toBeLessThanOrEqual(110 - 58);
    expect(intersects(peak, latest)).toBe(false);
  });

  it('budgets a full em for the ellipsis and keeps it inside the plot', () => {
    const svg = renderTrafficChart({ term: 'Claude Code', points: series([1_250_000]), width: 90, height: 110 });
    const peak = conservativeCallout(svg, '#dc2626');
    expect(peak.text).toBe('…');
    expect(peak.width).toBeLessThanOrEqual(90 - CHART_LEFT - CHART_RIGHT);
    expect(peak.left).toBeGreaterThanOrEqual(CHART_LEFT);
    expect(peak.right).toBeLessThanOrEqual(90 - CHART_RIGHT);
    expect(peak.top).toBeGreaterThanOrEqual(CHART_TOP);
    expect(peak.bottom).toBeLessThanOrEqual(110 - 58);
    expect(svg).not.toMatch(/fill="#059669">/);
  });

  it('omits callouts when even the ellipsis cannot fit', () => {
    const svg = renderTrafficChart({ term: 'Claude Code', points: series([100]), width: 85, height: 110 });
    expect(svg).not.toMatch(/fill="#dc2626">/);
    expect(svg).not.toMatch(/fill="#059669">/);
    expect(svg).toContain('Claude Code — searches/day (UTC)');
  });
});
