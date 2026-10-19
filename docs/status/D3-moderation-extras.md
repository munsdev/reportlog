# Workstream D3 · Moderation extras: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.
D3 builds what D1 (`D1-board.md`) and D2 (`D2-anchor.md`) left.

- **Branch:** `claude/d3-moderation-extras`, based on `ccr-c9c93698-ev856l` (F2 merged in at `221cb83`)
- **Pull request:** see the message to the coordinating session
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

TOTALS

The legacy vector tests in `packages/seal` are untouched and green.

## What was built, in the order asked

1. **Severity, incidents and corroboration** (`apps/api/src/moderation/assessment.ts`).
   - **Severity**: procedural note, irregularity, serious, systemic, or not rated. Set and changed
     by a moderator with a reason; cleared only by saying so (`"none"`); a request that forgot the
     field is refused rather than read as "clear it".
   - **Incidents**: a moderator links a report to another by its reference. Linking to a report
     already in an incident joins it; linking two unlinked reports starts one; unlinking leaves the
     others linked. Never inferred, as in legacy: a clustering mistake would overstate
     corroboration, the number press quotes.
   - **Corroboration counts published accounts only**, through `publishedReportIds` in
     `board/published.ts`. The queue row says "Linked with N other reports · M of the N+1
     published"; the report says which linked reports are published. A withdrawn report stops
     counting at once.
   - Both are kept in a new table, `report_assessments` (no delete), with every change in
     `moderation_log` (`severity`, `incident`), in the same transaction. **Neither is ever in a
     seal**: a test rates and links a report and checks its verification is byte for byte the
     same.
   - The queue filters by severity; `none` finds the reports nobody rated. Below the queue, a
     staff panel breaks corroboration and severity out across published reports (legacy's "By the
     numbers" panels), never as one headline figure.
   - The board serves neither (a test says so). See "Decisions for the owner".
2. **The access log, wherever protected data is opened.** D1 had built the contact log and the
   reporter's view in "My reports"; F records a file's original. D3 adds the rest of legacy's
   `accessLog.js`:
   - `file_preview`: a member of staff viewed a file's cleaned copy, still or page (F's view
     route). Written before the bytes go out. One entry per person and file per 15 minutes,
     because a video asks for itself in pieces. For oversight; **not shown to the reporter** (as
     legacy).
   - `contact_used`: the server opened a reporter's address because a moderator asked them for
     files (F's evidence ask). Nobody on staff saw the address, but it was opened on their say-so,
     so it is recorded before the decryption and **shown to the reporter**, never with who.
   - The administrators' view (Moderation settings → "Who opened what") now also lists F's
     `viewed_original` events, with who and why, and the new kinds.
   - "My reports" now says what was opened in each entry ("Your contact details were opened",
     "The original of a file you sent was opened", "Your address was opened to email you a request
     for files"), with the reason. The component (`features/moderation/ContactAccesses.tsx`) was
     already rendered in C's "My reports" by D1, so no change in `routes/mine/` was needed.
3. **The transparency-log screen** (`/transparency-log`, administrators, a line in the staff menu)
   over D2's `GET /api/admin/anchor`: the anchor's health, the last anchors with their path in the
   log, every run and its outcome, and the complete chain file of each launched logbook. **Read
   only**: legacy's screen was a settings panel (mirrors, branch, authority, deploy key); here
   those are the server's configuration, so a copy of the database can never publish in the
   site's name. The page says where they are set.
4. **The press pack** (`board/press.ts`, `/board/press`). Legacy shipped an empty list of files in
   its code, so publishing anything meant editing the software. Here the list is the
   deployment's: `manifest.json` in `PRESS_DIR` names each file, its label, blurb and type, beside
   the files. Built ahead of time, served from disk, never rendered on request. The request never
   makes a path (it names a key the manifest lists, and names are plain characters with no
   separator). Types a browser would run (HTML, SVG) are refused. A listed file that is missing
   is shown as missing. Downloads are stamped with their version and sandboxed. Behind the site
   password like everything under `/api`; not hidden by the archive switch, since it is not the
   archive. With nothing configured the page says "Nothing has been published here yet."
5. **A browser walk of `/board` with the site password on** (`e2e/board-locked/board.spec.ts`, its
   own Playwright project after the other password projects): every board page is the password
   screen and every board read the page makes, or that is asked directly (`/api/board/*`,
   `/api/press`, `/api/chain/demo`, `/api/v1/stats`), is 401, even with the demo logbook opened
   outside for filing; then the same visitor enters the password and walks the board, a report,
   the numbers and the press pack. No page asks another host.

Also, at the coordinator's request: **F2's `ReportFiles` and `EvidenceRequests` are now the files
and evidence sections of the moderation report view**, replacing D1's older `FilesPanel` and
`EvidencePanel` (removed), so the two screens cannot drift.

## Legacy and its equivalents

| Legacy                                                   | Here                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| `routes/moderators.js` severity and incident routes      | `apps/api/test/db/moderation-assessment.test.ts`                      |
| `routes/moderators.js` / `stats.js` corroboration counts | same file ("counts only published accounts", "a summary")             |
| `accessLog.js` kinds identity, original, preview, audit  | `apps/api/test/db/access-log.test.ts` (and D1's `moderation.test.ts`) |
| `routes/press.js`                                        | `apps/api/test/db/press.test.ts`                                      |
| `admin-translog.js`                                      | `apps/web/e2e/board/extras.spec.ts` ("the transparency log")          |
| `doors-selftest` (the board half, in a browser)          | `apps/web/e2e/board-locked/board.spec.ts`                             |
| (new) the screens                                        | `apps/web/e2e/board/extras.spec.ts`, with the no-third-party check    |

There was no legacy self-test for severity, incidents, the press pack or the access log's preview
kind; the tests above are written from the legacy code.

## Decisions for the owner

- **Should severity or corroboration be public?** Legacy showed both on the board, filtered the
  board by severity, and published `by_severity` and corroboration in `/api/v1/stats`. D3 shows
  them to staff only, as asked. Publishing a moderator's severity is the archive making a
  judgement in public, which legacy withdrew for veracity for the same reason; corroboration is
  safer (it counts published accounts a reader can check). Not changed without a decision.
- **The severity hints.** Legacy's hints named voting ("Voters were or could have been prevented
  from voting"). Nothing says a deployment is about elections, so the hints here are general. The
  four values are legacy's.
- **The complete chain file is not logged as an access.** It holds every report's sealed answers,
  published or not, but answers are what moderators read in the queue unlogged (legacy's "Tier
  A"); contact details are not in it. Recording each download would be one line in
  `anchor/routes.ts`.

## Changes outside D's folders (all named in the commit messages)

- `apps/api/src/files/routes.ts` (F): one call to `recordFilePreview` before a copy, still or page
  is sent.
- `apps/api/src/evidence/routes.ts` (F): one call to `recordContactUsed` before an address is
  decrypted for an ask.
- `apps/api/src/config.ts`: `PRESS_DIR`. `.env.example`: its line.
- `apps/api/src/app.ts`: one registration (`pressRoutes`) and `PRESS_DIR` in `AppDeps`.
- `apps/web/src/features/staff-nav/entries.ts` (G2): one line; its test.
- `apps/web/playwright.config.ts`: the `board-behind-password` project, and the other projects
  ignore its folder.
- Migration `20261019200151_moderation_extras.sql`: the new `report_assessments` table; the
  `moderation_log` action CHECK gains `severity` and `incident`; `contact_access_log` gains
  `attachment_id` and two kinds, with its CHECKs restated (every look names its report, a preview
  names its file; a contact opening still needs its reason). Both logs stay append-only.
  `schema.gen.ts` and `routeTree.gen.ts` regenerated.

## For the other workstreams

- **F (files):** your view route and the evidence ask now each call one function from
  `moderation/accessLog.ts`. If you add another way to see a file's bytes or a reporter's address,
  call the same. The moderation report view now renders your `ReportFiles` and
  `EvidenceRequests`; `/files/:ref` could link to `/moderate/<thread>` for the rest of the report.
- **D2 / H:** the archive export should carry `report_assessments` (it finds tables in the
  catalogue, so it will, unless it is excluded). It must never be sealed.
- **C (filing):** nothing changed in your folders.
- **G (site):** the press pack's documents are the operator's; the front page could link
  `/board/press`.

## Not done

- Severity and corroboration on the public board and in the public stats (a decision above).
- A screen for the full access log with filters (by month or report): the administrators' list
  shows the last twelve months, as D1 built it.
- The press pack has no builder: an operator puts the files and the manifest in `PRESS_DIR`, as
  legacy expected them to build the pack outside the software.
