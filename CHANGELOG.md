# Changelog

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
