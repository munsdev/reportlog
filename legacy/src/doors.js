/**
 * What the password page offers to somebody who has not got the password.
 *
 * Lists and logbooks an administrator set to `door` (migration 047), that
 * are open right now. A `link` one is usable without the password too, but
 * is not shown here — that is the whole difference between the two.
 *
 * Read in front of the gate, so it returns titles and addresses and nothing
 * else: no counts, no blurbs from things that are not on offer, nothing
 * about what is behind the curtain.
 */
import { pool } from './db.js';
import { openLogbooks } from './logbooks.js';
import { isAccepting } from './lists/entries.js';

export async function doors({ client = pool } = {}) {
  const { rows } = await client.query(
    `SELECT slug, title, opens_at, closes_at, closed_at FROM lists
      WHERE outside_access = 'door' AND visibility = 'listed'
      ORDER BY created_at, id`,
  );
  const lists = rows.filter((l) => isAccepting(l))
    .map((l) => ({ kind: 'list', slug: l.slug, title: l.title, href: `/list/${l.slug}` }));
  const logbooks = (await openLogbooks(client))
    .filter((l) => l.outside_access === 'door')
    .map((l) => ({ kind: 'logbook', slug: l.slug, title: l.title, href: `/file/${l.slug}` }));
  return [...logbooks, ...lists];
}

/**
 * THE ONE PLACE A REQUEST WITHOUT THE PASSWORD IS LET THROUGH TO A ROUTE
 * BEHIND IT, so filing into a logbook an administrator opened works for
 * somebody who has not got the password — for filing only.
 *
 * An allow-list of exactly what the filing form calls, each condition on a
 * logbook that is launched, open and set to `link` or `door`. Everything else
 * — the board, other logbooks, the list of logbooks, every staff route —
 * still meets the gate. The routes themselves are unchanged and still apply
 * every rule they apply to anybody: a pass here is only "the password is not
 * the reason to refuse".
 *
 * UPLOADS ARE NOT TIED TO A LOGBOOK — a draft token is free to anybody — so
 * they pass only while some open-outside logbook actually takes files.
 *
 * Returns true to let the request past the gate.
 */
export async function outsidePass(req, { client = pool } = {}) {
  const path = req.path; // relative to /api
  const open = (await openLogbooks(client)).filter((l) => l.outside_access && l.outside_access !== 'closed');
  if (!open.length) return false;
  const isOpen = (slug) => open.some((l) => l.slug === String(slug || ''));

  if (req.method === 'GET') {
    // Text the form shows and the switches it reads. Nothing about a report.
    if (['/reports/consent-text', '/reports/intake', '/legal', '/legal/copy', '/uploads/config'].includes(path)) return true;
    const lb = path.match(/^\/logbooks\/([a-z0-9][a-z0-9-]{0,62})$/);
    if (lb) return isOpen(lb[1]);
    // The confirmation link. The token is the secret, and the logbook was
    // checked when the report was sent; somebody who filed while it was
    // open can confirm after it closes, exactly as anybody else can.
    if (/^\/reports\/confirm\/[^/]+$/.test(path)) return true;
    if (path === '/uploads/status') return open.some((l) => l.accepts_files);
    return false;
  }
  if (req.method === 'POST' && path === '/reports') return isOpen(req.body?.logbook);
  if (path === '/uploads/draft' || path === '/uploads' || /^\/uploads\/[^/]+(\/complete)?$/.test(path)) {
    return ['POST', 'DELETE'].includes(req.method) && open.some((l) => l.accepts_files);
  }
  return false;
}
