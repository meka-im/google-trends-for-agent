# AGENTS.md

Guidance for AI agents using `google-trends-for-agent` (`gtfa`). It queries undocumented Google Trends web endpoints. Use it for light, interactive research only—not bulk scraping or continuous polling. It is unofficial and not affiliated with Google.

## Recommended setup for Muse, GrokBot and Dots

Prefer **Apify on-demand execution** for all three clients, using either the
public `meka.im/google-trends-for-agent` Actor or the user's own deployment.
Use `https://mcp.apify.com?tools=meka.im/google-trends-for-agent` with the client's
MCP OAuth, replacing the Actor name in `tools=` for a self-deployment. If the Host
does not expose native remote MCP registration, use its authenticated Apify
connector/API and describe the integration accurately. Keep Server / Standby
disabled. See [client setup and result reading](docs/clients.md).

Local CLI/stdio is an explicit direct-access or development option for these
clients. An Apify route can still be blocked or rate-limited; stop that path and
report the result rather than switching deployments to get around it.

## Install from GitHub

The CLI/MCP require Node.js 20+. Nothing is published to npm; `npx` builds the package from the git checkout on first run.

```sh
npx -y -p github:meka-im/google-trends-for-agent gtfa --help
```

The GitHub dependency build was verified with npm 11.19.1. npm 10.9.4 can build it and then fail while packaging it with a `GitFetcher` error about a missing Arborist dependency. If you hit that error, use the clone → `npm ci` → pack flow below or upgrade npm. The CLI and installed package still require Node.js 20+.

The package installs two commands: `gtfa` (CLI) and `gtfa-mcp` (MCP server; stdio by default, or local Streamable HTTP with `--http --port 4321`). The zero-install `npx` path builds from git on first use; build time depends on the network and machine. For frequent use, prefer a persistent install or the MCP server.

Persistent install (clone first because npm global git installs can omit build devDependencies during `prepare`). Pack and install the tarball so the clone can be deleted afterwards:

```sh
git clone https://github.com/meka-im/google-trends-for-agent.git
cd google-trends-for-agent
npm ci
npm install -g "$(npm pack | tail -1)"
```

The clone tracks the repository's default `main` branch. Add your own immutable commit pin only when a review process requires one.

The packed tarball bundles the audited `apify` dependency subtree from the root lock. Scoped npm `overrides` are not inherited when this package is installed as a dependency, so the bundle—not the root override alone—protects consumer installs from re-resolving older Apify transitives. The root pins `@crawlee/core` → `minimatch` to `11.0.8`, outside Crawlee's declared `^9` range; the exact override keeps clean installs aligned with the audited lock when newer releases appear. Consumer `npm ls` may show a range warning even though the override is intentional. Audits cover both the root tree and a clean consumer install of the packed artifact. The bundled tree materially increases package size.

## MCP client config

For explicitly selected local access, use this generic stdio configuration,
which follows the repository's `main` branch. Muse, GrokBot and Dots should start
with the [Apify setup](docs/clients.md).

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "-p", "github:meka-im/google-trends-for-agent", "gtfa-mcp"]
    }
  }
}
```

After the persistent install, use this config (or an absolute path to `gtfa-mcp`) to avoid resolving the GitHub package through npx on every start:

```json
{
  "mcpServers": { "google-trends": { "command": "gtfa-mcp", "args": [] } }
}
```

The recommended remote route uses Apify's managed gateway at `https://mcp.apify.com?tools=meka.im/google-trends-for-agent`, with OAuth handled by the client. Replace the Actor in `tools=` for a self-deployment. The gateway exposes the Actor's input interface and result-reading/abort tools, not four direct `trends_*` tool names. Use `tool` / `terms`, then read the returned Dataset; for full native envelopes, use `toolRequest` and read `TOOL_RESPONSE` as described in the [client guide](docs/clients.md). Local MCP and dsh provide the four native tools. Apify requests the account-wide `full_api_access` scope.

For local MCP, restart the client, then call `trends_ask` with a single term. `trends_ask` and `trends_compare` default to US, past 24 hours, web search, all categories; `trends_now` defaults to 30 countries at 24h; explicit lists are deduped and capped at 30. `trends_snapshot` and `trends_ask` with `validate: true` pick a calibration anchor by window (see below).

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

