import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { validateTerms, parseLeadInput, type LeadInput } from './validate.js';
import { resolveFilter } from './filter.js';
import { SnapshotStore, askTerm, snapshotDiff, type TermSnapshot } from './snapshot.js';
import { queryTrends } from './api.js';
import { askEnvelope, blockedVerdict, verdictEnvelope, schemaRejectionEnvelope } from './tools.js';
import { loadBaselinesFromEnv, type Baselines } from './traffic.js';
import { fetchTrending } from './trending.js';

export const askHelp = `Usage: gtfa ask <term> [options]
  Returns interest, popular (Top) and rising related queries, and regions for one term.
  --validate          Add a calibrated verdict (spiking, rising, steady, flat, no_data, blocked)
  --from FILE|-       With --validate: read JSON from a file or stdin (-), e.g. ["sora",{"term":"nano banana"}]
                      Accepts a string, object (name/term/keyword, in that order), or mixed array;
                      wrappers: {leads|rows|keywords|table: [...]}. Optional metadata:
                      variants (string[]), source, url, firstSeen (strings); preserved, not queried.
                      All rows use CLI filters; per-row geo/time are ignored.
  --anchor TERM       Anchor override; default auto: sudoku for 1h/4h/1d, gpts for 7d+; --no-anchor to skip
  --trending          With --validate: also check Trending Now
  --diff              Fetch fresh and save, then diff vs the previous snapshot; implies JSON, overrides --refresh
  --points            Include the full interest series (omitted by default to keep agent context small)
  --fresh             Force live data; --refresh always|never|if-stale
  --max-age MIN       Reuse saved snapshots younger than MIN minutes (default 360)
  --timeout MS        Request timeout (integer 1000-60000; Explore default 8000)
  --geo US --time "now 1-d" --category N --property ""
  --store DIR         Snapshot storage (default .gtfa/snapshots)
  --json              Agent envelope JSON (ask/validate; --diff implies JSON; --validate without --json prints a table)
  Environment: GTFA_BASELINES=/path/baselines.json overrides anchor baselines`;

/** Map an ask/validation envelope to the documented CLI exit code. */
function envelopeExitCode(e: { ok?: boolean; status?: string; error?: { code?: string } }): number {
  const code = e.error?.code ?? '';
  if (code === 'BLOCKED' || code === 'RATE_LIMITED' || e.status === 'blocked') return 3;
  if (code === 'INVALID_INPUT' || code === 'INVALID_COMBINATION') return 4;
  if (e.status === 'partial') return 2;
  if (e.ok === false || e.status === 'error' || code) return 1;
  return 0;
}

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

