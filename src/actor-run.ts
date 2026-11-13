import { createHash } from 'node:crypto';
import { readFile as readFileDefault } from 'node:fs/promises';
import { GTrendsError, TIME_RANGES, type GTrendsTimeRange } from './core.js';
import { DEFAULT_GEO, GEO_CODES, normalizeGeo, WORLDWIDE_GEO } from './options.js';
import { DEFAULTS, type GtfaTool } from './tools.js';
import { summarizeInterest } from './gaps.js';
import { DEFAULT_FILTER, type TrendsFilter } from './filter.js';

/** The four actor input tools, mapped to the shared tool definitions. */
export const ACTOR_RUN_TOOLS = ['ask', 'snapshot', 'compare', 'now'] as const;
export type ActorRunTool = (typeof ACTOR_RUN_TOOLS)[number];
export type ActorRunStatus = 'ok' | 'no_data' | 'blocked' | 'rate_limited' | 'skipped' | 'error';

export interface ActorRunInput {
  tool?: string;
  terms?: string[];
  geo?: string;
  window?: string;
  anchor?: string;
  proxyConfiguration?: Record<string, unknown>;
}

export interface ActorRunError {
  code: string;
  message: string;
}

/** One flat dataset row; every optional value is null when the tool did not return it. */
export interface ActorRunRow {
  term: string;
  tool: ActorRunTool;
  geo: string;
  window: string;
  status: ActorRunStatus;
  interestLatest: number | null;
  interestSettled: number | null;
  interestAverage: number | null;
  interestPeak: number | null;
  searchesPerDay: number | null;
  verdict: string | null;
  anchor: string | null;
  topRelated: string[];
  topRising: string[];
  chartKey: string | null;
  chartUrl: string | null;
  error: ActorRunError | null;
  fetchedAt: string;
}

export interface ActorRunOutput {
  status: 'completed' | 'partial' | 'failed';
  tool: ActorRunTool;
  geo: string;
  window: string;
  terms: string[];
  delivered: number;
  noData: number;
  blocked: number;
  skipped: number;
  errors: number;
  durationMs: number;
  completed: boolean;
  partial: boolean;
  message: string;
}

export interface ActorRunResult {
  output: ActorRunOutput;
  failed: boolean;
  rows: ActorRunRow[];
}

export interface ActorRunDeps {
  /** Shared tool definitions from createTools(). */
  tools?: GtfaTool[];
  /** Optional executor seam; wins over tools when provided. */
  executeTool?: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  pushData: (item: Record<string, unknown>) => Promise<unknown>;
  setValue: (key: string, value: unknown, options?: { contentType?: string }) => Promise<unknown>;
  log?: (message: string) => void;
  /** Test seam for reading chart files. */
  readFile?: (path: string) => Promise<Buffer>;
  /** Clock seam for duration and fetchedAt fallbacks. */
  now?: () => number;
  /** Key-value store id for public chart URLs; defaults to APIFY_DEFAULT_KEY_VALUE_STORE_ID. */
  keyValueStoreId?: string;
}

const TOOL_NAMES: Record<ActorRunTool, 'trends_ask' | 'trends_snapshot' | 'trends_compare' | 'trends_now'> = {
  ask: 'trends_ask',
  snapshot: 'trends_snapshot',
  compare: 'trends_compare',
  now: 'trends_now',
};

/** Trending Now supports 4/24/48/168 hours; map the closest Explore window. */
const TRENDING_HOURS: Partial<Record<GTrendsTimeRange, 4 | 24 | 48 | 168>> = {
  'now 1-H': 4,
  'now 4-H': 4,
  'now 1-d': 24,
  'now 7-d': 168,
};
const TRENDING_LIMIT = 25;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function errorOf(value: unknown): ActorRunError | null {
  const error = record(value);
  const code = text(error.code);
  const message = text(error.message);
  return code && message ? { code, message } : null;
}

function names(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(row => {
    if (typeof row === 'string' && row.trim()) return [row.trim()];
    const query = text(record(row).query);
    return query ? [query] : [];
  }).slice(0, limit);
}

function statusFromCode(code: string | undefined): ActorRunStatus {
  return code === 'RATE_LIMITED' ? 'rate_limited' : code === 'BLOCKED' ? 'blocked' : 'error';
}

