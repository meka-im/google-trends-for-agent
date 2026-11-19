# Changelog

## Unreleased

Initial release in preparation.

- Estimate missing search volume on demand from a saved dsh result. One explicit follow-up uses the selected connection and records the result and any Actor cost.
- Use matched, settled samples for dashboard estimates. Show an anchor range when eligible anchors disagree and display estimates at two significant digits.

- Use the MEKA regional Google Ads catalog in dsh. Dashboard comparisons choose a usable anchor for each term within the same batch.
- Unify the dsh query form for 1–5 terms, retain its draft/result across panel navigation, and show actual Actor progress with elapsed time.
- Estimate multi-term traffic from one shared term-and-anchor batch. Five selected terms remain one batch; missing anchor space or weak baselines produce explicit null estimates.
- Fix clipped dashboard select labels and show input errors beside the field.

- Add a native Google Trends sidebar panel with Overview, Query and History tabs. Single-term and comparison queries share all nine supported time ranges.
- Retain up to 1,000 local manual and Agent calls, including failures. View, filter and clear saved records without starting an Actor; statistics follow retained records.

- Accept valid dsh browser requests forwarded through its internal HTTP bridge; preserve exact origin/Host and cross-site checks for account and Actor actions.

- Update an owned Actor from official main directly in dsh, with build progress and a bounded status wait.
- Verify the Actor's actual package version separately from successful keyword data checks. Runtime metadata is also available in the run's `GTFA_RUNTIME` record.
- Keep custom/pinned Actor source, saved settings and credentials intact when updating.
