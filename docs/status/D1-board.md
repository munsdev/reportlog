# Workstream D1 · Moderation and the public board: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.
D was split in two; D2 (the anchor, the transparency log, exports) has its own report.

- **Branch:** `claude/d1-moderation-board`, based on `ccr-c9c93698-ev856l` (foundation + A, B, C, E, G; H, G2, I, D2 and F merged in at `c93ae88`)
- **Pull request:** [#10](https://github.com/munsdev/reportlog/pull/10), into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                                      | Result                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm check`                                               | passes (format, lint, types, boundaries; unit tests: api 247, web 396, fields 69, seal 31, access 4)  |
| `pnpm test:db`                                             | 44 files, 717 tests, all passed, after merging H, G2, I, D2 and F (before this branch: 24 files, 393) |
| `db:types:check`                                           | generated types up to date                                                                            |
| Browser suite (`pnpm --filter @reportlog/web e2e`, `CI=1`) | 96 passed on the second run (16 of them D1's); see the note below the table                           |

**The first browser run after merging F had one failure, in E's `lists.spec.ts` on the phone
project** ("a visitor sends a tip…"): the page was still the list editor when the test looked for
the entry. The test clicks "Review entries" and then looks for the list's link without waiting for
the page to change, so it can find the same-named link on the page it is leaving. Nothing in D1
touches lists. A second full run passed 96 of 96. Waiting for the review page's address after the
click would make it robust; it is E's file, so I did not change it.

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
   - **Files are a second decision, made per file by F** (`attachment_heads.publication`, F's
     `files/publication.ts`), under the reporter's `attachment_publication` permission. A published
     file is served only while its report's text is public (F's `servable` and `publicFilesOf` now
     use the shared rule and the archive switch). D1 first built a per-version decision of its own
     (`file_publication_log`) before F existed; it was retired when F merged
     (`20261019192523_moderation_files_to_f.sql`), so the two can never disagree.
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
   defused). A report's files are F's `GET /api/files/report/:ref`.
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

## What counts as public is decided once

`apps/api/src/board/published.ts` holds the rule: the current version of a thread, approved, not
withdrawn, and permitted by its reporter. It is a subquery of published report ids
(`publishedReportIds`) plus the same rule in JavaScript (`isPublic`). Everything that reads the
published record uses it:

- the board (`board/board.ts`) and its counts and figures;
- the published chain file: D2's route passes the subquery to `buildChainFile`, which takes it as an
  argument because `chain/` may not import `board/`;
- D2's daily snapshot (`publishedReportRows` in `anchor/records.ts`);
- I's heat maps (`publishedHeads` in `maps/aggregate.ts`);
- G's email digest (`site/digest.ts`, which carried a `TODO(workstream D)` for exactly this);
- C's confirmation page (`isPublic`).

A unit test fails if any other file spells the rule in a query. A database test checks that the
published chain file carries exactly the reports the board shows.

