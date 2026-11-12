# Reference

Operational detail for the CLI, the MCP server, the dsh plugin, and the numbers behind `snapshot`. For a Chinese field guide to MCP envelopes, see [mcp-api.md](mcp-api.md). Install and a short tour are in the [README](../README.md) and [AGENTS.md](../AGENTS.md). From a checkout, run `npm install && npm run build`, then `node dist/cli.js --help`.

## CLI surface

The package installs `gtfa` for the CLI and `gtfa-mcp` for the MCP server.

| Command | Flags | Purpose |
| --- | --- | --- |
| `gtfa ask <term>` | `--validate`, `--from FILE\|-`, `--anchor TERM`, `--no-anchor`, `--trending`, `--diff`, `--points`, `--fresh`, `--refresh always\|never\|if-stale`, `--max-age MIN`, `--geo`, `--time`, `--category`, `--property`, `--store DIR`, `--json`, `--help` | One term: interest, Popular/Rising, regions, optional verdict and diff. |
| `gtfa snapshot <term>` | `--geo`, `--time`, `--anchor`, `--fresh`, `--max-age MIN`, `--store DIR`, `--chart-dir DIR`, `--tz IANA`, `--svg`, `--json`, `--pretty`, `--help` | Calibrated searches/day, traffic series, verdict, charts, and chart paths. |
| `gtfa compare <kw> <kw> [...]` | `--url URL` (repeatable), `--geo`, `--time`, `--start YYYY-MM-DD`, `--end YYYY-MM-DD`, `--types LIST`, `--format json\|csv`, `--json`, `--timeout MS`, `--retries N`, `--min-interval MS`, `--pretty`, `--help`, `--version` | Relative interest for 1–5 keywords. The default `--query` mode is the same command. |
| `gtfa now` | `--geo US,SG,JP`, `--all-geos`, `--default-geos`, `--list-geos`, `--hours 4\|24\|48\|168`, `--min-volume N`, `--category 18,17`, `--limit N`, `--lang en`, `--format json\|csv`, `--json`, `--pretty`, `--timeout MS`, `--min-interval MS`, `--help` | Trending Now by country. `--hours` is the Trending Now window, not the Explore `--time` range. |
| `gtfa doctor` | `--json`, `--pretty`, `--help` | Checks Node.js >= 20, Google Trends reachability, proxy mode, and one live `gpts` US 24h fetch. Exit 0 only when all checks pass. |

Examples below assume a global `gtfa`; without one, replace `gtfa` with `npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa`. `--types` accepts `interestOverTime`, `interestByCity`, `interestByMetro`, `interestBySubregion`, `relatedQueries`, or `relatedTopics`. `--start` and `--end` must be used together; do not combine Explore URLs with `--query`. Defaults are US, `now 1-d`, web, category 0, except where a command says otherwise. Filters also honor `gtfa.config.json`, `GTFA_GEO`, and `GTFA_TIME`; chart time zones resolve as explicit `--tz` / `tz`, then `GTFA_TZ`, then `UTC`.

```sh
gtfa ask "nano banana" --validate --diff --json
cat leads.json | gtfa ask --validate --from - --json
gtfa snapshot Sora --geo US --svg --tz Asia/Shanghai --fresh --json
gtfa compare coffee tea --geo US --time "today 3-m" --pretty
gtfa --query coffee --query tea --geo US --json
gtfa now --geo SG --hours 24 --limit 20 --pretty
gtfa now --list-geos
gtfa doctor --json
gtfa help snapshot
```

`--json` selects the agent envelope. Without it, `snapshot` prints human-readable summary lines, and `ask --validate` prints a compact table (unless `--diff`, which implies JSON). `compare`/default mode prints JSON by default, but the agent envelope requires `--json`; `now` prints raw JSON unless `--json` is set. Help prints plain text on an interactive TTY and JSON when piped or with `--json`. Diagnostics go to stderr.

## MCP tools

The stdio server exposes exactly four tools.

