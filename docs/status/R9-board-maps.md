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

## The owner's rulings, added at the coordinator's request

The base took `docs/decisions.md` rows 19 to 35 while R9 ran, and the coordinator asked for two of
them in this PR.

6. **Decision 34: the complete chain file is recorded in the access log.**
   - Migration `20261020112918_chain_file_access.sql` adds a `chain_file` kind and a `logbook_id`
     column to `contact_access_log`. A download names its logbook, and no thread or report (all
     three by CHECK). The other kinds' guards are unchanged. The table stays append-only.
   - `anchor/routes.ts` writes the entry after finding the launched logbook and before building
     the file, so if it cannot be written, nothing goes out. A refused request, a logbook with no
     chain, and the published file write nothing.
   - Administrators see it in "Who opened what" ("… downloaded the complete chain file of
     <slug>"). It is not shown to reporters: it is a whole logbook, not their report.
   - Tests in `T/chain-files.test.ts` (3). **Planted bug:** without the write, 2 went red.
7. **Decision 21: the subtraction property is documented** where the board's thresholds are
   described: the header of `api/board/places.ts` (with decision 20, for the same reason), and the
   operator's threshold description on `/maps`. It is accepted because each published report
   already shows its own place, so the threshold protects counts, not places.

Decisions 20 and 30 need no code. R0 b, c, l and q are marked answered in `docs/parity.md`.

## Rows in `docs/parity.md`

- Now Equivalent: §4a `ownership-selftest`, §4b "the map" (the click is Dropped, decision 30),
  §4c `admin-maps.test.js` and §6 `admin-maps.js`. The totals were recounted from the tables with
  a script: 35 Partial rows.

## Changes outside R9's folders

- D's, for decision 34: `moderation/accessLog.ts` (`recordChainFileDownload`, and the logbook in
  the admin view), one field in `packages/contracts/src/moderation.ts`, and one label in
  `web/features/moderation/Settings.tsx`. Also `T/chain-files.test.ts`, and the regenerated
  `schema.gen.ts`.
- `apps/web/e2e/maps.spec.ts` and `apps/web/test/maps/heatmap.test.tsx`: tests.

`apps/api/src/board/published.ts` is unchanged, and still the only place the rule for what is
public is spelled.