function statusOf(envelope: Record<string, unknown>): ActorRunStatus {
  const status = text(envelope.status);
  const code = errorOf(envelope.error)?.code;
  if (status === 'ok' || status === 'no_data') return status;
  if (status === 'blocked') return code === 'RATE_LIMITED' ? 'rate_limited' : 'blocked';
  if (status === 'partial' || status === 'error') {
    if (code === 'RATE_LIMITED') return 'rate_limited';
    if (code === 'BLOCKED') return 'blocked';
    return 'error';
  }
  return envelope.ok === false ? 'error' : 'ok';
}

function iq(value: unknown): { latest: number | null; settled: number | null; average: number | null; peak: number | null } {
  const interest = record(value);
  return {
    latest: num(interest.latest),
    settled: num(interest.settledLatest),
    average: num(interest.average),
    peak: num(interest.peak),
  };
}

function baseRow(tool: ActorRunTool, term: string, geo: string, window: string, fetchedAt: string): ActorRunRow {
  return {
    term, tool, geo, window, status: 'ok',
    interestLatest: null, interestSettled: null, interestAverage: null, interestPeak: null,
    searchesPerDay: null, verdict: null, anchor: null, topRelated: [], topRising: [],
    chartKey: null, chartUrl: null, error: null, fetchedAt,
  };
}

function fetchedAtOf(envelope: Record<string, unknown>, fallback: string): string {
  const meta = record(envelope.meta);
  return text(meta.fetchedAt) ?? text(envelope.fetchedAt) ?? fallback;
}

function chartUrlFor(key: string, storeId: string | undefined): string | null {
  if (!storeId) return null;
  return `https://api.apify.com/v2/key-value-stores/${encodeURIComponent(storeId)}/records/${encodeURIComponent(key)}`;
}

/** ASCII-only KV key part (Apify keys allow ASCII only) plus a short hash so distinct terms never collide. */
export function chartKeyFor(term: string): string {
  const ascii = term.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const hash = createHash('sha256').update(term).digest('hex').slice(0, 8);
  return `chart-${ascii ? `${ascii}-` : ''}${hash}`;
}

/** A partial envelope still counts as delivered when it carries usable data. */
function hasUsableData(row: ActorRunRow): boolean {
  return row.interestLatest !== null || row.searchesPerDay !== null || row.topRelated.length > 0 || row.topRising.length > 0;
}

function settlePartial(row: ActorRunRow, envelope: Record<string, unknown>): ActorRunRow {
  if (text(envelope.status) === 'partial' && hasUsableData(row)) row.status = 'ok';
  return row;
}

function mapAsk(term: string, envelope: Record<string, unknown>, geo: string, window: string, fallbackFetchedAt: string): ActorRunRow {
  const row = baseRow('ask', term, geo, window, fetchedAtOf(envelope, fallbackFetchedAt));
  const interest = iq(envelope.interest);
  const verdict = record(envelope.verdict);
  const traffic = record(verdict.traffic);
  const anchor = record(verdict.anchor);
  const tables = record(envelope.tables);
  row.status = statusOf(envelope);
  row.interestLatest = interest.latest;
  row.interestSettled = interest.settled;
  row.interestAverage = interest.average;
  row.interestPeak = interest.peak;
  row.searchesPerDay = num(traffic.average);
  row.verdict = text(verdict.label);
  row.anchor = text(anchor.term);
  row.topRelated = names(tables.popular);
  row.topRising = names(tables.rising);
  row.error = errorOf(envelope.error);
  return settlePartial(row, envelope);
}

