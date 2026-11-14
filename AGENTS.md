# AGENTS.md

Guidance for AI agents using `google-trends-for-agent` (`gtfa`). It queries undocumented Google Trends web endpoints. Use it for light, interactive research only—not bulk scraping or continuous polling. It is unofficial and not affiliated with Google.

## Install from GitHub

The CLI/MCP require Node.js 20+. Nothing is published to npm; `npx` builds the package from the git checkout on first run.

```sh
# Pinned reviewed commit (recommended; not a release tag)
npx -y -p github:meka-im/google-trends-for-agent#8304fab20544c877ab0f38a461d96c0ec3f69656 gtfa --help

# Latest main
npx -y -p github:meka-im/google-trends-for-agent gtfa --help
```

The full-SHA GitHub `npx` entry was verified with npm 11.19.1. npm 10.9.4 can build the same full-SHA dependency and then fail while packaging it with a `GitFetcher` error about a missing Arborist dependency. If you hit that error, use the clone → checkout → `npm ci` → pack flow below or upgrade npm. The CLI and installed package still require Node.js 20+.

The package installs two commands: `gtfa` (CLI) and `gtfa-mcp` (MCP server; stdio by default, or local Streamable HTTP with `--http --port 4321`). The zero-install `npx` path builds from git on first use; build time depends on the network and machine. For frequent use, prefer a persistent install or the MCP server.

Persistent install (clone first because npm global git installs can omit build devDependencies during `prepare`). Pack and install the tarball so the clone can be deleted afterwards:

```sh
git clone https://github.com/meka-im/google-trends-for-agent.git
cd google-trends-for-agent
git checkout --detach 8304fab20544c877ab0f38a461d96c0ec3f69656
npm ci
npm install -g "$(npm pack | tail -1)"
```

The packed tarball bundles the audited `apify` dependency subtree from the root lock. Scoped npm `overrides` are not inherited when this package is installed as a dependency, so the bundle—not the root override alone—protects consumer installs from re-resolving older Apify transitives. The root explicitly overrides `@crawlee/core` → `minimatch` to `^11.0.1` (lock: `11.0.8`), outside Crawlee's declared `^9` range; consumer `npm ls` may therefore show a range warning even though the override is intentional. Audits cover both the root tree and a clean consumer install of the packed artifact. The bundled tree materially increases package size.

## MCP client config

Use this generic stdio configuration. The full SHA is a reviewed source commit, not a release tag; omit it only to follow `main`:

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "-p", "github:meka-im/google-trends-for-agent#8304fab20544c877ab0f38a461d96c0ec3f69656", "gtfa-mcp"]
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

Restart the client, then call `trends_ask` with a single term. `trends_ask` and `trends_compare` default to US, past 24 hours, web search, all categories; `trends_now` defaults to 30 countries at 24h; explicit lists are deduped and capped at 30. `trends_snapshot` and `trends_ask` with `validate: true` pick a calibration anchor by window (see below).

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

This adds the same four tools (`trends_ask`, `trends_snapshot`, `trends_compare`, `trends_now`) as native in-process tools plus a `gtfa` skill. By default it does not start an MCP server, run the `gtfa` CLI, or call the Actor. The plugin is enabled by default after install. In dsh 0.2.2-rc.1, open **dsh web → Plugins → Google Trends** (the installed-plugin card), then under **Components** click the **Google Trends / gtfa** row to open the settings page. In the **Connection** section, use the three-way **Egress** control to pick **Local (this machine)**, **Public Actor (meka.im)**, or **My own Actor**. Click **Save** to apply changes; no restart is needed. Egress defaults to `local`; `actor-public` relays through the public `meka.im/google-trends-for-agent` Actor, and `actor-own` relays through a deployment in your own account (deploy or pick it on the same page). Both Actor routes work on the Free plan because the residential proxy runs inside the Actor. Set the Apify token there or leave it empty to use `APIFY_TOKEN`. A token entered in the UI is saved in plaintext in the profile's `cordis.patch.yml` (mode 0600), hidden in the UI and never logged or returned; leaving it blank with `APIFY_TOKEN` keeps it out of the profile. Keep the tool guidance below unchanged: report `no_data` / `blocked` honestly, never invent volumes, and use it for light interactive research only.

Relative `snapshotDir` and `chartDir` paths resolve from the directory where `dsh web` was started (cwd); charts default to `<cwd>/.gtfa/charts/`.

