import { parseArgs } from 'node:util';
import { resolveFilter } from './filter.js';
import { SnapshotStore } from './snapshot.js';
import { fetchTrafficSnapshot, trafficSnapshotEnvelope, trafficSnapshotError } from './trends-snapshot.js';
import type { queryTrends } from './api.js';
import type { Baselines } from './traffic.js';
import { resolveTimeZone } from './timezone.js';

export const snapshotHelp = `Usage: google-trends-for-agent snapshot <term> [options]
  One term + a shared-scale anchor comparison -> calibrated searches/day estimate,
  traffic series, related queries, verdict, and chart file paths for the requested
  window plus an always-on now 7-d curve (chart7d / traffic7d); --svg embeds SVG text.
  --geo US --time "now 1-d"          Explore filter (all categories, web)
  --anchor gpts                     Anchor term (default gpts)
  --fresh                           Force live data (alias --no-cache)
  --max-age MIN                     Reuse saved snapshots younger than MIN minutes (default 360)
  --store DIR                       Snapshot storage (default .gtfa/snapshots)
  --chart-dir DIR                   SVG output directory (default .gtfa/charts)
  --tz <IANA>                       Chart time zone (default GTFA_TZ, then UTC)
  --svg                             Embed inline SVG text (default: svg is "", path is kept)
  --json                            Agent envelope JSON (same as trends_snapshot)
  --pretty                          Indent JSON
  --help`;

/** `snapshot` command: calibrated traffic estimate, chart, and related queries. */
export async function runSnapshotCli(args: string[], options: { query?: typeof queryTrends; baselines?: Baselines; chartDir?: string | null } = {}) {
  let json = false, pretty = false;
  try {
    const { values: v, positionals } = parseArgs({ args, allowPositionals: true, options: {
      geo: { type: 'string' }, time: { type: 'string' }, anchor: { type: 'string' }, maxAge: { type: 'string' }, 'max-age': { type: 'string' },
      store: { type: 'string' }, 'chart-dir': { type: 'string' }, tz: { type: 'string' }, json: { type: 'boolean' }, pretty: { type: 'boolean' }, svg: { type: 'boolean' },
      fresh: { type: 'boolean' }, 'no-cache': { type: 'boolean' }, help: { type: 'boolean' },
    } });
    json = v.json ?? false; pretty = v.pretty ?? false;
    if (v.help) return { code: 0, stdout: process.stdout.isTTY && !v.json ? snapshotHelp : JSON.stringify({ help: snapshotHelp }), stderr: '' };
    const term = positionals.join(' ').trim();
    if (!term) throw new Error('provide a term');
    const maxAgeMin = v['max-age'] ?? v.maxAge;
    const filter = resolveFilter({ geo: v.geo, time: v.time, category: 0, property: '' });
    const timeZone = resolveTimeZone(v.tz);
    const store = new SnapshotStore(v.store);
    const maxAge = maxAgeMin === undefined ? 360 : Number(maxAgeMin);
    if (!Number.isFinite(maxAge) || maxAge < 0) throw new Error('invalid max-age');
    const result = await fetchTrafficSnapshot(term, {
      filter, store, anchor: v.anchor, maxAgeMin: maxAge, query: options.query, timeZone,
      refresh: v.fresh || v['no-cache'] ? 'always' : undefined,
    });
    const chartDir = v['chart-dir'] ?? options.chartDir;
    const envelope = await trafficSnapshotEnvelope(result.snapshot, {
      cached: result.source === 'cache', ageMin: result.ageMin, baselines: options.baselines,
      week: result.week, timeZone, ...(result.weekError ? { weekError: result.weekError } : {}),
      ...(chartDir !== undefined ? { chartDir } : {}), svg: v.svg === true,
    });
    const code = !envelope.ok ? (['BLOCKED', 'RATE_LIMITED'].includes(envelope.error?.code ?? '') ? 3 : envelope.error?.code === 'INVALID_INPUT' ? 4 : 1) : 0;
    const stderr = !envelope.ok ? `${envelope.error?.code ?? 'ERROR'}: ${envelope.error?.message ?? envelope.status}` : '';
    if (json) return { code, stdout: JSON.stringify(envelope, null, pretty ? 2 : undefined), stderr };
    if (!envelope.ok) return { code, stdout: JSON.stringify(envelope, null, pretty ? 2 : undefined), stderr };
    const weekTraffic = envelope.traffic7d, weekChart = envelope.chart7d;
    const lines = [
      envelope.summary,
      `filter: ${envelope.filter.geo} · ${envelope.filter.time} · ${envelope.filter.property} · category ${envelope.filter.category}`,
      `anchor: ${envelope.anchor.term} = ${envelope.anchor.dailySearches ?? 'n/a'} searches/day (level ${envelope.anchor.level ?? 'n/a'}, ${envelope.anchor.ratio ?? 'n/a'}×)`,
      `traffic: avg ${envelope.traffic.average ?? 'n/a'} / latest ${envelope.traffic.latest ?? 'n/a'} / settled ${envelope.traffic.settledLatest ?? 'n/a'} / peak ${envelope.traffic.peak ?? 'n/a'} / low-high ${envelope.traffic.low ?? 'n/a'}-${envelope.traffic.high ?? 'n/a'}`,
      `verdict: ${envelope.verdict.label} (${envelope.verdict.confidence}) — ${envelope.verdict.reasons.join('; ')}`,
      `chart: ${envelope.chart.path ?? (envelope.chart.svg ? 'inline only' : 'unavailable')}`,
      `traffic7d: avg ${weekTraffic.average ?? 'n/a'} / latest ${weekTraffic.latest ?? 'n/a'} / settled ${weekTraffic.settledLatest ?? 'n/a'} / peak ${weekTraffic.peak ?? 'n/a'} / low-high ${weekTraffic.low ?? 'n/a'}-${weekTraffic.high ?? 'n/a'}`,
      `chart7d: ${weekChart.path ?? (weekChart.svg ? 'inline only' : 'unavailable')}`,
      ...envelope.tables.popular.slice(0, 5).map(r => `popular #${r.rank} ${r.query}: ${r.formattedValue}${r.estDaily === null ? '' : ` (~${r.estDaily}/day)`}`),
      ...envelope.tables.rising.slice(0, 5).map(r => `rising  #${r.rank} ${r.query}: ${r.formattedValue}${r.estDaily === null ? '' : ` (~${r.estDaily}/day)`}`),
    ];
    return { code, stdout: lines.join('\n'), stderr };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { code: 4, stdout: JSON.stringify(trafficSnapshotError('', message), null, pretty ? 2 : undefined), stderr: `INVALID_INPUT: ${message}` };
  }
}
