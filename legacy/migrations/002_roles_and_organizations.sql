-- Roles, organizations, and third-party intake.
--
-- Two independent permission axes rather than one ladder:
--
--   system axis        what you can do to ReportLog itself — moderate
--                      reports, manage accounts, configure the platform
--   organization axis  what you can do within one organization — file on
--                      its behalf, manage its people and its presentation
--
-- A person holds at most one system role and any number of organization
-- memberships. Someone can be a system Moderator and also run Indivisible
-- Abroad Munich; the two have nothing to do with each other. They are kept
-- as separate tables rather than collapsed into one role column because
-- unpicking that later, once real grants exist, is painful.
--
-- Everything here is additive. No existing column changes type, no
-- existing row is touched, and nothing in this file alters how a report
-- already in the archive hashes.

BEGIN;

-- ---------------------------------------------------------------
-- The system axis
-- ---------------------------------------------------------------

-- Access Manager sits between Admin and Moderator, and exists to hand off
-- the work of deciding who moderates and who runs an organization without
-- handing off anything else. On election day the person fielding "we need
-- two more moderators now" should not have to be the person holding the
-- keys to the infrastructure.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role = ANY (ARRAY['user', 'moderator', 'access_manager', 'admin']));

-- Pre-release access: the bug report form, the issues list, anything held
-- behind a flag. Deliberately NOT a role — roles within an axis are
-- mutually exclusive and tester access is not. An admin should be able to
-- be a tester, so should a coordinator, so should an ordinary user; as a
-- role it would force a choice between someone's actual position and their
-- tester access. It grants no data access of any kind: a tester sees the
-- issue tracker and never a report. That matters because this is the list
-- most likely to be handled casually — an address added during a demo and
-- forgotten — so it is worth it being unable to expose anything.
ALTER TABLE users ADD COLUMN is_tester boolean NOT NULL DEFAULT false;
CREATE INDEX users_tester_idx ON users (is_tester) WHERE is_tester;

-- Every grant and revocation, from the first one. Append-only, like the
-- archive itself.
--
-- It records the admin's own actions too, not only delegated ones. A trail
-- that starts the day delegation starts cannot answer "who made this
-- person a moderator" for anyone appointed before it — which is precisely
-- the set of people with the most authority.
CREATE TABLE role_audit (
  id             bigserial PRIMARY KEY,
  actor_email    text NOT NULL,          -- who did it
  subject_email  text NOT NULL,          -- who it was done to
  axis           text NOT NULL,
  action         text NOT NULL,
  detail         text,                   -- role name, or organization name
  organization_id bigint,                -- set on organization-axis rows
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_audit_axis_check CHECK (axis = ANY (ARRAY['system', 'organization', 'flag'])),
  CONSTRAINT role_audit_action_check CHECK (action = ANY (ARRAY['grant', 'revoke']))
);

CREATE INDEX role_audit_subject_idx ON role_audit (subject_email, created_at DESC);
CREATE INDEX role_audit_actor_idx   ON role_audit (actor_email, created_at DESC);
CREATE INDEX role_audit_when_idx    ON role_audit (created_at DESC);

CREATE TRIGGER role_audit_append_only BEFORE DELETE OR UPDATE ON role_audit
  FOR EACH ROW EXECUTE FUNCTION reject_modification();


-- ---------------------------------------------------------------
-- The organization axis
-- ---------------------------------------------------------------

CREATE TABLE organizations (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL UNIQUE,
  logo_key     text,                     -- object storage key, admin-overridable
  details      text,
  -- What vetting this organization went through before it was given an
  -- account, and who signed it off. Filled by hand for now: the standard
  -- is a person's judgement and that person is the admin. The columns
  -- exist so that when a written standard arrives there is somewhere for
  -- its record to go, rather than a migration under time pressure.
  verified_by  text,
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE role_audit
  ADD CONSTRAINT role_audit_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id);

-- Many-to-many on both sides, deliberately. Coalitions are real, and one
-- person may end up handling paperwork for several small groups at once.
-- Removal from one organization has no effect on the others.
CREATE TABLE organization_memberships (
  id              bigserial PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations(id),
  user_id         bigint NOT NULL REFERENCES users(id),
  role            text NOT NULL,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_memberships_role_check CHECK (
    role = ANY (ARRAY['manager', 'coordinator'])),
  CONSTRAINT organization_memberships_once UNIQUE (organization_id, user_id)
);

CREATE INDEX organization_memberships_user_idx ON organization_memberships (user_id);
CREATE INDEX organization_memberships_org_idx  ON organization_memberships (organization_id, role);