| Tool | Inputs | What it returns |
| --- | --- | --- |
| `trends_ask` | `term` (required); `geo` (`US`); `time` (`now 1-d`); `fresh` (`false`); `validate` (`false`); `points` (`false`) | Interest, Popular/Rising queries, regions, optional verdict, diff vs the previous saved snapshot. `points: true` includes the full series. |
| `trends_snapshot` | `term` (required); `geo` (`US`); `time` (`now 1-d`); `anchor` (optional; automatic when omitted); `fresh` (`false`); `svg` (`false`); `tz` (`GTFA_TZ`, then `UTC`) | Calibrated searches/day, `anchor` / `anchor7d` and traffic blocks, series, verdict, related queries, `chart` and always-on `chart7d` / `traffic7d`. |
| `trends_compare` | `keywords` (2–5, required); `geo` (`US`); `time` (`now 1-d`) | Relative 0–100 interest for each keyword on one shared scale, with gap-aware latest/peak. Duplicate keywords return `INVALID_INPUT`. |
| `trends_now` | `geos` (array, `"default"`, or `"all"`; default `"default"` = 30 countries); `hours` (`4`, `24`, `48`, or `168`; default `24`); `limit` (integer ≥ 0; default `10`) | Trending Now items per country, with rank, traffic bucket, growth, categories, related queries, and links. |

`time` is one of `now 1-H`, `now 4-H`, `now 1-d`, `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all`. The first three tools default to US, `now 1-d`, web search, and category 0. `fresh: false` reuses saved snapshots younger than 360 minutes; `fresh: true` fetches live. Anchors are automatic by window: `sudoku` for `now 1-H` / `now 4-H` / `now 1-d`, `gpts` for `now 7-d` and longer. An explicit MCP `anchor` or CLI `--anchor` overrides both the requested and the extra 7-day window.

Useful environment variables: `GTFA_SNAPSHOT_DIR` and `GTFA_CHART_DIR` move the `.gtfa/snapshots` and `.gtfa/charts` stores (handy for read-only working directories), `GTFA_BASELINES` points at a version 2 baselines file (CLI, `gtfa-mcp`, and the Actor), `GTFA_TZ` sets the default chart time zone, and `HTTPS_PROXY` / `HTTP_PROXY` select a proxy (`HTTPS_PROXY` wins, lowercase variants are honored). With neither set, requests go direct. `gtfa doctor` reports which mode is active.

## dsh plugin

`dsh plugin --profile web add github:meka-im/google-trends-for-agent` mounts the bare `google-trends-for-agent` row (`gtfa`). pnpm keys git builds by commit, so the first run prints that key (it changes when main moves), add it under `allowBuilds:` in `~/.dsh/profiles/web/pnpm-workspace.yaml`, then re-run. The bundle registers the same four tools as native in-process tools and a bundled `gtfa` skill. It does not use MCP, the Actor endpoint, the `gtfa` CLI, or `@modelcontextprotocol/sdk`.

Enable it in **dsh web → Plugins → Google Trends → gtfa → Configure** (switch the bundle on if it shows Off). Settings are `.volatile()` and apply live. `role('secret')` only redacts token reads: a token entered in the UI is saved in plaintext in the profile's `cordis.patch.yml` (mode 0600), hidden in the UI and never logged or returned. Leave it blank and set `APIFY_TOKEN` to keep it out of the profile.

| Field | Default | Meaning |
| --- | --- | --- |
| `egress` | `local` | `local` sends Google requests from the dsh machine and still honors `HTTPS_PROXY` / `HTTP_PROXY`; `apify` uses the Apify proxy directly from the core library. |
| `apifyToken` | unset | Apify API token saved in the profile's `cordis.patch.yml` (hidden in the UI, never logged or returned). When empty, `APIFY_TOKEN` then `APIFY_PROXY_PASSWORD` are used. |
| `apifyProxyGroup` | `RESIDENTIAL` | `RESIDENTIAL` for residential IPs, or `auto` for Apify's automatic datacenter selection. Auto omits the `groups` parameter. |
| `apifyProxyCountry` | `US` | Apify proxy country from the built-in list. |
| `geo` | `US` | Default geo for `trends_ask`, `trends_compare`, and `trends_snapshot`; empty string means Worldwide, which has no built-in calibration and returns null traffic. |
| `anchor` | automatic | Optional fixed anchor for `validate` / `trends_snapshot`; blank uses sudoku for short windows and gpts otherwise. |
| `baselines` | built-in | Inline anchors `{ term, geo, dailySearches, tolerance? }` plus optional `windowAnchors.short` / `.long`; validated like a version 2 baselines file. |
| `cache` | `true` | Reuse saved snapshots (up to 360 minutes); `false` always fetches fresh. |
| `snapshotDir` | `.gtfa/snapshots` | Advanced: snapshot store, resolved against the dsh process working directory. |
| `chartDir` | `.gtfa/charts` | Advanced: chart output directory. |
| `charts` | `true` | Advanced: write SVG chart files; `false` returns null chart paths. |

