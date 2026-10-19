-- ════════════════════════════════════════════════════════════════════════
-- Files and evidence (workstream F).
--
-- What a report's files need around them that is NOT sealed. The sealed half
-- is in the core migration: `attachments` (what each file IS: its digest,
-- size and type, append-only) and `report_attachments` (which versions commit
-- to which files). Everything here is what we have DECIDED about a file, or
-- the machinery that gets bytes from a reporter's browser to the evidence
-- store, and none of it is read into a sealed object.
--
--   file_settings        the deployment's switch, kinds and limits (one row)
--   logbook_file_limits  a logbook's own kinds and limits, narrower
--   evidence_requests    a moderator asking for what a reporter declared
--   upload_slots         a file between the browser and a report
--   attachment_heads     the mutable half of a filed file: its key, its
--                        publication, its public copy
--   attachment_events    who did what to a file, append-only
--   storage_deletions    objects that must go, written in the same
--                        transaction as the decision that removed them
--
-- ONE KEY PER FILE. Every file is encrypted under a key of its own from the
-- moment its bytes arrive. Destroying that key (attachment_heads.dek_wrapped)
-- erases exactly that file, everywhere it is stored, while its digest stays in
-- the chain: an erasure that never looks like tampering.
--
-- Ported from legacy migrations 003, 032, 033, 037, 038, 041, 042, 043, 045.
-- ════════════════════════════════════════════════════════════════════════

-- ── the limits, at two layers ───────────────────────────────────────────
-- Every limit is something an operator sets, per site and per logbook, and
-- NULL at a layer means "this layer says nothing": the logbook defers to the
-- site, the site to what the software ships with. The bounds are where
-- something else breaks, and LIMIT_RANGES in apps/api/src/files/limits.ts
-- states them again. A test asks this table to accept each bound and refuse
-- one past it, so the two cannot drift.
--
-- NO LIMIT MAY BE ZERO. A limit of zero is an upload question nobody can
-- answer. Taking no files is `attachments_enabled = false`, or not asking.
CREATE TABLE file_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Tri-state. true and false are an administrator's decision; NULL means
  -- they have not made one and the deployment's environment answers.
  attachments_enabled boolean,
  -- NULL is every kind the code handles; '{}' is none. Different answers.
  attachment_kinds    text[] CHECK (attachment_kinds <@ ARRAY['photo', 'video', 'audio', 'document']),
  max_image_bytes     bigint CHECK (max_image_bytes BETWEEN 65536 AND 2147483648),
  max_video_bytes     bigint CHECK (max_video_bytes BETWEEN 65536 AND 2147483648),
  max_audio_bytes     bigint CHECK (max_audio_bytes BETWEEN 65536 AND 2147483648),
  max_document_bytes  bigint CHECK (max_document_bytes BETWEEN 65536 AND 2147483648),
  max_video_seconds   integer CHECK (max_video_seconds BETWEEN 5 AND 3600),
  max_document_pages  integer CHECK (max_document_pages BETWEEN 1 AND 1000),
  max_files           integer CHECK (max_files BETWEEN 1 AND 50),
  max_total_bytes     bigint CHECK (max_total_bytes BETWEEN 1048576 AND 2147483648),
  updated_by          text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO file_settings (id) VALUES (true);

