-- The whole schema, in one file.
--
-- This replaces migrations 001-021, which built the same thing in
-- twenty-one steps over the life of the first archive. That history is
-- in git and is worth reading; it is not worth replaying. It is gone
-- from here because the archive it was migrating no longer exists: the
-- chain was reset, and this is the schema the new one starts from.
--
-- Nothing in this file is a bridge. There are no columns kept alive
-- only so old rows still hash, no derive triggers filling in a
-- singular copy of a plural column, no sentinel values standing in for
-- "not answered yet". Those all existed, and each one earned its place
-- at the time. None of them survive a fresh start.

BEGIN;

-- Append-only enforcement. The archive's whole claim rests on this:
-- a report, once written, is never edited and never deleted. A
-- correction is a NEW row that points at what it corrects.
CREATE FUNCTION reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % is not permitted on %', TG_OP, TG_TABLE_NAME;
END;
$$;

-- Flattens a text array for full-text search. Named for what it does
-- rather than for the one column it was first written against.
CREATE FUNCTION text_of(text[]) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $_$
  SELECT coalesce(array_to_string($1, ' '), '');
$_$;


-- ---------------------------------------------------------------
-- The chain
-- ---------------------------------------------------------------

-- Every version of every report, in the order they were received.
-- Immutable. content_hash covers the reported facts; chain_hash ties
-- this row to the one before it.
CREATE TABLE reports (
  id                       bigserial PRIMARY KEY,
  public_ref               text NOT NULL UNIQUE,
  received_at              timestamptz NOT NULL DEFAULT now(),
  thread_id                uuid NOT NULL,
  corrects_id              bigint REFERENCES reports(id),

  incident_date            date NOT NULL,
  incident_time            time,
  -- Set when the incident had not finished at the time of writing, and
  -- when the date is the reporter's best recollection rather than a
  -- certainty. Each is written into the hashed object only when true,
  -- so an ordinary firsthand dated report carries neither.
  ongoing                  boolean NOT NULL DEFAULT false,
  date_approximate         boolean NOT NULL DEFAULT false,

  states                   text[] NOT NULL,
  site_text                text,
  categories               text[] NOT NULL,

  observer_status          text NOT NULL,
  is_credentialed_observer boolean NOT NULL DEFAULT true,
  direct_or_secondhand     text NOT NULL,
  -- Where a secondhand account came from. Absent on a firsthand one.
  source_kind              text,
  narrative                text NOT NULL,

  -- A moderator's judgement, made after the fact and therefore NOT part
  -- of what the reporter attested to. Null until somebody assesses it.
  -- It is recorded here rather than only on the head because the
  -- assessment at the time of writing is part of the record.
  severity                 text,

  recipe                   integer NOT NULL DEFAULT 1,
  content_hash             text NOT NULL,
  prev_chain_hash          text NOT NULL,
  chain_hash               text NOT NULL UNIQUE,
  legal_hold               boolean NOT NULL DEFAULT false,

  CONSTRAINT reports_states_check CHECK (
    cardinality(states) >= 1
    AND (NOT (states && ARRAY['NATIONAL', 'INTERNATIONAL']) OR cardinality(states) = 1)),
  CONSTRAINT reports_categories_check CHECK (cardinality(categories) >= 1),
  CONSTRAINT reports_observer_status_check CHECK (observer_status = ANY (ARRAY[
    'credentialed_inside', 'credentialed_restricted', 'uncredentialed_public',
    'remote_monitor', 'credentialed_remote', 'public_onsite', 'public_remote'])),
  CONSTRAINT reports_direct_or_secondhand_check CHECK (
    direct_or_secondhand = ANY (ARRAY['direct', 'secondhand'])),
  CONSTRAINT reports_source_kind_check CHECK (
    source_kind = ANY (ARRAY['witness', 'video', 'social', 'news', 'other'])),
  CONSTRAINT reports_severity_check CHECK (
    severity = ANY (ARRAY['note', 'irregularity', 'serious', 'systemic']))
);