Every setting with a fixed set of values is a select, segmented control, or switch; only the token, a new anchor term, `dailySearches`, and the two directories are typed inputs.

The settings page also calls two owner-authenticated Host routes through dsh's Connection service; the browser never receives the Apify token:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/gtfa.apify-usage` | `GET` | Reads this cycle's plan and usage from two Apify account endpoints; `?refresh=1` bypasses the 60 s cache. The saved config token wins, then `APIFY_TOKEN` (`APIFY_PROXY_PASSWORD` is a proxy password, not an API token). |
| `/api/gtfa.test-connection` | `POST` | Makes one reachability request for the saved egress: Google Trends for `local`, or `http://api.apify.com/v2/browser-info` through the saved Apify proxy settings. |

Both routes require dsh's authenticated browser session and are absent in headless/TUI profiles. Responses contain usage numbers, plan fields, status/latency, and at most the proxy's public IP/country; account identity, the raw `/users/me` object, and the token are dropped Host-side.

`egress: apify` resolves credentials in order: the configured token, `APIFY_TOKEN`, then `APIFY_PROXY_PASSWORD`. With a token it fetches `data.proxy.password` once from `GET https://api.apify.com/v2/users/me`; with only `APIFY_PROXY_PASSWORD` it uses that directly. `RESIDENTIAL` builds the username `groups-RESIDENTIAL,session-<id>,country-<CC>`; `auto` omits `groups` (`session-<id>,country-<CC>`), per Apify's username parameters. Setting `APIFY_TOKEN` and leaving the UI token blank keeps the token out of the profile, and `!!js process.env.APIFY_TOKEN` is unnecessary. The proxy URL is passed explicitly to the transport (no `process.env` mutation) and the session id rotates on HTTP 429 or a Google challenge. Missing credentials return a normal `ok: false` / `INVALID_INPUT` tool envelope rather than a boot failure. `GTFA_BASELINES` and `GTFA_TZ` still apply; configured `baselines` win.

## Output contract

The MCP results and the CLI agent envelopes (`ask`, `snapshot --json`, and compare/default mode with `--json`) share the outer keys `ok`, `schemaVersion` (currently `1`), `status`, the tool-specific body, optional `error`, and `meta`. `trends_now` can return a partial result with `ok: true` and still include the first per-country `error`. For `ask`/`snapshot`, `status` is `ok`, `no_data`, or `partial` on success; `blocked` and `error` set `ok: false` and include `error.code`. `trends_compare` and `trends_now` use `ok`, `partial`, and `error`; schema rejections can set `ok: false` with `error.code`. MCP results also set `isError: true` for `ok: false`. Without `--json`, compare/default mode prints the lower-level response described below.

Tool bodies:

- `trends_ask`: `term`, `summary`, `filter`, `interest`, `tables`, `regions`, optional `verdict`, `diff`, optional `diffReason`, `meta`.
- `trends_snapshot`: `term`, `summary`, `filter`, `anchor`, `anchor7d`, `traffic`, `series`, `chart`, `chart7d`, `traffic7d`, `tables`, `verdict`, `meta`.
- `trends_compare`: `filter`, `summary`, `series`, `meta`.
- `trends_now`: `hours`, `geos`, `summary`, `byGeo`, `meta`.

Errors contain `{ "code": string, "message": string, "retryAfterSec"?: number }`. Messages are actionable for agents: they say what happened and whether to retry, lower the request rate, raise `--timeout`, check the network, or set `HTTPS_PROXY` / `HTTP_PROXY`. The lower-level `queryTrends()` API instead returns `{ status, input, data?, error?, meta }`.

## Exit codes

