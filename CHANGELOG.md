# Changelog

## 0.2.3 — 2026-11-14

- Platform delivery is identified as npm package version `0.2.3`, distinct from the earlier `0.2.1` and `0.2.2` artifacts. This package includes the reviewed platform fixes below; the documented `8304fab20544c877ab0f38a461d96c0ec3f69656` source pin remains the previously reviewed source and does not install `0.2.3`.
- Keep snapshot Popular/Rising `estDaily` fields for schema compatibility but always return `null`; related-query scales cannot be converted into absolute volume.
- Apply all version 2 calibration baselines, including user anchors, only to web/category 0. Filtered CLI requests keep traffic objects but set their numeric fields to `null` with an explanation; geo matching trims and uppercases while preserving `""` as Worldwide, which cannot currently be calibrated by an empty-geo baseline row.
- Run a separate `now 7-d` snapshot sequentially after the primary attempt unless the primary is `BLOCKED` / `RATE_LIMITED`, and return shape-stable empty chart, null traffic, baseline metadata, and warnings when that request is skipped or completes with an ordinary 7-day error that produced no snapshot.
- Add CLI `--timeout MS` to `ask`, `snapshot`, and `doctor`, with a 1000–60000 ms range and an 8000 ms default; Explore values propagate to primary, anchor-validation, `--trending`, and 7-day requests.
- Stop validation and `batchTrends` after `BLOCKED` or `RATE_LIMITED` while preserving the error code and `retryAfterSec`; read `--from` diagnostics back by `snapshotId` and preserve source metadata under `input`.
- Stop doctor and dsh Test connection after a challenge or HTTP 429 instead of probing again; make a partial snapshot exit with code 2, honor configured default filters in `compare` / `--query`, and keep CLI timeout advice distinct through `timeoutSurface`.
- Propagate caller cancellation and the overall snapshot deadline, map the Actor HTTP deadline to `504` / `TRENDS_TIMEOUT`, avoid caching cancelled work as a permanent failure, and prevent a cancelled `RateLimiter` waiter from releasing later requests early.
- Harden Trending Now CSV output with RFC 4180 quoting and spreadsheet-formula protection; serialize array fields as JSON before CSV encoding.
- Make the dsh default US `gpts` / `sudoku` baselines editable; for a newly added row, only an identical normalized term + geo in the current list is treated as a duplicate, while other validation remains unchanged.
- Pin install examples to reviewed source commit `8304fab20544c877ab0f38a461d96c0ec3f69656` rather than the unavailable `v0.2.2` tag; persistent installs clone, detach at that commit, and use `npm ci`.
- Package `.actor/README.md` with its three link targets fixed. Keep the root scoped `@crawlee/core` → `minimatch` override at `^11.0.1` (lock: `11.0.8`), an explicit security override outside Crawlee's declared `^9` range. Because dependency overrides do not propagate to consumers, bundle the audited `apify` dependency subtree in the packed artifact. This materially increases package size; verify audit on both the root tree and a clean consumer install of the tarball, and expect that consumer `npm ls` may still report the range mismatch.

## 0.2.2 — 2026-11-13

- Gate low-average interest with empty related tables as low-confidence `no_data`; omit numeric traffic and unify ask/snapshot verdict labels.
- Normalize keyword matching for cache/diff while preserving display spelling; skip incompatible and failed diff baselines without interrupting batches. Failures remain saved for diagnostics, never served from cache.
- Fix settings spacing above Save/Discard and clarify that Save applies changes without a restart.
- Correct EN/ZH dsh prerequisites, allowBuilds append instructions, settings navigation, cwd chart paths, no-token Actor guidance, and optional `actorId`.
- Add installed MCP configuration and GitHub/data-fetch troubleshooting; update release pins and metadata to 0.2.2.
- Add optional `timeoutMs` (1000–60000) on MCP/dsh/Actor tools; TRENDS_TIMEOUT copy mentions `--timeout` on the CLI and `timeoutMs` on tools. Note that pnpm may wrap the allowBuilds key, and that dsh tools are called from chat.

## 0.2.1 — 2026-11-13

- CLI `compare` rejects duplicate keywords with `INVALID_INPUT` (exit 4), matching MCP.
- Persistent-install instructions pack a tarball (`npm pack`) so the clone directory can be deleted.
- Fix persistent-install instructions with clone/build/local global install; document npx startup overhead and the exact dsh `allowBuilds` map.
- CLI `--diff` forces a fresh saved snapshot; clarify MCP diffs on cache hits and `fresh: true`.
- Document accepted `--from` JSON formats in CLI help and reference.
- Accept 1–5 distinct compare keywords across CLI, MCP, and Actor; align schemas, help, and docs.
- Correct SVG dimensions to 720×300, explain trailing back-fill zeros and settled values, and use fresh fetches in baseline examples.
- Translate the new mcp-api notes into Chinese.
- Install and MCP pins move to `v0.2.1`.
- npm audit fix: transitive security updates.

## 0.2.0 — 2026-11-13

