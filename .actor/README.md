# Google Trends MCP & API for AI Agents

**Open-source Google Trends for AI agents — search interest, comparisons, calibrated searches/day and trending searches, from MCP, HTTP or a one-off run.**

Use it to check whether demand exists before writing about a term, compare a candidate with an established one, estimate searches/day, or see what is rising in a country today.

> [!WARNING]
> **Unofficial. Not affiliated with or endorsed by Google.** This Actor calls undocumented Google Trends web endpoints that can change or fail without notice, and use may conflict with Google's Terms of Service. Use it for light, interactive research only, not bulk scraping or an SLA. You are responsible for compliance.

## Quick start

### One-off run

Paste this input and press **Start**. The run executes one tool and exits with dataset rows and a chart.

```json
{
  "tool": "snapshot",
  "terms": ["Sora"],
  "geo": "US",
  "window": "now 1-d",
  "anchor": ""
}
```

Use `ask`, `snapshot`, `compare` or `now` for `tool`. `ask` and `snapshot` run one call per term; `compare` takes 1–5 distinct terms; `now` ignores `terms` and returns trending searches for `geo`. In an `ask`/`snapshot` batch, a block or rate limit stops the batch and later terms are written as `skipped` rows.

### MCP client

```json
{
  "mcpServers": {
    "google-trends": {
      "url": "https://meka-im--google-trends-for-agent.apify.actor/mcp",
      "headers": { "Authorization": "Bearer <YOUR_APIFY_TOKEN>" }
    }
  }
}
```

### HTTP API

```sh
curl -X POST 'https://meka-im--google-trends-for-agent.apify.actor/tools/trends_ask' \
  -H 'Authorization: Bearer <YOUR_APIFY_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"term":"Sora","geo":"US","time":"now 1-d"}'
```

## Three ways to use gtfa

| Route | Setup | Cost |
| --- | --- | --- |
| Local (your IP) | `npx -y -p github:meka-im/google-trends-for-agent#v0.2.0 gtfa snapshot Sora --geo US`, or install the dsh plugin; requests leave your machine. No Apify account. | Free. |
| This Actor | Use the Standby URL or one-off runs with your Apify token. Nothing to deploy. | Apify platform usage in your account; no Actor fee. |
| Self-deploy | Put the same open-source code in your own account: dsh plugin one-click, Console → Link Git repository, or `apify push`. | Apify platform usage in your account. |

The public Standby endpoint does not pass Actor Run input; each MCP or HTTP request supplies its own arguments.

Source: https://github.com/meka-im/google-trends-for-agent

## Pricing

- **No Actor fee.** The Actor has no pay-per-event price.
- **You pay Apify platform usage in your account** — compute and residential proxy traffic at your plan's rates.
- **Measured on the public Standby URL:** isolated `trends_ask` ≈ $0.0024 (measured 2026-11-13, Apify Free-plan rates); snapshots ≈ $0.0029; extra warm calls ≈ $0.0008.
- **Free plan:** the $5 monthly credit is roughly 2,100 isolated asks at that estimate.
- **What counts:** a Standby run bills until its idle exit; a one-off run bills its few seconds of compute plus proxy traffic. Google calls are small; `trends_now` over many countries uses more traffic than one `trends_ask`.

## What you get

- **`trends_ask`** — interest summary, Popular/Rising related queries, regions, an optional verdict and a diff against the previous saved snapshot.
- **`trends_snapshot`** — calibrated searches/day, primary and 7-day anchor blocks, traffic series, verdict and charts.
- **`trends_compare`** — relative 0–100 interest for 1–5 distinct keywords on one shared scale.
- **`trends_now`** — Trending Now by country with rank, volume bucket, growth, categories and links.
- **Stable output** — a JSON envelope with `ok`, `status`, `schemaVersion` and explicit error codes; null traffic when calibration fails instead of guessed numbers.
- **Three transports** — remote MCP, plain HTTP, and dataset/KV output for one-off runs.

## Input

| Field | Behavior |
| --- | --- |
| `tool` | `ask`, `snapshot`, `compare` or `now`. Default `ask`. |
| `terms` | One or more terms for `ask`/`snapshot`; 1–5 for `compare`; ignored by `now`. |
| `geo` | Country code. `WORLDWIDE` maps to Worldwide for `ask`/`snapshot`/`compare`; `now` needs a country. Default `US`. |
| `window` | Explore window (`now 1-H` through `all`); default `now 1-d`. For `now`, see the mapping below. |
| `anchor` | Blank = automatic (`sudoku` for ≤1 day, `gpts` for 7 days+), or `gpts` / `sudoku`. |
| `proxyConfiguration` | Proxy editor; defaults to Apify Residential, US. |

**Input passing.** The public Actor's Standby endpoint ignores Actor input: Apify does not pass the Run input to the Standby container, so `geo`, `anchor`, and `proxyConfiguration` from a Run input do not affect it. A self-deployed Actor that enables input passing reads those three fields at startup: `geo` becomes the default, `anchor` the server-wide anchor, and `proxyConfiguration` the egress proxy. `tool`, `terms`, and `window` remain per call.

**Window mapping.**

| Tool | Mapping |
| --- | --- |
| `ask`, `snapshot`, `compare` | `window` is used unchanged as the Explore time range. |
| `now` | `now 1-H` / `now 4-H` → 4 h; `now 1-d` → 24 h; `now 7-d` → 168 h; `today 1-m` / `today 3-m` / `today 12-m` / `today 5-y` / `all` → 24 h. `trends_now` also accepts `hours: 48` directly, but no Actor window maps to 48 h. |

## Dataset output

One row per term, or one row per Trending Now item. Flat fields, `null` when the tool did not return a value.

