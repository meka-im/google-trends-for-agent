# Regional baseline evidence — 2026-11-16

These are historical observations from this date, not a live service-health or search-volume accuracy guarantee. Maintained coverage, configuration and limitations are in [docs/baselines.md](../../docs/baselines.md).

- `seodata-*.json`: provider API observations, including unsuccessful lookups. Each file separates the response-check time from any provider cache timestamp. No measurement period was supplied.
- `source-observations.json`: factual keyword rows from Semrush provider pages and a publisher's reported Ahrefs export. The Japanese September row was read from the search index of the provider's German-language report, not the current English October table.
- `trends-*.json`: Google Trends comparison envelopes, including candidate cross-checks, a sparse Canadian `gpts` probe and the rejected Indian 24h `sudoku` comparison. Zero-only or weak candidates are not used for calibration.
- `replay-summary.json`: offline conversion of the final sixteen 24h/7d comparisons using the shared calibration reliability gate. The replay time does not replace each comparison's original `fetchedAt`.

Run `npm test -- test/regional-baselines.test.ts` to replay the selected comparisons without a network connection. Broader actor forwarding, Host-schema and settings interactions are tested in `test/actor-on-demand.test.ts`, `test/dsh-config.test.ts` and `test/settings-interaction.test.tsx`.
