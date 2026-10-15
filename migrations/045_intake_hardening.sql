-- Intake hardening: who staged a file, and when it may be worked on.
--
-- ADDITIVE, like every migration here. Two nullable columns on
-- `upload_slots` and two indexes. Nothing that hashes is touched: a staged
-- upload's fingerprint is its bytes, and neither column reaches
-- src/reportCore.js or src/verify.js. Every slot that exists today keeps
-- working — see the back-fill note at the bottom, which is deliberately
-- NOT a back-fill.
--
-- ---------------------------------------------------------------
-- contact_hmac — WHOSE STAGING THIS IS
-- ---------------------------------------------------------------
--
-- The quota in createUploadSlot has always been per DRAFT TOKEN, and a
-- draft token is free: POST /api/uploads/draft mints one to anybody who
-- asks, because attaching a photo must never require an account. So the
-- quota bounded one draft and not one person, and the ceiling on what a
-- single caller could park in the staging bucket was however many drafts
-- they cared to open.
--
-- Keying it on the address the reporter gave instead gives the quota
-- something that costs an attacker a little to vary, and it is only
-- possible because the email card now comes BEFORE the upload card on a
-- logbook that takes files.
--
-- IT IS AN HMAC, NEVER THE ADDRESS. src/crypto.js hmacEmail, the same
-- keyed digest `contact_keys.contact_email_hmac` uses, so a staging row
-- never holds a reachable address. It is not the report's contact key and
-- must not be used as one: this is a rate-limiting bucket that expires
-- with the slot, and `contact_keys` is the erasable record of how to reach
-- somebody.
--
-- WHAT IT IS NOT: proof of anything. The address is unverified at this
-- point — the whole purpose of the confirmation link is that nobody has
-- proved it yet. This raises the cost of parking bytes; it does not
-- authenticate a reporter, and nothing may ever read it as though it did.
BEGIN;

ALTER TABLE upload_slots ADD COLUMN IF NOT EXISTS contact_hmac text;

COMMENT ON COLUMN upload_slots.contact_hmac IS
  'Keyed digest (src/crypto.js hmacEmail) of the unverified address given on the form, used ONLY to key the staging quota across drafts. Never an identity, never a way to reach anybody, and not the report''s contact key — that is contact_keys. NULL on a slot staged through an evidence-request link, which is authorised by the link instead.';

-- Partial, because the quota query only ever asks about rows that have one.
CREATE INDEX IF NOT EXISTS upload_slots_contact_hmac_idx
  ON upload_slots (contact_hmac) WHERE contact_hmac IS NOT NULL;

-- ---------------------------------------------------------------
-- released_at — WHEN THE WORKER MAY TOUCH IT
-- ---------------------------------------------------------------
--
-- The media worker used to pick up every slot the moment the browser said
-- its PUT had finished. That is why the form had a Ready gate: a reporter
-- could not send until every file said Ready, because the manifest sealed
-- at confirmation only takes `clean` slots. So re-encoding a phone video
-- happened WHILE somebody sat on the last card waiting for it.
--
-- Now the work is deferred until the reporter has actually pressed Send,
-- and the gate is gone. Two things follow, and they are the reason this is
-- one change rather than two (docs/specs/editorial-and-evidence.md item 7):
--
--   - Nothing is transcoded for a draft that is abandoned, which is most
--     of the CPU this box was spending on intake.
--   - The gate can go, because there is nothing left to wait for on the
--     form. The window that was in front of the reporter is now behind
--     them, between Send and the click in their mail.
--
-- A SLOT WITH NO `released_at` IS NEVER WORKED ON. That is a deliberate
-- fail-closed: a bug that forgets to release leaves files unprocessed and
-- visible as such, rather than processing files for submissions that were
-- never sent.
--
-- An evidence-request slot is released at CREATION, keeping that path
-- exactly as it was. The reporter there came through a scoped one-time
-- link, there is no unconfirmed draft to defend against, and its submit
-- step hands the files over in the same request — so there is no later
-- moment to release in.
ALTER TABLE upload_slots ADD COLUMN IF NOT EXISTS released_at timestamptz;

COMMENT ON COLUMN upload_slots.released_at IS
  'When this staged upload became work the media worker may do: set when the reporter presses Send during filing, or at creation for an evidence-request slot. NULL means never processed, on purpose — the worker''s WHERE requires it.';

-- The worker's claim query, which asks for released work in id order.
CREATE INDEX IF NOT EXISTS upload_slots_released_idx
  ON upload_slots (status, id) WHERE released_at IS NOT NULL;

-- ---------------------------------------------------------------
-- NO BACK-FILL, AND WHY NOT
-- ---------------------------------------------------------------
--
-- Every slot in flight when this migration runs has `released_at` NULL and
-- will therefore never be processed. That is the correct outcome and it was
-- considered rather than overlooked:
--
--   - A slot belonging to a submission that was already sent is a report
--     waiting on files. Releasing all of them would also release the
--     abandoned drafts, which is the thing this column exists to stop, and
--     `upload_slots` has no record of which submissions were sent — the
--     draft token lives in `report_submission_tokens.payload`.
--   - The window is 24 hours wide (SLOT_TTL_MS), it is a deploy, and the
--     affected reporter is told at confirmation which files did not make
--     it, by name and reason, which is machinery that already exists.
--
-- Releasing the handful that belong to live submission tokens would be a
-- correct back-fill and is one UPDATE joining through `payload->>'draft_token'`.
-- It is left out because a deployment with reports in flight at this exact
-- minute should decide that for itself, and INSTALL.md says so.

COMMIT;