function mapSnapshot(term: string, envelope: Record<string, unknown>, geo: string, window: string, fallbackFetchedAt: string): ActorRunRow {
  const row = baseRow('snapshot', term, geo, window, fetchedAtOf(envelope, fallbackFetchedAt));
  const traffic = record(envelope.traffic);
  const anchor = record(envelope.anchor);
  const verdict = record(envelope.verdict);
  const tables = record(envelope.tables);
  row.status = statusOf(envelope);
  // Relative interest (0–100) comes from the score series; traffic holds searches/day.
  const series = record(envelope.series);
  const points = (Array.isArray(series.points) ? series.points : []).flatMap(value => {
    const point = record(value);
    const time = text(point.t);
    const score = num(point.score);
    return time && score !== null ? [{ time, value: score }] : [];
  });
  if (points.length) {
    const filter: TrendsFilter = { ...DEFAULT_FILTER, ...record(envelope.filter) as Partial<TrendsFilter> };
    const interest = summarizeInterest(points, filter);
    row.interestLatest = interest.latest;
    row.interestSettled = interest.settledLatest;
    row.interestAverage = interest.average;
    row.interestPeak = interest.peak;
  }
  row.searchesPerDay = num(traffic.average);
  row.verdict = text(verdict.label);
  row.anchor = text(anchor.term);
  row.topRelated = names(tables.popular);
  row.topRising = names(tables.rising);
  row.error = errorOf(envelope.error);
  return settlePartial(row, envelope);
}

function mapCompare(envelope: Record<string, unknown>, terms: string[], geo: string, window: string, fallbackFetchedAt: string): ActorRunRow[] {
  const status = statusOf(envelope);
  const error = errorOf(envelope.error);
  const fetchedAt = fetchedAtOf(envelope, fallbackFetchedAt);
  const series = Array.isArray(envelope.series) ? envelope.series : [];
  if (!series.length) {
    return terms.map(term => ({
      ...baseRow('compare', term, geo, window, fetchedAt),
      status: status === 'ok' ? 'error' : status,
      error: error ?? { code: 'TRENDS_PROTOCOL_CHANGED', message: 'The compare result contained no series.' },
    }));
  }
  return series.map(value => {
    const entry = record(value);
    const keyword = text(entry.keyword) ?? '';
    const row = baseRow('compare', keyword, geo, window, fetchedAt);
    row.status = status;
    row.interestLatest = num(entry.latest);
    row.interestAverage = num(entry.average);
    row.interestPeak = num(entry.peak);
    row.error = error;
    return settlePartial(row, envelope);
  });
}

function mapNow(envelope: Record<string, unknown>, geo: string, window: string, fallbackFetchedAt: string): ActorRunRow[] {
  const byGeo = Array.isArray(envelope.byGeo) ? envelope.byGeo : [];
  const rows: ActorRunRow[] = [];
  for (const value of byGeo) {
    const block = record(value);
    const blockGeo = text(block.geo) ?? geo;
    const status = block.ok === false || block.error ? statusOf({ status: 'error', error: block.error }) : 'ok';
    const fetchedAt = text(block.fetchedAt) ?? fallbackFetchedAt;
    const items = Array.isArray(block.items) ? block.items.slice(0, TRENDING_LIMIT) : [];
    if (status !== 'ok' && !items.length) {
      // Keep a country-level failure visible in the dataset and OUTPUT counters.
      const row = baseRow('now', blockGeo, blockGeo, window, fetchedAt);
      row.status = status;
      row.error = errorOf(block.error) ?? { code: 'INTERNAL', message: 'Trending Now returned no items for this country.' };
      rows.push(row);
      continue;
    }
    for (const itemValue of items) {
      const item = record(itemValue);
      const term = text(item.query) ?? text(item.title) ?? '';
      if (!term) continue;
      const row = baseRow('now', term, blockGeo, window, fetchedAt);
      row.status = status;
      row.topRelated = names(item.relatedQueries);
      row.error = errorOf(block.error);
      rows.push(row);
    }
  }
  return rows;
}

function buildOutput(tool: ActorRunTool, geo: string, window: string, terms: string[], rows: ActorRunRow[], startedAt: number, now: number, message?: string): ActorRunOutput {
  const delivered = rows.filter(row => row.status === 'ok').length;
  const noData = rows.filter(row => row.status === 'no_data').length;
  const blocked = rows.filter(row => row.status === 'blocked' || row.status === 'rate_limited').length;
  const skipped = rows.filter(row => row.status === 'skipped').length;
  const errors = rows.filter(row => row.status === 'error').length;
  const completed = rows.length > 0 && rows.every(row => (row.status === 'ok' || row.status === 'no_data') && !row.error);
  const partial = !completed && delivered > 0;
  const status = completed ? 'completed' : partial ? 'partial' : 'failed';
  const firstError = rows.find(row => row.error)?.error?.message;
  return {
    status, tool, geo, window, terms, delivered, noData, blocked, skipped, errors,
    durationMs: Math.max(0, now - startedAt), completed, partial,
    message: message ?? (completed
      ? `Completed ${rows.length} row${rows.length === 1 ? '' : 's'}${noData ? ` (${noData} with no data)` : ''}.`
      : partial
        ? `Partial result: ${delivered} of ${rows.length} rows delivered; ${rows.filter(row => row.error).length} with errors.`
        : firstError ? `No usable data: ${firstError}` : 'No usable data.'),
  };
}

