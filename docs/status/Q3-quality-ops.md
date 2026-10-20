# Q3 · Quality and operations: status

For the coordinating session and the other workstreams. Brief: the owner's decisions 12, 13 and
15 and "Keys and secrets" (`docs/decisions.md`), plus the starting-points screen P3 left.

- **Branch:** `claude/q3-quality-ops`, based on `ccr-c9c93698-ev856l`; the base was merged in
  again at `b43b43a` (Q1 merged)
- **Pull request:** [#28](https://github.com/munsdev/reportlog/pull/28), into `ccr-c9c93698-ev856l`
- **State:** finished and merged into `ccr-c9c93698-ev856l` (`042efc0`).
- **Last updated:** 2026-10-20

## Checks, as last run before pushing

Run after merging `origin/ccr-c9c93698-ev856l` at `b43b43a` (Q1 merged; Q2 not yet).

| Suite                                   | Result                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes: format, lint, types, boundaries; unit tests api 399 (4 skipped: moto is not installed here, CI has it), web 472, fields 69, seal 31, access 6       |
| `pnpm test:db`                          | 65 files, 984 passed                                                                                                                                        |
| `db:types:check`                        | generated types up to date (Q3 adds no migration)                                                                                                           |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 748 passed, 3 skipped (not Q3's). The accessibility walk is 296 of them: 73 pages × stranger and administrator, the wizard and the floor, desktop and phone |
| ShellCheck on `deploy/`                 | clean (0.11.0, as CI runs it)                                                                                                                               |
| gitleaks over the whole history         | no leaks found (8.30.1, `.gitleaks.toml`, as CI's new job runs it)                                                                                          |

Q3's own tests: api unit 50 (`deploy-bugsink` 22, `secrets` 10, `secret-scan` 4, `release` 6, the
installer's questions 7 and the API's backup path 1 in P7's files, the unit paths 2 updated), web
unit 4 (`starting-points`), browser 296 (`accessibility.spec.ts`). Caddy 2.10.2 and gitleaks
8.30.1 were present for the unit run, so the real-Caddy and planted-key tests ran, not skipped.

**Red on the way:** the first full browser run failed 8 accessibility tests on `/board/` and
`/moderate`, which the earlier walk on its own had passed because no report had been published
yet (below). One unit run went red after I widened the API's writable paths for Q2 and pushed
before running H's `jobs.test.ts`, which pinned the old rule; fixed in the next commit.

## What was built

### 12. Accessibility: an automated check on every page

- `apps/web/e2e/accessibility.spec.ts` (new, its own spec). **axe-core 4.14.0**, a dev dependency
  of the website, read from `node_modules` and evaluated inside the page as a string: nothing is
  fetched, so the check itself asks no third party for anything, and it works under the site's
  CSP (no inline script is added to the page).
- **Every page**, found the way P1's third-party walk finds them: the `fullPaths` of
  `src/routeTree.gen.ts`, with the same parameter values. A page added later is checked without
  anybody remembering to. Each is opened **as a stranger and as an administrator**, in both
  browser projects (desktop Chrome and a Pixel 7), plus the setup wizard's first screen.
- **Rules:** WCAG 2.0, 2.1 and 2.2, levels A and AA (axe's `wcag2a`, `wcag2aa`, `wcag21a`,
  `wcag21aa`, `wcag22a`, `wcag22aa` tags). A failure names the rule, the elements and axe's help.
- **Allowances:** `ALLOWED` in the spec, one rule on one page for one visitor, each with its
  reason. No blanket disable exists. An allowance that no longer matches fails the test, so a fix
  cannot leave one behind (unless it is marked `onlyWhenPresent`, with why). **There are two,**
  for Q2's board (below); everything else found was fixed.

**What it found, and what was fixed:**

| Rule                                    | Where                                                           | Fix                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label-content-name-mismatch` (serious) | `/logbooks/front-page` (B's `HomeButtonsEditor`), administrator | The buttons' accessible names ("Move “Demo logbook” up") did not contain their visible words ("Move up"), so somebody using speech input who says what they see cannot press them (WCAG 2.5.3). Now "Move up: “Demo logbook”", "Move down: …", "Take off the page: …", "Add to the page: …". |
| the same                                | B's `LogbookEditor` (question order), not reached by the walk   | The same pattern, the same fix. The walk opens a launched logbook, where these buttons are not drawn, so it could not see them. `e2e/builder.spec.ts` (B's) clicks the two new names.                                                                                                        |

| the same | `/moderate` (D's moderation `Queue.tsx`), administrator | Each row is one link, labelled "Open RL-…", which hid the whole card's visible text. Now the card's text names it, after a screen-reader-only "Open ", so the existing tests' `/^Open RL-/` still match. |
| the same | `/board/` (Q2's `features/board/Board.tsx`), both visitors | **Not fixed here: Q2's folder while Q2 works in it.** "Read in full" is labelled "Read RL-… in full". Two commented allowances in `ALLOWED`, marked `onlyWhenPresent` (the board is empty until another test publishes a report, and files run in no fixed order). Reported; the coordinating session asked Q2 to fix it before #27 merges. Remove both entries with that fix. |

The first two and the third are small fixes in B's and D's screens; nothing needed fixing in
`components/ui/`. Nothing else on any page failed, on desktop or phone, with the reports the
other specs filed and published present.

**What it does not cover:** only what a page shows when it loads (a dialog, a menu or a later
card of a form is checked only if it is open on arrival); only the default look (the operator
can choose any of 18 palettes, and contrast differs between them); pages whose parameter names
nothing show their "not found" state. axe finds roughly the mechanical half of WCAG problems;
it is not a substitute for a person with a screen reader.

### 13. Bugsink on the same Hetzner server

- `deploy/install-bugsink.sh`, run after `install.sh`, safe to run again:
  - asks for Bugsink's **own domain** (suggesting `bugsink.<site domain>`), kept as
    `BUGSINK_DOMAIN` in `/etc/reportlog/deploy.env`;
  - installs **Bugsink 2.6.1** into `/opt/bugsink-2.6.1` (link `/opt/bugsink`) with
    `pip --require-hashes --only-binary :all: --no-deps` from `deploy/bugsink/requirements.txt`,
    in which every file of every dependency is pinned by SHA-256 (compiled with uv, two weeks'
    cut-off; the same file serves Python 3.11 and 3.12). A failed install removes itself;
  - its **own user** `bugsink`, **own database** (SQLite in `/var/lib/bugsink`, not the
    archive's PostgreSQL), **own key** (`SECRET_KEY` in `/etc/bugsink/bugsink.env`,
    root:bugsink 0640, made there);
  - an **administrator** for Bugsink's own sign-in (email, password twice; the password reaches
    Django on standard input, never on a command line), a project "ReportLog", and
    **`ERROR_TRACKING_DSN=http://<key>@127.0.0.1:8000/<id>`** in the archive's settings: events go
    to the local port and never leave the machine;
  - the services `bugsink` (gunicorn on 127.0.0.1:8000, no access log, migrates on start) and
    `bugsink-snappea`, both confined like the archive's units; restarts the API.
- **Caddy:** `deploy/bugsink/bugsink.caddy` is Bugsink's own site block. `install_caddyfile`
  (`deploy/lib.sh`) appends it whenever `BUGSINK_DOMAIN` is set, from the copy the installer put
  in `/etc/bugsink`, so every deploy keeps it and a rollback to an older release does too.
- **Settings** (`deploy/bugsink/bugsink_conf.py`, no secret in it): Bugsink's anonymous daily
  phone-home to bugsink.com **off**, its own error reporting off, email off, webhook alerts to
  nowhere, no client address taken from a header (`USE_X_REAL_IP = False`), errors kept 30 days,
  only an administrator adds people.
- Runbook: `deploy/README.md`, "Error tracking (Bugsink)", replacing H2's "run it elsewhere".

**Run for real once, outside the suites:** Bugsink 2.6.1 installed from the pinned file on
Python 3.11 and 3.12 (`pip check` clean), migrated with the shipped settings (`check --deploy`
clean), the administrator and project made with the installer's own Python, gunicorn and snappea
started, and the real API (ERROR_TRACKING_DSN on the loopback form) relayed a browser error to it.
It arrived as an issue, with its message scrubbed ("at [address]"), no `user` and no `request`.

### 15. Versions

- Root `package.json`: `"version": "0.1.0"`.
- `CHANGELOG.md`: `## Unreleased` at the top, then `## v0.1.0 — 20 October 2026`, in plain
  language by who it is for (somebody filing, moderators, the people running a site).
- The footer's version line (P2) and H2's update check already read both; nothing else needed
  wiring. `apps/api/test/unit/release.test.ts` keeps them in step: the newest changelog entry is
  the package version, it is what the footer shows, entries are dated and newest first, and no
  heading would be skipped by the update check's parser.
- README: "Versions and releases", how a release is cut (notes under Unreleased, one
  `Release vX.Y.Z` commit, merge, tag, `sudo reportlog deploy vX.Y.Z`).

### Keys and secrets

- **Read only from `/etc/reportlog/reportlog.env`:** checked by `apps/api/test/unit/secrets.test.ts`.
  It lists the ten secret settings with who provides each, and fails when a setting whose name
  looks secret is on neither that list nor `NOT_SECRET` (with a reason); when `.env.example` has
  one with a value, or more than once; when the server does not start with them blank; when an
  installer neither makes nor asks for one; when any server source other than `config.ts` reads
  one from `process.env`; when a unit runs node without `--env-file=/etc/reportlog/reportlog.env`
  or names another `EnvironmentFile`; when `deploy.env` (0644) could hold one; and when anything in
  `deploy/` or `.github/` gives one a value.
- **`.env.example`:** every secret now blank (`SCALEWAY_SECRET_KEY=`, `BACKUP_S3_*_KEY*=`,
  `S3_ACCESS_KEY=`, `S3_SECRET_KEY=`, `ERROR_TRACKING_DSN=`, `TRANSPARENCY_LOG_REMOTES=`; the
  three keys were already).
- **The installer asks, or makes:** `install.sh` now makes `FILES_KEY` (on a new settings file;
  on an existing one only after "yes, this server never took a file") and the transparency log's
  ed25519 deploy key (showing only its public half), as it already made `CONTACT_KEY`. Then it
  asks, one at a time, for the site address, the Scaleway sending address, project ID and secret
  key (and turns `EMAIL_TRANSPORT` to scaleway once all three are there), the alert and list
  addresses, the age recipient, the five backup bucket settings (the rest only once there is an
  endpoint), the files bucket settings (skippable until a provider is chosen; `FILES_STORAGE=s3`
  once they are there) and the transparency log's address. Each answer is checked for its shape
  and asked again if wrong; keys are not echoed; Enter skips; it ends by naming, never showing,
  what is still empty; a re-run asks only that. Values reach the file through `set_env`, which
  hands them to awk through its environment, never its arguments.
- **Secret scan in CI:** a `Secret scan` job runs **gitleaks 8.30.1** (pinned by version and
  SHA-256 of the release tarball, from gitleaks' published checksums, like P7's Caddy) over the
  **whole history** (`fetch-depth: 0`) with `.gitleaks.toml`: gitleaks' own rules, plus a rule for
  ReportLog's secret settings written with a value, and one for a DSN carrying a project key. The
  history had 33 findings with the default rules alone, all fake: each value is allowed by name in
  the config with its reason (the old self-tests' fixed key, the telemetry tests' made-up token,
  signing-key fingerprints, age public keys, placeholders containing "example", AWS's
  documentation keys). No blanket allowance.
- **The planted key:** `apps/api/test/unit/secret-scan.test.ts` makes repositories, plants keys
  generated at run time (so none is committed, fake or not) and runs CI's exact command: a
  `CONTACT_KEY` and `FILES_KEY` in an env file, a Scaleway key in a shell line, a backup secret in
  JSON, a DSN, a PEM private key, an AWS key ID and a GitHub token are each found and named; a
  key deleted in a later commit is still found in the earlier one; this repository's own
  templates pass. It runs in CI (gitleaks installed in the checks job, `GITLEAKS_BIN`), and fails
  rather than skips there.

### The starting-points screen (P3's leftover)

`/settings/starting-points` ("Starting points" in the settings nav). Lists P3's templates with
what each changes, in the server's own words (`GET /api/admin/templates`), and which one the site
last started from. "Apply this…" opens a dialog repeating what it will change; only "Apply it"
sends `POST /api/admin/templates`. Afterwards it says what was applied and links the draft
logbook; a refusal keeps the dialog and says nothing changed. Tests:
`apps/web/test/starting-points.test.tsx` (4). It is in both browser walks (third parties and
accessibility) by being in the route tree.

## Bugs found, and fixed

1. **A blank `FILES_KEY=` stopped the server at start** (`apps/api/src/config.ts`). `.env.example`
   ships it blank, `install.sh` copied that to the server, and `config.ts` checked an empty string
   as a key ("FILES_KEY is 32 random bytes") instead of treating it as not set, as the file's own
   header promises. The same for `CONTACT_KEY` (hidden on a server because `install.sh` always
   fills it) and the `S3_` settings. They now use the file's own `optional()`.
2. **The Bugsink administrator's password on a command line**, in my own first version of the
   installer (`env DJANGO_SUPERUSER_PASSWORD=…`). The test that checks no secret appears in a
   recorded call caught it before it was committed; the password now goes in on standard input.
3. **`label-content-name-mismatch`** in B's front-page and question-order buttons and D's
   moderation queue (above).

## Changes outside Q3's folders (named in the commit messages)

- `apps/web/src/features/builder/HomeButtonsEditor.tsx`, `LogbookEditor.tsx` and
  `apps/web/e2e/builder.spec.ts` (B): the button names above.
- `apps/web/src/features/moderation/Queue.tsx` (D): the row's name, above.
- `apps/web/src/routes/(staff)/settings/route.tsx` (P2's settings area): one nav line.
- `deploy/systemd/reportlog-api.service` (H's units, in `deploy/`): `ReadWritePaths=/var/backups/reportlog`,
  asked by Q2 for its owner-only backup screen; `apps/api/test/unit/jobs.test.ts` (H) names it,
  and `deploy-release.test.ts` (P7) checks the installed unit, the backup drop-in and
  `BACKUP_DIR` agree.
- `apps/api/src/config.ts` (shared): blank is "not set" for the keys and `S3_` settings.
- `apps/api/test/unit/deploy-sandbox.ts`, `deploy-install.test.ts` (P7's harness): stand-ins for
  `ssh-keygen`, `python3 -m venv`, pip and `bugsink-manage`; `id` per user; answers on standard
  input; one expectation for the new deploy-key line; the installer's questions tested there.
- `turbo.json`: `GITLEAKS_BIN` reaches the tests.
- `apps/web/package.json` and the lockfile: `axe-core` 4.14.0 exact (it was already in the
  lockfile, through `eslint-plugin-jsx-a11y`).
- `routeTree.gen.ts` regenerated.

## Not done, or not verified

- **Systemd, apt and a real server:** the Bugsink units and both installers were run against
  P7's pretend server, not on Debian or Ubuntu with systemd. Bugsink itself was run for real
  (above), but under a shell, not under the units' confinement. `MemoryDenyWriteExecute` is left
  off its units because cffi may need it; not tried.
- **Bugsink is not in the doctor.** `reportlog doctor` (H's `jobs/doctor-checks.ts`) does not
  check that Bugsink answers; a stopped Bugsink shows only as errors not arriving.
- **Old Bugsink versions are not pruned** from `/opt` after an upgrade.
- **Accessibility:** the limits listed above (default palette only, states on arrival only).
- **The secret scan reads git history only**, as CI runs it; it does not scan a developer's
  untracked files (locally it finds this session's own `.env`, which git ignores).
