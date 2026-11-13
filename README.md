<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img alt="google-trends-for-agent" src="docs/assets/logo-light.svg" width="420">
  </picture>
</p>

<p align="center"><b>Search-interest signals for AI agents. One call in, stable JSON out.</b></p>

<p align="center">English | <a href="README.zh-CN.md">简体中文</a></p>

<p align="center"><a href="https://apify.com/meka.im/google-trends-for-agent"><img src="https://img.shields.io/badge/Apify%20Store-google--trends--for--agent-97D700?style=flat-square" alt="Apify Store"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT license"></a> <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 20"></a> <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict"> <img src="https://img.shields.io/badge/tests-422%20passed-22c55e?style=flat-square" alt="422 tests passing"> <img src="https://img.shields.io/badge/status-unofficial-orange?style=flat-square" alt="Unofficial"></p>

<p align="center"><a href="https://apify.com/meka.im/google-trends-for-agent"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/store-button-en-dark.png"><img src="docs/assets/store-button-en.png" alt="Open in Apify Store" width="231" height="44"></picture></a></p>

> [!WARNING]
> **Unofficial. Not affiliated with or endorsed by Google.** This project calls undocumented public Google Trends web endpoints that can change or fail without notice, and use may conflict with Google's Terms of Service. Use it for light, interactive analysis, not bulk scraping or an SLA.

`google-trends-for-agent` gives agents and humans a predictable way to ask how search interest is changing: a stable JSON envelope, calibrated searches/day estimates, charts, and explicit error codes instead of invented numbers.

<p align="center">
  <img src="docs/assets/demo-terminal.svg" alt="Animated gtfa snapshot command revealing the trimmed JSON envelope for Sora" width="800">
</p>
<p align="center"><sub>Real snapshot output, trimmed. The full envelope also includes the series, anchor points, per-query estimates, warnings, and metadata.</sub></p>

## Choose a route

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/routes-en-dark.png">
  <img src="docs/assets/routes-en.png" alt="Routes compared: cost per call, calls per free $5, startup overhead, rate limits, setup">
</picture>

