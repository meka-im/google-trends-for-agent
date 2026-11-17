# Changelog

## Unreleased

Initial release in preparation.

- Add a native Google Trends sidebar panel with Overview, Query and History tabs. Single-term and comparison queries share all nine supported time ranges.
- Retain up to 1,000 local manual and Agent calls, including failures. View, filter and clear saved records without starting an Actor; statistics follow retained records.

- Accept valid dsh browser requests forwarded through its internal HTTP bridge; preserve exact origin/Host and cross-site checks for account and Actor actions.

- Update an owned Actor from official main directly in dsh, with build progress and a bounded status wait.
- Verify the Actor's actual package version separately from successful keyword data checks. Runtime metadata is also available in the run's `GTFA_RUNTIME` record.
- Keep custom/pinned Actor source, saved settings and credentials intact when updating.