| Code / outcome | CLI exit | Meaning |
| --- | --- | --- |
| success | `0` | Complete success; `no_data` also exits 0 in the snapshot/ask envelope. |
| `partial` | `2` for `ask`, `compare`/default, and `now`; `0` for `snapshot` | Some sections or countries succeeded, others failed. Successful snapshot partials still exit 0. |
| `BLOCKED` | `3` | Upstream challenge / unusual traffic detected. Stop and report. |
| `RATE_LIMITED` | `3` | Upstream rate limit. Wait for `retryAfterSec` before a bounded retry. |
| `INVALID_INPUT` | `4` | Invalid argument or CLI usage. |
| `INVALID_COMBINATION` | `4` | Incompatible options, such as both `timeRange` and dates. |
| `REQUEST_TOO_LARGE` | `1` | Request exceeds the supported size. |
| `TRENDS_TIMEOUT` | `1` | Upstream request timed out. |
| `TRENDS_PROTOCOL_CHANGED` | `1` | Upstream response did not match the expected protocol. |
| `TRENDS_TEMPORARILY_UNAVAILABLE` | `1` | Upstream server failure. |
| `NETWORK_ERROR` | `1` | Transport connection failure. |

Batch exit precedence for compare/default mode and `now` is blocked/rate-limited, invalid input, partial success, then other errors. `ask --validate --from` instead takes the maximum per-item exit code, so one success plus one upstream failure exits 1 (not 2); any blocked verdict still short-circuits to 3.

## Calibration and the anchor

`snapshot` and `ask --validate` use the same gap-aware calibration:

```text
traffic = round(score ÷ anchorLevel × dailySearches)
```

`anchorLevel` is the mean of the anchor's non-gap points in the same shared-scale comparison. Anchors are automatic by window:

| Window | Anchor | Geo | Daily searches | Tolerance | How derived |
| --- | --- | --- | --- | --- | --- |
| `now 1-H`, `now 4-H`, `now 1-d` | `sudoku` | `US` | **63,000/day** | ±50% | 18.035 × 3,500 ≈ 63,123 (7-day sudoku/gpts ratio); thesaurus cross-check ≈62,720. |
| `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all` | `gpts` | `US` | **3,500/day** (≈105k/month) | ±50% | Long-window ruler; back-derived from public keyword-tool volumes through measured Trends ratios. |

**Why 3,500/day:** public US keyword-tool volumes for sudoku, thesaurus, and calculator, divided by measured 7-day Trends ratios (sudoku/gpts 18.035, thesaurus/gpts 7.341, calculator/sudoku ≈18). The sudoku and calculator rows cluster at 2,100–4,100/day, and 3,500 sits in that cluster. The thesaurus rows run higher because the tools disagree widely on that keyword (1.5M–4.1M/month). All of these are rounded third-party estimates, so the built-in tolerance stays ±50%. Google Ads' own `gpts` number (1.5M/month) is unusable because Keyword Planner merges close variants such as "gpt".

