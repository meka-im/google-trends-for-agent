# Google Trends MCP & API for AI Agents

**Open-source Google Trends for AI agents — search interest, comparisons, calibrated searches/day and trending searches, from MCP, HTTP or a one-off run.**

Use it to check whether demand exists before writing about a term, compare a candidate with an established one, estimate searches/day, or see what is rising in a country today. It is an unofficial client for undocumented Google Trends endpoints; Google can change them without notice.

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

Use `ask`, `snapshot`, `compare` or `now` for `tool`. `ask` and `snapshot` run one call per term; `compare` takes 2–5 terms; `now` ignores `terms` and returns trending searches for `geo`.

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
| Local (your IP) | `npx` the CLI/MCP server or install the dsh plugin; requests leave your machine. No Apify account. | Free. |
| This Actor | Use the Standby URL or one-off runs with your Apify token. Nothing to deploy. | Apify platform usage in your account; no Actor fee. |
| Self-deploy | Put the same open-source code in your own account: dsh plugin one-click, Console → Link Git repository, or `apify push`. | Apify platform usage in your account. |

Source: https://github.com/meka-im/google-trends-for-agent

## Pricing

- **No Actor fee.** The Actor has no pay-per-event price.
- **You pay Apify platform usage in your account** — compute and residential proxy traffic at your plan's rates.
- **Measured:** about **$0.0025 per isolated `trends_ask`** (≈65 KB residential at $8/GB plus a 512 MB run that exits after 60 s idle; measured 2026-11-12).
- **Warm calls are cheaper:** a later call in the same Standby run skips the cold start and the idle window is already running.
- **Free plan:** the $5 monthly credit is roughly 2,000 calls at that estimate.
- **What counts:** a Standby run bills until its idle exit; a one-off run bills its few seconds of compute plus proxy traffic. Google calls are small; `trends_now` over many countries uses more traffic than one `trends_ask`.

## What you get

- **`trends_ask`** — interest summary, Popular/Rising related queries, regions, an optional verdict and a diff against the previous saved snapshot.
- **`trends_snapshot`** — calibrated searches/day, primary and 7-day anchor blocks, traffic series, verdict and charts.
- **`trends_compare`** — relative 0–100 interest for 2–5 keywords on one shared scale.
- **`trends_now`** — Trending Now by country with rank, volume bucket, growth, categories and links.
- **Stable output** — a JSON envelope with `ok`, `status`, `schemaVersion` and explicit error codes; null traffic when calibration fails instead of guessed numbers.
- **Three transports** — remote MCP, plain HTTP, and dataset/KV output for one-off runs.

## Input

| Field | Behavior |
| --- | --- |
| `tool` | `ask`, `snapshot`, `compare` or `now`. Default `ask`. |
| `terms` | One or more terms for `ask`/`snapshot`; 2–5 for `compare`; ignored by `now`. |
| `geo` | Country code. `WORLDWIDE` maps to Worldwide for `ask`/`snapshot`/`compare`; `now` needs a country. Default `US`. |
| `window` | `now 1-H`, `now 4-H`, `now 1-d`, `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y` or `all`. Default `now 1-d`. `now` maps it to 4, 24 or 168 hours. |
| `anchor` | Blank = automatic (`sudoku` for ≤1 day, `gpts` for 7 days+), or `gpts` / `sudoku`. |
| `proxyConfiguration` | Proxy editor; defaults to Apify Residential, US. |

Standby/MCP callers ignore this input and pass arguments per tool call.

## Dataset output

One row per term, or one row per Trending Now item. Flat fields, `null` when the tool did not return a value.

| Field | Meaning |
| --- | --- |
| `term` | Term or trending query. |
| `tool` | `ask`, `snapshot`, `compare` or `now`. |
| `geo`, `window` | Requested country and window. |
| `status` | `ok`, `no_data`, `blocked`, `rate_limited` or `error`. |
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
  "errors": 0,
  "durationMs": 18300,
  "completed": true,
  "partial": false,
  "message": "Completed 1 row."
}
```

- `completed` — every row is `ok` or `no_data`.
- `partial` — at least one row delivered and at least one row blocked or failed. The run still exits successfully.
- `failed` — nothing usable; the Actor exits non-zero.
- `no_data` — Google returned no interest for the term.
- `blocked` — Google returned a challenge; stop and report instead of looping.
- `rate_limited` — HTTP 429; wait `retryAfterSec` and retry once at most.
- `error` — another upstream or protocol failure, with `error.code` and `error.message`.

## MCP and HTTP API

| Endpoint | Purpose |
| --- | --- |
| `/mcp` | Streamable HTTP MCP endpoint (`tools/list`, `tools/call`). |
| `POST /tools/{name}` | Run `trends_ask`, `trends_snapshot`, `trends_compare` or `trends_now` directly. |
| `POST /egress/fetch` | Relay one request; only `https://trends.google.com/...` is allowed. |
| `GET /health` | Cheap JSON: `{ ok, version, relay: 1 }`; no Google call. |

All endpoints use `Authorization: Bearer <YOUR_APIFY_TOKEN>`. A cold Standby start can take about 10 seconds (up to two minutes in the worst case). Requests are limited to 5 minutes. The Actor logs only the method and path — never query strings, headers, bodies or tokens.

## Coverage and limits

Google Trends coverage and calibration vary by country. The built-in anchors are US baselines; other geos return null `searchesPerDay` when no calibration exists. Values are relative interest or anchor-based estimates, not measured Google volume. Use it for light, interactive research — not bulk scraping or continuous polling. On `BLOCKED`, stop and report; on `RATE_LIMITED`, wait and retry once at most.

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

## Historical validation

On **2026-11-12**, one isolated `trends_ask` measured about **$0.0025** of platform usage: ≈65 KB of residential traffic at $8/GB plus a 512 MB Standby run that exited after 60 s idle. Warm calls cost less. This is a dated measurement, not a current guarantee; check the Apify Console for current proxy and compute rates.

## Open source and license

MIT. Source: https://github.com/meka-im/google-trends-for-agent · Issues: https://github.com/meka-im/google-trends-for-agent/issues

<!-- meka-tool-preview:start -->

**Tool preview:** Browse the [tools directory](https://meka.im/tools) for other sources.

<!-- meka-tool-preview:end -->