-- An invitation to an address that has no account yet. Everything is keyed
-- on email, so an invite either attaches immediately to an existing
-- account or waits here and attaches on signup. Listed and revocable in
-- the manager panel — without that, orphaned invites accumulate and
-- nobody can clear them.
CREATE TABLE organization_invites (
  id              bigserial PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations(id),
  email           text NOT NULL,
  role            text NOT NULL,
  invited_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_invites_role_check CHECK (
    role = ANY (ARRAY['manager', 'coordinator'])),
  CONSTRAINT organization_invites_once UNIQUE (organization_id, email)
);

CREATE INDEX organization_invites_email_idx ON organization_invites (email);


-- ---------------------------------------------------------------
-- Third-party intake
-- ---------------------------------------------------------------

-- A working session, not a record. Bulk entry produces typos, so entries
-- are staged and reviewed as a set before anything enters the chain.
-- Nothing here is hashed, nothing here is evidence, and a batch that is
-- never submitted is ordinary rubbish that can be deleted.
CREATE TABLE intake_batches (
  id              bigserial PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations(id),
  coordinator_id  bigint NOT NULL REFERENCES users(id),
  status          text NOT NULL DEFAULT 'draft',
  created_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz,
  CONSTRAINT intake_batches_status_check CHECK (
    status = ANY (ARRAY['draft', 'submitted', 'abandoned']))
);

CREATE INDEX intake_batches_coordinator_idx ON intake_batches (coordinator_id, created_at DESC);
CREATE INDEX intake_batches_org_idx ON intake_batches (organization_id, created_at DESC);

CREATE TABLE intake_drafts (
  id          bigserial PRIMARY KEY,
  batch_id    bigint NOT NULL REFERENCES intake_batches(id) ON DELETE CASCADE,
  ordinal     integer NOT NULL,
  payload     jsonb NOT NULL,
  -- Set once the draft has become a real report, so a batch submitted
  -- twice cannot write the same account into the chain twice.
  report_id   bigint REFERENCES reports(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX intake_drafts_batch_idx ON intake_drafts (batch_id, ordinal);


-- ---------------------------------------------------------------
-- What a coordinator-filed report carries
-- ---------------------------------------------------------------

-- All five are NULL on every report filed so far and on every direct
-- report filed from now on. That is what makes this migration free: the
-- hashed object gains a key ONLY when the key applies, so a direct report
-- hashes byte-for-byte as it did before this file existed and no report in
-- the archive needs rehashing. See reportCore.js.
--
-- filed_via is the organization's NAME, not its id, and it is frozen at
-- the moment of filing. A renamed organization does not retroactively
-- change what a sealed report says about where it came from — which is the
-- point of sealing it.
ALTER TABLE reports ADD COLUMN filed_via      text;
ALTER TABLE reports ADD COLUMN intake_method  text;
ALTER TABLE reports ADD COLUMN collected_on   date;
ALTER TABLE reports ADD COLUMN third_party    boolean;
ALTER TABLE reports ADD COLUMN attested_at    timestamptz;

-- Kept out of the hash and out of Tier A: which organization row this was
-- filed under, for joins and for acting on one organization's intake as a
-- set. The public claim is filed_via; this is the bookkeeping.
ALTER TABLE reports ADD COLUMN organization_id bigint REFERENCES organizations(id);

-- A coordinator's own private reference back to their paper file
-- ("clipboard 3, entry 7"). Not hashed and never public: it exists to
-- reconcile a record against paper months later. Coordinators are told not
-- to put names in it, and some will anyway, which is exactly why it lives
-- here rather than in the sealed object.
ALTER TABLE reports ADD COLUMN source_ref text;

ALTER TABLE reports ADD CONSTRAINT reports_intake_method_check CHECK (
  intake_method = ANY (ARRAY['paper', 'phone', 'in_person', 'email', 'other']));

-- A third-party report has to say who it was filed through and when it was
-- attested. Half a provenance record is worse than none, because it reads
-- as complete.
ALTER TABLE reports ADD CONSTRAINT reports_third_party_complete_check CHECK (
  third_party IS NOT TRUE
  OR (filed_via IS NOT NULL AND attested_at IS NOT NULL AND intake_method IS NOT NULL));

CREATE INDEX reports_third_party_idx ON reports (third_party) WHERE third_party;
CREATE INDEX reports_organization_idx ON reports (organization_id) WHERE organization_id IS NOT NULL;


-- ---------------------------------------------------------------
-- Shared bug reports
-- ---------------------------------------------------------------

-- Testers see each other's reports rather than only their own: duplicates
-- drop sharply, and "seeing this too, on Firefox" is often the most useful
-- thing in a report. Append-only replies in order — no threading, no
-- editing, no formatting.
CREATE TABLE feedback_comments (
  id          bigserial PRIMARY KEY,
  feedback_id bigint NOT NULL REFERENCES feedback(id),
  author_email text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_comments_feedback_idx ON feedback_comments (feedback_id, created_at);

COMMIT;