The settings page's **Test connection** check calls Actor `/health` once when applicable and then one HEAD probe. A Google challenge or HTTP 429 ends the check; do not trigger repeated probes.

## Verify networking first

Run the doctor once after install, or whenever a call fails unexpectedly:

```sh
npx -y -p github:meka-im/google-trends-for-agent#8304fab20544c877ab0f38a461d96c0ec3f69656 gtfa doctor
npx -y -p github:meka-im/google-trends-for-agent#8304fab20544c877ab0f38a461d96c0ec3f69656 gtfa doctor --json
```

It prints PASS/FAIL for Node >= 20, Google Trends reachability, proxy mode, and one live `gpts` US 24h fetch. Exit code 0 means all checks passed.

`gtfa doctor --timeout MS` accepts an integer from 1000 through 60000 and defaults to 8000 ms per network check. If reachability sees a challenge or HTTP 429, doctor skips the live `gpts` fetch.

Networking is direct by default. If this machine needs a proxy, set `HTTPS_PROXY` (preferred) or `HTTP_PROXY` to `http://host:port`; no other configuration is required. On `RATE_LIMITED`, wait `retryAfterSec` and retry once at most. On `BLOCKED`, stop and report—do not loop, rotate requests, or invent results.

## Network egress: pick the right path

Google Trends answers the same IPs it sees as ordinary browsers more often than data-center ranges. Choose egress in this order:

1. **Your own machine IP (preferred).** Run the stdio server locally, or run `npx -y -p github:meka-im/google-trends-for-agent#8304fab20544c877ab0f38a461d96c0ec3f69656 gtfa-mcp --http --port 4321` and keep it bound to `127.0.0.1`. This is the least likely path to trigger a challenge.
2. **The platform cloud VM.** Run the client and server on the same machine when that machine is allowed to make outbound HTTPS requests. Data-center IPs are challenged more often, so keep calls sparse and run `gtfa doctor` when a call fails.
3. **Apify Actor.** Use this for remote-only agents that cannot reach your machine, or when a direct/platform IP is rate-limited. Deploy the Actor and connect to `https://<user>--google-trends-for-agent.apify.actor/mcp` with `Authorization: Bearer APIFY_TOKEN` (dots in the username become hyphens, e.g. `https://meka-im--google-trends-for-agent.apify.actor/mcp`). The dsh plugin's `actor-public` and `actor-own` egress routes use the same Actor over `/egress/fetch`. The Actor sets `HTTPS_PROXY` from Apify Proxy on-platform, so the Free plan's RESIDENTIAL group works, and rotates the proxy session on HTTP 429 or a Google challenge. Residential proxy traffic is billed per GB from your Apify credits. A single-tenant Standby run bills compute while idle; the Actor exits after 60 s without requests.

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
| `trends_snapshot` | You need a calibrated searches/day estimate, a traffic curve, or a chart. | Primary-window traffic plus shape-stable `now 7-d` fields, with `anchor` / `anchor7d` showing each window's baseline. A non-primary 7-day request runs sequentially after the primary attempt unless the primary is `BLOCKED` or `RATE_LIMITED`. |
| `trends_compare` | You need relative scale: candidate vs an established term or competitor (1–5 distinct keywords). | One shared 0–100 scale, with gap-aware latest and peak per keyword. |
| `trends_now` | You need current demand: what is rising in a country today. | Ranked Trending Now items with volume bucket, growth, categories, related queries, and links; it fetches sequentially and stops after the first block or rate limit. |

Call `trends_ask` with `points: true` only when the full interest series is needed; it is omitted by default to save context. `trends_ask` (without `validate`), `trends_compare`, and `trends_now` return relative interest only; do not claim search volume from them. Only `trends_snapshot` and `trends_ask` with `validate: true` return searches/day, and those are anchor-based estimates. Snapshot Popular/Rising rows retain `estDaily` for schema compatibility, but it is always `null`; ask tables omit the field. Never derive absolute query volume from related-list values.

The native tools accept `timeoutMs` from 1000 through 60000 ms. The CLI's corresponding `gtfa ask`, `gtfa snapshot`, and `gtfa doctor` option is `--timeout MS`. Ask/snapshot default to 8000 ms per Explore request, including anchor validation, `--trending`, and the extra 7-day request; doctor defaults to 8000 ms per diagnostic network check.

