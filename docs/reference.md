# Reference

Operational detail for the CLI, the MCP server, the dsh plugin, and the numbers behind `snapshot`. For a Chinese field guide to MCP envelopes, see [mcp-api.md](mcp-api.md). Install and a short tour are in the [README](../README.md) and [AGENTS.md](../AGENTS.md). From a checkout, run `npm install && npm run build`, then `node dist/cli.js --help`.

## CLI surface

The package installs `gtfa` for the CLI and `gtfa-mcp` for the MCP server (Node.js 20+). Use `npx -y -p google-trends-for-agent` for zero-install execution, or install globally from npm:

```sh
npm install -g google-trends-for-agent
```

Or build from a local source checkout:

```sh
git clone https://github.com/meka-im/google-trends-for-agent.git
cd google-trends-for-agent
npm ci
npm install -g "$(npm pack | tail -1)"
```

Pin a published npm version or git commit if a review process requires an immutable source revision.

| Command | Flags | Purpose |
| --- | --- | --- |
| `gtfa ask <term>` | `--validate`, `--from FILE\|-`, `--anchor TERM`, `--no-anchor`, `--trending`, `--diff`, `--points`, `--fresh`, `--refresh always\|never\|if-stale`, `--max-age MIN`, `--geo`, `--time`, `--category`, `--property`, `--store DIR`, `--egress local\|actor-public\|actor-own`, `--actor ID`, `--timeout MS`, `--json`, `--pretty`, `--help` | One term: interest, Popular/Rising, regions, optional verdict, and diff. `--timeout` applies to each Explore request. |
| `gtfa snapshot <term>` | `--geo`, `--time`, `--anchor`, `--fresh`, `--max-age MIN`, `--store DIR`, `--chart-dir DIR`, `--tz IANA`, `--svg`, `--egress local\|actor-public\|actor-own`, `--actor ID`, `--timeout MS`, `--json`, `--pretty`, `--help` | Multi-tier MEKA calibrated searches/day, traffic series, verdict, charts, and chart paths. `--timeout` applies to the primary, retry, and extra 7-day requests. |
| `gtfa compare <kw> [<kw> ...]` | `--url URL` (repeatable), `--geo`, `--time`, `--start YYYY-MM-DD`, `--end YYYY-MM-DD`, `--types LIST`, `--calibrate`, `--egress local\|actor-public\|actor-own`, `--actor ID`, `--format json\|csv`, `--json`, `--timeout MS`, `--retries N`, `--min-interval MS`, `--pretty`, `--help`, `--version` | Relative interest for 1–5 distinct keywords (optional `--calibrate` attaches `batchVolume`). The default `--query` mode is the same command. |
| `gtfa now --geo US` | `--geo US,SG,JP`, `--all-geos`, `--default-geos`, `--list-geos`, `--hours 4\|24\|48\|168`, `--min-volume N`, `--category 18,17`, `--limit N`, `--lang en`, `--egress local\|actor-public\|actor-own`, `--actor ID`, `--format json\|csv`, `--json`, `--pretty`, `--timeout MS`, `--min-interval MS`, `--help` | Trending Now by country. `--hours` is the Trending Now window, not the Explore `--time` range. |
| `gtfa baselines` | `--sync`, `--store DIR`, `--json`, `--pretty`, `--help` | Inspect active MEKA v1 calibration baselines status or manually sync from `meka.im`. |
| `gtfa doctor` | `--timeout MS`, `--json`, `--pretty`, `--help` | Checks Node.js >= 20, Google Trends reachability, proxy mode, and one live `gpts` US 24h fetch. `--timeout` accepts 1000–60000 and defaults to 8000 ms for each network check; a challenge or HTTP 429 skips the live fetch. Exit 0 only when all checks pass. |

Examples below assume a global `gtfa`; without one, replace `gtfa` with `npx -y -p google-trends-for-agent gtfa`. `--types` accepts `interestOverTime`, `interestByCity`, `interestByMetro`, `interestBySubregion`, `relatedQueries`, or `relatedTopics`. `--start` and `--end` must be used together; do not combine Explore URLs with `--query`. Defaults are US, `now 7-d`, web, category 0, except where a command says otherwise. `compare` and the default `--query` mode honor omitted `geo`, `time`, `category`, `property`, and `locale` (`hl`) from `gtfa.config.json`; `GTFA_GEO` and `GTFA_TIME` supply their respective environment defaults. Explore URL plans keep the URL's filters, and explicit dates keep their dates. Chart time zones resolve as explicit `--tz` / `tz`, then `GTFA_TZ`, then `UTC`.

```sh
gtfa ask "nano banana" --validate --diff --json
cat leads.json | gtfa ask --validate --from - --json
gtfa snapshot Sora --geo US --svg --tz Asia/Shanghai --fresh --json
gtfa compare coffee tea --geo US --time "today 3-m" --calibrate --json --pretty
gtfa --query coffee --query tea --geo US --json
gtfa now --geo SG --hours 24 --limit 20 --pretty
gtfa now --geo US --list-geos
gtfa baselines --sync --json
gtfa doctor --json
gtfa help snapshot
```

