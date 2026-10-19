# Piece P5 (D4) · Public API, exports and the board's remaining reads: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.
The brief is `docs/parity.md` §7, "P5". D1 (`D1-board.md`), D2 (`D2-anchor.md`) and D3
(`D3-moderation-extras.md`) built the rest of D.

- **Branch:** `claude/p5-public-api`, based on `ccr-c9c93698-ev856l` at `96b3741` (D3 merged)
- **Pull request:** see the coordinating session's message (into `ccr-c9c93698-ev856l`)
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

RESULTS_TABLE

The legacy vector tests in `packages/seal` are untouched and green. No migration: nothing here
needed a table or a column, so `schema.gen.ts` is unchanged.

## What was built

1. **`GET /api/v1/consent-texts`** (`board/consentTexts.ts`, `board/routes.ts`, contract
   `getPublicConsentTexts` in `packages/contracts/src/board.ts`). Every wording of the publication
   question this site has shown, oldest first: `digest`, `variant`, `body`, `introduced_by_role`
   (a role, never a person) and `first_seen_at`, with `api_version: 1` and a licence over the
   wordings only. Cached for an hour, as legacy. `/api/v1`'s index lists it, and its licence now
   covers "the aggregate counts and the consent wordings".
   - **The digest checks.** The database's CHECK makes each digest the SHA-256 of its NFC body, so
     a reader with only this response can confirm the sentence behind a published report's sealed
     `may_publish_digest`. The test does exactly that, for a published report.
   - **Not asked of the archive switch**, as legacy did not ask it. These are the site's own
     sentences and say nothing about any report; a reporter checking their own seal needs them
     whatever the site publishes this week. `publication-switch.test.ts` now has a
     `NOT_THE_ARCHIVE` list naming this route and why; its "no door is forgotten" test still
     fails for any other `/api/board` or `/api/v1` read that the list of withheld doors does not
     name, and a new test checks the exception answers the same with the archive off.
   - **Behind the site password**, like the rest of `/api/v1` today (see "Waits on the owner").
     D3's locked walk (`e2e/board-locked/board.spec.ts`) now also asks `/api/v1` and
     `/api/v1/consent-texts` directly and expects 401.
