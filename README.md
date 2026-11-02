<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img alt="google-trends-for-agent" src="docs/assets/logo-light.svg" width="420">
  </picture>
</p>

<p align="center"><b>Search-interest signals for AI agents. One call in, stable JSON out.</b></p>

<p align="center">English | <a href="README.zh-CN.md">简体中文</a></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 20"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/tests-194%20passed-22c55e?style=flat-square" alt="194 tests passing">
  <img src="https://img.shields.io/badge/status-unofficial-orange?style=flat-square" alt="Unofficial">
</p>

> [!WARNING]
> **Unofficial. Not affiliated with or endorsed by Google.** This project calls undocumented public Google Trends web endpoints that can change or fail without notice, and use may conflict with Google's Terms of Service. Use it for light, interactive analysis, not bulk scraping or an SLA.

`google-trends-for-agent` gives agents and humans a predictable way to ask how search interest is changing. It returns a stable JSON envelope, calibrated searches/day estimates from `snapshot`, charts, and explicit error codes instead of invented numbers.

## Install

Requires Node.js 20+.

```sh
npm install github:meka-im/google-trends-for-agent
npx gtfa --help
```

Or from a checkout:

```sh
git clone https://github.com/meka-im/google-trends-for-agent.git
cd google-trends-for-agent
npm install
npm run build
node dist/cli.js --help
```

`gtfa`, `google-trends-for-agent`, and `trends-kit` are aliases for the CLI. The MCP server is installed as `gtfa-mcp` / `google-trends-for-agent-mcp`.

## Snapshot: calibrated searches/day

`snapshot` compares one term with an anchor on the same shared 0–100 scale, calibrates the result, returns related queries and a verdict, and writes SVG charts. It always includes a `now 7-d` curve as `chart7d` / `traffic7d`.

```sh
npx gtfa snapshot Sora --geo US --pretty --json
# Optional: embed the SVG text, choose a chart time zone, or force live data
npx gtfa snapshot Sora --geo US --svg --tz Asia/Shanghai --fresh --json
```

A real 7-day run (2026-11-02 UTC) was calibrated: **peak 8,684 (8.7k), latest 6,166 (6.2k) searches/day**, average 5,782.

<p align="center">
  <img src="docs/assets/traffic-sora-us-7d.svg" alt="Sora US 7-day calibrated traffic chart: peak 8.7k, latest 6.2k searches/day" width="800">
</p>
<p align="center"><sub>Real <code>Sora --geo US --time "now 7-d"</code> output, labels in UTC. The 7-day window has enough dense <code>gpts</code> anchor points to calibrate.</sub></p>

The same term on the **24-hour** window returned **no calibrated traffic**:

<p align="center">
  <img src="docs/assets/traffic-sora-us-24h.svg" alt="Sora US 24-hour chart showing No calibrated traffic because the gpts anchor is too sparse" width="800">
</p>
<p align="center"><sub>Real 24-hour chart. Only 27 of 180 non-gap <code>gpts</code> anchor points were nonzero (15%), below the 25% reliability gate, so <code>traffic.*</code> is <code>null</code> and the chart says “No calibrated traffic”. This is expected, not a rendering bug; use a denser window or anchor.</sub></p>

<p align="center">
  <img src="docs/assets/demo-terminal.svg" alt="gtfa snapshot command returning a real trimmed JSON envelope for Sora" width="800">
</p>
<p align="center"><sub>Real snapshot output, trimmed. The full envelope also includes the series, anchor points, per-query estimates, warnings, and metadata.</sub></p>

<p align="center">
  <img src="docs/assets/architecture.svg" alt="Architecture: CLI, library and MCP tools share queryTrends, snapshot caching, anchor calibration, envelopes and chart rendering" width="860">
</p>

## MCP tools

The stdio server exposes exactly four tools and no aliases:

| Tool | Inputs | What it returns |
| --- | --- | --- |
| `trends_ask` | `term` (required); `geo` (`US`); `time` (`now 1-d`); `fresh` (`false`); `validate` (`false`); `points` (`false`) | Interest, Popular/Rising queries, regions, optional verdict, diff vs the previous saved snapshot. `points: true` includes the full series. |
| `trends_snapshot` | `term` (required); `geo` (`US`); `time` (`now 1-d`); `anchor` (`gpts`); `fresh` (`false`); `svg` (`false`); `tz` (`GTFA_TZ`, then `UTC`) | Calibrated searches/day, anchor and traffic blocks, series, verdict, related queries, `chart` and always-on `chart7d` / `traffic7d`. |
| `trends_compare` | `keywords` (2–5, required); `geo` (`US`); `time` (`now 1-d`) | Relative 0–100 interest for each keyword on one shared scale, with gap-aware latest/peak. Duplicate keywords return `INVALID_INPUT`. |
| `trends_now` | `geos` (array, `"default"`, or `"all"`; default `"default"` = 30 countries); `hours` (`4`, `24`, `48`, or `168`; default `24`); `limit` (integer ≥ 0; default `10`) | Trending Now items per country, with rank, traffic bucket, growth, categories, related queries, and links. |

`time` is one of `now 1-H`, `now 4-H`, `now 1-d`, `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all`. The first three tools default to US, `now 1-d`, web search, and category 0. `fresh: false` reuses saved snapshots younger than 360 minutes; `fresh: true` fetches live.

Start the server over stdio:

```sh
npx gtfa-mcp
```

Example client configuration:

```json
{
  "mcpServers": {
    "google-trends": { "command": "gtfa-mcp" }
  }
}
```

Useful environment variables: `GTFA_SNAPSHOT_DIR` and `GTFA_CHART_DIR` move the `.gtfa/snapshots` and `.gtfa/charts` stores (handy for read-only working directories), `GTFA_TZ` sets the default chart time zone, and `HTTPS_PROXY` selects an HTTP proxy. For a Chinese field guide to the MCP envelopes, see [docs/mcp-api.md](docs/mcp-api.md).

## CLI

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
npx gtfa compare coffee tea --geo US --time "today 3-m" --pretty
npx gtfa --query coffee --query tea --geo US --json
npx gtfa now --geo SG --hours 24 --limit 20 --pretty
npx gtfa now --list-geos
npx gtfa help snapshot
```

`--json` selects the agent envelope. Without it, `snapshot` prints human-readable summary lines, and `ask --validate` prints a compact table (unless `--diff`, which implies JSON). `compare`/default mode prints JSON by default, but the agent envelope requires `--json`; `now` prints raw JSON unless `--json` is set. Help prints plain text on an interactive TTY and JSON when piped or with `--json`. Diagnostics go to stderr.

## Output contract and error codes

The MCP results and the CLI agent envelopes (`ask`, `snapshot --json`, and compare/default mode with `--json`) share the outer keys `ok`, `schemaVersion` (currently `1`), `status`, the tool-specific body, optional `error`, and `meta`. `trends_now` can return a partial result with `ok: true` and still include the first per-country `error`. For `ask`/`snapshot`, `status` is `ok`, `no_data`, or `partial` on success; `blocked` and `error` set `ok: false` and include `error.code`. `trends_compare` and `trends_now` use `ok`, `partial`, and `error`; schema rejections can set `ok: false` with `error.code`. MCP results also set `isError: true` for `ok: false`. Without `--json`, compare/default mode prints the lower-level response described below.

Tool bodies:

- `trends_ask`: `term`, `summary`, `filter`, `interest`, `tables`, `regions`, optional `verdict`, `diff`, optional `diffReason`, `meta`.
- `trends_snapshot`: `term`, `summary`, `filter`, `anchor`, `traffic`, `series`, `chart`, `chart7d`, `traffic7d`, `tables`, `verdict`, `meta`.
- `trends_compare`: `filter`, `summary`, `series`, `meta`.
- `trends_now`: `hours`, `geos`, `summary`, `byGeo`, `meta`.

Errors contain `{ "code": string, "message": string, "retryAfterSec"?: number }`. The lower-level `queryTrends()` API instead returns `{ status, input, data?, error?, meta }`.

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

For batches, exit-code precedence is blocked/rate-limited, invalid input, partial success, then other errors.

## Calibration and the anchor

`snapshot` and `ask --validate` use the same gap-aware calibration:

```text
traffic = round(score ÷ anchorLevel × dailySearches)
```

`anchorLevel` is the mean of the anchor’s non-gap points in the same shared-scale comparison. The built-in baseline is in [examples/baselines.json](examples/baselines.json):

| Anchor | Geo | Daily searches | Tolerance |
| --- | --- | --- | --- |
| `gpts` | `US` | **550/day** (about 16.5k/month) | ±50% |

`traffic.low` / `traffic.high` apply that tolerance to the average. Numeric traffic is `null` when no matching geo + anchor baseline exists, or when the anchor reliability gate fails:

- at least one non-gap anchor point;
- gap-aware `anchorLevel ≥ 1` on Trends’ integer scale;
- at least 25% of non-gap anchor points nonzero.

The 24-hour Sora run above failed the third condition (`27/180` nonzero, 15%) even though `anchorLevel` was `2.72`. So `anchor.ratio` and numeric `traffic` fields are `null`, and `anchor.note` explains why. The verdict still uses related-query and series-shape signals. A 7-day run is denser and calibrates normally.

These numbers are **estimates from an anchor**, not measured Google search volume. When the requested window is not `now 7-d`, `traffic7d` and `chart7d` come from a separate 7-day fetch and give you a second check. When the request is already `now 7-d`, they reuse the primary snapshot and chart, so they are not independent.

## Rate limits

- Default spacing between upstream requests is **1000 ms** for Explore requests from the CLI/library, and **1500 ms** for Trending Now (`now` / `trends_now`) and for all MCP requests.
- `BLOCKED` and `RATE_LIMITED` are returned immediately, with no automatic retry. They trigger adaptive backoff capped at 60 s (1 s floor); successes halve the penalty.
- Transient `TRENDS_TIMEOUT`, `TRENDS_TEMPORARILY_UNAVAILABLE`, and `NETWORK_ERROR` failures may retry up to `maxRetries` (default `1`, maximum `2`). The default timeout is 8000 ms; valid values are 1000–60000 ms.
- Batches and `trends_now` stop after the first block by default; later items are reported as blocked/skipped.
- Keep workloads small. This is not suitable for bulk scraping or continuous polling, and retries or proxies do not guarantee access.

## Development

Tests use local fixtures and mocked transports; they do not call Google.

```sh
npm install
npm test          # 194 tests
npm run typecheck
npm run build
npm run trends -- --help
```

Node.js 20+ is required. `npm run build` writes JavaScript and declarations to `dist/`. The library entrypoint (`src/index.ts`) exports the client, snapshot, calibration, chart, Trending Now, and time-zone APIs.

## License

MIT. See [LICENSE](LICENSE).