`--from FILE|-` requires `--validate` and reads JSON from a file or stdin (`-`). Accepted shapes: a string; an object whose first non-null field among `name`, `term`, `keyword` is a nonblank string; a mixed array of those; or an object with an array under `leads`, `rows`, `keywords`, or `table` (first matching wrapper wins). Arrays/wrappers can nest. Object metadata `variants` (string array), `source`, `url`, and `firstSeen` (strings) is not queried. In JSON output, each source object is preserved under the result's `input` field, including that metadata. All rows use the CLI filters; per-row `geo`/`time` do not override them. The CLI reads each saved result back by its `snapshotId`, so a concurrent diagnostic write for the same term/filter is not substituted for it. In the default stop-on-blocked mode, the first `BLOCKED` or `RATE_LIMITED` response prevents all later upstream requests; affected rows retain the same error code and `retryAfterSec` when present. Minimal `leads.json`:

```json
["sora", {"term": "nano banana"}]
```

`--diff` implies a fresh fetch and JSON output, overrides `--refresh` (including `never`), and still saves the new snapshot. It compares the current successful snapshot with the latest usable prior success for the same term + filter; the first successful fetch returns `diff: null` with `diffReason: "Need two snapshots"`.

`--json` selects the agent envelope. Without it, `snapshot` prints human-readable summary lines, and `ask --validate` prints a compact table (unless `--diff`, which implies JSON). `compare`/default mode prints JSON by default, but the agent envelope requires `--json`; `now` prints raw JSON unless `--json` is set. Help prints plain text on an interactive TTY and JSON when piped or with `--json`. Diagnostics go to stderr.

`gtfa ask`, `gtfa snapshot`, and `gtfa doctor` accept `--timeout MS` as an integer from 1000 through 60000. Ask/snapshot default to 30000 ms per Explore request; ask passes the value to its primary term request, anchor validation comparison, `--trending` lookup, and any secondary request, while snapshot passes it to the primary comparison and, when applicable, the extra `now 7-d` comparison. Doctor remains at 8000 ms per diagnostic network check, and Trending Now remains at 15000 ms. MCP, dsh, and Actor tools use the same Explore default. `gtfa ask --pretty` indents JSON for ordinary asks, validation batches, diffs, and structured errors; `ask --validate` without `--json` still prints its table.

`gtfa now --format csv` uses RFC 4180 text rules, including doubled quotes around fields that contain quotes, commas, or line breaks. Array-valued fields such as categories and related queries are serialized as JSON first and then CSV-encoded. Text that could be interpreted as a spreadsheet formula is neutralized before writing so exported Trending Now rows cannot execute as formulas when opened in a spreadsheet.

## MCP tools

The stdio server exposes exactly four tools. HTTP and Actor tool calls share the same definitions.

| Tool | Inputs | What it returns |
| --- | --- | --- |
| `trends_ask` | `term` (required); `geo` (`US`); `time` (`now 7-d`); `fresh` (`false`); `validate` (`false`); `points` (`false`); `timeoutMs` (30000) | Interest, Popular/Rising queries, regions, optional verdict, diff vs the previous saved snapshot. `points: true` includes the full series. |
| `trends_snapshot` | `term` (required); `geo` (`US`); `time` (`now 7-d`); `anchor` (optional; automatic when omitted); `fresh` (`false`); `svg` (`false`); `tz` (`GTFA_TZ`, then `UTC`); `timeoutMs` (30000) | Multi-tier MEKA calibrated searches/day, `anchor` / `anchor7d`, `traffic`, `calibration` (including automatic 2nd-round tier retry when unpinned and out of range), series, verdict, related queries, and shape-stable `chart7d` / `traffic7d`. A non-`now 7-d` primary triggers a sequential 7-day request unless the primary is `BLOCKED` or `RATE_LIMITED`. |
| `trends_compare` | `keywords` (1–5 distinct, required); `geo` (`US`); `time` (`now 7-d`); `calibrate` (`false`); `timeoutMs` (30000) | Relative 0–100 interest for each keyword on one shared scale, with gap-aware latest/peak; `calibrate: true` attaches multi-tier MEKA `batchVolume`. Duplicate keywords return `INVALID_INPUT`. |
| `trends_now` | `geos` (array of up to 30 distinct country codes after dedupe, `"default"`, or `"all"`; default `"default"` = 30 countries); `hours` (`4`, `24`, `48`, or `168`; default `24`); `limit` (integer ≥ 0; default `10`); `timeoutMs` (15000) | Trending Now items per country, with rank, traffic bucket, growth, categories, related queries, and links. |

`time` is one of `now 1-H`, `now 4-H`, `now 1-d`, `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all`. The first three tools default to US, `now 7-d`, web search, and category 0. `fresh: false` reuses saved snapshots younger than 360 minutes; `fresh: true` fetches live. Anchors come from the unified **MEKA v1 regional baseline catalog** (59 anchors across US, CA, GB, DE, FR, JP, and Worldwide; see [regional baselines](baselines.md)). An explicit MCP `anchor` or CLI `--anchor` overrides both the requested and the extra 7-day window when that extra request runs.

