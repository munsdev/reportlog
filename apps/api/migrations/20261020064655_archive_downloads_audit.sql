-- ════════════════════════════════════════════════════════════════════════
-- Backups and archive exports from the owner's screen (docs/decisions.md,
-- decision 10): every download is written to the audit trail.
--
-- A backup or an export is the whole archive in one file: every report,
-- every account, the contact details under their keys. Taking one away is
-- the most a single person can carry off this server, so it is written
-- where the people who grant access already read who changed what, and
-- where nobody can edit it afterwards (role_audit is append-only).
--
-- WIDENING ONLY. A new axis, `archive`, and a new action, `download`.
-- Every existing row still passes both checks. Nothing here is sealed.
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE role_audit DROP CONSTRAINT role_audit_axis_check;
ALTER TABLE role_audit ADD CONSTRAINT role_audit_axis_check
  CHECK (axis IN ('system', 'owner', 'organization', 'site', 'flag', 'archive'));

ALTER TABLE role_audit DROP CONSTRAINT role_audit_action_check;
ALTER TABLE role_audit ADD CONSTRAINT role_audit_action_check
  CHECK (action IN ('grant', 'revoke', 'change', 'download'));

-- A download names the person twice (actor and subject are both the owner);
-- the axis says it is not a change to anybody's role.
ALTER TABLE role_audit ADD CONSTRAINT role_audit_download_is_archive
  CHECK ((action = 'download') = (axis = 'archive'));