The plugin provides four native in-process tools (`trends_ask`, `trends_snapshot`, `trends_compare`, `trends_now`) and a `gtfa` skill. By default it does not start an MCP server, run the `gtfa` CLI, or call the Actor. The plugin is enabled by default after install. In dsh 0.2.2-rc.1, open **dsh web → Plugins → Google Trends** (the installed-plugin card), then under **Components** click the **Google Trends / gtfa** row to open the settings page. In the **Connection** section, use the three-way **Egress** control to pick **Local (this machine)**, **Public Actor**, or **My own Actor**. Click **Save** to apply egress changes; no restart is needed. Egress defaults to `local`; `actor-public` relays through the public `meka.im/google-trends-for-agent` Actor, and `actor-own` relays through a deployment in your own account (deploy or pick it on the same page). Both Actor routes run on demand with the residential proxy inside the Actor.

When the dsh Host provides its credentials service, both Actor routes use Apify device OAuth first. Click **Sign in with Apify**; the page displays Apify's official authorization link and user code. The user confirms on Apify's official page, then the plugin stores the token through `ctx.credentials`; login needs no Save. Pending login checks Host status every 2 seconds, and the Host follows Apify's polling interval including `slow_down`. Closing the page pauses polling, reopening resumes, and expiry requires starting again. Apify's current device OAuth scope is only `full_api_access`: tell the user this grants full Apify API access, not access limited to this Actor or tool.

Each operation re-resolves credentials. A stored OAuth session is used first; only when none is stored does resolution use the saved `apifyToken`, then `APIFY_TOKEN`. The resolution source is `oauth`, `config`, or `env`, and the usage API's `source` includes `oauth`. If a stored OAuth session is expired or damaged and no refresh can be handled, prompt the user to sign in again; do not silently fall back to another credential or report success. OAuth credentials do not enter browser-visible state or model-visible tool input/output; Host-internal code must resolve them through the credentials service before calling Apify. For the dsh device flow, the current access token is long-lived with no refresh token; if Apify later returns standard expiry/refresh information, the plugin handles that compatible response.

OAuth session and client registration are persisted through dsh's credentials service/provider-managed store, separate from the profile. Backend location, record keys, and schema are provider-defined. When the current local file-backed provider is used, it creates an owner-only `0700` directory and `0600` file. It is not an OS Keychain, not encrypted storage, and does not prevent other processes under the same OS user from reading it. If the Host has no credentials service, OAuth is unavailable; local egress, manual token, and `APIFY_TOKEN` still work.

The manual token is an **Advanced / fallback** option. A token entered there is saved in plaintext in the profile's `cordis.patch.yml` (mode 0600), hidden in the UI, never logged, and absent from browser-visible status and model-visible tool input/output; leaving it blank with `APIFY_TOKEN` keeps it out of the profile.

**Cancel** only cancels a pending device flow. **Sign out** deletes the stored OAuth session but retains reusable client registration according to the provider backend and does not revoke the cloud authorization. The current authorization-server metadata has no `revocation_endpoint`; to invalidate cloud access, direct the user to Apify Console. Keep the tool guidance below unchanged: report `no_data` / `blocked` honestly, never invent volumes, and use it for light interactive research only.

Relative `snapshotDir` and `chartDir` paths resolve from the directory where `dsh web` was started (cwd); charts default to `<cwd>/.gtfa/charts/`.

After installing or upgrading this plugin, fully stop and restart dsh to load its backend. Reloading only the page can leave the running backend on a different plugin version.

**Test connection** checks the current connection without saving changes, then makes one fresh `trends_compare` query for ChatGPT, Gemini and weather in the US over the past 24 hours. Only egress, own-Actor selection and a newly entered or cleared manual token are submitted as temporary overrides; unchanged saved tokens remain on the Host, and OAuth keeps priority. Local preflight uses HEAD; Actor preflight checks API authentication and the latest build, then starts one usage-billed on-demand run. The page separates network status from each keyword's valid/nonzero data-point counts; only all three successful series verify data access. Challenges, rate limits, malformed data and zero-only series do not pass. Diagnostic queries never retry. The check has a 120 s overall deadline; Cancel check or closing the page aborts the request and attempts to stop its owned Actor run. The platform's 300 s timeout remains the final cloud bound during a network outage.

## Diagnose local access

For explicitly selected local CLI/MCP access, run doctor after install or when
a call fails unexpectedly. It checks that machine's route, not the Apify Actor:

```sh
npx -y -p github:meka-im/google-trends-for-agent gtfa doctor
npx -y -p github:meka-im/google-trends-for-agent gtfa doctor --json
```

It prints PASS/FAIL for Node >= 20, Google Trends reachability, proxy mode, and one live `gpts` US 24h fetch. Exit code 0 means all checks passed.

`gtfa doctor --timeout MS` accepts an integer from 1000 through 60000 and defaults to 8000 ms per network check. If reachability sees a challenge or HTTP 429, doctor skips the live `gpts` fetch.

