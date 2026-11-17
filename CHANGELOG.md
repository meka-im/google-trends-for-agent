# Changelog

## Unreleased

Initial release in preparation.

- Update an owned Actor from official main directly in dsh, with build progress and a bounded status wait.
- Verify the Actor's actual package version separately from successful keyword data checks. Runtime metadata is also available in the run's `GTFA_RUNTIME` record.
- Keep custom/pinned Actor source, saved settings and credentials intact when updating.