CREATE INDEX reports_thread_id_idx   ON reports (thread_id);
CREATE INDEX reports_received_at_idx ON reports (received_at);
CREATE INDEX reports_severity_idx    ON reports (severity);
CREATE INDEX reports_states_idx      ON reports USING gin (states);
CREATE INDEX reports_categories_idx  ON reports USING gin (categories);
CREATE INDEX reports_ongoing_idx     ON reports (ongoing) WHERE ongoing;
CREATE INDEX reports_fts_idx ON reports USING gin (to_tsvector('english',
  coalesce(narrative, '') || ' ' ||
  coalesce(site_text, '') || ' ' ||
  text_of(states) || ' ' ||
  text_of(categories) || ' ' ||
  coalesce(public_ref, '')));

CREATE TRIGGER reports_append_only BEFORE DELETE OR UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- The mutable pointer: which version of a thread is current, and what
-- moderators have since decided about it. Everything here can change;
-- nothing here is hashed.
CREATE TABLE report_heads (
  thread_id         uuid PRIMARY KEY,
  current_report_id bigint NOT NULL REFERENCES reports(id),
  withdrawn         boolean NOT NULL DEFAULT false,
  moderation_status text NOT NULL DEFAULT 'pending',
  veracity          text NOT NULL DEFAULT 'pending',
  assessed_severity text,
  incident_id       uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_heads_moderation_status_check CHECK (
    moderation_status = ANY (ARRAY['pending', 'valid', 'invalid', 'unknown'])),
  CONSTRAINT report_heads_veracity_check CHECK (veracity = ANY (ARRAY[
    'pending', 'proven_false', 'likely_false', 'undetermined',
    'likely_true', 'proven_true'])),
  CONSTRAINT report_heads_assessed_severity_check CHECK (
    assessed_severity = ANY (ARRAY['note', 'irregularity', 'serious', 'systemic']))
);