| Field | Meaning |
| --- | --- |
| `term` | Term or trending query. |
| `tool` | `ask`, `snapshot`, `compare` or `now`. |
| `geo`, `window` | Requested country and window. |
| `status` | `ok`, `no_data`, `blocked`, `rate_limited`, `skipped` or `error`. |
| `interestLatest`, `interestSettled`, `interestAverage`, `interestPeak` | Relative 0–100 interest, when available. |
| `searchesPerDay` | Anchor-calibrated estimate; null without calibration. |
| `verdict`, `anchor` | Verdict label and anchor term, when the tool returns them. |
| `topRelated`, `topRising` | Up to 10 related queries each. |
| `chartKey`, `chartUrl` | Key-value store key and public URL for a chart, or null. |
| `error` | `{ code, message }` or null. |
| `fetchedAt` | ISO timestamp. |

Representative item (example values, not live data):

```json
{
  "term": "Sora",
  "tool": "snapshot",
  "geo": "US",
  "window": "now 1-d",
  "status": "ok",
  "interestLatest": 43,
  "interestSettled": 43,
  "interestAverage": 38.6,
  "interestPeak": 100,
  "searchesPerDay": 1520,
  "verdict": "steady",
  "anchor": "sudoku",
  "topRelated": ["sora 2", "sora video"],
  "topRising": ["sora 2 api"],
  "chartKey": "chart-sora",
  "chartUrl": "https://api.apify.com/v2/key-value-stores/EXAMPLE_STORE_ID/records/chart-sora",
  "error": null,
  "fetchedAt": "2026-11-12T09:30:00.000Z"
}
```

## Run summary and errors

The `OUTPUT` key-value record summarizes the run:

```json
{
  "status": "completed",
  "tool": "snapshot",
  "geo": "US",
  "window": "now 1-d",
  "terms": ["Sora"],
  "delivered": 1,
  "noData": 0,
  "blocked": 0,
  "skipped": 0,
  "errors": 0,
  "durationMs": 18300,
  "completed": true,
  "partial": false,
  "message": "Completed 1 row."
}
```

- `completed` — every row is `ok` or `no_data`.
- `partial` — at least one row delivered and at least one row blocked, skipped or failed. The run still exits successfully.
- `failed` — nothing usable; the Actor exits non-zero.
- `no_data` — Google returned no interest for the term.
- `blocked` — Google returned a challenge; stop and report instead of looping.
- `rate_limited` — HTTP 429; wait `retryAfterSec` and retry once at most.
- `skipped` — a later term in an `ask`/`snapshot` batch after a block or rate limit. `OUTPUT.skipped` counts these rows; they are not delivered, blocked, or errors.
- `error` — another upstream or protocol failure, with `error.code` and `error.message`.

## MCP and HTTP API

| Endpoint | Purpose |
| --- | --- |
| `/mcp` | Streamable HTTP MCP endpoint (`tools/list`, `tools/call`). |
| `POST /tools/{name}` | Run `trends_ask`, `trends_snapshot`, `trends_compare` or `trends_now` directly. |
| `POST /egress/fetch` | Relay one request; only `https://trends.google.com/...` is allowed. |
| `GET /health` | Cheap JSON: `{ ok, version, relay: 1, build? }`; `build` is present when `ACTOR_BUILD_NUMBER` is set. No Google call. |

All endpoints use `Authorization: Bearer <YOUR_APIFY_TOKEN>`. Startup overhead is extra time on the first call after idle; a cold Standby start can occasionally take up to ~2 minutes. Each tool call has a 300 s deadline, and cancellation aborts the in-flight work.

Logging is minimal: for Standby requests the Actor logs the method and path only; one-off runs log row counts and statuses, never terms. Errors are logged by code without upstream URLs; query strings, headers, bodies and tokens are never logged.

## Coverage and limits

Google Trends coverage and calibration vary by country. The built-in anchors are US baselines; other geos return null `searchesPerDay` when no calibration exists. Values are relative interest or anchor-based estimates, not measured Google volume. Explicit `trends_now` country lists are deduped and capped at 30; use `all` for every supported country. Use it for light, interactive research — not bulk scraping or continuous polling. On `BLOCKED`, stop and report; on `RATE_LIMITED`, wait and retry once at most.

## Related tools

- [Similarweb Scraper](https://apify.com/meka.im/similarweb-scraper)
- [Google Ads Transparency Scraper](https://apify.com/meka.im/google-ads-transparency-scraper)
- [Google Maps Business Scraper](https://apify.com/meka.im/google-maps-business-scraper)

## FAQ

**Do I need to deploy anything?** No. Use the public Standby URL or a one-off run. Self-deploy only if you want the Actor in your own account.

**Why am I billed if there is no Actor fee?** The Actor runs in your Apify account, so compute and residential proxy traffic are platform usage. There is no separate Actor charge.

**Does it work on the Free plan?** Yes. The residential proxy is used inside the Actor, and the Free plan's monthly credit covers light use.

**Is the source code available?** Yes: https://github.com/meka-im/google-trends-for-agent (MIT).

**How is searches/day estimated?** The term and anchor share one 0–100 scale; traffic is `score ÷ anchor level × anchor daily searches`. The default anchors are `gpts` ≈3,500/day and `sudoku` ≈63,000/day for US, each with a ±50% band. Treat the result as an estimate.

## Open source and license

MIT. Source: https://github.com/meka-im/google-trends-for-agent · Issues: https://github.com/meka-im/google-trends-for-agent/issues

<!-- meka-tool-preview:start -->

**Tool preview:** Browse the [tools directory](https://meka.im/tools) for other sources.

<!-- meka-tool-preview:end -->
