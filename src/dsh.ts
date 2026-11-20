import { estimateBatch } from './dashboard-batch.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createTools, invalidInputEnvelope, zodRejectionEnvelope, findDuplicateKeyword, type GtfaTool } from './tools.js';
import { OnDemandActorClient, callActorTool, type OnDemandOptions } from './actor-on-demand.js';
import type { CreateActorRelayTransportOptions } from './apify-actor.js';
import {
  createApifyOAuthManager,
  type ApifyOAuthManager,
  type OAuthCredentialsService,
} from './apify-oauth.js';
import { BUILTIN_ANCHORS, loadBaselinesFromEnv, parseBaselines, type Anchor, type Baselines, type WindowAnchors } from './traffic.js';
import { DEFAULT_GEO, GEO_CODES, GTFA_PUBLIC_ACTOR_ID, normalizeGeo, resolveEgress, type EgressMode, type EgressNotice } from './options.js';
import { createDefaultTransport, throwIfAborted, type Transport } from './transport.js';
import { registerRoutes, type RouteOverrides } from './dsh-routes.js';
import { GTrendsError } from './core.js';
import { QueryHistoryStore, type QueryRecord } from './query-history.js';
import { singleVolume } from './dashboard-single.js';
import { row, rows, relativeDshResult, volumeFilter, volumeReferences } from './dashboard-volume.js';
import { estimateRequest, finishEstimate, restoreEstimateBand } from './dashboard-estimate.js';
import { MEKA_BASELINES_URL, mekaDefaultAnchor } from './dsh-baselines.js';
import { REGIONAL_CALIBRATION_GUIDANCE } from './baseline-catalog.js';
import type { QueryPhase } from './query-progress.js';

type SchemaFactory = (typeof import('@deepseek-ai/schemastery'))['default'];
// The library and CLI must work without the optional dsh peer dependency.
const Schema: SchemaFactory | undefined = await import('@deepseek-ai/schemastery')
  .then(module => module.default)
  .catch(() => undefined);

/** Cordis plugin name. */
export const name = 'gtfa';
/** Tools are the only required service; skills is attached opportunistically. */
export const inject = ['tools'];

/** Editable settings shape shown by dsh's Plugins → Configure page. */
export interface GtfaConfig {
  /** `local` sends Google requests from this machine; the two Actor routes execute one bounded cloud run per query. */
  egress?: EgressMode;
  /** Advanced fallback Apify API token; OAuth takes priority and saved values stay hidden from reads. */
  apifyToken?: string;
  /** Actor id of your google-trends-for-agent Actor (one-off runs); used by the actor-own route. */
  apifyActor?: string;
  /** Snapshot directory, resolved against the dsh process working directory. */
  snapshotDir?: string;
  /** Chart directory (advanced); null or `charts: false` disables chart files. */
  chartDir?: string | null;
  /** Write chart files (default true). */
  charts?: boolean;
  /** Default geo for trends_ask/trends_compare/trends_snapshot. */
  geo?: string;
  /** Optional anchor override for validate/snapshot. */
  anchor?: string;
  /** Optional inline baselines override (same semantics as GTFA_BASELINES). */
  baselines?: {
    anchors?: Array<Partial<Anchor> & { term: string; dailySearches: number }>;
    windowAnchors?: WindowAnchors;
  };
  /** Reuse saved snapshots (default true); false always fetches fresh. */
  cache?: boolean;
}

