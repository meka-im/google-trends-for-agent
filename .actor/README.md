# Google Trends for AI Agents — On-demand

Open-source Google Trends search interest, comparisons, calibrated searches/day estimates and trending searches. Each query starts a bounded run and exits when finished. No Actor-owned MCP server or idle service is used. Platform compute, proxy and storage usage apply; there is no Actor fee.

## Quick start

Use the Input tab, then Start:

```json
{
  "tool": "snapshot",
  "terms": ["Sora"],
  "geo": "US",
  "window": "now 1-d",
  "anchor": ""
}
```

### MCP client

Use Apify's managed MCP gateway. It handles OAuth without starting this Actor just to keep an MCP connection open:

```json
{
  "mcpServers": {
    "google-trends": {
      "url": "https://mcp.apify.com?tools=meka.im/google-trends-for-agent"
    }
  }
}
```

The gateway exposes the Actor's input interface plus run, Dataset, key-value-store and abort tools. It does not promise four direct `trends_*` tools. Local MCP and the dsh native plugin retain those four tools. Apify's OAuth scope is account-wide `full_api_access`; authorize through the client's official Apify login. Clients without OAuth can supply a Bearer header from credential storage.

The previous `*.apify.actor/mcp` interface was retired in 0.2.7 after long-lived MCP connections prevented idle shutdown. Keep Server / Standby disabled. This Actor rejects Standby startup before opening any listener.

## Inputs

- `tool`: `ask`, `snapshot`, `compare`, or `now`.
- `terms`: one or more terms for ask/snapshot, 1–5 distinct terms for compare; ignored by now.
- `geo`: supported country code; `WORLDWIDE` is accepted except for now.
- `window`: a supported Trends time window, default `now 1-d`.
- `anchor`: automatic when blank, or built-in `gpts` / `sudoku`.
- `timeoutMs`: optional 1000–60000 ms per upstream request.
- `proxyConfiguration`: defaults to the on-platform US residential proxy.

Ordinary input executes one tool, writes Dataset v1 rows and an `OUTPUT` record, then exits. Now writes at most 25 rows. Later ask/snapshot terms are skipped after a block or rate limit. A failed or partial run still has real platform costs.

## Dataset v1

The existing flat row contract is unchanged: `term`, `tool`, `geo`, `window`, `status`, `interestLatest`, `interestSettled`, `interestAverage`, `interestPeak`, `searchesPerDay`, `verdict`, `anchor`, `topRelated`, `topRising`, `chartKey`, `chartUrl`, `error`, `fetchedAt`. Related fields are string arrays, so there is no per-related-query `estDaily` in Dataset v1. Missing values remain null. Charts are stored under `chart-*` in the run's key-value store; read them through the authenticated API.

`OUTPUT` reports completed/partial/failed plus delivered, noData, blocked, skipped, errors and duration. Dataset rows, successful native tool calls and MCP sessions have different denominators: do not divide all Actor costs by Dataset rows to estimate cost per query.

## Native tool request protocol

The dsh plugin submits one complete tool request per run:

```json
{
  "toolRequest": {
    "protocol": 1,
    "name": "trends_snapshot",
    "input": { "term": "ChatGPT", "geo": "US", "time": "now 1-d", "svg": true },
    "settings": { "cache": true, "charts": true }
  }
}
```

`name` accepts the four `trends_*` names. Read `TOOL_RESPONSE` from the run's key-value store: `{ protocol: 1, result, snapshots }`. `result` preserves the full tool envelope, including related-query null fields, calibration warnings and inline SVG. Validated optional history preserves snapshot diffs across runs. The local plugin handles six-hour result reuse and local chart files. Credentials and local filesystem paths are never part of this input. This additive protocol does not change Dataset v1; native requests may have zero Dataset rows.

## Runtime and cost bounds

Default memory is 256 MB and default timeout is 300 seconds. dsh sends these bounds explicitly for every run. The client starts once, polls the run and reads its result. It does not retry an ambiguous start POST. Cancellation attempts to abort the owned run; if the network is unavailable, the platform timeout remains the bound. Local snapshot-cache hits and API metadata checks start no run. Builds have their own platform cost.

Do not reuse the former Standby cost estimate as an on-demand price. Inspect finished runs' `usageTotalUsd`; see [cost details](../docs/reference.md#actor-costs) and [historical measurements](../docs/standby-costs-2026-11-13.md).

## Data boundaries

Searches/day are anchor-calibrated estimates, not measured Google volume. Sparse or unavailable calibration returns null with a warning. Snapshot related-query `estDaily` remains null in native envelopes. Built-in baselines cover the US; other countries require a suitable baseline. On `BLOCKED`, stop. On `RATE_LIMITED`, respect the indicated backoff and keep retries bounded. Use this for light interactive research.

The project is unofficial and is not affiliated with Google. [Source and local usage](../README.md), [MCP field guide](../docs/mcp-api.md), [reference](../docs/reference.md).
