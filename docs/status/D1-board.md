# Workstream D1 · Moderation and the public board: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.
D was split in two; D2 (the anchor, the transparency log, exports) has its own report.

- **Branch:** `claude/d1-moderation-board`, based on `ccr-c9c93698-ev856l` (foundation + A, B, C, E, G)
- **Pull request:** [#10](https://github.com/munsdev/reportlog/pull/10), into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                   | Result                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes (format, lint, types, boundaries; unit tests: api 142, web 364, fields 69, seal 31, access 4) |
| `pnpm test:db`                          | 30 files, 475 tests, all passed (before this branch: 24 files, 393)                                  |
| `db:types:check`                        | generated types up to date                                                                           |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 77 passed (16 of them D1's: 8 tests on desktop and phone)                                            |

The legacy vector tests in `packages/seal` are untouched and green. CI on GitHub had not reported
when this was written; check the pull request.

**Running the browser suite in a cloud container:** the legacy app was listening on port 3000 when
this session started (`node server.js` in `legacy/`), so with `CI=1` Playwright refused to start.
I stopped that process. Without `CI=1` it would have tested the legacy app instead.

## What was built, in the order asked

1. **Moderation** (`apps/api/src/moderation/`).
   - **The queue** (`queue.ts`) over `report_heads`: pending (C creates it; a correction sets it
     back), approved (`valid`), declined (`invalid`), unclear (`unknown`), withdrawn. Every decision
     needs a reason and is written to `moderation_log` (append-only, with the version it was
     about) in the same transaction. A moderator's search spans every state.
   - **Review flags** (`flags.ts`): read in the transaction that files the version (C's
     `startThread`, and a correction), prose only, never the operator's choices. A correction gets
     its own look. Cleared, never deleted; the first reader keeps their name (a trigger). The flag
     never throws into filing: a savepoint keeps a failed flag from aborting the report. The open
     marker is derived from the flag rows, not stored on `report_heads`.
   - **Keywords** (`keywords.ts`): the shipped list, the operator's list, or none (three states,
     kept apart by the database), at most 2000 terms (also a CHECK).
   - **Editorial notes** (`notes.ts`): append-only versions, the current note is the newest, a
     revision needs a reason, the byline is a house one (the public queries never select the
     author; a test reads the source), states published / under review / withdrawn (the
     administrators'), citations withdrawn by timestamp, http(s) only (also a CHECK). Off per
     logbook unless an administrator turns them on (`logbook_editorial_notes`). A withdrawn report
     keeps its note.
   - **The contact access log** (`accessLog.ts`): `openContactLogged` is the only staff path to
     C's `openContact`. A reason of 10–500 characters, written to `contact_access_log` before
     anything is decrypted. The reporter's view (`GET /api/mine/reports/:threadId/accesses`, shown
     in "My reports") never selects the staff address. Administrators read the log with names, and
     that read is itself recorded, one level deep.
2. **Publication.**
   - Public means approved, permitted by the reporter (`may_publish`), not withdrawn, and the
     archive switched on. One query builder (`published` in `board/board.ts`) says so.
   - **Files are a second decision** (`setFilesPublished`, `file_publication_log`): only after the
     text, only on the current version, only while the reporter's `attachment_publication` stands.
     The database holds the same ceiling (`file_publication_ceiling` trigger). The board re-reads
     the permission on every read, so taking it back takes the files down immediately.
   - **The public-archive switch** (`board/publication.ts`, `moderation_settings`): NULL is on.
     Not cached, so it takes effect at once.
3. **The board** (`apps/api/src/board/`, `/board`): published reports only, newest first, 100 per
   page. Search over every string in the answers and the reference (`'simple'` text search, with a
   GIN index on the same expression). Answer filters are **refused** unless the logbook's maker
   marked that question. There is no date or place parameter at all.
4. **The public read API, figures and stats.** `GET /api/board/stats` and `/api/v1/stats` share
   one implementation: every count broken out by disposition (published, not permitted, under
   review, declined, unclear, withdrawn) and by logbook question an operator marked; no bare total.
   `GET /api/board/figures` is the figures catalogue (reports and logbooks, by window) with the
   parsed-never-evaluated expression language. `GET /api/board/reports.csv` (formula-looking cells
   defused). `GET /api/board/reports/:ref/files` lists published files' metadata only.
5. **The website.** `/moderate` (the queue), `/moderate/:threadId` (every decision), and
   `/moderate/settings` (administrators). `/board`, `/board/:ref`, `/board/numbers`. Filters apply
   when the button is pressed and live in the address. The front page's built-in "View Live Report
   Board" (B's) now lands on a real page.

## Legacy self-tests and their equivalents

| Legacy                                                                          | Here                                                   | Notes                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review-flag-selftest`                                                          | `apps/api/test/db/review-flag.test.ts`                 | Check for check, plus: the database refuses to delete, un-clear or rewrite a flag; the savepoint                                                                             |
| `review-keywords-selftest`                                                      | `apps/api/test/db/review-keywords.test.ts`             | Check for check                                                                                                                                                              |
| `editorial-notes-selftest`                                                      | `apps/api/test/db/editorial-notes.test.ts`             | **Not** the logbook-file round trip of the switch (B's file format). The `self_service_log` CHECK block becomes: every action the code writes is in `moderation_log`'s CHECK |
| `publication-selftest` (the switch over every board read)                       | `apps/api/test/db/publication-switch.test.ts`          | Doors listed, plus a test that enumerates the contracts so a new board read cannot be missed. Not the distribution switch (D2's exports)                                     |
| `selftest.js`: "The review flag", "The words that raise a review flag", figures | `apps/api/test/unit/moderation.test.ts`                | The pure halves                                                                                                                                                              |
| (new)                                                                           | `apps/api/test/db/moderation.test.ts`                  | The routes, on reports filed through C's real routes                                                                                                                         |
| (new)                                                                           | `apps/api/test/db/board.test.ts`                       | Search, filters, CSV, counts, figures                                                                                                                                        |
| (new)                                                                           | `apps/web/e2e/board/moderate.spec.ts`, `board.spec.ts` | Including the no-third-party-request test for every new page                                                                                                                 |

## Decisions a reviewer should know about

- **A reporter's own withdrawal is never undone by staff.** Legacy let a moderator restore any
  withdrawn report. Here `restore` refuses (409) when the reporter withdrew or erased. A moderator's
  own withdrawal can be undone.
- **Answer filters are refused, not ignored,** unless the operator marked the question (legacy
  accepted any `a.<key>`, which made every question filterable by URL).
- **Files are decided per report version, not per file.** Per-file publication and serving the
  bytes are F's (see below).
- **Search uses `'simple'`, not `'english'`.** No stemming, because nothing says a deployment writes
  in English. "threat" does not find "threatened".
- **Not ported from legacy moderation:** severity, incidents/corroboration, evidence requests (F's),
  the press pack (legacy shipped it empty), list figures (see E below), and the veracity field.
- **The note's switch is in its own table** (`logbook_editorial_notes`) rather than a column on B's
  `logbooks`, so B's table is untouched.

## Things that look wrong in another workstream's code (not worked around)

- **Verification serves the full text of unpublished reports.** `GET /api/reports/:ref/verify`
  (foundation, `chain/verify.ts`) returns `hashed_fields` and `canonical_json`, which include every
  answer, for any report: pending, declined, withdrawn, or one whose reporter said "do not
  publish". Legacy did the same, deliberately ("reachable for any report"), but it sits badly with
  "nothing is public until a moderator approves it". A reference is 30 random bits plus a
  timestamp and is shown to staff and the reporter, so it is not a secret anyone can rely on. It is
  behind the site password. A decision for the coordinator: perhaps verify an unpublished report by
  its hashes only.
- **C's confirmation page says "public"** when a report is approved, permitted and not withdrawn,
  without asking the archive switch. With the archive off it says "public" for a report nobody can
  see. `filing.ts` could call `publicArchiveAvailable` from `board/publication.ts`. I did not change
  it.
- **`/api/v1` is behind the site password.** Legacy put it in front, so people with no account
  could build on it. Adding it to `IN_FRONT` in A's `gate.ts` would be a third way past the
  password, which is not D1's to open. Until then the "public API" is public only to people who have
  the site password.

## Changes outside D1's folders (all named in the commit messages)

- `apps/api/src/filing/filing.ts`, `intake.ts`, `mine.ts` (C): `startThread` takes the appended row
  and calls `flagReport`; a correction calls it too.
- `apps/api/src/app.ts`: two registration lines and a `statsTtlMs` setting for tests.
- `packages/contracts/src/index.ts`: two export lines.
- `.dependency-cruiser.cjs`: the seal and the chain never reach `moderation/` or `board/` (seen to
  fail on a planted import, then removed).
- `apps/web/src/features/identity/StaffOnly.tsx` (A): `needs` may name several roles.
- `apps/web/src/features/identity/SessionNav.tsx` (A): a "Moderate" link for moderators and
  administrators.
- `apps/web/src/features/form/MyReports.tsx` (C): one line rendering `ContactAccesses`.
- `apps/web/e2e/auth.ts`, `e2e/staff.setup.ts`: a `MODERATOR` session.
- New `apps/web/src/features/board/` and `features/moderation/` for the screens' components.
- Migration `apps/api/migrations/20261019180411_moderation.sql`; `schema.gen.ts` and
  `routeTree.gen.ts` regenerated.

## For the other workstreams

- **D2 (anchor, exports):** every public read of the archive must ask
  `publicArchiveAvailable(db)` from `apps/api/src/board/publication.ts` first, including a
  published chain file. `published(db)` in `board/board.ts` is the one definition of "public".
  Legacy's distribution switch was not ported; it belongs with the exports. The archive export
  should carry `moderation_log`, `report_review_flags`, the editorial note tables,
  `contact_access_log` and `file_publication_log`, and must never seal any of them.
- **F (files):** files are published only when `file_publication_log`'s newest row for the thread's
  current version says so AND the reporter's `attachment_publication` stands; `boardFiles` and
  `withFiles` in `board/board.ts` encode it. Serve renditions only after asking `boardFiles`.
  Opening an unstripped original should go through the access log: widen `contact_access_log.kind`
  with a new migration (legacy's `attachment_original`) and show it in `ContactAccesses`.
- **C (filing):** see the two notes above (the confirmation page and the archive switch). The flag
  call in `startThread` must stay inside the filing transaction.
- **B (logbooks):** the logbook file could carry the editorial-notes switch (legacy's
  `editorial_notes` key, written only when on). The builder could show it; the API is
  `PUT /api/admin/moderation/logbooks/:slug/notes`.
- **E (lists):** the figures catalogue covers reports and logbooks. Legacy also offered a listed
  list's published counts; adding them in `board/figures.ts` means reading E's aggregates (the
  direction board → lists is allowed).
- **G (site):** the front page's wording can carry figures: `renderText(text, await
figureValues(db))` from `board/figures.ts`, and `checkText` for the editor. Not wired.
- **A (identity):** the `/api/v1` question above. `StaffOnly` now accepts several roles.
- **H (operations):** nothing to schedule. `contact_access_log` and `moderation_log` grow forever by
  design; do not sweep them.

## Not done

- Severity, incidents and corroboration counts (legacy moderation extras).
- Evidence requests from the queue (F's `evidence_request` permission exists; the asking is F's).
- List figures (E) and figures in the front page's wording (G).
- A browser walk of `/board` with the site password on (the server side is tested:
  every board read answers `locked`, even with a logbook open outside).
- Press pack (legacy shipped an empty list of files).
