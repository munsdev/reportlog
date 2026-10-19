# Workstream A · Identity and access: status

This is for the coordinating session and the other workstreams. There is one file per workstream in
`docs/status/`, so these never conflict in a merge. (G put its report in
`docs/reports/workstream-G.md` instead.)

- **Branch:** `ccr-b78522c6-nw0aj6`, based on `ccr-c9c93698-ev856l` (the foundation)
- **Pull request:** [#3](https://github.com/munsdev/reportlog/pull/3), into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review, not merged. The PR description has the full detail.
- **Last updated:** 2026-10-19

## Checks

| Suite                               | Result                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| `pnpm check`                        | passes (lint, format, types, boundaries; unit tests: api 15, web 13) |
| `pnpm test:db`                      | 10 files, 138 tests, all passed (the foundation alone has 26)        |
| `db:types:check`                    | generated types up to date                                           |
| Browser suite (`CHROMIUM_PATH` set) | 13 passed (7 of them are A's, in the `identity` project)             |
| CI on GitHub                        | both jobs green on `c8107d1`, and the PR merges cleanly              |

**Why the browser job was red before `c8107d1`:** the web server timed out before any test ran. G found the cause:
`vite preview` binds `localhost`, which resolves to `::1` alone on GitHub's runners. I ported G's
exact one-flag fix (`--host 127.0.0.1` in `apps/web/playwright.config.ts`) in the same commit as
this file, worded identically so the two branches merge cleanly. CI went green with it.

## What was built

**API (`apps/api/src/identity/`, migration `20261018120000_identity.sql`, contracts `packages/contracts/src/identity.ts`)**

- **Sign-in by an emailed one-time code, and sessions** (`otp.ts`, `sessions.ts`, `authRoutes.ts`).
  - A code is bound to its purpose: sign-in, setup, or a handover to one named address.
  - Five guesses per address. Each guess is counted in the same statement that checks it, so
    parallel guesses are counted too.
  - There are per-client and per-address limits.
  - Credentials (sessions, site-password tokens, invitation links) are stored only as hashes.
  - Signing in never changes a role.
- **Roles** (`roles.ts`, `guards.ts`).
  - Every grant asks `packages/access`.
  - The change and its `role_audit` row are written in one transaction. The audit table is
    append-only by trigger.
  - `requireRole(request, roles)` and `requireGranter(request)` are what other workstreams' staff
    routes should use.
- **Owner handover** (`ownership.ts`): two-party, with a code to the owner that names the
  recipient. The database allows exactly one owner, and the outgoing owner becomes an admin.
- **Organizations and invitations** (`organizations.ts`, `invitations.ts`, `orgRoutes.ts`).
  - A manager cannot make a manager.
  - An organization always keeps at least one manager.
  - A manager's invitation of another manager waits for an admin.
  - A link works once, for one address, and looking at it does not accept it.
- **The site password and its doors** (`siteAccess.ts`, `gate.ts`, `doors.ts`, `curtainRoutes.ts`).
  - A `preValidation` gate covers every route except `IN_FRONT` in `gate.ts`.
  - What gets past it is named in two places only: list routes marked
    `config: { curtain: 'decides-itself' }` (prefix-checked when each route registers), and
    `FILING_CALLS` in `doors.ts` for a launched logbook set to `link` or `door`.
- **First-run setup** (`setup.ts`, `curtainRoutes.ts`).
  - The wizard refuses to run until a site password exists. `set-site-password.ts` is the
    installer's way to set it.
  - The wizard seats the owner once. Its keep-or-change decision about the site password cannot
    be skipped.
  - A new password retires the old site-password cookies.
- **Email** (`apps/api/src/email/mailer.ts`): a `Mailer` interface, with a capturing double for tests
  and a file outbox for the browser tests. With no provider configured, mail goes to stderr.

**Website (`apps/web/src/features/identity/`, `apps/web/src/routes/(staff)/access/`)**

- **`SiteGate`** (in `main.tsx`).
  - While the site is locked, the router is not mounted, so nothing renders and nothing navigates.
  - Door paths (`/file/:slug`, `/file/confirm/:token`, `/list/:slug`) mount the router for that one
    page, with navigation blocked.
  - A `locked` refusal from the API brings the password screen back.
  - An unfinished deployment shows the setup wizard.
- Pages:
  - `/access/sign-in` (with `?next=`)
  - `/access` (your account, roles, owner seat, site password)
  - `/access/orgs`, `/access/orgs/:id`
  - `/access/invitation/:token`
  - `/access/audit`
- A sign-in link in the header.

## Legacy tests and their equivalents

| Legacy                 | Here                                   | Notes                                                                       |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `ownership-selftest`   | `apps/api/test/db/ownership.test.ts`   | All seat checks. Its NULL-filter block is the board's (D)                   |
| `invitations-selftest` | `apps/api/test/db/invitations.test.ts` | Check for check                                                             |
| `orgs-selftest`        | `apps/api/test/db/orgs.test.ts`        | Not its chain half: a coordinator-filed report needs C's third-party filing |
| `doors-selftest`       | `apps/api/test/db/doors.test.ts`       | Against stand-in filing routes. List doors are E's                          |
| `setup-selftest`       | `apps/api/test/db/setup.test.ts`       | Not the site name/publishing/attachments questions (G's and F's)            |
| `identity-selftest`    | `apps/api/test/db/identity.test.ts`    | The legacy script tests the site name (G's). This file tests sign-in        |

The browser test `apps/web/e2e/identity/access.spec.ts` covers:

- the locked page and its router;
- the setup wizard;
- a door;
- **an invitation followed from the link in its email**;
- a role grant on the record;
- signing out.

## Changes outside A's folders

All of these are named in the commit messages.

- `apps/api/src/email/mailer.ts` (H's folder)
- `apps/api/src/config.ts`: `SITE_ORIGIN`, `MAIL_OUTBOX`, `TRUST_PROXY`
- `apps/api/src/app.ts`: one registration line, placed first, plus an optional `mailer` and `trustProxy`
- `apps/api/src/server.ts`: picks the mailer
- Migration: `logbooks.outside_access` (`NOT NULL DEFAULT 'closed'`, never sealed)
- `apps/web/src/main.tsx`: the gate
- `apps/web/src/routes/__root.tsx`: the header link
- `apps/web/playwright.config.ts`: the outbox, the `identity` project, G's `--host` fix
- `apps/web/e2e/global-setup.ts`
- `.gitignore`
- Dependencies: `@fastify/cookie` (api), `@reportlog/access` (web)

## For the other workstreams

- **B:**
  - Your 23 `TODO(workstream A)` markers: use `requireRole(request, ['admin'])` from
    `apps/api/src/identity/guards.ts`, in your scope's `preHandler`.
  - Your public `GET /api/logbooks/:slug` already matches my filing allow-list.
  - Once merged, `logbooksOpenOutside` in `doors.ts` should also respect your `opens_at`,
    `closes_at` and `closed_at`, so a closed logbook stops being a door.
  - Setting `outside_access` is an admin route here (`POST /api/access/doors/logbooks/:slug`)
    until the builder has a control for it.
- **G:**
  - Pass `(request) => requireRole(request, ['admin'])` as `requireAdmin` when registering your
    settings routes.
  - Your public `/api/site`, `/api/legal` and `/api/home/buttons` will be behind the gate once
    both branches are merged. Legacy's lock screen wore the site's name and look. If ours should,
    `GET /api/site` has to be added to `IN_FRONT` in `gate.ts`. That is a decision, not something
    to slip in.
  - `playwright.config.ts`: I carry your flag identically, so the two branches should merge cleanly.
- **C:**
  - The filing allow-list expects `POST /api/reports` (with `body.logbook`) and
    `GET`/`POST /api/reports/confirm/:token`. Any other pattern is behind the password.
  - The website's door path for confirmation is `/file/confirm/:token`.
  - A door page must not call anything outside its door, or the password screen comes back.
- **E:**
  - List routes opt in with `config: { curtain: 'decides-itself' }` and call
    `hasSiteAccess(db, request)` themselves.
  - Add your `door` lists to `doors()`.
- **F:** add the upload calls to `FILING_CALLS`, allowed only while an open-outside logbook takes
  files, as legacy did.
- **H:**
  - Implement `Mailer` with Scaleway.
  - Set `TRUST_PROXY=1` behind Caddy.
  - Have the installer run `apps/api/src/identity/set-site-password.ts`.
  - Sweep `otp_codes`, `sessions`, `site_access_tokens`, `organization_invite_sends` and expired
    `ownership_transfers`.
- **Migration timestamps:** A, B and G all use `20261018120000_*`. The runner applies them in name
  order (identity, logbook_lifecycle, site) and they touch different tables, so it is harmless.
  Anyone adding a migration should pick a later timestamp.

## Not done

- Tester flag, team-member flag and desks.
- Organization logos and the directory (G/F).
- Roster report counts (needs C's data).
- Legacy routes `me` and `moderators` (C's and D's).

## Waiting on a decision

- **Code-guessing lockout.** A stranger who knows a staff address can burn its code guesses and
  keep that person from signing in. Counting per address is what stops six digits being guessed,
  so I kept the stricter rule.
- **Invitations and the password.** An invitation link on a gated site needs the site password
  first, as in legacy. Letting invitees skip it would be a third door.
- **Brand on the lock screen.** Whether the lock screen may show the site's name and look (see G
  above).

## Running it in a cloud container

The session hook only writes `.env` if none exists. An old one left by the legacy app points at
the wrong database and has no `TEST_DATABASE_URL`, so export both explicitly. The `rebuild_dev`
database is created by hand once:

```
export DATABASE_URL='postgres://postgres@/rebuild_dev?host=/var/tmp/rl-pg/run&port=5446'
export TEST_DATABASE_URL='postgres://postgres@/postgres?host=/var/tmp/rl-pg/run&port=5446'
export CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)
pnpm --filter @reportlog/api db:migrate
CI=1 pnpm --filter @reportlog/web e2e
```

Run the browser suite with `CI=1`. Without it, Playwright reuses whatever is already listening on
port 3000, which in this container was the legacy app.
