export interface TrafficChartPoint { t: string; traffic: number | null; gap?: boolean }
export interface TrafficChartOptions {
  term: string;
  points: readonly TrafficChartPoint[];
  anchorPoints?: readonly TrafficChartPoint[];
  width?: number;
  height?: number;
}

const WIDTH = 720, HEIGHT = 300, LEFT = 58, RIGHT = 20, TOP = 32, BOTTOM = 58;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_TARGET = 6;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(Math.round(n));
const pad2 = (n: number) => String(n).padStart(2, '0');

interface ShanghaiTime { year: number; month: number; day: number; hour: number; minute: number }
type TimeLabelMode = 'datetime' | 'date' | 'month';

// Chart times are displayed in Asia/Shanghai (UTC+8). We apply the fixed offset to the
// ISO timestamp and read UTC fields so labels are deterministic in every host timezone.
function shanghaiParts(t: string): ShanghaiTime | null {
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + SHANGHAI_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}
function labelMode(first: ShanghaiTime, last: ShanghaiTime): TimeLabelMode {
  const stamp = (p: ShanghaiTime) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const span = Math.abs(stamp(last) - stamp(first));
  if (span <= 36 * 60 * 60 * 1000) return 'datetime';
  if (span <= 120 * DAY_MS) return 'date';
  return 'month';
}
function formatTick(p: ShanghaiTime, previous: ShanghaiTime | undefined, mode: TimeLabelMode) {
  if (mode === 'month') return `${p.year}-${pad2(p.month)}`;
  if (mode === 'date') return `${p.month}/${p.day}`;
  const sameDay = previous && previous.year === p.year && previous.month === p.month && previous.day === p.day;
  return sameDay ? `${pad2(p.hour)}:${pad2(p.minute)}` : `${p.month}/${p.day} ${pad2(p.hour)}:${pad2(p.minute)}`;
}
function formatCallout(p: ShanghaiTime, mode: TimeLabelMode) {
  const date = mode === 'month' ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : `${p.month}/${p.day}`;
  return `${date} ${pad2(p.hour)}:${pad2(p.minute)}`;
}
function tickIndices(n: number): number[] {
  const count = Math.min(TICK_TARGET, Math.max(n, 1));
  if (count <= 1) return [0];
  return [...new Set(Array.from({ length: count }, (_, k) => Math.round(k * (n - 1) / (count - 1))))];
}

/** Inline SVG line chart (traffic over time). Gap points are omitted and the line breaks
 * across them; the anchor curve is dashed. X-axis times and callouts use Asia/Shanghai.
 * Pure and deterministic for tests. */
