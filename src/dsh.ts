import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createTools } from './tools.js';
import { createEgressTransport, type EgressMode, type EgressOptions } from './egress.js';
import { BUILTIN_ANCHORS, loadBaselinesFromEnv, parseBaselines, type Anchor, type Baselines, type WindowAnchors } from './traffic.js';
import {
  APIFY_PROXY_GROUPS, DEFAULT_APIFY_PROXY_GROUP, DEFAULT_GEO, DEFAULT_PROXY_COUNTRY, GEO_CODES, PROXY_COUNTRY_CODES,
  normalizeApifyProxyGroup, normalizeGeo, normalizeProxyCountry, type ApifyProxyGroup,
} from './options.js';
import { throwIfAborted, type Transport } from './transport.js';

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
  /** `local` sends Google requests from this machine; `apify` uses Apify proxy. */
  egress?: EgressMode;
  /** Apify API token; saved in the profile's cordis.patch.yml and hidden from reads. */
  apifyToken?: string;
  /** Apify proxy mode used by `apify` egress (default RESIDENTIAL). */
  apifyProxyGroup?: ApifyProxyGroup;
  /** Apify proxy country for apify egress (default US). */
  apifyProxyCountry?: string;
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
      geo: Schema.string().default('US').description('Country code for this anchor.'),
      dailySearches: Schema.transform(Schema.number().required(), (value: number) => {
        if (!(value > 0)) throw new Error('dailySearches must be a positive number');
        return value;
      }).description('Estimated daily searches for the anchor; must be positive.'),
      tolerance: Schema.number().min(0).max(1).description('Allowed ± fraction, for example 0.5.'),
    })).default([]).description('Override or add anchors; an empty list keeps the built-in US baselines.'),
    windowAnchors: Schema.object({
      short: Schema.string().description('Anchor term for now 1-H, now 4-H, and now 1-d.'),
      long: Schema.string().description('Anchor term for now 7-d and longer windows.'),
    }).default({}).description('Optional automatic anchor term per window.'),
  }), (value: unknown) => {
    // Keep this callback self-contained: dsh serializes transform callbacks to the
    // browser settings form, where this module's imports are not in scope.
    const row = (value ?? {}) as { anchors?: Array<{ term?: unknown }> | null; windowAnchors?: Record<string, unknown> | null };
    const terms = new Set(['gpts', 'sudoku']);
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
    egress: Schema.union(['local', 'apify']).default('local')
      .description('local sends Google requests from the dsh machine; apify uses the Apify proxy.').volatile(),
    apifyToken: Schema.string().role('secret')
      .description('Apify API token. Saved in the profile cordis.patch.yml (hidden in the UI, never logged or returned); leave blank and set APIFY_TOKEN to keep it out of the profile.').volatile(),
    // Plain constant unions only: transform callbacks are re-evaluated in the browser.
    apifyProxyGroup: Schema.union([...APIFY_PROXY_GROUPS]).default(DEFAULT_APIFY_PROXY_GROUP)
      .description('Apify proxy mode: RESIDENTIAL for residential IPs, or auto for automatic datacenter selection.').volatile(),
    apifyProxyCountry: Schema.union([...PROXY_COUNTRY_CODES]).default(DEFAULT_PROXY_COUNTRY)
      .description('Apify proxy country from the built-in list.').volatile(),
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
}

export interface RegisterOverrides {
  /** Test seam: use a fixture transport instead of the configured egress. */
  transport?: Transport;
  /** Test seam: override Apify credentials/transport construction. */
  egress?: EgressOptions;
  /** Test seam: provide baselines instead of reading GTFA_BASELINES. */
  baselines?: Baselines;
  /** Test seam: request spacing; production uses 1500 ms like MCP. */
  minIntervalMs?: number;
}

