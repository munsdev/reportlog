# P7 · Operations tests (H3): status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/p7-ops-tests`, based on `ccr-c9c93698-ev856l`
- **Pull request:** see below
- **State:** finished. The storage check against a real provider waits on one being chosen.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                   | Result                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes (format, lint, types, boundaries; unit tests: api 338, web 423, fields 69, seal 31, access 6), with Caddy and moto present |
| `pnpm test:db`                          | 52 files, 807 tests, all passed                                                                                                   |
| `db:types:check`                        | generated types up to date (P7 adds no migration)                                                                                 |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 124 passed                                                                                                                        |
| ShellCheck on `deploy/`                 | clean (0.11.0, as CI runs it)                                                                                                     |

Run after merging `origin/ccr-c9c93698-ev856l` at `9771872` (A2 and C3 in). P7's own tests: api unit
56 (`deploy-release` 30, `deploy-install` 15, `deploy-caddy` 7, `deploy-storage-check` 4), api db 5
(`deploy-schema-drift`). One earlier run failed: my listing test assumed two deploys never share a
second; it now checks the rule the command actually uses (name order).

## What was built

Five test files (61 tests) and one helper. Nothing here needs a server, a domain, Bugsink or a
storage account.

### The deploy scripts, run (`U/deploy-install.test.ts`, `U/deploy-release.test.ts`)

`apps/api/test/unit/deploy-sandbox.ts` is a pretend server. Each script is copied with exactly
its system paths (`/srv/reportlog`, `/etc/systemd/system`, `/usr/local/bin`, `/opt`, ...) moved
under a temporary directory, and nothing else changed. A guard refuses the copy if a script names
a system path the list does not move, so a new path in a script cannot write to the machine
running the tests (in a cloud session, as root). systemctl, apt-get, Caddy, gpg, curl, runuser,
chown, useradd, PostgreSQL's tools, and the application's node and pnpm are stand-ins that record
each call in order and fail when a test says so. Files, symlinks, git (a real upstream
repository and mirror), tar, flock, sed and install are real, so what a test reads is what the
script wrote.

`deploy.sh` (through `reportlog deploy`, 30 tests with rollback and the command):

- the order: build as `reportlog` under `env -i`, strip the build tools, hand to root, migrate,
  check the contact key, Caddyfile, units, switch, restart, health, tooling, doctor;
- no pnpm or node call ever runs outside `runuser -u reportlog -- env -i`; the app reads its
  settings only from the env file;
- the release is `<UTC>-<sha12>` with `REVISION`, root-owned, no group/other write, without dev
  dependencies;
- units and drop-ins installed byte for byte, every timer enabled, a timer the release dropped
  disabled and removed; the Caddyfile rendered with the domain from `SITE_ORIGIN` and the ACME
  email (and without it when empty), reloaded only when it changed; health on `PORT`;
- the same commit twice does nothing; prune keeps five plus `current` and `previous`;
- each failure leaves the running release running: a failed build (kept `.failed`, nothing
  migrated), a failed migration (units untouched), a changed contact key, an invalid Caddyfile, a
  release that does not answer (switched back, its old `previous` restored, restarted twice), a
  first release that does not answer, a ref that does not exist, a repository that cannot be
  fetched;
- refusals: not root (both `reportlog` and `deploy.sh` itself), no `deploy.env`, the lock held by
  another deploy (and `reportlog updates` stands aside for it).

`rollback.sh`: goes to `previous` and back again, **calls no node at all** (no migration, no
doctor), installs the target's units and tooling, refuses a path that is not a release
(`../../../etc` included), a `.failed` one, the running one and a missing `previous`, and says how
to return when the target does not answer.

`reportlog`: `releases` marks `*` and `<`; `doctor`, `backup`, `job`, `jobs`, `mail-test` run the
release's `cli.ts` as `reportlog` with the env file, from the running release; nothing deployed,
an unknown command, no sudo and `help` each say what to do.

`install.sh` (15 tests): the order (updates, PostgreSQL, Node, Caddy, user and database, settings,
command); the apt files, the pgdg pin and `bookworm-pgdg`/`noble-pgdg`, keyrings only from keys
at the pinned fingerprints, `listen_addresses = ''`; Node from a real `.tar.xz` checked by the
script's own `sha256sum` against the pin, linked into `/usr/local/bin`, arm64 with its own pin;
the settings file (socket `DATABASE_URL`, `TRUST_PROXY=1`, `TEST_DATABASE_URL` commented out, a
32-byte `CONTACT_KEY` never printed, 0640, every template line kept); run again it changes
nothing; it never makes a key on a server that recorded one; refusals (another OS before any
change, another architecture, not root, a tarball off its pin with nothing installed, a pgdg or
Caddy key off its fingerprint with nothing trusted).

