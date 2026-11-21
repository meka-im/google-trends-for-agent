# Muse, GrokBot and Dots

**Use Apify on demand by default for all three clients**, with either the public
Actor or your own deployment. This keeps Google Trends requests on the Actor's
network rather than the client's VM or machine. Apify can still be challenged or
rate-limited; it is not a guarantee of access. Local CLI/stdio remains an option
for development or when the user explicitly chooses direct access.

## Choose an Actor

| Deployment | Actor | Managed MCP URL |
| --- | --- | --- |
| Public, no deployment needed | `meka.im/google-trends-for-agent` | `https://mcp.apify.com?tools=meka.im/google-trends-for-agent` |
| Your own, after a successful build | Your account's `<username>/<actor-name>` | `https://mcp.apify.com?tools=<username>/<actor-name>` |

Replace both placeholders for your deployment; the signed-in account must have
access to it. Keep Server / Standby disabled. Both choices run queries on demand
and charge compute, proxy and storage usage to the caller's Apify account. The
public Actor needs no deployment; self-deployments need their own builds and
updates. See [deployment](../README.md#deploy-it-yourself) and
[costs](reference.md#actor-costs).

The managed gateway excludes full-permission Actors. If your deployment has
that permission level, use the authenticated connector/API route; see
[Apify's eligibility rules](https://docs.apify.com/mcp#excluded-actors).

## Connect the client

| Client | Recommended connection | Acceptance evidence |
| --- | --- | --- |
| Muse | Use its authenticated Apify connector/API to run the selected Actor. Use the managed MCP URL if the Host exposes native remote MCP registration. | Record whether the call used a connector or a native registered tool. |
| GrokBot | Register the managed MCP URL as a native remote connection and sign in through Apify OAuth. | The connection is active and its Actor tool appears in the client's actual tool list. |
| Dots | Use the managed MCP URL in the client's available MCP configuration. The Codex CLI setup below applies where that CLI integration is available. | Verify the actual session's tool list; CLI acceptance alone does not establish GUI acceptance. |

Use the client's secure credential storage for a Bearer token only when OAuth
is unavailable. Apify's OAuth scope is account-wide `full_api_access`; the account
owner approves it. Never put a token in the server URL, prompt, or Actor input.
If native registration is unavailable, an Apify connector/API call is still the
recommended execution path; report it as such.

For clients accepting `mcpServers` JSON, use:

```json
{
  "mcpServers": {
    "google-trends-apify": {
      "url": "https://mcp.apify.com?tools=meka.im/google-trends-for-agent"
    }
  }
}
```

For the Codex CLI, register and authorize the remote server:

```sh
codex mcp add google-trends-apify --url 'https://mcp.apify.com?tools=meka.im/google-trends-for-agent'
codex mcp login google-trends-apify
```

Use your own deployment's URL in either example when selected. Follow the
client's registration format and open a fresh session after configuration.
See [Apify MCP configuration](https://docs.apify.com/mcp) and
[Codex MCP commands](https://learn.chatgpt.com/docs/developer-commands#codex-mcp).

## Call the Actor and read the result

The gateway exposes an Actor tool plus run/storage/abort helpers. Discover the
actual name with the client's tool list; it does not expose four direct
`trends_*` tools. A connector/API instead starts the same selected Actor through
the Apify platform. Neither path needs a local `gtfa-mcp` process.

For a simple summary, pass ordinary Actor input (defaults to `US`, `now 7-d`):

```json
{
  "tool": "snapshot",
  "terms": ["ChatGPT"],
  "geo": "US",
  "window": "now 7-d",
  "timeoutMs": 60000
}
```

Start once. If the run is still active, inspect that same run rather than
starting another. Read ordinary results from its Dataset and `OUTPUT` record;
read chart records from its key-value store. A `SUCCEEDED` run alone does not
prove that Google returned data: inspect result status, errors and `fetchedAt`.

For the full four-tool envelopes, limits and inline SVG, use the Actor's
`toolRequest` input instead. This also works through the gateway or a connector:

```json
{
  "toolRequest": {
    "protocol": 1,
    "name": "trends_snapshot",
    "input": {
      "term": "ChatGPT",
      "geo": "US",
      "time": "now 7-d",
      "fresh": true,
      "svg": true,
      "timeoutMs": 60000
    }
  }
}
```

Read `TOOL_RESPONSE` from that run's key-value store: `result` is the full tool
envelope and `runtime` reports its package/baseline versions. Native requests can
have zero Dataset rows. Change `name` and `input` using the
[four-tool field guide](mcp-api.md); for example `trends_now` takes
`geos: ["US"], hours: 24, limit: 3` in `input`, and `trends_compare` supports
`calibrate: true` for multi-tier MEKA `batchVolume` estimates.

## Local stdio MCP or CLI with Apify egress

If a client (such as Dots, Codex CLI, Claude Desktop, or a Muse/agent shell)
supports local stdio MCP or CLI commands and you want the four direct
`trends_*` tool names while still routing Google Trends requests through Apify's
residential proxy, pass `--egress actor-public` (or `--egress actor-own --actor <id>`)
with `APIFY_TOKEN` in the client's secure environment:

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "-p", "github:meka-im/google-trends-for-agent", "gtfa-mcp", "--egress", "actor-public"],
      "env": { "APIFY_TOKEN": "<your-apify-token>" }
    }
  }
}
```

CLI equivalents:

```sh
APIFY_TOKEN=... gtfa snapshot Sora --egress actor-public --json --pretty
APIFY_TOKEN=... gtfa compare Sora Veo --calibrate --egress actor-public --json
gtfa baselines --sync --json
```

Environment variables `GTFA_EGRESS` (`local` | `actor-public` | `actor-own`) and
`GTFA_APIFY_ACTOR` set the same routing defaults for both `gtfa` and `gtfa-mcp`.

Record the selected Actor, connection type, actual runtime, result status and
`fetchedAt` during acceptance. A handshake or tool list verifies connection only.
Stop that path after `BLOCKED` or `RATE_LIMITED`; do not switch deployments or
egress to route around it. Read null calibration values honestly. Cancel an
owned run when abandoning a call, and keep the Actor's 300-second runtime bound.
