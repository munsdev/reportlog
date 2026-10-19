# Workstream C2 · What filing left undone: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/c2-filing`, based on `ccr-c9c93698-ev856l` (foundation + A, B, C, E, G, H)
- **Pull request:** into `ccr-c9c93698-ev856l` (linked from the PR itself)
- **State:** finished, waiting for review. Not merged.
- **Last updated:** 2026-10-19

## Checks, as last run before pushing

Against the base at `7898de3` (with D2, G2 and I), merged into this branch.

| Suite                                   | Base alone | With this branch                                                    |
| --------------------------------------- | ---------- | ------------------------------------------------------------------- |
| `pnpm check`                            | passes     | passes (unit tests: api 219, web 394, fields 69, seal 31, access 4) |
| `pnpm test:db`                          | 540        | 570, all passed (35 files)                                          |
| `db:types:check`                        |            | generated types up to date                                          |
| Browser suite (`CHROMIUM_PATH`, `CI=1`) | 74         | 80 passed (3 new tests, desktop and phone)                          |

CI on GitHub had not reported when this was written. Check the pull request.

## What was built, in the order asked

1. **The coordinator intake screens** (`apps/web/src/features/intake/`,
   `apps/web/src/routes/(staff)/intake/`), on C's `/api/intake/` API.
   - `/intake`: your batches, and starting one. With one organization it is chosen for you;
     with several you choose once per batch, never per account.
   - `/intake/:id`: the accounts; each typed up in a dialog (the logbook's questions, how and
     when it was collected, your own reference, and the source's publication answer in the
     coordinators' wording with the server's digest); "Before filing" says what each account
     still needs; "File the ready accounts" asks for the legacy statement to be ticked, says how
     many accounts enter the permanent record and under which name, and files them. Accounts
     not ready stay staged.
   - The door is G2's `OnlyFor` with a new `organization` audience (anybody who coordinates or
     manages an organization, by A's memberships, as the server's `coordinatorOrgs` does), and
     the staff menu has an "Intake" entry for the same audience, so the two cannot disagree.
2. **Correcting a coordinator-filed report**, as designed above:
   `GET`/`POST /api/intake/reports/:threadId[/correct]` (`apps/api/src/filing/intakeCorrection.ts`)
   and `/intake/reports/:threadId`. The mechanics shared with a reporter's correction (lock the
   head, form version, carry the files, append, back to pending) moved into
   `apps/api/src/filing/correction.ts`, unchanged, so the two cannot drift. Migration
   `20261019184609_coordinator_corrections.sql` adds `coordinator_actions` (append-only).
3. **Rotating `CONTACT_KEY`**, as designed above: `CONTACT_KEY_PREVIOUS`, the two-key keyring
   (`contactKeys.ts`), `rotateContactKey.ts`, `reportlog contact-key rotate`, H's check's new
   `rotating` state, two doctor warnings, migration `20261019185427_contact_key_rotation.sql`
   (`contact_key_rotations` and the narrowed guard), and a runbook section in
   `deploy/README.md`. Run for real against the development database through the command line:
   first record, an unplanned change refused (exit 1), a planned one let through, rotate,
   left-over reminder, rotate back.
4. **"My reports" leftovers**: **the signed declaration** is built
   (`/mine/declaration/:threadId`). **Notification settings are left**: see "Not done".

## Tests

| What                                                                                                                                                                                                                                                                                                                                   | Where                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Intake screens, reached from the staff menu: stage, see what is missing, fix, attest and file; a coordinator corrects a filed account; somebody with no organization is refused                                                                                                                                                        | `apps/web/e2e/filing/intake.spec.ts`              |
| Coordinator correction: new version, same thread, pending, files carried, provenance and fresh attestation sealed, coordinator outside the seal, recorded in their log and never the reporter's, never loosening, the absent `collected_on` key, the switch, who may, a rename                                                         | `apps/api/test/db/intake-correction.test.ts`      |
| Rotation on real rows: the guard outside and inside a rotation, the two-key window, a wrong previous key changing nothing, every key re-wrapped, the old key no longer opening anything, **an erased report staying erased with its ciphertext byte for byte**, digests and "My reports" on the new key alone, the record, idempotence | `apps/api/test/db/contact-key-rotation.test.ts`   |
| The deploy check: `rotating` only beside the recorded key, still `changed` otherwise, recording after the rotation                                                                                                                                                                                                                     | `apps/api/test/unit/contact-key-rotation.test.ts` |
| The declaration: the hashes it prints are the verifier's, and follow a correction                                                                                                                                                                                                                                                      | `apps/api/test/db/declaration.test.ts`            |
| The declaration page, and that printing shows only the declaration                                                                                                                                                                                                                                                                     | `apps/web/e2e/filing/declaration.spec.ts`         |

