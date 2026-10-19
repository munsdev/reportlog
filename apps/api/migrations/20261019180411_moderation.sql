-- ════════════════════════════════════════════════════════════════════════
-- Moderation and the public board (workstream D1).
--
-- What happens to a report after it is filed, and none of it sealed: what a
-- moderator decided and why, which reports ask for a second read, the
-- archive's own notes about a report, who opened a reporter's contact
-- details, whether a moderator published a report's files, and whether this
-- deployment publishes an archive at all.
--
-- NOTHING HERE IS READ INTO A SEALED OBJECT, and the seal and chain code may
-- never reach apps/api/src/moderation or apps/api/src/board (a boundary rule
-- says so). A report must not verify differently because an editor corrected
-- a note or an operator added a keyword. `report_heads` is not changed: the
-- second-read marker is derived from the flag rows rather than stored beside
-- them, so the two can never disagree.
-- ════════════════════════════════════════════════════════════════════════

-- ── what moderators did, and why ────────────────────────────────────────
-- Every staff decision on a report: its status, taking it off the board and
-- putting it back, saying a flagged report was read, notes and their
-- citations, and publishing or withholding its files. APPEND-ONLY: a
-- decision is changed by making another one, and both stay on the record.
CREATE TABLE moderation_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id   uuid NOT NULL REFERENCES report_heads (thread_id),
  -- The version the decision was about. A correction is a new version and
  -- gets its own look.
  report_id   bigint NOT NULL REFERENCES reports (id),
  action      text NOT NULL CHECK (action IN (
                'review', 'withdraw', 'restore', 'reviewed',
                'note', 'note_revised', 'note_state', 'note_link', 'files')),
  new_status  text,
  actor_email text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  comment     text CHECK (comment IS NULL OR length(comment) <= 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_log_thread_idx ON moderation_log (thread_id, id);
CREATE TRIGGER moderation_log_append_only BEFORE UPDATE OR DELETE ON moderation_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER moderation_log_no_truncate BEFORE TRUNCATE ON moderation_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── the second read ─────────────────────────────────────────────────────
-- A report version whose own words matched a review keyword. ONE THING ONLY:
-- "read this one next". Not a severity, not a finding, nothing about anybody
-- named in the report.
--
-- Keyed to the VERSION, so a correction gets its own look. Cleared, never
-- deleted: how many flags were worth raising needs the cleared ones too.
CREATE TABLE report_review_flags (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id  bigint NOT NULL UNIQUE REFERENCES reports (id),
  thread_id  uuid NOT NULL REFERENCES report_heads (thread_id),
  -- Which terms fired, so a reader need not repeat the triage.
  terms      text[] NOT NULL CHECK (cardinality(terms) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by text,
  -- Nobody clears anonymously.
  CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))
);
CREATE INDEX report_review_flags_thread_idx ON report_review_flags (thread_id);

-- A flag is cleared once and otherwise never changes: the first reader keeps
-- their name on it, and the terms are what fired at the time.
CREATE FUNCTION report_review_flags_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a review flag is cleared, never deleted';
  END IF;
  IF OLD.cleared_at IS NOT NULL
     OR (NEW.id, NEW.report_id, NEW.thread_id, NEW.terms, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.report_id, OLD.thread_id, OLD.terms, OLD.created_at) THEN
    RAISE EXCEPTION 'a review flag is only ever cleared, once';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER report_review_flags_guard BEFORE UPDATE OR DELETE ON report_review_flags
  FOR EACH ROW EXECUTE FUNCTION report_review_flags_guard();

