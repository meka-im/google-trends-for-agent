import { resolveTimeZone } from './timezone.js';

export interface TrafficChartPoint { t: string; traffic: number | null; gap?: boolean }
export interface TrafficChartOptions {
  term: string;
  points: readonly TrafficChartPoint[];
  anchorPoints?: readonly TrafficChartPoint[];
  width?: number;
  height?: number;
  /** IANA time zone for axis labels and callouts; defaults to GTFA_TZ, then UTC. */
  timeZone?: string;
}

interface ChartLabel {
  text: string;
  color: string;
  pointX: number;
  pointY: number;
  width: number;
  x: number;
  textAnchor: 'start' | 'end';
  textY: number;
  fontSize: number;
  cost: number;
}
interface LabelBox { left: number; right: number; top: number; bottom: number }

const WIDTH = 720, HEIGHT = 300, LEFT = 58, RIGHT = 20, TOP = 32, BOTTOM = 58;
const LABEL_FONT_SIZE = 11, LABEL_CHAR_WIDTH = LABEL_FONT_SIZE * 0.6, LABEL_ASCENT = 10, LABEL_DESCENT = 3, LABEL_GAP = 2;
const LABEL_FONT_SIZES = [LABEL_FONT_SIZE, 10, 9, 8, 7, 6] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_TARGET = 6;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(Math.round(n));
const pad2 = (n: number) => String(n).padStart(2, '0');

interface ZonedTime { year: number; month: number; day: number; hour: number; minute: number }
type TimeLabelMode = 'datetime' | 'date' | 'month';

// Chart times are displayed in the configured IANA time zone (default UTC). We read the
// zone-local calendar fields via Intl.DateTimeFormat so DST transitions are handled.
function zonedParts(t: string, format: Intl.DateTimeFormat): ZonedTime | null {
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const fields = Object.fromEntries(format.formatToParts(d).map(p => [p.type, p.value]));
  const year = Number(fields.year), month = Number(fields.month), day = Number(fields.day), hour = Number(fields.hour), minute = Number(fields.minute);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return { year, month, day, hour, minute };
}
function labelMode(first: ZonedTime, last: ZonedTime): TimeLabelMode {
  const stamp = (p: ZonedTime) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const span = Math.abs(stamp(last) - stamp(first));
  if (span <= 36 * 60 * 60 * 1000) return 'datetime';
  if (span <= 120 * DAY_MS) return 'date';
  return 'month';
}
function formatTick(p: ZonedTime, previous: ZonedTime | undefined, mode: TimeLabelMode) {
  if (mode === 'month') return `${p.year}-${pad2(p.month)}`;
  if (mode === 'date') return `${p.month}/${p.day}`;
  const sameDay = previous && previous.year === p.year && previous.month === p.month && previous.day === p.day;
  return sameDay ? `${pad2(p.hour)}:${pad2(p.minute)}` : `${p.month}/${p.day} ${pad2(p.hour)}:${pad2(p.minute)}`;
}
function formatCallout(p: ZonedTime, mode: TimeLabelMode) {
  const date = mode === 'month' ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : `${p.month}/${p.day}`;
  return `${date} ${pad2(p.hour)}:${pad2(p.minute)}`;
}
function tickIndices(n: number): number[] {
  const count = Math.min(TICK_TARGET, Math.max(n, 1));
  if (count <= 1) return [0];
  return [...new Set(Array.from({ length: count }, (_, k) => Math.round(k * (n - 1) / (count - 1))))];
}

/** Inline SVG line chart (traffic over time). Gap points are omitted and the line breaks
 * across them; the anchor curve is dashed. X-axis times and callouts use the configured
 * IANA time zone (default UTC, override with timeZone or GTFA_TZ). Pure and deterministic
 * for tests. */
