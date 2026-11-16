import { z } from 'zod';
import { createTools, invalidInputEnvelope, zodRejectionEnvelope, type GtfaTool, type ToolLiveSettings } from './tools.js';
import { SnapshotStore, type TermSnapshot } from './snapshot.js';
import { defaultAnchorFor, parseBaselines } from './traffic.js';
import { normalizeGeo } from './options.js';
import { CONNECTION_PROBE_PROTOCOL } from './connection-check.js';

export const ACTOR_RESPONSE_KEY = 'TOOL_RESPONSE';
export const ACTOR_REQUEST_PROTOCOL = 1;
const point = z.object({ time: z.string(), value: z.number().finite() });
// SnapshotStore incorporates the id and timestamp in a filename. Validate these
// before accepting history from a caller or saving remote history locally.
export const storedSnapshotSchema = z.object({
  schema: z.literal('term-snapshot/1'), id: z.uuid(), term: z.string().min(1).max(100),
  fetchedAt: z.string().datetime(), status: z.enum(['ok', 'no_data', 'partial', 'blocked', 'error']),
  filter: z.object({ geo: z.string(), time: z.string(), category: z.number(), property: z.string(), hl: z.string().optional() }),
  error: z.object({ code: z.string(), message: z.string(), retryAfterSec: z.number().optional() }).optional(),
  warnings: z.array(z.string()).optional(),
  interest: z.object({ points: z.array(point).max(10000), latest: z.number(), peak: z.number(), settledLatest: z.number() }),
  anchor: z.object({ term: z.string(), points: z.array(point).max(10000) }).optional(),
  popular: z.array(z.object({ rank: z.number(), query: z.string(), value: z.number() })),
  rising: z.array(z.object({ rank: z.number(), query: z.string(), value: z.number(), formattedValue: z.string().optional(), breakout: z.boolean() })),
  regions: z.array(z.object({ rank: z.number(), code: z.string(), name: z.string(), value: z.number() })),
});
const requestSchema = z.object({
  protocol: z.union([z.literal(ACTOR_REQUEST_PROTOCOL), z.literal(CONNECTION_PROBE_PROTOCOL)]),
  name: z.enum(['trends_ask', 'trends_compare', 'trends_now', 'trends_snapshot']),
  input: z.record(z.string(), z.unknown()),
  settings: z.object({
    defaultGeo: z.string().optional(), anchor: z.string().trim().min(1).max(100).optional(),
    baselines: z.unknown().optional(), cache: z.boolean().optional(), charts: z.boolean().optional(),
  }).default({}),
  history: z.array(storedSnapshotSchema).max(12).default([]),
}).refine(request => request.protocol !== CONNECTION_PROBE_PROTOCOL || request.name === 'trends_compare', 'Connection probes require trends_compare');

export type ActorToolRequest = z.input<typeof requestSchema>;

/** Execute exactly one native tool, without opening any HTTP or MCP listener. */
export async function runToolRequest(value: unknown, options: {
  snapshotDir: string; chartDir: string;
  create?: (settings: ToolLiveSettings) => GtfaTool[];
}) {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return { protocol: ACTOR_REQUEST_PROTOCOL, result: zodRejectionEnvelope(parsed.error), snapshots: [] };
  const request = parsed.data;
  const store = new SnapshotStore(options.snapshotDir);
  let settings: ToolLiveSettings;
  try {
    settings = {
      defaultGeo: normalizeGeo(request.settings.defaultGeo ?? 'US'),
      ...(request.settings.anchor ? { anchor: request.settings.anchor } : {}),
      ...(request.settings.baselines ? { baselines: parseBaselines(request.settings.baselines, 'Actor request baselines') } : {}),
      cache: request.settings.cache ?? true, snapshotDir: options.snapshotDir,
      chartDir: request.settings.charts === false ? null : options.chartDir,
    };
  } catch {
    return { protocol: ACTOR_REQUEST_PROTOCOL, result: invalidInputEnvelope('Invalid Actor query settings.'), snapshots: [] };
  }
  for (const snapshot of request.history) await store.save(snapshot as TermSnapshot);
  const tools = options.create?.(settings) ?? createTools({ ...settings, settings: () => settings });
  const tool = tools.find(candidate => candidate.name === request.name)!;
  const result = request.protocol === CONNECTION_PROBE_PROTOCOL
    ? await tool.execute(request.input, { maxRetries: 0 }) : await tool.execute(request.input);
  const snapshots: TermSnapshot[] = [];
  if (typeof request.input.term === 'string' && result.filter && typeof result.filter === 'object') {
    const filter = { ...result.filter as Record<string, unknown> };
    if (filter.property === 'web') filter.property = '';
    for (const range of [filter.time, 'now 7-d']) {
      for (const anchor of [undefined, defaultAnchorFor(String(range), settings.baselines, String(filter.geo ?? 'US')), 'gpts', 'sudoku', request.settings.anchor, request.input.anchor, settings.baselines?.windowAnchors?.short, settings.baselines?.windowAnchors?.long]) {
        const history = await store.history(request.input.term, { ...filter, time: range } as never, 2, typeof anchor === 'string' ? anchor : undefined);
        for (const snapshot of history) if (!snapshots.some(row => row.id === snapshot.id)) snapshots.push(snapshot);
      }
    }
  }
  return { protocol: request.protocol, result, snapshots: snapshots.slice(0, 12) };
}
