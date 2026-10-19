-- ════════════════════════════════════════════════════════════════════════
-- Filing and confirmation (workstream C).
--
-- What a report needs around it that is NOT sealed: the confirmation link a
-- reporter is emailed, how to reach them (under a key that can be destroyed),
-- what they did to their own report afterwards, the two permissions they can
-- take back, a coordinator's batches of paper accounts, and the switch that
-- stops new reports coming in.
--
-- Nothing here is read into a sealed object, and nothing here changes how an
-- existing report is rebuilt.
-- ════════════════════════════════════════════════════════════════════════

-- ── waiting for the confirmation link ───────────────────────────────────
-- A submission is checked and kept here until the reporter follows the link
-- in their email. Nothing enters `reports` before that, so an address nobody
-- controls never takes a place in a chain.
--
-- The token is a credential, so only its hash is kept. The address is kept in
-- the clear only while the link is unused: at confirmation it moves under the
-- report's own erasable key (contact_keys) and is wiped from here.
--
-- `form_id` is the version of the questions the answers were checked
-- against WHEN THEY WERE SENT, which is the version the reporter was asked.
-- A question added before they click is one they never saw.
CREATE TABLE report_submissions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  logbook_id   bigint NOT NULL REFERENCES logbooks (id),
  form_id      bigint NOT NULL,
  -- The checked answers and the publication answer, exactly as they will be
  -- sealed. Never re-read from a second request.
  payload      jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  email        text CHECK (email IS NULL OR email = lower(btrim(email))),
  expires_at   timestamptz NOT NULL,
  confirmed_at timestamptz,
  thread_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_id, logbook_id) REFERENCES logbook_forms (id, logbook_id),
  -- Confirmed exactly when it produced a thread, and the address is held
  -- here exactly until then.
  CHECK ((confirmed_at IS NULL) = (thread_id IS NULL)),
  CHECK ((confirmed_at IS NULL) = (email IS NOT NULL))
);
CREATE INDEX report_submissions_thread_idx ON report_submissions (thread_id);
CREATE INDEX report_submissions_expiry_idx ON report_submissions (expires_at) WHERE confirmed_at IS NULL;

