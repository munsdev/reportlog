# Workstream H · Operations: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/amazing-heisenberg-hvxrw0`, based on `ccr-c9c93698-ev856l` (foundation + A, B, C, E, merged in)
- **Pull request:** [#4](https://github.com/munsdev/reportlog/pull/4), into `ccr-c9c93698-ev856l`
- **State:** finished up to what needs the user's accounts (a server, a domain, Scaleway, EU storage). Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                   | Result                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes (format, lint, types, boundaries; unit tests: api 185, web 364, fields 69, seal 31, access 4) |
| `pnpm test:db`                          | 25 files, 408 tests, all passed (25 files counted, 25 counts printed)                                |
| `db:types:check`                        | generated types up to date                                                                           |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 60 passed                                                                                            |
| ShellCheck on `deploy/`                 | clean (also a CI step now)                                                                           |

Beyond the suites, the install, deploy, failure, rollback and backup paths were run end to end on
fresh Debian 12 and Ubuntu 24.04 machines with systemd (privileged containers, `https://localhost`
with Caddy's internal CA, and moto as the S3 server). What was run, and what each run found, is in
the pull request and the commit messages. Not run against the real things: Scaleway, Hetzner or
Scaleway object storage, a real domain and certificate authority.

## What was built

The decision taken with the user: **systemd units on the bare server**, not containers.

1. **Deploy** (`deploy/`, runbook `deploy/README.md`).
   - `install.sh`: unattended security updates (OS, PostgreSQL, Caddy); PostgreSQL 16 from the
     PostgreSQL project's repository, pinned at apt priority 600, listening on its socket only
     (peer authentication, no password); Node 22.23.3 refused unless its SHA-256 matches
     `deploy/versions.conf`; Caddy; signing keys accepted only at pinned fingerprints; the
     `reportlog` user; the settings file with `TRUST_PROXY=1` and a generated `CONTACT_KEY`.
   - Releases in `/srv/reportlog/releases/<time>-<commit>`, `current` and `previous` symlinks.
     A deploy builds as the service user, strips build tools, hands the release to root
     read-only, **migrates before switching**, checks the contact key, then installs units and
     the Caddyfile, switches and restarts. A failed build, migration or key check leaves the old
     release running; a release that does not answer `/api/health` is switched back.
   - `rollback.sh` switches back and never touches the database (migrations are additive).
   - Units: `reportlog-api`, one `reportlog-job@` template, `reportlog-alert@`, a timer per job.
     All confined (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`,
     explicit `ReadWritePaths`, no capabilities). `systemd-analyze security`: 1.4, OK.
   - Caddy: automatic HTTPS, no access log, the website from `current` under a CSP that allows
     no other host.
2. **Email** (`apps/api/src/email/`): `scalewayMailer` implements A's `Mailer`.
   `createMailer(config)` picks `MAIL_OUTBOX` (browser tests), else Scaleway, else A's stderr
   fallback; `server.ts` uses it. `mail-test` sends one real message.
3. **Scheduled jobs** (`apps/api/src/jobs/`): one registry, timers generated from it (a test
   fails if they differ). `backup`, `sweep` and `lists-sweep` run; `anchor` (D) and the three
   digests (G) are slots with timers, each filled by replacing `run: undefined` with one line.
4. **Backups and the doctor**: dump, read back, prune, encrypt with age to keys not on the
   server, upload to S3-compatible EU storage with an upload-only key. `reportlog doctor` checks
   the deployment end to end, read-only.

## Legacy and its equivalents

| Legacy                                                      | Here                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `contrib/systemd/*`, `contrib/install-units.sh`             | `deploy/systemd/`, `install_units` in `deploy/lib.sh` (run on every deploy)       |
| `contrib/deploy.sh`, `install.sh`, `update-apply.sh`        | `deploy/install.sh`, `deploy.sh`, `rollback.sh`; releases instead of `git pull`   |
| `contrib/nginx/*`                                           | `deploy/caddy/Caddyfile`                                                          |
| `src/sweep.js`, `scripts/sweep.js`                          | `jobs/sweep.ts`; the lists sweep is its own job (`jobs/lists-sweep.ts`)           |
| `src/backup.js`, `scripts/backup.js`                        | `jobs/backup-files.ts`, `jobs/backup.ts` (adds encryption and the off-site copy)  |
| `src/doctor.js`, `scripts/doctor.js`                        | `jobs/doctor-checks.ts`, `jobs/doctor.ts`                                         |
| `src/email.js`, `scripts/mail-test.js`                      | `email/scaleway.ts`, `email/mail-test.ts` (no SMTP: the decision is Scaleway)     |
| `scripts/hourly-notify`, `weekly-notify`, `feedback-digest` | job slots `digest-hourly`, `digest-weekly`, `feedback-digest` (G)                 |
| `src/requestLog.js`                                         | partly the foundation's request serializer (route pattern, no address); see below |
| `src/accessLog.js`, `src/installConfig.js`                  | not ported; see "Not done"                                                        |

## Decisions made here that a reviewer should know about

- **`Mailer.send` throws when Scaleway refuses or cannot be reached** (`MailNotSent`, carrying the
  reason and the provider's words, never the address or body). A's callers treat a throw as "not
  sent": lists catches it, filing and sign-in let the error handler answer. Returning normally
  would tell a reporter to check an inbox nothing reached. `trySend` returns the result instead,
  for jobs and `mail-test`.
- **The credential sweep's tables**, each under the condition its owner already treats as dead
  (`SWEPT` in `jobs/sweep.ts`): `otp_codes`, `sessions`, `site_access_tokens`,
  `ownership_transfers` past `expires_at`; `organization_invites` still pending and past
  `expires_at` (A's `invitations.ts` deletes exactly these lazily); `organization_invite_sends`
  older than 14 days (A's `SEND_LOG_TTL_MS`); `report_submissions` never confirmed and past
  `expires_at`. Never `contact_keys`, `report_contacts` or a list table (tested).
  `list_erasures` and `list_notify_confirmations` are in `NOT_SWEPT`: the lists sweep handles
  them.
- **`CONTACT_KEY` is never rotated, enforced.** The first deploy records its SHA-256 fingerprint
  in `/var/lib/reportlog/contact-key.sha256`. A later deploy with a different key stops before
  switching, the API's `ExecStartPre` refuses to start on one, and the doctor fails.
  `install.sh` makes the key once and never on a server that recorded one. It is not in the
  backups; the runbook says to keep a copy off the server, away from the backups.
- **`TRUST_PROXY=1` and Caddy passes `X-Forwarded-For`.** An earlier version of this branch
  stripped the header, which behind Caddy would have made every visitor 127.0.0.1 to A's
  sign-in limits. Caddy replaces any client-sent value (no proxy in front of it is trusted).
  The doctor fails a server with `TRUST_PROXY=0`.
- **The lists sweep runs through the job runner**, calling E's `sweepLists` exactly as
  `lists/sweep-cli.ts` does, so the timer needs no pnpm on the server and a failure reaches the
  alert and the doctor.

## Changes outside H's folders (all named in the commit messages)

- `apps/api/src/config.ts`: the email, backup and alert settings, cross-checked where they only
  work together; `CONFIG_KEYS` exported for the `.env.example` test.
- `apps/api/src/server.ts`: `mailer: createMailer(config)` (one line).
- `.env.example`: every setting the server reads, A's, C's and E's included, with placeholders.
- `apps/api/package.json` and the lockfile: an `ops` script; `@aws-sdk/client-s3` and
  `@aws-sdk/lib-storage` 3.1144.0, exact.
- `.github/workflows/ci.yml` (H's, with care): installs `age` and `postgresql-client-16` for the
  backup tests; runs ShellCheck on `deploy/`.

## For the other workstreams

- **D (anchor):** replace `run: undefined` on `anchor` in `apps/api/src/jobs/registry.ts` with
  `(ctx) => import('../anchor/job.ts').then((m) => m.run(ctx))` or similar. `ctx` has the
  config, a database, a `Mailer`, a log function and `now`. Return `{ ok, summary }`. The timer
  (daily 04:00 UTC, 20 minutes of spread, catches up after downtime) already exists. If the
  anchor needs to write somewhere other than `/var/lib/reportlog`, add a drop-in like
  `deploy/systemd/reportlog-job@backup.service.d/` and say which path.
- **G (digests, feedback digest):** the same, for `digest-hourly`, `digest-weekly` and
  `feedback-digest`.
- **Anyone adding a table with an `expires_at` column:** `test/db/ops.test.ts` fails until the
  table is in `SWEPT` (with its condition) or `NOT_SWEPT` (with the reason) in
  `apps/api/src/jobs/sweep.ts`. A list table goes in `NOT_SWEPT`, always.
- **Anyone sending mail:** take a `Mailer`; expect `send` to throw `MailNotSent` when the
  provider says no, and decide whether your route can carry on.

## Not done

- **Bugsink error tracking.** In section H, not in the four steps asked for. Next.
- **`accessLog.js`** (who opened a report's protected data) belongs with the screens that open it
  (D, F) and its tables do not exist. **`installConfig.js`** generated keys; the one key that
  exists now, `CONTACT_KEY`, is made by `install.sh`. **`requestLog.js`**'s keyed digests of
  tokens are not ported.

## Waiting on the user

- A Hetzner server (Debian 12 or Ubuntu 24.04), a domain and its DNS, Scaleway Transactional
  Email (verified domain, key, project id, From address), EU object storage (bucket, upload-only
  key, lifecycle rule), an age public key, the alert address.
- Three decisions: Let's Encrypt is a US certificate authority (only the domain name reaches
  it); automatic reboots at 05:30 when an update needs one; install-time downloads come from
  GitHub, nodejs.org, the npm registry and Cloudsmith.