### Caddy's `Cache-Control` (`U/deploy-caddy.test.ts`, 7 tests)

The shipped Caddyfile in a real Caddy (2.10.2), rendered as `lib.sh` renders it with four
swaps so it runs here (plain HTTP on a free port, an admin port, a website directory, a stand-in
API). The page at every SPA address and every unhashed file says `no-cache`; an unchanged page
answers 304 to `If-None-Match`; a hashed asset is `public, max-age=31536000, immutable`; a
missing asset is a 404 that is not HTML and not kept; the API's own `Cache-Control` passes
through and a visitor's `X-Forwarded-For` is replaced; the security headers are on every kind of
answer; and the shipped file validates with a real domain.

### Schema drift against real databases (`T/deploy-schema-drift.test.ts`, 5 tests)

Legacy `schema-state-selftest`, each state made for real in its own database and judged by the
doctor's `diagnose`: in step (ok, and the doctor writes nothing); behind (a database migrated by
the code before the newest migration: fail naming exactly that file, then the runner applies
exactly it); ahead (a warning naming the file, never "not applied", and the runner refuses to
deploy the older code and changes nothing); never migrated (every file reported, nothing thrown,
the table not created).

### The storage check (`U/deploy-storage-check.test.ts`, 4 tests)

`files:storage-check` run whole, as its own process, against moto 5.0.28 (an S3 server this
repository did not write): three buckets ok and empty afterwards; a missing bucket named with
`NoSuchBucket` while the others are still checked; an unreachable endpoint with its cause; not
configured, and half configured, each named. **The real provider's run is the owner's**, once one
is chosen: `deploy/README.md`, "Checking file storage", gives the command, the expected output
and what each failure usually means.

## Bugs found, and fixed (each in the commit message)

1. **A missing hashed asset was served as the page, kept for a year** (`deploy/caddy/Caddyfile`).
   `GET /assets/<a chunk the new release dropped>` answered 200 `text/html` (the SPA fallback)
   with `public, max-age=31536000, immutable`: a page loaded before a deploy that lazily loads a
   chunk got HTML as a script, and every cache, shared ones included, could keep it under that
   name for a year. Now `/assets/*` is a 404 when the file is not there, with `no-cache`, by
   `respond` so that the site's header block (HSTS, nosniff, no `Server`) still applies: a
   `file_server` 404 is an error response, and Caddy skips the deferred header block on those
   (the first fix lost them; the test caught it).
2. **An invalid Caddyfile left the running release under the new release's units**
   (`deploy/lib.sh`, `activate`). Units were installed, daemon-reloaded and timers enabled before
   the Caddyfile was validated, so "does not validate. Nothing was switched." stopped the deploy
   with the old code running on the new release's timers. The Caddyfile now comes first.
3. **The storage check said only "fetch failed"** for an endpoint it could not reach
   (`apps/api/src/files/storage-check-cli.ts`, F's, three lines): it now adds fetch's cause
   (`ECONNREFUSED`, `ENOTFOUND`, a certificate error), the part an owner checking a new provider
   needs.

## Found, not fixed

- **Caddy's own error responses** (a 502 when the API is down, for example) skip the site's
  header block the same way: no HSTS, no nosniff, and `Server: Caddy`. Not a regression and not
  in this brief; fixing it means `handle_errors` or not deferring that block. For H or whoever
  next touches the Caddyfile.
- **The deploy runs node from the directory the operator ran `sudo reportlog deploy` in** (often
  `/root`, which `reportlog` cannot read). H ran deploys end to end on real machines without
  trouble, and nothing here proves harm, so it is noted only.

## Changes outside P7's folders (named in the commit message)

- `apps/api/src/files/storage-check-cli.ts` (F): the cause of a failed fetch (bug 3).
- `apps/api/test/db/deploy-schema-drift.test.ts`: a database test, so it lives in `test/db/`.
- `.github/workflows/ci.yml`: installs Caddy 2.10.2 (tarball checked by SHA-256; its SHA-512 is
  in Caddy's published checksums) and moto 5.0.28, and points the tests at them. Both tests fail
  rather than skip in CI, and skip on a machine without them.
- `docs/parity.md`: the four rows this closes.

## Not covered

- Real systemd, real apt, real Caddy certificates: the stand-ins prove what the scripts ask for,
  not that Debian does it. H's end-to-end runs remain the evidence for that.
- Virtual-hosted S3 addressing (it needs a DNS name per bucket); a wrong secret against moto
  (moto does not check signatures by default; `U/files-storage.test.ts` covers it against its
  own signature-checking stand-in).
