# Google Trends (gtfa)

Use the native `gtfa` tools for light, interactive search-interest research. They return stable JSON envelopes with `ok`, `schemaVersion`, `status`, `error?`, and `meta`. Report `no_data`, `blocked`, and upstream errors honestly; never invent search volumes.

## When to use which tool

- **Verify a new term has real demand** — `trends_ask` with `{ "term": "<term>", "validate": true }`. Start with the default US / `now 1-d`; use `fresh: true` when a cached snapshot would be stale. If `status` is `no_data` or `error`, stop and report it. Only `validate: true` adds a searches/day estimate.
- **Compare against an anchor or rival** — `trends_compare` with 2–5 keywords, for example `["<candidate>", "gpts"]`. All keywords share one 0–100 scale; use `latest` and `peak`, and confirm the candidate is not a rounding artifact.
- **Calibrated searches/day + chart** — `trends_snapshot` with one term. It returns `traffic`, `series`, `chart`, and the always-on `anchor7d` / `chart7d` / `traffic7d` check.
- **What is trending now** — `trends_now` by country. `geos` accepts a code list, `"default"`, or `"all"`; `hours` is the Trending Now window (`4`, `24`, `48`, `168`). It fetches sequentially and stops after the first block.

## Anchors

`trends_snapshot` and `trends_ask` with `validate: true` calibrate relative interest into estimated searches/day:

- short windows (`now 1-H`, `now 4-H`, `now 1-d`): `sudoku` at **63,000/day** (US, ±50%)
- `now 7-d` and longer: `gpts` at **3,500/day** (US, ±50%)

Pass `anchor` only to force a different term for both windows. Numeric traffic is `null` when calibration is unavailable or the anchor reliability gate fails; do not substitute a guess. These are anchor-based estimates, not measured Google volume.

## Workflow for a new term

1. `trends_ask` with `validate: true`, `fresh: true`.
2. `trends_compare` against a known anchor to check relative scale.
3. `trends_now` for current corroboration (absence is evidence, not failure).
4. Repeat `trends_ask` on a second window before calling it a trend.

Include the geo, time window, and `fetchedAt` in your answer.

## Limits

Keep use light and interactive: no bulk scraping, no continuous polling, no request loops. On `RATE_LIMITED`, wait `retryAfterSec` and retry once at most. On `BLOCKED` or `NETWORK_ERROR`, stop and report; do not rotate requests to route around a block. `trends_ask` (without `validate`), `trends_compare`, and `trends_now` return relative interest only — never claim search volume from them.