`trends_ask` always returns `diff`, comparing the current snapshot with the latest usable prior success, even on cache hits. Store keys and matching trim and lowercase keywords; responses preserve the requested spelling. Only complete `status: "ok"` snapshots without errors or the low-sample gate participate. Failed, partial, blocked, and no-data snapshots are still saved on disk for diagnostics, but never used as diff baselines. Only `ok` / `no_data` snapshots are reused as cached responses (default 360 minutes); failed/partial/blocked fetches are fetched again. A cache hit creates no snapshot. With no usable pair, `diff` is `null` with a clear `diffReason` (first success: `"Need two snapshots"`; failed current fetch: `"Current snapshot has no usable successful data"`; no usable prior success or incompatible history gets its own reason). Incompatible history never rejects valid input or aborts a batch. Use `fresh: true` to fetch and save a new comparison point (CLI `--diff` forces this).

### Remote MCP authentication

Muse, GrokBot and Dots should use Apify on demand by default, selecting either
the public Actor or a self-deployment. Use an authenticated Apify connector/API
if native remote MCP registration is unavailable. The
[client guide](clients.md) covers setup and result reading. Remote MCP connects
to Apify's managed gateway:

```json
{ "mcpServers": { "google-trends": { "url": "https://mcp.apify.com?tools=meka.im/google-trends-for-agent" } } }
```

For a self-deployment, replace the Actor in `tools=` with the accessible
`<username>/<actor-name>` from the signed-in account.

The gateway handles client OAuth and exposes the Actor's input interface, run state, Dataset, key-value-store, and abort tools. Each query starts an on-demand Actor run. Local MCP and dsh provide the four native `trends_*` tools. Apify's account-wide `full_api_access` scope must be disclosed before authorization. Use the client's credential storage for Bearer fallback if OAuth is unavailable.

Useful environment variables: `GTFA_EGRESS` (`local` | `actor-public` | `actor-own`) and `GTFA_APIFY_ACTOR` configure cloud egress for `gtfa` and `gtfa-mcp` (paired with `APIFY_TOKEN`, or overridden via `--egress` / `--actor`), `GTFA_SNAPSHOT_DIR` and `GTFA_CHART_DIR` move the `.gtfa/snapshots` and `.gtfa/charts` stores (handy for read-only working directories), `GTFA_BASELINES` points at a version 2 baselines file (CLI, `gtfa-mcp`, and the Actor), `GTFA_TZ` sets the default chart time zone, and `HTTPS_PROXY` / `HTTP_PROXY` select a proxy (`HTTPS_PROXY` wins, lowercase variants are honored). With neither set, requests go direct. `gtfa doctor` reports which mode is active.

After the persistent install, use this config (or an absolute path to `gtfa-mcp`) to avoid resolving the GitHub package through npx on every start:

```json
{
  "mcpServers": { "google-trends": { "command": "gtfa-mcp", "args": [] } }
}
```

Check both package-download and data-fetch connectivity:

```sh
curl -I https://github.com
curl -I https://trends.google.com
```

If `npx …` exits 128 with empty stdout/stderr, the GitHub package fetch failed before gtfa started; inspect the npm debug log (typically `~/.npm/_logs/`). **MCP fails to start** means npx/git errors or EOF before the handshake. **MCP started but a tool fetch failed** means the handshake and `tools/list` succeed, but the tool returns `NETWORK_ERROR`, `RATE_LIMITED`, or another upstream error. Use `gtfa doctor --json` for the latter.

## dsh plugin

Prerequisites: dsh requires **Node >=24.9** and **pnpm >=10** on PATH (`allowBuilds` needs pnpm 10; tested with 10.34.6). Install dsh with `npm i -g @deepseek-ai/dsh` and pnpm with `npm i -g pnpm@10`. The gtfa CLI/MCP alone require Node 20+ (`engines.node: >=20`). Without pnpm on PATH, plugin installation fails with `spawn pnpm ENOENT` / `pnpm was not found`.

`dsh plugin --profile web add github:meka-im/google-trends-for-agent` mounts the bare `google-trends-for-agent` row (`gtfa`). The bundle registers four native in-process tools and a `gtfa` skill. By default it does not use MCP, the Actor endpoint, the `gtfa` CLI, or `@modelcontextprotocol/sdk`; the `actor-public` and `actor-own` egress routes call an Actor.

The first run usually prints a key and fails; a cached build in the pnpm store may pass immediately. Append the block below, using the exact key pnpm prints (ending in the commit hash), to the YAML dsh already generated at `$DSH_HOME/profiles/web/pnpm-workspace.yaml` (`DSH_HOME` defaults to `~/.dsh`). Keep all existing keys; do not overwrite the file. Then re-run the command. For another profile, replace `web` in both the command and the path:

```yaml
allowBuilds:
  "google-trends-for-agent@https://codeload.github.com/meka-im/google-trends-for-agent/tar.gz/<commit>": true
```

pnpm suggests an `onlyBuiltDependencies:` list; dsh profiles require an `allowBuilds:` map with `: true` (a list under `allowBuilds` fails). The key changes whenever main moves; re-add it after updates.

The plugin is enabled by default after install. In dsh 0.2.2-rc.1, open **dsh web → Plugins → Google Trends** (the installed-plugin card), then under **Components** click the **Google Trends / gtfa** row to open the settings page. In the **Connection** section, use the three-way **Egress** control to pick **Local (this machine)**, **Public Actor**, or **My own Actor**. Click **Save** to apply egress changes; no restart is needed.

### Apify OAuth and credential resolution