-- A logbook's own. Its own table rather than columns on `logbooks`, which is
-- the core's. Limits are not questions, so they may change after launch: a
-- cap that could only be set before launch could never be corrected.
CREATE TABLE logbook_file_limits (
  logbook_id          bigint PRIMARY KEY REFERENCES logbooks (id) ON DELETE CASCADE,
  -- A logbook's kinds INTERSECT the site's: the site list is a ceiling.
  attachment_kinds    text[] CHECK (attachment_kinds <@ ARRAY['photo', 'video', 'audio', 'document']),
  max_image_bytes     bigint CHECK (max_image_bytes BETWEEN 65536 AND 2147483648),
  max_video_bytes     bigint CHECK (max_video_bytes BETWEEN 65536 AND 2147483648),
  max_audio_bytes     bigint CHECK (max_audio_bytes BETWEEN 65536 AND 2147483648),
  max_document_bytes  bigint CHECK (max_document_bytes BETWEEN 65536 AND 2147483648),
  max_video_seconds   integer CHECK (max_video_seconds BETWEEN 5 AND 3600),
  max_document_pages  integer CHECK (max_document_pages BETWEEN 1 AND 1000),
  max_files           integer CHECK (max_files BETWEEN 1 AND 50),
  max_total_bytes     bigint CHECK (max_total_bytes BETWEEN 1048576 AND 2147483648),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── asking a reporter for what they said they had ───────────────────────
-- Only when they DECLARED something (a sealed answer) and GRANTED the
-- evidence_request permission (revocable, read at every use). The token is a
-- credential, so only its hash is kept.
CREATE TABLE evidence_requests (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id      uuid NOT NULL REFERENCES report_heads (thread_id),
  asked_by       text NOT NULL,
  message        text NOT NULL CHECK (length(btrim(message)) BETWEEN 10 AND 2000),
  token_hash     text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  asked_at       timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  -- The version the files LANDED on, once they have.
  used_report_id bigint REFERENCES reports (id),
  cancelled_at   timestamptz,
  cancelled_by   text,
  -- Stamped when an ask is noticed to have run out. An index predicate cannot
  -- read the clock, so without a stamp the first ask to age out would block
  -- every later one (legacy 043).
  expired_at     timestamptz,
  CHECK (used_at IS NULL OR cancelled_at IS NULL),
  CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL))
);
-- ONE LIVE ASK PER REPORT. Two open links are two ways to spend one ask, and a
-- reporter holding two emails cannot tell which is current.
CREATE UNIQUE INDEX evidence_requests_one_live
  ON evidence_requests (thread_id)
  WHERE used_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL;