/** Runtime values after unwrapping dsh's volatile refs and applying defaults. */
export interface GtfaRuntimeSettings {
  egress: EgressMode;
  apifyToken?: string;
  apifyProxyGroup: ApifyProxyGroup;
  apifyProxyCountry: string;
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
    anchors: anchors.length ? anchors.map(anchor => ({ ...anchor, geo: anchor.geo?.trim() || 'US' })) : [...BUILTIN_ANCHORS],
    ...(hasWindow ? { windowAnchors: windows } : {}),
  }, 'dsh baselines');
}

/** Normalize one config object (plain or volatile) into the values the tools read per call. */
export function resolveGtfaSettings(config: GtfaConfig, envBaselines?: Baselines): GtfaRuntimeSettings {
  const egress = read(config.egress) ?? 'local';
  if (egress !== 'local' && egress !== 'apify') throw new Error(`gtfa: unsupported egress "${String(egress)}"; use "local" or "apify"`);
  const apifyProxyGroup = normalizeApifyProxyGroup(read(config.apifyProxyGroup) ?? DEFAULT_APIFY_PROXY_GROUP);
  const apifyProxyCountry = normalizeProxyCountry(read(config.apifyProxyCountry) ?? DEFAULT_PROXY_COUNTRY);
  const geo = normalizeGeo(read(config.geo) ?? DEFAULT_GEO);
  const chartDirValue = read(config.chartDir);
  const charts = read(config.charts) ?? chartDirValue !== null;
  const baselines = baselinesFromConfig(read(config.baselines)) ?? envBaselines;
  return {
    egress,
    ...(read(config.apifyToken)?.trim() ? { apifyToken: read(config.apifyToken)!.trim() } : {}),
    apifyProxyGroup,
    apifyProxyCountry,
    geo,
    ...(read(config.anchor)?.trim() ? { anchor: read(config.anchor)!.trim() } : {}),
    ...(baselines ? { baselines } : {}),
    cache: read(config.cache) ?? true,
    snapshotDir: read(config.snapshotDir)?.trim() || '.gtfa/snapshots',
    chartDir: charts === false || chartDirValue === null ? null : chartDirValue?.trim() || '.gtfa/charts',
  };
}

/** Rebuild the egress transport only when its connection-relevant settings change. */
function createLiveTransport(get: () => GtfaRuntimeSettings, overrides?: EgressOptions): Transport {
  let current: Transport | undefined;
  let key = '';
  return async request => {
    const settings = get();
    const next = JSON.stringify([settings.egress, settings.apifyToken ?? null, settings.apifyProxyGroup, settings.apifyProxyCountry]);
    if (!current || next !== key) {
      current = createEgressTransport({
        ...overrides,
        egress: settings.egress,
        apifyToken: settings.apifyToken,
        apifyProxyGroup: settings.apifyProxyGroup,
        apifyProxyCountry: settings.apifyProxyCountry,
      });
      key = next;
    }
    return current(request);
  };
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
  const transport = overrides.transport ?? createLiveTransport(settings, overrides.egress);
  const tools = createTools({
    transport,
    settings: () => {
      const snapshot = settings();
      return {
        defaultGeo: snapshot.geo,
        anchor: snapshot.anchor,
        baselines: snapshot.baselines,
        cache: snapshot.cache,
        snapshotDir: snapshot.snapshotDir,
        chartDir: snapshot.chartDir,
      };
    },
    minIntervalMs: overrides.minIntervalMs ?? 1500,
  });
  for (const tool of tools) {
    ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: dshParameters(tool.inputSchema),
      output: {
        schema: { type: 'object' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) ?? '{}' }],
      },
      async execute(args: unknown, exec: { signal?: AbortSignal }) {
        throwIfAborted(exec.signal);
        const result = await tool.execute(args, { signal: exec.signal });
        throwIfAborted(exec.signal);
        return result;
      },
    });
  }
  registerSkill(ctx);
}

/** Cordis entrypoint. */
export async function apply(ctx: DshContext, config: GtfaConfig = {}) {
  await register(ctx, config);
}
