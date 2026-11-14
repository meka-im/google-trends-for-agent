import { parseArgs } from 'node:util';
import { resolveFilter } from './filter.js';
import { SnapshotStore } from './snapshot.js';
import { fetchTrafficSnapshot, trafficSnapshotEnvelope, trafficSnapshotError } from './trends-snapshot.js';
import { queryTrends } from './api.js';
import { loadBaselinesFromEnv, type Baselines } from './traffic.js';
import { resolveTimeZone } from './timezone.js';
import { DEFAULT_EXPLORE_TIMEOUT_MS } from './client.js';

export const snapshotHelp = `Usage: gtfa snapshot <term> [options]
  One term + a shared-scale anchor comparison -> calibrated searches/day estimate,
  traffic series, related queries, verdict, and chart file paths for the requested
  window plus an always-on now 7-d curve (chart7d / traffic7d); --svg embeds SVG text.
  --geo US --time "now 1-d"          Explore filter (all categories, web)
  --anchor TERM                     Anchor override; default auto: sudoku for 1h/4h/1d, gpts for 7d+
  --fresh                           Force live data
  --max-age MIN                     Reuse saved snapshots younger than MIN minutes (default 360)
  --timeout MS                      Per-request timeout (integer 1000-60000; Explore default ${DEFAULT_EXPLORE_TIMEOUT_MS})
  --store DIR                       Snapshot storage (default .gtfa/snapshots)
  --chart-dir DIR                   SVG output directory (default .gtfa/charts)
  --tz <IANA>                       Chart time zone (default GTFA_TZ, then UTC)
  --svg                             Embed inline SVG text (default: svg is "", path is kept)
  --json                            Agent envelope JSON (same as trends_snapshot)
  --pretty                          Indent JSON
  Environment: GTFA_BASELINES=/path/baselines.json overrides anchor baselines
  --help`;

function timeoutValue(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1000 || value > 60000) {
    throw new Error('timeout must be an integer between 1000 and 60000');
  }
  return value;
}

function withTimeout(query: typeof queryTrends, timeoutMs: number | undefined): typeof queryTrends {
  if (timeoutMs === undefined) return query;
  return (input, options) => {
    const body = input && typeof input === 'object' && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>), timeoutMs }
      : input;
    return query(body, options);
  };
}

/** `snapshot` command: calibrated traffic estimate, chart, and related queries. */
export async function runSnapshotCli(args: string[], options: { query?: typeof queryTrends; baselines?: Baselines; chartDir?: string | null } = {}) {
  let json = false, pretty = false;
  try {
    const { values: v, positionals } = parseArgs({ args, allowPositionals: true, options: {
      geo: { type: 'string' }, time: { type: 'string' }, anchor: { type: 'string' }, 'max-age': { type: 'string' },
      store: { type: 'string' }, 'chart-dir': { type: 'string' }, tz: { type: 'string' }, json: { type: 'boolean' }, pretty: { type: 'boolean' }, svg: { type: 'boolean' },
      fresh: { type: 'boolean' }, timeout: { type: 'string' }, help: { type: 'boolean' },
    } });
    json = v.json ?? false; pretty = v.pretty ?? false;
    if (v.help) return { code: 0, stdout: process.stdout.isTTY && !v.json ? snapshotHelp : JSON.stringify({ help: snapshotHelp }), stderr: '' };
    const timeoutMs = timeoutValue(v.timeout);
    const query = withTimeout(options.query ?? queryTrends, timeoutMs);
    const term = positionals.join(' ').trim();
    if (!term) throw new Error('provide a term');
    const maxAgeMin = v['max-age'];
    const filter = resolveFilter({ geo: v.geo, time: v.time, category: 0, property: '' });
    const timeZone = resolveTimeZone(v.tz);
    const store = new SnapshotStore(v.store);
    const maxAge = maxAgeMin === undefined ? 360 : Number(maxAgeMin);
    if (!Number.isFinite(maxAge) || maxAge < 0) throw new Error('invalid max-age');
    const baselines = options.baselines ?? await loadBaselinesFromEnv();
    const result = await fetchTrafficSnapshot(term, {
      filter, store, anchor: v.anchor, baselines, maxAgeMin: maxAge, query, timeZone,
      refresh: v.fresh ? 'always' : undefined,
    });
    const chartDir = v['chart-dir'] ?? options.chartDir;
    const envelope = await trafficSnapshotEnvelope(result.snapshot, {
      cached: result.source === 'cache', ageMin: result.ageMin, baselines,
      week: result.week, timeZone, ...(result.weekError ? { weekError: result.weekError } : {}), ...(v.anchor ? { weekAnchor: v.anchor } : {}),
      ...(chartDir !== undefined ? { chartDir } : {}), svg: v.svg === true,
    });
    const code = !envelope.ok
      ? (['BLOCKED', 'RATE_LIMITED'].includes(envelope.error?.code ?? '') ? 3 : envelope.error?.code === 'INVALID_INPUT' ? 4 : 1)
      : envelope.status === 'partial' ? 2 : 0;
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
      `anchor7d: ${envelope.anchor7d.term} = ${envelope.anchor7d.dailySearches ?? 'n/a'} searches/day (level ${envelope.anchor7d.level ?? 'n/a'}, ${envelope.anchor7d.ratio ?? 'n/a'}×)`,
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