-- ── how to reach the reporter, under a key that can be destroyed ────────
-- Each thread's contact details are encrypted under a key of their own. The
-- key, wrapped by the deployment's CONTACT_KEY, lives here, and THIS TABLE
-- MAY DELETE: erasing somebody's details is deleting their row. The
-- ciphertext in report_contacts is never touched and can never be read again.
--
-- The keyed digest of the address (how "My reports" finds a person's
-- reports) lives here too, for the same reason: after an erasure nothing
-- links the report to an address.
CREATE TABLE contact_keys (
  thread_id   uuid PRIMARY KEY REFERENCES report_heads (thread_id),
  dek_wrapped bytea NOT NULL,
  -- NULL on a report a coordinator filed: the address on it is the
  -- coordinator's, and a coordinator is not the reporter, so it must not put
  -- the report under their "My reports", where a reporter's permissions are
  -- given and taken back.
  email_hmac  text CHECK (email_hmac IS NULL OR email_hmac ~ '^[a-f0-9]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_keys_email_idx ON contact_keys (email_hmac) WHERE email_hmac IS NOT NULL;

-- A key is made once and destroyed once. Never swapped: a changed key would
-- be a way to make somebody's details read as somebody else's.
CREATE FUNCTION contact_keys_no_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a contact key is never changed, only destroyed';
END;
$$;
CREATE TRIGGER contact_keys_no_update BEFORE UPDATE ON contact_keys
  FOR EACH ROW EXECUTE FUNCTION contact_keys_no_update();

-- The details themselves, encrypted under the thread's key. APPEND-ONLY, so
-- nobody can quietly rewrite whose report it is; erasure never needs to touch
-- it. `filed_by` says whose address it is.
CREATE TABLE report_contacts (
  thread_id        uuid PRIMARY KEY REFERENCES report_heads (thread_id),
  filed_by         text NOT NULL CHECK (filed_by IN ('reporter', 'coordinator')),
  contact_enc      bytea NOT NULL,
  -- Only on a coordinator's filing: the organization they filed through. Its
  -- name is also sealed (filed_via); this is the copy beside the coordinator.
  organization_enc bytea,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((filed_by = 'coordinator') = (organization_enc IS NOT NULL))
);
CREATE TRIGGER report_contacts_append_only BEFORE UPDATE OR DELETE ON report_contacts
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER report_contacts_no_truncate BEFORE TRUNCATE ON report_contacts
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── what a reporter did to their own report ─────────────────────────────
-- A correction's reason, a withdrawal's reason, an erasure. APPEND-ONLY.
-- There is no address column ON PURPOSE: this table cannot forget, so an
-- address written here would outlive the erasure it was meant to honour. The
-- thread already says whose report it is.
CREATE TABLE reporter_actions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id  uuid NOT NULL REFERENCES report_heads (thread_id),
  action     text NOT NULL CHECK (action IN ('correct', 'withdraw', 'erase')),
  report_id  bigint REFERENCES reports (id),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((action = 'correct') = (report_id IS NOT NULL))
);
CREATE INDEX reporter_actions_thread_idx ON reporter_actions (thread_id, id);
CREATE TRIGGER reporter_actions_append_only BEFORE UPDATE OR DELETE ON reporter_actions
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER reporter_actions_no_truncate BEFORE TRUNCATE ON reporter_actions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── the permissions a reporter gives and takes back ─────────────────────
-- NOT PART OF THE RECORD. The publication answer given at filing is sealed
-- (may_publish) because it must never change. These exist to be changed, so
-- they are a log, and the current value is the newest row for a thread and a
-- permission. NO ROWS MEANS NOT GRANTED, so there is no default to get wrong.
--
-- ONLY THE REPORTER. A moderator granting one on somebody's behalf would
-- write the operator's decision under the reporter's name, so the table says
-- so itself rather than trusting every future route to remember.
CREATE TABLE report_permissions_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id  uuid NOT NULL REFERENCES report_heads (thread_id),
  permission text NOT NULL
               CHECK (permission IN ('contact_passing', 'attachment_publication', 'evidence_request')),
  granted    boolean NOT NULL,
  actor      text NOT NULL DEFAULT 'reporter' CHECK (actor = 'reporter'),
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_permissions_log_current
  ON report_permissions_log (thread_id, permission, id DESC);
CREATE TRIGGER report_permissions_log_append_only BEFORE UPDATE OR DELETE ON report_permissions_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER report_permissions_log_no_truncate BEFORE TRUNCATE ON report_permissions_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── a coordinator's batches of accounts collected on paper ──────────────
-- Staged, because typing up a stack of paper forms produces typos. Nothing
-- reaches a chain until the coordinator attests to the batch.
CREATE TABLE intake_batches (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations (id),
  coordinator_id  bigint NOT NULL REFERENCES users (id),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz,
  CHECK ((status = 'submitted') = (submitted_at IS NOT NULL))
);
CREATE INDEX intake_batches_coordinator_idx ON intake_batches (coordinator_id, created_at DESC);

-- One account. Editable and removable while it is staged. Once it has been
-- filed (`report_id`), it is the coordinator's record of where that report
-- came from — who typed it, for which organization, off which paper — and it
-- never changes again. That record is deliberately OUTSIDE the seal.
CREATE TABLE intake_drafts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id   bigint NOT NULL REFERENCES intake_batches (id),
  ordinal    integer NOT NULL CHECK (ordinal >= 1),
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  report_id  bigint UNIQUE REFERENCES reports (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, ordinal)
);

CREATE FUNCTION intake_drafts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.report_id IS NOT NULL THEN
    RAISE EXCEPTION 'a filed account is never changed or removed (draft %)', OLD.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER intake_drafts_guard BEFORE UPDATE OR DELETE ON intake_drafts
  FOR EACH ROW EXECUTE FUNCTION intake_drafts_guard();

-- ── whether the site is taking new reports at all ───────────────────────
-- One row. NULL (or no row) is OPEN: that is what the software does unless
-- an operator said otherwise. Closing it closes both doors that make NEW
-- reports (the form, and a coordinator's batch). It leaves corrections,
-- moderation and everything already filed alone.
CREATE TABLE intake_settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  intake_enabled boolean,
  updated_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
