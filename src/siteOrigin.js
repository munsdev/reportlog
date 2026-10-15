// Single source of truth for the site's public origin, used everywhere a
// full URL is built (confirmation links, notification emails, CORS setup).
//
// Deliberately has no default. A wrong origin sends every reporter's
// confirmation link to somebody else's site, and it does so silently — so
// this fails at boot instead, which is the one moment an operator is
// looking. See SITE_ORIGIN in .env.example.
export const SITE_ORIGIN = process.env.SITE_ORIGIN;
if (!SITE_ORIGIN) {
  throw new Error('SITE_ORIGIN is required — set it in .env to this deployment\'s public origin, e.g. https://reports.example.org');
}