When the dsh Host provides a credentials service, both Actor routes offer **Sign in with Apify**; without that service, OAuth is shown as unavailable while local egress, the manual token, and `APIFY_TOKEN` remain usable. The flow uses Apify's official standard RFC 8628 device OAuth, including client registration through Apify's official endpoints. The page displays Apify's official authorization link and user code. After the user confirms there, the plugin stores the token in the background through `ctx.credentials`. Login does not require **Save**.

While pending, the page checks Host status every 2 seconds, and the Host follows Apify's polling interval, including `slow_down`. Closing the page pauses polling, reopening resumes it, and expiration requires starting a new attempt. OAuth session and client-registration persistence is delegated to the Host credentials service. Backend location, record keys, and schema are provider-defined.

Each operation re-resolves credentials. A stored OAuth session is used first; only when none is stored does resolution use the saved config `apifyToken`, then `APIFY_TOKEN`. Resolution sources are `oauth`, `config`, and `env`; the usage API also reports `source: "oauth"` when applicable. If a stored OAuth session is expired or damaged and no refresh can be handled, the user must sign in again; do not silently fall back to another credential or report success.

For the dsh device flow, the current access token is long-lived and no refresh token is issued. If Apify later returns standard expiry/refresh information, the dsh plugin can process that compatible response. This does not promise periodic refresh, rotation, or automatic renewal today.

OAuth credentials are kept in a dsh credentials-service/provider-managed store separate from the profile. The backend, location, record keys, and schema are provider-defined and can vary. When the current local file-backed provider is used, it creates an owner-only directory with mode `0700` and writes its file with mode `0600`. It is not an OS Keychain and is not encrypted at rest; it also does not prevent another process running as the same OS user from reading its data.

OAuth access tokens, refresh tokens, device codes, and client secrets do not enter browser-visible status or model-visible tool input/output. Host-internal code must resolve credentials through the credentials service before calling Apify.

The manual token is an **Advanced / fallback** setting. `role('secret')` only redacts manual-token reads. A token entered there is saved in plaintext in the profile's `cordis.patch.yml` (mode `0600`), hidden in the UI, never logged, and absent from browser-visible status and model-visible tool input/output. Leave it blank to use `APIFY_TOKEN` and keep a token out of the profile. These are separate stores managed by different layers: the credentials service/provider store is not the profile's `cordis.patch.yml`, and the manual-token warning applies only to the profile field.

Apify's only current device OAuth scope is `full_api_access`. Authorizing grants full Apify API access, not access limited to this Actor or tool; disclose that before login.

The connection section uses three egress cards. OAuth status and usage share a compact panel; **Usage details** expands billing-cycle, plan, proxy, and credential-source information. Sign out is in the account menu. The floating footer contains **Save** and **Discard**. **Test connection** submits only the current egress, own-Actor selection and any newly entered or cleared manual token to the Host for that check; it never writes the configuration. OAuth still takes priority, and unchanged saved tokens remain on the Host. Discard clears a draft's test result. The layout follows the Host's light/dark theme and stacks on narrow screens.

The signed-in usage card and signed-out free-credit card share a pale blue background and blue amounts. The usage card shows this cycle's used/total budget, remaining balance or over-limit amount, plan and refresh action. Billing-cycle and proxy details stay collapsed under **Usage details**. Unknown usage or limits stay empty instead of implying zero spend.

The own-Actor picker shows selectable cards with the Actor title, account/name and localized build status. Arrow keys, Home and End move the selection; refreshing preserves the current cards. Sign in first, retry a failed request, or deploy when the list is empty. During creation and building, a three-step status card replaces the choices; only the exact successful build is selected, without saving it. Switching routes or signing out cancels the page's pending deployment request and build watch; an already-started cloud build can continue. Completing authorization reloads the choices. **Use a manual token** opens and focuses its advanced field.

The default region and calibration fields use searchable pickers. Regions match English or Chinese names and country codes; calibration choices include automatic selection, built-in anchors and configured anchors. Only choosing an option changes the draft. Arrow keys and Enter select; Escape, Tab or an outside click dismiss without applying search text. The popovers open above the field when space below is limited. Worldwide retains its empty geo value, and custom anchors remain selectable.

The account menu closes on an outside click, focus leaving the menu, or Escape. The Actor picker reads the basic list and most recent build directly, avoiding full Actor details. Listing has a 30-second Host deadline and a 45-second browser deadline; API request timeouts also cover response bodies. Switching connection modes, refreshing or closing settings cancels the previous list request; failures remain retryable.

**Advanced** contains **Calibration baselines**, **Manual Token** (Actor routes only), and **Files and charts** tabs. Closing Advanced or switching tabs keeps draft edits. A validation link in the footer opens the relevant advanced controls when they block saving.

When either Actor route has no connected credential, a compact card shows Apify's $5 monthly Free-plan credit, an estimated 3,000–7,000 queries and a short shared-account budget note, alongside [Sign up →](https://console.apify.com/sign-up) and [Pricing](https://apify.com/pricing). Sign in with Apify, or use the manual token fallback under **Advanced → Manual Token**. Local mode needs no token and does not show this card. See [Actor costs](#actor-costs) for the sample basis and runtime bounds.

