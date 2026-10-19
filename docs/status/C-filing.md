# Workstream C · Filing and confirmation: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/beautiful-hawking-h3m3pn`, based on `ccr-c9c93698-ev856l` (foundation + A, B, G)
- **Pull request:** into `ccr-c9c93698-ev856l` (link in the PR list; opened with this file)
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                   | Result                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes (format, lint, types, boundaries; unit tests: api 56, web 359, fields 69, seal 31, access 4) |
| `pnpm test:db`                          | 22 files, 294 tests, all passed (before this branch: 16 files, 222)                                 |
| `db:types:check`                        | generated types up to date                                                                          |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 52 passed, including the new `behind-password` project                                              |

CI on GitHub had not reported when this was written. Check the pull request.

## What was built, in the order asked

1. **Filing.** `POST /api/reports` (`apps/api/src/filing/filing.ts`). The answers are built with
   `buildAnswers` against the logbook's own questions, shaped with `normalizeReportFields`, and
   kept with the token in `report_submissions` until the reporter confirms. The digest must be
   one the server issued, and the general card's (`isKnownDigest(db, digest, 'general')`). The
   report is appended with `appendReportVersion` only at confirmation, with the form version
   recorded **when it was sent**, which is the one the reporter was asked.
2. **The spine.** An address, the statement on the last card (`consent: true`, not sealed), and
   the publication answer. Not answering the publication question is "no": the card says so
   before anybody acts. The address is never sealed. At confirmation it moves under a
   per-report key (`apps/api/src/filing/contactKeys.ts`, ported from legacy `contactKeys.js`):
   AES-256-GCM under a random key, wrapped by the deployment's `CONTACT_KEY`, kept in
   `contact_keys` (which may delete). The ciphertext is in `report_contacts`, which is
   append-only. Erasing is deleting the key. The keyed digest that finds a person's reports sits
   beside the key, so an erasure leaves nothing linking the report to an address. The address is
   wiped from `report_submissions` at confirmation.
3. **The confirmation email and its link.** `GET /api/reports/confirm/:token` **only looks**:
   mail scanners open links. `POST` files, once: the row is locked and re-read in the
   transaction, so two presses (or a scanner and a person) file one report. The link keeps
   working afterwards and says "received" or "public", never which non-public state. Tokens are
   stored as hashes and never appear in a log line (a test reads the log). The website's page is
   `/file/confirm/:token`, with a "Confirm and file my report" button.
4. **Corrections.** `POST /api/mine/reports/:threadId/correct`: the same logbook's questions as
   they are now, a new version in the same thread and chain, back to `pending` moderation. It
   **carries the files** the corrected version committed to (manifest and `report_attachments`
   links), read from the archive and never from the request. It may take back permission to
   publish, never give it.
5. **Coordinator intake.** `/api/intake/...`: batches per organization (A's `organizations` and
   memberships), staged accounts, a review of what each is missing, and an attested submit that
   files the complete ones in one transaction with one attestation time and leaves the rest
   staged. The organization's name is sealed (`filed_via`); the coordinator, their address and
   their paper reference are outside the seal (the filed draft and `report_contacts`).
6. **Revocable permissions.** `apps/api/src/permissions/log.ts`: `contact_passing`,
   `attachment_publication`, `evidence_request`, as an append-only log with the current value as
   a projection. The table's CHECK says `actor = 'reporter'`, and the only caller of
   `setPermission` is the reporter's own route (a test walks the source to keep that true).
7. **My reports.** `/api/mine/...` and `/mine`: list, open, correct, give or take back
   permissions, withdraw (reason required), erase (withdraws too).
8. **The filing card form.** `/file/:slug` (`apps/web/src/features/form/`): one card per
   question, no auto-advance. Which card comes next is decided when Next is pressed, by the same
   `buildAnswers` the server seals with, so the form and the seal cannot disagree about which
   questions were asked. Then the publication card in the server's words, the address, and
   "Check your answers" with every row changeable. On a door the page calls only the filing
   routes (a unit test records every call it makes).

Also built, because a legacy test in C's list needed it: **the intake switch**
(`intake_settings`, `GET /api/intake-switch`, `GET`/`PUT /api/admin/intake-switch`). Closed, it
refuses new reports at both doors, before judging them; corrections and everything filed are
left alone.