-- ── a file on its way to a report ───────────────────────────────────────
-- A slot is made before the bytes arrive and lives until its file reaches a
-- report (promoted_at) or is refused, withdrawn or abandoned.
--
-- Authorised by a DRAFT (filing: a server-issued token the browser holds, kept
-- here only as a hash) or by an EVIDENCE REQUEST (the link's own token, which
-- the route checks). Exactly one of the two.
--
-- The key in `dek_wrapped` is the file's own, made when the bytes arrived, so
-- staging never holds plaintext. When the file reaches a report the key MOVES
-- to attachment_heads and is wiped here: two copies of a key would make
-- destroying one of them a promise rather than a fact.
CREATE TABLE upload_slots (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot_token           text NOT NULL UNIQUE CHECK (slot_token ~ '^[a-f0-9]{48}$'),
  draft_hash           text CHECK (draft_hash ~ '^[a-f0-9]{64}$'),
  evidence_request_id  bigint REFERENCES evidence_requests (id),
  -- The first slot in a draft fixes the logbook and its limits.
  logbook_id           bigint NOT NULL REFERENCES logbooks (id),
  -- Set when the reporter presses Send: the submission these files belong to.
  submission_id        bigint REFERENCES report_submissions (id),
  declared_name        text NOT NULL DEFAULT '' CHECK (length(declared_name) <= 255),
  declared_type        text NOT NULL,
  declared_size        bigint NOT NULL CHECK (declared_size > 0),
  staging_key          text NOT NULL UNIQUE,
  -- A keyed digest of the address the form collected, for the staging quota
  -- and nothing else. Wiped when the file reaches a report, so nothing here
  -- links a report to an address after the reporter's details are erased.
  contact_hmac         text CHECK (contact_hmac ~ '^[a-f0-9]{64}$'),
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'uploaded', 'processing', 'clean',
                                           'rejected', 'unreadable', 'infected',
                                           'withdrawn', 'expired')),
  status_detail        text,
  -- Nothing is worked on before Send: the worker claims released slots only.
  released_at          timestamptz,
  claimed_at           timestamptz,
  expires_at           timestamptz NOT NULL,
  promoted_at          timestamptz,
  dek_wrapped          bytea,
  -- What the worker found, from the bytes rather than from the browser.
  media_type           text,
  byte_size            bigint,
  sha256               text CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_key          text,
  meta_enc             bytea,
  rendition_media_type text,
  duration_seconds     numeric(9, 2),
  has_poster           boolean NOT NULL DEFAULT false,
  page_count           integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((draft_hash IS NULL) <> (evidence_request_id IS NULL)),
  CHECK (status <> 'clean' OR promoted_at IS NOT NULL OR (
    sha256 IS NOT NULL AND storage_key IS NOT NULL AND media_type IS NOT NULL
    AND byte_size IS NOT NULL AND rendition_media_type IS NOT NULL AND dek_wrapped IS NOT NULL)),
  -- A promoted slot keeps no key and no address.
  CHECK (promoted_at IS NULL OR (dek_wrapped IS NULL AND meta_enc IS NULL AND contact_hmac IS NULL))
);
CREATE INDEX upload_slots_draft_idx ON upload_slots (draft_hash) WHERE draft_hash IS NOT NULL;
CREATE INDEX upload_slots_request_idx ON upload_slots (evidence_request_id) WHERE evidence_request_id IS NOT NULL;
CREATE INDEX upload_slots_submission_idx ON upload_slots (submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX upload_slots_quota_idx ON upload_slots (contact_hmac) WHERE promoted_at IS NULL;
CREATE INDEX upload_slots_work_idx ON upload_slots (id) WHERE status = 'uploaded' AND released_at IS NOT NULL;

-- ── the mutable half of a filed file ────────────────────────────────────
-- `attachments` (core) is what the file IS and is append-only. This is what
-- we have decided about it, and its key, which has to be destroyable: a key
-- in an append-only table could never be erased.
CREATE TABLE attachment_heads (
  attachment_id        bigint PRIMARY KEY REFERENCES attachments (id),
  thread_id            uuid NOT NULL,
  -- As the reporter's device named it. Shown to moderators, never published,
  -- and gone with the key: a file name can say a lot about a person.
  original_name        text,
  publication          text NOT NULL DEFAULT 'withheld'
                         CHECK (publication IN ('withheld', 'published', 'refused')),
  -- Required to publish: for people who cannot see the file, and as proof
  -- somebody looked at it.
  alt_text             text,
  -- The public copy's object key. Present exactly while it is published.
  rendition_key        text UNIQUE,
  rendition_media_type text NOT NULL,
  duration_seconds     numeric(9, 2),
  has_poster           boolean NOT NULL DEFAULT false,
  page_count           integer,
  dek_wrapped          bytea,
  meta_enc             bytea,
  dek_destroyed_at     timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((dek_wrapped IS NULL) = (dek_destroyed_at IS NOT NULL)),
  CHECK (dek_destroyed_at IS NULL OR (meta_enc IS NULL AND original_name IS NULL)),
  CHECK ((publication = 'published') = (rendition_key IS NOT NULL)),
  CHECK (publication <> 'published' OR (alt_text IS NOT NULL AND dek_wrapped IS NOT NULL))
);
CREATE INDEX attachment_heads_thread_idx ON attachment_heads (thread_id);

-- CONSENT IS THE CEILING, MODERATION IS THE FLOOR. A file is published only
-- while the reporter's attachment_publication permission is granted (the
-- newest row of their log) and the report's own sealed answer allows
-- publishing. Read here, at the moment of publishing, so no path that forgets
-- to ask can publish anyway. And a key, once destroyed, never comes back.
CREATE FUNCTION attachment_heads_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  granted boolean;
  allowed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a file''s record is never deleted; destroy its key instead';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.attachment_id <> OLD.attachment_id OR NEW.thread_id <> OLD.thread_id THEN
      RAISE EXCEPTION 'a file never moves to another report';
    END IF;
    IF OLD.dek_wrapped IS NULL AND NEW.dek_wrapped IS NOT NULL THEN
      RAISE EXCEPTION 'a destroyed file key never comes back';
    END IF;
    IF OLD.dek_wrapped IS NOT NULL AND NEW.dek_wrapped IS NOT NULL
       AND NEW.dek_wrapped <> OLD.dek_wrapped THEN
      RAISE EXCEPTION 'a file key is never changed, only destroyed';
    END IF;
  END IF;
  IF NEW.publication = 'published' THEN
    SELECT p.granted INTO granted FROM report_permissions_log p
     WHERE p.thread_id = NEW.thread_id AND p.permission = 'attachment_publication'
     ORDER BY p.id DESC LIMIT 1;
    IF granted IS NOT TRUE THEN
      RAISE EXCEPTION 'the reporter has not permitted this report''s files to be published';
    END IF;
    SELECT r.may_publish INTO allowed FROM report_heads h
      JOIN reports r ON r.id = h.current_report_id
     WHERE h.thread_id = NEW.thread_id;
    IF allowed IS NOT TRUE THEN
      RAISE EXCEPTION 'a file is never published from a report that may not be published';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER attachment_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON attachment_heads
  FOR EACH ROW EXECUTE FUNCTION attachment_heads_guard();

