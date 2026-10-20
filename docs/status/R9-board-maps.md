# R9 · Board and maps (D5 with I2): status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.
The brief is R9 in `docs/parity.md` §7, plus the heat map tiles' names that R8 found.

- **Branch:** `claude/r9-board-maps`, based on `ccr-c9c93698-ev856l` at `311abe4` (R2), merged up
  to the base's head with the owner's rulings 19 to 35
- **Pull request:** see the pull request into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-20

## Checks, as last run before pushing

CHECKS_TABLE

## What was built, in the order asked

1. **A report with an unanswered optional question is still found and counted by the board's
   search** (`apps/api/test/db/board.test.ts`, "a report with an unanswered optional question").
   Legacy's `ownership-selftest` ended with a block on NULL in Postgres filters: a NULL location
   failed `&&` and a NULL date failed `>=`, so a report that skipped a question fell out of a
   search. The rebuild has no such columns. An unanswered question is an absent key, and a report
   with nothing answered seals no `answers` at all, so the column is NULL. The tests cover both:
   - a report missing three optional answers is found by its words and by a filter on a question
     it did answer, and `total` counts it;
   - a report with no answers at all is found by its reference, counted in its logbook's total and
     in `/api/board/stats`, and left out of a search that matches only the other report.

   **Planted bug:** removing the `coalesce` in `api/board/search.ts` turned the second test red.
   It was put back, and the GIN index's copy of the expression was never touched.

2. **The map list says the threshold in words** (`MapAdmin.tsx`): "an area shows its number at 3
   reports or more", where it said "threshold 3". Legacy said "3 reports or more".
   **"No maps yet."** is tested in `E/maps.spec.ts`. Other tests leave maps in the shared
   database, so the test replaces only the list call's `maps` with an empty one and keeps the
   server's real `slots`.
3. **The map editor's unsaved-changes warning** (`MapAdmin.tsx`), built the way the settings
   screens' is (`routes/(staff)/settings/-editor.tsx`). Nothing is imported from there, because a
   feature does not reach into a route folder.
   - One question for the whole screen, naming every open map with changes ("You have changes to
     the map “…” that are not saved. Leave without saving them?"). It is asked before the router
     leaves `/maps`, and the browser asks its own question before a reload or closed tab.
   - Closing one map's editor ("Close") asks about that map alone.
   - "Unsaved" means different from what the server holds, not "was touched". Sets are compared
     sorted, so ticking a box off and on again leaves nothing to lose. After a save the editor
     takes its fields from the server's answer, so a value the server tidied is not called
     unsaved.
   - The browser test checks each case: unticking and reticking asks nothing, "no" keeps the
     change on screen, a save clears the warning, and "yes" leaves with the change not saved.
     **Planted bug:** a blocker that never blocks turned it red.
4. **The lazy fetch asserted** (`E/maps.spec.ts`): the outline file is asked for once for two
   maps on the front page, and never on `/maps`, which draws no map.
5. **The heat map's inset tiles** (`HeatMap.tsx`). They showed "Alaska 3" or "Guam <3" but were
   named "Alaska: 3 published reports", which axe flags as `label-content-name-mismatch`
   (WCAG 2.5.3). Somebody using speech input says what they see. A tile's name now starts with
   its visible text, then the sentence:
   - "Alaska 3: 3 published reports";
   - "Guam <3: fewer than 3, not shown";
   - "Am. Samoa, American Samoa: none counted". A tile with nothing counted shows a dash, which is
     not a word, so its name starts with the short name alone.

   The tile's two spans also needed a space between them in the DOM. Flex draws none, but without
   it axe reads the text as "Alaska3". **Checked in Chromium** with a throwaway spec (not
   committed) that put a map in the front page's slot and ran axe on `/`: 5 violations of the rule
   before, 1 after the names alone, 0 with the space. The unit test
   (`WT/maps/heatmap.test.tsx`) asserts the names, and that each starts with the tile's visible
   text. It does not run axe: in jsdom axe sees no text, because there is no layout, so it passed
   the old names too. That was tried first and dropped.

## R8's allowance: not removed yet

**R8 had not merged when this was finished.** Its allowance for this rule on `/`
(`MAP_TILES` in `apps/web/e2e/accessibility.spec.ts`, on `claude/r8-invariant-leftovers`) is not
on this branch's base. The file is R8's, so this branch does not touch it. **Remove `MAP_TILES`
and its two `ALLOWED` entries once both have landed.** The check above says the walk of `/` is
clean without it.

## The owner's rulings that landed during this piece

The base took `docs/decisions.md` rows 19 to 35 while R9 ran. As briefed, R9 leaves R0 b, c, l
and q alone, but they are now ruled:

| R0  | Decision | What it means for R9's folders                                                                                                                                                                      |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| b   | 20       | Place codes stay searchable. No code.                                                                                                                                                               |
| c   | 21       | The subtraction leak is accepted and documented. A sentence somewhere a reader or operator sees it, not code.                                                                                       |
| l   | 30       | Clicking a board map to filter the board is dropped for now. §4b "the map" can then read Equivalent, with the click Dropped. It still reads Partial, because recording that is l's bookkeeping.     |
| q   | 34       | **Still to build:** downloading the complete chain file is recorded in the access log (`apps/api/src/anchor/routes.ts`, which R9 owns for q only). A small follow-up; this branch did not start it. |

## Legacy tests and their equivalents

| Legacy                                                       | Here                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `ownership-selftest`, the NULL block                         | `T/board.test.ts` "a report with an unanswered optional question" (2)   |
| `admin-maps.test.js` "says its threshold in words"           | `E/maps.spec.ts` "the staff screen says "No maps yet."…"                |
| `admin-maps.test.js` "No maps yet"                           | the same test                                                           |
| (§4b "the map": no unsaved warning, lazy fetch not asserted) | `E/maps.spec.ts` "the map editor warns…"; "two maps on the front page…" |
| (R8's axe finding on `/`)                                    | `WT/maps/heatmap.test.tsx` "names each tile by what it shows first…"    |

## Rows in `docs/parity.md`

- §4a `ownership-selftest`: Partial → Equivalent.
- §4c `admin-maps.test.js`: Partial → Equivalent.
- §6 `admin-maps.js`: Partial → Equivalent.
- §4b "the map": still Partial, now only for the click to filter (decision 30 drops it).
- The totals: self-test scripts 33 / 1, browser tests 12 / 10, screens 23 / 9; Partial rows 36.
  Recounted from the tables with a script.
- §7 R9 is marked built, with the rulings above.

## Changes outside R9's folders

- `apps/web/e2e/maps.spec.ts`: three new tests, and the two tile names in the existing one. The
  file is I's, now R9's through `features/maps/`.
- `apps/web/test/maps/heatmap.test.tsx`: the new names, and one new test.
- `docs/parity.md`, this file.

No migration, no contract change, nothing in `packages/`. `apps/api/src/board/published.ts`, the
one rule for what is public, is unchanged and still the only place it is spelled.
