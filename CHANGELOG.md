# Changelog

## Unreleased

Initial release in preparation.

- Accept valid dsh browser requests forwarded through its internal HTTP bridge; preserve exact origin/Host and cross-site checks for account and Actor actions.

- Update an owned Actor from official main directly in dsh, with build progress and a bounded status wait.
- Verify the Actor's actual package version separately from successful keyword data checks. Runtime metadata is also available in the run's `GTFA_RUNTIME` record.
- Keep custom/pinned Actor source, saved settings and credentials intact when updating.
