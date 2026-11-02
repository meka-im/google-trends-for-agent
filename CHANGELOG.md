# Changelog

## 0.1.0

Initial release.

- Tools (CLI + MCP): `ask`, `snapshot`, `compare`, and `now` (Trending Now) for search-interest questions.
- Searches/day calibration anchored to `gpts`, with a reliability gate that marks low-confidence estimates.
- 24h and 7d charts (SVG, opt-in inline) with gap-aware rendering and peak/latest callouts.
- Configurable chart time zone (IANA) via library `timeZone`, CLI `--tz`, MCP `tz`, or `GTFA_TZ`; defaults to UTC and validates names with `Intl.DateTimeFormat`.
- Slim default payloads to keep agent context small; opt-in detail flags.
- Stable JSON envelope with structured errors and documented exit codes.
- Optional `HTTPS_PROXY` support and pluggable transport.
