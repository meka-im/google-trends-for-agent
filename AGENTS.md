# AGENTS.md

Guidance for AI agents using `google-trends-for-agent` (`gtfa`). It queries undocumented Google Trends web endpoints. Use it for light, interactive research only—not bulk scraping or continuous polling. It is unofficial and not affiliated with Google.

## Install from GitHub

Node.js 20+ is required. Nothing is published to npm; `npx` builds the package from the git checkout on first run.

```sh
# Pinned release (recommended)
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa --help

# Latest main
npx -y github:meka-im/google-trends-for-agent gtfa --help
```

The package installs two commands: `gtfa` (CLI) and `gtfa-mcp` (MCP server; stdio by default, or local Streamable HTTP with `--http --port 4321`). The first run may take longer while TypeScript builds; later runs use the npx cache. For a persistent install, use `npm install -g github:meka-im/google-trends-for-agent#v0.1.0`.

## MCP client config

Use this generic stdio configuration (swap `#v0.1.0` for no tag to follow main):

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "github:meka-im/google-trends-for-agent#v0.1.0", "gtfa-mcp"]
    }
  }
}
```

Restart the client, then call `trends_ask` with a single term. `trends_ask` and `trends_compare` default to US, past 24 hours, web search, all categories; `trends_now` defaults to 30 countries at 24h. `trends_snapshot` and `trends_ask` with `validate: true` pick a calibration anchor by window (see below).

## dsh plugin

```sh
dsh plugin --profile <name> add github:meka-im/google-trends-for-agent
```

This adds the same four tools (`trends_ask`, `trends_snapshot`, `trends_compare`, `trends_now`) as native in-process tools plus a `gtfa` skill. It does not start an MCP server, run the `gtfa` CLI, or call the Actor. Configure it in dsh web → Plugins → Google Trends → Configure: egress defaults to `local`; choose `apify` to use the Apify proxy directly from the core library, and set the Apify token there (stored as a dsh secret) or leave it empty to use `APIFY_TOKEN` / `APIFY_PROXY_PASSWORD`. Keep the tool guidance below unchanged: report `no_data` / `blocked` honestly, never invent volumes, and use it for light interactive research only.

## Verify networking first

Run the doctor once after install, or whenever a call fails unexpectedly:

```sh
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa doctor
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa doctor --json
```

It prints PASS/FAIL for Node >= 20, Google Trends reachability, proxy mode, and one live `gpts` US 24h fetch. Exit code 0 means all checks passed.

Networking is direct by default. If this machine needs a proxy, set `HTTPS_PROXY` (preferred) or `HTTP_PROXY` to `http://host:port`; no other configuration is required. On `RATE_LIMITED`, wait `retryAfterSec` and retry once at most. On `BLOCKED`, stop and report—do not loop, rotate requests, or invent results.

## Network egress: pick the right path

Google Trends answers the same IPs it sees as ordinary browsers more often than data-center ranges. Choose egress in this order:

1. **Your own machine IP (preferred).** Run the stdio server locally, or run `gtfa-mcp --http --port 4321` and keep it bound to `127.0.0.1`. This is the least likely path to trigger a challenge.
2. **The platform cloud VM.** Run the client and server on the same machine when that machine is allowed to make outbound HTTPS requests. Data-center IPs are challenged more often, so keep calls sparse and run `gtfa doctor` when a call fails.
3. **Apify Residential proxy.** Use this for remote-only agents that cannot reach your machine, or when a direct/platform IP is rate-limited. Deploy the Actor and connect to `https://<user>--google-trends-for-agent.apify.actor/mcp` with `Authorization: Bearer APIFY_TOKEN` (dots in the username become hyphens, e.g. `https://meka-im--google-trends-for-agent.apify.actor/mcp`). The Actor sets `HTTPS_PROXY` from Apify Proxy and rotates the proxy session on HTTP 429 or a Google challenge. Residential proxy traffic is billed per GB from your Apify credits.

| Agent environment | Egress it uses | Can it reach a local server? | Recommended path |
| --- | --- | --- | --- |
| dots cloud computer | OpenAI data-center IP | Yes, it can connect to the user's local computer | Local stdio or local HTTP, or the Apify URL when remote |
| Muse | Meta cloud VM | No; remote HTTPS MCP only, no localhost | Apify Actor URL (`/mcp` + bearer token) |
| Grok Bot | Shared box plus the user's registered computers | Yes, through the registered computers | Local stdio/HTTP on a registered computer, or the Apify URL for the shared box |

