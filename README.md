<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img alt="google-trends-for-agent" src="docs/assets/logo-light.svg" width="420">
  </picture>
</p>

<p align="center"><b>Search-interest signals for AI agents. One call in, stable JSON out.</b></p>

<p align="center">English | <a href="README.zh-CN.md">简体中文</a></p>

<p align="center"><a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT license"></a> <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 20"></a> <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict"> <img src="https://img.shields.io/badge/tests-238%20passed-22c55e?style=flat-square" alt="238 tests passing"> <img src="https://img.shields.io/badge/status-unofficial-orange?style=flat-square" alt="Unofficial"></p>

> [!WARNING]
> **Unofficial. Not affiliated with or endorsed by Google.** This project calls undocumented public Google Trends web endpoints that can change or fail without notice, and use may conflict with Google's Terms of Service. Use it for light, interactive analysis, not bulk scraping or an SLA.

`google-trends-for-agent` gives agents and humans a predictable way to ask how search interest is changing: a stable JSON envelope, calibrated searches/day estimates, charts, and explicit error codes instead of invented numbers.

<p align="center">
  <img src="docs/assets/demo-terminal.svg" alt="Animated gtfa snapshot command revealing the trimmed JSON envelope for Sora" width="800">
</p>
<p align="center"><sub>Real snapshot output, trimmed. The full envelope also includes the series, anchor points, per-query estimates, warnings, and metadata.</sub></p>

## Term gallery

<table>
  <tr><th align="center">Established terms</th><th align="center">New &amp; rising terms</th></tr>
  <tr>
    <td align="center"><img src="docs/assets/traffic-notion-us-7d.svg" alt="notion US 7-day searches/day chart: peak 12.0k, latest 7.8k" width="400"><br><sub><b>notion</b> · peak 12.0k · latest 7.8k searches/day</sub></td>
    <td align="center"><img src="docs/assets/traffic-gemini-4-carbon-us-7d.svg" alt="gemini 4 carbon US 7-day searches/day chart: peak 4.4k, latest 0" width="400"><br><sub><b>gemini 4 carbon</b> · peak 4.4k · latest 0 searches/day</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/traffic-midjourney-us-7d.svg" alt="midjourney US 7-day searches/day chart: peak 4.8k, latest 3.1k" width="400"><br><sub><b>midjourney</b> · peak 4.8k · latest 3.1k searches/day</sub></td>
    <td align="center"><img src="docs/assets/traffic-genie-4-us-7d.svg" alt="genie 4 US 7-day searches/day chart: peak 3.6k, latest 0" width="400"><br><sub><b>genie 4</b> · peak 3.6k · latest 0 searches/day</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/traffic-perplexity-us-7d.svg" alt="perplexity US 7-day searches/day chart: peak 11.4k, latest 6.6k" width="400"><br><sub><b>perplexity</b> · peak 11.4k · latest 6.6k searches/day</sub></td>
    <td align="center"><img src="docs/assets/traffic-pika-h3-us-7d.svg" alt="pika h3 US 7-day searches/day chart: peak 359, latest 0" width="400"><br><sub><b>pika h3</b> · peak 359 · latest 0 searches/day</sub></td>
  </tr>
</table>
<p align="center"><sub>Estimates calibrated to the <code>gpts</code> anchor ≈ 550 searches/day; US, last 7 days, labels in UTC, fetched 2026-11-02 UTC.</sub></p>

## Install from GitHub

Requires Node.js 20+. Nothing is published to npm; `npx` builds the package from the git checkout.

```sh
# pinned release (recommended)
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa --help
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa doctor

# latest main
npx -y github:meka-im/google-trends-for-agent gtfa --help
```

For a global install, use the same git spec: `npm install -g github:meka-im/google-trends-for-agent#v0.1.0`. The package installs `gtfa` for the CLI and `gtfa-mcp` for the MCP server.

## Quick start

One snapshot, calibrated searches/day:

```sh
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa snapshot Sora --geo US --json --pretty
```

The MCP server runs over stdio by default. Point a client at the GitHub package (pin the tag for reproducibility):

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

For a local **Streamable HTTP** endpoint (bound to `127.0.0.1`), add the optional flag:

```sh
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa-mcp --http --port 4321
# MCP endpoint: http://127.0.0.1:4321/mcp
```

## Deploy to Apify

