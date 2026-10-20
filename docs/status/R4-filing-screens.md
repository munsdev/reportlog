# R4 · Filing screens (C4): status

For the coordinating session and the other workstreams. Brief: R4 in `docs/parity.md` §7.

- **Branch:** `claude/r4-filing-screens`, based on `ccr-c9c93698-ev856l` at `9a839fe` (merged
  again before the last run; it had not moved)
- **Pull request:** see the branch's PR, into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-20

## Checks, as last run before pushing

| Suite                                   | Result                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes: format, lint, types, boundaries; unit tests web 478, api 386 (17 skipped, not R4's), seal 46, fields 69, access 6 |
| `pnpm test:db`                          | 69 files, 1028 passed (R4's: 3 in `mine-published-files.test.ts`, 1 in `intake.test.ts`)                                  |
| Browser suite (`CI=1`, `CHROMIUM_PATH`) | E2E_RESULT                                                                                                                |

## What was built, in the order asked

1. **`/submit` and every question kind in a browser.**
   - `e2e/filing/submit.spec.ts`: several open logbooks (real ones, each offered with its blurb,
     each opening its own form); one open with an intro written (the page stays, intro and link);
     one open without (straight to its form); none open ("Nothing is taking reports"). The
     single-logbook and intro cases stand in for `/api/logbooks` and `/api/site` in that page
     alone, so nothing the suite shares is changed.
   - `e2e/filing/kinds.spec.ts`: a logbook with every kind the walk did not file yet (choice_one,
     choice_many, time, datetime, place with options and without, location, evidence_declaration,
     number, email, url), filed card by card, confirmed from the email, and read back from the
     seal as staff: the operator's order for ticked boxes, `09:30:00`, UTC for the date-time,
     `US-OH` for Ohio, `true` for the declaration, a number, a lowercased address, the URL. A
     number outside the range is held on its card. The review shows Ohio, never `US-OH`.
2. **The progress bar never moves backwards, and ends full.** It already only moved forwards, but a
   question hanging off a question that had been ruled out still counted as possible, so a form
   with follow-ups of follow-ups ended at 93%, not 100% (`walk.ts`, `stillPossible` now cascades).
   The files card now counts until the server says the logbook takes none, so its answer arriving
   late can only move the bar on. The kinds walk reads the bar on every card; checked to fail
   without the fix. One unit test in `test/filing.test.tsx`.
3. **axe on every card** (`e2e/filing/axe.ts`, Q3's checker run the way `accessibility.spec.ts`
   runs it; that file is R8's and a spec cannot be imported without registering its tests). Every
   card of the kinds walk, a card showing its error, the review ready to send, the receipt, and
   `/submit` in each state. **It found two real failures, both fixed:**
   - the review card's `<dl>` held the Change button beside its `<dt>`/`<dd>` (`definition-list`,
     `dlitem`). The button is now inside the `<dd>`;
   - the evidence page's file box had no name (`label`). It is now named by a "Send what you have"
     heading.
4. **A confirmation before switching off file publication** (`MyReports.tsx`). While any of the
   report's files are published, unticking "The files I attached may be published" opens a dialog
   saying how many and that they come down now; "Leave it on" and Escape write nothing. With
   nothing published it does not ask. The page learns the count from a new `published_files` on
   `GET /api/mine/reports/:threadId` (`api/filing/mine.ts`): the files' own record, the same rows
   the take-down acts on. A refused write leaves the box as the server has it and shows the
   server's sentence; that was already the code (the box is drawn from the server's answer), now
   tested. `e2e/filing/permissions.spec.ts` stands in for this one report's detail and permission
   calls in the page; the count itself is `test/db/mine-published-files.test.ts`.
5. **Intake closed, the public record still answers** (`test/db/intake.test.ts`): `/api/v1`,
   `/api/v1/stats`, `/api/v1/consent-texts`, `/api/board`, `/api/board/reports`,
   `/api/board/stats`, `/api/legal`, and a report filed before the switch closed still verifies.
6. **The evidence page says how to stop being asked**, naming the switch on "My reports" in its
   own words (`features/form/permissionWords.ts`, now shared by both pages). Words, not a link: on
   a site behind its password "My reports" is behind it too, and the page is a door. Tests in
   `e2e/files/evidence.spec.ts`: the wording, storage off (the files part of the server's answer
   stood in for: no box, the reason, the question still shown), an ask the moderator cancelled
   ("no longer open", what to do), and the permission switched off (the server's own sentence,
   that it can be switched back on). The existing test's setup moved into a helper, its body
   unchanged.

## Changes outside R4's folders (named in the commit messages)

- `packages/contracts/src/filing.ts`: `published_files` on `MyReportDetail`.
- `apps/web/test/filing.test.tsx`: one test of the cascade.
- `apps/api/test/db/intake.test.ts`: one test, and a report filed before the switch closes.
- `apps/api/test/db/mine-published-files.test.ts`: new. It imports R2's `files-helpers.ts`
  unchanged.
- `docs/parity.md`: the rows below, the totals, and R4 marked done.

## Parity rows closed

§4a `intake-switch-selftest`; §4c `evidence.test.js`, `form.test.js`, `logbook.test.js`,
`permissions.test.js`; §6 `evidence.js`, `form.js`, `mine.js`. **§4c `nav.test.js` stays
Partial**: its progress-bar part is done; the header on one row is R5's and `/print` waits on R0 k.

## Not done

- The header-on-one-row and `/print` parts of `nav.test.js` (R5, R0 k).
- Legacy's evidence page said the file limit in words ("One file.", "Up to 4 files."). The
  rebuild's picker is F's (`FilesCard.tsx`) and was not checked against that here.
- The evidence page with storage off is tested by standing in for the server's answer, not by
  switching storage off on the test server: storage is set when the server starts.