-- ── moderation's settings ───────────────────────────────────────────────
-- One row. Two TRI-STATE columns, where NULL means "nobody has chosen":
--
--   public_archive_enabled  NULL is ON. A migration must not empty a board.
--   review_keywords         NULL is the shipped list; an EMPTY array is an
--                           operator choosing no keyword matching at all.
CREATE TABLE moderation_settings (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_archive_enabled boolean,
  public_archive_set_by  text,
  -- A sanity bound: every term goes into one expression that runs on every
  -- report filed.
  review_keywords        text[] CHECK (review_keywords IS NULL OR cardinality(review_keywords) <= 2000),
  review_keywords_set_by text,
  review_keywords_set_at timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO moderation_settings (id) VALUES (true);

-- ── the archive's own statement about a report ──────────────────────────
-- NOT PART OF THE RECORD and never hashed: a report's fingerprint covers what
-- its reporter said, and an archive must be able to correct its own speech.
-- So what is immutable is the HISTORY: versions are append-only, and the
-- current note is the newest version.
--
-- A note is not taken down when its report is withdrawn. If it were,
-- pressuring a reporter would be a way to erase the editorial record.
CREATE TABLE editorial_notes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id  uuid NOT NULL UNIQUE REFERENCES report_heads (thread_id),
  state      text NOT NULL DEFAULT 'published'
               CHECK (state IN ('published', 'under_review', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION editorial_notes_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'an editorial note is withdrawn, never deleted';
END;
$$;
CREATE TRIGGER editorial_notes_no_delete BEFORE DELETE ON editorial_notes
  FOR EACH ROW EXECUTE FUNCTION editorial_notes_no_delete();

-- The author is recorded and never published: the byline is a house one.
CREATE TABLE editorial_note_versions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_id         bigint NOT NULL REFERENCES editorial_notes (id),
  body            text NOT NULL CHECK (length(btrim(body)) BETWEEN 20 AND 20000),
  author_email    text NOT NULL CHECK (length(btrim(author_email)) > 0),
  revision_reason text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX editorial_note_versions_note_idx ON editorial_note_versions (note_id, id);
CREATE TRIGGER editorial_note_versions_append_only BEFORE UPDATE OR DELETE ON editorial_note_versions
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER editorial_note_versions_no_truncate BEFORE TRUNCATE ON editorial_note_versions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- Outside coverage cited beside a note. Withdrawn by a timestamp, never
-- deleted: a source quietly removed would leave a note resting on nothing.
-- The scheme is checked here too, because a javascript: URL in an archive
-- that renders links is an attack, not an address.
CREATE TABLE editorial_note_links (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_id      bigint NOT NULL REFERENCES editorial_notes (id),
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  publisher    text CHECK (publisher IS NULL OR length(publisher) <= 200),
  published_on date,
  url          text NOT NULL CHECK (url ~* '^https?://' AND length(url) <= 2000),
  added_by     text NOT NULL CHECK (length(btrim(added_by)) > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz
);
CREATE INDEX editorial_note_links_note_idx ON editorial_note_links (note_id, id);
CREATE FUNCTION editorial_note_links_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a citation is withdrawn, never deleted';
  END IF;
  IF OLD.removed_at IS NOT NULL
     OR (NEW.id, NEW.note_id, NEW.title, NEW.publisher, NEW.published_on, NEW.url,
         NEW.added_by, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.note_id, OLD.title, OLD.publisher, OLD.published_on, OLD.url,
         OLD.added_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a citation is only ever withdrawn, once';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER editorial_note_links_guard BEFORE UPDATE OR DELETE ON editorial_note_links
  FOR EACH ROW EXECUTE FUNCTION editorial_note_links_guard();

-- Whether a logbook uses notes at all. Off unless an administrator says so:
-- what a note is for varies, and an archive that publishes nothing has no
-- use for one. Kept here rather than on `logbooks` so this workstream does
-- not change another's table. No row is off.
CREATE TABLE logbook_editorial_notes (
  logbook_id bigint PRIMARY KEY REFERENCES logbooks (id),
  enabled    boolean NOT NULL,
  set_by     text NOT NULL,
  set_at     timestamptz NOT NULL DEFAULT now()
);

-- ── who opened a reporter's contact details ─────────────────────────────
-- Written BEFORE the details are decrypted, in the same request, so an
-- unlogged look is impossible: if this insert fails, nothing is disclosed.
-- The reporter is shown every 'contact' row on their report, with the reason
-- and without the staff member's address. 'audit_log' is a read of this log
-- itself by an administrator, recorded exactly one level deep.
--
-- APPEND-ONLY. A log of looks that could be edited would be a log of nothing.
CREATE TABLE contact_access_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_email text NOT NULL CHECK (length(btrim(staff_email)) > 0),
  kind        text NOT NULL CHECK (kind IN ('contact', 'audit_log')),
  thread_id   uuid REFERENCES report_heads (thread_id),
  report_id   bigint REFERENCES reports (id),
  reason      text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 10 AND 500),
  accessed_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'contact') = (thread_id IS NOT NULL)),
  CHECK (kind <> 'contact' OR (reason IS NOT NULL AND report_id IS NOT NULL))
);
CREATE INDEX contact_access_log_thread_idx ON contact_access_log (thread_id, accessed_at DESC);
CREATE TRIGGER contact_access_log_append_only BEFORE UPDATE OR DELETE ON contact_access_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER contact_access_log_no_truncate BEFORE TRUNCATE ON contact_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── whether a moderator published a report's files ──────────────────────
-- CONSENT IS THE CEILING, MODERATION IS THE FLOOR. A moderator may publish a
-- report's text and not its files, never the reverse. A log, newest row
-- wins, per VERSION: a correction is a new version and its files are decided
-- afresh. No row is "not published".
--
-- The trigger is the ceiling, held by the database: files are published only
-- on the current version of an approved, permitted, not-withdrawn report
-- whose reporter has given (and not taken back) permission for its files.
-- The board re-reads that permission on every read as well, so taking it
-- back takes the files down at once.
CREATE TABLE file_publication_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id   uuid NOT NULL REFERENCES report_heads (thread_id),
  report_id   bigint NOT NULL REFERENCES reports (id),
  published   boolean NOT NULL,
  actor_email text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_publication_log_current ON file_publication_log (thread_id, report_id, id DESC);
CREATE TRIGGER file_publication_log_append_only BEFORE UPDATE OR DELETE ON file_publication_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER file_publication_log_no_truncate BEFORE TRUNCATE ON file_publication_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE FUNCTION file_publication_ceiling() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  head    record;
  allowed boolean;
BEGIN
  IF NOT NEW.published THEN
    RETURN NEW;
  END IF;
  SELECT h.current_report_id, h.withdrawn, h.moderation_status, r.may_publish
    INTO head
    FROM report_heads h JOIN reports r ON r.id = h.current_report_id
   WHERE h.thread_id = NEW.thread_id;
  IF head.current_report_id IS DISTINCT FROM NEW.report_id THEN
    RAISE EXCEPTION 'files are published only on a report''s current version';
  END IF;
  IF head.withdrawn OR head.moderation_status <> 'valid' OR NOT head.may_publish THEN
    RAISE EXCEPTION 'a report''s files are never published before its text';
  END IF;
  SELECT p.granted INTO allowed
    FROM report_permissions_log p
   WHERE p.thread_id = NEW.thread_id AND p.permission = 'attachment_publication'
   ORDER BY p.id DESC LIMIT 1;
  IF allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'the reporter has not permitted publishing this report''s files';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER file_publication_ceiling BEFORE INSERT ON file_publication_log
  FOR EACH ROW EXECUTE FUNCTION file_publication_ceiling();

-- ── searching the board ─────────────────────────────────────────────────
-- Every string in a report's answers, and its reference. THE EXPRESSION MUST
-- STAY CHARACTER FOR CHARACTER IN STEP with `searchVector` in
-- apps/api/src/board/search.ts: Postgres matches an expression index by its
-- tree, and a drifted copy silently falls back to a sequential scan.
CREATE INDEX reports_search_idx ON reports USING gin ((
  jsonb_to_tsvector('simple'::regconfig, coalesce(answers, '{}'::jsonb), '["string"]'::jsonb)
  || to_tsvector('simple'::regconfig, public_ref)
));
