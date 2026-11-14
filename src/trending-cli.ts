import { parseArgs } from 'node:util';
import { normalizeTrendingGeos, TRENDING_GEOS } from './geos.js';
import { fetchTrending, listTrending, type TrendingHours, type TrendingResponse, type TrendingOptions } from './trending.js';
import { nowEnvelope, schemaRejectionEnvelope } from './tools.js';
import { csvCell } from './export.js';

export function trendingExitCode(results: TrendingResponse[]): number {
  if (results.some(r => ['BLOCKED', 'RATE_LIMITED'].includes(r.error?.code ?? ''))) return 3;
  if (results.some(r => r.error?.code === 'INVALID_INPUT')) return 4;
  if (results.every(r => r.status === 'ok')) return 0;
  return results.some(r => r.status === 'ok') ? 2 : 1;
}
const help = `Usage: gtfa now --geo SG [options]
  Trending Now. --hours is the trending window (4|24|48|168), not the Explore --time range.
  --geo US,SG,JP | --all-geos | --default-geos
  --hours 4|24|48|168 (default 24)
  --min-volume 5000 --category 18,17 --limit 20 --lang en
  --format json|csv --json --pretty --list-geos
  --json              Agent envelope JSON (same as the trends_now MCP tool)
  --timeout MS --min-interval MS (default 1500)
  --help
Example: gtfa now --geo SG --hours 24 --limit 20
Exit codes: 0 success, 1 upstream failure, 2 partial, 3 blocked/rate limited, 4 invalid input`;
export async function runTrendingCli(args: string[], options: TrendingOptions = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  let format = 'json'; let pretty = false; let json = args.includes('--json');
  let result: unknown; let results: TrendingResponse[];
  try {
    const { values: v } = parseArgs({ args, options: {
      geo: { type: 'string' }, 'all-geos': { type: 'boolean' }, 'default-geos': { type: 'boolean' }, 'list-geos': { type: 'boolean' },
      hours: { type: 'string' }, 'min-volume': { type: 'string' }, category: { type: 'string' }, limit: { type: 'string' }, lang: { type: 'string' },
      format: { type: 'string', default: 'json' }, json: { type: 'boolean' }, pretty: { type: 'boolean' }, help: { type: 'boolean' }, timeout: { type: 'string' }, 'min-interval': { type: 'string' },
    } });
    if (v.help) return { code: 0, stdout: process.stdout.isTTY && !v.json ? help : JSON.stringify({ help }), stderr: '' };
    json = v.json ?? false;
    if (!['json', 'csv'].includes(v.format!)) throw new Error('format must be json or csv');
    format = v.json ? 'json' : v.format!; pretty = v.pretty ?? false;
    if (v['list-geos']) return { code: 0, stdout: format === 'csv' ? [['code', 'name'].map(csvCell).join(','), ...TRENDING_GEOS.map(g => [g.code, g.name].map(csvCell).join(','))].join('\r\n') + '\r\n' : JSON.stringify(TRENDING_GEOS, null, pretty ? 2 : undefined), stderr: '' };
    if ([v.geo !== undefined, !!v['all-geos'], !!v['default-geos']].filter(Boolean).length !== 1) throw new Error('choose --geo, --all-geos, or --default-geos');
    const number = (s: string) => { if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s))) throw new Error('numeric flags require non-negative integers'); return Number(s); };
    const input = { hours: (v.hours === undefined ? 24 : number(v.hours)) as TrendingHours, lang: v.lang ?? 'en',
      ...(v['min-volume'] !== undefined ? { minVolume: number(v['min-volume']) } : {}),
      ...(v.limit !== undefined ? { limit: number(v.limit) } : {}), ...(v.category !== undefined ? { categories: v.category.split(',').map(number) } : {}) };
    const opts = { ...options, ...(v.timeout !== undefined ? { timeoutMs: number(v.timeout) } : {}), ...(v['min-interval'] !== undefined ? { minIntervalMs: number(v['min-interval']) } : {}) };
    const all = !!v['all-geos'];
    const geos = normalizeTrendingGeos(all ? 'all' : v['default-geos'] ? 'default' : v.geo!.split(','));
    if (v.json) { const batch = await listTrending({ ...input, geos }, opts); const invalid = batch.results.find(r => r.error?.code === 'INVALID_INPUT'); result = invalid ? schemaRejectionEnvelope(invalid.error!.message) : nowEnvelope(batch.results, input.hours as TrendingHours); results = batch.results; }
    else if (!all && geos.length === 1) { const response = await fetchTrending({ ...input, geo: geos[0] }, opts); result = response; results = [response]; }
    else { const batch = await listTrending({ ...input, geos }, opts); result = batch; results = batch.results; }
  } catch (e) {
    const response: TrendingResponse = { status: 'error', geo: '', hours: 24, fetchedAt: new Date().toISOString(), items: [], error: { code: 'INVALID_INPUT', message: e instanceof Error ? e.message : 'invalid input' }, meta: { upstreamRequests: 0, durationMs: 0 } };
    result = json ? schemaRejectionEnvelope(response.error!.message) : response; results = [response];
  }
  const fields = ['geo', 'rank', 'title', 'query', 'volume', 'volumeLabel', 'growthPct', 'categoryIds', 'categories', 'startedAt', 'endedAt', 'active', 'relatedQueries', 'newsCount', 'errorCode', 'errorMessage'];
  const csvRows = [fields, ...results.flatMap(r => r.error
    ? [fields.map(field => field === 'geo' ? r.geo : field === 'errorCode' ? r.error!.code : field === 'errorMessage' ? r.error!.message : '')]
    : r.items.map(item => fields.map(field => (item as unknown as Record<string, unknown>)[field])))];
  const csv = csvRows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return { code: trendingExitCode(results), stdout: format === 'csv' ? csv : JSON.stringify(result, null, pretty ? 2 : undefined), stderr: results.filter(r => r.error).map(r => `${r.error!.code}: ${r.error!.message}`).join('\n') };
}