| Field | Default | Meaning |
| --- | --- | --- |
| `egress` | `local` | `local` sends Google requests from the dsh machine and still honors `HTTPS_PROXY` / `HTTP_PROXY`; `actor-public` relays through `meka.im/google-trends-for-agent`; `actor-own` relays through your own deployment. |
| `apifyToken` | unset | Advanced fallback token saved in the profile's `cordis.patch.yml` (hidden in the UI, never logged or returned). Used only when no OAuth session is stored; when also empty, `APIFY_TOKEN` is used. |
| `apifyActor` | unset | Actor id of your on-demand `google-trends-for-agent` Actor; used only by `actor-own`. Pick or deploy one on the settings page. |
| `geo` | `US` | Default geo for `trends_ask`, `trends_compare`, and `trends_snapshot`; empty string means Worldwide. Regional built-in calibration is available; unknown regions or weak anchors return null traffic. |
| `anchor` | automatic | Optional fixed anchor for `validate` / `trends_snapshot`; blank matches the query region and window. |
| `baselines` | built-in | Editable inline anchors `{ term, geo, dailySearches, tolerance? }` plus optional `windowAnchors.short` / `.long`; validated like a version 2 baselines file. New custom rows start from the selected region's built-ins. |
| `cache` | `true` | Reuse saved snapshots (up to 360 minutes); `false` always fetches fresh. |
| `snapshotDir` | `.gtfa/snapshots` | Advanced: snapshot store, resolved against the dsh process working directory. |
| `chartDir` | `.gtfa/charts` | Advanced: chart output directory. |
| `charts` | `true` | Advanced: write SVG chart files; `false` returns null chart paths. |

Relative `snapshotDir` and `chartDir` paths resolve from the directory where `dsh web` was started (cwd); charts default to `<cwd>/.gtfa/charts/`.

Every setting with a fixed set of values is a select, segmented control, or switch. Anchor rows, the two directories, and the manual fallback token are edited as text inputs; the token sits in the Advanced / fallback area. The custom editor starts from the selected region's built-ins, including Worldwide. Baselines for other regions still apply unless overridden. The source and validation link documents their uncertainty. When adding an anchor row, only an identical normalized term + geo already present in the current list is treated as a duplicate; existing rows still undergo all other validity checks.

Both Actor routes work on the Apify Free plan because the residential proxy runs **inside the Actor**. `actor-public` needs nothing to deploy and uses the credential resolution above. `actor-own` deploys the same open-source code once: use **Deploy to my Apify account →** on the settings page, link `https://github.com/meka-im/google-trends-for-agent` (branch `main`) in Apify Console with **Standby disabled** (Settings → Server), or run `apify push` from a clone. Then pick it in the **Actor** select.