Local CLI/MCP networking is direct by default. If this machine needs a proxy, set `HTTPS_PROXY` (preferred) or `HTTP_PROXY` to `http://host:port`; no other configuration is required. On `BLOCKED` or `RATE_LIMITED`, stop this validation path and preserve `retryAfterSec` when present; do not loop, switch routes, or invent results.

## Network egress: pick the right path

Choose the execution route before querying:

1. **Apify Actor (recommended for Muse, GrokBot and Dots).** Choose the public Actor or the user's own deployment, with on-demand execution. Remote MCP connects to Apify's managed gateway; a connector/API or dsh starts the Actor through the platform API. Runs use the on-platform residential proxy and exit after completing the result. Successful local dsh snapshot-cache hits start no cloud run. Keep Server / Standby disabled. Compute, proxy and storage usage apply; there is no fixed per-call price. A call is capped at 300 seconds of Actor runtime. Caller cancellation should abort its owned run, with the platform timeout as a final bound.
2. **Your own machine IP (explicit direct access or development).** Run the stdio server locally, or run `npx -y -p github:meka-im/google-trends-for-agent gtfa-mcp --http --port 4321` and keep it bound to `127.0.0.1`.
3. **The platform cloud VM (explicit direct access).** Run the client and server on that VM only when deliberately selected and outbound HTTPS is available. Installing `gtfa-mcp` there does not route traffic through Apify.

| Client capability | Connection |
| --- | --- |
| Muse, GrokBot or Dots with remote MCP registration | Apify's managed MCP gateway and the selected public or self-deployed Actor |
| Host without native remote MCP registration | Authenticated Apify connector/API, reported as a connector rather than native MCP |
| Explicit local access or development | CLI or stdio MCP on that machine |
| dsh native plugin | Select Local, Public Actor, or My own Actor in the plugin settings |

Check the actual Host's connection capabilities before configuring it. A cloud VM's loopback address refers to that VM, not the user's computer.

On `BLOCKED` or `RATE_LIMITED`, stop this validation path and report the error,
including `retryAfterSec` when present. Do not switch deployments or routes to
get around it.

## Tools and when to use them

| Tool | Use when | What you get |
| --- | --- | --- |
| `trends_ask` | First look at a term; check whether interest exists and what people search next to it. | Interest summary, Popular/Rising related queries, regions, optional `validate` verdict, diff vs the previous saved snapshot. |
| `trends_snapshot` | You need a calibrated searches/day estimate, a traffic curve, or a chart. | Primary-window traffic plus shape-stable `now 7-d` fields, with `anchor` / `anchor7d` showing each window's baseline. A non-primary 7-day request runs sequentially after the primary attempt unless the primary is `BLOCKED` or `RATE_LIMITED`. |
| `trends_compare` | You need relative scale: candidate vs an established term or competitor (1–5 distinct keywords). | One shared 0–100 scale, with gap-aware latest and peak per keyword. |
| `trends_now` | You need current demand: what is rising in a country today. | Ranked Trending Now items with volume bucket, growth, categories, related queries, and links; it fetches sequentially and stops after the first block or rate limit. |

Call `trends_ask` with `points: true` only when the full interest series is needed; it is omitted by default to save context. `trends_ask` (without `validate`), `trends_compare`, and `trends_now` return relative interest only; do not claim search volume from them. Only `trends_snapshot` and `trends_ask` with `validate: true` return searches/day, and those are anchor-based estimates. Snapshot Popular/Rising rows retain `estDaily` for schema compatibility, but it is always `null`; ask tables omit the field. Never derive absolute query volume from related-list values.

The native tools accept `timeoutMs` from 1000 through 60000 ms. The CLI's corresponding `gtfa ask`, `gtfa snapshot`, and `gtfa doctor` option is `--timeout MS`. Ask/snapshot Explore requests default to 30000 ms, including anchor validation and the extra 7-day request. The `--trending` lookup defaults to 15000 ms; an explicit CLI `--timeout` value is also passed to it. Doctor remains at 8000 ms per diagnostic network check. `gtfa ask --pretty` only indents JSON; `ask --validate` without `--json` still prints its table.

In `now 1-d` windows, trailing points can be 0 or low while Google back-fills. Use settled values and the window average; do not report a trailing 0 alone as a real drop. `settledLatest` excludes the last point in `now *` windows and then gaps; multiple trailing zeros can still remain. Non-`now` series with daily spacing exclude two tail points; other series exclude one. Averages exclude gaps but include unsettled tails.

