# Changelog

## 0.1.0

Initial release.

- Two install commands: `gtfa` for the CLI and `gtfa-mcp` for the MCP server.
- Tools (CLI + MCP): `ask`, `snapshot`, `compare`, and `now` (Trending Now) for search-interest questions.
- Searches/day calibration anchored to `gpts`, with a reliability gate that marks low-confidence estimates.
- 24h and 7d charts (SVG, opt-in inline) with gap-aware rendering and peak/latest callouts.
- Configurable chart time zone (IANA) via library `timeZone`, CLI `--tz`, MCP `tz`, or `GTFA_TZ`; defaults to UTC and validates names with `Intl.DateTimeFormat`. Chart filenames include a filesystem-safe time-zone slug plus a short SHA-1 of the canonicalized IANA zone name, so case variants share one file while different zones (including `Etc/GMT+1` and `Etc/GMT-1`) never overwrite each other.
- Slim default payloads to keep agent context small; opt-in detail flags.
- Stable JSON envelope with structured errors and documented exit codes.
- Optional `HTTPS_PROXY` / `HTTP_PROXY` support (direct by default), bounded 429 retries with `Retry-After`, and actionable upstream error messages.
- `gtfa doctor` for Node, reachability, proxy, and live `gpts` US 24h checks; human PASS/FAIL lines or `--json`.
- Install straight from GitHub with `npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa`; no npm publish required.
- Pluggable transport.
- Optional local Streamable HTTP MCP endpoint via `gtfa-mcp --http --port 4321`, plus an Apify Standby Actor (`.actor/`) that serves `/mcp`, uses an Apify Residential proxy in the US by default, and rotates the proxy session on HTTP 429 or a Google challenge.