function createConfig(Schema: SchemaFactory) {
  const baselines = Schema.transform(Schema.object({
    anchors: Schema.array(Schema.object({
      term: Schema.string().required().description('Anchor term, for example gpts or sudoku.'),
      geo: Schema.string().default('US').description('Country code for this anchor; empty string means Worldwide.'),
      dailySearches: Schema.transform(Schema.number().required(), (value: number) => {
        if (!(value > 0)) throw new Error('dailySearches must be a positive number');
        return value;
      }).description('Estimated daily searches for the anchor; must be positive.'),
      tolerance: Schema.number().min(0).max(1).description('Allowed ± fraction, for example 0.5.'),
    })).default([]).description('Override or add anchors; an empty list keeps the built-in regional baselines.'),
    windowAnchors: Schema.object({
      short: Schema.string().description('Anchor term for now 1-H, now 4-H, and now 1-d.'),
      long: Schema.string().description('Anchor term for now 7-d and longer windows.'),
    }).default({}).description('Optional automatic anchor term per window.'),
  }), (value: unknown) => {
    // Keep this callback self-contained: dsh serializes transform callbacks to the
    // browser settings form, where this module's imports are not in scope.
    const row = (value ?? {}) as { anchors?: Array<{ term?: unknown }> | null; windowAnchors?: Record<string, unknown> | null };
    const terms = new Set(['gpts', 'sudoku', 'calculator', 'ナンプレ']);
    for (const anchor of row.anchors ?? []) {
      const term = String(anchor.term ?? '').trim().toLowerCase();
      if (!term) throw new Error('anchor term must not be blank');
      terms.add(term);
    }
    for (const key of ['short', 'long']) {
      const term = String(row.windowAnchors?.[key] ?? '').trim();
      if (term && !terms.has(term.toLowerCase())) throw new Error(`windowAnchors.${key} "${term}" is not in anchors or the built-in anchors`);
    }
    return value;
  }).description('Optional inline baselines override.');

  /** Host Config schema. Volatile fields apply live; dsh-settings redacts token reads. */
  return Schema.object({
    egress: Schema.string().default('local')
      .description('local sends Google requests from the dsh machine. actor-public runs the meka.im Actor on demand; actor-own runs your own deployment (both work on the Free plan).').volatile(),
    apifyToken: Schema.string().role('secret')
      .description('Advanced fallback Apify API token; Apify OAuth takes priority. Saved in the profile cordis.patch.yml (hidden in the UI, never logged or returned); leave blank and set APIFY_TOKEN to keep it out of the profile.').volatile(),
    apifyActor: Schema.string()
      .description('Actor id of your google-trends-for-agent Actor. Pick or deploy one in the Apify section of this page.').volatile(),
    geo: Schema.union([...GEO_CODES]).default(DEFAULT_GEO)
      .description('Default geo for trends_ask, trends_compare, and trends_snapshot; empty means Worldwide.').volatile(),
    anchor: Schema.string()
      .description('Optional fixed anchor for validate and trends_snapshot; blank picks the window default.').volatile(),
    baselines: baselines.volatile(),
    cache: Schema.boolean().default(true)
      .description('Reuse stored snapshots (up to 360 minutes); off always fetches fresh.').volatile(),
    snapshotDir: Schema.string().default('.gtfa/snapshots')
      .description('Advanced: snapshot store directory.').volatile(),
    chartDir: Schema.string().default('.gtfa/charts')
      .description('Advanced: chart output directory.').volatile(),
    charts: Schema.boolean().default(true)
      .description('Advanced: write SVG chart files.').volatile(),
  });
}

/** Host Config schema, present only when the optional dsh peer is installed. */
export const Config = Schema ? createConfig(Schema) : undefined;

interface SkillService {
  registerProvider(create: () => unknown): unknown;
}

interface DshContext {
  tools: { register(definition: unknown): unknown };
  get?(name: string): unknown;
  inject?(names: string[], callback: (ctx: DshContext) => void): unknown;
  effect?(callback: () => void | (() => void)): unknown;
  credentials?: unknown;
}

export interface RegisterOverrides {
  /** Test seam: use a fixture transport instead of the configured egress. */
  transport?: Transport;
  /** Test seam: override Actor relay construction (fetch and standby resolver). */
  relay?: Omit<CreateActorRelayTransportOptions, 'token' | 'actorId'>;
  /** Test seam for the bounded one-off Actor API. */
  onDemand?: OnDemandOptions;
  /** Test seam: provide baselines instead of reading GTFA_BASELINES. */
  baselines?: Baselines;
  /** Test seam: request spacing; production uses 1500 ms like MCP. */
  minIntervalMs?: number;
  /** Test seam: usage and test-connection route clients. */
  routes?: RouteOverrides;
  /** Test seam: replace the OAuth manager. */
  oauth?: ApifyOAuthManager;
  /** Test seam: OAuth HTTP fetch; production uses global fetch. */
  oauthFetch?: typeof globalThis.fetch;
}