| Source (US monthly) | Per day | Implied gpts/day |
| --- | ---: | ---: |
| sudoku, Google Ads (via [seodata.dev](https://api.seodata.dev/v1/keyword?q=sudoku&country=us)) — 2.24M | 74k | ≈4,100 |
| sudoku, Semrush, Sep 2026 ([sudoku.com](https://www.semrush.com/website/sudoku.com/overview/)) — 1.83M | 60k | ≈3,300 |
| sudoku, Ahrefs ([sudoku.com](https://ahrefstop.com/websites/sudoku.com)) — 1.5M | 49k | ≈2,700 |
| thesaurus, Google Ads (via [seodata.dev](https://api.seodata.dev/v1/keyword?q=thesaurus&country=us)) — 1.5M | 49k | ≈6,700 |
| thesaurus, Semrush, Oct 2026 ([thesaurus.com](https://www.semrush.com/website/thesaurus.com/overview/)) — 4.09M | 134k | ≈18,300 |
| calculator, Ahrefs ([top Google searches](https://ahrefs.com/blog/top-google-searches/)) / Google Ads ([seodata.dev](https://api.seodata.dev/v1/keyword?q=calculator&country=us)) — 21.0M / 20.4M | ≈680k | ≈2,100 |

Derivation of 63,000: the 7-day shared-scale ratio sudoku/gpts is 18.035, so 18.035 × 3,500 ≈ 63,123. Cross-check through thesaurus: thesaurus/gpts 7.341 × 3,500 ≈ 25,694, then sudoku/thesaurus 2.441 × 25,694 ≈ 62,720. Both round to ≈63,000, so 1-day and 7-day estimates sit on the same ruler (`gpts = 3,500`). Alternates worth noting: thesaurus ≈25,700/day is closer to small AI terms but has zero points at night; chairs ≈143,000/day (scaled from its earlier 22,500/day estimate to the new ruler) is 100% nonzero but flattens very small terms. Anchors that are too big (weather, calculator, pizza) crush small terms. Method references: [Krazydad, comparing Trends scales](https://blog.krazydad.com/2018/05/18/comparing-apples-oranges-and-futoshikis-using-google-trends/) and [G-TAB](https://arxiv.org/abs/2007.13861).

The built-in baselines are in [examples/baselines.json](../examples/baselines.json). A version 2 file can replace or add anchors; `windowAnchors` remaps the automatic short/long defaults:

```json
{
  "version": 2,
  "anchors": [
    { "term": "sudoku", "geo": "US", "dailySearches": 63000, "tolerance": 0.5 },
    { "term": "gpts", "geo": "US", "dailySearches": 3500, "tolerance": 0.5 }
  ],
  "windowAnchors": { "short": "sudoku", "long": "gpts" }
}
```

Load it with `GTFA_BASELINES=/path/to/baselines.json` for `gtfa` (ask/snapshot), `gtfa-mcp` (stdio or `--http`), and the Actor; library callers pass `baselines`. User anchors win by term + geo, then the built-ins apply. Every `windowAnchors` term must exist in `anchors` or the built-ins. Version 1 is rejected, and an invalid file fails with a clear error instead of falling back. An explicit `--anchor` / MCP `anchor` wins for every window (a per-call MCP `anchor` beats the Actor's server-wide anchor input); otherwise the primary window chooses its automatic anchor and the extra `now 7-d` fetch uses the 7-day anchor. `anchor` and `anchor7d` report each window's term and baseline.

`traffic.low` / `traffic.high` apply that tolerance to the average. Numeric traffic is `null` when no matching geo + anchor baseline exists, or when the anchor reliability gate fails:

- at least one non-gap anchor point;
- gap-aware `anchorLevel ≥ 1` on Trends' integer scale;
- at least 25% of non-gap anchor points nonzero.

A real 24-hour Sora run with `gpts` failed the third condition: `27/180` non-gap anchor points were nonzero (15%), even though `anchorLevel` was `2.72`. That is why short windows now use `sudoku`: in a US 24-hour check it was 99.4% nonzero (CV 0.21), and small AI terms such as `gemini 4 carbon`, `pika h3`, and `genie 4` stayed nonzero next to it. A 7-day Sora run with `gpts` calibrated normally: average **36,795**, latest **39,238** (39.2k), peak **55,262** (55.3k) searches/day.

These numbers are **estimates from an anchor**, not measured Google search volume. When the requested window is not `now 7-d`, `traffic7d` and `chart7d` come from a separate 7-day fetch and give you a second check; that fetch uses `gpts` unless an explicit anchor was given. When the request is already `now 7-d`, they reuse the primary snapshot and chart, so they are not independent. Cache keys include the filter window and anchor term, so a 1-day `sudoku` snapshot and a 7-day `gpts` snapshot never collide.

## Rate limits, retries, and timeouts

- Default spacing between upstream requests is **1000 ms** for Explore requests from the CLI/library, and **1500 ms** for Trending Now (`now` / `trends_now`) and for all MCP requests.
- HTTP 429 triggers a bounded automatic retry: `Retry-After` is honored when it is at most **10 s**, otherwise the request fails immediately with `retryAfterSec` so the caller can wait. Without `Retry-After`, the delay is 1 s, then 2 s. `maxRetries` defaults to `1` and is capped at `2`.
- `BLOCKED` challenge pages are never retried. They trigger adaptive backoff capped at 60 s (1 s floor); successes halve the penalty.
- For Explore and Trending Now requests, transient `TRENDS_TIMEOUT`, `TRENDS_TEMPORARILY_UNAVAILABLE`, and `NETWORK_ERROR` failures may also retry up to `maxRetries` (default `1`, maximum `2`). Explore's default timeout is 8000 ms, and `timeoutMs` must be 1000–60000 ms. The Trending Now library `timeoutMs` defaults to 8000 ms and accepts any finite positive number; the CLI's `now --timeout` requires a positive safe integer.
- Batches and `trends_now` stop after the first block by default; later items are reported as blocked/skipped.
- Keep workloads small. This is not suitable for bulk scraping or continuous polling, and retries or proxies do not guarantee access.
