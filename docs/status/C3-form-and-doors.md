# Workstream C3 · The form's history, intake files, list times, the doors: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/c3-form-and-doors`, based on `ccr-c9c93698-ev856l` at `221cb83` (with F2), merged in
- **Pull request:** into `ccr-c9c93698-ev856l` (linked from the PR itself)
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

| Suite                                   | Result                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm check`                            | passes (format, lint, types, boundaries; unit: api 251, web 413, fields 69, seal 31, access 4) |
| `pnpm test:db`                          | 49 files, 761 tests, all passed (7 are C3's, in `apps/api/test/db/intake-files.test.ts`)       |
| Browser suite (`CI=1`, `CHROMIUM_PATH`) | 117 passed (11 are C3's: 7 door tests, and 2 tests each on desktop and phone)                  |

CI on GitHub had not reported when this was written. Check the pull request.

## What was built, in the order asked

1. **Browser history per card** (`apps/web/src/features/form/cardHistory.ts`, `FilingForm.tsx`).
   Each card is an entry in the router's history, so the browser's Back goes back one question,
   as in legacy. Every entry is the **same address, query kept**; only the entry's state names the
   card, so an address can never open a question with none of the answers before it. An entry
   left from before a reload starts the form again. A card the answers no longer ask gives way to
   the one before it. The page's Back button is the browser's, so after "Change" it returns to the
   review, as legacy's did. Choosing an answer still moves nothing; Next does.
   - **On a door this needed the gate to change.** The door's blocker refused every navigation,
     including a move between entries of the same address, so neither Back worked there. It now
     lets through exactly that and still blocks everything else (`gate.tsx`, A's; the browser
     test fails with the old blocker).
2. **Uploads in an intake account** (`apps/api/src/filing/intakeFiles.ts`,
   `apps/web/src/features/intake/AccountFiles.tsx`). Legacy intake took no files, so there was no
   server path; the db test shows it. The account dialog asks the logbook's upload question. Files
   go through F's slot, limits, encryption and worker, and are sealed by `sealFiles` in the batch's
   transaction, linked to exactly that version. What differs from a reporter's upload:
   - the owner is the **account**: a draft hash derived from its id under its own label, which no
     draft token reaches. Every route asks whether the account is this coordinator's, and whether
     they still file for its organization;
   - **no per-address quota** (one coordinator stages many people's accounts, signed in);
   - **released at once**, so files are ready by the review;
   - **kept 30 days** (`INTAKE_FILE_DAYS`), not a confirmation link's one.

   "Before filing" holds an account back, naming the file, while one is still being prepared, did
   not finish sending, was not accepted, ran out of time, or was attached for another logbook. A
   required upload question needs a file. Removing an account withdraws its files. **No file is
   ever quietly left out** of an account.

3. **Opening times in the list editor** (`ListEditor.tsx`): "Opens" and "Closes", optional, in
   the operator's own clock, sent as UTC. Only a box that differs from what is saved is sent, so
   saving other settings never moves a time. The lede says when it opens, that it closed, or that
   it was closed by hand. The server's refusal (open before close) is shown as it is.
4. **Browser tests with the password on** (`apps/web/e2e/doors/doors.spec.ts`, its own project
   `doors-behind-password`, last and alone):
   - list door: the password page and `/api/doors` offer it (and not a list kept behind the
     password); it opens and takes an entry; a list not opened outside is the password screen and
     answers `locked`; hiding it closes the door;
   - logbook door: filing only. The form works, Back included; the page makes only the filing
     calls and contacts no other host; every other address typed (`/`, `/board`, `/mine`,
     `/lists`, `/intake`, an unknown logbook) is the password screen, and every other call answers
     `locked`; a logbook closed while somebody fills it in sends them to the password screen at
     Send.

## Tests

| What                                                                                                                                             | Where                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Back and Forward per card, answers kept; Back after Change; a card no longer asked; a stale entry                                                | `apps/web/test/filing.test.tsx` (4 new)     |
| The door's blocker: another address refused, the same address let through                                                                        | `apps/web/test/gate.test.tsx` (changed)     |
| Intake files: staged against the account, who may reach it, refusals, removal, waiting, sealing, refused files, required question, wrong logbook | `apps/api/test/db/intake-files.test.ts` (7) |
| A coordinator attaches a photo in the dialog, it is prepared, filed and sealed; no other host                                                    | `apps/web/e2e/filing/intake-files.spec.ts`  |
| Opening times on the editor screen, read by a visitor                                                                                            | `apps/web/e2e/lists-schedule.spec.ts`       |
| The doors, with the password on                                                                                                                  | `apps/web/e2e/doors/doors.spec.ts` (7)      |

Each new test was checked to fail with the thing it tests removed (the history, the manifest in
the batch transaction, the gate change).

## Changes outside C3's folders (all named in the commit messages)

- **A** `apps/web/src/features/identity/gate.tsx`: the door blocker lets through same-address
  entries; `apps/web/test/gate.test.tsx` checks both sides.
- **F** `apps/api/src/files/slots.ts`: `Source` may name a draft; a slot request may say
  `coordinator` (no address, no quota, released at once). `apps/api/src/files/filing.ts`:
  `sealFiles` takes that `Source`. No migration.
- **C/C2** `apps/api/src/filing/intake.ts`, `routes.ts`, new `intakeFiles.ts`;
  `packages/contracts/src/filing.ts` (the three intake-file routes and `INTAKE_FILE_PATH`);
  `apps/web/src/features/intake/AccountDialog.tsx` and new `AccountFiles.tsx`.
- **E** `apps/web/src/features/lists/ListEditor.tsx`: the opening times.
- **Shared** `apps/web/playwright.config.ts`: the `doors-behind-password` project, and `doors/`
  left out of the desktop and phone projects.
- `apps/web/src/routes/file/$slug.tsx`: passes the router's history to the form.

## Decisions a reviewer should know about

- **F2's `FilePicker` is not used in the account dialog**, only because its last sentence tells a
  reporter "Nothing is filed until you confirm from your email", which is wrong for a coordinator.
  The uploader, `FileList` and `refusalFor` are F2's, unchanged. **For F2:** an optional prop for
  that sentence would let `AccountFiles` use the picker itself.
- **Intake files are kept 30 days.** A batch can stay staged longer; then the review says the file
  has gone and asks for it again. A number, not a principle; easy to change.
- **The page's Back is the browser's Back.** After "Change" from the review it returns to the
  review rather than to the previous question, as legacy did.
- **Leaving the form through the browser's Back from the first card** goes to the previous page
  without a warning, as before this branch (the existing warning covers leaving the site).

## Not done

- A warning when the browser's Back leaves the form from its first card with answers typed.
- Correcting a coordinator-filed report does not offer **adding** files; it carries the previous
  version's files, as before.
- Upload of an intake file uses no resumable upload; a dropped connection means attaching again
  (F's limit, unchanged).
