# P6 (E2) · Leftovers in the lists: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/p6-lists`, based on `ccr-c9c93698-ev856l` at `9771872` (with C3 and A2)
- **Pull request:** into `ccr-c9c93698-ev856l` (linked from the PR itself)
- **State:** finished and merged into `ccr-c9c93698-ev856l` (`a8ea595`).
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                   | Result                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes (format, lint, types, boundaries; unit: api 282, web 423, fields 69, seal 31)      |
| `pnpm test:db`                          | 52 files, 819 tests, all passed (17 are P6's, in `apps/api/test/db/lists-search.test.ts`) |
| Browser suite (`CI=1`, `CHROMIUM_PATH`) | 128 passed, on a fresh database (6 are P6's: 3 tests, desktop and phone)                  |

Two earlier full browser runs, on this container's long-lived dev database, each stopped on one
failure outside the lists:

- `filing/declaration.spec.ts` (phone) once; it passed 3 runs out of 3 alone. It reads the page
  heading straight after a click, before the navigation.
- `builder.spec.ts` (front-page order), repeatedly. The dev database had gathered more than fifty
  open front-page buttons from many runs, and the server refuses an order with more than fifty
  ("Fifty at most"). CI starts fresh and never sees it. `lists-walk.spec.ts` now closes every list
  it opens, so it adds no buttons. **For B / whoever owns `builder.spec.ts`:** `lists.spec.ts` and
  other specs still leave open logbooks and lists behind.

The 128 above is a run on a newly made, migrated database.

CI on GitHub had not reported when this was written. Check the pull request.

## What was built

1. **The full-text index legacy's 046 kept for subject access requests**
   (`apps/api/migrations/20261019205538_list_search.sql`). Over the erasable half only: the
   string answers in `erasable_answers` and the address in `email`. Two deliberate differences
   from legacy, both in the migration's comment:
   - `simple`, not `english`: it finds a person, and English drops stop words ("Will", "May").
   - `jsonb_to_tsvector` over string values rather than `to_tsvector(erasable_answers::text)`, so
     question keys are not words and an escaped newline does not glue two words together.

   The same migration adds **the three other 046 indexes** the parity row named: `answers` (GIN),
   `list_entry_links.host`, `link_index.submission_count DESC`.

2. **The staff search** (`apps/api/src/lists/search.ts`, `POST /api/admin/lists/search`,
   `/lists/search` linked from `/lists` as "Find somebody's entries"). Administrators only, every
   list, newest first, up to 200; `websearch_to_tsquery`, up to 200 characters. A POST, so the
   name or address looked for is in no address bar, history or access log.
3. **Erased words leave the index.** A GIN index keeps an erased key's bytes in its pages after
   the UPDATE that blanked it, and VACUUM does not remove them (checked, see below). So the list
   sweep has a last step, `sweepTextIndex` → `rebuildTextIndex`: `REINDEX INDEX CONCURRENTLY`
   whenever any entry was erased in the last 31 days (by the clock or by its holder's link), after
   first dropping any invalid `…_ccnew` copy a failed rebuild left (it holds the same words).
4. **The `/api/lists` browser walk** (`apps/web/e2e/lists-walk.spec.ts`). C3's door walks cover the
   list routes with the password ON; nothing walked them with it off. Now: listed and open,
   listed and closed, team only and hidden, as a visitor and signed in; `GET /api/lists` offers
   only the first; 404 never 403; counts unpublished; no other host. And the search end to end:
   a visitor writes something, an administrator finds it by address, the visitor follows the
   erasure link **out of the email**, and the same searches find nothing.
5. **`docs/status/E-lists.md` corrected**: lists on maps (built by I), plus two lines C3 closed
   (opening times in the editor; the list door walked with the password on).
   `docs/lists.md` gains the search section and loses "Lists feeding heat maps" from Not ported.

## Tests

`apps/api/test/db/lists-search.test.ts` (17):

- found by words and by address, on any list; case, phrases, `or`, `-word`, punctuation; a stop
  word is a word; never the durable half or a question key; refusals in words; `more`;
- **the plan uses the index**, and the expression in `search.ts` and the migration is the same text;
- **erase, then search, and find nothing**, by the sweep and by the link;
- **the bytes**: `pageinspect` (in a `probe` schema) reads the index's raw pages. The word is there
  before erasing (the probe works), still there after erasing **and VACUUM**, and in no page after
  `sweepLists`. Seen to fail with the rebuild replaced by a VACUUM (2 pages still held the word);
- nothing erased in the window: nothing rebuilt; a left-over invalid copy is dropped;
- over HTTP: anonymous 401, moderator and user 403, administrator 200.

## Rows this closes in `docs/parity.md`

Not edited here (other sessions edit that file); for whoever updates it:

- §migrations `046_lists`: Partial → **Equivalent** (`M/list_search`, `T/lists-search.test.ts`).
- §5 `051_lists_on_maps` already says Equivalent; E's doc now agrees.
- §7 "Last, before deleting `legacy/`": E's "lists on maps" line is corrected.

## Changes outside P6's folders (all named in the commit message)

- `packages/contracts/src/lists.ts`: the search route and its shapes (E's contract file).
- `apps/web/src/features/lists/ListSearch.tsx` (new), `ListAdmin.tsx` (one link button).
- `apps/web/e2e/lists-walk.spec.ts` (new). `apps/web/src/routeTree.gen.ts` regenerated.
- `docs/lists.md`, `docs/status/E-lists.md`, this file.
- `schema.gen.ts` regenerated: no change (indexes only).

## Not done, and what to know

- **Between an erasure and the next sweep** an erased word is unfindable by any query at once, but
  its bytes stay in the index's pages until the sweep's rebuild (daily, once H's timer runs it).
- **The table's own pages** are not covered: an UPDATE leaves the old row version in the heap
  until VACUUM reuses the space, as for every erased column in this database. The brief asked
  about the index; this is the same question one level down, and nothing here answers it.
- **The rebuild needs to own the table.** In `deploy/` the app and the migrations run as the same
  database user, so it does; if that changes, the step reports FAILED (it never throws).
- **No staff erasure** from the search screen. Erasure is still only the holder's link.
- **pageinspect** must be installable in the test database (it is in `postgres:16`, used by CI).