## Decisions made here that a reviewer should know about

- **Only the coordinator who filed an account may correct it**, while still in the
  organization. Every coordinator of the organization is the obvious alternative; it is a
  one-line change in `ownedFiling`, and it is a decision, so it was not made here.
- **A correction seals the organization's name as it is now.** A batch does the same at
  filing; each version says what it was filed through when it was filed. The tests show the old
  version keeps the old name.
- **The coordinator attests again** to each correction, with its own statement.
- **`contact_keys` may now be updated, inside a recorded rotation only** (see the design). This
  is a database guard narrowed on purpose, said in the migration, the commit and here.
- **The recorded key fingerprint is replaced only by `contact-key rotate`**, after its
  transaction commits. If the commit succeeds and recording the file fails, the next deploy
  sees `same`-or-`rotating` and running the command again finishes it (it is idempotent).
- **The declaration's legal words are legacy's, word for word**, including the U.S. statute;
  whether a deployment outside the U.S. wants different words is not decided here.

## Changes outside C's folders (all named in the commit messages)

- `apps/web/src/features/staff-nav/entries.ts` (G2): the `organization` audience and the
  "Intake" entry. Viewers without memberships see exactly what they saw before.
- `apps/api/src/jobs/contact-key.ts`, `cli.ts`, `doctor.ts` (H): the `rotating` state, the
  `contact-key rotate` command, `recordRotated`, two doctor warnings. The refusal of an unplanned
  change is unchanged.
