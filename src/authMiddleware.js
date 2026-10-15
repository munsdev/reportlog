import { roleSatisfies } from './roleRank.js';

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

/**
 * Guard a route by system role.
 *
 * Matching goes through `roleSatisfies` rather than `Array.includes`, so a
 * role that outranks the one a route asks for is let through. Today that
 * means exactly one thing — the owner satisfies `admin` — and it is why
 * adding a rank above admin did not require editing every guard below.
 */
export function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowed.some((r) => roleSatisfies(req.user.role, r))) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    next();
  };
}
