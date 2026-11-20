import { OnDemandActorClient, callActorTool, type OnDemandOptions } from './actor-on-demand.js';
import { resolveApifyApiToken } from './apify-actor.js';
import { mekaDefaultAnchor } from './dsh-baselines.js';
import { relativeDshResult, volumeFilter, volumeReferences } from './dashboard-volume.js';
import { DEFAULT_GEO, GTFA_PUBLIC_ACTOR_ID, normalizeGeo, resolveEgress, type EgressMode } from './options.js';
import { invalidInputEnvelope, type GtfaTool, type ToolLiveSettings } from './tools.js';
import type { Baselines } from './traffic.js';

export interface EgressOptions {
  egress?: EgressMode;
  apifyToken?: string;
  apifyActor?: string;
  defaultGeo?: string;
  anchor?: string;
  baselines?: Baselines;
  cache?: boolean;
  snapshotDir?: string;
  chartDir?: string | null;
  onDemand?: OnDemandOptions;
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedRuntimeEgress {
  egress: EgressMode;
  apifyToken?: string;
  apifyActor?: string;
}

/** Resolve CLI / MCP egress settings from explicit options and environment variables. */
export function resolveRuntimeEgress(
  options: Pick<EgressOptions, 'egress' | 'apifyToken' | 'apifyActor' | 'env'> = {},
): ResolvedRuntimeEgress {
  const env = options.env ?? process.env;
  const rawEgress = options.egress ?? env.GTFA_EGRESS;
  const { egress } = resolveEgress(rawEgress);
  const resolvedToken = resolveApifyApiToken(options.apifyToken, env);
  const actor = (options.apifyActor ?? env.GTFA_APIFY_ACTOR ?? env.APIFY_ACTOR)?.trim() || undefined;
  return {
    egress,
    ...(resolvedToken.token ? { apifyToken: resolvedToken.token } : {}),
    ...(actor ? { apifyActor: actor } : {}),
  };
}

/**
 * Wrap the four shared tools so MCP, CLI, and Library callers can route through
 * Apify `actor-public` or `actor-own` with the exact same semantics as dsh.
 */
export function wrapToolsWithEgress(tools: GtfaTool[], options: EgressOptions = {}): GtfaTool[] {
  const resolved = resolveRuntimeEgress(options);
  if (resolved.egress === 'local') return tools;
  const onDemand = new OnDemandActorClient(options.onDemand);
  const defaultGeo = options.defaultGeo !== undefined ? normalizeGeo(options.defaultGeo) : DEFAULT_GEO;
  const snapshotDir = options.snapshotDir?.trim() || '.gtfa/snapshots';
  const chartDir = options.chartDir !== undefined ? options.chartDir : '.gtfa/charts';
  const cache = options.cache ?? true;

  return tools.map(tool => ({
    ...tool,
    async execute(raw, context) {
      const parsed = tool.inputSchema.safeParse(raw ?? {});
      if (!parsed.success) return tool.execute(raw, context);
      const input = parsed.data as Record<string, unknown>;
      const live: ToolLiveSettings = context?.settings ?? {};
      const token = resolved.apifyToken;
      if (!token) {
        return invalidInputEnvelope(
          `Egress "${resolved.egress}" requires APIFY_TOKEN (or apifyToken option).`,
        );
      }
      const actorId = resolved.egress === 'actor-public'
        ? GTFA_PUBLIC_ACTOR_ID
        : resolved.apifyActor ?? '';
      if (!actorId) {
        return invalidInputEnvelope(
          'Egress "actor-own" requires --actor or GTFA_APIFY_ACTOR.',
        );
      }
      const geo = live.defaultGeo !== undefined ? live.defaultGeo : defaultGeo;
      const snapshot = tool.name === 'trends_snapshot';
      const calibrates = snapshot || (tool.name === 'trends_ask' && input.validate === true);
      const filter = volumeFilter(String(input.geo ?? geo), String(input.time ?? 'now 7-d'));
      const referenceTime = snapshot ? 'now 7-d' : filter.time;
      const anchorPin = (snapshot && typeof input.anchor === 'string' ? input.anchor : undefined) ?? live.anchor ?? options.anchor;
      const activeBaselines = live.baselines ?? options.baselines;
      const refs = calibrates ? volumeReferences(filter, { geo: filter.geo, anchor: anchorPin, baselines: activeBaselines }, referenceTime) : undefined;
      const automatic = refs ? mekaDefaultAnchor(filter.geo, referenceTime) : undefined;
      const reference = refs && (refs.pinned ? refs.lookup(refs.pinned)
        : refs.lookup(automatic?.term ?? '') ?? refs.available.at(Math.floor((refs.available.length - 1) / 2)));
      const relative = calibrates && !reference;
      const anchor = refs ? reference?.term ?? refs.pinned ?? String(input.term) : anchorPin;
      const queryInput = snapshot
        ? { ...input, anchor, ...(!input.tz && process.env.GTFA_TZ ? { tz: process.env.GTFA_TZ } : {}) }
        : input;
      const result = await callActorTool(onDemand, {
        token,
        actorId,
        name: tool.name,
        input: queryInput,
        settings: {
          defaultGeo: geo,
          anchor,
          baselines: reference ? { version: 2 as const, anchors: [reference] } : activeBaselines,
          cache: live.cache ?? cache,
          snapshotDir: live.snapshotDir ?? snapshotDir,
          chartDir: relative ? null : (live.chartDir !== undefined ? live.chartDir : chartDir),
        },
        signal: context?.signal,
      });
      return relative ? relativeDshResult(result, snapshot, filter.geo) : result;
    },
  }));
}
