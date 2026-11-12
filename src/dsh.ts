import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createTools } from './tools.js';
import { createEgressTransport, type EgressMode, type EgressOptions } from './egress.js';
import { loadBaselinesFromEnv, type Baselines } from './traffic.js';
import type { Transport } from './transport.js';

/** Cordis plugin name. */
export const name = 'gtfa';
/** Tools are the only required service; skills is attached opportunistically. */
export const inject = ['tools'];

export interface GtfaConfig {
  /** `local` sends Google requests from this machine; `apify` uses Apify Residential proxy. */
  egress?: EgressMode;
  /** Residential proxy country for apify egress (default US). */
  apifyProxyCountry?: string;
  /** Snapshot directory, resolved against the dsh process working directory. */
  snapshotDir?: string;
  /** Chart directory, or null to disable chart files. */
  chartDir?: string | null;
  /** Default geo for trends_ask/trends_compare/trends_snapshot. */
  geo?: string;
  /** Optional anchor override for validate/snapshot. */
  anchor?: string;
}

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
  const egress = config.egress ?? 'local';
  if (egress !== 'local' && egress !== 'apify') throw new Error(`gtfa: unsupported egress "${String(egress)}"; use "local" or "apify"`);
  const country = config.apifyProxyCountry?.trim() || 'US';
  const baselines = overrides.baselines !== undefined ? overrides.baselines : await loadBaselinesFromEnv();
  const transport = overrides.transport ?? createEgressTransport({
    ...overrides.egress,
    egress,
    apifyProxyCountry: country,
  });
  const tools = createTools({
    transport,
    snapshotDir: config.snapshotDir?.trim() || '.gtfa/snapshots',
    chartDir: config.chartDir === null ? null : config.chartDir?.trim() || '.gtfa/charts',
    defaultGeo: config.geo?.trim() || undefined,
    anchor: config.anchor?.trim() || undefined,
    baselines,
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
        exec.signal?.throwIfAborted();
        const result = await tool.execute(args, { signal: exec.signal });
        exec.signal?.throwIfAborted();
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
