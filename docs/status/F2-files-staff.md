# Workstream F2 · The files staff screens: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/f2-files-staff`, based on `ccr-c9c93698-ev856l`, merged up to `81a4c77` (C2 and D1 included)
- **Pull request:** [#13](https://github.com/munsdev/reportlog/pull/13), into `ccr-c9c93698-ev856l`
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

After merging the base at `81a4c77` (C2 and D1).

| Suite                                   | Result                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes (format, lint, types, boundaries; unit: api 231, web 407, fields 69, seal 31, access 4) |
| `pnpm test:db`                          | 39 files, 638 tests, all passed (6 are F2's, in `apps/api/test/db/files-staff.test.ts`)        |
| `db:types:check`                        | up to date (no migration)                                                                      |
| Browser suite (`CI=1`, `CHROMIUM_PATH`) | 83 passed, 4 of them F2's (2 tests, each on desktop and phone)                                 |

## What was built

The screens F left as "Not done". All in `apps/web/src/features/files/staff/` and
`apps/web/src/routes/(staff)/files/`.

| Path              | For            | What it does                                                                                           |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `/files`          | moderators     | Reports with files nobody has decided on, oldest first; and finding any report by its reference        |
| `/files/:ref`     | moderators     | One report's files (see, publish, keep unpublished, refuse, open the original) and asking for evidence |
| `/files/settings` | administrators | The site's switch, kinds and limits, each box showing where its number comes from                      |
| `/files/logbooks` | administrators | Each logbook, whether it asks for files; `/files/logbooks/:id` sets its own limits over the site's     |
| `/files/erase`    | administrators | Erasing one file by destroying its key, found by report reference                                      |

Menu: two lines in G2's `entries.ts`, **Files** (`moderator`) and **File settings** (`admin`). Admin
does not imply moderator, as the access package says, so an administrator gets neither the queue nor
the moderator's file view; `/files` tells them it is for moderators.

### How the rules show up on screen

- **Consent is the ceiling.** "Publish…" appears only when the report's sealed `may_publish`, the
  reporter's `attachment_publication` permission and "not withdrawn" all hold. Otherwise the
  button is replaced by the sentence saying which gate is shut and that only the reporter can open
  it. Keeping a file unpublished and refusing it are always offered, and a published file can always
  be taken down (`whyNotPublishable` in `words.ts`, with unit tests for each gate). The server and
  database still decide.
- **One card asks one question.** Every action that needs words goes through `AskDialog`: publishing
  asks for the description, then (after the moderator presses Next) the reason; nothing advances by
  itself. Withdrawing an evidence ask is a dialog with no question, just the second press.
- **Nothing changes underneath.** These queries never refetch on window focus; they are read again
  after the moderator acts.
- **The original is evidence.** "Open the original…" asks why (at least 10 characters) before it
  shows the download link; the server records the opening with the reason, and the record is on the
  file's card.
- **The copy shown is the re-encoded one**, and only when asked ("Show the copy that would be
  published"): photo, video with its still, sound, or a document's pages.
- **Limits: an empty box means "the one underneath"**, which is its placeholder, and every box
  is sent on save so emptying one clears it (legacy's reasoning, kept). Bytes are typed in MB. A
  number out of range is caught in the box's own unit (the bounds mirror `LIMIT_RANGES`; the server
  decides).

## On D1's moderation page (merged in after D1 landed)

D1 had built its own `FilesPanel` and `EvidencePanel` on the report view before these existed. They
asked for the description, the reason and the original's reason on one card, and showed "Publish"
disabled rather than absent. **As a small, stated change in D1's folder**,
`features/moderation/Item.tsx` now renders F2's components in their place, and the two D1 files are
deleted (nothing else imported them, and no test named their words):

```tsx
{
  r.file_count > 0 ? <ReportFiles threadId={r.thread_id} reportPublic={r.public} /> : null;
}
<EvidenceRequests threadId={r.thread_id} />;
```

`reportPublic` keeps D1's note that a published file is shown only while the report's text is
public. After acting, the components refresh the `files-staff`, `moderation` and `board` queries.

**Open question for the coordinator:** D1's moderation routes admit `['moderator', 'admin']`;
F's file and evidence routes admit `['moderator']` only (as the access rule "admin does not imply
moderator" reads). So an administrator on the moderation page sees the server's refusal in the
files and evidence sections. It was the same with D1's panels. Widening F's guard is a policy
choice I have not made.

C3 will reuse the upload components (`FilesCard.tsx`, `uploader.ts`); F2 did not change them.

## API changes (small and missing; named in the commit message)

- **`GET /api/moderate/files`** (`listFileReports`, moderators): reports whose current version has a
  file that is withheld, not erased, and has no decision on its record (`published`, `withheld`,
  `refused`, `taken_down`, `erased`), not withdrawn, oldest first, at most 200. With `?ref=` it is
  that one report, whatever version the reference names and whether or not it has files. A
  deliberate withhold is a decision, so it leaves the queue.
- **`GET /api/admin/files/report/:ref`** (`getReportFilesForErasing`, administrators): a report's
  files by reference, metadata only, so an administrator (who cannot use the moderator routes) can
  pick the one to erase.
- **`getThreadFiles` now carries `withdrawn`.**
- **`publish` refuses a withdrawn report's files** (409 `withdrawn`). Withdrawal already took them
  down through `takeDown`, but nothing stopped a moderator publishing them again. Nothing would have
  served them (the report is not public), but the copy would have sat in the renditions bucket.
- The rows of `getThreadFiles` moved into `currentFiles()` in `routes.ts` so both routes share them.

Tests: `apps/api/test/db/files-staff.test.ts` (queue, a withhold leaving it, lookup by any version's
reference and an unknown one, each route refusing the other role, the withdrawn refusal).

## Tests

- Unit: `apps/web/test/files-staff.test.tsx`, 11 tests: each consent gate, one question per card and
  the body sent, the original's link carrying the reason, evidence refused with the server's sentence
  and with a blank message, the limits form (placeholder, MB to bytes, an empty box sent as a clear,
  out-of-range in the box's unit).
- Browser: `apps/web/e2e/files/staff.spec.ts`. A moderator, in their own browser, goes from the menu
  to the queue, sees the re-encoded photo really load, publishes it through both cards, downloads the
  original after giving a reason and sees "Original opened" on the record, asks for evidence and
  **the email arrives with the evidence link**, then withdraws the ask. An administrator (`ADMIN`)
  sets a logbook's limit, sees the out-of-range refusal, reloads to see it kept and the upload config
  carrying it, and is turned away from `/files`. Both check that no other host is asked.

The moderator test cannot use `ADMIN`'s session, because the moderator routes refuse administrators;
it seats a moderator the way `files/evidence.spec.ts` does.

## Changes outside F2's folders

- `apps/web/src/features/staff-nav/entries.ts` (G2): two menu lines, after D1's.
- `apps/web/src/features/moderation/Item.tsx` (D1): F2's components in place of D1's panels;
  `FilesPanel.tsx` and `EvidencePanel.tsx` deleted.
- `apps/web/test/staff-nav.test.tsx` (G2): its lists of who sees what now include the two lines.
- `apps/api/src/files/routes.ts`, `publication.ts`, `packages/contracts/src/files.ts` (F): above.
- `apps/web/src/routeTree.gen.ts`: regenerated.

## Running it in a cloud container

As G2 noted, the container starts the legacy application on port 3000; stop it before the browser
suite.

## Not done

- A per-logbook limits panel inside the builder (B's screen). `/files/logbooks/:id` does the job; B
  could link to it.
- An access log entry for `viewed_original` on an administrator's screen (D's access log, when it
  exists, should read `attachment_events`).