The archive switch is a second gate, asked by each public read: the board, the published chain
file, both map reads and the digest (which then sends nothing and moves no subscriber's clock). The
daily snapshot in the transparency log does NOT ask it: whether a never-rewritten log should skip
reports while the site is not publishing is D2's call.

## Decisions a reviewer should know about

- **A reporter's own withdrawal is never undone by staff.** Legacy let a moderator restore any
  withdrawn report. Here `restore` refuses (409) when the reporter withdrew or erased. A moderator's
  own withdrawal can be undone.
- **Answer filters are refused, not ignored,** unless the operator marked the question (legacy
  accepted any `a.<key>`, which made every question filterable by URL).
- **Search uses `'simple'`, not `'english'`.** No stemming, because nothing says a deployment writes
  in English. "threat" does not find "threatened".
- **Not ported from legacy moderation:** severity, incidents/corroboration, the press pack (legacy shipped it empty), list figures (see E below), and the veracity field.
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
- **C's confirmation page says "public"** when a report is approved, permitted and not withdrawn
  (now through the shared `isPublic`), without asking the archive switch. With the archive off it says "public" for a report nobody can
  see. `filing.ts` could call `publicArchiveAvailable` from `board/publication.ts`. I did not change
  it.
- **`/api/v1` is behind the site password.** Legacy put it in front, so people with no account
  could build on it. Adding it to `IN_FRONT` in A's `gate.ts` would be a third way past the
  password, which is not D1's to open. Until then the "public API" is public only to people who have
  the site password.

- **The board publishes each published report's place, so the map threshold protects nothing for
  a logbook whose location question is shown or filtered on the board** (I's report raises this).
  The board shows every answer of a report its reporter permitted and a moderator approved, as
  legacy did. Whether a location answer should be held back from the board when a map counts that
  question is a policy decision, not D1's alone. Nothing was changed.

## Changes outside D1's folders (all named in the commit messages)

- `apps/api/src/files/publication.ts`, `files/routes.ts` (F): the public file reads use the shared
  rule and the archive switch; `GET /api/files/report/:ref` says the archive notice when it is off.
- `apps/api/test/db/files-publication.test.ts` (F): one `where` so it reads its own report's
  `viewed_original` row, not the first one in the shared test database.
- `apps/api/src/chain/chainFile.ts` (foundation): `buildChainFile` takes the published ids as an
  argument (`{ published }`) instead of its own copy of the rule.
- `apps/api/src/anchor/records.ts`, `anchor/routes.ts` (D2): the snapshot and the published chain
  file use `publishedReportIds`; the published chain file asks the archive switch.
- `apps/api/src/site/digest.ts` (G): the digest uses the shared rule and the archive switch
  (`boardVisible` removed; it had no other caller).
- `apps/api/src/maps/aggregate.ts` (I): `publishedHeads` uses the shared rule.
- `apps/api/src/filing/filing.ts` (C): the confirmation page uses `isPublic`.
- `apps/api/src/maps/routes.ts` (I): the two public map reads ask the archive switch first, as
  I's report asked (the per-report rule in `publishedHeads` already matched D1's).
- `apps/web/src/features/staff-nav/entries.ts` (G2): Moderation and Moderation settings, one line
  each; G2's `staff-nav.test.tsx` updated for the two entries. The "Moderate" header link from the
  first commit gave way to G2's staff menu in the merge.

- `apps/api/src/filing/filing.ts`, `intake.ts`, `mine.ts` (C): `startThread` takes the appended row
  and calls `flagReport`; a correction calls it too.
- `apps/api/src/app.ts`: two registration lines and a `statsTtlMs` setting for tests.
- `packages/contracts/src/index.ts`: two export lines.
- `.dependency-cruiser.cjs`: the seal and the chain never reach `moderation/` or `board/` (seen to
  fail on a planted import, then removed).
- `apps/web/src/features/identity/StaffOnly.tsx` (A): `needs` may name several roles.
- `apps/web/src/features/form/MyReports.tsx` (C): one line rendering `ContactAccesses`.
- `apps/web/e2e/auth.ts`, `e2e/staff.setup.ts`: a `MODERATOR` session.
- New `apps/web/src/features/board/` and `features/moderation/` for the screens' components.
- Migration `apps/api/migrations/20261019180411_moderation.sql`; `schema.gen.ts` and
  `routeTree.gen.ts` regenerated.

## For the other workstreams

- **D2 (anchor, exports):** "public" is `publishedReportIds` in `board/published.ts`, now used by
  the snapshot and the published chain file; the chain file also asks the archive switch. Decide
  whether the snapshot should too.
  Legacy's distribution switch was not ported; it belongs with the exports. The archive export
  should carry `moderation_log`, `report_review_flags`, the editorial note tables and
  `contact_access_log`, and must never seal any of them.
- **F (files):** the moderation page now has your files and evidence screens (`FilesPanel.tsx`,
  `EvidencePanel.tsx` in `features/moderation/`), on your API: per-file publish, withhold and
  refuse, the cleaned copy, the original with a reason, and asking for evidence. The board report
  page shows your `PublishedFiles`. `servable`, `publicFilesOf` and `GET /api/files/report/:ref`
  ask the archive switch and the shared rule. The reporter's access log in "My reports" now
  includes your `viewed_original` events, with the reason and without who. One thing to weigh: the
  original's reason travels in the URL (`/original?reason=`), so it can end up in browser history;
  legacy used a POST for the same reason.
- **C (filing):** see the two notes above (the confirmation page and the archive switch). The flag
  call in `startThread` must stay inside the filing transaction.
- **B (logbooks):** the logbook file could carry the editorial-notes switch (legacy's
  `editorial_notes` key, written only when on). The builder could show it; the API is
  `PUT /api/admin/moderation/logbooks/:slug/notes`.
- **I (maps):** the publication rule agrees with D1's, and the archive switch is now asked by
  both public map reads. The board's slots were not added to `MAP_SLOTS`; a map on the board page
  is not placed yet.
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
- List figures (E) and figures in the front page's wording (G).
- A browser walk of `/board` with the site password on (the server side is tested:
  every board read answers `locked`, even with a logbook open outside).
- Press pack (legacy shipped an empty list of files).
