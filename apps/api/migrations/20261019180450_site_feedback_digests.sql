-- ════════════════════════════════════════════════════════════════════════
-- The rest of the site (workstream G2): feedback and the tester flag, email
-- updates about published reports, and the directory of organizations.
--
-- NOTHING HERE IS SEALED, and nothing here changes how any report is rebuilt.
-- Two core tables gain columns (`users.is_tester`, `organizations.listed`
-- and `listed_at`), none of them read into a sealed object, and the role
-- audit learns one more axis. Everything else is new tables.
-- ════════════════════════════════════════════════════════════════════════

-- ── the tester flag ─────────────────────────────────────────────────────
-- A flag, not a role. It composes with whatever somebody already is (an
-- administrator can be a tester, so can a coordinator, so can somebody with
-- no role at all), and a role would force a choice between their position
-- and their tester access. It opens the feedback tracker and nothing else:
-- a tester sees issues, never a report.
ALTER TABLE users ADD COLUMN is_tester boolean NOT NULL DEFAULT false;
CREATE INDEX users_tester_idx ON users (is_tester) WHERE is_tester;

-- Giving or taking the flag is written to the same trail as every other
-- change to who may do what, so one query answers "what was granted to
-- whom". `flag` is the axis the old application used for it. Widening the
-- list of axes; every existing row still passes.
ALTER TABLE role_audit DROP CONSTRAINT role_audit_axis_check;
ALTER TABLE role_audit ADD CONSTRAINT role_audit_axis_check
  CHECK (axis IN ('system', 'owner', 'organization', 'site', 'flag'));

-- ── feedback ────────────────────────────────────────────────────────────
-- The in-app issue tracker: bugs, questions and suggestions about the site
-- itself. NOT reports. Nothing here is evidence and nothing here is chained.
CREATE TABLE feedback (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submitter_id      bigint NOT NULL REFERENCES users (id),
  type              text NOT NULL CHECK (type IN ('bug', 'question', 'suggestion')),
  severity          text NOT NULL CHECK (severity IN ('blocker', 'major', 'minor')),
  title             text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  body              text NOT NULL CHECK (length(btrim(body)) BETWEEN 10 AND 5000),
  -- A report reference typed by the tester. Only a string: it is not
  -- checked against the archive, because a tester may not see reports.
  related_ref       text CHECK (related_ref IS NULL OR length(related_ref) BETWEEN 1 AND 60),
  -- Where they were and what they were using, as the server sanitized it.
  context           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  status            text NOT NULL DEFAULT 'new' CHECK (status IN (
                      'new', 'investigating', 'in_progress', 'need_info',
                      'acknowledged', 'fixed', 'wont_fix', 'duplicate')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Not updated_at: the weekly digest asks how long an issue has sat
  -- without anybody moving it, and a comment is not somebody moving it.
  status_changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_status_idx ON feedback (status, status_changed_at);
CREATE INDEX feedback_submitter_idx ON feedback (submitter_id, created_at DESC);

-- What a tester wrote is what they wrote: only the status moves. An
-- administrator who wants to say something says it in a status note, which
-- the tester is sent and can read.
CREATE FUNCTION feedback_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'feedback is never deleted';
  END IF;
  IF NEW.id <> OLD.id OR NEW.submitter_id <> OLD.submitter_id OR NEW.type <> OLD.type
     OR NEW.severity <> OLD.severity OR NEW.title <> OLD.title OR NEW.body <> OLD.body
     OR NEW.related_ref IS DISTINCT FROM OLD.related_ref OR NEW.context <> OLD.context
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'only the status of a feedback issue changes';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feedback_only_status_moves BEFORE UPDATE OR DELETE ON feedback
  FOR EACH ROW EXECUTE FUNCTION feedback_guard();

-- Every change of status, with the note the tester was sent. APPEND-ONLY:
-- the history of an issue is the history of what people were told.
CREATE TABLE feedback_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feedback_id bigint NOT NULL REFERENCES feedback (id),
  action      text NOT NULL CHECK (action IN ('created', 'status_change')),
  new_status  text,
  actor_id    bigint NOT NULL REFERENCES users (id),
  note        text CHECK (note IS NULL OR length(note) <= 5000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- A status change says what it changed to, and why: the note is the reply.
  CHECK ((action = 'created') = (new_status IS NULL AND note IS NULL)),
  CHECK (action = 'created' OR length(btrim(note)) > 0)
);
CREATE INDEX feedback_events_feedback_idx ON feedback_events (feedback_id, created_at);
CREATE TRIGGER feedback_events_append_only BEFORE UPDATE OR DELETE ON feedback_events
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Replies from other testers ("seeing this too, on Firefox"). No threading,
-- no editing: the smallest thing that answers "is anyone else seeing this".
CREATE TABLE feedback_comments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feedback_id bigint NOT NULL REFERENCES feedback (id),
  author_id   bigint NOT NULL REFERENCES users (id),
  body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_comments_feedback_idx ON feedback_comments (feedback_id, created_at);
CREATE TRIGGER feedback_comments_append_only BEFORE UPDATE OR DELETE ON feedback_comments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- ── email updates about published reports ───────────────────────────────
-- Somebody who asked to hear, hourly or weekly, about reports the board
-- shows. No row is "no emails". People follow LOGBOOKS: `logbooks` is a list
-- of slugs (a slug never changes), or NULL for every logbook.
CREATE TABLE digest_subscriptions (
  user_id      bigint PRIMARY KEY REFERENCES users (id),
  frequency    text NOT NULL CHECK (frequency IN ('hourly', 'weekly')),
  logbooks     text[] CHECK (logbooks IS NULL OR cardinality(logbooks) BETWEEN 1 AND 200),
  -- When their last digest was put together, sent or empty. NULL until the
  -- first run, which then looks back one period.
  last_sent_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX digest_subscriptions_frequency_idx ON digest_subscriptions (frequency);

-- ── the directory of organizations ──────────────────────────────────────
-- An organization's own decision to be listed publicly. DELIBERATELY NOT
-- CHAINED: participation is mutable state about a living relationship, and a
-- sealed record of it would make membership permanently unremovable.
--
-- Leaving the directory does not remove an organization from the reports it
-- filed: that is `reports.filed_via`, sealed, and a different thing.
--
-- DEFAULT false. Listing is a claim made on an organization's behalf, and a
-- migration must not make it for them.
ALTER TABLE organizations ADD COLUMN listed boolean NOT NULL DEFAULT false;
-- When they first opted in, kept across an opt-out: the date answers "since
-- when have they been part of this", not "how long has this been switched on".
ALTER TABLE organizations ADD COLUMN listed_at timestamptz;
ALTER TABLE organizations ADD CONSTRAINT organizations_listed_has_date
  CHECK (NOT listed OR listed_at IS NOT NULL);
