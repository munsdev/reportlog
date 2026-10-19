# P4 (B2) · Builder controls and the file freeze: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/p4-builder-freeze`, based on `ccr-c9c93698-ev856l`, merged up to `9771872` (A2
  and C3 included)
- **Pull request:** [#21](https://github.com/munsdev/reportlog/pull/21), into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

After merging the base at `9771872`.

| Suite                                   | Result                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes (format, lint, types, boundaries; unit: api 282, web 430, fields 69, seal 31, access 6) |
| `pnpm test:db`                          | 53 files, 821 tests, all passed (19 are P4's, in two new files)                                |
| `db:types:check`                        | up to date                                                                                     |
| Browser suite (`CI=1`, `CHROMIUM_PATH`) | 130 passed, twice in a row (6 are P4's: 3 tests, each on desktop and phone)                    |

Two earlier runs were red, and both are recorded here:

- **`pnpm test:db`, once:** `filing-doors.test.ts` failed because a P4 test left launched logbooks
  open outside the password in the shared test database. That opens the filing calls for the
  whole site. Fixed: those P4 tests use drafts, which the doors never count, and put the
  setting back.
- **Browser suite, twice:**
  - Run 1: deleting a draft made from a starting point failed. This was **a real bug in this
    branch**, below.
  - Run 2: P4's own test picked the second question's kind before the first add had finished
    (fixed). In the same run, **`e2e/filing/declaration.spec.ts` failed once.** That test is not
    this branch's. It reads the heading's `textContent` straight after a click, without waiting,
    and got "My reports". It passed in the other three full runs. For workstream C: wait for the
    heading to show the reference before reading it.

## What was built

### The file freeze

- **Migration** `20261019204508_files_freeze.sql`:
  - adds `logbooks.files_frozen_at timestamptz`, nullable and never sealed (`sealedReportRows`
    selects named columns, and nothing reads this one into a sealed object);
  - adds a trigger, `upload_slots_not_frozen`, that refuses any new `upload_slots` row for a frozen
    logbook. It covers a reporter filing and one answering an evidence request.
- **Module** `setFilesFrozen` in `apps/api/src/logbooks/logbooks.ts`:
  - takes the logbook's row lock;
  - freezing a frozen logbook keeps the first time;
  - **not behind `assertDraft`.** It is not a question, so it is allowed before and after launch,
    both ways;
  - the one-way door is untouched: the trigger on `logbook_fields` never fires, and a test checks
    that a launched logbook's questions are identical after freezing and unfreezing.
- **Route** `POST /api/admin/logbooks/:id/files/freeze` `{ frozen }`. It sits in the builder's staff
  scope, so it has the scope's `roleGuard(['admin'])`.
- **Read:** `LogbookSummary` now carries `files_frozen_at` and `outside_access`.
- **`apps/api/src/files/slots.ts`** (a minimal, stated change in F's folder):
  - a `filesFrozen(db, logbookId)` helper;
  - one refusal in `createUploadSlot`: 409 `files_frozen`, "This logbook is not taking files at
    the moment. You can still send your report without them." Answering an evidence request gets
    its own wording.
- **`apps/api/src/files/routes.ts`** (one change in F's folder): `uploadConfig` answers
  `enabled: false` for a frozen logbook. The filing form already skips its files step on that.
  The evidence page already hides its uploader on that.
- **A frozen logbook still takes reports.** Tested by sending one through the real routes and
  confirming it. Tested too: a report filed before the freeze has the same `canonical_json`, and
  still verifies, after it.

### Builder controls (`apps/web/src/features/builder/Switches.tsx`)

On a logbook (`/logbooks/:id`):

- **Files.** Shown only where the logbook asks for files, or is already frozen.
  - "Freeze uploads…" asks on a card of its own. Nothing is sent until the second press.
  - "Take the freeze off" is one press.
  - It links to F2's per-logbook upload limits (`/files/logbooks/:id`).
- **Without the site password.** Closed, link or door, on A's existing
  `POST /api/access/doors/logbooks/:slug`, which also writes A's audit row. Each choice says in plain
  words who it lets in. A draft is told it applies once launched.

On the list (`/logbooks`):

- **New reports, across the site.** C's existing intake switch (`/api/admin/intake-switch`).
  - Closing the whole site asks first.
  - Opening it again is one press.
  - It says when nobody has set it.

The list also says "files frozen" on a frozen logbook's tile.

### The editorial-notes switch in the logbook file

- `toFile` writes `"editorial_notes": true` only when D's switch is on. A file from a logbook
  without notes has exactly the keys it had before.
- `createFromFile` turns D's switch on when the file says `true`. It goes through
  `setNotesEnabled` in `apps/api/src/moderation/notes.ts`, inside the import's transaction.
  `set_by` is the administrator who uploaded the file, passed from both routes.
- `false` is read as off and writes no row.
- Anything other than true or false is refused with a sentence.
- **Starting points that say `editorial_notes: true` now turn notes on**, as they did in legacy:
  safety log, elections and professional complaint. Workplace says `false`.
- **Bug found and fixed here:** `logbook_editorial_notes` has no `ON DELETE CASCADE`. So once a
  draft could get a notes row from a file, deleting that draft was refused by the foreign key.
  `deleteDraft` now deletes the draft's switch first. That row is a setting, and a draft has no
  reports, so it has no notes. A database test now covers it, and fails without the fix.

## Tests

| File                                             | What it checks                                                                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/test/db/logbook-freeze.test.ts`        | 10 tests: admin only (401, 403, 404); the time and its idempotence; the slot refusal, directly and over HTTP; the upload config; the trigger; filing while frozen; the seal unchanged; draft and launch; the one-way door untouched   |
| `apps/api/test/db/logbook-file-switches.test.ts` | 9 tests: the legacy `editorial-notes-selftest` file round trip, check for check; false; a bad value; starting points; deleting a draft with notes; the builder reading `outside_access` and the freeze, and neither entering the file |
| `apps/web/test/builder-switches.test.tsx`        | 7 tests: each panel asks first where it should, sends nothing before the second press, and sends exactly the contract's body to its route                                                                                             |
| `apps/web/e2e/builder-switches.spec.ts`          | Freezing and unfreezing a launched logbook (and the upload config following it); `outside_access` saved and shown after a reload, then put back; the intake panel (read only, because it is site-wide); no third-party requests       |

## Parity rows this closes (`docs/parity.md`)

`docs/parity.md` is not edited here, so it does not conflict with the other P-sessions. These rows
can now read Equivalent:

- **Routes:** `POST /:id/files/freeze` is now `POST /api/admin/logbooks/:id/files/freeze`
  (`T/logbook-freeze.test.ts`).
- **Self-tests:** the logbook-file half of `editorial-notes-selftest` is ported in
  `T/logbook-file-switches.test.ts`. `editorial-notes.test.ts`'s header still says "Not ported".
  That file is D's, so it is left alone.
- **Migrations:** 032's `files_frozen_at` is ported in `M/20261019204508_files_freeze.sql`.
- **Screens:**
  - `logbook-builder.js`: there are now controls for `outside_access` and the intake switch. Upload
    limits are F2's screen, linked from the builder.
  - `admin-settings.js`: the intake switch has a screen now (on `/logbooks`). The attachments
    switch and limits are F2's.

## Changes from legacy (deliberate)

- **The freeze refuses evidence-request uploads too.** Legacy's `takesFiles` was checked only on the
  filing path. The brief here was "no new upload slot", and a protective handle that left one
  door open would not be one.
- **A database trigger backs the freeze.** Legacy had only the application check.
- **`editorial_notes` that is not a boolean is refused.** Legacy ignored it.

## Not done

- **Files staged before a freeze still go with a report sent after it.** Legacy dropped the draft
  token at Send when the logbook was frozen. Here the freeze stops new slots only, as the brief
  asked. Dropping staged files at Send or confirmation would be a change in C's and F's filing
  path. It needs a decision on what the reporter is told.
- **The public `GET /api/logbooks/:slug` still says only `asks_for_files`.** Whether files are
  taken right now is answered by `GET /api/uploads/config`, which the form already reads.
- **The intake switch's browser test only reads it.** Closing the whole site during a parallel run
  would fail other sessions' filing tests. Closing and reopening are covered by the web unit test
  (against the contract) and by C's `T/intake.test.ts` (the server).

## Changes outside B's folders (all small, all in the commit messages)

- `apps/api/src/files/slots.ts`: `filesFrozen` and the refusal.
- `apps/api/src/files/routes.ts`: `uploadConfig` reports a frozen logbook as not taking files.
- `apps/api/migrations/20261019204508_files_freeze.sql` (new), and `schema.gen.ts` regenerated.
- `apps/api/src/logbooks/logbookFile.ts` imports `notesEnabled` and `setNotesEnabled` from
  `apps/api/src/moderation/notes.ts`. Nothing in moderation changed. No import cycle: `notes.ts`
  imports nothing of the logbooks.
- `packages/contracts/src/logbooks.ts` (B's own contract): `files_frozen_at`, `outside_access`,
  `editorial_notes`, and the freeze route.