/** `ask` command: snapshot reuse/fetch, optional verdict (--validate) and diff vs previous (--diff). */
export async function runAskCli(args: string[], options: { query?: typeof queryTrends; trendingFetch?: typeof fetchTrending; stdin?: string; baselines?: Baselines } = {}) {
  try {
    const { values: v, positionals } = parseArgs({ args, allowPositionals: true, options: {
      from: { type: 'string' }, geo: { type: 'string' }, time: { type: 'string' }, category: { type: 'string' }, property: { type: 'string' },
      anchor: { type: 'string' }, 'no-anchor': { type: 'boolean' }, trending: { type: 'boolean' }, 'max-age': { type: 'string' },
      store: { type: 'string' }, json: { type: 'boolean' }, refresh: { type: 'string' }, fresh: { type: 'boolean' },
      validate: { type: 'boolean' }, diff: { type: 'boolean' }, points: { type: 'boolean' }, timeout: { type: 'string' }, help: { type: 'boolean' },
    } });
    if (v.help) return { code: 0, stdout: process.stdout.isTTY && !v.json ? askHelp : JSON.stringify({ help: askHelp }), stderr: '' };
    const timeoutMs = timeoutValue(v.timeout);
    const query = withTimeout(options.query ?? queryTrends, timeoutMs);
    const trendingBase = options.trendingFetch ?? fetchTrending;
    const trendingFetch: typeof fetchTrending = timeoutMs === undefined
      ? trendingBase
      : (input, trendingOptions) => trendingBase(input, { ...trendingOptions, timeoutMs });
    if (v.refresh && !['always', 'never', 'if-stale'].includes(v.refresh)) throw new Error('invalid refresh');
    const filter = resolveFilter({ geo: v.geo, time: v.time, category: v.category === undefined ? undefined : Number(v.category), property: v.property });
    const store = new SnapshotStore(v.store), maxAgeMin = v['max-age'] === undefined ? 360 : Number(v['max-age']);
    if (!Number.isFinite(maxAgeMin) || maxAgeMin < 0) throw new Error('invalid max-age');
    const refresh = v.fresh || v.diff ? 'always' : v.refresh as 'always' | 'never' | 'if-stale' | undefined;
    const withDiff = async (snap: TermSnapshot) => snapshotDiff(snap, await store.history(snap.term, snap.filter));
    let stderr = '';
    if (v.validate) {
      const leads: (string | LeadInput)[] = positionals.length ? [positionals.join(' ')] : [];
      if (v.from) leads.push(...parseLeadInput(JSON.parse(v.from === '-' ? options.stdin ?? readFileSync(0, 'utf8') : await readFile(v.from, 'utf8'))));
      if (!leads.length) throw new Error('provide a term or --from');
      const baselines = options.baselines ?? await loadBaselinesFromEnv();
      const rows = await validateTerms(leads, { filter, store, maxAgeMin, query, anchor: v['no-anchor'] ? false : v.anchor, baselines, trending: v.trending, trendingFetch, refresh });
      if (rows.some(r => r.verdict === 'blocked')) stderr = 'Warning: BLOCKED/RATE_LIMITED; validation stopped. No volumes invented.';
      const histories = await Promise.all(rows.map(r => store.history(r.term, r.filter)));
      const out = await Promise.all(rows.map(async (r, i) => {
        const saved = histories[i].find(snapshot => snapshot.id === r.snapshotId);
        if (!saved) return r;
        const snap = { ...saved, term: r.term };
        const diff = snapshotDiff(snap, histories[i]);
        return { ...blockedVerdict(askEnvelope(snap, { cached: r.source === 'cache', ageMin: Math.max(0, (Date.now() - Date.parse(r.fetchedAt)) / 60000), verdict: verdictEnvelope(r), ...diff, includePoints: v.points, ...(r.anchor.warning ? { warnings: [r.anchor.warning] } : {}) })), input: r.input };
      }));
      const code = rows.some(r => r.verdict === 'blocked') ? 3 : out.reduce((max, e) => Math.max(max, envelopeExitCode(e as { ok?: boolean; status?: string; error?: { code?: string } })), 0);
      if (!v.json && !v.diff) return { code, stdout: ['term | verdict | conf | est/day | band | latest/peak | top popular | top rising | top region', ...rows.map(r => [r.term, r.verdict, r.confidence, r.anchor.traffic.average === null ? '无法估' : String(r.anchor.traffic.average), r.anchor.band ?? '-', String(r.interest.settledLatest) + (r.freshSpike ? ' ⚡' + r.freshSpike.ratio.toFixed(0) + '× recheck ~' + r.freshSpike.recheckAfterMin + 'm' : '') + '/' + r.interest.peak, r.popular[0]?.query ?? '-', r.rising[0]?.query ?? '-', r.regions[0]?.name ?? '-'].join(' | '))].join('\n'), stderr };
      return { code, stdout: JSON.stringify(!v.from && out.length === 1 ? out[0] : out), stderr };
    }
    if (v.from) throw new Error('--from requires --validate');
    const term = positionals.join(' '); if (!term) throw new Error('provide a term');
    const a = await askTerm(term, { filter, store, maxAgeMin, query, refresh });
    const diff = await withDiff(a.snapshot);
    const envelope = blockedVerdict(askEnvelope(a.snapshot, { cached: a.source === 'cache', ageMin: a.ageMin, ...diff, includePoints: v.points }));
    if (a.snapshot.status === 'blocked') stderr = 'Warning: BLOCKED/RATE_LIMITED';
    return { code: envelopeExitCode(envelope), stdout: JSON.stringify(envelope), stderr };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { code: 4, stdout: JSON.stringify(schemaRejectionEnvelope(message)), stderr: `INVALID_INPUT: ${message}` };
  }
}