/** Stable Actor.fail text: counts only, never terms or row error details (those stay in OUTPUT). */
export function actorFailMessage(output: ActorRunOutput): string {
  const total = output.delivered + output.noData + output.blocked + output.skipped + output.errors;
  if (!total) return 'Run failed; see OUTPUT';
  const failed = output.blocked + output.skipped + output.errors;
  return `Run failed: ${failed} of ${total} rows failed; see OUTPUT`;
}

interface ValidatedInput {
  tool: ActorRunTool;
  terms: string[];
  geo: string;
  window: GTrendsTimeRange;
  anchor: string;
}

function validate(input: ActorRunInput): ValidatedInput | string {
  const rawTool = text(input.tool) ?? 'ask';
  if (!(ACTOR_RUN_TOOLS as readonly string[]).includes(rawTool)) {
    return `Unknown tool "${rawTool}"; use ask, snapshot, compare, or now.`;
  }
  const tool = rawTool as ActorRunTool;
  if (input.terms !== undefined && !Array.isArray(input.terms)) return 'terms must be a list of strings.';
  const terms = (input.terms ?? []).map(term => typeof term === 'string' ? term.trim() : '').filter(Boolean);
  const rawGeo = input.geo === undefined ? DEFAULT_GEO : typeof input.geo === 'string' ? input.geo.trim() : '';
  let geo: string;
  try {
    // The input-schema select uses WORLDWIDE; Explore uses an empty geo.
    geo = normalizeGeo(rawGeo.toUpperCase() === 'WORLDWIDE' ? WORLDWIDE_GEO : rawGeo);
  } catch {
    return `Unsupported geo "${rawGeo}".`;
  }
  const rawWindow = text(input.window) ?? DEFAULTS.time;
  if (!(TIME_RANGES as readonly string[]).includes(rawWindow)) {
    return `Unknown window "${rawWindow}"; use one of: ${TIME_RANGES.join(', ')}.`;
  }
  const window = rawWindow as GTrendsTimeRange;
  const anchor = text(input.anchor) ?? '';
  if (anchor && anchor !== 'gpts' && anchor !== 'sudoku') return `Unknown anchor "${anchor}"; use gpts, sudoku, or leave it blank.`;
  if (tool === 'now') {
    if (!geo) return 'Trending now needs a country code; Worldwide is not supported.';
    if (!GEO_CODES.includes(geo)) return `Trending now does not support "${geo}".`;
  }
  if (tool !== 'now' && terms.length === 0) return `Add at least one term for the ${tool} tool.`;
  if (tool === 'compare' && (terms.length < 2 || terms.length > 5)) return `Compare needs 2–5 terms (got ${terms.length}).`;
  return { tool, terms, geo, window, anchor };
}

/** Validate one-off input without running a tool; returns a user-facing message or undefined. */
export function validateActorRunInput(input: ActorRunInput): string | undefined {
  const validated = validate(input);
  return typeof validated === 'string' ? validated : undefined;
}