/** Runtime values after unwrapping dsh's volatile refs and applying defaults. */
export interface GtfaRuntimeSettings {
  egress: EgressMode;
  /** Set when a saved egress value was renamed or is unrecognized. */
  egressNotice?: EgressNotice;
  apifyToken?: string;
  apifyActor?: string;
  geo: string;
  anchor?: string;
  baselines?: Baselines;
  cache: boolean;
  snapshotDir: string;
  chartDir: string | null;
}

type VolatileRef<T> = { get(): T };

/** Read a value that may be a dsh volatile ref. */
function read<T>(value: T | VolatileRef<T> | undefined): T | undefined {
  if (value && typeof value === 'object' && typeof (value as VolatileRef<T>).get === 'function') return (value as VolatileRef<T>).get();
  return value as T | undefined;
}

/** Validate and normalize an inline baselines override from the settings schema. */
export function baselinesFromConfig(value: unknown): Baselines | undefined {
  if (value === undefined || value === null) return undefined;
  const row = value as { anchors?: unknown; windowAnchors?: unknown };
  const anchors = Array.isArray(row.anchors) ? row.anchors as Anchor[] : [];
  const windows = row.windowAnchors && typeof row.windowAnchors === 'object' ? row.windowAnchors as WindowAnchors : undefined;
  const hasWindow = Boolean(windows?.short?.trim() || windows?.long?.trim());
  if (!anchors.length && !hasWindow) return undefined;
  return parseBaselines({
    version: 2,
    // Window-only overrides pick among the built-in anchors.
    anchors: anchors.length ? anchors.map(anchor => ({ ...anchor, geo: typeof anchor.geo === 'string' ? anchor.geo.trim() : anchor.geo === undefined ? 'US' : anchor.geo })) : [...BUILTIN_ANCHORS],
    ...(hasWindow ? { windowAnchors: windows } : {}),
  }, 'dsh baselines');
}

/** Normalize one config object (plain or volatile) into the values the tools read per call. */
export function resolveGtfaSettings(config: GtfaConfig, envBaselines?: Baselines): GtfaRuntimeSettings {
  const resolvedEgress = resolveEgress(read(config.egress));
  const geo = normalizeGeo(read(config.geo) ?? DEFAULT_GEO);
  const chartDirValue = read(config.chartDir);
  const charts = read(config.charts) ?? chartDirValue !== null;
  const baselines = baselinesFromConfig(read(config.baselines)) ?? envBaselines;
  return {
    egress: resolvedEgress.egress,
    ...(resolvedEgress.notice ? { egressNotice: resolvedEgress.notice } : {}),
    ...(read(config.apifyToken)?.trim() ? { apifyToken: read(config.apifyToken)!.trim() } : {}),
    ...(read(config.apifyActor)?.trim() ? { apifyActor: read(config.apifyActor)!.trim() } : {}),
    geo,
    ...(read(config.anchor)?.trim() ? { anchor: read(config.anchor)!.trim() } : {}),
    ...(baselines ? { baselines } : {}),
    cache: read(config.cache) ?? true,
    snapshotDir: read(config.snapshotDir)?.trim() || '.gtfa/snapshots',
    chartDir: charts === false || chartDirValue === null ? null : chartDirValue?.trim() || '.gtfa/charts',
  };
}

/** Resolve the credentials seam without making it a required plugin injection. */
function credentialsFromContext(ctx: DshContext): OAuthCredentialsService | undefined {
  try {
    const fromGet = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined;
    return (fromGet ?? (ctx as { credentials?: unknown }).credentials) as OAuthCredentialsService | undefined;
  } catch {
    return undefined;
  }
}


const SKILL_FILE = new URL('../dsh/skill.md', import.meta.url);
const SKILL_BASE = new URL('../dsh/', import.meta.url);

const skill = {
  name: 'gtfa',
  description: 'Use Google Trends search-interest data from the native gtfa tools: verify demand for a term, compare a candidate against an anchor or rival, calibrate searches/day and charts, or check what is trending now. Light interactive research only; report no_data and blocked honestly and never invent search volumes.',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'gtfa',
  source: 'bundled',
  path: fileURLToPath(SKILL_FILE),
  resourceBase: { kind: 'directory' as const, path: fileURLToPath(SKILL_BASE) },
  rank: 600,
  locator: SKILL_FILE,
};

