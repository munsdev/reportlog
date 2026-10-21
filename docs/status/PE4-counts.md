# Plan E session 4 · Counts: the owner's answers to PE3's open questions: status

- **Branch:** `claude/plan-e-counts`, from `ccr-c9c93698-ev856l` at `3fb70a7`.
- **State:** built; PR into `ccr-c9c93698-ev856l`.
- **Scope:** the owner's answers (2026-10-21) to PE3's open questions 1 to 4
  (`docs/status/PE3-moderation.md`). Question 2 there (intake links' meaning) was not answered and
  is untouched. Four decision rows at the end of `docs/decisions.md`, numbered `5x` for the
  managing session to renumber.

## What was built

One migration, `20261021144719_small_area_threshold.sql`; types regenerated.

### 1. A bulk decline sends no email (already true; now tested properly)

`bulkDecline` (`moderation/flood.ts`) never called the mailer. PE3's test only checked that no
`decision_notices` row was written, for reports filed with no address, so it could not have
failed. `pe4-counts.test.ts` files three reports **through the routes, with addresses**, declines
one alone (it is mailed: the control) and the other two in bulk (nobody is mailed, no notice
rows). Nothing in the code changed.

### 2. Declined counted publicly; totals for staff

- **Public:** unchanged from PE3 (`GET /api/board/declined`, by reason only). Recorded as a decision
  row amending decision 36 for that one surface, and said so where 36 is enforced (the header of
  `board/stats.ts`) and in `board/counts.ts`.
- **Staff:** there were no overall totals anywhere (the flood screen had per-hour arrivals and the
  queue filters, nothing by status). Added `staffTotals` (`moderation/flood.ts`) to
  `GET /api/moderation/flood` (`totals`): received, accepted, declined, waiting (pending or
  unclear), withdrawn, overall and per logbook (the four add up to received), plus sent and not yet
  confirmed (unexpired `report_submissions`). Shown first on the flood screen, "Every report, by
  where it stands", saying it is staff only. Moderators and administrators (the route's existing
  guard); 403 for anybody else signed in, 401 for a stranger.

### 3. The small-area threshold

- `logbook_publication.small_area integer NOT NULL DEFAULT 2 CHECK (BETWEEN 2 AND 100000)`. No row
  is 2, read the same way. Setting it ahead of time inserts the row with `counts_only = false`; it
  never switches counts only on.
- **One rule:** `countGuards` (`board/places.ts`): per logbook, the map's threshold on the question
  a map reads (as before) and, on a **counts-only** logbook, its own threshold on **every**
  location question; where both apply, the higher. `smallAreaThresholds` (`moderation/switches.ts`)
  clamps to the floor whatever the row says, as the maps' aggregate does.