<sub>A cold Actor can occasionally take up to ~2 min on its first call. Snapshot, warm-call and build costs: [Actor costs](docs/reference.md#actor-costs).</sub>

- **Local** — [Run one npx command →](#install--quick-start)
- **Public Actor** — [Try on Apify →](https://apify.com/meka.im/google-trends-for-agent)
- **Self-deploy** — [Fork and deploy →](#deploy-it-yourself)

### Deploy it yourself

1. [Fork the repository](https://github.com/meka-im/google-trends-for-agent/fork).
2. In Apify Console, create an Actor with **Link Git repository** (branch `main`) or run `apify push` from a clone.
3. Build it, then enable **Standby** under Settings → Server.
4. Point clients at `https://<user>--<actor>.apify.actor/mcp` with an Apify token.

Remote MCP over the public Standby endpoint. Create a token at [Apify Console → Settings → Integrations](https://console.apify.com/settings/integrations):

```json
{
  "mcpServers": {
    "google-trends": {
      "url": "https://meka-im--google-trends-for-agent.apify.actor/mcp",
      "headers": { "Authorization": "Bearer <APIFY_TOKEN>" }
    }
  }
}
```

The same open-source code serves all three routes; HTTP and one-off details are in [`.actor/README.md`](.actor/README.md).

## Install & quick start

The CLI/MCP require Node.js 20+. Nothing is published to npm; `npx` builds the package from the git checkout on first run.

```sh
npx -y -p github:meka-im/google-trends-for-agent#v0.2.2 gtfa snapshot Sora --geo US --json --pretty
```

The zero-install `npx` path builds from git on first run (~30–50 s); each later call adds ~7 s startup. For frequent use, prefer a persistent install or the MCP server.

Persistent install (clone first because npm global git installs can omit build devDependencies during `prepare`). Pack and install the tarball so the clone can be deleted afterwards:

```sh
git clone --branch v0.2.2 --depth 1 https://github.com/meka-im/google-trends-for-agent.git && cd google-trends-for-agent && npm install && npm install -g "$(npm pack | tail -1)"
```

The CLI is `gtfa`; `gtfa-mcp` runs the MCP server. Local stdio config:

```json
{
  "mcpServers": { "google-trends": { "command": "npx", "args": ["-y", "-p", "github:meka-im/google-trends-for-agent#v0.2.2", "gtfa-mcp"] } }
}
```

After the persistent install, use this config (or an absolute path to `gtfa-mcp`) to avoid resolving the GitHub package through npx on every start:

```json
{
  "mcpServers": { "google-trends": { "command": "gtfa-mcp", "args": [] } }
}
```

For a local **Streamable HTTP** endpoint (bound to `127.0.0.1`):

```sh
npx -y -p github:meka-im/google-trends-for-agent#v0.2.2 gtfa-mcp --http --port 4321   # http://127.0.0.1:4321/mcp
```

Check both package-download and data-fetch connectivity:

```sh
curl -I https://github.com
curl -I https://trends.google.com
```

If `npx …` exits 128 with empty stdout/stderr, the GitHub package fetch failed before gtfa started; inspect the npm debug log (typically `~/.npm/_logs/`). **MCP fails to start** means npx/git errors or EOF before the handshake. **MCP started but a tool fetch failed** means the handshake and `tools/list` succeed, but the tool returns `NETWORK_ERROR`, `RATE_LIMITED`, or another upstream error. Use `gtfa doctor --json` for the latter.

## dsh plugin

Prerequisites: dsh requires **Node >=24.9** and **pnpm >=10** on PATH (`allowBuilds` needs pnpm 10; tested with 10.34.6). Install dsh with `npm i -g @deepseek-ai/dsh` and pnpm with `npm i -g pnpm@10`. The gtfa CLI/MCP alone require Node 20+ (`engines.node: >=20`). Without pnpm on PATH, plugin installation fails with `spawn pnpm ENOENT` / `pnpm was not found`.

```sh
dsh plugin --profile web add github:meka-im/google-trends-for-agent
```

The first run usually prints a key and fails; a cached build in the pnpm store may pass immediately. Append the block below, using the exact key pnpm prints (ending in the commit hash), to the YAML dsh already generated at `$DSH_HOME/profiles/web/pnpm-workspace.yaml` (`DSH_HOME` defaults to `~/.dsh`). Keep all existing keys; do not overwrite the file. Then re-run the command. For another profile, replace `web` in both the command and the path:

```yaml
allowBuilds:
  "google-trends-for-agent@https://codeload.github.com/meka-im/google-trends-for-agent/tar.gz/<commit>": true
```

pnpm suggests an `onlyBuiltDependencies:` list; dsh profiles require an `allowBuilds:` map with `: true` (a list under `allowBuilds` fails). The key changes whenever main moves; re-add it after updates.

The plugin is enabled by default after install. In dsh 0.2.2-rc.1, open **dsh web → Plugins → Google Trends** (the installed-plugin card), then under **Components** click the **Google Trends / gtfa** row to open the settings page. In the **Connection** section, use the three-way **Egress** control to pick **Local (this machine)**, **Public Actor (meka.im)**, or **My own Actor**. Click **Save** to apply changes; no restart is needed. The bundle adds the four tools as native in-process tools plus a `gtfa` skill; token storage, the usage card, and Test connection are covered in the [dsh plugin reference](docs/reference.md#dsh-plugin).

Relative `snapshotDir` and `chartDir` paths resolve from the directory where `dsh web` was started (cwd); charts default to `<cwd>/.gtfa/charts/`.

## Term gallery

<table>
  <tr><th align="center">Established terms</th><th align="center">New &amp; rising terms</th></tr>
  <tr>
    <td align="center"><img src="docs/assets/traffic-notion-us-7d.svg" alt="notion US 7-day searches/day chart: peak 45.9k, latest 30.3k" width="400"><br><sub><b>notion</b> · peak 45.9k · latest 30.3k searches/day</sub></td><td align="center"><img src="docs/assets/traffic-gemini-4-carbon-us-7d.svg" alt="gemini 4 carbon US 7-day searches/day chart: peak 18.0k, latest 7.7k" width="400"><br><sub><b>gemini 4 carbon</b> · peak 18.0k · latest 7.7k searches/day</sub></td>
  </tr>
</table>
<p align="center"><sub>More charts: <a href="docs/assets/traffic-midjourney-us-7d.svg">midjourney</a> · <a href="docs/assets/traffic-genie-4-us-7d.svg">genie 4</a> · <a href="docs/assets/traffic-perplexity-us-7d.svg">perplexity</a> · <a href="docs/assets/traffic-pika-h3-us-7d.svg">pika h3</a>. Estimates calibrated to the <code>gpts</code> anchor ≈ 3,500 searches/day; US, last 7 days, labels in UTC, fetched 2026-11-12 UTC.</sub></p>

## MCP tools

| Tool | What it does |
| --- | --- |
| `trends_ask` | Interest, Popular/Rising queries, regions, optional verdict and diff. |
| `trends_snapshot` | Calibrated searches/day, anchor/traffic blocks, verdict, `chart7d` / `traffic7d`. |
| `trends_compare` | Relative 0–100 interest for 1–5 distinct keywords on one shared scale. |
| `trends_now` | Trending Now by country, with rank, growth, categories, and links. |

Inputs, time windows, defaults, and envelope fields are in the [reference](docs/reference.md) and the [MCP field guide](docs/mcp-api.md).

## CLI

| Command | What it does |
| --- | --- |
| `gtfa ask <term>` | One term, with optional `--validate`, `--diff`, `--points`, and batch `--from`. |
| `gtfa snapshot <term>` | Calibrated traffic, related queries, verdict, and SVG charts. |
| `gtfa compare <kw> [<kw> ...]` | Relative interest for 1–5 distinct keywords (also `--query` mode). |
| `gtfa now --geo US` | Trending Now by country; `--hours` is the Now window. |
| `gtfa doctor` | Check Node, Google Trends reachability, proxy, and one `gpts` US 24h fetch; `--json` for machines. |

Full flags and examples: [reference](docs/reference.md#cli-surface).

## How the numbers work

`snapshot` and `ask --validate` put the term and an anchor on one shared 0–100 scale, then compute `traffic = round(score ÷ anchorLevel × dailySearches)`. These are anchor-based estimates, not measured Google search volume. Traffic stays `null` when no calibration exists or the anchor fails its reliability gate.

| Window | Anchor | US baseline |
| --- | --- | --- |
| `now 1-H` · `now 4-H` · `now 1-d` | `sudoku` | **63,000/day**, ±50% |
| `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all` | `gpts` | **3,500/day**, ±50% |

Derivation, anchor overrides, baseline files, and null-traffic rules: [Calibration and the anchor](docs/reference.md#calibration-and-the-anchor).

## Docs

[Reference](docs/reference.md) · [MCP field guide (中文)](docs/mcp-api.md) · [Architecture](docs/assets/architecture.svg) · [Changelog](CHANGELOG.md) · [Baselines](examples/baselines.json)

## Development

Tests use local fixtures and mocked transports; they do not call Google.

```sh
npm install
npm test          # 422 tests
npm run typecheck
npm run build
npm run trends -- --help
```

## License

MIT. See [LICENSE](LICENSE).
