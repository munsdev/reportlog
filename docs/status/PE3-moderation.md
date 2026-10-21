# Plan E session 3 · In the record and on the moderator screen: status

- **Branch:** `claude/plan-e-moderation`, from `ccr-c9c93698-ev856l` at `dda02c1`.
- **State:** built; PR into `ccr-c9c93698-ev856l`.
- **Scope:** `docs/plan-e.md`, "In the record and on the moderator screen", **except "sealed on
  arrival"** (session PE2's). ReportLog stays general (decision 42): every item is a setting or a
  capability any site can use, and nothing is on by default except what was already on.

## What was built

One migration, `20261021112233_flood_and_lanes.sql`; types regenerated.

### Publish as counts only (per logbook)

- `logbook_publication (logbook_id, counts_only, set_by, set_at)`. No row is "listed as entries",
  what the software did before, so no board empties on migrate.
- **One rule, beside the old one**: `listedReportIds` in `apps/api/src/board/published.ts` is
  `publishedReportIds` minus counts-only logbooks. Every surface that shows a report one by one
  now asks it: the board's page, one report, the CSV (`board/board.ts`); the verify page's text
  (`routes/verify.ts`); the published chain file (`anchor/routes.ts`); the daily snapshot in the
  transparency log (`anchor/records.ts`); digests (`site/digest.ts`); published files and renditions
  (`files/publication.ts`). Every count still asks `publishedReportIds`: numbers, figures, maps,
  `/api/v1/stats`, journalist alerts (counts only already).
- **Not hidden from:** the journalist desk (vetted, staff-like, decision 37's audience), and the
  reporter's own "My reports" (filing's `isPublic` still says "public"; see open questions).
