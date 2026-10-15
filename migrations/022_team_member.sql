-- The team-member flag, and desks.
--
-- ADDITIVE. Two columns on `users`, both defaulted, nothing rewritten.
-- Nothing here can be seen by reportCore.js or verify.js, and no report
-- hashes differently because somebody joined the team.
--
-- A FLAG, NOT A ROLE, and the distinction is load-bearing. The role ceiling
-- in src/roles.js says an Access Manager may mint Moderators and may not
-- mint Access Managers; it is asserted there, tested, and checked again at
-- the route. Every new grantable ROLE is a new way to get that wrong. A
-- flag composes with whatever system role somebody already holds, grants
-- access to no report, and is modelled exactly on `is_tester` above it —
-- same shape, same two granters, same audit row.
--
-- DESKS ARE DISPLAY ONLY. A desk decides which portal tab opens first and
-- what is highlighted; it never hides anything and it grants nothing. That
-- is why they are a plain text[] with no constraint rather than a table
-- with foreign keys: nothing depends on a desk being valid, and the list
-- they are drawn from lives in src/involvement.js, which already enumerates
-- exactly these functions. Two lists that disagree is worse than one that
-- is short.
--
-- Gating each portal tab behind its own role was considered and rejected.
-- The portal holds no secrets; if it ever did, the fix is not to put them
-- there. Gating would mean the person writing the social copy cannot read
-- the developer page to understand what she is writing about, and you get
-- a support request instead of a portal.

ALTER TABLE users ADD COLUMN is_team_member boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN desks text[] NOT NULL DEFAULT '{}';

-- Partial, like users_tester_idx: the flag is rare and the query that wants
-- it always wants the true rows.
CREATE INDEX users_team_member_idx ON users (is_team_member) WHERE is_team_member;

COMMENT ON COLUMN users.is_team_member IS
  'Opens the staff portal. A flag, not a role: it composes with any system '
  'role, grants access to no report, and is grantable by Admin and Access '
  'Manager both. See the role ceiling in src/roles.js.';
COMMENT ON COLUMN users.desks IS
  'Display only. Decides which portal tab opens first; never hides anything '
  'and grants nothing. Ids come from INVOLVEMENT_KINDS in src/involvement.js.';
