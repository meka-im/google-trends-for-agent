# Changelog

## 0.2.44 — 2026-11-26

### dsh UI polish, local-failure Actor CTA & 1-click settings
- Register the dsh settings form directly on `plugins.bundle.config` so clicking **Plugin settings** (or opening **Plugins → Google Trends**) lands on the configuration form in **1 click** instead of requiring a second click into **Components → Google Trends / gtfa** (`src/client/index.tsx`, docs aligned).
- Add a prominent, localized **Local direct request** failure alert banner (`RATE_LIMITED`, `BLOCKED`, and generic local failures) guiding users to switch to **Public Actor** or **My own Actor** with a 1-click **Switch to Public / Own Actor** CTA button (`src/client/dashboard.tsx`, `src/client/dashboard-locale.ts`, `src/client/dashboard-theme.ts`).
- Polish failed-query dashboard details: remove the `!important` margin override on `.gd-error` that left 0px gap under the chart card, replace empty blank chart/stats/volume placeholders with a focused failed-state card, and auto-expand **Query details** with a structured status row.

## 0.2.43 — 2026-11-26

### dsh install walkthrough & docs alignment
- Add animated bilingual DeepSeek Harness (macOS) installation walkthrough SVGs (`docs/assets/demo-dsh-install-en.svg`, `docs/assets/demo-dsh-install-zh.svg`) embedded in `README.md`, `README.zh-CN.md`, and `docs/clients/dsh.md`.
- Simplify primary dsh install docs (`README.md`, `README.zh-CN.md`, `AGENTS.md`, `docs/reference.md`, `docs/clients/dsh.md`) to direct npm package installation (`google-trends-for-agent`), keeping GitHub `main` + `allowBuilds` as an optional development alternative.

## 0.2.42 — 2026-11-26

### npm release & documentation alignment
- Publish [`google-trends-for-agent`](https://www.npmjs.com/package/google-trends-for-agent) on npm with GitHub Actions provenance (`--provenance --access public` via `.github/workflows/publish-npm.yml`) and add the npm version badge to `README.md` / `README.zh-CN.md`.
- Update `README.md`, `README.zh-CN.md`, `AGENTS.md`, `docs/reference.md`, and client setup guides (`openclaw.md`, `codex.md`, `claude.md`, `cursor-vscode.md`, `dots.md`) to use `npm install -g google-trends-for-agent` and `npx -y -p google-trends-for-agent`, replacing stale pre-npm instructions.
- Document the standard `GitHub Release → npm publish → Apify Actor rebuild & health probe` release workflow in `docs/releasing.md`.

### Apify Actor resilience (included since 0.2.41)
- Add automatic Apify proxy session fallback (`RESIDENTIAL` → default Apify Proxy → direct) and bounded transient retries on rotating proxy runs (`src/actor-proxy.ts`, `src/actor.ts`, `src/client.ts`).
- Add twice-daily and on-demand Apify Actor health check & `UNDER_MAINTENANCE` auto-recovery workflow (`scripts/apify-health.mjs`, `.github/workflows/apify-health.yml`).

## 0.2.41 — 2026-11-22

### Per-Actor-run billing ledger & dual-view history (dsh)
- Persist an independent local Actor Run ledger (`.query-history/.actor-runs.json`, capped at 2,000 entries) capturing every on-demand Apify Actor run across primary queries, batch calibration rounds (`round` & `anchor`), single-keyword calibration retries, follow-up estimates, and Settings connection tests—including `FAILED`, `TIMED-OUT`, and caller `ABORTED` runs—without being erased when query history is cleared.
- Upgrade Dashboard **History** with a **By query｜By Actor run** switcher, per-query & per-run cost columns (`<$0.0001` sub-cent formatting), copyable Run ID pills, linked Actor run breakdown in Result **Query details**, read-only `reconcileRuns` pending cost sync, and **Test cost** in Settings diagnostics.

### Version upgrade system & UI polish (dsh + calibration)
- Add plugin and personal Actor version upgrade checks (`/api/gtfa.version`, `UpdateBanner` on Settings and Dashboard), directional runtime drift detection, explicit target latest version badges, and confirmed-build acknowledgement.
- Unify the dsh Settings and Dashboard palette system (`#2563eb` accent, semantic pills, clean `UsageDetails` rounding, and localized labels).
- Add per-client setup router/guides and allow hint-guided 3rd batch calibration rounds.

## 0.2.40 — 2026-11-21

### Cross-surface alignment (API, CLI, MCP, Actor, and dsh)
- Unify all surfaces on the **MEKA v1 calibration baseline catalog** (59 Google Ads Keyword Planner anchors across 7 regions: Worldwide, US, CA, GB, DE, FR, JP; revision `2026-11-19`), with first-boot automatic sync and manual sync via `gtfa baselines --sync` or dsh Settings (`/api/gtfa.baselines`, `/api/gtfa.baselines-sync`).
- Unify the default time window to **`now 7-d`** across Library API, CLI (`gtfa`), MCP (`gtfa-mcp`), Apify Actor, and the dsh plugin.
- Add multi-tier MEKA automatic calibration with second-round tier retry to shared `trends_snapshot` (`calibration` block, upgrading `anchor` / `traffic` when rescued) and optional `calibrate: true` / `--calibrate` (`batchVolume`) to `trends_compare`.
- Add Apify on-demand cloud egress (`--egress local|actor-public|actor-own`, `--actor`, `GTFA_EGRESS`, `GTFA_APIFY_ACTOR` with `APIFY_TOKEN`) to CLI (`gtfa`) and MCP (`gtfa-mcp`).

### dsh plugin UX & brand refresh
- Streamline the dsh panel to **Query** and **History** tabs, refine dashboard cards and settings page aesthetics, and replace the plugin and Actor logos with the blue-cyan folded ribbon mark.
- Consolidate the test suite (`48 → 35` files, `~2x` faster local test runs) and align all user/agent documentation (`README.md`, `README.zh-CN.md`, `AGENTS.md`, `docs/clients.md`, `docs/baselines.md`, `docs/reference.md`, `docs/mcp-api.md`).

## 0.2.39 — 2026-11-20

- Automatically calibrate single-keyword dashboard queries in up to two rounds.
- Use weak comparison signals to pick closer anchors for a manual follow-up. Keep estimates from sustained low keyword scores when the reference is strong.
- Sync 59 published MEKA anchors. Use nearby tiers for the first dsh comparison and include daily-only anchors in eligible follow-up estimates.
- Plot anchor disagreement as a per-sample range in the dsh search-volume chart. Restore missing samples from retained Actor results.
- Estimate missing search volume on demand from a saved dsh result. One explicit follow-up uses the selected connection and records the result and any Actor cost.
- Use matched, settled samples for dashboard estimates. Show an anchor range when eligible anchors disagree and display estimates at two significant digits.
- Unify the dsh query form for 1–5 terms, retain its draft/result across panel navigation, and show actual Actor progress with elapsed time.
- Add a native Google Trends sidebar panel and retain up to 1,000 local manual and Agent calls, including failures.
- Accept valid dsh browser requests forwarded through its internal HTTP bridge; preserve exact origin/Host and cross-site checks for account and Actor actions.
- Update an owned Actor from official main directly in dsh, with build progress and a bounded status wait, and verify the Actor's actual package version separately from keyword data checks (`GTFA_RUNTIME`).
