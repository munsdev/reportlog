# SB · R3, files: storage, signing, evidence (F4): status

For the coordinating session. Brief: `docs/parity.md` §7, "R3 · Files: storage, signing, evidence
(F4)", with the owner's rulings 19, 31 and 32 (`docs/decisions.md`).

- **Branch:** `claude/sb-storage-evidence`, based on `ccr-c9c93698-ev856l`, merged with it at
  `77bbaf3`
- **Pull request:** see below
- **Last updated:** 2026-10-20

## What was built

- **Virtual-hosted addressing, tested.** The S3 stand-in in `U/files-storage.test.ts` now keys its
  objects by host and path, and a loopback fetch lets the driver ask for `rl-evidence.s3.test`. The
  whole driver contract runs in both addressings.
- **A bucket name that is not one DNS label is refused** with virtual addressing (a dot, a capital,
  an underscore, too short), at start (`storageFrom` gives the sentence) and in `s3Storage`. Path
  style still takes it. A misspelt `S3_ADDRESSING` stops the server (the config's enum; now tested).
- **`files:storage-check`** (split into `api/files/storage-check.ts` and its command):
  - every bucket must refuse a read with no signature, or the check fails ("it must not be
    public"); against moto with a public-read bucket;
  - a setting wrapped in quotes or spaces is named before anything is tried, and its value is never
    printed (two are secrets);
  - the check object is deleted even when a read fails.
- **One migration**, `20261020113100_evidence_and_refused_files.sql`:
  - `evidence_requests_used_together`: `used_at` and `used_report_id` are set together (legacy
    041's CHECK);
  - `refused_uploads`: one row per file sent and not accepted (decision 32). Append-only, no
    foreign key (it is written before the thread's head exists, like `attachment_events`), never
    sealed.
- **Decision 19.** `sealFiles` drops files staged before a freeze for an intake account and an
  evidence answer (`dropFrozenSlots`: refused with decision 17's words, key wiped, bytes queued
  for deletion). A Send already dropped its own, so a submission is not checked again.
  - Intake: the account is filed without them; `files_dropped` per filed account; the batch page
    names them.
  - Evidence: the route drops them before spending the link, and answers 409 naming them; nothing
    is added and the link stays open. `sealFiles` checks again in the transaction, for a freeze
    landing in between.
- **Decision 31.** The file-original route refuses a reason over 500 characters (the contact
  route's `MAX_REASON`), instead of cutting it at 2000. The staff dialog's limit is 500 too.
- **Decision 32.** `sealFiles` writes a `refused_uploads` row for every refused, infected or
  unreadable file of what it seals (a report's confirmation, an intake account, an evidence
  answer), with the words the reporter was shown. The staff files route returns them as `refused`,
  and the report's files panel lists them under "Sent and not accepted".

## Tests

| Test                                          | What                                                          |
| --------------------------------------------- | ------------------------------------------------------------- |
| `U/files-storage.test.ts`                     | virtual-hosted contract, the bucket-name refusal, addressing  |
| `U/deploy-storage-check.test.ts`              | unsigned read refused; a public bucket fails; quoted values   |
| `T/files-freeze-drop-intake-evidence.test.ts` | new: decision 19 for intake and evidence, through the routes  |
| `T/evidence-request.test.ts`                  | the CHECK refuses spent-without-report and the reverse        |
| `T/access-log.test.ts`                        | an over-long reason for the original: 400, nothing recorded   |
| `T/moderation.test.ts` (D's, one test)        | an over-long reason for contact details: 400                  |
| `T/files-outcomes.test.ts`                    | a refused file reaches the moderators; the log is append-only |
| `T/invariants.test.ts`                        | a planted row for `refused_uploads` (the append-only sweep)   |
| `apps/web/test/files-staff.test.tsx`          | `refused` in the mock; the list on the files panel            |

## Results

All three suites, on the branch merged with `77bbaf3`:

- **`pnpm check`:** passes. API unit: 398 passed, 13 skipped (Caddy and the secret scanner are not
  installed here; the moto test ran, with moto 5.0.28 installed for the run). Web: 559 passed.
  Seal: 46. Fields: 69. Access: 6.
- **`pnpm test:db`:** 1098 passed, 74 files. The first run failed 3 tests in
  `T/invariants.test.ts`, because `refused_uploads` had no planted row; fixed.
- **Browser suite** (`CI=1`, `CHROMIUM_PATH`): the second run had 768 passed, 4 skipped, 0 failed.
  The first run had 766 passed and 1 failed, `in-front/in-front.spec.ts` "a reporter without the
  password follows the evidence link…". It failed at line 126, the reporter's permission call,
  before any evidence was sent. It did not fail again on the same code. I did not find a cause;
  its trace was overwritten by the second run.

## Outside R3's folders (small, named in the commit messages)

- `apps/api/src/files/` (shared with R2): `context.ts` (the bucket check at start), `filing.ts` and
  `slots.ts` (the drop and the note in `sealFiles`), `routes.ts` (the reason limit, `refused` on the
  thread route).
- `apps/api/src/filing/intake.ts` (C's): `files_dropped` per filed account.
- `packages/contracts/src/filing.ts`, `files.ts`: `files_dropped`; `refused`.
- `apps/web/src/features/intake/BatchPage.tsx`, `apps/web/src/features/files/staff/ReportFiles.tsx`.
- `deploy/README.md`: the check's new lines and what they mean.
- `docs/parity.md`: five rows to Equivalent, the totals, R0 a, m and n, and R3 marked done.

## Not done, and why

- **The run against the real provider** waits on the owner choosing one. Moto and the stand-in
  are all this was tested against.
- **The intake review does not warn before filing** that a frozen logbook's files will be dropped;
  the result after filing names them. And on a frozen logbook with a required file question, the
  review still asks for a file the coordinator can no longer attach (`fileProblems`, C's), a gap
  that predates this piece.
- **An evidence answer refused for a freeze is noted for moderators only when something from that
  request is later sealed**: the drop happens outside a sealing transaction, so no thread note is
  written then. The reporter is told at once.