export function renderTrafficChart(opts: TrafficChartOptions): string {
  const width = opts.width ?? WIDTH, height = opts.height ?? HEIGHT;
  const points = opts.points, anchor = opts.anchorPoints ?? [];
  const values = [...points, ...anchor].filter(p => !p.gap && p.traffic !== null).map(p => p.traffic as number);
  const yMax = Math.max(1, ...values);
  const n = Math.max(points.length, anchor.length, 1);
  const plotW = width - LEFT - RIGHT, plotH = height - TOP - BOTTOM, axisY = height - BOTTOM;
  const x = (i: number) => LEFT + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => TOP + plotH - (Math.max(0, v) / yMax) * plotH;
  const segments = (rows: readonly TrafficChartPoint[]) => {
    const out: string[] = []; let current: string[] = [];
    const flush = () => { if (current.length > 1) out.push(current.join(' ')); current = []; };
    rows.forEach((p, i) => {
      if (p.gap || p.traffic === null) { flush(); return; }
      current.push(`${x(i).toFixed(1)},${y(p.traffic).toFixed(1)}`);
    });
    flush();
    return out;
  };
  const termSegments = segments(points);
  const anchorSegments = segments(anchor);
  const carrier = points.length ? points : anchor;
  const firstParts = carrier.length ? shanghaiParts(carrier[0].t) : null;
  const lastParts = carrier.length ? shanghaiParts(carrier[carrier.length - 1].t) : null;
  const mode: TimeLabelMode = firstParts && lastParts ? labelMode(firstParts, lastParts) : 'datetime';
  const grid = [0, .25, .5, .75, 1].map(f => {
    const gy = TOP + plotH * (1 - f), value = yMax * f;
    return `<line x1="${LEFT}" y1="${gy.toFixed(1)}" x2="${width - RIGHT}" y2="${gy.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>` +
      `<text x="${LEFT - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" fill="#6b7280">${esc(fmt(value))}</text>`;
  }).join('');
  let previousTick: ShanghaiTime | undefined;
  const xTicks = tickIndices(n).map((i, order, all) => {
    const parts = shanghaiParts((points[i] ?? anchor[i])?.t ?? '');
    if (!parts) return '';
    const label = formatTick(parts, previousTick, mode);
    previousTick = parts;
    const textX = order === 0 ? LEFT : order === all.length - 1 ? width - RIGHT : x(i);
    const textAnchor = order === 0 ? 'start' : order === all.length - 1 ? 'end' : 'middle';
    return `<line x1="${x(i).toFixed(1)}" y1="${axisY}" x2="${x(i).toFixed(1)}" y2="${axisY + 4}" stroke="#d1d5db" stroke-width="1"/>` +
      `<text class="x-tick" x="${textX.toFixed(1)}" y="${axisY + 17}" text-anchor="${textAnchor}" font-family="system-ui,sans-serif" font-size="11" fill="#6b7280">${esc(label)}</text>`;
  }).join('');
  const line = (segs: string[], color: string, dash = false, cls = '') => segs.map(s =>
    `<polyline${cls ? ` class="${cls}"` : ''} points="${s}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash ? ' stroke-dasharray="6 5"' : ''}/>`).join('');
  const visible = points.map((p, i) => ({ ...p, i })).filter(p => !p.gap && p.traffic !== null) as { i: number; t: string; traffic: number }[];
  const peak = visible.reduce<{ i: number; t: string; traffic: number } | undefined>((best, p) => !best || p.traffic > best.traffic ? p : best, undefined);
  const latest = visible.at(-1);
  // When peak and latest are the same point, keep their labels on opposite sides of the marker.
  const latestOffsetY = peak && latest && peak.i === latest.i && y(latest.traffic) + 16 > axisY - 4 ? -24 : 16;
  const mark = (p: typeof peak, color: string, offsetY: number, prefix: string) => {
    if (!p) return '';
    const parts = shanghaiParts(p.t);
    const text = `${prefix} ${fmt(p.traffic)}${parts ? ` · ${formatCallout(parts, mode)}` : ''}`;
    const pointX = x(p.i), estimatedTextWidth = text.length * 6.2, placeLeft = pointX + 7 + estimatedTextWidth > width - RIGHT;
    const textX = placeLeft ? pointX - 7 : pointX + 7;
    const textY = Math.min(axisY - 4, y(p.traffic) + offsetY);
    return `<circle cx="${pointX.toFixed(1)}" cy="${y(p.traffic).toFixed(1)}" r="4" fill="${color}"/>` +
      `<text x="${textX.toFixed(1)}" y="${textY.toFixed(1)}"${placeLeft ? ' text-anchor="end"' : ''} font-family="system-ui,sans-serif" font-size="11" fill="${color}">${esc(text)}</text>`;
  };
  const empty = !values.length ? `<text x="${width / 2}" y="${TOP + plotH / 2}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#6b7280">No calibrated traffic</text>` : '';
  const legend = `<g font-family="system-ui,sans-serif" font-size="11" fill="#374151">` +
    `<line x1="${LEFT}" y1="${height - 16}" x2="${LEFT + 24}" y2="${height - 16}" stroke="#2563eb" stroke-width="2"/><text x="${LEFT + 30}" y="${height - 9}">${esc(opts.term)}</text>` +
    (anchor.length ? `<line x1="${LEFT + 170}" y1="${height - 16}" x2="${LEFT + 194}" y2="${height - 16}" stroke="#9ca3af" stroke-width="2" stroke-dasharray="6 5"/><text x="${LEFT + 200}" y="${height - 9}">anchor</text>` : '') +
    `</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.term)} traffic chart (Asia/Shanghai)">` +
    `<title>${esc(opts.term)} searches/day (Asia/Shanghai)</title>` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="${LEFT}" y="20" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#111827">${esc(opts.term)} — searches/day (Asia/Shanghai)</text>` +
    grid + xTicks +
    `<line x1="${LEFT}" y1="${TOP}" x2="${LEFT}" y2="${axisY}" stroke="#d1d5db" stroke-width="1"/>` +
    `<line x1="${LEFT}" y1="${axisY}" x2="${width - RIGHT}" y2="${axisY}" stroke="#d1d5db" stroke-width="1"/>` +
    line(anchorSegments, '#9ca3af', true, 'anchor-line') + line(termSegments, '#2563eb', false, 'term-line') +
    mark(peak, '#dc2626', -8, 'peak') + mark(latest, '#059669', latestOffsetY, 'latest') +
    empty + legend + `</svg>`;
}
