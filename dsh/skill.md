# Google Trends (gtfa)

Use the native `gtfa` tools for light, interactive search-interest research. They return stable JSON envelopes with `ok`, `schemaVersion`, `status`, `error?`, and `meta`. Report `no_data`, `blocked`, and upstream errors honestly; never invent search volumes.

## When to use which tool

- **Verify a new term has real demand** — `trends_ask` with `{ "term": "<term>", "validate": true }`. Start with the default US / `now 1-d`; use `fresh: true` when a cached snapshot would be stale. If `status` is `no_data` or `error`, stop and report it. Only `validate: true` adds a searches/day estimate.
- **Compare against an anchor or rival** — `trends_compare` with 1–5 distinct keywords, for example `["<candidate>", "gpts"]`. All keywords share one 0–100 scale; use `latest` and `peak`, and confirm the candidate is not a rounding artifact.
- **Calibrated searches/day + chart** — `trends_snapshot` with one term. It returns `traffic`, `series`, and `chart`; `anchor7d` / `chart7d` / `traffic7d` retain their shape in normal fallback results. For a non-7-day primary, the extra 7-day request runs sequentially after the primary attempt unless the primary is `BLOCKED` or `RATE_LIMITED`; ordinary `NETWORK_ERROR` does not by itself skip it.
- **What is trending now** — `trends_now` by country. `geos` accepts a code list, `"default"`, or `"all"`; `hours` is the Trending Now window (`4`, `24`, `48`, `168`). It fetches sequentially and stops after the first block or rate limit.

If `interest.average` < 1 and both Popular/Rising tables are empty, treat the result as `no_data`: low confidence, no rising/high verdict, and null numeric traffic fields (including peaks and series traffic). Related-query evidence keeps a low-average term eligible for validation.

## Anchors

`trends_snapshot` and `trends_ask` with `validate: true` calibrate relative interest into estimated searches/day:

- short windows (`now 1-H`, `now 4-H`, `now 1-d`): `sudoku` at **63,000/day** (US, ±50%)
- `now 7-d` and longer: `gpts` at **3,500/day** (US, ±50%)

Built-in and version 2 user baselines apply only to web search in category 0. CLI filters using another property/category can still return relative interest, but the `traffic` object remains with numeric fields `null` and an explanation. Geo matching trims and uppercases the code; `""` remains Worldwide, and `parseBaselines` rejects empty-geo anchor rows. Pass `anchor` only to force a different term for both windows that run. Numeric traffic is `null` when calibration is unavailable or the anchor reliability gate fails; do not substitute a guess. Only snapshot Popular/Rising `estDaily` fields are compatibility placeholders and always `null`; ask tables omit the field. These are anchor-based estimates, not measured Google volume.

Use `timeoutMs` (1000–60000 ms) to bound each upstream Explore request; the default is 8000 ms. The CLI exposes the same per-request limit as `gtfa ask --timeout MS` and `gtfa snapshot --timeout MS`; `gtfa doctor --timeout MS` uses the same range for its network checks and skips the live fetch after a challenge or HTTP 429.

## Workflow for a new term

1. `trends_ask` with `validate: true`, `fresh: true`.
2. `trends_compare` against a known anchor to check relative scale.
3. `trends_now` for current corroboration (absence is evidence, not failure).
4. Repeat `trends_ask` on a second window before calling it a trend.

Include the geo, time window, and `fetchedAt` in your answer.

## Limits

Keep use light and interactive: no bulk scraping, no continuous polling, no request loops. During a validation run, stop later upstream work after `BLOCKED` or `RATE_LIMITED` and retain `retryAfterSec` when present. **Test connection** and doctor stop after a challenge or HTTP 429 rather than probing again. On `RATE_LIMITED`, wait `retryAfterSec` and retry once at most. On `BLOCKED` or `NETWORK_ERROR`, stop and report; do not rotate requests to route around a block. `trends_ask` (without `validate`), `trends_compare`, and `trends_now` return relative interest only — never claim search volume from them.
