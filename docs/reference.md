# Reference

Operational detail for the CLI, the MCP server, and the numbers behind `snapshot`. For a Chinese field guide to MCP envelopes, see [mcp-api.md](mcp-api.md). Install and a short tour are in the [README](../README.md). From a checkout, run `npm install && npm run build`, then `node dist/cli.js --help`.

## CLI surface

`gtfa`, `google-trends-for-agent`, and `trends-kit` are aliases for the CLI. The MCP server is installed as `gtfa-mcp` / `google-trends-for-agent-mcp`.

| Command | Flags | Purpose |
| --- | --- | --- |
| `gtfa ask <term>` | `--validate`, `--from FILE\|-`, `--anchor TERM`, `--no-anchor`, `--trending`, `--diff`, `--points`, `--fresh`, `--no-cache`, `--refresh always\|never\|if-stale`, `--max-age MIN`, `--geo`, `--time`, `--category`, `--property`, `--store DIR`, `--json`, `--help` | One term: interest, Popular/Rising, regions, optional verdict and diff. |
| `gtfa snapshot <term>` | `--geo`, `--time`, `--anchor`, `--fresh`, `--no-cache`, `--max-age MIN`, `--store DIR`, `--chart-dir DIR`, `--tz IANA`, `--svg`, `--json`, `--pretty`, `--help` | Calibrated searches/day, traffic series, verdict, charts, and chart paths. |
| `gtfa compare <kw> <kw> [...]` | `--url URL` (repeatable), `--geo`, `--time`, `--start YYYY-MM-DD`, `--end YYYY-MM-DD`, `--types LIST`, `--format json\|csv`, `--json`, `--timeout MS`, `--retries N`, `--min-interval MS`, `--pretty`, `--help`, `--version` | Relative interest for 1–5 keywords. The default `--query` mode is the same command. |
| `gtfa now` | `--geo US,SG,JP`, `--all-geos`, `--default-geos`, `--list-geos`, `--hours 4\|24\|48\|168`, `--min-volume N`, `--category 18,17`, `--limit N`, `--lang en`, `--format json\|csv`, `--json`, `--pretty`, `--timeout MS`, `--min-interval MS`, `--help` | Trending Now by country. `--hours` is the Trending Now window, not the Explore `--time` range. |

`--types` accepts `interestOverTime`, `interestByCity`, `interestByMetro`, `interestBySubregion`, `relatedQueries`, or `relatedTopics`. `--start` and `--end` must be used together; do not combine Explore URLs with `--query`. Defaults are US, `now 1-d`, web, category 0, except where a command says otherwise. Filters also honor `gtfa.config.json`, `GTFA_GEO`, and `GTFA_TIME`; chart time zones resolve as explicit `--tz` / `tz`, then `GTFA_TZ`, then `UTC`.

```sh
npx gtfa ask "nano banana" --validate --diff --json
new-term-radar leads --json | npx gtfa ask --validate --from - --json
npx gtfa snapshot Sora --geo US --svg --tz Asia/Shanghai --fresh --json
npx gtfa compare coffee tea --geo US --time "today 3-m" --pretty
npx gtfa --query coffee --query tea --geo US --json
npx gtfa now --geo SG --hours 24 --limit 20 --pretty
npx gtfa now --list-geos
npx gtfa help snapshot
```

`--json` selects the agent envelope. Without it, `snapshot` prints human-readable summary lines, and `ask --validate` prints a compact table (unless `--diff`, which implies JSON). `compare`/default mode prints JSON by default, but the agent envelope requires `--json`; `now` prints raw JSON unless `--json` is set. Help prints plain text on an interactive TTY and JSON when piped or with `--json`. Diagnostics go to stderr.

## MCP tools

The stdio server exposes exactly four tools and no aliases.

| Tool | Inputs | What it returns |
| --- | --- | --- |
| `trends_ask` | `term` (required); `geo` (`US`); `time` (`now 1-d`); `fresh` (`false`); `validate` (`false`); `points` (`false`) | Interest, Popular/Rising queries, regions, optional verdict, diff vs the previous saved snapshot. `points: true` includes the full series. |
| `trends_snapshot` | `term` (required); `geo` (`US`); `time` (`now 1-d`); `anchor` (`gpts`); `fresh` (`false`); `svg` (`false`); `tz` (`GTFA_TZ`, then `UTC`) | Calibrated searches/day, anchor and traffic blocks, series, verdict, related queries, `chart` and always-on `chart7d` / `traffic7d`. |
| `trends_compare` | `keywords` (2–5, required); `geo` (`US`); `time` (`now 1-d`) | Relative 0–100 interest for each keyword on one shared scale, with gap-aware latest/peak. Duplicate keywords return `INVALID_INPUT`. |
| `trends_now` | `geos` (array, `"default"`, or `"all"`; default `"default"` = 30 countries); `hours` (`4`, `24`, `48`, or `168`; default `24`); `limit` (integer ≥ 0; default `10`) | Trending Now items per country, with rank, traffic bucket, growth, categories, related queries, and links. |

