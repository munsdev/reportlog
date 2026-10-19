-- ════════════════════════════════════════════════════════════════════════
-- What identity left undone (workstream A2): the team-member flag and desks,
-- organization logos, and the link in a digest email that stops it.
--
-- NOTHING HERE IS SEALED, and nothing here changes how any report is rebuilt.
-- Two core tables gain columns (`users`, `organizations`), none of them read
-- into a sealed object. One new table.
-- ════════════════════════════════════════════════════════════════════════

-- ── the team-member flag, and desks ─────────────────────────────────────
-- A FLAG, NOT A ROLE, like `is_tester` beside it. It composes with whatever
-- somebody already is, grants access to no report, and opens the team's own
-- pages. Who may give it is decided in @reportlog/access (`canSetFlag`), and
-- every change is a `role_audit` row on the `flag` axis.
ALTER TABLE users ADD COLUMN is_team_member boolean NOT NULL DEFAULT false;
CREATE INDEX users_team_member_idx ON users (is_team_member) WHERE is_team_member;

-- DESKS ARE DISPLAY ONLY: what somebody on the team does, so their account
-- page can say where they start. A desk hides nothing and grants nothing, so
-- the ids are not constrained here (the list lives in the contracts, and an
-- id it no longer names is simply not shown). One thing is constrained:
-- somebody taken off the team keeps no desk, or a revoked person would
-- quietly keep a job title.
ALTER TABLE users ADD COLUMN desks text[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(desks) <= 20);
ALTER TABLE users ADD CONSTRAINT users_desks_need_team
  CHECK (is_team_member OR cardinality(desks) = 0);

-- ── organization logos ──────────────────────────────────────────────────
-- The key of a re-encoded image (PNG or JPEG) in the files workstream's
-- `renditions` bucket (the bucket for bytes in the clear). Keys are random,
-- never derived from the organization. The public sees the logo only while
-- the organization is listed: storing one publishes nothing by itself.
ALTER TABLE organizations ADD COLUMN logo_key text
  CHECK (logo_key ~ '^logos/[a-f0-9]{32}\.(png|jpg)$');

-- ── stopping a digest from the email ────────────────────────────────────
-- Every digest email carries a link that stops it without signing in. The
-- link's token is a credential (whoever holds it can stop somebody's email),
-- so only its hash is kept, like every other token here. Opening the link
-- changes nothing: mail scanners open links. Stopping is a POST.
--
-- H's sweep may delete rows past `expires_at`.
CREATE TABLE digest_stop_links (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id    bigint NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- When somebody used it. Using it twice is harmless and says so.
  used_at    timestamptz
);
CREATE INDEX digest_stop_links_user_idx ON digest_stop_links (user_id);
CREATE INDEX digest_stop_links_expires_idx ON digest_stop_links (expires_at);
