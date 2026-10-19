# Workstream I · Maps: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/workstream-i-maps`, based on `ccr-c9c93698-ev856l` (foundation + A, B, C, E, G, H at `09b08ce`)
- **Pull request:** [#9](https://github.com/munsdev/reportlog/pull/9), into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                                   | Result                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm check`                                            | passes (format, lint, types, boundaries; unit tests: web 16 files, api 5) |
| `pnpm test:db`                                          | 442 tests, all passed (34 are I's, in `maps.test.ts`)                     |
| `db:types:check`                                        | up to date                                                                |
| Browser suite (`CI=1 pnpm --filter @reportlog/web e2e`) | 64 passed (I adds 2 tests, run on desktop and phone)                      |

## What was ported, in the order asked

1. **The outline data and its build tools** (`tools/geo/`).
   - `build-geo.js` and `build-gazetteer.js` are legacy's two scripts, with paths changed. The
     source data is vendored in `tools/geo/data/`. `tools/geo` is a workspace package so its
     dependencies (d3-geo, topojson, i18n-iso-countries) are dev-only and never reach the site.
   - Run on the same data, **`build-geo.js` reproduces legacy `public/geo/maps.json` byte for
     byte** (checked with `cmp`). The output is `apps/web/src/features/maps/outlines.json`.
   - `build-gazetteer.js` writes `packages/fields/src/gazetteer.json`. Rebuilt, the only change
     is its `built_from` line, which now names the new outline file. Every code and name is
     unchanged.
   - `apps/web/test/maps/outlines.test.ts` derives the gazetteer again from the outlines and
     fails if a single code or name differs, in either direction.
   - Legacy's comment in `build-geo.mjs` that Tutuila is "about six to one" was the number the
     sheared projection drew (legacy `docs/map.md` says so). The comment is corrected; the
     shape checks that make it impossible again are ported unchanged.
2. **Heat maps as an operator makes them** (migration `20261019180616_maps.sql`,
   `apps/api/src/maps/manage.ts`).
   - `heat_maps`: as many as wanted, `enabled` false by default, `min_area` with
     **`CHECK (min_area >= 2)`**, planes, views, feeds and a slot.
   - The threshold is checked three times: refused by the module in a sentence, refused by the
     database, and clamped again in the aggregate.
   - An area under the threshold is sent as a **bare code in `suppressed.areas`**. With exactly
     one suppressed area the subtotal is `null`, since it would be that area's count. The staff-only
     "unplaced" numbers are never in a reader's payload.
   - Which question places a report is a table of this workstream's own (`map_place_questions`),
     at most one per logbook (its primary key), a `location` question only (trigger). Nothing is
     added to a core table, and a launched logbook can be mapped because nothing here is sealed.
3. **Counting only approved, published reports** (`apps/api/src/maps/aggregate.ts`,
   `publishedHeads`). See "The publication rule" below.
4. **The map on the website** (`apps/web/src/features/maps/`).
   - SVG drawn from the pre-projected outlines. **No map library and no tile layer.** The
     outlines are a separate file fetched once on first use, so two maps on a page cost one download.
   - Several maps can be on one page. **Nothing inside a map has an id or is looked up by one**;
     pointer handling is attached to each map's own SVG and finds areas by `data-code` inside it.
   - Each map has its own address, `/map/<slug>`, which takes `?plane=&view=&area=` and nothing
     else. A link naming a suppressed area selects nothing.
   - The US plane is the lower 48 and DC; Alaska, Hawaii and the five territories are tiles under it.
   - Every area is also listed in a table, for keyboard and screen-reader users.
5. **The staff screen** at `/maps` (`MapAdmin.tsx`): which question places each logbook's (and
   list's) reports, making a map, every setting with the server's refusals shown beside them, "What
   would it publish?" (the same aggregate, for a map that is off), moving maps within a slot, and
   deleting one.

**Optional, done: lists on maps** (legacy 051). `heat_maps.list_ids` (empty means no lists, the
opposite of `logbook_ids`), `map_list_place_questions`, approved entries only, read from
`answers` and never `erasable_answers`, in a query of its own. A list question whose answers are
erased cannot be marked (module and trigger). The page says "approved entries" when it counts
them. `apps/api/src/lists/` is untouched and imports nothing new.

## The publication rule (to agree with D1)

A report counts when the current version of its thread has
`report_heads.moderation_status = 'valid'`, `report_heads.withdrawn = false`, and the sealed
`reports.may_publish = true`. That is the same rule C's confirmation page uses for "public"
(`filing.ts`) and the published half of the chain file (`chainFile.ts`). It reads only the
current version, so a correction (which C sets back to `pending`) leaves the map until a moderator
approves it again; it is not counted at its old place in the meantime.

It lives in one function, `publishedHeads` in `apps/api/src/maps/aggregate.ts`. **If D1 adds a
condition** (legacy's public-archive switch, a new state, a takedown), change it there, or better,
export D's own predicate and call it from there. A test (`maps.test.ts`, "the tally…") files one
report per excluded case.

## Legacy tests and their equivalents

| Legacy                                              | Here                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `heat-map-selftest.mjs`                             | `apps/api/test/db/maps.test.ts`, check for check, plus routes and the wire                           |
| `selftest.js` "map.js names no tile layer"          | `apps/web/test/maps/outlines.test.ts` ("no tile layer, ever")                                        |
| `selftest.js` "the canvas is addressed by data-map" | `apps/web/test/maps/outlines.test.ts` and `heatmap.test.tsx` (two maps)                              |
| `selftest.js` gazetteer agrees with outlines        | `apps/web/test/maps/outlines.test.ts`                                                                |
| (new)                                               | `apps/web/e2e/maps.spec.ts`: staff screen to reader, two maps on the front page, no other host asked |

Two checks of `heat-map-selftest` have no equivalent, and why:

- **"The archive's own switch outranks every map."** There is no public-archive switch yet. It is
  D's. When it exists, `computeMap` must answer "not published" under it (see the rule above).
- **"Only a location question" via `setFieldMapFlags`'s `map_outcome` flag.** The outcome
  question is chosen on the map instead (see below), so there is no per-question outcome flag.

The planted-bug check was done: making the aggregate send suppressed areas with their counts
turned six tests red; dropping the moderation condition turned three red. Both were reverted.

## Deliberate differences from legacy

- **The outcome reading belongs to the map, not the question.** Legacy kept `stances` in a
  question's `settings`, which the rebuild seals into the form definition: it would have to be
  decided before launch and could never change. Here `heat_maps.outcome_*` holds it.
- **`assessed` counts only reports with a stance.** Legacy counted every report of the outcome
  logbook, so an unanswered question pulled the colour toward "evenly split".
- **No `severity` view.** It reads a moderator's assessment, which D has not built. A later
  migration adds it to the `views` CHECK.
- **SVG instead of Leaflet**, so none of the Leaflet traps in legacy `docs/map.md` apply. Zoom is
  by buttons; dragging pans only once zoomed in, so a finger on an unzoomed map still scrolls the
  page on a phone.
- **Slots:** only `own_page` and `home` exist, because the board does not. Legacy's three board
  slots are D's to add (one line in `MAP_SLOTS`, one `<MapSlot>` on the page).
- **Public address** is `/map/<slug>` (legacy `/board/map/<slug>`); the staff screen is `/maps`.

## Changes outside I's folders (all named in the commit message)

- `apps/api/src/app.ts`: one registration line, and an optional `mapCacheMs` for tests.
- `packages/contracts/src/index.ts`: one export line.
- `packages/fields/src/gazetteer.json` (foundation): `built_from` now names the new outline file.
  No code or name changed.
- `apps/web/src/routes/index.tsx` (G): `<MapSlot slot="home" />` on the front page.
- `apps/web/src/routes/map/$slug.tsx` and `apps/web/src/routes/(staff)/maps/index.tsx`: route
  files, which cannot live in `features/maps/`.
- `.dependency-cruiser.cjs`: `maps-stay-out-of-the-seal` (seal and chain never reach
  `apps/api/src/maps/`). Seen to fail on a planted import, then removed.
- `pnpm-workspace.yaml`: `tools/*`, so `tools/geo` has its own dev dependencies.
- `.prettierignore`: the generated outline file and the vendored source data.
- `apps/api/src/db/schema.gen.ts`, `apps/web/src/routeTree.gen.ts`: regenerated.
- `apps/web/e2e/maps.spec.ts`, `apps/api/test/db/maps.test.ts`, `apps/web/test/maps/`: tests.

## For the other workstreams

- **D (board, moderation):**
  - Agree the publication rule above, and tell maps if it changes.
  - **The threshold protects only if the board does not publish each report's place.** If a
    logbook's location question is a board filter, or shown on each published report, a reader can
    count a thin area from the board and the map's threshold protects nothing for that logbook.
    Worth a sentence beside the filter switch, or a rule.
  - Each map's payload carries `filter_key`: the answer key a click could filter the board by
    (null when the feeding logbooks disagree). Clicking an area does not link anywhere yet.
  - Add the board's slots to `MAP_SLOTS` when the board exists.
- **H (operations):** nothing to schedule. Each map is computed live and cached for a minute.
- **G (site):** the map's colours are fixed in `features/maps/scale.ts`, the same in every
  palette, on purpose (legacy `tokens.css` "the map's scales"). The lightest volume step is close
  to the "none counted" grey, as it was in legacy. Worth a look by whoever owns the palette.

## Known limits

- **One residual leak, stated in legacy and still true:** an area crossing the threshold between
  two readings tells a daily watcher that a report arrived there. The staff screen says so beside
  the threshold.
- The world plane counts country answers only. States are deliberately not added up into the
  United States: the difference between the country's total and its shaded states would give away
  the areas under the threshold.
- The reader's switches are read from a link but not written back to the address.
- `apps/api/src/maps/dev-state.ts` (browser-test fixture) approves reports directly, because no
  moderation route exists yet. It refuses to run in production.

## Running it in a cloud container

As A's and E's reports say: the legacy app may already be on port 3000 (this container had it,
started from `legacy/`), and must be stopped first. Then:

```
export CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)
CI=1 pnpm --filter @reportlog/web e2e   # a fresh database per run, since H
```

To rebuild the outlines and the gazetteer: `pnpm --filter @reportlog/geo-tools outlines`.
