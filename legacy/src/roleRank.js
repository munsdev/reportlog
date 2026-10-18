/**
 * Which system role satisfies which — the ONE place that knows owner
 * outranks admin.
 *
 * This is a separate module from `roles.js`, and deliberately imports
 * nothing, because `authMiddleware.js` needs it and `roles.js` reaches the
 * database. A guard that had to pull in a connection pool to decide whether
 * somebody may see a page would be the wrong dependency in the wrong
 * direction.
 *
 * WHY THIS EXISTS AT ALL. `requireRole` compared roles with
 * `allowed.includes(req.user.role)`, an exact match. Adding `owner` above
 * `admin` without this would have locked the owner out of every admin page
 * in the application — seventeen route guards, each of which would have had
 * to grow the word "owner", and the eighteenth written next month would
 * have forgotten. One implication, asserted once, beats seventeen lists
 * that have to agree.
 *
 * IT IS NOT A GENERAL HIERARCHY, on purpose. Admin does NOT imply moderator
 * here: every route that wants both already says both, and inventing a full
 * ladder would silently widen those routes. The only claim made is this:
 * owner is one level above admin and holds what admin holds.
 */

/** What each role satisfies BESIDES itself. */
const IMPLIES = {
  owner: ['admin'],
};

/**
 * Does `userRole` satisfy a requirement for `allowedRole`?
 *
 * Exact match first, so every existing role behaves exactly as it did.
 */
export function roleSatisfies(userRole, allowedRole) {
  if (!userRole || !allowedRole) return false;
  if (userRole === allowedRole) return true;
  return (IMPLIES[userRole] || []).includes(allowedRole);
}

/**
 * True for anybody who holds administrator authority — an admin, or the
 * owner who outranks them.
 *
 * Every `role === 'admin'` comparison outside a route guard should be this
 * instead. They were scattered across the routes and the page; a helper is
 * greppable and a comparison is not.
 */
export function hasAdminAuthority(role) {
  return roleSatisfies(role, 'admin');
}