Do not route around a block by looping requests. On `RATE_LIMITED`, wait `retryAfterSec` and retry once at most; on `BLOCKED`, stop and report.

## Tools and when to use them

| Tool | Use when | What you get |
| --- | --- | --- |
| `trends_ask` | First look at a term; check whether interest exists and what people search next to it. | Interest summary, Popular/Rising related queries, regions, optional `validate` verdict, diff vs the previous saved snapshot. |
| `trends_snapshot` | You need a calibrated searches/day estimate, a traffic curve, or a chart. | Primary-window traffic plus an always-on `now 7-d` check, with `anchor` / `anchor7d` showing each window's baseline. |
| `trends_compare` | You need relative scale: candidate vs an established term or competitor (2–5 keywords). | One shared 0–100 scale, with gap-aware latest and peak per keyword. |
| `trends_now` | You need current demand: what is rising in a country today. | Ranked Trending Now items with volume bucket, growth, categories, related queries, and links. |

Call `trends_ask` with `points: true` only when the full interest series is needed; it is omitted by default to save context. `trends_ask` (without `validate`), `trends_compare`, and `trends_now` return relative interest only; do not claim search volume from them. Only `trends_snapshot` and `trends_ask` with `validate: true` return searches/day, and those are anchor-based estimates.

## Anchors and baselines

`trends_snapshot`, MCP `trends_ask` with `validate: true`, and `gtfa ask --validate` calibrate relative interest into searches/day against an anchor chosen by window:

| Window | Anchor | US baseline |
| --- | --- | --- |
| `now 1-H`, `now 4-H`, `now 1-d` | `sudoku` | 63,000/day, ±50% |
| `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all` | `gpts` | 3,500/day, ±50% |

The 63,000 baseline comes from the 7-day shared-scale ratio sudoku/gpts = 18.035: 18.035 × 3,500 ≈ 63,123. Cross-checking through thesaurus (7.341 × 3,500 ≈ 25,694, then × 2.441 ≈ 62,720) lands in the same place, so short and long windows sit on the same `gpts = 3,500` ruler. The 3,500 baseline is back-derived from public keyword-tool volumes for sudoku, thesaurus, and calculator through measured Trends ratios (sources in the reference). Alternates: thesaurus ≈25,700/day; chairs ≈143,000/day. The denser `sudoku` anchor avoids the sparse-24h failure that `gpts` often hits.

`trends_snapshot` also fetches `now 7-d` (with `gpts` unless you force an anchor) and reports that window as `anchor7d`. Pass MCP `anchor` or CLI `--anchor` to force one term for both windows (a per-call `anchor` beats the Actor's anchor input). `GTFA_BASELINES=/path/baselines.json` loads a version 2 baselines file (`anchors` plus optional `windowAnchors.short` / `.long`) for `gtfa`, `gtfa-mcp` (stdio and `--http`), and the Actor; version 1 and unknown `windowAnchors` terms are rejected with a clear error. These are estimates, not measured Google volume.

## New-term verification workflow

Use this four-step check before calling a term a real, rising trend:

1. **Existence** — `trends_ask` with `{ "term": "<term>", "geo": "US", "time": "now 1-d", "validate": true, "fresh": true }`. If `status` is `no_data` or `error`, stop and report it.
2. **Relative scale** — `trends_compare` with `{ "keywords": ["<term>", "<known anchor>"], "geo": "US", "time": "now 7-d" }`. Confirm the candidate is visible on the shared 0–100 scale, not a rounding artifact.
3. **Current corroboration** — `trends_now` with `{ "geos": ["US"], "hours": 24 }`. Look for the term or its close variants in `items` / `relatedQueries`; absence is evidence, not failure.
4. **Second window** — repeat step 1 with `time: "now 7-d"` (or re-run after 24h). Require the same direction across both windows before reporting a trend. Include the geo, window, and `fetchedAt` in your answer.

If any step returns `RATE_LIMITED`, wait `retryAfterSec` and retry once. If it returns `BLOCKED`, `NETWORK_ERROR`, or `TRENDS_PROTOCOL_CHANGED`, run `gtfa doctor`, report the error code, and do not substitute guessed numbers.