CREATE INDEX report_heads_veracity_idx ON report_heads (veracity);
CREATE INDEX report_heads_incident_idx ON report_heads (incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX report_heads_assessed_severity_idx ON report_heads (assessed_severity)
  WHERE assessed_severity IS NOT NULL;

-- Tier B. Who the reporter is, encrypted, moderator-only, and keyed to
-- the thread rather than to a version — a correction does not create a
-- second copy of somebody's contact details.
CREATE TABLE reports_restricted (
  thread_id            uuid PRIMARY KEY REFERENCES report_heads(thread_id),
  observer_org_enc     bytea,
  observer_id_enc      bytea,
  observer_contact_enc bytea,
  contact_email_hmac   text,
  consent_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reports_restricted_contact_hmac_idx ON reports_restricted (contact_email_hmac);

CREATE TRIGGER reports_restricted_append_only BEFORE DELETE OR UPDATE ON reports_restricted
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- RFC 3161 timestamps over a chain head: third-party evidence that the
-- archive said what it says by a given date.
CREATE TABLE chain_anchors (
  id              serial PRIMARY KEY,
  anchor_date     date NOT NULL,
  root_chain_hash text NOT NULL,
  rfc3161_token   bytea,
  public_log_ref  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER chain_anchors_append_only BEFORE DELETE OR UPDATE ON chain_anchors
  FOR EACH ROW EXECUTE FUNCTION reject_modification();


-- ---------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------

-- The immutable facts about a file: its fingerprint, size and type.
-- These are hashed into the report, which is what makes an attachment
-- tamper-evident without the archive holding the file itself.
CREATE TABLE attachments (
  id                   bigserial PRIMARY KEY,
  thread_id            uuid NOT NULL,
  report_id            bigint NOT NULL REFERENCES reports(id),
  ordinal              integer NOT NULL,
  original_name        text,
  media_type           text NOT NULL,
  byte_size            bigint NOT NULL,
  sha256               text NOT NULL,
  storage_key          text NOT NULL,
  captured_at          timestamptz,
  exif_enc             bytea,
  rendition_media_type text,
  duration_seconds     integer,
  has_poster           boolean NOT NULL DEFAULT false,
  received_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attachments_report_idx ON attachments (report_id, ordinal);
CREATE INDEX attachments_thread_idx ON attachments (thread_id);
CREATE INDEX attachments_sha256_idx ON attachments (sha256);

CREATE TRIGGER attachments_append_only BEFORE DELETE OR UPDATE ON attachments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- What has since been decided about a file: whether it scanned clean,
-- whether it may be shown, and the wrapped key it is encrypted under.
CREATE TABLE attachment_heads (
  attachment_id    bigint PRIMARY KEY REFERENCES attachments(id),
  scan_status      text NOT NULL DEFAULT 'pending',
  publication      text NOT NULL DEFAULT 'withheld',
  dek_wrapped      bytea,
  rendition_key    text,
  alt_text         text,
  dek_destroyed_at timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachment_heads_scan_status_check CHECK (
    scan_status = ANY (ARRAY['pending', 'clean', 'infected', 'unreadable'])),
  CONSTRAINT attachment_heads_publication_check CHECK (
    publication = ANY (ARRAY['withheld', 'published', 'refused']))
);

CREATE INDEX attachment_heads_publication_idx ON attachment_heads (publication);

-- A short-lived, logged permission for one moderator to look at one
-- original file. Every grant has an access_log row behind it.
CREATE TABLE attachment_view_grants (
  token         text PRIMARY KEY,
  attachment_id bigint NOT NULL REFERENCES attachments(id),
  staff_email   text NOT NULL,
  access_log_id bigint NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attachment_view_grants_expiry_idx ON attachment_view_grants (expires_at);

-- Added once access_log exists further down: no grant without the audit
-- row that justifies it.

-- Files mid-upload, before they are attached to anything.
CREATE TABLE upload_slots (
  id                   bigserial PRIMARY KEY,
  slot_token           text NOT NULL UNIQUE,
  draft_token          text NOT NULL,
  declared_name        text,
  declared_type        text,
  declared_size        bigint NOT NULL,
  staging_key          text NOT NULL,
  status               text NOT NULL DEFAULT 'pending',
  status_detail        text,
  claimed_at           timestamptz,
  sha256               text,
  byte_size            bigint,
  media_type           text,
  storage_key          text,
  dek_wrapped          bytea,
  exif_enc             bytea,
  captured_at          timestamptz,
  rendition_media_type text,
  duration_seconds     integer,
  has_poster           boolean NOT NULL DEFAULT false,
  processing_kind      text,
  promoted_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  CONSTRAINT upload_slots_status_check CHECK (status = ANY (ARRAY[
    'pending', 'uploaded', 'processing', 'clean', 'infected',
    'unreadable', 'rejected', 'withdrawn', 'expired']))
);

CREATE INDEX upload_slots_draft_idx  ON upload_slots (draft_token);
CREATE INDEX upload_slots_status_idx ON upload_slots (status, created_at);


-- ---------------------------------------------------------------
-- People
-- ---------------------------------------------------------------

CREATE TABLE users (
  id                       bigserial PRIMARY KEY,
  email                    text NOT NULL UNIQUE,
  email_hmac               text NOT NULL,
  role                     text NOT NULL DEFAULT 'user',
  notify_mode              text NOT NULL DEFAULT 'none',
  notify_states            text[],
  notify_instant_serious   boolean NOT NULL DEFAULT false,
  last_notified_at         timestamptz,
  last_serious_notified_at timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check CHECK (role = ANY (ARRAY['user', 'moderator', 'admin'])),
  CONSTRAINT users_notify_mode_check CHECK (notify_mode = ANY (ARRAY['none', 'weekly', 'hourly']))
);

CREATE INDEX users_email_hmac_idx ON users (email_hmac);
CREATE INDEX users_role_idx       ON users (role);

-- One-time codes for signing in without a password.
CREATE TABLE otp_codes (
  id         bigserial PRIMARY KEY,
  email_hmac text NOT NULL,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX otp_codes_email_hmac_idx ON otp_codes (email_hmac);

-- A reporter's session for managing their own reports.
CREATE TABLE self_sessions (
  token      text PRIMARY KEY,
  email_hmac text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A submission held until the reporter confirms it by email. Nothing
-- enters the chain until they do.
CREATE TABLE report_submission_tokens (
  token        text PRIMARY KEY,
  email        text NOT NULL,
  payload      jsonb NOT NULL,
  thread_id    uuid,
  confirmed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

-- The site-wide password, for the testing phase.
CREATE TABLE site_access_tokens (
  token      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);


-- ---------------------------------------------------------------
-- Audit and admin
-- ---------------------------------------------------------------

-- Every time a moderator looks at something identifying, with the
-- reason they gave. Append-only, and reporters can read their own.
CREATE TABLE access_log (
  id            bigserial PRIMARY KEY,
  staff_email   text NOT NULL,
  kind          text NOT NULL,
  report_id     bigint REFERENCES reports(id),
  attachment_id bigint REFERENCES attachments(id),
  thread_id     uuid,
  reason        text,
  accessed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_log_kind_check CHECK (kind = ANY (ARRAY[
    'identity', 'attachment_original', 'attachment_preview', 'audit_log']))
);

CREATE INDEX access_log_accessed_idx ON access_log (accessed_at DESC);
CREATE INDEX access_log_thread_idx   ON access_log (thread_id, accessed_at DESC);

CREATE TRIGGER access_log_append_only BEFORE DELETE OR UPDATE ON access_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- What was done to a thread, by the reporter or by a moderator.
CREATE TABLE self_service_log (
  id          bigserial PRIMARY KEY,
  thread_id   uuid NOT NULL,
  action      text NOT NULL,
  actor_email text,
  new_status  text,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_log_action_check CHECK (action = ANY (ARRAY[
    'correct', 'withdraw', 'restore', 'review', 'veracity',
    'incident', 'media', 'upload_rejected', 'severity']))
);

CREATE TRIGGER self_service_log_append_only BEFORE DELETE OR UPDATE ON self_service_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE feedback (
  id                 bigserial PRIMARY KEY,
  submitter_email    text NOT NULL,
  type               text NOT NULL,
  severity           text NOT NULL,
  title              text NOT NULL,
  body               text NOT NULL,
  related_public_ref text,
  context            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'new',
  created_at         timestamptz NOT NULL DEFAULT now(),
  status_changed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_type_check CHECK (type = ANY (ARRAY['bug', 'question', 'suggestion'])),
  CONSTRAINT feedback_severity_check CHECK (severity = ANY (ARRAY['blocker', 'major', 'minor'])),
  CONSTRAINT feedback_status_check CHECK (status = ANY (ARRAY[
    'new', 'investigating', 'in_progress', 'need_info',
    'acknowledged', 'fixed', 'wont_fix', 'duplicate']))
);

CREATE INDEX feedback_status_idx    ON feedback (status, created_at);
CREATE INDEX feedback_submitter_idx ON feedback (submitter_email, created_at DESC);

CREATE TABLE feedback_events (
  id          bigserial PRIMARY KEY,
  feedback_id bigint NOT NULL REFERENCES feedback(id),
  action      text NOT NULL,
  new_status  text,
  actor_email text NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_events_action_check CHECK (action = ANY (ARRAY['created', 'status_change']))
);

CREATE INDEX feedback_events_feedback_idx ON feedback_events (feedback_id, created_at);

ALTER TABLE attachment_view_grants
  ADD CONSTRAINT attachment_view_grants_access_log_id_fkey
  FOREIGN KEY (access_log_id) REFERENCES access_log(id);

-- A single row, hence the boolean primary key.
CREATE TABLE site_settings (
  id                   boolean PRIMARY KEY DEFAULT true,
  access_enabled       boolean NOT NULL DEFAULT true,
  access_password_hash text,
  dev_mode_until       timestamptz,
  last_seen_version    text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_settings_id_check CHECK (id)
);

COMMIT;
