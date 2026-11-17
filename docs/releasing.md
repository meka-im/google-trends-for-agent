# Release and acceptance

GTFA is in pre-release testing. npm publication is a separate release decision.
Use one source commit and one tarball for the checks below; record their SHA-256,
package version, Node version, client version and actual execution path.

## Local gate

Run the checks in [testing](testing.md), including the packed consumer and real
dsh Host compatibility runner. Review the complete diff against `main` and wait
for `CI required` before merging. A merge does not install or deploy anything.

## Client acceptance

| Surface | Actual acceptance |
| --- | --- |
| CLI | Install the tarball in a clean consumer, then ask, compare, now and snapshot with inline SVG. |
| Local MCP | Initialize a fresh stdio session, list the four tools, call each once, then close the transport. |
| dsh | Install the same tarball; fully restart the backend. Verify Local, Public Actor and My own Actor, testing drafts before Save. |
| Muse / GrokBot | Prefer on-demand Apify through the public or a self-deployed Actor. Verify native managed MCP when available, otherwise the authenticated connector/API. Record the actual integration; an independent protocol client does not establish native acceptance. |
| Dots | Prefer the managed Apify MCP route with the public or a self-deployed Actor in a fresh session; CLI output alone does not establish GUI acceptance. |

Follow the [client setup guide](clients.md). Record the Actor that actually ran
and distinguish ordinary Dataset results from native `TOOL_RESPONSE` envelopes.

Use ChatGPT and Gemini (US, `now 1-d`), and `geos: ["US"], hours: 24, limit: 3`
for the hot list. A snapshot should have valid inline SVG and null related-query
`estDaily` values. Check US and a regional/Worldwide calibration. Unsupported
regions and weak anchors must keep traffic null, with an explanation.

Stop that egress path at the first `BLOCKED` or `RATE_LIMITED`; preserve the
response and report that path's limitation. Do not turn a skipped test into a
pass. Do not start continuous polling or a Standby service.

## Actor updates

Public Actor deployments are maintained by the release owner. A public build
should be tested before assigning `latest`. Own deployments are separate:
in dsh choose **My own Actor → Update selected Actor**. This rebuilds version
`0.1` only when the Actor belongs to the current account and its Git source is
this repository's default/main branch. It does not replace source, input,
environment variables or configuration. Custom or pinned source must be
updated in Apify Console. Build compute usage applies to the user's account.

After the exact build succeeds, run **Test connection**. The result separates
data access from the actual Actor/plugin versions. Versions that differ or are
unreported are not proof of parity. `GTFA_RUNTIME` in the run's key-value store
and `TOOL_RESPONSE.runtime` report the package version and baseline revision;
Apify's `buildNumber` is a different counter. The public Dataset row shape is
unchanged. A cached result remains evidence of its original fetch; use
`fresh: true` after an Actor update when verifying new code.

## Account and cost checks

Preserve the user's active credentials and unsaved drafts. Test cancel, logout,
reopen, restart and account-switch behavior with an isolated Host profile;
live grants require the account owner's authorization. Every Actor run must
finish or be aborted and keep the 300-second platform bound. Record actual
run usage when available; do not claim a fixed number of free queries.

Install to the intended dsh profiles only after checks pass. Verify the installed
version and bundle hashes. Confirm the public Actor and selected own Actor run
the accepted source, and that no owned test runs remain active. Keep dated
evidence outside maintained instructions and report any remaining acceptance
gap explicitly.