**`/submit`** (the front page's built-in "Submit a Report") goes straight to the one open logbook,
or offers a choice from B's `GET /api/logbooks` when there are several.

## Legacy self-tests and their equivalents

| Legacy                       | Here                                                                           | Notes                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `confirm-selftest`           | `apps/api/test/db/confirm.test.ts`, `correction.test.ts` (its My Reports half) | Not its board filters, CSV and snapshot (D's), nor the files-still-preparing branch (F's) |
| `correction-selftest`        | `apps/api/test/db/correction.test.ts`                                          | Attachment rows written by hand, as legacy did; the erasure-of-a-file half is F's         |
| `permissions-selftest`       | `apps/api/test/db/permissions.test.ts`                                         | Plus the reporter-only caller check                                                       |
| `intake-selftest`            | `apps/api/test/db/intake.test.ts`                                              |                                                                                           |
| `intake-switch-selftest`     | `apps/api/test/db/intake.test.ts` ("the intake switch")                        | The public-record half needs D's board                                                    |
| `orgs-selftest` (chain half) | `apps/api/test/db/intake.test.ts`                                              | Organization inside the seal, coordinator and paper reference outside                     |
| `publication-selftest`       | `apps/api/test/db/publication.test.ts` (the card half only)                    | **Its subject, the public-archive switch over every board read, is D's.** None exists yet |
| `intake-hardening-selftest`  | none                                                                           | All of it is upload staging and the media worker: F's                                     |
| (new)                        | `apps/api/test/db/filing-doors.test.ts`                                        | The real filing routes, end to end, with the site password on                             |

Browser tests: `apps/web/e2e/filing/file.spec.ts` (every card, the email, **the link followed in
a fresh browser**, the fingerprint checked), `apps/web/e2e/filing/mine.spec.ts`, and
`apps/web/e2e/behind-password/confirm.spec.ts` (**the same confirmation link, behind the site
password**, for a logbook opened by link). Unit: `apps/web/test/filing.test.tsx`.

## Decisions made here that a reviewer should know about

- **The confirmation GET does not file.** Legacy's did. The agreement named both GET and POST;
  this branch uses GET to look and POST to file, so a mail scanner opening the link files
  nothing. It costs the reporter one press.
- **Not answering the publication question seals `may_publish: false`**, as the card says.
- **A coordinator-filed report is not in the coordinator's "My reports".** The address under its
  key is the coordinator's, but the permissions on that page are the reporter's, and a
  coordinator giving one would be the operator deciding under the reporter's name. The cost:
  there is no way yet to correct a coordinator-filed report.
- **No address column on the append-only logs** (`reporter_actions`, `report_permissions_log`):
  every new thread is erasable, and an address in a table that cannot forget would outlive the
  erasure.
- **`CONTACT_KEY` is optional in config.** Without it the site runs, logs a warning at start, and
  refuses every report with a sentence. One secret; the wrapping key and the digest key are
  derived from it with HKDF. **It is never to be changed on a running archive**, and there is no
  rotation yet.

## Changes outside C's folders (all named in the commit messages)

- `apps/api/src/config.ts`: `CONTACT_KEY`.
- `apps/api/src/app.ts`: the registration, and one shared mailer/site-origin variable.
- `apps/api/src/logbooks/routes.ts`: `forForm` exported, so a correction is asked B's questions in
  B's shape.
- `apps/api/test/db/doors.test.ts` (A's): two assertions now say "not locked" instead of
  expecting a stand-in's 200, because the real routes now answer on the merits.
- `apps/web/src/routes/submit.tsx`: the logbook picker.
- `apps/web/src/features/identity/SessionNav.tsx` (A's): a "My reports" link when signed in.
- `apps/web/playwright.config.ts`: `CONTACT_KEY` for the test server, and the `behind-password`
  project (runs alone, after `identity`).
- `.env.example`, `.claude/hooks/session-start.sh`: `CONTACT_KEY` (the hook appends a random
  development key to `.env` if there is none).
- Migration `apps/api/migrations/20261019125038_filing.sql`; `schema.gen.ts` and
  `routeTree.gen.ts` regenerated.

## For the other workstreams

- **A (identity):**
  - `GET /api/intake-switch` is not a filing call, so a door page does not ask it, and a reporter
    on a door learns the site is closed only when they press Send. Adding it to `FILING_CALLS`
    would let the form say so on its first card. That is your decision.
  - The confirmation link passes the password only while SOME logbook is open outside
    (`outsidePass` passes a slug-less call then). So if an administrator sets the logbook back
    to `closed` while a reporter's link is unconfirmed, and nothing else is open outside, the
    reporter needs the password to confirm. Today a logbook closing by its schedule does not
    do this, because `logbooksOpenOutside` does not read `closed_at` yet. Once it does (your
    status note asks B for that), it will, which contradicts the comment in `doors.ts` that
    somebody who filed while it was open can confirm after it closes. Worth deciding before
    then. I did not change it.
- **B (logbooks):** `forForm` is now exported from `apps/api/src/logbooks/routes.ts`. The builder
  could offer the intake switch and `outside_access`; there are API routes for both.
- **D (board):** `report_heads` rows are created at filing (`pending`); a correction moves the head
  and sets it back to `pending`; `withdrawn` is set by the reporter. `openContact` in
  `contactKeys.ts` reads a thread's contact details: every opening must be logged by the caller
  (legacy's access log, which "My reports" should then show). `publication-selftest` is yours.
- **F (files):** taking back `attachment_publication` must take published files down; the hook
  point is marked in `setMyPermission` in `apps/api/src/filing/routes.ts`. Corrections already
  carry the previous version's files. Filing has no upload step yet: `POST /api/reports` takes no
  draft token, and the form skips the `file` question.
- **H (operations):** set `CONTACT_KEY` (32 random bytes, base64) in every deployment and back it
  up separately from the database; losing it makes every address unreadable. Sweep unconfirmed
  `report_submissions` past `expires_at` (they hold an address in the clear until then). Do not
  sweep `contact_keys` or `report_contacts`.

## Not done

- A screen for coordinator intake (the API and its tests are complete).
- Correcting a coordinator-filed report.
- Uploads in the form (F), the moderator access log in "My reports" (D), the signed declaration
  legacy printed from "My reports", and notification settings (legacy `me` routes).
- Browser history per card (legacy pushed one entry per card so Back went back one question).
  The form instead warns before the page is left with answers in it.
- Rotating `CONTACT_KEY`.