- Public counts: `GET /api/board/counts` (`board/counts.ts`), behind the archive switch: per
  logbook, published reports by origin; for a counts-only logbook, by place (every `location`
  answer, county or state as sealed, a heat map's threshold kept on all its place questions) and by
  UTC day; for every logbook, by arrival hour (last 14 days). No reference, no answer text.
- Administrator setting on `/moderate/settings` ("Publish as counts only"); the board shows the
  counts panel in place of entries for that logbook and names the counted logbooks above the list.
- Every change is a public switch use (below).

### Labels: organization or open form

- `origin` and `label` on every `PublicReport` (board, one report, CSV column `origin`). Origin is
  the software's: sealed third-party provenance (only a coordinator's batch writes it) is
  `organization`, everything else `open_form`. The words are operator copy: new site-copy slots
  `origin_open_form` ("Unverified public report") and `origin_organization` ("Filed by an
  organization"). The counts use the same two labels. Named `origin_*`, not `label_*`: the site
  test that forbids slots for what the software says about itself (field labels, consent, verify)
  matches `label`, and these word where a report came from, which the brief makes the operator's.
  Drawn with `data-copy` markers (as the lock screen's paragraph is), since they arrive with the
  report rather than with the site's wording.

### Arrival times and declined reports, public

- Arrival by hour: in `/api/board/counts` (above), shown on `/board/activity` (its own page: the numbers page counts published reports only).
- `GET /api/board/declined`: reports declined **now** (not withdrawn), per logbook, by the reason
  from the fixed list (`REJECTION_REASONS`). Counts only: no reference, no words, not the
  moderator's own sentence, not who. A decline before this change takes its reason from
  `decision_notices`; one with none is "Declined before reasons were recorded."
- To keep the reason with every decline (a bulk decline sends no email, so no notice row),
  `moderation_log` gains `reason_code` and `bulk_id` (nullable). A single decline now writes its
  `reason_code` too (`queue.ts decide`).
- **Decision 36** ("only published reports are counted") is amended by Plan E for this one route.
  The leak sweep stays green and unchanged (it looks for keys like `"declined":`; this route uses
  `by_reason`); `pe3-moderation.test.ts` checks the route itself shows no ref, words or moderator.
  Nothing pending or unclear is counted anywhere. The managing session may want a line in
  `decisions.md`.

### Organization lane

- The queue sorts `third_party` reports first, always; within each lane the order asked for.
- `QueueItem` gains `origin`, `organization_id` (from the intake draft's batch, so a rename does not
  lose it) and `answer_set`. Queue filters: `organization`, `lane`.
- `GET /api/moderation/organizations`: each organization with reports, and how many wait. The flood
  screen links each to the queue filtered to it; "Select all of these" then the existing batch
  approval (or bulk decline) handles it as a set.
- **Intake links** (`apps/api/src/orglane/intakeLinks.ts`, routes in `moderation/floodRoutes.ts`):
  a link an organization's manager (or a granter) makes; a signed-in person who opens it joins as a
  **coordinator** (never a manager) and then files for the organization while signed in. **Use
  limit and off switch, enforced by the database too**: a trigger refuses a use on a link that is
  off or past `max_uses` (row-locked), and a link switched off stays off. Token shown once, stored
  hashed; each use a row; the join in `role_audit`. Already a member: nothing used, role kept.
  Screens: `/intake/links`, "Volunteer links" (managers), `/organizations/join/$token`.
  - **Interpretation, flag for the owner:** nothing in the code or brief defined an "intake link".
    I read it as the way into the trusted lane (joining), not a link that lets an anonymous holder
    file as the organization, which would contradict "Intake Coordinators file for their
    organization while signed in". The join page is behind the site password.

### Flood screen (`/moderate/flood`, moderators and administrators)

- `GET /api/moderation/flood`: 24 hourly buckets of first versions (reports) and list entries
  (tips); refusals per hour by check; up to 20 identical answer sets in the last 24 hours (with
  pending counts), each linking to the queue filtered by it. Nothing auto-refreshes; "Read again".
- **Refusal counting for PE2** (`apps/api/src/moderation/refusals.ts`, a leaf):
  `countRefusal(db, check)` upserts one counter in `intake_refusal_counts (hour, check_name,
refusals)`. No content, no address, no request id, nothing finer than the hour; a bad check name
  is counted as `other` rather than throwing. `refusalsSince(db, since)` is the read.
- Queue filters: `from`/`to` (arrival), `place` (any `location` answer; a state takes its counties
  by prefix, so PD6/PD8 county codes `US-AZ-04013` work), `answer_set` (md5 of logbook and the
  jsonb answers, whose key order jsonb normalizes).
- **Bulk decline** `POST /api/moderation/reports/bulk-decline` (`flood.ts`): one reason from the
  list, up to 500 thread ids, one transaction; **one `moderation_log` row per report** (`review`,
  `invalid`, who, when, `reason_code`, `bulk_id`) and one `moderation_bulk_actions` row (who, when,
  reason, the filter, how many). Withdrawn or already-declined reports are skipped with a reason.
  **No email is sent** (a flood's addresses are whatever it typed); see open questions.
- **Batch accept**: the existing `batch-approve` (M2), now offered with "Select all of these".
- **Tip links by time window** `POST /api/moderation/links/bulk-decline`: every unchecked link
  group with a link in the window is `withheld` through `links/checks.ts checkGroup`, so each gets
  its own `link_checks` row; already checked groups are left alone; one bulk row.

### Switches, recorded and public

- `flood_settings` (one row: `intake_paused_at`, `puzzle_level` `normal|harder`) and the
  append-only `site_switch_log` (switch, value, subject, who, when), written in one transaction.
  `GET /api/board/switches` is public: what and when, **never who**; staff see who on the flood
  screen. Not gated by the archive switch (it is about the site, and listed as such in
  `publication-switch.test.ts`).
- **Pause intake.** `refuseWhilePaused(db)` (`moderation/switches.ts`, a leaf) is **one guard
  each** at the top of `submitReport` (`filing/routes.ts`) and `sendListEntry` (`lists/routes.ts`,
  after the list's own 404). 503 `intake_paused` with the notice. It does not stop confirmations,
  corrections, withdrawals, moderation, or **coordinator batches** (the trusted lane keeps filing
  during a flood). `GET /api/intake-pause` is public and in front of the password (one line in
  `identity/doors.ts` FILING_CALLS, passing on any door) because both forms ask it. The forms show
  "Intake is paused" instead of their first card, asked once on load (nothing changes under
  somebody mid-card; a send during a pause gets the 503 with the same words). A banner sits under
  the header on every page past the password; quiet on doors. The notice is operator copy
  (`intake_paused_notice`).
- **Harder puzzle**: stored and logged; `puzzleLevel(db)` is what PE2 reads.

### Step-up (PE1): marked, not built

`TODO(PE1 step-up)` and `STEP-UP (PE1)` markers on bulk decline, pause intake and the puzzle
switch: `moderation/floodRoutes.ts` (the three routes), `moderation/switches.ts`,
`moderation/flood.ts`, the flood screen and the bulk-decline form. `it.todo` ×3 in
`pe3-moderation.test.ts`, `test.fixme` ×1 in `e2e/flood/flood.spec.ts`. The tip-link window
decline is not in plan-e.md's step-up list and is not marked.

## Touched outside this workstream (each minimal)

- `filing/routes.ts`, `lists/routes.ts`: one import and one guard line each.
- `identity/doors.ts`: one FILING_CALLS entry. `e2e/doors/doors.spec.ts`: that call added to the
  door's allowed set.
- `files/publication.ts`: the two published-file reads ask `listedReportIds`.
- `routes/verify.ts`, `anchor/routes.ts`, `anchor/records.ts`, `site/digest.ts`: the same swap.
- `site/copy.ts`, `packages/contracts/src/site.ts`: three copy slots.
- `features/form/FilingForm.tsx`, `features/lists/ListForm.tsx`: the paused check (3 lines each).
- `__root.tsx`: the banner. `staff-nav/entries.ts`: two lines ("Flood screen", "Volunteer links"),
  with the nav tests (`staff-nav`, `intake-nav`) and `staff-guards` (two open pages) updated to
  match; `filing.test.tsx` knows the form's new call; `site-pages.test.ts` counts 16 slots. `playwright.config.ts`: the `flood`
  project, inserted after `journalist-desk`, before `accessibility-behind-password`.
- Test sweeps told about the new tables and routes: `invariants.test.ts` (rows planted in the three
  append-only tables; `/api/intake-pause`, `/api/intake-links/` classed not-staff),
  `publication-switch.test.ts`. `apps/web/test/site-pages.test.tsx`: the three new copy keys.

## Tests

- `apps/api/test/db/pe3-moderation.test.ts`: 24 tests + 3 todo. Counts only: an administrator's
  setting (403 for a moderator); hidden from board page, all-logbooks page, one report (404), CSV,
  verify text, published chain file, the snapshot's rows, a digest; still counted on stats and
  counts (by origin, by place with a county and a state, by day, by hour); logged publicly without
  who. Labels in both origins, operator wording on the board and in the CSV. Declined by reason
  (re-decided reports drop out, pending never appears, no ref/words/moderator), closed archive
  publishes neither count. Bulk decline writes N rows with who/when/reason/bulk id, no notices,
  counted by reason; skips withdrawn; refuses an unlisted reason; 403 for a plain user. Pause:
  refuses the report form and a list entry (no row written), notice and time public, resume lets
  both through, log order and staff `by`; `/api/intake-pause` answers behind the password while the
  switch log does not; puzzle stored and logged; switch log refuses DELETE. Lane: org first,
  organization filter, lane counts, batch approve of the set. Intake links: limit, re-join uses
  nothing, coordinator role, `role_audit`, listing never shows the token; off switch, once off
  always off (trigger), use past the limit refused by the trigger; outsider 403, admin 200. Flood
  screen: 24 buckets, refusals by check incl. `other`, identical set; filters by set, place, county
  vs state, time window; refusal table has exactly three columns; 401 for strangers.
- `apps/web/e2e/flood/flood.spec.ts` (own project): flood screen with axe and no other host;
  bulk decline from the queue (two reports filed through the emailed link), each with its own
  decision; pause end to end (report form and tip form say "Intake is paused", banner on the board,
  switch log on `/board/activity` with a `<time>` and no address, the server refuses a report with
  503, resume restores the form), axe on each, no other host.
- New pages are also walked by `accessibility.spec.ts` and `third-party.spec.ts` from the route tree.

### The three suites, 2026-10-21, on this branch's final code

- `pnpm check`: passes. Unit tests: api 408 passed (21 skipped), web 593, seal 46, fields 77,
  access 9. Boundaries: 0 errors, 1 warning (`apps/web/public/boot-guard.js` orphan, not touched
  here).
- `pnpm test:db`: 85 files, **1226 passed, 3 todo** (the PE1 step-up todos).
- Browser suite (`CI=1 … pnpm --filter @reportlog/web e2e`): **1007 passed, 6 skipped** (one is the
  PE1 step-up `fixme`), 15.4 minutes.
- An earlier browser run failed 22 tests in pages this branch does not touch (site look,
  `/submit`), while `pnpm check` and `pnpm test:db` were running beside it; the same suite run alone
  passed them all. Recorded so nobody is surprised by it under load.

## Open questions for the owner / managing session

1. **Bulk decline sends no email.** A single decline still tells the reporter. Should a genuine
   report swept up in a bulk decline be told? (Mail volume to flood addresses is the cost.)
2. **Intake links' meaning** (above).
3. **"My reports" says "public"** for a counts-only logbook's accepted report (`filing/filing.ts`,
   PD8's folder). It is counted publicly, not shown; the wording there should probably say so.
4. **Counts by place** for a counts-only logbook with no heat map have no threshold (a county with
   one report shows 1). Decisions 20/21 accepted the same for the board; a counts-only logbook has
   no entries to read the place from, so a floor may be wanted.
5. Batch approval can now select the reports of a filtered set; the boxes are still offered only on
   reports that are not approved and not withdrawn, so a bulk decline cannot reach an approved one
   from the screen (the API can).