/** Execute one Actor run (one tool) and write the dataset rows plus the OUTPUT summary. */
export async function runOnce(input: ActorRunInput, deps: ActorRunDeps): Promise<ActorRunResult> {
  const clock = deps.now ?? Date.now;
  const startedAt = clock();
  const fallbackFetchedAt = new Date(startedAt).toISOString();
  const validated = validate(input);
  if (typeof validated === 'string') {
    const rawTool = text(input.tool) ?? 'ask';
    const tool = (ACTOR_RUN_TOOLS as readonly string[]).includes(rawTool) ? rawTool as ActorRunTool : 'ask';
    const output = buildOutput(tool, typeof input.geo === 'string' ? input.geo : DEFAULT_GEO,
      text(input.window) ?? DEFAULTS.time, Array.isArray(input.terms) ? input.terms : [], [], startedAt, clock(), `Invalid input: ${validated}`);
    await deps.setValue('OUTPUT', output);
    deps.log?.(`Invalid input: ${validated}`);
    return { output, failed: true, rows: [] };
  }
  const { tool, terms, geo, window, anchor } = validated;
  const execute = deps.executeTool ?? (async (name, args) => {
    const definition = deps.tools?.find(candidate => candidate.name === name);
    if (!definition) throw new Error(`Tool ${name} is not available.`);
    return definition.execute(args, {});
  });
  const rows: ActorRunRow[] = [];
  const push = async (row: ActorRunRow) => {
    rows.push(row);
    deps.log?.(`Row ${rows.length}: ${row.status}`);
    await deps.pushData(row as unknown as Record<string, unknown>);
  };
  const skipped = (term: string, code: string) => {
    const row = baseRow(tool, term, geo, window, fallbackFetchedAt);
    row.status = 'skipped';
    row.error = { code, message: 'skipped after upstream block/rate limit' };
    return row;
  };

  if (tool === 'compare') {
    try {
      const envelope = await execute(TOOL_NAMES.compare, { keywords: terms, geo, time: window });
      for (const row of mapCompare(envelope, terms, geo, window, fallbackFetchedAt)) await push(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const term of terms) {
        const row = baseRow('compare', term, geo, window, fallbackFetchedAt);
        row.status = 'error';
        row.error = { code: error instanceof GTrendsError ? error.code : 'INTERNAL', message };
        await push(row);
      }
    }
  } else if (tool === 'now') {
    try {
      const hours = TRENDING_HOURS[window] ?? 24;
      const envelope = await execute(TOOL_NAMES.now, { geos: [geo], hours, limit: TRENDING_LIMIT });
      for (const row of mapNow(envelope, geo, window, fallbackFetchedAt)) await push(row);
    } catch (error) {
      const row = baseRow('now', geo, geo, window, fallbackFetchedAt);
      row.status = 'error';
      row.error = { code: error instanceof GTrendsError ? error.code : 'INTERNAL', message: error instanceof Error ? error.message : String(error) };
      await push(row);
    }
  } else {
    const name = TOOL_NAMES[tool];
    let halt: string | undefined;
    for (const term of terms) {
      if (halt) { await push(skipped(term, halt)); continue; }
      try {
        const envelope = tool === 'snapshot'
          ? await execute(name, { term, geo, time: window, ...(anchor ? { anchor } : {}) })
          : await execute(name, { term, geo, time: window, validate: true, ...(anchor ? { anchor } : {}) });
        const row = tool === 'snapshot'
          ? mapSnapshot(term, envelope, geo, window, fallbackFetchedAt)
          : mapAsk(term, envelope, geo, window, fallbackFetchedAt);
        if (tool === 'snapshot') {
          const chartPath = text(record(envelope.chart).path);
          if (chartPath) {
            try {
              const buffer = deps.readFile ? await deps.readFile(chartPath) : await readFileDefault(chartPath);
              const key = chartKeyFor(term);
              const contentType = chartPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/svg+xml';
              await deps.setValue(key, buffer, { contentType });
              row.chartKey = key;
              row.chartUrl = chartUrlFor(key, deps.keyValueStoreId ?? process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID);
            } catch {
              // A missing chart is not a failed data row; the dataset stays usable.
            }
          }
        }
        await push(row);
        if (row.status === 'blocked' || row.status === 'rate_limited') halt = row.error?.code ?? (row.status === 'rate_limited' ? 'RATE_LIMITED' : 'BLOCKED');
      } catch (error) {
        const code = error instanceof GTrendsError ? error.code : 'INTERNAL';
        const row = baseRow(tool, term, geo, window, fallbackFetchedAt);
        row.status = statusFromCode(code);
        row.error = { code, message: error instanceof Error ? error.message : String(error) };
        await push(row);
        if (row.status === 'blocked' || row.status === 'rate_limited') halt = code;
      }
    }
  }

  const output = buildOutput(tool, geo, window, terms, rows, startedAt, clock());
  await deps.setValue('OUTPUT', output);
  return { output, failed: output.status === 'failed', rows };
}
