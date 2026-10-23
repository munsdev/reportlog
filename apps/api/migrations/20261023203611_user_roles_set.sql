-- A person may hold several roles (decision 70).
--
-- `users.role` was one word; it becomes `users.roles`, a list of the roles
-- somebody holds. Plain "user" is the empty list, never a member of it.
-- Nothing here is sealed or chained.
--
-- What the single column used to guarantee is carried over, not dropped:
--   * only known values                      -> users_roles_known
--   * exactly one owner                      -> users_single_owner_idx, now on the list
--   * a journalist holds no staff role       -> users_roles_journalist_alone (new)
-- Who may GRANT which role is still @reportlog/access's MAY_GRANT; the owner's
-- seat is still ungrantable there, and a journalist is still made only by
-- approving an access request (application code, unchanged).

ALTER TABLE users ADD COLUMN roles text[] NOT NULL DEFAULT '{}';

UPDATE users SET roles = ARRAY[role] WHERE role <> 'user';

DROP INDEX users_single_owner_idx;
ALTER TABLE users DROP COLUMN role;

ALTER TABLE users ADD CONSTRAINT users_roles_known
  CHECK (roles <@ ARRAY['moderator', 'access_manager', 'admin', 'owner', 'journalist']::text[]);

-- A journalist is a vetted reader of the desk, not staff: the two never meet
-- in one person. The same rule is `canHoldTogether` in @reportlog/access.
ALTER TABLE users ADD CONSTRAINT users_roles_journalist_alone
  CHECK (NOT (roles @> ARRAY['journalist']::text[]
              AND roles && ARRAY['moderator', 'access_manager', 'admin', 'owner']::text[]));

CREATE UNIQUE INDEX users_single_owner_idx ON users ((true)) WHERE roles @> ARRAY['owner']::text[];