2. **The board's map slots.** Three lines in I's `MAP_SLOTS` (`packages/contracts/src/maps.ts`),
   legacy's three board places, and a `<MapSlot>` in each:
   - `board_reports`, "Above the report board": at the top of `/board`, before the filters
     (`features/board/Board.tsx`). Only while the archive is published.
   - `board_numbers`, "With the numbers": under the counts on `/board/numbers` (`Numbers.tsx`).
   - `board_tab`, "Its own tab on the board": a new page, `/board/maps`
     (`features/board/Maps.tsx`, `routes/board/maps.tsx`). The board shows a "Maps" button only
     while a map is placed there; with none, the page says "There are no maps on the board."
   - Nothing about a map changed: each slot renders I's `HeatMap`, whose data comes only from
     `computeMap`, so **an area under the threshold reaches the browser as a bare code with no
     count**, and the archive switch and the publication rule (`board/published.ts`, through
     I's `publishedHeads`) apply as everywhere else. The staff screen (`/maps`) offers the new
     slots from the server's list, with no change of its own. No migration: `heat_maps.slot` has
     no CHECK on purpose (I's migration says why).
3. **List figures** in `board/figures.ts`, legacy's set exactly: for every list that is
   **listed AND whose counts an administrator published** (the same two conditions as
   `GET /api/lists/:slug/counts`), per window (`all`, `24h`, `7d`, `30d`, `365d`):
   - `list.<slug>.received.<w>` and `list.<slug>.approved.<w>`;
   - `list.<slug>.<question>.<value id>.received.<w>` and `….approved.<w>`, for each question an
     operator ticked as countable, where the value id is the first six hex digits of the
     answer's SHA-256, legacy's `valueId`, so a placeholder written against the old site names
     the same figure.
   - Counted by E's own code (`summaryFor` in `lists/aggregates.ts`), so a figure and the list's
     public counts can never disagree, and nothing here reads `erasable_answers`. The direction
     board → lists is allowed; lists still reaches nothing of the board, the seal or the chain
     (the boundary check passes).

## Legacy and its equivalents (the rows this closes in `docs/parity.md`)

| Parity row                                                         | Here                                                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2 `GET /api/v1/consent-texts` (Missing)                           | `GET /api/v1/consent-texts`; `T/board.test.ts` "the consent wordings"; `T/publication-switch.test.ts` "what is not the archive"                                                  |
| §4b "numbers in an operator's own wording" (Partial: list figures) | list figures in `board/figures.ts`; `T/board.test.ts` "offers a list's counts only once it is listed AND its counts are published". The wording itself is still not wired (P2's) |
| §6 `map.js` (Partial: the board's slots are not placed)            | `board_tab`, `board_reports`, `board_numbers`; `E/board-maps/maps.spec.ts`                                                                                                       |

Still Partial, and why: `/api/v1` behind the password (§2, decision 2) and the distribution
switch (§2 `/publication`, §4a `publication-selftest`, §4b "the publication switches", §5
`009_publication_switches`, decision 11). Both wait on the owner; see below.

The planted-bug check was done for the list figures: dropping the `visibility = 'listed'`
condition turned the new test red. Reverted.

## Waits on the owner

Neither is built. Each is written out so that, once decided, it is a short change.

### 1. Where `/api/v1` sits relative to the site password (parity §8 item 2)

Today every `/api/v1` read is behind the password, like the board. Legacy put it in front
("an endpoint other people build against is not public if it is behind a password"). In front, it
would be a third way past the password, beside the doors and the lists that decide for
themselves. Two questions for the owner: in front or behind; and, if in front, whether
`/api/v1/stats` should then say anything on a site whose board is behind a password (counts are a
statement about the archive, which is why the archive switch withholds them).

**If "in front":**

- `apps/api/src/identity/gate.ts` (A's), `IN_FRONT`: three lines, exactly the route keys the hook
  compares (`${method} ${routeOptions.url}`):
  ```ts
  // The public API (board/routes.ts): built against by people with no account here.
  'GET /api/v1',
  'GET /api/v1/stats',
  'GET /api/v1/consent-texts',
  ```
  Listed one by one, not as a prefix, so a later `/api/v1` read is behind the password until
  somebody adds it here on purpose.
- `apps/api/src/board/routes.ts`: the header comment's "ALL BEHIND THE SITE PASSWORD" paragraph
  becomes "everything except `/api/v1`". Optionally legacy's other two `/api/v1` guards:
  `access-control-allow-origin: *` with `GET, OPTIONS` (useful only in front: with the password
  on, a cross-origin read carries no cookie and is refused anyway), and a rate limit (legacy 120
  a minute per client) through A's `limiter()` in `identity/limiter.ts`, keyed in memory, never
  logged with the address.
- Tests:
  - `apps/web/e2e/board-locked/board.spec.ts` (D3's locked walk): move `/api/v1`,
    `/api/v1/stats` and `/api/v1/consent-texts` out of the "401" list into a new list that
    expects 200 with the password on and **no** published report text in the body, while every
    `/api/board` read beside them stays 401.
  - `apps/api/test/db/doors.test.ts` (or a new `T/public-api-gate.test.ts`): with the curtain
    down, anonymous `GET` of each of the three is 200 and each `/api/board/*` read is 401; and
    a test that every route under `/api/v1` is either in `IN_FRONT` or answers 401, so a new
    one cannot slip either way unnoticed.
- Nothing in the website changes: it reads `/api/board/*`, never `/api/v1`.

**If "behind":** nothing to build. The parity row becomes Dropped, with this file cited, and the
`/api/v1` index's wording should say that the API needs the site password.

### 2. The distribution switch for exports (parity §8 item 11)

Legacy's `distribution_enabled` (migration 009) was a second, operator-owned switch, **NULL
meaning off**, and **it governed nothing**: no legacy route read `distributionAvailable()`, and
its admin route said so (`distributionImplemented: false`). It existed so that when something
distributed onward, no deployment would already be doing it. So the decision is two things: is it
wanted, and **which reads count as "distribution"**. A proposal: the bulk, machine-readable
copies of report text, i.e. `GET /api/board/reports.csv` and the published chain file
`GET /api/chain/:slug`; not the board's pages, not counts, not the consent wordings.

**If wanted:**

- A migration `YYYYMMDDHHMMSS_distribution_switch.sql` (named with the real time):
  `ALTER TABLE moderation_settings ADD COLUMN distribution_enabled boolean, ADD COLUMN
distribution_set_by text;` with legacy's comment (NULL is off; never hashed). Then
  `pnpm --filter @reportlog/api db:types`.
- `apps/api/src/board/publication.ts`: `distributionAvailable(db)` (`stored === true`, so NULL
  is off) and `setDistribution(db, enabled, byEmail)`, beside the archive switch, and a
  `DISTRIBUTION_OFF` sentence.
- `packages/contracts/src/moderation.ts`: `ArchiveState` gains `distribution` and
  `distribution_stored`; `setArchiveSwitch`'s body gains an optional `distribution`.
  `apps/api/src/moderation/routes.ts` (the scope at line 457) reads and writes it.
- Each gated read asks it after the archive switch: `board/routes.ts` (the CSV handler,
  `BOARD_CSV_PATH`), `anchor/routes.ts` (`getPublishedChainFile`), answering 404 with the
  sentence, as the CSV already does for the archive switch.
- `apps/web/src/features/moderation/Settings.tsx`: a second switch under "Public archive",
  saying what it covers.
- Tests: in `apps/api/test/db/publication-switch.test.ts`, (a) a fresh database stores NULL and
  distributes nothing; (b) a list of distribution doors, each withheld until an administrator
  sets it on, and each also withheld when the archive is off; (c) the switch is never in a seal
  (a report's verification is byte for byte the same either way); (d) only an administrator
  turns it. The board-maps project's browser walk is not affected.

**If not wanted:** the parity rows become Dropped, citing this file.

## Not changed, by decision

- **Severity and corroboration stay staff-only**, as D3 left them. Nothing here serves either.
- **The figures route still follows the archive switch as a whole.** With the archive off,
  `/api/board/figures` answers "does not publish a public archive", so a list's figures go with
  it, although `GET /api/lists/:slug/counts` does not ask that switch. Nothing renders figures in
  wording yet (P2), so nobody sees the difference today; P2 should decide whether list figures
  survive the archive switch when it wires `renderText`.

## Changes outside D's folders (all named in the commit messages)

- `packages/contracts/src/maps.ts` (I): three lines in `MAP_SLOTS` and its comment.
- `apps/web/src/routes/board/maps.tsx`: a route file, which cannot live in `features/board/`;
  `apps/web/src/routeTree.gen.ts` regenerated by the build.
- `apps/web/playwright.config.ts`: a `board-maps` project, last, after `board-behind-password`;
  the two parallel projects ignore its folder.
- `apps/web/e2e/board-locked/board.spec.ts` (D3's, D's area): two more URLs in the 401 list.

## For the other workstreams

- **I (maps):** three new slots. A map clicked on the board does not filter the reports below
  it (legacy's `board_reports` did); `HeatMap` has no selection callback for a page to use, and
  each payload already carries `filter_key`. Worth adding to `HeatMap` if wanted.
- **P2 (site pages):** the API page (`api.html`) should list `/api/v1/consent-texts`. List
  figures exist now, under `list.<slug>.…`, for `renderText`.
- **A (identity):** the `IN_FRONT` lines above, once the owner decides.

## Not done

- The two decisions above.
- Clicking an area on the board's map to filter the board (see I above).