- **Where it is applied (every public surface that carries a counts-only logbook's place counts):**
  - `GET /api/board/counts` (`board/counts.ts`): `by_place` never holds a thin place;
    `withheld_places` names them with the sum only for two or more.
  - `GET /api/board/stats` and `GET /api/v1/stats` (`board/stats.ts`): a filterable location
    question of a counts-only logbook, the same shape the maps' rule already used.
  - Heat maps (`maps/aggregate.ts`, three lines): a map reading a counts-only logbook uses the
    higher of its own threshold and the logbook's.
- **Checked, and carrying no counts-only place counts:** the board and its spreadsheet (counts-only
  reports are listed nowhere, so a board narrowed to a thin place has total 0), the figures
  catalogue (totals per logbook only), the daily snapshot (listed reports only), the daily counts
  snapshot (lists only, by format), digests (listed only). There are no feeds. The press pack is
  static files. Each is asserted in `pe4-counts.test.ts` except the counts snapshot and digests
  (structural; digests are PE3's test).
- **Not changed:** journalist alerts count accepted reports by state with no threshold. They go to
  vetted journalists (decision 37's audience), not the public; flagged below.
- **Admin screen:** `/moderate/settings`, "Publish as counts only": under each logbook, "Smallest
  place count published for …", a number field saved with a button (never on each keystroke), a
  refusal shown beside the field. `PUT /api/admin/moderation/logbooks/:slug/small-area`,
  administrators; a value under 2, over 100 000 or not whole is refused with a sentence.
- **Every change is a public switch use** (`site_switch_log`, switch `small_area`, the value the new
  threshold), shown on `/board/activity` as "Places with fewer than N accepted reports counted
  without a number: slug", never who. The log's two CHECKs were widened in the migration for this.
- **Wording** on the board and numbers page: "Fewer than N … each, so these places are named
  without a number", replacing "as on the map" (a counts-only threshold need not come from a map).

**Subtraction, documented (decision row and `board/places.ts`), not closed, and nothing added:**

1. With **one** place under the threshold, the logbook's published total minus the places shown
   minus "not answered" (numbers page) is its count; per origin too, from the counts route's two
   columns.
2. At threshold 2, a place named without a number holds exactly one report. That is the map's rule
   (an area is "fewer than k"); a higher threshold says less.
3. A map is state-level (decision 44) and the counts route lists counties apart from their state,
   so a state's map count minus its counties shown minus its state-only answers is the sum of its
   thin counties (one thin county: its count).

Each existed before this session (PE3's counts route had no threshold at all). No new total, and no
count by place crossed with anything else, was added.

### 4. "Counted", not "public"

PE3's note named "My reports"; that page says "Read by a moderator" and never "public". The word
was on the confirmation link's page, from `threadState` in `filing/filing.ts`. A new
`Confirmation` state, `counted` (`packages/contracts/src/filing.ts`): accepted, in a counts-only
logbook, archive on. The page says "Your report is counted … counted in the public figures, and its
words are not shown on the site." The touch in `filing/filing.ts` is that function only (one select
column, one lookup); `ConfirmPage.tsx` has the words.

## Touched outside this workstream (each minimal)

- `filing/filing.ts`: `threadState` only (PE2 is working in filing/; nothing else there touched).
- `packages/contracts/src/filing.ts`: the `counted` state. `features/form/ConfirmPage.tsx`: its
  words.
- `maps/aggregate.ts`: three lines and an import, the higher threshold.
- `features/board/Numbers.tsx`: one sentence.
- `test/db/pe3-moderation.test.ts`: one assertion, to the owner's new rule (see the totals).

## Tests

- `apps/api/test/db/pe4-counts.test.ts`: 15 tests. Bulk decline mails nobody (with a mailed single
  decline as control). Staff totals per logbook and overall add up; 403/401; the public has no
  waiting/received keys and counts the one accepted report. Threshold: default 2, moderator 403,
  refusals (1, 0, −3, 2.5) in a sentence, the database CHECK, public switch log without who and
  staff log with who, a repeated value not logged. On a counts-only logbook (Maricopa 3, Pima 1,
  Wyoming 1, California 2): the counts route at 2 and at 3 (thin codes absent from the payload),
  `/api/board/stats` and `/api/v1/stats`, a heat map at the higher threshold, the board narrowed to
  a thin place, the CSV, figures and the daily snapshot; switched back to entries, only the maps'
  rule is left. Confirmation: `counted` for a counts-only logbook, `public` for a listed one.
  **Checked to fail:** with the counts-only threshold disabled in `countGuards` and the map, 5 of
  the 15 fail.
- `apps/web/e2e/flood/small-area.spec.ts` (flood project): an administrator turns counts only on
  for a fresh fixture logbook and sets the threshold on the settings screen (1 refused beside the
  field, 3 saved); a reader's `/board?logbook=…` shows Arizona, Alaska, California with numbers and
  "Guam, Nevada, Wyoming (4 together)" without, and the `/api/board/counts` bytes carry no thin
  code; `/board/activity` shows the change with a `<time>` and no address. Axe on each page, no
  other host.

### The three suites, on this branch's final code

All on 2026-10-21, run one after another (PE3 saw failures when they ran side by side):

- `pnpm check`: passes. Unit tests: api 455 passed (21 skipped), web 600, seal 46, fields 112,
  access 9. Boundaries: 0 errors, 1 warning (`apps/web/public/boot-guard.js` orphan, not touched
  here).
- `pnpm test:db`: 88 files, **1329 passed**.
- Browser suite (`CI=1 … pnpm --filter @reportlog/web e2e`): **1032 passed, 5 skipped**, 15.6
  minutes.
- What failed on the way, and the fixes: PE3's `pe3-moderation.test.ts` asserted the old rule (a
  one-report place shown with its number); its assertion now expects the threshold (the only
  change to that file). The unit test that keeps the public rule in one place caught
  `staffTotals` writing `moderation_status = 'valid'` in a query; it now groups by status and
  tallies in code. The new browser test first used `check()` on a box that ticks only once the
  server answers, then the browser's own number validation hid the server's sentence; the form is
  now `noValidate`, as the maps form is. The first full browser run failed only that test (and the
  5 tests after it did not run); the run above is after the fixes.

## Open questions for the owner / managing session

1. **Subtraction (above) is documented, not closed.** If the owner wants it closed on counts-only
   logbooks, the usual fix is complementary suppression (when exactly one place is under the
   threshold, also withhold the next smallest) plus dropping "not answered" there; the map/county
   case would need the counts route to roll counties into states, or the map to skip counts-only
   logbooks.
2. **Threshold 2 and named places:** at the default, every place listed without a number holds one
   report. Raising the default to 3, or not naming withheld places at all on counts-only logbooks,
   would say less. Left as asked (default 2, the maps' rule).
3. **Journalist alerts** count a counts-only logbook's accepted reports by state with no threshold.
   Vetted, not public; say if they should keep the threshold too.
4. PE3's question 2 (what an intake link means) is still open.