The settings page calls the following owner-only Host routes through dsh's Connection service. All require dsh's authenticated browser session; OAuth operations additionally require the Host credentials service, and the status route reports `available: false` when it is absent. The browser never receives an Apify credential.

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/gtfa.apify-oauth` | `GET` | Returns OAuth availability and connection state. Safe fields include `available`, `connected`, `pending`, `verificationUri`, `userCode`, `expiresAt`, `code`, and `message`; access tokens, refresh tokens, device codes, and client secrets are never returned. |
| `/api/gtfa.apify-oauth-start` | `POST` | Starts a device authorization attempt through Apify's official RFC 8628 endpoints and returns the official verification link, user code, and pending state to the page. |
| `/api/gtfa.apify-oauth-cancel` | `POST` | Cancels only the pending device flow. |
| `/api/gtfa.apify-oauth-logout` | `POST` | Deletes the stored OAuth session but retains reusable client registration as determined by the provider backend; it does not revoke the authorization in Apify's cloud. |
| `/api/gtfa.apify-usage` | `GET` | Reads this cycle's plan and usage from two Apify account endpoints; `?refresh=1` bypasses the 60 s cache. A stored OAuth session is used first; only when none is stored do credentials fall back to saved config token, then `APIFY_TOKEN`. `source` can be `oauth`, `config`, or `env`. |
| `/api/gtfa.apify-actors` | `GET` | Lists this package's Actors in the account with the latest build status; `?refresh=1` bypasses the 60 s cache. Returns `no-token` / `invalid-token` codes. |
| `/api/gtfa.apify-deploy` | `POST` | Creates `google-trends-for-agent` from the Git repository with Standby disabled and starts its first build; one deploy at a time. Name conflicts return `exists`. |
| `/api/gtfa.baselines` | `GET` | Returns the active MEKA v1 baseline catalog status (`source`, `version`, `syncedAt`, `count`, `regions`, and anchor rows). |
| `/api/gtfa.baselines-sync` | `POST` | Manually fetches and atomically persists the latest MEKA v1 baseline catalog from `meka.im` to `<snapshotDir>/.meka-baselines.json`. |
| `/api/gtfa.test-connection` | `POST` | Checks saved-egress connectivity, then queries ChatGPT, Gemini and weather together (US, past 24 hours). Returns separate `network`, `data` and `checkedAt` results with per-keyword counts. Actor mode starts one usage-billed on-demand run after API/authentication preflight. |

The diagnostic does not reuse cached data or retry upstream requests. It requires a valid, nonzero series for every keyword; HTTP success alone, missing/malformed series and zero-only results do not pass. A challenge or rate limit stops further work. The 120 s overall deadline, **Cancel check**, and closing the settings page stop the request and attempt to abort its owned cloud run; if cloud cleanup is unreachable, the 300 s platform timeout is the final bound. Connection checks require POST from the same site and reject concurrent checks.

These routes are absent in headless/TUI profiles. Responses contain usage numbers, plan fields, Actor metadata, OAuth status, and status/latency; account identity, the raw `/users/me` object, and credentials are dropped Host-side.

**Cancel** has no effect beyond a pending device authorization. **Sign out** removes the stored OAuth session while retaining reusable client registration according to the provider backend. The current Apify authorization-server metadata has no `revocation_endpoint`, so sign-out cannot revoke the cloud grant; users must manage or revoke that authorization in Apify Console.

`actor-public` uses `meka.im~google-trends-for-agent`; `actor-own` uses `apifyActor`. OAuth is resolved on every call, followed by saved token / `APIFY_TOKEN` only when no OAuth session exists. Each native cloud tool call starts exactly one run through `POST /v2/acts/{id}/runs`, with 256 MB and a 300 s platform timeout. The plugin polls that run, reads `TOOL_RESPONSE`, and returns the complete tool envelope. Start requests are not automatically retried because an ambiguous response could duplicate paid work.

Connection diagnostics use a dedicated internal `toolRequest` protocol `2`, restricted to `trends_compare` with retries disabled. Its `TOOL_RESPONSE` echoes protocol `2`; an unsupported response is reported as a build compatibility error. Ordinary native tool requests use protocol `1`.

The programmatic input is `toolRequest: { protocol: 1, name, input, settings?, history? }`. `name` is one of the four native tools. `TOOL_RESPONSE` contains `{ protocol: 1, result, snapshots }`; this is additive and does not change Dataset v1. Query defaults and custom baselines are forwarded, while filesystem paths and credentials are kept on the Host. Snapshot history is validated and exchanged to preserve diff behavior between runs. Successful ask/snapshot envelopes are reusable locally for 360 minutes; failures/partial results are not cached. Cache hits start no Actor. Snapshot SVGs are saved to the Host's configured chart directory and inline SVG follows the caller's `svg` flag.

Caller cancellation or an API failure after receiving a run id attempts to abort that owned run using a separate cleanup signal. If start acknowledgement is lost or cleanup cannot reach Apify, the platform's 300 s timeout bounds the run. This is not a promise of immediate cloud cancellation during a network outage.

The local `gtfa-mcp --http` interface is loopback-only with Host/Origin checks and a 300 s tool deadline. Cloud Actor startup rejects Standby invocations and never opens an HTTP listener.

## Output contract

The MCP results and the CLI agent envelopes (`ask`, `snapshot --json`, and compare/default mode with `--json`) share the outer keys `ok`, `schemaVersion` (currently `1`), `status`, the tool-specific body, optional `error`, and `meta`. `trends_now` can return a partial result with `ok: true` and still include the first per-country `error`. For `ask`/`snapshot`, `status` is `ok`, `no_data`, or `partial` on success; `blocked` and `error` set `ok: false` and include `error.code`. `trends_compare` and `trends_now` use `ok`, `partial`, and `error`; schema rejections can set `ok: false` with `error.code`. MCP results also set `isError: true` for `ok: false`. Without `--json`, compare/default mode prints the lower-level response described below.

Both ask and snapshot use `verdict.label`: `spiking`, `rising`, `steady`, `flat`, `no_data`, or `blocked` (`flat` includes declining interest).

Tool bodies:

- `trends_ask`: `term`, `summary`, `filter`, `interest`, `tables`, `regions`, optional `verdict`, `diff`, optional `diffReason`, `meta`.
- `trends_snapshot`: `term`, `summary`, `filter`, `anchor`, `anchor7d`, `traffic`, `calibration`, `series`, `chart`, `chart7d`, `traffic7d`, `tables`, `verdict`, `meta`.
- `trends_compare`: `filter`, `summary`, `series`, optional `batchVolume` (when `calibrate: true`), `meta`.
- `trends_now`: `hours`, `geos`, `summary`, `byGeo`, `meta`.

Errors contain `{ "code": string, "message": string, "retryAfterSec"?: number }`. Messages are actionable for agents: they say what happened and whether to retry, lower the request rate, raise `--timeout` (CLI) or `timeoutMs` (MCP, dsh, and Actor tools; 1000–60000), check the network, or set `HTTPS_PROXY` / `HTTP_PROXY`. The lower-level `queryTrends()` API instead returns `{ status, input, data?, error?, meta }`.

## Exit codes

| Code / outcome | CLI exit | Meaning |
| --- | --- | --- |
| success | `0` | Complete success; `no_data` also exits 0 in the snapshot/ask envelope. |
| `partial` | `2` | Some sections or countries succeeded, others failed; this includes a `partial` snapshot. |
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

If `interest.average` < 1 and both Popular/Rising tables are empty, treat the result as `no_data`: low confidence, no rising/high verdict, and null numeric traffic fields (including peaks and series traffic). Related-query evidence keeps a low-average term eligible for validation.

`snapshot` and `ask --validate` use the same gap-aware calibration:

```text
traffic = round(score ÷ anchorLevel × dailySearches)
```

`anchorLevel` is the mean of the anchor's non-gap points in the same shared-scale comparison. All surfaces share the unified **MEKA v1 baseline catalog** (59 Google Ads Keyword Planner anchors across 7 regions, revision `2026-11-19`, ±50% tolerance; see [regional baselines](baselines.md)). Starting regional defaults:

| Region | Default anchor | Daily searches | Tolerance | Catalog tiers |
| --- | --- | ---: | --- | ---: |
| `US` | `sudoku` | **88,000/day** | ±50% | 10 anchors |
| `CA` | `sudoku` | **15,000/day** | ±50% | 7 anchors |
| `GB` | `crossword solver` | **27,000/day** | ±50% | 8 anchors |
| `DE` | `Kreuzworträtsel` | **22,000/day** | ±50% | 8 anchors |
| `FR` | `sudoku` | **22,000/day** | ±50% | 8 anchors |
| `JP` | `テトリス` | **18,000/day** | ±50% | 8 anchors |
| Worldwide (`""`) | `stopwatch` | **160,000/day** | ±50% | 10 anchors |

All built-in and version 2 user baselines currently represent **web search in category 0**. They are eligible only when the effective filter has `property: "web"` and `category: 0`; the version 2 schema gains no property or category fields. CLI `ask --validate` can still return relative interest for another property/category, but the `traffic` object remains present with numeric fields set to `null` and a calibration warning.

When `trends_snapshot` runs without a pinned anchor and round 1 falls out of range, it automatically executes one second-round multi-tier MEKA comparison against closer regional tier anchors and upgrades `anchor` / `traffic` if rescued (details under `calibration`). Method references: [Krazydad, comparing Trends scales](https://blog.krazydad.com/2018/05/18/comparing-apples-oranges-and-futoshikis-using-google-trends/) and [G-TAB](https://arxiv.org/abs/2007.13861).

The full built-in catalog is described in [regional baselines](baselines.md), inspectable via `gtfa baselines`, and displayed in dsh's calibration settings. [examples/baselines.json](../examples/baselines.json) demonstrates a version 2 custom override file (`anchors` plus optional `windowAnchors.short` / `.long`):

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

Load it with `GTFA_BASELINES` for `gtfa` (ask/snapshot), `gtfa-mcp` (stdio or `--http`), and the Actor; library callers pass `baselines`:

```sh
GTFA_BASELINES=./baselines.json gtfa snapshot Sora --fresh --json   # gtfa-mcp reads it too; use fresh: true
```

Use `--fresh` (MCP `fresh: true`) after changing baselines so saved snapshots do not hide the change.

Geo matching first trims whitespace and uppercases the code. An empty string remains Worldwide (`""`) and is not treated as a default US request. `parseBaselines` accepts an explicit empty `geo` for Worldwide; it rejects a missing anchor geo. A region never inherits another region's volume. User anchors win by normalized term + geo and the applicable web/category 0 filter, then the matching regional built-ins apply. Every `windowAnchors` term must exist in `anchors` or the built-ins. Version 1 is rejected, and an invalid file fails with a clear error instead of falling back. An explicit `--anchor` / MCP `anchor` wins for every window that runs (a per-call MCP `anchor` beats the Actor's server-wide anchor input); otherwise the primary window chooses its automatic anchor and the extra `now 7-d` fetch uses the 7-day anchor. `anchor` and `anchor7d` report each window's term and baseline.

`traffic.low` / `traffic.high` apply that tolerance to the average. The `traffic` / `traffic7d` objects still exist when the effective filter is not web/category 0, no matching geo + anchor baseline exists, or the anchor reliability gate fails; their numeric fields are `null`:

- at least one non-gap anchor point;
- gap-aware `anchorLevel ≥ 1` on Trends' integer scale;
- at least 25% of non-gap anchor points nonzero.

A real 24-hour Sora run with `gpts` failed the third condition: `27/180` non-gap anchor points were nonzero (15%), even though `anchorLevel` was `2.72`. That is why short windows now use `sudoku`: in a US 24-hour check it was 99.4% nonzero (CV 0.21), and small AI terms such as `gemini 4 carbon`, `pika h3`, and `genie 4` stayed nonzero next to it. A 7-day Sora run with `gpts` calibrated normally: average **36,795**, latest **39,238** (39.2k), peak **55,262** (55.3k) searches/day.

These numbers are **estimates from an anchor**, not measured Google search volume. Only snapshot Popular/Rising rows retain `estDaily` for schema compatibility, always as `null`; `trends_ask` omits that field. Related-list values do not share the primary term's scale and cannot be converted into absolute volume. When the requested window is already `now 7-d` (the default), `traffic7d` and `chart7d` reuse the primary snapshot and chart with no extra upstream request. When the requested window is not `now 7-d`, they come from one separate 7-day fetch after the primary attempt unless the primary is `BLOCKED` or `RATE_LIMITED`; ordinary primary errors such as `NETWORK_ERROR` do not by themselves prevent that attempt. If skipped, the 7-day fields remain shape-stable with an empty chart, null traffic, baseline metadata, and a warning. A single 7-day request error is retained as a warning/fallback when the primary otherwise completes, while caller cancellation or an overall deadline propagates through the whole snapshot. Cache keys include the filter window, property/category, and anchor term, so different windows or anchors never collide.

In `now 1-d` windows, trailing points may be 0 or low while Google back-fills. Prefer settled values and the window average; a trailing 0 alone is not evidence of a real drop. `settledLatest` removes the last point in `now *` windows, then excludes gaps, so multiple trailing zeros can still remain. Non-`now` series with daily spacing remove two tail points; other series remove one. Averages exclude gaps but still include unsettled tail points. Leading/trailing zeros are retained, not marked as gaps; the calculation is unchanged.

## Actor costs

The [Actor input and output reference](../.actor/README.md) covers ordinary Dataset runs and the native TOOL_RESPONSE protocol.

Apify's [Free plan](https://apify.com/pricing) includes $5 of monthly usage credits shared across the account. The unsigned-in UI estimates 3,000–7,000 queries per month using this project's defaults. The basis is two completed US/24h runs checked on 2026-11-16: a three-keyword comparison (`eKqR8wNxKJlvRqk59`, $0.000656643) and a ChatGPT snapshot with SVG (`6F5LbYVnu0xIBnR39`, $0.001462250). These later-read totals include residential proxy charges as well as compute and run storage/transfer; immediate post-run totals had not yet included all charges. Dividing $5 by these sample costs gives about 3,400–7,600 runs, rounded down for the UI. This small-sample budget estimate is not a guaranteed success count or rate-limit allowance: slower requests, multi-country queries, retained storage, own-Actor builds, and other account usage reduce the available count. Other Actor implementations/configurations are outside this estimate.

Cloud queries run once and exit. Defaults are 256 MB and a hard 300 s runtime limit; no Actor-owned MCP server or idle tail is used. Charges include actual run compute, proxy traffic, and any platform storage/transfer. Read each finished run's `usageTotalUsd` for its measured cost. A slow or failed request still has real platform costs. API metadata checks and local snapshot-cache hits start no Actor.

## Rate limits, retries, and timeouts

- Default spacing between upstream requests is **1000 ms** for Explore requests from the CLI/library, and **1500 ms** for Trending Now (`now` / `trends_now`) and for all MCP requests.
- The library accepts `timeoutSurface: "cli" | "tool"` on query/compare options. CLI `compare` / default `--query` use `"cli"` so `TRENDS_TIMEOUT` advice names `--timeout`; MCP, dsh, and Actor tool calls use `"tool"` so it names `timeoutMs`.
- HTTP 429 triggers a bounded automatic retry: `Retry-After` is honored when it is at most **10 s**, otherwise the request fails immediately with `retryAfterSec` so the caller can wait. Without `Retry-After`, the delay is 1 s, then 2 s. `maxRetries` defaults to `1` and is capped at `2`.
- `BLOCKED` challenge pages are never retried. They trigger adaptive backoff capped at 60 s (1 s floor); successes halve the penalty.
- For Explore and Trending Now requests, transient `TRENDS_TIMEOUT`, `TRENDS_TEMPORARILY_UNAVAILABLE`, and `NETWORK_ERROR` failures may also retry up to `maxRetries` (default `1`, maximum `2`). Explore's default timeout is 30000 ms, and `timeoutMs` must be 1000–60000 ms. The Trending Now library `timeoutMs` defaults to 15000 ms and accepts any finite positive number; the CLI's `now --timeout` requires a positive safe integer.
- Library `batchTrends`, CLI batches, and `trends_now` stop issuing network requests after the first `BLOCKED` or `RATE_LIMITED` result. Later items are reported as blocked/rate-limited/skipped, with the original `error.code` and `retryAfterSec` retained; one-off Actor batches write a `skipped` dataset row for each remaining term.
- Cancelling a request that is waiting in `RateLimiter` rejects that request without running it and does not release a later waiter early or let it bypass the configured interval.
- Caller cancellation and the overall snapshot deadline propagate through the whole call rather than being converted into a partial result; this does not make every single-request error abort the snapshot. A 7-day request error can remain a warning/fallback when the primary otherwise completes. Each `gtfa-mcp --http` or Actor tool call has a **300 s** deadline; cancellation (a client disconnect) aborts the in-flight request instead of continuing through retries, additional 7-day work, or countries. An expired HTTP tool-call deadline returns status `504` with `TRENDS_TIMEOUT`; cancelled or timed-out work is not cached as a permanent failure.
- Keep workloads small. This is not suitable for bulk scraping or continuous polling, and retries or proxies do not guarantee access.

## Packaging and dependency safety

The root package keeps a scoped `@crawlee/core` → `minimatch` override at `^11.0.1`; the current lock resolves `11.0.8`. This is an explicit security override outside Crawlee's declared `^9` range. The production Actor and matcher paths have been exercised on Node.js 20 with 11.x, but a consumer's `npm ls` may still report the semver-range mismatch.

`npm pack` also bundles the `apify` dependency subtree from the audited root lock (`bundleDependencies: ["apify"]`). This prevents consumers from re-resolving older Apify transitives such as the vulnerable `basic-ftp` line; root npm `overrides` do not propagate when this package is installed as a dependency. The tradeoff is a materially larger tarball and installed tree. Release verification audits both the root tree and a clean consumer install of the packed artifact rather than relying only on root `npm audit`; both audits are clean.
