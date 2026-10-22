# Interface redesign, stage 5a · Moderation screens: status

- **Branch:** `worktree-agent-a1322664490ed30fc`, from `18e8c55` (after stage 2,
  `docs/status/UI2-components.md`). Built in parallel with threads A (navigation), B (public and
  filing), D (settings, admin, account) and E (look packs).
- **State:** built; not merged. The browser suite was not run (it shares fixed ports with the
  other threads); the specs it needs are written and updated, to run once after merge.
- **Scope:** `docs/design/screens/moderation.md`: the queue, one report, the files on a report,
  the flood screen, tip links, list review, illegal content notices, the files pages and
  moderation settings.

## What was built

- **Server, the one addition the spec names:** `GET /api/moderation/reports` now answers with
  `counts` (one per status button, under every other filter in force), `total`, `page` and
  `pages`, and takes `page` (50 a page, `QUEUE_PAGE_SIZE` in `packages/contracts`). The list and
  the counts share one filtered query (`filtered` in `apps/api/src/moderation/queue.ts`), so a
  count cannot disagree with the list its button shows. A page past the end shows the last one.
  Test: `apps/api/test/db/queue-pages.test.ts`.
- **The queue** (`features/moderation/Queue.tsx`): status buttons with counts, "Only second reads"
  set apart, search on Enter or its own Search button (decision 59) kept in the address, a Filter
  panel (under the tools on a desktop, a dialog on a phone) holding every filter the query takes,
  Order, the count line naming every filter in words, rows as raised panels with chips and the
  answers in words, a deep selection bar ("Approve selected", "Decline selected…") fixed to the
  foot of a phone, the bulk decline dialog (one reason from the fixed list, "Nobody is emailed
  when you decline in bulk."), "Decide here" opening the report page's own Decide form in place
  (one row at a time, asking before leaving an unfinished one), a toast after a decision with
  focus moved to the next row's "Decide here", pagination, the corroboration panel as a quiet
  panel, and empty states.
- **One report** (`Item.tsx`, `DecideForm.tsx`, `ClosedRow.tsx`): mono reference as the title,
  "Back to the queue" keeping the queue's filters, two columns on a desktop with the Decide panel
  sticky, one column on a phone with a deep bar (Approve…, Decline…) opening the same form in a
  sheet with that choice made. Closed rows (one open at a time, with the Save bar): Severity,
  Threat to life or safety, Same incident, Second read, Ask for evidence, The archive's note, Take
  it off the board / Put it back, Who filed it. The record as a mono line per event. "Next waiting
  report" after a decision, in the queue's order and filters. A reporter's withdrawal replaces the
  Decide form with its sentence on the deep surface.
- **Files on a report** (`files/staff/ReportFiles.tsx`): a raised panel "Files (n)", the
  permission first, each file with a type mark, size and a state chip, "Approve the report first"
  in place of Publish… while the report is not approved, refused uploads as a closed row.
- **Flood screen:** the switches first on the deep surface with toasts, bars beside the hourly
  counts (in `ink-alt`), then identical answers with the bulk decline pointer, staff totals,
  organizations, tip links by time window.
- **Tip links, list review, notices, files, settings:** status buttons and count line on tip
  links with the guidance collapsible after the first read; list review's index with counts and
  its page with status buttons, an "At a glance" quiet panel and a deep bar; notices with receipt
  headings, Waiting/Answered chips and the decision as choice cards; the files queue as rows with
  counts; erasing explained on the deep surface; moderation settings as setting panels.

## Decisions taken while building, for the owner to see

- **The decision note stays required.** The design draws "Note for the record" as optional. The
  server keeps every decision with a written reason (`reasonOf` in `queue.ts`) and a test says so
  (`moderation.test.ts`, "a decision needs a reason"). The form asks for it and says it is never
  sent; changing the rule is the owner's call.
- **Who filed it asks for the step-up when the reason is sent**, not before typing it: the API
  client shows the step-up when the server asks, as everywhere else. Nothing is sent without a
  reason of at least 10 characters (the server's own minimum), so closing the row writes nothing.
  Who may look is unchanged (decision 58).
- **"Only second reads" is set apart by a rule, not a dashed edge.** The mock-up dashes it; a dashed
  edge means disabled in the button rules (components.md).
- **Chips:** Approved is `confirmed` (a moderator's outcome); Waiting and Unclear are `open`;
  Declined and Withdrawn are `tag`. A rating shows as `serious` only for Serious and "Apparent
  violation or systemic"; the two milder ratings are `tag`.
- **The Filter button's count leaves out search and the second-read toggle**, which have their own
  controls; the count line names all of them.
- **The Filter panel's logbook and organization lists come from the flood screen's calls** (its
  per-logbook totals and the organization lane), both open to moderators. No new endpoint.
- **Waiting is read oldest first by default; every other status newest first.** Chosen order goes
  in the address.
- **Toasts:** each of these pages mounts its own `ToastProvider`, because the root layout is
  thread A's. If A mounts one at the root, these can go.
- **A report a moderator took off the board** shows a deep panel instead of the Decide form (put it
  back first), and its queue row offers no "Decide here", as before.
- **Who opened what** (settings) shows no count while closed: reading the log is itself recorded,
  so nothing is read until somebody opens it.
- **Files show a type mark, not a thumbnail.** The copy is shown only when asked for, as before.
  "Approve the report first" is the screen's rule only; the server still allows publishing a file
  on an unapproved report, which is never shown while the text is not public.
- **Tip links' fourth button is "Illegal", not "Blocked":** an illegal link is erased, and blocking
  it is a separate choice. Tip links have no counts per status (no API for them).
- **List review keeps cards on a desktop too** rather than a table.
- **Buttons that act on a row are named with `aria-label`, visible word first** ("Look… Who filed
  it", "Open RL-…"), because browsers and test tools join a visible word and a hidden suffix
  differently.

## Files outside this thread's folders

- `apps/web/src/features/files/staff/EvidenceRequests.tsx`: an optional `bare` prop (no heading
  of its own inside a closed row) and `evidenceSummary`. Files staff screens are named in
  moderation.md, so treated as this thread's.
- E2E specs updated for the changed screens: `board/moderate.spec.ts` (rewritten, with the three
  checks below), `board-locked/board.spec.ts`, `board/board.spec.ts`, `flood/flood.spec.ts`,
  `links.spec.ts`, `platform/illegal-content.spec.ts`, `files/staff.spec.ts`.
- `routes/(staff)/moderate/route.tsx` is untouched: its link row is thread A's to remove.

## Checks

| Suite                                     | Result                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web unit (`vitest run`, all)              | 379 passed in 39 files (stage 2: 372; +7 in `test/moderation.test.tsx`)                                                                                                   |
| api unit                                  | 469 passed, 21 skipped, in 36 files                                                                                                                                       |
| `test:db`, the 13 files nearest this work | 233 passed (moderation, pe3, pe4, access-log, second-factor, files-staff, invariants, public-leak-sweep, platform, review-flag, editorial-notes, assessment, queue-pages) |
| `tsc`, web and api                        | clean                                                                                                                                                                     |
| eslint, every changed file                | clean                                                                                                                                                                     |
| prettier                                  | clean                                                                                                                                                                     |
| boundaries (`depcruise`)                  | clean (the one existing warning)                                                                                                                                          |
| browser suite                             | **not run**                                                                                                                                                               |

The full `test:db` was not run, only the files above. The browser tests checks.md §03 asks for
are in `e2e/board/moderate.spec.ts`: deciding in the queue and on the report page record the same
decision row (compared through the API); a bulk decline takes one reason and emails nobody
(message counts before and after); "Who filed it" closed without a reason shows nothing, and the
reporter later sees exactly one look. They have not run.

## Not done

- The "Intake is paused" strip on every staff page (section 05) belongs in the header: thread A.
- The area tabs (section 01): thread A.
- The agreement gate's look (section 10) is unchanged.
- `/files/logbooks/:id` does not yet show the site default beside each limit.
- Erasing a file still asks for a reason in a dialog; there is no type-to-confirm component yet.
- Tip links do not show the type the tipster chose.
- Not compared with the mock-ups in a browser, and not looked at on a real phone.
- `e2e/board/moderate.spec.ts` now opens the queue by address rather than through the staff menu,
  which thread A is replacing.
