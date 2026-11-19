import type { VolumeBandPoint } from '../volume-types.js';

interface ChartSeries {
  term: string;
  color: string;
  points: { t: string; value: number | null }[];
  range?: { points: VolumeBandPoint[] };
}
interface LineSample { stamp: number; value: number }
interface BandSample { stamp: number; low: number; high: number }
const validStamp = (value: string) => Number.isFinite(Date.parse(value));
const validBand = (point: VolumeBandPoint): point is VolumeBandPoint & { low: number; high: number } =>
  validStamp(point.t) && point.low !== null && point.high !== null && point.low <= point.high;
export const hasChartPoints = (series: Pick<ChartSeries, 'points' | 'range'>) =>
  series.points.some(point => point.value !== null && validStamp(point.t)) || Boolean(series.range?.points.some(validBand));

function segments<T>(points: (T | null)[]): T[][] {
  const lines: T[][] = [];
  let line: T[] = [];
  for (const point of points) {
    if (point === null) {
      if (line.length) lines.push(line);
      line = [];
    } else {
      line.push(point);
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

const tickText = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

export function TrendChart({ series, traffic, label, empty, logLabel }: {
  series: ChartSeries[]; traffic: boolean; label: string; empty: string; logLabel: string;
}) {
  const curves = series.map(row => ({
    ...row,
    lines: segments<LineSample>(row.points.map(point => point.value !== null && validStamp(point.t)
      ? { stamp: Date.parse(point.t), value: point.value } : null)),
    bands: segments<BandSample>((row.range?.points ?? []).map(point => validBand(point)
      ? { stamp: Date.parse(point.t), low: point.low, high: point.high } : null)),
  }));
  const lines = curves.flatMap(row => row.lines.flat());
  const bands = curves.flatMap(row => row.bands.flat());
  const values = [...lines.map(point => point.value), ...bands.flatMap(point => [point.low, point.high])];
  if (!values.length) return <div className="gd-empty"><p>{empty}</p></div>;

  const timestamps = [...lines, ...bands].map(point => point.stamp);
  const start = Math.min(...timestamps), end = Math.max(...timestamps);
  const min = Math.min(...values), max = Math.max(...values);
  const logarithmic = traffic && min > 0 && max / min >= 100;
  const minPower = logarithmic ? Math.floor(Math.log10(min)) : 0;
  const maxPower = logarithmic ? Math.ceil(Math.log10(max)) : 0;
  const powerStep = Math.max(1, Math.ceil((maxPower - minPower) / 5));
  const ceiling = traffic ? Math.max(1, max) * 1.1 : 100;
  const ticks = logarithmic
    ? Array.from({ length: Math.floor((maxPower - minPower) / powerStep) + 1 }, (_, index) => 10 ** (minPower + index * powerStep))
    : [0, .25, .5, .75, 1].map(fraction => ceiling * fraction);
  const x = (stamp: number) => 50 + (stamp - start) / (end - start || 1) * 585;
  const y = (value: number) => 205 - 180 * (logarithmic ? (Math.log10(value) - minPower) / (maxPower - minPower) : value / ceiling);
  const position = (stamp: number, value: number) => `${x(stamp).toFixed(2)},${y(value).toFixed(2)}`;
  const xTicks = end === start ? [0] : [0, .25, .5, .75, 1];
  const days = (end - start) / 86400000;
  const dateText = (stamp: number) => days < 2 ? new Date(stamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : new Date(stamp).toLocaleDateString(undefined, days > 366 ? { year: 'numeric', month: 'short' } : { month: 'short', day: 'numeric' });

  return <svg className="gd-trend-chart" viewBox="0 0 670 250" role="img" aria-label={logarithmic ? label + ' · ' + logLabel : label}>
    {logarithmic ? <text x="50" y="12">{logLabel}</text> : null}
    {ticks.map(value => <g key={value}>
      <line x1="50" x2="635" y1={y(value)} y2={y(value)} stroke="var(--gtfa-line)" />
      <text x="40" y={y(value) + 3} textAnchor="end">{tickText.format(value)}</text>
    </g>)}
    {curves.map(row => <g key={row.term}>
      {row.bands.map((band, index) => {
        const upper = band.map(point => position(point.stamp, point.high));
        const lower = [...band].reverse().map(point => position(point.stamp, point.low));
        const coordinates = [...upper, ...lower];
        return <path key={index} d={'M' + coordinates.join(' L') + ' Z'}
          fill={row.color} fillOpacity=".21" stroke={row.color} strokeWidth="1.2" strokeLinejoin="round" />;
      })}
      {row.lines.map((line, index) => line.length === 1
        ? <circle key={index} cx={x(line[0]!.stamp)} cy={y(line[0]!.value)} r="2.5" fill={row.color} />
        : <path key={index} d={'M' + line.map(point => position(point.stamp, point.value)).join(' L')}
          fill="none" stroke={row.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}
    </g>)}
    {xTicks.map(fraction => <text key={fraction} x={50 + 585 * fraction} y="235"
      textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}>{dateText(start + fraction * (end - start))}</text>)}
  </svg>;
}