- `trends_now` reads Google's public Trending Now page again instead of the retired Explore feed. Unexpected page shapes return `TRENDS_PROTOCOL_CHANGED` instead of `INVALID_INPUT`; explicit country lists are uppercased, deduped in input order, and capped at 30.
- One-off Actor batches write `skipped` rows for later `ask`/`snapshot` terms after a block or rate limit. `OUTPUT` adds a `skipped` counter and stays `partial` when some rows were delivered.
- Terms are no longer logged. Standby request logs keep only the method and path; one-off runs log row counts and statuses; errors log by code without upstream URLs.
- Local `gtfa-mcp --http` validates loopback `Host`/`Origin`, enables DNS-rebinding protection, and no longer sends wildcard CORS headers.
- Tool calls over HTTP and in the Actor have a 300 s deadline. Client cancellation aborts retries, rate-limit waits, and the `trends_now` country loop instead of finishing the batch.
- Version reporting reads `package.json` once: CLI `--version`, MCP `serverInfo`, and `/health` agree, and `/health` adds `build` from `ACTOR_BUILD_NUMBER` when present.
- One-click plugin deploy follows the returned `actorId`/`buildId`, so only that exact build is tracked and auto-selected.
- A saved `egress: apify` migrates to `actor-own` with a notice; unknown values fall back to `local` with a notice, and Save rewrites the profile.
- Install commands use `npx -y -p github:meka-im/google-trends-for-agent#v0.2.0 ...`; npm cannot choose a bin from this two-bin package by package name alone.
- New Actor icon: the Google Trends arrow with an AI spark (`.actor/icon.svg` source, 512×512 `.actor/icon.png`).
- The Actor is published in the Apify Store as `meka.im/google-trends-for-agent`, and the plugin's Public Actor route links to its Store page.
- Store-ready Actor: one-off runs execute one tool (`ask`, `snapshot`, `compare`, or `now`), write one flat dataset row per term (one per Trending Now item, capped at 25), store charts under `chart-*`, and write an `OUTPUT` summary with `completed` / `partial` / `failed` semantics. Validation failures write `OUTPUT` and fail the run with a clear message.
- `.actor/` now ships actor, input, dataset, output, key-value store, and OpenAPI web-server schemas, a Store README, `store.json` metadata (SEO, categories, run defaults, single-tenant Standby), and an icon (SVG source plus a 512×512 PNG referenced from `actor.json`). `actor.json` uses 256–1024 MB with a 512 MB default and drops `meta.generatedBy`.
- Local Streamable HTTP MCP endpoint via `gtfa-mcp --http --port 4321` (loopback-only; validates `Host`/`Origin`; no wildcard CORS), plus an Apify Standby Actor (`.actor/`) that serves `/mcp`, uses an Apify Residential proxy in the US by default, and rotates the proxy session on HTTP 429 or a Google challenge.
- The dsh plugin's egress select has three routes: `local`, `actor-public` (`meka.im/google-trends-for-agent`), and `actor-own` (the existing Actor dropdown, Refresh, and Deploy). The public route needs only a token and shows a source link and cost estimate; the old single-value egress setting is gone.
- Actor relay compatibility: `GET /health` returns `{ ok, version, relay: 1, build? }`; the relay transport checks it once per transport, and Test connection checks health plus one HEAD relay. Version mismatches and old builds map to `version-mismatch` with an update/rebuild message.
- Repository READMEs describe the three routes in one table, keep self-deploy instructions, and point Actor endpoint details at `.actor/README.md`.
- Native dsh plugin mounted from the bare `google-trends-for-agent` package row with `trends_ask`, `trends_snapshot`, `trends_compare`, and `trends_now` executed in-process by the core library: no MCP server, CLI subprocess, or Actor endpoint by default. Ships a `gtfa` skill and three egress routes: `local`, `actor-public` through `meka.im/google-trends-for-agent`, or `actor-own` through the user's own deployment (token from the saved `apifyToken` or `APIFY_TOKEN`; both Actor routes work on the Free plan because the residential proxy runs inside the Actor).
- Actor egress no longer connects to Apify Proxy directly: the plugin POSTs each request to the user's Actor at `/egress/fetch`, with INVALID_INPUT / NETWORK_ERROR mapping and a ~120 s startup allowance. The settings page lists this package's Actors, shows the latest build status, deploys one into the user's account, and auto-selects it when the build succeeds. Direct-proxy fields (`apifyProxyGroup`, `apifyProxyCountry`), the proxy-password lookup, and `APIFY_PROXY_PASSWORD` are removed.
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
- Searches/day calibration anchored to `gpts` at 550/day (single anchor, no window-aware sudoku anchoring), with a reliability gate that marks low-confidence estimates.
- 24h and 7d charts (SVG, opt-in inline) with gap-aware rendering and peak/latest callouts.
- Configurable chart time zone (IANA) via library `timeZone`, CLI `--tz`, MCP `tz`, or `GTFA_TZ`; defaults to UTC and validates names with `Intl.DateTimeFormat`. Chart filenames include a filesystem-safe time-zone slug plus a short SHA-1 of the canonicalized IANA zone name, so case variants share one file while different zones (including `Etc/GMT+1` and `Etc/GMT-1`) never overwrite each other.
- Slim default payloads to keep agent context small; opt-in detail flags.
- Stable JSON envelope with structured errors and documented exit codes.
- Optional `HTTPS_PROXY` / `HTTP_PROXY` support (direct by default), bounded 429 retries with `Retry-After`, and actionable upstream error messages.
- `gtfa doctor` for Node, reachability, proxy, and live `gpts` US 24h checks; human PASS/FAIL lines or `--json`.
- Install from GitHub with `npx` (no npm publish).
- Pluggable transport.
