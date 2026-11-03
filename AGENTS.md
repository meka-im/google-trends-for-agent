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

The package installs two commands: `gtfa` (CLI) and `gtfa-mcp` (stdio MCP server). The first run may take longer while TypeScript builds; later runs use the npx cache. For a persistent install, use `npm install -g github:meka-im/google-trends-for-agent#v0.1.0`.

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

Restart the client, then call `trends_ask` with a single term. `trends_ask` and `trends_compare` default to US, past 24 hours, web search, all categories; `trends_now` defaults to 30 countries at 24h.

## Verify networking first

Run the doctor once after install, or whenever a call fails unexpectedly:

```sh
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa doctor
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa doctor --json
```

It prints PASS/FAIL for Node >= 20, Google Trends reachability, proxy mode, and one live `gpts` US 24h fetch. Exit code 0 means all checks passed.

Networking is direct by default. If this machine needs a proxy, set `HTTPS_PROXY` (preferred) or `HTTP_PROXY` to `http://host:port`; no other configuration is required. On `RATE_LIMITED`, wait `retryAfterSec` and retry once at most. On `BLOCKED`, stop and report—do not loop, rotate requests, or invent results.

## Tools and when to use them

| Tool | Use when | What you get |
| --- | --- | --- |
| `trends_ask` | First look at a term; check whether interest exists and what people search next to it. | Interest summary, Popular/Rising related queries, regions, optional `validate` verdict, diff vs the previous saved snapshot. |
| `trends_compare` | You need relative scale: candidate vs an established term or competitor (2–5 keywords). | One shared 0–100 scale, with gap-aware latest and peak per keyword. |
| `trends_now` | You need current demand: what is rising in a country today. | Ranked Trending Now items with volume bucket, growth, categories, related queries, and links. |

Call `trends_ask` with `points: true` only when the full interest series is needed; it is omitted by default to save context. Do not claim search volume from these tools—they return relative interest.

## New-term verification workflow

Use this four-step check before calling a term a real, rising trend:

1. **Existence** — `trends_ask` with `{ "term": "<term>", "geo": "US", "time": "now 1-d", "validate": true, "fresh": true }`. If `status` is `no_data` or `error`, stop and report it.
2. **Relative scale** — `trends_compare` with `{ "keywords": ["<term>", "<known anchor>"], "geo": "US", "time": "now 7-d" }`. Confirm the candidate is visible on the shared 0–100 scale, not a rounding artifact.
3. **Current corroboration** — `trends_now` with `{ "geos": ["US"], "hours": 24 }`. Look for the term or its close variants in `items` / `relatedQueries`; absence is evidence, not failure.
4. **Second window** — repeat step 1 with `time: "now 7-d"` (or re-run after 24h). Require the same direction across both windows before reporting a trend. Include the geo, window, and `fetchedAt` in your answer.

If any step returns `RATE_LIMITED`, wait `retryAfterSec` and retry once. If it returns `BLOCKED`, `NETWORK_ERROR`, or `TRENDS_PROTOCOL_CHANGED`, run `gtfa doctor`, report the error code, and do not substitute guessed numbers.
