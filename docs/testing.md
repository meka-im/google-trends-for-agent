# Automated checks

Install with `npm ci`, which also builds the package. The PR workflow runs the
following checks on Node 20 and Node 24:

```sh
npm run typecheck
npm test
npm run check:docs
npm audit --audit-level=low
npm run check:package
```

The unit and interaction tests use fixed responses. They do not query Google,
authorize an Apify account, start an Actor, or need any account credentials.
`check:package` installs the built tarball in a temporary consumer, checks its
CLI and library exports and both localized README mappings, then audits the
consumer's production dependencies. Installation and auditing contact npm.
`check:docs` checks local Markdown/HTML file references and the locale document
paths; it does not crawl external links or verify heading fragments.

## Browser interactions

`test/settings-interaction.test.tsx` mounts the actual settings page in jsdom.
It exercises user input and observable Host responses: Save and Discard,
rejected writes and retries, directory validation, read-only configuration,
explicit OAuth start/cancel/logout, polling cleanup on unmount or egress change,
and resuming a pending Host authorization after reopening the page.

The form and HTTP boundaries are isolated fixtures. These tests are not native
dsh UI acceptance or a live Apify OAuth grant. Native manual acceptance remains
a separate check for visual layout and the actual account authorization flow.

## Published dsh compatibility

Use a current Node 24 patch (local validation: Node 24.22.2) or newer:

```sh
npm run test:compat
# Run one staged baseline:
npm run test:compat -- 0.2.1-rc.3
```

`test/compat/baselines.json` is the single source for the versions this command
and CI run. As of 2026-11-16 it contains:

| dsh version | Reason |
| --- | --- |
| 0.2.1-rc.3 | The plugin's declared minimum |
| 0.2.2-rc.1 | npm's current published version at the time of staging |

The runner installs each exact official dsh version and the built gtfa tarball
into a fresh temporary directory. The real dsh profile loader mounts gtfa and
the official tools, configuration-editor, settings, and local credentials
services. It verifies:

- All four tools register and invalid input stops before networking.
- Config writes persist, form reads redact a secret, and stale revisions are refused.
- The gtfa OAuth manager saves a simulated grant through the real Host credentials provider.
- Stopping and rebooting the Host restores both configuration and the grant.
- Signing out removes the persisted OAuth session.

The test uses no user profile or credentials. Its child process has a restricted
environment and its own `DSH_HOME`; runtime fetch and undici networking are
disabled. OAuth endpoints return fixed responses. A missing dependency,
unusable native binding, failed boot, timeout, or assertion fails the check;
there is no skip-to-green fallback. The temporary installation is removed when
the runner finishes normally or fails. This is a minimal real Host composition,
not a complete desktop/web session or live Google query.

Add a new exact baseline after checking its published interfaces and running
the command. Compatibility metadata alone is not verification.

## Merge gate

The workflow's stable `CI required` check succeeds only when the Node checks
and the dsh compatibility job all pass. Repository branch protection must require
that check to prevent a failed or skipped job from being merged. This workflow
has read-only repository permissions and contains no publishing or deployment step.
