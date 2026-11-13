# Changelog

## Unreleased

- Store-ready Actor: one-off runs execute one tool (`ask`, `snapshot`, `compare`, or `now`), write one flat dataset row per term (one per Trending Now item, capped at 25), store charts under `chart-*`, and write an `OUTPUT` summary with `completed` / `partial` / `failed` semantics. Validation failures write `OUTPUT` and fail the run with a clear message.
- `.actor/` now ships actor, input, dataset, output, key-value store, and OpenAPI web-server schemas, a Store README, `store.json` metadata (SEO, categories, run defaults, single-tenant Standby), and an original icon (SVG source plus a 512×512 PNG referenced from `actor.json`). `actor.json` uses 256–1024 MB with a 512 MB default and drops `meta.generatedBy`.
- The dsh plugin's egress select has three routes: `local`, `actor-public` (`meka.im/google-trends-for-agent`), and `actor-own` (the existing Actor dropdown, Refresh, and Deploy). The public route needs only a token and shows a source link and cost estimate; the old single-value egress setting is gone.
- Actor relay compatibility: `GET /health` returns `{ ok, version, relay: 1 }`; the relay transport checks it once per transport, and Test connection checks health plus one HEAD relay. Version mismatches and old builds map to `version-mismatch` with an update/rebuild message.
- Repository READMEs describe the three routes in one table, keep self-deploy instructions, and point Actor endpoint details at `.actor/README.md`.
- Native dsh plugin mounted from the bare `google-trends-for-agent` package row with `trends_ask`, `trends_snapshot`, `trends_compare`, and `trends_now` executed in-process by the core library: no MCP server, CLI subprocess, or Actor endpoint by default. Ships a `gtfa` skill and three egress routes: `local`, `actor-public` through `meka.im/google-trends-for-agent`, or `actor-own` through the user's own deployment (token from the saved `apifyToken` or `APIFY_TOKEN`; both Actor routes work on the Free plan because the residential proxy runs inside the Actor).
- Actor egress no longer connects to Apify Proxy directly: the plugin POSTs each request to the user's Actor at `/egress/fetch`, with INVALID_INPUT / NETWORK_ERROR mapping and a ~120 s cold-start allowance. The settings page lists this package's Actors, shows the latest build status, deploys one into the user's account, and auto-selects it when the build succeeds. Direct-proxy fields (`apifyProxyGroup`, `apifyProxyCountry`), the proxy-password lookup, and `APIFY_PROXY_PASSWORD` are removed.
- The Actor exposes plain HTTP endpoints beside `/mcp`: `POST /egress/fetch`, `POST /tools/{name}`, and `GET /health`; Standby runs exit after 60 s with no in-flight requests (`GTFA_IDLE_EXIT_SECS`).
- dsh configuration UI on Plugins → Google Trends → gtfa → Configure: egress, Apify token, Actor, default geo, inline baselines, snapshot cache, and advanced snapshot/chart directories. Choices are selects, segmented controls, or toggles; only the token, a new anchor term, `dailySearches`, and directories are typed. Fields are volatile, so edits apply without a restart; token reads are redacted, and the token entered in the UI is saved in plaintext in the profile's `cordis.patch.yml` (mode 0600).
- Cancellation from the dsh tool call now propagates through retries, rate-limiter waits, and the sequential country loop, so an aborted `trends_now` stops after the in-flight request instead of continuing through countries.
- The dsh `Config` rejects nonpositive baseline anchors and unknown `windowAnchors` terms at save time, using the same version 2 validation as `GTFA_BASELINES`.
- Built-in US anchors rescaled to `gpts` at 3,500 searches/day and `sudoku` at 63,000/day, derived from public keyword-tool volumes through measured Trends ratios. Window-aware anchoring still uses `sudoku` for short windows and `gpts` for 7 days and longer; snapshots report `anchor` and `anchor7d` with the baseline used by each window.
- Version 2 baselines files (`anchors` plus optional `windowAnchors`) load through `GTFA_BASELINES` for the CLI, MCP server, and Actor; version 1 and unknown window-anchor terms are rejected with clear errors.

## 0.1.0

Initial release.

- Two install commands: `gtfa` for the CLI and `gtfa-mcp` for the MCP server.
- Tools (CLI + MCP): `ask`, `snapshot`, `compare`, and `now` (Trending Now) for search-interest questions.
- Searches/day calibration anchored to `gpts`, with a reliability gate that marks low-confidence estimates.
- 24h and 7d charts (SVG, opt-in inline) with gap-aware rendering and peak/latest callouts.
- Configurable chart time zone (IANA) via library `timeZone`, CLI `--tz`, MCP `tz`, or `GTFA_TZ`; defaults to UTC and validates names with `Intl.DateTimeFormat`. Chart filenames include a filesystem-safe time-zone slug plus a short SHA-1 of the canonicalized IANA zone name, so case variants share one file while different zones (including `Etc/GMT+1` and `Etc/GMT-1`) never overwrite each other.
- Slim default payloads to keep agent context small; opt-in detail flags.
- Stable JSON envelope with structured errors and documented exit codes.
- Optional `HTTPS_PROXY` / `HTTP_PROXY` support (direct by default), bounded 429 retries with `Retry-After`, and actionable upstream error messages.
- `gtfa doctor` for Node, reachability, proxy, and live `gpts` US 24h checks; human PASS/FAIL lines or `--json`.
- Install straight from GitHub with `npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa`; no npm publish required.
- Pluggable transport.
- Optional local Streamable HTTP MCP endpoint via `gtfa-mcp --http --port 4321`, plus an Apify Standby Actor (`.actor/`) that serves `/mcp`, uses an Apify Residential proxy in the US by default, and rotates the proxy session on HTTP 429 or a Google challenge.
