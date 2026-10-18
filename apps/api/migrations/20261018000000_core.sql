-- ════════════════════════════════════════════════════════════════════════
-- The core: logbooks, their questions, the reports chained under them, and
-- the anchors that timestamp the chains.
--
-- MIGRATIONS ARE ADDITIVE. Nothing after this file may change how an
-- existing report's sealed object is rebuilt. The runner refuses to start if
-- an applied migration's text has changed.
--
-- Several rules the application also enforces are enforced here as well, on
-- purpose: an append-only table, a chain link, the one-way door of launching
-- a logbook. A rule that only the application knows is one edit away from
-- not being a rule.
-- ════════════════════════════════════════════════════════════════════════

CREATE FUNCTION reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % is not permitted on %', TG_OP, TG_TABLE_NAME;
END;
$$;

-- Where a logbook's chain starts. The same rule as chainGenesis() in
-- @reportlog/seal: sha256 of "reportlog-chain:<slug>", lowercase hex.
CREATE FUNCTION chain_genesis(slug text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT encode(sha256(convert_to('reportlog-chain:' || slug, 'UTF8')), 'hex')
$$;

-- ── the publication card's wordings ─────────────────────────────────────
-- Every wording this deployment has ever shown. A report's may_publish_digest
-- references a row here, so a report cannot seal an answer to a sentence the
-- server never issued.
CREATE TABLE consent_texts (
  digest             text PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  variant            text NOT NULL CHECK (variant IN ('general', 'coordinator')),
  body               text NOT NULL,
  introduced_by_role text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (digest = encode(sha256(convert_to(normalize(body, NFC), 'UTF8')), 'hex'))
);
CREATE TRIGGER consent_texts_append_only BEFORE UPDATE OR DELETE ON consent_texts
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER consent_texts_no_truncate BEFORE TRUNCATE ON consent_texts
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── logbooks ────────────────────────────────────────────────────────────
CREATE TABLE logbooks (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The slug is what every report seals and what the chain starts from.
  -- Never editable: see logbooks_guard.
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  blurb       text,
  -- Launching is a one-way door. Once set, never unset or moved.
  launched_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION logbooks_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Once listed, always listed: a launched logbook is named by the anchor.
    IF OLD.launched_at IS NOT NULL THEN
      RAISE EXCEPTION 'a launched logbook is never deleted (%)', OLD.slug;
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'a logbook''s slug is never changed (%)', OLD.slug;
  END IF;
  IF OLD.launched_at IS NOT NULL AND NEW.launched_at IS DISTINCT FROM OLD.launched_at THEN
    RAISE EXCEPTION 'a launched logbook stays launched (%)', OLD.slug;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER logbooks_guard BEFORE UPDATE OR DELETE ON logbooks
  FOR EACH ROW EXECUTE FUNCTION logbooks_guard();

-- ── a logbook's questions ───────────────────────────────────────────────
CREATE TABLE logbook_fields (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  logbook_id bigint NOT NULL REFERENCES logbooks (id) ON DELETE CASCADE,
  key        text NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9_]{0,38}$'),
  kind       text NOT NULL,
  label      text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  help       text,
  required   boolean NOT NULL DEFAULT false,
  shown_when jsonb CHECK (shown_when IS NULL OR jsonb_typeof(shown_when) = 'object'),
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  position   integer NOT NULL DEFAULT 0,
  -- Delivery, not meaning: whether the board offers this as a filter. Not in
  -- the form definition, so it may change after launch.
  filterable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (logbook_id, key)
);
CREATE INDEX logbook_fields_order_idx ON logbook_fields (logbook_id, position, id);

-- LAUNCHING IS A ONE-WAY DOOR. Afterwards a logbook may gain a new OPTIONAL
-- question and nothing else: no rewording, removing, reordering or promoting
-- to required. The application checks first and says why; this is what holds
-- if a path forgets to.
CREATE FUNCTION logbook_fields_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  launched timestamptz;
BEGIN
  SELECT launched_at INTO launched FROM logbooks
   WHERE id = COALESCE(NEW.logbook_id, OLD.logbook_id);
  IF launched IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.required THEN
      RAISE EXCEPTION 'a launched logbook may only gain an optional question';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a launched logbook''s questions are never removed';
  END IF;
  IF (NEW.logbook_id, NEW.key, NEW.kind, NEW.label, NEW.help, NEW.required,
      NEW.shown_when, NEW.settings, NEW.position)
     IS DISTINCT FROM
     (OLD.logbook_id, OLD.key, OLD.kind, OLD.label, OLD.help, OLD.required,
      OLD.shown_when, OLD.settings, OLD.position) THEN
    RAISE EXCEPTION 'a launched logbook''s questions are never changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER logbook_fields_guard BEFORE INSERT OR UPDATE OR DELETE ON logbook_fields
  FOR EACH ROW EXECUTE FUNCTION logbook_fields_guard();

-- ── versions of a logbook's form ────────────────────────────────────────
-- The exact definition text each report was answered against. The hash is
-- checked against the text by the database itself.
CREATE TABLE logbook_forms (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  logbook_id bigint NOT NULL REFERENCES logbooks (id),
  form_hash  text NOT NULL,
  definition text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (logbook_id, form_hash),
  UNIQUE (id, logbook_id),
  CHECK (form_hash = encode(sha256(convert_to(definition, 'UTF8')), 'hex'))
);
CREATE TRIGGER logbook_forms_append_only BEFORE UPDATE OR DELETE ON logbook_forms
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER logbook_forms_no_truncate BEFORE TRUNCATE ON logbook_forms
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── reports ─────────────────────────────────────────────────────────────
-- APPEND-ONLY. Never UPDATE, never DELETE. A correction is a new row in the
-- same thread. Every column that is part of the sealed object is stored as
-- it was sealed; the verifier rebuilds the object from these columns.
CREATE TABLE reports (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_ref         text NOT NULL UNIQUE,
  received_at        timestamptz NOT NULL,
  thread_id          uuid NOT NULL,
  corrects_id        bigint REFERENCES reports (id),
  recipe             integer NOT NULL DEFAULT 1 CHECK (recipe >= 1),
  content_hash       text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  prev_chain_hash    text NOT NULL CHECK (prev_chain_hash ~ '^[a-f0-9]{64}$'),
  chain_hash         text NOT NULL UNIQUE
                       CHECK (chain_hash = encode(sha256(convert_to(content_hash || prev_chain_hash, 'UTF8')), 'hex')),
  logbook_id         bigint NOT NULL REFERENCES logbooks (id),
  form_id            bigint,
  -- The same object that was sealed under `answers`, kept as a column so the
  -- board can index it. ABSENT IS NULL, NEVER '{}': under RFC 8785 those are
  -- different values.
  answers            jsonb CHECK (answers IS NULL OR (jsonb_typeof(answers) = 'object' AND answers <> '{}'::jsonb)),
  may_publish        boolean NOT NULL,
  may_publish_digest text NOT NULL REFERENCES consent_texts (digest),
  -- Third-party provenance: NULL on a direct report (never false), and
  -- complete whenever it is present.
  third_party        boolean CHECK (third_party IS DISTINCT FROM false),
  filed_via          text,
  intake_method      text CHECK (intake_method IN ('paper', 'phone', 'in_person', 'email', 'other')),
  attested_at        timestamptz,
  collected_on       date,
  FOREIGN KEY (form_id, logbook_id) REFERENCES logbook_forms (id, logbook_id),
  CHECK (
    (third_party IS NULL AND filed_via IS NULL AND intake_method IS NULL
       AND attested_at IS NULL AND collected_on IS NULL)
    OR (third_party AND filed_via IS NOT NULL AND intake_method IS NOT NULL
       AND attested_at IS NOT NULL)
  )
);
CREATE INDEX reports_chain_idx ON reports (logbook_id, id);
CREATE INDEX reports_thread_idx ON reports (thread_id);
CREATE INDEX reports_received_at_idx ON reports (received_at);
CREATE INDEX reports_answers_idx ON reports USING gin (answers jsonb_path_ops) WHERE answers IS NOT NULL;

CREATE TRIGGER reports_append_only BEFORE UPDATE OR DELETE ON reports
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER reports_no_truncate BEFORE TRUNCATE ON reports
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ONE CHAIN PER LOGBOOK, checked on the way in. A new report must link to
-- the newest report in its own logbook, or to the logbook's genesis if it is
-- the first, and only a launched logbook takes reports. The link itself
-- (chain_hash) is checked by the column's CHECK above. The content hash
-- cannot be checked here: RFC 8785 is the application's, and the verifier's.
--
-- The trigger takes the same per-logbook lock the application takes, so a
-- path that forgot to lock gets an error instead of a fork.
CREATE FUNCTION reports_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lb_slug  text;
  launched timestamptz;
  head     text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('reports_chain:' || NEW.logbook_id));
  SELECT slug, launched_at INTO lb_slug, launched FROM logbooks WHERE id = NEW.logbook_id;
  IF launched IS NULL THEN
    RAISE EXCEPTION 'only a launched logbook takes reports (%)', lb_slug;
  END IF;
  SELECT chain_hash INTO head FROM reports
   WHERE logbook_id = NEW.logbook_id ORDER BY id DESC LIMIT 1;
  IF NEW.prev_chain_hash IS DISTINCT FROM COALESCE(head, chain_genesis(lb_slug)) THEN
    RAISE EXCEPTION 'report % does not link to the head of logbook %', NEW.public_ref, lb_slug;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reports_link_guard BEFORE INSERT ON reports
  FOR EACH ROW EXECUTE FUNCTION reports_link_guard();

