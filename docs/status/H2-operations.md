# Workstream H2 · Operations follow-ups: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/h2-ops-followups`, based on `ccr-c9c93698-ev856l` (merged in at `221cb83`, after F2)
- **Pull request:** [#15](https://github.com/munsdev/reportlog/pull/15), into `ccr-c9c93698-ev856l`
- **State:** finished up to what needs the owner's accounts (Bugsink, a server, a domain). Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                   | Result                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes (format, lint, types, boundaries; unit tests: api 282, web 413, fields 69, seal 31, access 4) |
| `pnpm test:db`                          | 49 files, 763 tests, all passed                                                                      |
| `db:types:check`                        | generated types up to date (H2 adds no migration)                                                    |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 108 passed, with error tracking ON for the whole run                                                 |
| ShellCheck on `deploy/`                 | clean (0.11.0, as CI runs it)                                                                        |

H2's own tests: api unit 30 (`telemetry` 11, `updates` 16, `anchor-watch` 3), api db 9
(`telemetry`), web unit 4 (`telemetry`), browser 2 (`telemetry.spec.ts`, desktop and phone).

**Not run against the real things:** Bugsink itself (a loopback stand-in that records every
request, `apps/api/test/stand-in-bugsink.ts`, plays it in every suite), systemd (the two new units
were not started on a real machine; the shell they call was run against real git repositories),
and GitHub as the update check's remote.

## What was built

### 1. Error tracking with Bugsink

- **Off unless `ERROR_TRACKING_DSN` is set.** Off, nothing is sent anywhere, the website asks once
  on its first error and stops, and the relay answers 404 "Error tracking is off on this site."
- **What an event may carry is one allowlist**, `ErrorEvent` in `packages/contracts/src/telemetry.ts`:
  the exception (type, message, frames), level, release, environment, a route pattern, five named
  tags. Everything else is dropped by zod, including whatever a future SDK adds: no `request`
  (URL, headers, cookies, body), no `user`, no breadcrumbs, no extras, no server name. Messages are
  scrubbed of URLs, email and IP addresses and token-like strings; frames keep the asset's path,
  never its origin or query. The server applies it before sending, the website before handing an
  event over, and the relay again to what a browser sent.
- **The server** (`apps/api/src/telemetry/`) uses `@sentry/core`, not `@sentry/node`, which
  instruments the whole process through OpenTelemetry and records outgoing requests with their
  URLs. Reported: unexpected errors in routes (not `HttpError`s, validation errors or anything
  under 500), uncaught exceptions and rejections in the server, and a scheduled job that throws
  (a job returning `ok: false` is a refusal, which the unit alert already covers).
- **The website never talks to Bugsink.** It loads nothing for this until an error happens; then
  it calls `GET /api/telemetry`, and only if that says on does it load Sentry's browser SDK (its
  own chunk) and post to `POST /api/telemetry/errors` on the site's own origin. The relay takes
  one error event per envelope (sessions and the like are dropped), uses the server's DSN whatever
  the envelope named, 64 KB at most, 30 a minute for the whole site, then 429 with Retry-After.