If `interest.average` < 1 and both Popular/Rising tables are empty, treat the result as `no_data`: low confidence, no rising/high verdict, and null numeric traffic fields (including peaks and series traffic). Related-query evidence keeps a low-average term eligible for validation.

## Anchors and baselines

Automatic selection matches the region and window. The US defaults are below. CA, GB, AU, DE, FR and Worldwide use regional sudoku baselines in both windows; JP uses ナンプレ, and IN uses calculator. New entries use a ±75% assumption band, not a statistical confidence interval. [Regional values, source periods and validation](docs/baselines.md) document the estimates and limitations. Unknown regions still return null traffic.

`trends_snapshot`, MCP `trends_ask` with `validate: true`, and `gtfa ask --validate` calibrate relative interest into searches/day against an anchor chosen by window:

| Window | Anchor | US baseline |
| --- | --- | --- |
| `now 1-H`, `now 4-H`, `now 1-d` | `sudoku` | 63,000/day, ±50% |
| `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all` | `gpts` | 3,500/day, ±50% |

These baselines—including version 2 user anchors—apply only to **web search in category 0**. A CLI `ask --validate` filter using another property or category can still return relative interest, but `traffic` remains present with numeric fields `null` and an explanation. Baseline matching trims and uppercases `geo`; an explicit empty string remains Worldwide rather than becoming US, including in version 2 anchor rows.

The 63,000 baseline comes from the 7-day shared-scale ratio sudoku/gpts = 18.035: 18.035 × 3,500 ≈ 63,123. Cross-checking through thesaurus (7.341 × 3,500 ≈ 25,694, then × 2.441 ≈ 62,720) lands in the same place, so short and long windows sit on the same `gpts = 3,500` ruler. The 3,500 baseline is back-derived from public keyword-tool volumes for sudoku, thesaurus, and calculator through measured Trends ratios (sources in the reference). Alternates: thesaurus ≈25,700/day; chairs ≈143,000/day. The denser `sudoku` anchor avoids the sparse-24h failure that `gpts` often hits.

For a primary window other than `now 7-d`, after the primary attempt `trends_snapshot` tries a separate `now 7-d` comparison (with the region's long-window anchor unless you force one) unless the primary is `BLOCKED` or `RATE_LIMITED`; ordinary errors such as `NETWORK_ERROR` do not by themselves prevent that attempt. It reports the result as `anchor7d`. If the attempt is skipped, `chart7d` / `traffic7d` / `anchor7d` still exist as empty/null/baseline blocks with a warning. Caller cancellation or the overall deadline propagates and does not guarantee those fields. Pass MCP `anchor` or CLI `--anchor` to force one term for both windows when the extra request runs (a per-call `anchor` beats the Actor's anchor input). `GTFA_BASELINES=/path/baselines.json` loads a version 2 baselines file (`anchors` plus optional `windowAnchors.short` / `.long`) for `gtfa`, `gtfa-mcp` (stdio and `--http`), and the Actor; version 1 and unknown `windowAnchors` terms are rejected with a clear error. After changing baselines, use CLI `--fresh` or MCP `fresh: true` to bypass saved snapshots. These are estimates, not measured Google volume.

## New-term verification workflow

Use this four-step check before calling a term a real, rising trend:

1. **Existence** — `trends_ask` with `{ "term": "<term>", "geo": "US", "time": "now 1-d", "validate": true, "fresh": true }`. If `status` is `no_data` or `error`, stop and report it.
2. **Relative scale** — `trends_compare` with `{ "keywords": ["<term>", "<known anchor>"], "geo": "US", "time": "now 7-d" }`. Confirm the candidate is visible on the shared 0–100 scale, not a rounding artifact.
3. **Current corroboration** — `trends_now` with `{ "geos": ["US"], "hours": 24 }`. Look for the term or its close variants in `items` / `relatedQueries`; absence is evidence, not failure.
4. **Second window** — repeat step 1 with `time: "now 7-d"` (or re-run after 24h). Require the same direction across both windows before reporting a trend. Include the geo, window, and `fetchedAt` in your answer.

If any step returns `BLOCKED` or `RATE_LIMITED`, stop this validation run and
report the code and `retryAfterSec` when present. Report `NETWORK_ERROR` or
`TRENDS_PROTOCOL_CHANGED` without guessed numbers; use `gtfa doctor` only to
diagnose an explicitly selected local route.

During one validation run, a `BLOCKED` or `RATE_LIMITED` response stops later upstream requests by default and preserves that code and `retryAfterSec` for the affected terms. In a `--from` batch, correlate diagnostics by each result's `snapshotId`; JSON output also preserves the source lead under `input`.
