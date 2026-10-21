-- Plan E, session PE3: in the record and on the moderator screen.
--
-- A per-logbook "publish as counts only" setting; the reason a decline gave,
-- kept on its decision so declined reports can be counted publicly by
-- reason; bulk actions, each still one decision row per report; the door's
-- refusals counted per hour by check, without content; the two flood
-- switches (pause intake, harder puzzle) and the public log of every switch
-- use; and organization intake links with a use limit and an off switch.
--
-- NOTHING HERE IS SEALED. Every value is about how the site delivers or
-- takes reports, and a report must verify the same whatever it says.

-- ── publish as counts only ──────────────────────────────────────────────
-- NO ROW, OR false, IS "LISTED AS ENTRIES", what the software did before
-- this setting existed: a migration must not empty a running board.
-- The current value; every change is also a row in site_switch_log.
CREATE TABLE logbook_publication (
  logbook_id  bigint PRIMARY KEY REFERENCES logbooks (id),
  counts_only boolean NOT NULL,
  set_by      text NOT NULL CHECK (length(btrim(set_by)) > 0),
  set_at      timestamptz NOT NULL DEFAULT now()
);

-- ── bulk moderation ─────────────────────────────────────────────────────
-- One row per bulk action: who, when, what the moderator chose and how
-- many reports it reached. Each report still gets its own moderation_log
-- row pointing here, so the record per report is exactly what a single
-- decision writes, plus the batch it came in.
-- APPEND-ONLY: a bulk action is a fact.
CREATE TABLE moderation_bulk_actions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action      text NOT NULL CHECK (action IN ('decline', 'approve', 'decline_links')),
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[a-z_]{3,40}$'),
  comment     text CHECK (comment IS NULL OR length(comment) <= 2000),
  -- The queue filter as the moderator set it, so a later reader can see
  -- what "everything the filter showed" meant. Never report content.
  filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  reached     integer NOT NULL CHECK (reached >= 0),
  actor_email text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER moderation_bulk_actions_append_only BEFORE UPDATE OR DELETE ON moderation_bulk_actions
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER moderation_bulk_actions_no_truncate BEFORE TRUNCATE ON moderation_bulk_actions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- The reason a decline named, from the fixed list (REJECTION_REASONS). Kept
-- on the decision itself: decision_notices has it only when an email was
-- attempted, and a bulk decline sends none. NULL on older rows and on
-- every decision that is not a decline.
ALTER TABLE moderation_log ADD COLUMN reason_code text
  CHECK (reason_code IS NULL OR reason_code ~ '^[a-z_]{3,40}$');
ALTER TABLE moderation_log ADD COLUMN bulk_id bigint REFERENCES moderation_bulk_actions (id);
CREATE INDEX moderation_log_bulk_idx ON moderation_log (bulk_id) WHERE bulk_id IS NOT NULL;

-- ── refusals at the door, counted ───────────────────────────────────────
-- One counter per hour per check. NO CONTENT, NO ADDRESS, NO TIME FINER
-- THAN THE HOUR: the door's checks (session PE2) call countRefusal(check)
-- and nothing else is written. Not append-only: a counter is an UPDATE.
CREATE TABLE intake_refusal_counts (
  hour       timestamptz NOT NULL CHECK (hour = date_trunc('hour', hour)),
  check_name text NOT NULL CHECK (check_name ~ '^[a-z][a-z_]{1,39}$'),
  refusals   bigint NOT NULL CHECK (refusals >= 0),
  PRIMARY KEY (hour, check_name)
);

-- For the flood screen's "submissions per hour": first versions by arrival.
CREATE INDEX IF NOT EXISTS reports_received_idx ON reports (received_at);
CREATE INDEX IF NOT EXISTS list_entries_created_idx ON list_entries (created_at);