[![Deploy to Apify](https://img.shields.io/badge/Deploy%20to-Apify-FF9012?style=for-the-badge&logo=apify&logoColor=white)](https://console.apify.com/actors/new)

The Actor runs this MCP server in **Standby mode** over **Streamable HTTP** and sends Google Trends requests through an **Apify Residential proxy in the US** by default. It is the remote path for agents that cannot run local processes or reach `localhost`.

From this repository:

```sh
apify push
```

Then give the client the Standby URL and an Apify API token:

```text
https://<user>--google-trends-for-agent.apify.actor/mcp
Authorization: Bearer APIFY_TOKEN
```

```json
{
  "mcpServers": {
    "google-trends": {
      "url": "https://<user>--google-trends-for-agent.apify.actor/mcp",
      "headers": { "Authorization": "Bearer APIFY_TOKEN" }
    }
  }
}
```

The hostname uses your Apify username with dots replaced by hyphens (for example, `meka.im` becomes `meka-im`, so `https://meka-im--google-trends-for-agent.apify.actor/mcp`). The Actor console also shows the exact Standby URL.

The Actor charges nothing. Apify Residential proxy traffic is billed per GB from your Apify credits at your plan's proxy rate; see the Apify Console for current pricing. Keep calls light: `trends_now` over many countries consumes more proxy traffic than a single `trends_ask`. Actor configuration and Store notes live in [`.actor/README.md`](.actor/README.md).

## MCP tools

| Tool | What it does |
| --- | --- |
| `trends_ask` | Interest, Popular/Rising queries, regions, optional verdict and diff. |
| `trends_snapshot` | Calibrated searches/day, anchor/traffic blocks, verdict, `chart7d` / `traffic7d`. |
| `trends_compare` | Relative 0–100 interest for 2–5 keywords on one shared scale. |
| `trends_now` | Trending Now by country, with rank, growth, categories, and links. |

Inputs, time windows, defaults, and envelope fields are in the [reference](docs/reference.md) and the [MCP field guide](docs/mcp-api.md).

## CLI

| Command | What it does |
| --- | --- |
| `gtfa ask <term>` | One term, with optional `--validate`, `--diff`, `--points`, and batch `--from`. |
| `gtfa snapshot <term>` | Calibrated traffic, related queries, verdict, and SVG charts. |
| `gtfa compare <kw> <kw> [...]` | Relative interest for 1–5 keywords (also `--query` mode). |
| `gtfa now` | Trending Now by country; `--hours` is the Now window. |
| `gtfa doctor` | Check Node, Google Trends reachability, proxy, and one `gpts` US 24h fetch; `--json` for machines. |

Full flags and examples: [reference](docs/reference.md#cli-surface).

## Anchors and how the numbers work

`snapshot` puts the term and one anchor on a shared 0–100 scale, then calibrates with `traffic = round(score ÷ anchorLevel × dailySearches)`. The anchor is automatic by window; `--anchor` / MCP `anchor` forces one for every window.

| Window | Anchor | Baseline | How derived |
| --- | --- | --- | --- |
| `now 1-H`, `now 4-H`, `now 1-d` | `sudoku` | **9,900/day** US, ±50% | 7-day shared-scale ratio sudoku/gpts = 18.035 → 18.035 × 550 ≈ 9,919; thesaurus cross-check ≈9,857. Both round to ≈9,900. |
| `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all` | `gpts` | **550/day** US, ±50% | About 16.5k/month; the long-window ruler. |

Why 9,900: the 7-day shared-scale ratio sudoku/gpts is 18.035, so 18.035 × 550 ≈ 9,919. Cross-check through thesaurus: thesaurus/gpts 7.341 × 550 ≈ 4,038, then sudoku/thesaurus 2.441 × 4,038 ≈ 9,857. Both round to ≈9,900, so 1-hour/1-day and 7-day estimates sit on the same ruler (`gpts = 550`). Alternates: thesaurus ≈4,000/day is closer to small AI terms but has zero points at night; chairs ≈22,500/day is 100% nonzero but flattens very small terms. Anchors that are too big (weather, calculator, pizza) crush small terms. Methods: [Krazydad on comparing Trends scales](https://blog.krazydad.com/2018/05/18/comparing-apples-oranges-and-futoshikis-using-google-trends/) and [G-TAB](https://arxiv.org/abs/2007.13861).

`baselines.json` can override or add anchors. Version 2 only (`version: 1` is rejected), and every `windowAnchors` term must exist in `anchors` or the built-ins:

```sh
# baselines.json: override sudoku, keep the automatic short/long mapping
{"version":2,"anchors":[{"term":"sudoku","geo":"US","dailySearches":9900},{"term":"gpts","geo":"US","dailySearches":550}],"windowAnchors":{"short":"sudoku","long":"gpts"}}
GTFA_BASELINES=/path/to/baselines.json gtfa snapshot Sora --json
```

- Numeric traffic stays `null` unless the anchor has a non-gap point, `anchorLevel ≥ 1`, and at least 25% of non-gap points are nonzero. The denser `sudoku` anchor keeps short windows from failing that gate.
- These are anchor-based **estimates**, not measured Google search volume. When the request is not `now 7-d`, `traffic7d` / `chart7d` come from a separate 7-day fetch that uses the 7-day anchor (`gpts`) unless you passed an explicit anchor; `anchor7d` reports that window's baseline. For `now 7-d`, they reuse the primary snapshot and chart.
- Failures stay explicit: `ok`, `status`, and `error.code` replace invented numbers, and partial results are reported rather than hidden.

## Docs

- [Reference: CLI, MCP envelopes, exit codes, calibration, limits](docs/reference.md)
- [MCP API field guide (中文)](docs/mcp-api.md)
- [Architecture](docs/assets/architecture.svg)
- [Changelog](CHANGELOG.md)
- [Baselines](examples/baselines.json)

## Development

Tests use local fixtures and mocked transports; they do not call Google.

```sh
npm install
npm test          # 238 tests
npm run typecheck
npm run build
npm run trends -- --help
```

Node.js 20+ is required. `npm run build` writes JavaScript and declarations to `dist/`. The library entrypoint (`src/index.ts`) exports the client, snapshot, calibration, chart, Trending Now, and time-zone APIs.

## License

MIT. See [LICENSE](LICENSE).
