import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { validateTerms, parseNtrInput, type LeadInput } from './validate.js';
import { resolveFilter } from './filter.js';
import { SnapshotStore, askTerm, diffSnapshots } from './snapshot.js';
import type { queryTrends } from './api.js';
import { askEnvelope, blockedVerdict, verdictEnvelope, schemaRejectionEnvelope } from './mcp.js';

export const askHelp = `Usage: google-trends-for-agent ask <term> [options]
  Returns interest, popular (Top) and rising related queries, and regions for one term.
  --validate          Add a calibrated verdict (spiking, rising, steady, flat, no_data, blocked)
  --from FILE|-       With --validate: read new-term-radar JSON leads (batch)
  --anchor TERM       Anchor for calibration (default gpts); --no-anchor to skip
  --trending          With --validate: also check Trending Now
  --diff              Add changes vs the previous saved snapshot (output is always JSON with --diff)
  --points            Include the full interest series (omitted by default to keep agent context small)
  --fresh             Force live data (alias --no-cache); --refresh always|never|if-stale
  --max-age MIN       Reuse saved snapshots younger than MIN minutes (default 360)
  --geo US --time "now 1-d" --category N --property ""
  --store DIR         Snapshot storage (default .gtfa/snapshots)
  --json              Agent envelope JSON (ask/validate; --diff implies JSON; --validate without --json prints a table)`;

/** Map an ask/validation envelope to the documented CLI exit code. */
function envelopeExitCode(e: { ok?: boolean; status?: string; error?: { code?: string } }): number {
  const code = e.error?.code ?? '';
  if (code === 'BLOCKED' || code === 'RATE_LIMITED' || e.status === 'blocked') return 3;
  if (code === 'INVALID_INPUT' || code === 'INVALID_COMBINATION') return 4;
  if (e.status === 'partial') return 2;
  if (e.ok === false || e.status === 'error' || code) return 1;
  return 0;
}

/** `ask` command: snapshot reuse/fetch, optional verdict (--validate) and diff vs previous (--diff). */
export async function runAskCli(args: string[], options: { query?: typeof queryTrends; stdin?: string } = {}) {
  try {
    const { values: v, positionals } = parseArgs({ args, allowPositionals: true, options: {
      from: { type: 'string' }, geo: { type: 'string' }, time: { type: 'string' }, category: { type: 'string' }, property: { type: 'string' },
      anchor: { type: 'string' }, 'no-anchor': { type: 'boolean' }, trending: { type: 'boolean' }, 'max-age': { type: 'string' },
      store: { type: 'string' }, json: { type: 'boolean' }, refresh: { type: 'string' }, fresh: { type: 'boolean' }, 'no-cache': { type: 'boolean' },
      validate: { type: 'boolean' }, diff: { type: 'boolean' }, points: { type: 'boolean' }, help: { type: 'boolean' },
    } });
    if (v.help) return { code: 0, stdout: process.stdout.isTTY && !v.json ? askHelp : JSON.stringify({ help: askHelp }), stderr: '' };
    if (v.refresh && !['always', 'never', 'if-stale'].includes(v.refresh)) throw new Error('invalid refresh');
    const filter = resolveFilter({ geo: v.geo, time: v.time, category: v.category === undefined ? undefined : Number(v.category), property: v.property });
    const store = new SnapshotStore(v.store), maxAgeMin = v['max-age'] === undefined ? 360 : Number(v['max-age']);
    if (!Number.isFinite(maxAgeMin) || maxAgeMin < 0) throw new Error('invalid max-age');
    const refresh = v.fresh || v['no-cache'] ? 'always' : v.refresh as 'always' | 'never' | 'if-stale' | undefined;
    const withDiff = async (term: string) => { const h = await store.history(term, filter, 2); return h.length < 2 ? null : diffSnapshots(h[1], h[0]); };
    let stderr = '';
    if (v.validate) {
      const leads: (string | LeadInput)[] = positionals.length ? [positionals.join(' ')] : [];
      if (v.from) leads.push(...parseNtrInput(JSON.parse(v.from === '-' ? options.stdin ?? readFileSync(0, 'utf8') : await readFile(v.from, 'utf8'))));
      if (!leads.length) throw new Error('provide a term or --from');
      const rows = await validateTerms(leads, { filter, store, maxAgeMin, query: options.query, anchor: v['no-anchor'] ? false : v.anchor, trending: v.trending, refresh });
      if (rows.some(r => r.verdict === 'blocked')) stderr = 'Warning: BLOCKED/RATE_LIMITED; validation stopped. No volumes invented.';
      const snapshots = await Promise.all(rows.map(r => store.latest(r.term, r.filter)));
      const out = await Promise.all(rows.map(async (r, i) => {
        const snap = snapshots[i];
        const diff = await withDiff(r.term);
        if (!snap) return r;
        return blockedVerdict(askEnvelope(snap, { cached: r.source === 'cache', ageMin: Math.max(0, (Date.now() - Date.parse(r.fetchedAt)) / 60000), verdict: verdictEnvelope(r), diff, ...(diff ? {} : { diffReason: 'Need two snapshots' }), includePoints: v.points, ...(r.anchor.warning ? { warnings: [r.anchor.warning] } : {}) }));
      }));
      const code = rows.some(r => r.verdict === 'blocked') ? 3 : out.reduce((max, e) => Math.max(max, envelopeExitCode(e as { ok?: boolean; status?: string; error?: { code?: string } })), 0);
      if (!v.json && !v.diff) return { code, stdout: ['term | verdict | conf | est/day | band | latest/peak | top popular | top rising | top region', ...rows.map(r => [r.term, r.verdict, r.confidence, r.anchor.traffic.average === null ? '无法估' : String(r.anchor.traffic.average), r.anchor.band ?? '-', String(r.interest.settledLatest) + (r.freshSpike ? ' ⚡' + r.freshSpike.ratio.toFixed(0) + '× recheck ~' + r.freshSpike.recheckAfterMin + 'm' : '') + '/' + r.interest.peak, r.popular[0]?.query ?? '-', r.rising[0]?.query ?? '-', r.regions[0]?.name ?? '-'].join(' | '))].join('\n'), stderr };
      return { code, stdout: JSON.stringify(!v.from && out.length === 1 ? out[0] : out), stderr };
    }
    if (v.from) throw new Error('--from requires --validate');
    const term = positionals.join(' '); if (!term) throw new Error('provide a term');
    const a = await askTerm(term, { filter, store, maxAgeMin, query: options.query, refresh });
    const diff = await withDiff(term);
    const envelope = blockedVerdict(askEnvelope(a.snapshot, { cached: a.source === 'cache', ageMin: a.ageMin, diff, ...(diff ? {} : { diffReason: 'Need two snapshots' }), includePoints: v.points }));
    if (a.snapshot.status === 'blocked') stderr = 'Warning: BLOCKED/RATE_LIMITED';
    return { code: envelopeExitCode(envelope), stdout: JSON.stringify(envelope), stderr };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { code: 4, stdout: JSON.stringify(schemaRejectionEnvelope(message)), stderr: `INVALID_INPUT: ${message}` };
  }
}