const provider = {
  name: 'gtfa',
  list: () => Promise.resolve([skill]),
  async get() {
    return { ...skill, content: await readFile(SKILL_FILE, 'utf8') };
  },
};

function attachSkill(skills: unknown) {
  const service = skills as SkillService | undefined;
  if (service && typeof service.registerProvider === 'function') service.registerProvider(() => provider);
}

/** Register the gtfa skill when the profile has a skills service; tools still load otherwise. */
function registerSkill(ctx: DshContext) {
  const existing = typeof ctx.get === 'function' ? ctx.get('skills') : undefined;
  if (existing) return attachSkill(existing);
  if (typeof ctx.inject === 'function') {
    ctx.inject(['skills'], scoped => attachSkill(scoped.get?.('skills') ?? (scoped as unknown as { skills?: unknown }).skills));
  }
}

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  '$schema', '$id', '$defs', '$ref', 'definitions', 'patternProperties', 'dependentRequired',
]);

function convertSchemaNode(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('gtfa: unsupported tool parameter schema');
  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (key === 'anyOf') {
      const branches = (value as unknown[]).map(convertSchemaNode);
      if (branches.length === 1) return branches[0];
      out.oneOf = branches;
    } else if (key === 'properties') {
      out.properties = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, convertSchemaNode(child)]));
    } else if (key === 'items') {
      out.items = convertSchemaNode(value);
    } else if (key === 'type' || key === 'required' || key === 'enum' || key === 'const' ||
      key === 'additionalProperties' || key === 'description' || key === 'title' || key === 'default' || key === 'examples' || key === 'oneOf') {
      if (key === 'oneOf') out.oneOf = (value as unknown[]).map(convertSchemaNode);
      else out[key] = value;
    } else {
      throw new Error(`gtfa: unsupported tool parameter keyword "${key}"`);
    }
  }
  return out;
}

/** Convert the shared Zod schema into the raw JSON Schema subset dsh enforces. */
export function dshParameters(schema: z.ZodType<unknown>): Record<string, unknown> {
  return convertSchemaNode(z.toJSONSchema(schema, { io: 'input', target: 'draft-7' }));
}