export function renderTrafficChart(opts: TrafficChartOptions): string {
  const width = opts.width ?? WIDTH, height = opts.height ?? HEIGHT;
  const timeZone = resolveTimeZone(opts.timeZone);
  const timeFormat = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
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
  const firstParts = carrier.length ? zonedParts(carrier[0].t, timeFormat) : null;
  const lastParts = carrier.length ? zonedParts(carrier[carrier.length - 1].t, timeFormat) : null;
  const mode: TimeLabelMode = firstParts && lastParts ? labelMode(firstParts, lastParts) : 'datetime';
  const grid = [0, .25, .5, .75, 1].map(f => {
    const gy = TOP + plotH * (1 - f), value = yMax * f;
    return `<line x1="${LEFT}" y1="${gy.toFixed(1)}" x2="${width - RIGHT}" y2="${gy.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>` +
      `<text x="${LEFT - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" fill="#6b7280">${esc(fmt(value))}</text>`;
  }).join('');
  let previousTick: ZonedTime | undefined;
  const xTicks = tickIndices(n).map((i, order, all) => {
    const parts = zonedParts((points[i] ?? anchor[i])?.t ?? '', timeFormat);
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
  const plotLeft = LEFT, plotRight = width - RIGHT, minLabelY = TOP + LABEL_ASCENT, maxLabelY = axisY - 4;
  const clampLabelY = (v: number) => Math.min(maxLabelY, Math.max(minLabelY, v));
  const labelBox = (label: ChartLabel): LabelBox => {
    const left = label.textAnchor === 'end' ? label.x - label.width : label.x;
    return { left, right: left + label.width, top: label.textY - LABEL_ASCENT, bottom: label.textY + LABEL_DESCENT };
  };
  const overlaps = (a: LabelBox, b: LabelBox) =>
    a.left < b.right + LABEL_GAP && b.left < a.right + LABEL_GAP &&
    a.top < b.bottom + LABEL_GAP && b.top < a.bottom + LABEL_GAP;
  const labelX = (pointX: number, labelWidth: number): { x: number; textAnchor: 'start' | 'end' } => {
    const rightStart = pointX + 7;
    if (rightStart + labelWidth <= plotRight) return { x: rightStart, textAnchor: 'start' };
    const leftEnd = pointX - 7;
    if (leftEnd - labelWidth >= plotLeft) return { x: leftEnd, textAnchor: 'end' };
    return pointX <= plotLeft + plotW / 2 ? { x: plotLeft, textAnchor: 'start' } : { x: plotRight, textAnchor: 'end' };
  };
  const labelXVariants = (pointX: number, labelWidth: number): { x: number; textAnchor: 'start' | 'end' }[] => {
    const out: { x: number; textAnchor: 'start' | 'end' }[] = [];
    const add = (x: number, textAnchor: 'start' | 'end') => {
      if (!out.some(v => v.x === x && v.textAnchor === textAnchor)) out.push({ x, textAnchor });
    };
    const preferred = labelX(pointX, labelWidth);
    add(preferred.x, preferred.textAnchor);
    add(Math.min(plotRight - labelWidth, Math.max(plotLeft, pointX + 7)), 'start');
    add(Math.min(plotRight, Math.max(plotLeft + labelWidth, pointX - 7)), 'end');
    return out;
  };
  const labelYCandidates = (pointY: number, prefer: 'above' | 'below'): number[] => {
    if (maxLabelY < minLabelY) return [];
    const offsets = prefer === 'above'
      ? [-8, 16, -24, 32, -40, 48, -56, 64, -72, 80]
      : [16, -8, 32, -24, 48, -40, 64, -56, 80, -72];
    const valid = offsets.map(o => pointY + o).filter(v => v >= minLabelY && v <= maxLabelY);
    const clamped = offsets.map(o => clampLabelY(pointY + o));
    const out: number[] = [];
    for (const v of [...valid, ...clamped, minLabelY, maxLabelY]) {
      const rounded = Math.round(v * 10) / 10;
      if (!out.includes(rounded)) out.push(rounded);
    }
    return out;
  };
  const labelVariants = (p: typeof peak, prefix: string): { text: string; fontSize: number }[] => {
    if (!p) return [];
    const value = fmt(p.traffic), parts = zonedParts(p.t, timeFormat);
    const full = `${prefix} ${value}${parts ? ` · ${formatCallout(parts, mode)}` : ''}`;
    const compact = `${prefix} ${value}`;
    const out: { text: string; fontSize: number }[] = [];
    const add = (text: string, fontSize: number) => {
      if (text.length * fontSize * 0.6 <= plotW && !out.some(v => v.text === text && v.fontSize === fontSize)) out.push({ text, fontSize });
    };
    add(full, LABEL_FONT_SIZE);
    for (const fontSize of LABEL_FONT_SIZES) add(compact, fontSize);
    for (const fontSize of LABEL_FONT_SIZES) add(value, fontSize);
    if (!out.length) {
      const maxChars = Math.floor(plotW / LABEL_CHAR_WIDTH);
      if (maxChars > 0) add(maxChars > 1 ? `${value.slice(0, maxChars - 1)}…` : '…', LABEL_FONT_SIZE);
    }
    return out;
  };
  const makeLabels = (p: typeof peak, color: string, prefix: string, prefer: 'above' | 'below'): ChartLabel[] => {
    if (!p) return [];
    const pointX = x(p.i), pointY = y(p.traffic), yCandidates = labelYCandidates(pointY, prefer);
    const out: ChartLabel[] = [];
    labelVariants(p, prefix).forEach((variant, variantIndex) => {
      const labelWidth = variant.text.length * variant.fontSize * 0.6;
      labelXVariants(pointX, labelWidth).forEach((placement, xIndex) => {
        yCandidates.forEach((textY, yIndex) => {
          out.push({
            text: variant.text, color, pointX, pointY, width: labelWidth,
            x: placement.x, textAnchor: placement.textAnchor, textY, fontSize: variant.fontSize,
            cost: variantIndex * 1000 + xIndex * 10 + yIndex,
          });
        });
      });
    });
    return out;
  };
  const chooseLabels = (a: ChartLabel[], b: ChartLabel[]): { peak?: ChartLabel; latest?: ChartLabel } => {
    let best: { peak: ChartLabel; latest: ChartLabel; cost: number } | undefined;
    for (const peakLabel of a) {
      for (const latestLabel of b) {
        if (overlaps(labelBox(peakLabel), labelBox(latestLabel))) continue;
        const cost = peakLabel.cost + latestLabel.cost;
        if (!best || cost < best.cost) best = { peak: peakLabel, latest: latestLabel, cost };
      }
    }
    if (best) return { peak: best.peak, latest: best.latest };
    return { peak: a[0], latest: undefined };
  };
  const peakLabels = makeLabels(peak, '#dc2626', 'peak', 'above');
  const latestLabels = makeLabels(latest, '#059669', 'latest', 'below');
  const chosen = chooseLabels(peakLabels, latestLabels);
  const mark = (label: ChartLabel | undefined) => {
    if (!label) return '';
    return `<circle cx="${label.pointX.toFixed(1)}" cy="${label.pointY.toFixed(1)}" r="4" fill="${label.color}"/>` +
      `<text x="${label.x.toFixed(1)}" y="${label.textY.toFixed(1)}"${label.textAnchor === 'end' ? ' text-anchor="end"' : ''} font-family="system-ui,sans-serif" font-size="${label.fontSize}" fill="${label.color}">${esc(label.text)}</text>`;
  };
  const empty = !values.length ? `<text x="${width / 2}" y="${TOP + plotH / 2}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#6b7280">No calibrated traffic</text>` : '';
  const legend = `<g font-family="system-ui,sans-serif" font-size="11" fill="#374151">` +
    `<line x1="${LEFT}" y1="${height - 16}" x2="${LEFT + 24}" y2="${height - 16}" stroke="#2563eb" stroke-width="2"/><text x="${LEFT + 30}" y="${height - 9}">${esc(opts.term)}</text>` +
    (anchor.length ? `<line x1="${LEFT + 170}" y1="${height - 16}" x2="${LEFT + 194}" y2="${height - 16}" stroke="#9ca3af" stroke-width="2" stroke-dasharray="6 5"/><text x="${LEFT + 200}" y="${height - 9}">anchor</text>` : '') +
    `</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.term)} traffic chart (${esc(timeZone)})">` +
    `<title>${esc(opts.term)} searches/day (${esc(timeZone)})</title>` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="${LEFT}" y="20" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#111827">${esc(opts.term)} — searches/day (${esc(timeZone)})</text>` +
    grid + xTicks +
    `<line x1="${LEFT}" y1="${TOP}" x2="${LEFT}" y2="${axisY}" stroke="#d1d5db" stroke-width="1"/>` +
    `<line x1="${LEFT}" y1="${axisY}" x2="${width - RIGHT}" y2="${axisY}" stroke="#d1d5db" stroke-width="1"/>` +
    line(anchorSegments, '#9ca3af', true, 'anchor-line') + line(termSegments, '#2563eb', false, 'term-line') +
    mark(chosen.peak) + mark(chosen.latest) +
    empty + legend + `</svg>`;
}