- `deploy/README.md` (H): "Rotating the contact key". `deploy.sh` is not changed.
- `apps/api/src/config.ts`, `apps/api/src/app.ts`, `.env.example`: `CONTACT_KEY_PREVIOUS`.
- `apps/web/src/routes/mine/$threadId.tsx` (C's): the declaration link beside, not inside,
  `MyReportPage`, because `features/form/` is F's to change right now.
- Migrations `20261019184609_coordinator_corrections.sql`,
  `20261019185427_contact_key_rotation.sql`; `schema.gen.ts` and `routeTree.gen.ts` regenerated.

## For the other workstreams

- **D1 (moderation):** a coordinator's correction writes no `reporter_actions` row. Its reason,
  who made it and for which organization are in `coordinator_actions` (by `report_id`). A
  moderator's view of a thread should show both logs.
- **G2 (staff navigation):** `entries.ts` gained an `organization` audience and the "Intake"
  entry (test: `apps/web/test/intake-nav.test.ts`). `OnlyFor` takes it too.
- **H (operations):** `contact-key` in `ExecStartPre` and `deploy.sh` already passes a planned
  rotation, because both read `CONTACT_KEY_PREVIOUS` from the settings file. To make the
  rotation part of a deploy, run `reportlog contact-key rotate` after the switch when
  `CONTACT_KEY_PREVIOUS` is set; the runbook describes doing it by hand. The describe title in
  `test/unit/contact-key.test.ts` ("CONTACT_KEY is never rotated") is now out of date; I left
  your file alone. The message in `deploy.sh` ("differs from the key this archive started
  with") could mention rotation.
- **F (files):** nothing new. A coordinator's correction carries files as a reporter's does
  (`correction.ts`).

## Not done

- **Notification settings** (legacy `GET`/`POST /me/notifications`: how often to hear about
  newly published reports, and from which logbooks). They are read only by the digests, which
  are G2's and being built now, and they were columns on A's `users` table. Built here they
  would be a setting nothing reads, in a table that is not C's; they belong with G2's digests.
- **The moderator access log in "My reports"** (D's, unchanged from C's list).
- **Browser history per card** in the filing form (C's list; the form is F's to change now).
- **Uploads in an intake account.** The account dialog skips the upload question, as the
  reporter's form does until F adds uploads.

## Designs, written before building

### Correcting a coordinator-filed report

C left this impossible on purpose: a coordinator-filed report is not in anybody's "My reports",
because the permissions there are the reporter's and a coordinator giving one would be the
operator deciding under the reporter's name. That stays exactly as it is. The correction is
built as **the coordinator's own act, on the coordinator's own screens** (`/intake`), and
nothing about it touches "My reports", `reporter_actions` or the permissions log.

- **Who.** The coordinator who filed the account (the batch's `coordinator_id`), and only
  while they still file for that organization (`mayFileFor`, asked again at the moment of
  correcting, as `submit` does). The same narrow rule as batches: a coordinator sees their own
  batches only. Widening it to every coordinator of the organization is a one-line change to
  `ownedFiling` if that is wanted; it is a decision, so it is not made here.
- **Found how.** From the thread to its first version, to the `intake_drafts` row that filed it,
  to the batch. Nothing new is stored to link them; the draft row already records it and is
  frozen by its trigger once filed.
- **What is sealed.** A new version in the same thread, through `appendReportVersion`,
  `correctsId` the current head, against the logbook's questions as they are now (a form
  version recorded with `ensureFormVersion`), carrying the previous version's files
  (manifest and `report_attachments`, read from the archive, never the request), exactly as a
  reporter's correction does. The provenance block is sealed again in full:
  `third_party: true`, `filed_via` = **the organization's name as it is now, read inside the
  transaction** (the same rule as a batch: each version says what it was filed through when it
  was filed), `intake_method` and `collected_on` (carried forward from the version being
  corrected unless the coordinator changes them, since a mistyped date is a likely reason to
  correct), and a **new `attested_at`**: the coordinator attests to the correction as they
  attested to the batch, with the same statement, and the route refuses without it.
  `collected_on` stays a conditional key.
- **The publication answer.** The reporter's rule: carried forward with its card digest, may
  be tightened to "no" (the person the coordinator spoke to changed their mind), never
  loosened.
- **The coordinator stays outside the seal.** Nothing about them is in the sealed object. The
  act is recorded in a new append-only table, `coordinator_actions` (thread, the new report,
  the coordinator's user id, the organization's id, the reason, the time). Not in
  `reporter_actions`: that table is what the reporter did, and a correction there would read as
  theirs. The contact row (`report_contacts`, one per thread, append-only) already names this
  coordinator and is not touched.
- **Back to pending.** `report_heads` moves to the new version with `moderation_status =
'pending'`, so nothing reaches the public before a moderator has read the changed words.
- **The intake switch** does not stop it: the switch closes the doors that make NEW reports,
  and leaves corrections alone, as for a reporter.

Checked against every invariant in CLAUDE.md: reports stay append-only (a new row), the chain
link goes through `appendReportVersion`, the absent-key rule holds (`collected_on`, `answers`,
`attachments` conditional), the form version is sealed, nothing is auto-published, no
permission is written, and the coordinator's identity stays outside the seal. **No invariant is
weakened, and no database guard changes for this part.**

### Rotating CONTACT_KEY

What the key does today: it wraps every thread's own key (`contact_keys.dek_wrapped`) and, by a
second HKDF label, keys the digest that finds a reporter's reports (`contact_keys.email_hmac`).
So a rotation has two jobs: re-wrap every live thread key, and re-compute every digest. The
digest is re-computed from the address itself, decrypted from `report_contacts` with the
thread's key; a coordinator's row has no digest and gets none.

**A two-key window, so the site never runs on a key that cannot read its rows:**

1. The operator puts the new key in `CONTACT_KEY` and the old one in `CONTACT_KEY_PREVIOUS`,
   and deploys. H's check lets this through: the recorded fingerprint matches the PREVIOUS key,
   which is what a planned rotation looks like. A different key with no PREVIOUS, or a PREVIOUS
   that is not the recorded key, is still refused, as now.
2. With both keys, the API wraps new threads under the new key and reads a thread key under
   either (AES-GCM's tag says which one fits). "My reports" looks up both digests.
3. `reportlog contact-key rotate` re-wraps, in **one transaction**: every row still under the
   old key is unwrapped, re-wrapped under the new one and checked by unwrapping it again; its
   digest is checked against the old one and re-computed under the new. Rows already under the
   new key (filed during the window) are left. A row neither key opens stops the whole thing,
   and nothing changes. After it commits, it records the new key's fingerprint, so the next
   deploy reads "same".
4. The operator removes `CONTACT_KEY_PREVIOUS`. The doctor says so while it is still set.

**An erased thread stays erased**: it has no `contact_keys` row, the rotation only updates rows
that exist (it never inserts), and its ciphertext in `report_contacts` is never touched.

**A database guard has to change, and this is said here rather than slipped in.** C's
migration forbids any UPDATE of `contact_keys` ("a key is made once and destroyed once"), with
the reason that a swapped key could make somebody's details read as somebody else's. Re-wrapping
is an UPDATE of `dek_wrapped`. The alternative, deleting and re-inserting each row, is already
allowed and would get round the guard rather than keep it, so it is not used. Instead a new
migration replaces the trigger function so that an UPDATE is allowed **only** when:

- the same transaction recorded a rotation in a new append-only table `contact_key_rotations`
  (old and new fingerprints, how many rows, when), so every re-wrap is on the record;
- `thread_id` and `created_at` are unchanged;
- `email_hmac` stays NULL where it was NULL and non-NULL where it was not, so a coordinator's
  filing can never gain a digest and come to sit under anybody's "My reports".

Everything else is refused as before. What the database cannot check is that the new wrap holds
the same thread key; the rotation checks that itself before it commits.
