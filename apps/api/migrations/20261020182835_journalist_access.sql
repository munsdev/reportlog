-- Vetted journalist access (plan D, J7 to J13; review items 11 and 12).
--
-- A subscriber to the alert list asks for access with an emailed link; only
-- the owner approves; an approved journalist reads the desk of checked links
-- and nothing else. Nothing here is sealed or chained.

-- ── the role ────────────────────────────────────────────────────────────
-- Who may grant it (the owner only) is decided in @reportlog/access. This is
-- what holds if a path forgets to ask: the value is a known one.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user', 'moderator', 'access_manager', 'admin', 'owner', 'journalist'));

-- ── the emailed link that opens the request form ────────────────────────
ALTER TABLE journalist_links DROP CONSTRAINT journalist_links_purpose_check;
ALTER TABLE journalist_links ADD CONSTRAINT journalist_links_purpose_check
  CHECK (purpose IN ('confirm', 'stop', 'request'));

-- ── the request ─────────────────────────────────────────────────────────
-- One per subscriber. Outlet, role, links to published work and an optional
-- press card are encrypted under the subscriber's own key (details_enc, a
-- JSON document), like the rest of the row it belongs to.
--
-- NOT APPEND-ONLY, ON PURPOSE. A rejected request is deleted (J7): the
-- person stays subscribed and nothing of what they sent is kept. Leaving the
-- alert list deletes it too (the cascade). An approval is recorded twice:
-- here (who and when) and in role_audit, which is append-only.
CREATE TABLE journalist_access_requests (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscriber_id bigint NOT NULL UNIQUE
                  REFERENCES journalist_subscribers (id) ON DELETE CASCADE,
  details_enc   bytea NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'revoked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  decided_by    text,
  user_id       bigint REFERENCES users (id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  revoked_by    text,
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK (status = 'pending' OR (decided_by IS NOT NULL AND length(btrim(decided_by)) > 0)),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK (status <> 'revoked' OR revoked_by IS NOT NULL)
);

-- ── J12: the desk's reads go in the staff access log ────────────────────
-- 'desk_link' names a link group; 'desk_report' a report whose Sources the
-- desk showed. staff_email is the journalist's. The group is not a foreign
-- key: a log row must outlive whatever happens to the group later.
ALTER TABLE contact_access_log ADD COLUMN link_group_id bigint;

ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_kind_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_kind_check
  CHECK (kind IN ('contact', 'audit_log', 'contact_used', 'file_preview', 'chain_file',
                  'desk_link', 'desk_report'));

ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_thread_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_thread_check
  CHECK ((kind IN ('audit_log', 'chain_file', 'desk_link')) = (thread_id IS NULL));
ALTER TABLE contact_access_log DROP CONSTRAINT contact_access_log_report_check;
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_report_check
  CHECK (kind IN ('audit_log', 'chain_file', 'desk_link') OR report_id IS NOT NULL);
ALTER TABLE contact_access_log ADD CONSTRAINT contact_access_log_link_group_check
  CHECK ((kind = 'desk_link') = (link_group_id IS NOT NULL));
