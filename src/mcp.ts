import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTools, schemaRejectionEnvelope, type ToolsOptions } from './tools.js';
import { combineRequestSignals, currentRequestSignal } from './request-context.js';
import { VERSION } from './version.js';

function response(result: { ok: boolean } & Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result, ...(result.ok ? {} : { isError: true }) };
}

/** Creates an unconnected server. options.transport injects HTTP, not MCP, transport. */
export function createServer(options: ToolsOptions = {}): McpServer {
  const tools = createTools(options);
  const server = new McpServer({ name: 'google-trends-for-agent', version: VERSION }, { instructions: 'Four tools. trends_ask, trends_compare and trends_snapshot share defaults geo=US, time=now 1-d, web search, all categories; trends_now defaults to a 30-country set and hours=24. trends_ask: one term -> interest, popular + rising related queries, regions, diff vs previous snapshot; validate=true adds a verdict with the same automatic anchor. trends_compare: 2-5 keywords relative interest (e.g. a candidate vs an anchor). trends_now: Trending Now by country. trends_snapshot: one term + a shared-scale anchor -> calibrated searches/day estimate, traffic series, related queries, verdict and a chart file path (inline SVG with svg=true; chart labels use UTC unless tz or GTFA_TZ selects another IANA zone). The anchor is automatic by window: sudoku (US 63,000/day) for now 1-H/now 4-H/now 1-d, gpts (US 3,500/day) for now 7-d and longer; an explicit anchor overrides both windows. It always returns a now 7-d curve as chart7d/traffic7d plus anchor7d for that window. Traffic fields are null without matching calibration or when the anchor is too sparse/weak. trends_ask omits full interest.points by default (set points=true); trends_snapshot omits inline SVG text by default (set svg=true). Every tool result has ok, schemaVersion, status, error? and meta; arguments rejected by schema validation return the same envelope with ok:false and error.code INVALID_INPUT. Report no_data/blocked honestly; never invent volumes; verdict.traffic is searches/day and is null (无法估) without calibration. trends_ask/trends_snapshot share the calibration formula traffic = score / anchorLevel * dailySearches with a sparse-anchor gate.' });
  // SDK schema failures call createToolError before our handlers; normalize to the shared envelope.
  (server as unknown as { createToolError: (message: string) => object }).createToolError = (message: string) => {
    const result = schemaRejectionEnvelope(message);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result, isError: true };
  };
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args: unknown, extra) => {
      const signal = combineRequestSignals(extra?.signal, currentRequestSignal());
      return response(await tool.execute(args, signal ? { signal } : undefined) as { ok: boolean } & Record<string, unknown>);
    });
  }
  return server;
}
