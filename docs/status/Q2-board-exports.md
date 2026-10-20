# Q2 · The board's thresholds, the distribution switch, the frozen-file drop, and the owner's copies: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.
The brief is the owner's decisions 6, 10, 11 and 17 in `docs/decisions.md`.

- **Branch:** `claude/q2-board-exports`, based on `ccr-c9c93698-ev856l` at `909179a` (the decisions)
- **Pull request:** [#27](https://github.com/munsdev/reportlog/pull/27), into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-20

## Checks, as last run before pushing

Run on the branch's head, with the base (`ccr-c9c93698-ev856l` at `909179a`) already merged: it
had not moved since the branch was made.

| Suite                                                                       | Result                                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                | passes (format, lint, types, boundaries; unit tests: api 342 passed and 11 skipped, web 465, fields 69, seal 31, access 6) |
| `pnpm test:db`                                                              | 67 files, 996 tests, all passed                                                                                            |
| `db:types:check`                                                            | up to date (two migrations; `schema.gen.ts` regenerated, never edited)                                                     |
| Browser suite (`CI=1`, `CHROMIUM_PATH`, `pnpm --filter @reportlog/web e2e`) | 452 passed, 4 skipped, none failed (8.9 minutes)                                                                           |

- **The 11 skipped unit tests are P7's** (`deploy-caddy.test.ts`, `deploy-storage-check.test.ts`):
  they skip when Caddy or moto is not installed, and this container has neither.
- **The 4 skipped browser tests are deliberate,** each a site-wide switch run on the desktop
  project only so desktop and phone do not flip it under each other: 3 are P2's
  (`site-pages.spec.ts`), 1 is Q2's (`board.spec.ts`, the downloads switch).
- **What Q2 adds:** database tests 32 (`board-places` 12, `copies` 11, `files-freeze-drop` 4,
  `publication-switch` 5 more); web unit tests 5 (`backups` 4, `filing` 1; `staff-nav` changed);
  browser tests 4 (`owner/backups.spec.ts` 3, `board.spec.ts` 1).
- The legacy vector tests in `packages/seal` are untouched and green. Nothing sealed is read
  differently: both migrations touch tables no sealed object reads (`moderation_settings`,
  `role_audit`).

## What was built

### Decision 6 · The board keeps a heat map's threshold

Where a heat map reads a logbook's place question, the board withholds an area's count below the
map's threshold, the way the map does. The rule is `apps/api/src/board/places.ts`.

- **Which questions.** A logbook's question in `map_place_questions` (a `location` question), fed
  into any heat map: one naming the logbook, or one naming no logbooks (every logbook).
- **Every map counts, switched on or not.** The threshold is the operator's statement of how thin
  an area may be shown. Turning a map's display off does not withdraw it. Where several maps read
  one question, the highest threshold wins. Clamped to the floor of 2, as the aggregate does.
- **The board narrowed to one place** (`GET /api/board/reports?logbook=…&a.<key>=…`): fewer
  published reports than the threshold, and the answer is `{ published: true, withheld: true,
threshold, reason }`. No reports and no total, because either is the count. Zero is not
  withheld: the map says "none counted" for an empty area too. Narrowing further (a search inside
  a large place) is held to the same rule, so it cannot single out a thin cell.
- **The spreadsheet** narrowed the same way is a header and no rows.
- **The numbers** (`/api/board/stats` and `/api/v1/stats`): for that question, an area under the
  threshold is left out of `counts` and named in a new optional `withheld: { threshold, areas,
reports }`. `reports` is their sum only with two or more, as the map's subtotal is. The v1 field
  is added; nothing is renamed or removed.
- **The board page** shows the sentence instead of reports; `/board/numbers` lists the thin
  areas by name under the counts.
- **Tested on the payload**, not the page: `apps/api/test/db/board-places.test.ts` (12 tests)
  reads the JSON and the CSV bytes and checks that no total, no report and no reference are in
  them. Planted bug: sending the count anyway turned 4 of them red. Reverted.

### Decision 11 · The distribution switch governs the bulk downloads

Built as `docs/status/P5-public-api.md` laid it out.

- **Migration** `20261020063140_distribution_switch.sql`: `moderation_settings.distribution_enabled`
  (NULL is **off**, the opposite of the archive switch: nothing distributed before, and nothing may
  start because a migration ran) and `distribution_set_by`. Never sealed.
- `board/publication.ts`: `distributionAvailable` (the archive switch on AND an administrator said
  yes), `setDistribution`, `DISTRIBUTION_OFF`.
- **What it governs:** the board's spreadsheet (`GET /api/board/reports.csv`) and the published
  chain file (`GET /api/chain/:slug`). Each asks the archive switch first, so a closed archive
  still says that, then this, answering 404 with a sentence.
- **What it does not govern,** each said in `publication.ts`: the board's pages, one report, the
  counts and figures, the consent wordings, the maps, published files (each a moderator's decision
  about one report), the daily snapshot in the transparency log, and the owner's own backups and
  exports (the operator's copy, not a distribution).
- `GET /api/board` says `downloads: true|false`, and the board shows its "Download these as a
  spreadsheet" link only when it is true.
- The administrators' screen (`/moderate/settings`, "The public archive") has a second switch,
  "Offer downloads", saying what it covers and that nobody choosing means no downloads.
- **Tests:** `publication-switch.test.ts` (a fresh site stores NULL and distributes nothing; each
  download opens only once an administrator says yes; the archive switch still outranks it; a
  report's verification is byte for byte the same either way; only an administrator turns it;
  naming one switch never resets the other) and `e2e/board/board.spec.ts` (the screen's switch and
  the board's link, on the desktop project only, because the switch is site-wide).

### Decision 17 · Files staged before a freeze are dropped at Send

As legacy dropped the draft token at Send on a frozen logbook.

- `files/slots.ts` `dropFrozenDraft`: the draft's unreleased files are marked refused with a plain
  reason (`FROZEN_DROP`: "this logbook stopped taking files before the report was sent, so the file
  was not kept"), tied to the submission so the confirmation page can name them, and their bytes
  are queued for deletion at once. They are never released, so the worker never touches them.
- `files/filing.ts` `releaseForSubmission` drops instead of releasing when the logbook is frozen,
  inside the transaction that records the submission, and returns the names.
- **The reporter is told twice, in plain words:**
  - the answer to Send carries `files_dropped` (only when there were any), and the "Check your
    email" page says "While you were writing, this logbook stopped taking files. Your report was
    sent without these files, and they were not kept:" with the names;
  - the confirmation page, which already names every file that is not part of the report with its
    reason, says "queue.jpg: this logbook stopped taking files before the report was sent, so the
    file was not kept."
- A freeze after Send leaves the files already released alone, as legacy did.
- **Tests:** `test/db/files-freeze-drop.test.ts` (4, through the real routes: one finished upload
  and one half-sent; the names in the answer; refused, tied, never released, bytes queued; the
  confirmation names both and links nothing; an unfrozen logbook unchanged; a freeze after Send
  changes nothing) and `apps/web/test/filing.test.tsx` (the receipt names the files). Planted bug:
  ignoring the freeze turned 2 red. Reverted.

### Decision 10 · Backups and archive exports on the owner's screen

Both were already commands. A new screen, `/backups` ("Backups and exports"), for the **owner
only**, starts either and offers the finished file.

- **Server** (`apps/api/src/anchor/copies.ts`, one registration line in `app.ts`):
  - `GET /api/admin/copies`: the backups in `BACKUP_DIR` and the exports, their sizes and times,
    the backup's health, the last off-site copy, the last failure, what is running and how the
    last one ended, and the restore command.
  - `POST /api/admin/copies {kind: 'backup'|'export'}`: one job at a time (409 with a sentence
    otherwise), run in the background; the screen asks again every two seconds while one runs.
  - `GET /api/admin/copies/:kind/:name`: the file, streamed from disk, `no-store`, as an
    attachment. Only a name the folder's own listing holds is served, matched against the listing
    and never joined onto a path as given; anything else is 404.
  - **The owner only:** the scope's guard is `roleGuard(['owner'])`, the owner rank from
    `@reportlog/access`, which no grant can produce. An administrator gets 403. P1's staff-route
    sweep picks the three routes up (they are under `/api/admin/`).
  - **The audit trail:** every download is a `role_audit` row (axis `archive`, action
    `download`), written before the first byte leaves. Migration
    `20261020064655_archive_downloads_audit.sql` widens the two CHECKs (and pairs `download` with
    `archive`). "Who changed what" (`/access/audit`) reads it as "owner@… downloaded the archive
    export reportlog-archive-….json (1.2 MB)".
  - **No third party:** the file goes from this server's disk to the owner's browser. Nothing is
    a storage provider's link. (The nightly job's encrypted off-site copy is unchanged.)
  - **Restoring and importing stay on the command line,** as in legacy. Restoring rebuilds the
    database the server answers from; importing runs only into a database with no accounts, which
    a signed-in owner's is not. The screen shows the restore command (legacy's `restoreCommand`,
    ported, with this deployment's paths).
- **Streamed, not buffered:**
  - **The export** is now written as it is read (`writeArchive` in `anchor/archive.ts`): every
    table through a cursor, 500 rows at a time; the reports by id, 500 at a time; the sink's
    promise holds the reading back for a slow disk. `writeArchiveFile` writes under `.partial` and
    renames when complete. `exportArchive` (used by the tests and the reset marker) is the same
    text, collected, so there is one implementation. **The `anchor export` command uses it too**;
    it used to build the whole archive in memory and stringify it.
  - **The backup** is `pg_dump` to disk, as before (`runBackup`, unchanged except that it takes
    only the settings it reads, so the server can call it).
  - **The download** is a read stream.
  - The import (`anchor import`) still reads the whole file into memory. It is a command run once
    when moving a server; a streaming JSON reader would be a dependency for that one use.
- **Where the files are:** backups in `BACKUP_DIR`, as the nightly job's; exports in
  `STATE_DIR/exports`, the newest three kept, deleting only files this wrote.
- **Web** (`apps/web/src/features/backups/BackupsPage.tsx`, route `/(staff)/backups`, wrapped in
  `<StaffOnly needs="owner">`; a nav line for the owner only): says before any link that every
  download is recorded where the people who grant access read it; one button each; the files with
  their sizes; the restore command folded away.
- **Tests:**
  - `apps/api/test/db/copies.test.ts` (11, on a database of its own): a stranger 401, a
    moderator and an administrator 403 on all three routes; a backup started from the screen is a
    dump `pg_restore --list` reads, the download is the file on disk byte for byte, `no-store`,
    and in the trail; one at a time; **the downloaded export replays into an empty database with
    every fingerprint identical**; the newest three kept and a file by hand left alone; a name not
    listed, or a path, is 404 and not in the trail; the export arrives in batches (1,600 rows in
    one table, at least four pieces, none more than a third of the whole); a server without its
    settings says so and starts nothing; the restore command (legacy's test, ported). Planted bug:
    the scope guarded by `admin` instead of `owner` turned the first red. Reverted.
  - `apps/web/test/backups.test.tsx` (4) and `staff-nav.test.tsx` (the owner sees the line, an
    administrator does not).
  - `apps/web/e2e/owner/backups.spec.ts` (3), in a new last project, `owner`: the owner opens the
    screen from the menu, makes an export, downloads it, reads it, and finds the download in "Who
    changed what"; takes a backup and downloads a real dump (`PGDMP`); an administrator is turned
    away by the page and the server; no request leaves the site.

## Legacy and its equivalents (rows this closes in `docs/parity.md`)

| Parity row                                     | Here                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| §2 `admin.js` GET `/backups` (Missing)         | `GET /api/admin/copies` (owner); `T/copies.test.ts`; `E/owner/backups.spec.ts`           |
| §2 `admin.js` GET `/archive/export` (Missing)  | `POST /api/admin/copies {kind:'export'}` + the download; `T/copies.test.ts`              |
| §2 `admin.js` POST `/archive/import` (Missing) | **Dropped**, with the reason above: an import runs only into a database with no accounts |
| §2 GET/POST `/publication` (Partial)           | Equivalent: the distribution switch; `T/publication-switch.test.ts`                      |
| §4a `publication-selftest` (Partial)           | Equivalent, as above                                                                     |
| §5 `009_publication_switches` (Partial)        | `M/20261020063140_distribution_switch.sql`                                               |
| §6 `admin-settings.js` (distribution Dropped)  | the switch on `/moderate/settings`                                                       |
| P4 "Not done": files staged before a freeze    | `T/files-freeze-drop.test.ts`                                                            |
| I-maps "the threshold protects only if…"       | `board/places.ts`; `T/board-places.test.ts`                                              |

`docs/parity.md` itself is not edited here, so it does not conflict with the other sessions.

## Changes outside Q2's folders (all small, all named in the commit messages)

- `packages/contracts/src/moderation.ts`: `ArchiveState` gains `distribution` and
  `distribution_stored`; `setArchiveSwitch` takes either switch. `apps/api/src/moderation/routes.ts`
  reads and writes it. `apps/web/src/features/moderation/Settings.tsx`: the second switch.
- `packages/contracts/src/filing.ts`: `files_dropped` on Send's answer.
  `apps/api/src/filing/filing.ts` and `routes.ts`: passing the names through.
  `apps/web/src/features/form/FilingForm.tsx`: the receipt names them.
- `packages/contracts/src/anchor.ts` (D2's, the anchor's contract): the copies routes.
- `apps/api/src/jobs/backup.ts`: `runBackup` takes `BackupContext` (the settings it reads), which
  the job runner's context still satisfies. Nothing else in `jobs/` changed.
- `apps/api/src/app.ts`: one registration line, and the backup settings in `AppDeps.config`
  (`server.ts` already passes the whole configuration).
- `apps/web/src/features/identity/AuditPage.tsx`: a download reads "… downloaded …".
  `StaffOnly.tsx`: "the owner" in its refusal. `staff-nav/entries.ts`: one line.
- `apps/web/playwright.config.ts`: the `owner` project, last; `BACKUP_DIR` and `STATE_DIR` for the
  test server, in the system's temporary folder (the server refuses one inside its code).
- Test fixtures that read the archive state: `apps/api/test/db/setup-wizard.test.ts`,
  `moderation-helpers.ts` (the reset puts the downloads back to NULL), `chain-files.test.ts` and
  `board.test.ts` (turn downloads on), `apps/web/test/setup-wizard.test.tsx`,
  `apps/web/test/staff-nav.test.tsx`, `apps/web/test/filing.test.tsx`.
- `apps/api/src/anchor/dev-owner.ts`: a browser-test fixture that hands the owner's seat to a test
  address and back. Refuses in production. Identity's `dev-state.ts` was left alone (it refuses to
  seat an owner on purpose).

## For the other workstreams

- **Q3 (deploy):** the API's unit (`deploy/systemd/reportlog-api.service`) may write only
  `/var/lib/reportlog`. Exports go there (`STATE_DIR/exports`) and work as it is. **Taking a backup
  from the screen writes to `BACKUP_DIR` (`/var/backups/reportlog`)**, so the unit needs
  `ReadWritePaths=/var/lib/reportlog /var/backups/reportlog`, and the server needs `pg_dump`
  (already installed for the backup job) and, for the off-site copy, `age`. Without the line, the
  screen says "… cannot be created" and the nightly job is unaffected. Downloading existing backups
  needs only read access, which `ProtectSystem=strict` allows. Not changed here: `deploy/` is
  Q3's.
- **Q3 (CI):** the browser job now runs `pg_dump` (the owner's backup). GitHub's `ubuntu-24.04`
  image ships PostgreSQL 16's client, which matches the service; if a runner lacks it, add
  `postgresql-client-16` to that job as the database job already does.
- **Q1 (identity):** "Who changed what" now also lists downloads of the whole archive (axis
  `archive`). Two small lines in `AuditPage.tsx` and one in `StaffOnly.tsx`.
- **I (maps):** the board now keeps your thresholds. If the aggregate's rule for which questions
  count changes, `board/places.ts` should change with it.

## Not done, and why

- **Importing from the screen** (legacy had POST `/archive/import`). An import runs only into a
  database with no accounts at all (`importArchive` refuses one with users), and the owner using
  the screen is an account. It stays a command.
- **Coordinator intake and evidence answers** do not drop files staged before a freeze. Decision 17
  names the report's Send; intake seals a coordinator's files when the batch is filed, and an
  evidence answer when it is sent, each through `sealFiles`. If the owner wants the same there, it
  is one check in `sealFiles` for a draft or evidence source, with the outcome each screen shows.
- **The board's search can still find a place's code** (`US-WY` is a string in the answers, and
  the search index covers every string answer). A search for it returns those reports with a
  total. The index is moderation's migration, and the decision named counts, not search; worth a
  decision whether location answers should leave the index.
- **A thin area can still be worked out by subtraction** in the numbers, for a required place
  question with exactly one thin area: the logbook's published total, minus the shown areas, minus
  "not answered", is that area's count. The map has the same property against the board's totals.
  Closing it means withholding a logbook's published total, which the numbers page exists to show.
  A decision for the owner.
- **Each published report still shows its place** on the board, so a reader can count by paging.
  Decision 6 named counts; this is the residual I-maps already stated.