/** Register the four native gtfa tools and the optional gtfa skill on one Cordis context. */
export async function register(ctx: DshContext, config: GtfaConfig = {}, overrides: RegisterOverrides = {}) {
  const envBaselines = overrides.baselines !== undefined ? overrides.baselines : await loadBaselinesFromEnv();
  // Validate at boot; the same resolved values are read again on every tool call so
  // dsh's volatile settings take effect without remounting the plugin.
  resolveGtfaSettings(config, envBaselines);
  const settings = () => resolveGtfaSettings(config, envBaselines);
  const oauth = overrides.oauth ?? createApifyOAuthManager({
    credentials: () => credentialsFromContext(ctx),
    ...(overrides.oauthFetch ? { fetch: overrides.oauthFetch } : {}),
  });
  if (typeof ctx.effect === 'function') ctx.effect(() => () => oauth.dispose());
  const transport = overrides.transport ?? createDefaultTransport();
  const onDemand = new OnDemandActorClient(overrides.onDemand);
  const tools = createTools({
    transport,
    minIntervalMs: overrides.minIntervalMs ?? 1500,
  });
  const execute = async (tool: GtfaTool, input: Record<string, unknown>, current: GtfaRuntimeSettings,
    signal?: AbortSignal, progress?: (phase: QueryPhase) => void, started?: (id: string) => void): Promise<Record<string, unknown>> => {
    throwIfAborted(signal);
    progress?.('requesting');
    const snapshot = tool.name === 'trends_snapshot';
    const calibrates = snapshot || tool.name === 'trends_ask' && input.validate === true;
    const filter = volumeFilter(String(input.geo ?? current.geo), String(input.time ?? 'now 1-d'));
    // A native snapshot reuses its anchor in the companion 7-day series.
    const referenceTime = snapshot ? 'now 7-d' : filter.time;
    const pin = snapshot && typeof input.anchor === 'string' ? { ...current, anchor: input.anchor } : current;
    const refs = calibrates ? volumeReferences(filter, pin, referenceTime) : undefined;
    const automatic = refs ? mekaDefaultAnchor(filter.geo, referenceTime) : undefined;
    const reference = refs && (refs.pinned ? refs.lookup(refs.pinned)
      : refs.lookup(automatic?.term ?? '') ?? refs.available.at(Math.floor((refs.available.length - 1) / 2)));
    const relative = calibrates && !reference;
    // Comparing a term with itself preserves its raw series on older Actors.
    const anchor = refs ? reference?.term ?? refs.pinned ?? String(input.term) : current.anchor;
    const queryInput = snapshot ? { ...input, anchor, ...(!input.tz && process.env.GTFA_TZ ? { tz: process.env.GTFA_TZ } : {}) } : input;
    const executionSettings = { defaultGeo: current.geo, anchor,
      baselines: reference ? { version: 2 as const, anchors: [reference] } : current.baselines,
      cache: current.cache, snapshotDir: current.snapshotDir, chartDir: relative ? null : current.chartDir,
    };
    let result: Record<string, unknown>;
    if (current.egress !== 'local' && !overrides.transport) {
      const resolved = await oauth.resolveToken(current.apifyToken);
      if (!resolved.token) {
        const rejected = invalidInputEnvelope(resolved.message ?? 'Sign in with Apify to run an Actor query.');
        return { ...rejected, error: { ...rejected.error, code: resolved.code === 'network' ? 'NETWORK_ERROR' : 'INVALID_INPUT' } };
      }
      result = await callActorTool(onDemand, {
        token: resolved.token, actorId: current.egress === 'actor-public' ? GTFA_PUBLIC_ACTOR_ID : current.apifyActor ?? '',
        name: tool.name, input: queryInput, settings: executionSettings, signal, progress, started,
      });
    } else {
      result = await tool.execute(queryInput, { signal, settings: executionSettings });
    }
    return relative ? relativeDshResult(result, snapshot, filter.geo) : result;
  };
  const run = async (tool: GtfaTool, args: unknown, signal: AbortSignal | undefined, source: QueryRecord['source'], progress?: (phase: QueryPhase) => void) => {
    throwIfAborted(signal);
    const current = settings(), startedAt = Date.now();
    const parsed = tool.inputSchema.safeParse(args ?? {});
    if (!parsed.success) return zodRejectionEnvelope(parsed.error);
    const input = parsed.data as Record<string, unknown>;
    if (tool.name === 'trends_compare' && findDuplicateKeyword(input.keywords as string[])) return invalidInputEnvelope('Compare keywords must be distinct.');
    const single = source === 'manual' && tool.name === 'trends_snapshot';
    const actorIds: string[] = [];
    let result: Record<string, unknown>;
    try {
      if (single) {
        const filter = volumeFilter(String(input.geo ?? current.geo), String(input.time ?? 'now 1-d'));
        const previous = await new QueryHistoryStore(current.snapshotDir).previousCalibration(String(input.term), filter.geo, filter.time).catch(() => null);
        result = await singleVolume(input, current, previous, (name, args) =>
          execute(tools.find(t => t.name === name)!, args, current, signal, progress, id => actorIds.push(id)), () => progress?.('calibrating'));
      } else {
        result = await execute(tool, input, current, signal, progress);
        if (source === 'manual') result = { ...result, onDemand: true };
      }
      throwIfAborted(signal);
    } catch (error) {
      result = { ok: false, schemaVersion: 1, status: 'error', meta: { fetchedAt: new Date().toISOString() },
        error: { code: signal?.aborted ? 'CANCELLED' : error instanceof GTrendsError ? error.code : 'NETWORK_ERROR',
          message: signal?.aborted ? 'Query cancelled.' : error instanceof GTrendsError ? error.message : 'Query did not complete.' } };
    }
    try {
      progress?.('saving');
      const calibration = row(result.calibration), reading = rows(calibration.series)[0];
      const hasEstimate = Boolean(reading?.anchor || reading?.range);
      const rounds = Array.isArray(calibration.rounds) ? calibration.rounds.length : 1;
      const singleVolumeStats: QueryRecord['singleVolume'] = single && current.egress !== 'local' ? {
        calls: actorIds.length, hit: hasEstimate ? rounds === 1 ? 'first' : 'second' : 'none',
      } : undefined;
      const retry = row(row(result.meta).calibrationRetry);
      const primaryId = row(result.meta).cached ? undefined : row(result.meta).actorRunId;
      const volumeRuns = actorIds.filter(id => id !== primaryId).map(id => ({
        actorRunId: id, createdAt: new Date(startedAt).toISOString(),
        costUsd: retry.actorRunId === id && typeof retry.actorUsageUsd === 'number' ? retry.actorUsageUsd : null,
      }));
      const record = await new QueryHistoryStore(current.snapshotDir).save({ tool: tool.name, input, result, source, singleVolume: singleVolumeStats, volumeRuns, egress: current.egress, defaultGeo: current.geo, startedAt });
      const meta = result.meta && typeof result.meta === 'object' ? result.meta as Record<string, unknown> : {};
      result = { ...result, meta: { ...meta, queryRecordId: record.id } };
    } catch {
      const meta = result.meta && typeof result.meta === 'object' ? result.meta as Record<string, unknown> : {};
      result = { ...result, meta: { ...meta, warnings: [...(Array.isArray(meta.warnings) ? meta.warnings : []), 'Local query history could not be saved.'] } };
    }
    throwIfAborted(signal);
    return result;
  };
  for (const tool of tools) {
    ctx.tools.register({
      name: tool.name,
      description: tool.description.replace(REGIONAL_CALIBRATION_GUIDANCE,
        `dsh uses regional Google Ads baselines from ${MEKA_BASELINES_URL} for estimated searches/day. Explicit anchor and baseline overrides take priority. Sparse samples retain null traffic.`),
      parameters: dshParameters(tool.inputSchema),
      output: {
        schema: { type: 'object' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) ?? '{}' }],
      },
      async execute(args: unknown, exec: { signal?: AbortSignal }) {
        return run(tool, args, exec.signal, 'agent');
      },
    });
  }
  registerSkill(ctx);
  const localTransport = overrides.routes?.localTransport ?? overrides.transport;
  registerRoutes(ctx, settings, {
    oauth,
    dashboard: {
      settings,
      execute: (name, input, signal, progress) => run(tools.find(tool => tool.name === name)!, input, signal, 'manual', progress),
      batch: async (saved, requestId, signal, progress, publish) => {
        const current = settings(), tool = tools.find(t => t.name === 'trends_compare')!;
        const history = new QueryHistoryStore(current.snapshotDir);
        return estimateBatch(saved, current, requestId, keywords => execute(tool, {
          keywords, geo: saved.record.geo, time: saved.record.time, timeoutMs: 60000,
        }, current, signal, progress), publish, term => current.cache
          ? history.previousCalibration(term,saved.record.geo,saved.record.time) : Promise.resolve(null));
      },
      estimate: async (saved, term, requestId, startedAt, egress, signal, progress) => {
        const current = { ...settings(), egress };
        const request = estimateRequest(saved, term, current);
        if (!request) return undefined;
        const tool = tools.find(tool => tool.name === 'trends_compare')!;
        const input = tool.inputSchema.parse({
          keywords: [request.keyword, ...request.references.map(anchor => anchor.term)],
          geo: request.filter.geo, time: request.filter.time, timeoutMs: 60000,
        }) as Record<string, unknown>;
        const result = await execute(tool, input, current, signal, progress);
        progress('calibrating');
        return finishEstimate(request, result, egress, requestId, new Date(startedAt).toISOString());
      },
      restore: async (saved, check, signal) => {
        if (!check.actorRunId) return undefined;
        const current = settings();
        const { token } = await oauth.resolveToken(current.apifyToken);
        if (!token) return undefined;
        const output = await onDemand.readCompletedResult(token, check.actorRunId, signal);
        return restoreEstimateBand(saved, check, output, current);
      },
    },
    ...(overrides.routes?.fetch ? { fetch: overrides.routes.fetch } : {}),
    ...(localTransport ? { localTransport } : {}),
    ...(overrides.routes?.relayTransport ? { relayTransport: overrides.routes.relayTransport } : {}),
    ...(overrides.routes?.actorOptions ? { actorOptions: overrides.routes.actorOptions } : {}),
    ...(overrides.routes?.now ? { now: overrides.routes.now } : {}),
  });
}

/** Cordis entrypoint. */
export async function apply(ctx: DshContext, config: GtfaConfig = {}) {
  await register(ctx, config);
}