-- TAKING THE PERMISSION BACK TAKES PUBLISHED FILES DOWN. Checked when the
-- transaction that wrote the revocation commits: if any of the thread's
-- files is still published by then, the revocation is refused. The database
-- does not do the taking down (that means deleting objects in storage, which
-- is the application's), it refuses a revocation that did not.
CREATE FUNCTION permission_revocation_took_files_down() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current boolean;
BEGIN
  IF NEW.permission <> 'attachment_publication' THEN
    RETURN NULL;
  END IF;
  SELECT p.granted INTO current FROM report_permissions_log p
   WHERE p.thread_id = NEW.thread_id AND p.permission = 'attachment_publication'
   ORDER BY p.id DESC LIMIT 1;
  IF current IS NOT TRUE AND EXISTS (
    SELECT 1 FROM attachment_heads h
     WHERE h.thread_id = NEW.thread_id AND h.publication = 'published'
  ) THEN
    RAISE EXCEPTION 'the files permission was taken back but a file of thread % is still published', NEW.thread_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER permission_revocation_took_files_down
  AFTER INSERT ON report_permissions_log
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION permission_revocation_took_files_down();

-- ── who did what to a file ──────────────────────────────────────────────
-- APPEND-ONLY. A moderator's decisions carry their address and a reason; a
-- reporter's carry no address, because this table cannot forget and the
-- reporter's address must be erasable.
CREATE TABLE attachment_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attachment_id bigint NOT NULL REFERENCES attachments (id),
  thread_id     uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('published', 'withheld', 'refused', 'taken_down',
                                                'erased', 'viewed_original')),
  actor         text NOT NULL CHECK (actor IN ('moderator', 'reporter', 'system')),
  actor_email   text,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (actor = 'moderator' OR actor_email IS NULL),
  CHECK (actor <> 'moderator' OR (actor_email IS NOT NULL AND length(btrim(reason)) > 0))
);
CREATE INDEX attachment_events_thread_idx ON attachment_events (thread_id, id);
CREATE TRIGGER attachment_events_append_only BEFORE UPDATE OR DELETE ON attachment_events
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER attachment_events_no_truncate BEFORE TRUNCATE ON attachment_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── objects that must leave storage ─────────────────────────────────────
-- Storage is not transactional, so a decision that removes an object writes
-- the object here IN THE SAME TRANSACTION, and the deletion is attempted
-- after commit and again by the worker until it succeeds. A takedown that
-- failed half way is a row here, not a public file nobody knows about.
CREATE TABLE storage_deletions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket     text NOT NULL CHECK (bucket IN ('staging', 'evidence', 'renditions')),
  key        text NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