`time` is one of `now 1-H`, `now 4-H`, `now 1-d`, `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all`. The first three tools default to US, `now 1-d`, web search, and category 0. `fresh: false` reuses saved snapshots younger than 360 minutes; `fresh: true` fetches live.

Useful environment variables: `GTFA_SNAPSHOT_DIR` and `GTFA_CHART_DIR` move the `.gtfa/snapshots` and `.gtfa/charts` stores (handy for read-only working directories), `GTFA_TZ` sets the default chart time zone, and `HTTPS_PROXY` selects an HTTP proxy.

## Output contract

The MCP results and the CLI agent envelopes (`ask`, `snapshot --json`, and compare/default mode with `--json`) share the outer keys `ok`, `schemaVersion` (currently `1`), `status`, the tool-specific body, optional `error`, and `meta`. `trends_now` can return a partial result with `ok: true` and still include the first per-country `error`. For `ask`/`snapshot`, `status` is `ok`, `no_data`, or `partial` on success; `blocked` and `error` set `ok: false` and include `error.code`. `trends_compare` and `trends_now` use `ok`, `partial`, and `error`; schema rejections can set `ok: false` with `error.code`. MCP results also set `isError: true` for `ok: false`. Without `--json`, compare/default mode prints the lower-level response described below.

Tool bodies:

- `trends_ask`: `term`, `summary`, `filter`, `interest`, `tables`, `regions`, optional `verdict`, `diff`, optional `diffReason`, `meta`.
- `trends_snapshot`: `term`, `summary`, `filter`, `anchor`, `traffic`, `series`, `chart`, `chart7d`, `traffic7d`, `tables`, `verdict`, `meta`.
- `trends_compare`: `filter`, `summary`, `series`, `meta`.
- `trends_now`: `hours`, `geos`, `summary`, `byGeo`, `meta`.

Errors contain `{ "code": string, "message": string, "retryAfterSec"?: number }`. The lower-level `queryTrends()` API instead returns `{ status, input, data?, error?, meta }`.

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

`anchorLevel` is the mean of the anchor's non-gap points in the same shared-scale comparison. The built-in baseline is in [examples/baselines.json](../examples/baselines.json):

| Anchor | Geo | Daily searches | Tolerance |
| --- | --- | --- | --- |
| `gpts` | `US` | **550/day** (about 16.5k/month) | ±50% |

`traffic.low` / `traffic.high` apply that tolerance to the average. Numeric traffic is `null` when no matching geo + anchor baseline exists, or when the anchor reliability gate fails:

- at least one non-gap anchor point;
- gap-aware `anchorLevel ≥ 1` on Trends' integer scale;
- at least 25% of non-gap anchor points nonzero.

A real 24-hour Sora run (US, 2026-11-02 UTC) failed the third condition: `27/180` non-gap anchor points were nonzero (15%), even though `anchorLevel` was `2.72`. So `anchor.ratio` and numeric `traffic` fields were `null`, the chart said "No calibrated traffic", and `anchor.note` explained why. This is expected, not a rendering bug; use a denser window or anchor. The verdict still used related-query and series-shape signals. A 7-day Sora run on the same date calibrated normally: average **5,782**, latest **6,166** (6.2k), peak **8,684** (8.7k) searches/day.

These numbers are **estimates from an anchor**, not measured Google search volume. When the requested window is not `now 7-d`, `traffic7d` and `chart7d` come from a separate 7-day fetch and give you a second check. When the request is already `now 7-d`, they reuse the primary snapshot and chart, so they are not independent.

## Rate limits, retries, and timeouts

- Default spacing between upstream requests is **1000 ms** for Explore requests from the CLI/library, and **1500 ms** for Trending Now (`now` / `trends_now`) and for all MCP requests.
- `BLOCKED` and `RATE_LIMITED` are returned immediately, with no automatic retry. They trigger adaptive backoff capped at 60 s (1 s floor); successes halve the penalty.
- For Explore requests, transient `TRENDS_TIMEOUT`, `TRENDS_TEMPORARILY_UNAVAILABLE`, and `NETWORK_ERROR` failures may retry up to `maxRetries` (default `1`, maximum `2`). Explore's default timeout is 8000 ms, and `timeoutMs` must be 1000–60000 ms.
- Trending Now (`fetchTrending()` / `now`) performs no automatic retry. The library's `timeoutMs` defaults to 8000 ms and accepts any finite positive number; the CLI's `now --timeout` requires a positive safe integer.
- Batches and `trends_now` stop after the first block by default; later items are reported as blocked/skipped.
- Keep workloads small. This is not suitable for bulk scraping or continuous polling, and retries or proxies do not guarantee access.
