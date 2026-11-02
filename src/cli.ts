#!/usr/bin/env node
import { runAskCli } from './ask-cli.js';
import { runSnapshotCli } from './snapshot-cli.js';
import { runTrendingCli } from './trending-cli.js';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { queryTrends, batchTrends, errorResponse, type TrendsResponse } from './api.js';
import { formatGTrendsExport } from './export.js';
import { planTrendsRequest } from './input.js';
import { publicInput } from './core.js';
import { resolveFilter } from './filter.js';
import { compareEnvelope, schemaRejectionEnvelope } from './mcp.js';

const help = `gtfa — Search-interest signals for AI agents — an unofficial Google Trends client

Usage:
  gtfa ask <term> [--validate] [--diff] [--fresh] [--points]   One term: interest, Popular + Rising, regions (ask --help)
  gtfa snapshot <term> [--json] [--svg] [--tz IANA]        Calibrated searches/day + chart path (snapshot --help)
  gtfa compare <kw> <kw> [...] [options]            Relative interest for 2-5 keywords
  gtfa --query coffee [--query tea] [options]       Same as compare (default mode)
  gtfa now --geo SG [--json]                        Trending Now (now --help); --hours = trending window 4|24|48|168
Options for compare / default mode:
  --url URL           Explore URL (repeatable; multiple URLs run sequentially)
  --geo US            Country or region
  --time "today 1-m"   Relative time range
  --start YYYY-MM-DD --end YYYY-MM-DD
  --types LIST        Comma-separated data types:
                      interestOverTime,interestByCity,interestByMetro,
                      interestBySubregion,relatedQueries,relatedTopics
  --format json|csv   Output format (default json)
  --json              Agent envelope JSON (compare/default mode)
  --timeout MS        Request timeout
  --retries N         Retry count
  --min-interval MS   Request spacing (default 1000)
  --pretty            Indent JSON
  --help              Show help
  --version           Show version

Examples:
  gtfa ask "nano banana" --validate --diff
  gtfa snapshot Astra --json
  gtfa compare coffee tea --geo US
  gtfa --query coffee --query tea --geo US
  gtfa now --geo SG --hours 24
  gtfa help now

Exit codes: 0 success, 1 upstream failure, 2 partial, 3 blocked/rate limited, 4 invalid input`;
function exitCode(results: TrendsResponse[]): number {
  if (results.some(r => ['BLOCKED', 'RATE_LIMITED'].includes(r.error?.code ?? ''))) return 3;
  if (results.some(r => ['INVALID_INPUT', 'INVALID_COMBINATION'].includes(r.error?.code ?? ''))) return 4;
  if (results.every(r => r.status === 'ok')) return 0;
  if (results.some(r => r.status === 'partial' || r.status === 'ok')) return 2;
  return 1;
}
async function main(): Promise<void> {
  let format: 'json' | 'csv' = 'json';
  let pretty = false;
  let json = false;
  let result: unknown;
  let results: TrendsResponse[];
  try {
    const { values } = parseArgs({ options: {
      query: { type: 'string', multiple: true }, url: { type: 'string', multiple: true },
      geo: { type: 'string' }, time: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' },
      types: { type: 'string' }, format: { type: 'string', default: 'json' }, json: { type: 'boolean' },
      timeout: { type: 'string' }, retries: { type: 'string' }, 'min-interval': { type: 'string' },
      pretty: { type: 'boolean' }, help: { type: 'boolean' }, version: { type: 'boolean' },
    } });
    if (values.help) { console.log(process.stdout.isTTY && !values.json ? help : JSON.stringify({ help })); return; }
    if (values.version) { console.log(JSON.stringify({ name: 'google-trends-for-agent', version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version })); return; }
    if (values.format !== 'json' && values.format !== 'csv') throw new Error('format must be json or csv');
    json = values.json ?? false;
    format = json ? 'json' : values.format;
    pretty = values.pretty ?? false;
    const numeric = (value: string): number => { if (!/^\d+$/.test(value)) throw new Error('numeric flags require non-negative integers'); return Number(value); };
    // Same defaults as MCP trends_compare / ask (US, now 1-d, honoring gtfa.config.json and GTFA_*); Explore URLs and explicit dates keep their own.
    const defaults = resolveFilter({ ...(values.geo !== undefined ? { geo: values.geo } : {}), ...(values.time ? { time: values.time } : {}) });
    const plan = await planTrendsRequest({
      ...(!values.url ? { geo: defaults.geo } : {}),
      ...(!values.url && !values.time && !values.start && !values.end ? { timeRange: defaults.time } : {}),
      ...(values.query ? { queries: values.query } : {}), ...(values.url ? { urls: values.url } : {}),
      ...(values.geo !== undefined ? { geo: values.geo } : {}), ...(values.time ? { timeRange: values.time } : {}),
      ...(values.start ? { startDate: values.start } : {}), ...(values.end ? { endDate: values.end } : {}),
      ...(values.types ? { dataTypes: values.types.split(',') } : {}),
      ...(values.timeout !== undefined ? { timeoutMs: numeric(values.timeout) } : {}),
      ...(values.retries !== undefined ? { maxRetries: numeric(values.retries) } : {}),
    });
    const options = values['min-interval'] !== undefined ? { minIntervalMs: numeric(values['min-interval']) } : {};
    if (plan.batch) {
      const batch = await batchTrends(plan.inputs.map(publicInput), options);
      result = json ? batch.results.map((r, i) => { const inp = plan.inputs[i]; return compareEnvelope(inp.queries, r, { geo: inp.geo, time: inp.timeRange ?? `${inp.startDate} ${inp.endDate}` }); }) : batch; results = batch.results;
    } else {
      const input = plan.inputs[0], response = await queryTrends(publicInput(input), options);
      result = json ? compareEnvelope(input.queries, response, { geo: input.geo, time: input.timeRange ?? `${input.startDate} ${input.endDate}` }) : response;
      results = [response];
    }
  } catch (error) {
    const response = errorResponse(null, error instanceof Error && 'code' in error && error.code === 'INVALID_COMBINATION' ? 'INVALID_COMBINATION' : 'INVALID_INPUT', error instanceof Error ? error.message : 'invalid input');
    result = json ? schemaRejectionEnvelope(error instanceof Error ? error.message : 'invalid input') : response; results = [response];
  }
  console.log(format === 'json' ? JSON.stringify(result, null, pretty ? 2 : undefined) : (await formatGTrendsExport(result, format)).body);
  process.exitCode = exitCode(results);
  for (const response of results) if (response.error) console.error(`${response.error.code}: ${response.error.message}`);
}
if (process.argv[2] === 'help') {
  process.argv.splice(2, process.argv.length - 2, ...(['now', 'ask', 'snapshot'].includes(process.argv[3]) ? [process.argv[3], '--help'] : process.argv.length === 3 ? ['--help'] : ['--invalid-help-topic']));
}
if (process.argv[2] === 'compare') {
  const rest = process.argv.slice(3), keywords: string[] = [], flags: string[] = [];
  for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) { flags.push(rest[i]); if (!['--pretty', '--json', '--help', '--version'].includes(rest[i]) && !rest[i].includes('=') && i + 1 < rest.length) flags.push(rest[++i]); } else keywords.push(rest[i]); }
  process.argv.splice(2, process.argv.length - 2, ...keywords.flatMap(k => ['--query', k]), ...flags);
}
if (process.argv[2] === 'ask') {
  const result = await runAskCli(process.argv.slice(3));
  console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exitCode = result.code;
} else if (process.argv[2] === 'now') {
  const result = await runTrendingCli(process.argv.slice(3));
  console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exitCode = result.code;
} else if (process.argv[2] === 'snapshot') {
  const result = await runSnapshotCli(process.argv.slice(3));
  console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exitCode = result.code;
} else void main();