In `now 1-d` windows, trailing points can be 0 or low while Google back-fills. Use settled values and the window average; do not report a trailing 0 alone as a real drop. `settledLatest` excludes the last point in `now *` windows and then gaps; multiple trailing zeros can still remain. Non-`now` series with daily spacing exclude two tail points; other series exclude one. Averages exclude gaps but include unsettled tails.

If `interest.average` < 1 and both Popular/Rising tables are empty, treat the result as `no_data`: low confidence, no rising/high verdict, and null numeric traffic fields (including peaks and series traffic). Related-query evidence keeps a low-average term eligible for validation.

## Anchors and baselines

`trends_snapshot`, MCP `trends_ask` with `validate: true`, and `gtfa ask --validate` calibrate relative interest into searches/day against an anchor chosen by window:

| Window | Anchor | US baseline |
| --- | --- | --- |
| `now 1-H`, `now 4-H`, `now 1-d` | `sudoku` | 63,000/day, ±50% |
| `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all` | `gpts` | 3,500/day, ±50% |

These baselines—including version 2 user anchors—apply only to **web search in category 0**. A CLI `ask --validate` filter using another property or category can still return relative interest, but `traffic` remains present with numeric fields `null` and an explanation. Baseline matching trims and uppercases `geo`; an empty string remains Worldwide rather than becoming US, and `parseBaselines` rejects empty-geo anchor rows.

The 63,000 baseline comes from the 7-day shared-scale ratio sudoku/gpts = 18.035: 18.035 × 3,500 ≈ 63,123. Cross-checking through thesaurus (7.341 × 3,500 ≈ 25,694, then × 2.441 ≈ 62,720) lands in the same place, so short and long windows sit on the same `gpts = 3,500` ruler. The 3,500 baseline is back-derived from public keyword-tool volumes for sudoku, thesaurus, and calculator through measured Trends ratios (sources in the reference). Alternates: thesaurus ≈25,700/day; chairs ≈143,000/day. The denser `sudoku` anchor avoids the sparse-24h failure that `gpts` often hits.

For a primary window other than `now 7-d`, after the primary attempt `trends_snapshot` tries a separate `now 7-d` comparison (with `gpts` unless you force an anchor) unless the primary is `BLOCKED` or `RATE_LIMITED`; ordinary errors such as `NETWORK_ERROR` do not by themselves prevent that attempt. It reports the result as `anchor7d`. If the attempt is skipped, `chart7d` / `traffic7d` / `anchor7d` still exist as empty/null/baseline blocks with a warning. Caller cancellation or the overall deadline propagates and does not guarantee those fields. Pass MCP `anchor` or CLI `--anchor` to force one term for both windows when the extra request runs (a per-call `anchor` beats the Actor's anchor input). `GTFA_BASELINES=/path/baselines.json` loads a version 2 baselines file (`anchors` plus optional `windowAnchors.short` / `.long`) for `gtfa`, `gtfa-mcp` (stdio and `--http`), and the Actor; version 1 and unknown `windowAnchors` terms are rejected with a clear error. After changing baselines, use CLI `--fresh` or MCP `fresh: true` to bypass saved snapshots. These are estimates, not measured Google volume.

## New-term verification workflow

Use this four-step check before calling a term a real, rising trend:

1. **Existence** — `trends_ask` with `{ "term": "<term>", "geo": "US", "time": "now 1-d", "validate": true, "fresh": true }`. If `status` is `no_data` or `error`, stop and report it.
2. **Relative scale** — `trends_compare` with `{ "keywords": ["<term>", "<known anchor>"], "geo": "US", "time": "now 7-d" }`. Confirm the candidate is visible on the shared 0–100 scale, not a rounding artifact.
3. **Current corroboration** — `trends_now` with `{ "geos": ["US"], "hours": 24 }`. Look for the term or its close variants in `items` / `relatedQueries`; absence is evidence, not failure.
4. **Second window** — repeat step 1 with `time: "now 7-d"` (or re-run after 24h). Require the same direction across both windows before reporting a trend. Include the geo, window, and `fetchedAt` in your answer.

If any step returns `RATE_LIMITED`, wait `retryAfterSec` and retry once. If it returns `BLOCKED`, `NETWORK_ERROR`, or `TRENDS_PROTOCOL_CHANGED`, run `gtfa doctor`, report the error code, and do not substitute guessed numbers.

During one validation run, a `BLOCKED` or `RATE_LIMITED` response stops later upstream requests by default and preserves that code and `retryAfterSec` for the affected terms. In a `--from` batch, correlate diagnostics by each result's `snapshotId`; JSON output also preserves the source lead under `input`.
