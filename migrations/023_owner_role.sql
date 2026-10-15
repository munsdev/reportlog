-- The owner: one level above admin, and the only role that can make or
-- unmake an administrator.
--
-- Additive only. Nothing here touches `reports`, so no fingerprint changes
-- and no report needs re-verifying.
--
-- WHY THIS EXISTS: before this migration nothing in the application could
-- mint an administrator. MAY_GRANT contained no 'admin' in any row,
-- admin's own included, so the only two ways an admin ever existed were the
-- setup wizard running once and the legacy ADMIN_EMAIL promotion. "Only the
-- owner can add or remove admins" therefore creates a power that did not
-- exist rather than taking one away, and no deployment loses anything on
-- the day this lands.

BEGIN;

-- 1 · The role itself.
--
-- migrations/002 is the precedent for widening this constraint, having done
-- it once already to add access_manager. Drop and re-add in one
-- transaction; there is no ALTER for a CHECK.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role = ANY (ARRAY['user', 'moderator', 'access_manager', 'admin', 'owner']));

-- 2 · Exactly one owner, enforced by the database rather than by a check
--     somebody has to remember.
--
-- A partial unique index on a constant expression permits at most one row
-- matching the predicate. A second owner is then impossible rather than
-- merely unintended, which matters because the handoff swaps two people's
-- roles and a swap that half-applied would otherwise leave two.
CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner_idx ON users ((true)) WHERE role = 'owner';

-- 3 · Adopt the existing administrator, where there is exactly one.
--
-- A deployment installed before this has an admin and no owner, and would
-- otherwise have nobody able to appoint one — the seat is ungrantable by
-- design, so it cannot be handed out later by an admin.
--
-- ONLY WHERE THERE IS EXACTLY ONE. With several administrators there is no
-- honest way to pick, and promoting the oldest or the alphabetically first
-- would be the software deciding something it has no business deciding.
-- Those deployments stay ownerless and behave exactly as they do today
-- until somebody chooses, which is a decision this migration must not make
-- for them.
UPDATE users SET role = 'owner', updated_at = now()
 WHERE role = 'admin'
   AND (SELECT count(*) FROM users WHERE role = 'admin') = 1
   AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner');

-- 4 · The audit trail learns the new axis.
--
-- role_audit.axis was CHECKed against ('system','organization','flag'). A
-- handover writes on its own axis — 'owner' — so that "this deployment
-- changed hands" is a question the trail can answer directly rather than
-- one somebody has to infer from two role rows.
--
-- Without this the handover raises a constraint violation at the moment of
-- transfer, which is both the worst time and the hardest to test for by
-- reading the code.
ALTER TABLE role_audit DROP CONSTRAINT role_audit_axis_check;
ALTER TABLE role_audit ADD CONSTRAINT role_audit_axis_check CHECK (
  axis = ANY (ARRAY['system', 'organization', 'flag', 'owner']));

-- 5 · The pending handoff.
--
-- Ownership moves only with both parties agreeing: the owner proposes, and
-- the recipient signs in and accepts. A one-sided transfer to a typo, a
-- dead mailbox or somebody who has left is unrecoverable, because only the
-- owner mints admins and only the owner transfers — so the deployment would
-- have no way back that did not involve a shell and hand-written SQL, which
-- is the state this whole feature exists to end.
--
-- At most one pending handoff at a time: proposing a second replaces the
-- first, which is what the primary key on a constant enforces.
CREATE TABLE IF NOT EXISTS ownership_transfers (
  id                boolean     PRIMARY KEY DEFAULT true CHECK (id),
  from_email        text        NOT NULL,
  to_email          text        NOT NULL,
  to_email_hmac     bytea       NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL
);

COMMENT ON TABLE ownership_transfers IS
  'At most one pending ownership handoff. Deleted on accept, cancel or expiry; the seat itself lives on users.role.';

COMMIT;