-- ── the flood switches ──────────────────────────────────────────────────
-- The current state, one row. A projection of site_switch_log, written in
-- the same transaction. NOT APPEND-ONLY.
--
-- intake_paused_at: NULL is taking reports. Separate from the
-- administrator's intake switch (intake_settings), which closes the site's
-- intake for good; a pause is a moderator's flood control and says so
-- publicly, with its time.
-- puzzle_level: what the proof of work asks (session PE2 reads it).
CREATE TABLE flood_settings (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  intake_paused_at timestamptz,
  puzzle_level     text NOT NULL DEFAULT 'normal' CHECK (puzzle_level IN ('normal', 'harder')),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO flood_settings (id) VALUES (true);

-- Every use of a switch, with who and when. Shown publicly with its time
-- (never who). `subject` names the logbook for counts_only.
-- APPEND-ONLY: the public is told a switch was used; that must not change.
CREATE TABLE site_switch_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  switch      text NOT NULL CHECK (switch IN ('pause_intake', 'puzzle', 'counts_only')),
  value       text NOT NULL CHECK (value IN ('on', 'off', 'normal', 'harder')),
  subject     text CHECK (subject IS NULL OR length(subject) BETWEEN 1 AND 63),
  actor_email text NOT NULL CHECK (length(btrim(actor_email)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_switch_log_created_idx ON site_switch_log (created_at);
CREATE TRIGGER site_switch_log_append_only BEFORE UPDATE OR DELETE ON site_switch_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER site_switch_log_no_truncate BEFORE TRUNCATE ON site_switch_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- ── organization intake links ───────────────────────────────────────────
-- A link an organization hands its volunteers: a signed-in person who opens
-- it joins the organization as a COORDINATOR (never a manager), and then
-- files for it while signed in. A link can leak, so it has a use limit and
-- an off switch. The token is shown once and stored hashed.
-- NOT APPEND-ONLY: switching a link off is an UPDATE of disabled_at.
CREATE TABLE organization_intake_links (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations (id),
  token_hash      text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label           text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  max_uses        integer NOT NULL CHECK (max_uses BETWEEN 1 AND 10000),
  created_by      text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz,
  disabled_by     text,
  CONSTRAINT organization_intake_links_disabled_pair
    CHECK ((disabled_at IS NULL) = (disabled_by IS NULL))
);
CREATE INDEX organization_intake_links_org_idx ON organization_intake_links (organization_id);

-- A link that was switched off stays off: a leaked link turned back on is
-- the leak again. A new link is made instead.
CREATE FUNCTION organization_intake_links_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an intake link is switched off, never deleted';
  END IF;
  IF OLD.disabled_at IS NOT NULL AND NEW.disabled_at IS DISTINCT FROM OLD.disabled_at THEN
    RAISE EXCEPTION 'an intake link that was switched off stays off';
  END IF;
  IF NEW.token_hash <> OLD.token_hash OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'an intake link''s token and organization never change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_intake_links_guard BEFORE UPDATE OR DELETE ON organization_intake_links
  FOR EACH ROW EXECUTE FUNCTION organization_intake_links_guard();

-- Each use: who joined through which link. APPEND-ONLY. The database
-- refuses a use past the limit or on a link that is off, so the limit holds
-- even if application code forgets to ask.
CREATE TABLE organization_intake_link_uses (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id bigint NOT NULL REFERENCES organization_intake_links (id),
  user_id bigint NOT NULL REFERENCES users (id),
  used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, user_id)
);
CREATE TRIGGER organization_intake_link_uses_append_only BEFORE UPDATE OR DELETE ON organization_intake_link_uses
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
CREATE TRIGGER organization_intake_link_uses_no_truncate BEFORE TRUNCATE ON organization_intake_link_uses
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

CREATE FUNCTION organization_intake_link_uses_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  link organization_intake_links%ROWTYPE;
  used integer;
BEGIN
  -- Locked, so two people using the last place at once cannot both get it.
  SELECT * INTO link FROM organization_intake_links WHERE id = NEW.link_id FOR UPDATE;
  IF link.disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'this intake link is switched off';
  END IF;
  SELECT count(*) INTO used FROM organization_intake_link_uses WHERE link_id = NEW.link_id;
  IF used >= link.max_uses THEN
    RAISE EXCEPTION 'this intake link has been used as many times as it may be';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_intake_link_uses_limit BEFORE INSERT ON organization_intake_link_uses
  FOR EACH ROW EXECUTE FUNCTION organization_intake_link_uses_limit();
