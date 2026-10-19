# Workstream C2 · What filing left undone: status

For the coordinating session and the other workstreams. One file per workstream in `docs/status/`.

- **Branch:** `claude/c2-filing`, based on `ccr-c9c93698-ev856l` (foundation + A, B, C, E, G, H)
- **State:** in progress.
- **Last updated:** 2026-10-19

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

## Not done

- Everything below this line is written as each part lands.