- Both routes are in front of the site password (A's `IN_FRONT`), so a lock screen or a door can
  report and is never sent back to the lock screen for it. A test checks they open nothing behind.
- The browser suite now runs with error tracking on against the stand-in, so **every page's
  no-third-party test passes with it on**, and `telemetry.spec.ts` follows an error from the page
  through the relay to the stand-in.
- Runbook: `deploy/README.md`, "Error tracking (Bugsink)".

### 2. Updates and the update check

Legacy `updates.js` / `updateCheck.js` applied updates from the website: a request file and a root
worker on a one-minute timer. **Decision: no in-app apply.** Reasons, written in
`apps/api/src/jobs/updates.ts` and the runbook:

- that design is a path from a web request to root on a server holding people's reports, and this
  deployment simply does not need it;
- a deploy migrates the database and can stop with something to read, so a person runs
  `sudo reportlog deploy`, at a terminal.

What exists instead:

- `sudo reportlog updates` and a daily root timer (`reportlog-update-check`, 06:00 + up to an hour).
  Root fetches the deploy mirror (the same `fetch_mirror` a deploy now uses), with the credentials
  only root holds, and writes plain facts to `/var/lib/reportlog/updates/` (`write_update_facts`
  in `deploy/lib.sh`, swapped in whole, `mv -T` so a symlink planted by the service user cannot
  redirect it). Root runs only its own copy of the scripts, never release code.
- The service user reads them: the terminal report (how far behind, the releases between the two
  versions with notes from the tip's `CHANGELOG.md`, the commits, the exact deploy command), a
  doctor line (warns: behind, fetch failed with the cause in words, the daily check stopped,
  never checked), and **one email per new upstream commit** to `OPS_ALERT_EMAIL`.
- Why a fetch failed is classified in shell into one word; git's text, which can carry the
  repository address and a token, is never stored, shown or emailed.
- It is the one unit not run as `reportlog`; the unit test names it as such, so no other can join
  it quietly.

### 3. anchor-watch: built, because it was not covered

D2 wrote that H's unit alert plus `anchorDoctorCheck` cover it. They do not cover the case legacy's
`anchor-watch` was written for: **an anchor that never runs** (timer disabled, unit lost, clock
skipped). Nothing fails, so the alert never fires, and the doctor notices only when somebody runs
it. So `anchor-watch` is a registry job, daily at 09:00: it runs D2's `anchorDoctorCheck` and fails
the unit (and so sends the alert) when the check fails. The alert email for that unit says in one
sentence what it means.

## Legacy and its equivalents

| Legacy                                                                                       | Here                                                                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/updates.js` (versions, changelog, state)                                                | `apps/api/src/jobs/updates.ts`                                                      |
| `src/updates.js` (requests, expiry, worker status, busy)                                     | not ported: there is no in-app apply                                                |
| `src/updateCheck.js`                                                                         | `update_check` / `write_update_facts` / `classify_fetch_failure` in `deploy/lib.sh` |
| `src/updateRequest.js`, `src/updateWorker.js`, `update-apply.sh`, `reportlog-update.*`       | not ported (same reason); `sudo reportlog deploy` applies                           |
| `selftest.js` "updates" group (versions, changelog, between, ahead, undocumented, no power)  | `test/unit/updates.test.ts`                                                         |
| `selftest.js` "why a fetch failed" group                                                     | `test/unit/updates.test.ts`, against the shell classifier                           |
| `selftest.js` request/expiry/worker tests, `update-apply-selftest`, `update-worker-selftest` | not ported (nothing to test)                                                        |
| `scripts/anchor-watch.js`, `reportlog-anchor-watch.*`                                        | job `anchor-watch` (`jobs/anchor-watch.ts`), timer generated from the registry      |
| (none: legacy had no error tracking)                                                         | `apps/api/src/telemetry/`, `apps/web/src/features/telemetry/`                       |

## Changes outside H2's folders (all named in the commit messages)

- `packages/contracts/src/telemetry.ts` and one export line in its index.
- `apps/api/src/identity/gate.ts` (A): the two telemetry routes in `IN_FRONT`.
- `apps/api/src/http/errors.ts` (foundation): **Fastify's own 4xx refusals** (a body too large, a
  malformed body) now answer with their status and a plain sentence, instead of
  "500 Something went wrong on our side". Found because the relay's size limit answered 500.
- `apps/api/src/app.ts`: one registration line and an optional `errors` dependency.
- `apps/api/src/server.ts`: the tracker; flushed on shutdown; uncaught errors reported, then exit 1
  as before.
- `apps/api/src/config.ts`, `.env.example`: `ERROR_TRACKING_DSN`, `ERROR_TRACKING_ENVIRONMENT`.
- `apps/web/src/main.tsx` (shell): `installErrorReporting` and React's root error handlers.
- `apps/web/src/features/telemetry/` (new), `apps/web/e2e/telemetry.spec.ts`, `apps/web/e2e/bugsink.ts`.
- `apps/web/playwright.config.ts`: the stand-in Bugsink as a web server; the test API's DSN.
- `.gitignore`: the stand-in's output file.
- `@sentry/core` (api) and `@sentry/browser` (web), 10.76.0 exact (published 2 October).

## For the other workstreams

- **Anyone:** an unexpected error in your route now reaches Bugsink when it is configured. Throw an
  `HttpError` for a refusal; it is not reported. Do not put addresses, tokens or answers in an
  error's message: the scrubber is a net, not a licence.
- **A new public page:** nothing to do; error reporting is already on every page and same-origin.
- **D2:** `anchor-watch` reuses `anchorDoctorCheck` as is. If its thresholds change, the watch follows.
- **G:** the updates screen legacy had (`admin-updates.js`) is deliberately not built (see above).

## Needs the project owner

1. **Bugsink:** where to run it. The runbook recommends a small EU server of its own, not the
   archive's server. Then a project's DSN in `ERROR_TRACKING_DSN`.
2. **The update check contacts `REPO_URL` (GitHub, in the US) daily**, from the server. Deploys
   already do; this makes it daily. `systemctl disable --now reportlog-update-check.timer` turns
   it off (a deploy turns it back on). Keep it daily, weekly, or off?
3. **A `CHANGELOG.md` and a version number.** The rebuild has neither yet. The check reads both
   when they exist (`## v0.1.0 — date` headings, `"version"` in the root `package.json`); without
   them it reports commits only.

## Not done

- The two new units have not been started under a real systemd; H's machines-with-systemd runs
  were not repeated. The shell they run was tested with real git repositories.
- No source maps are uploaded to Bugsink, so website stack frames point at built files.
- Legacy's `accessLog.js`, `installConfig.js`, `requestLog.js` remain as H left them (see
  `H-operations.md`).