-- ── the current version of each thread ──────────────────────────────────
-- Mutable on purpose: what is public and what is current changes, and none
-- of it is sealed. The moderation workstream extends this table.
CREATE TABLE report_heads (
  thread_id         uuid PRIMARY KEY,
  current_report_id bigint NOT NULL REFERENCES reports (id),
  withdrawn         boolean NOT NULL DEFAULT false,
  moderation_status text NOT NULL DEFAULT 'pending'
                      CHECK (moderation_status IN ('pending', 'valid', 'invalid', 'unknown')),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── files a report version commits to ───────────────────────────────────
-- The attachments workstream adds storage, renditions and erasure. What is
-- here is what the sealed manifest is rebuilt from.
CREATE TABLE attachments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id   uuid NOT NULL,
  -- The version a file first arrived with. NOT what a version commits to:
  -- that is report_attachments.
  report_id   bigint NOT NULL REFERENCES reports (id),
  ordinal     integer NOT NULL CHECK (ordinal >= 1),
  media_type  text NOT NULL,
  byte_size   bigint NOT NULL CHECK (byte_size >= 0),
  sha256      text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_key text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, ordinal)
);
CREATE TRIGGER attachments_append_only BEFORE UPDATE OR DELETE ON attachments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER attachments_no_truncate BEFORE TRUNCATE ON attachments
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE TABLE report_attachments (
  report_id     bigint NOT NULL REFERENCES reports (id),
  attachment_id bigint NOT NULL REFERENCES attachments (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, attachment_id)
);
CREATE INDEX report_attachments_attachment_idx ON report_attachments (attachment_id);
CREATE TRIGGER report_attachments_append_only BEFORE UPDATE OR DELETE ON report_attachments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER report_attachments_no_truncate BEFORE TRUNCATE ON report_attachments
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── the daily anchor ────────────────────────────────────────────────────
CREATE TABLE chain_anchors (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anchor_date     date NOT NULL,
  root_chain_hash text NOT NULL CHECK (root_chain_hash ~ '^[a-f0-9]{64}$'),
  rfc3161_token   bytea,
  public_log_ref  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER chain_anchors_append_only BEFORE UPDATE OR DELETE ON chain_anchors
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER chain_anchors_no_truncate BEFORE TRUNCATE ON chain_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE TABLE chain_anchor_heads (
  anchor_id       bigint NOT NULL REFERENCES chain_anchors (id),
  logbook_slug    text NOT NULL,
  head_chain_hash text NOT NULL CHECK (head_chain_hash ~ '^[a-f0-9]{64}$'),
  report_count    integer NOT NULL CHECK (report_count >= 0),
  PRIMARY KEY (anchor_id, logbook_slug)
);
CREATE INDEX chain_anchor_heads_head_idx ON chain_anchor_heads (head_chain_hash);
CREATE TRIGGER chain_anchor_heads_append_only BEFORE UPDATE OR DELETE ON chain_anchor_heads
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER chain_anchor_heads_no_truncate BEFORE TRUNCATE ON chain_anchor_heads
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();
