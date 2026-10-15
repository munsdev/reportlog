import crypto from 'node:crypto';

/**
 * One line per request, and an error handler that makes a 500 say so.
 *
 * Written after 11 September, when a 100 MB upload reached the bucket
 * byte-for-byte and its /complete call never took effect. The service had
 * not crashed and had not restarted — it simply had nothing to say. A whole
 * day of a live instance was fifteen journal lines, none of them about a
 * request. There was no way to tell whether the call arrived and failed or
 * never came, and that is the difference between a bug and a mystery.
 *
 * THE PRIVACY RULES ARE THE POINT, NOT AN AFTERTHOUGHT. This is an archive
 * whose promise is that a person can report something without being
 * identified for it, and a request log is the classic way that promise gets
 * broken by accident. So:
 *
 *   - NO IP addresses. Not truncated, not hashed. The debugging value is
 *     small and the value to anyone who compels or steals the logs is not.
 *     (nginx in front of this has its own opinion — see the runbook.)
 *   - NO query strings and NO bodies. Sign-in codes, email addresses and
 *     the site password all travel in those.
 *   - The route TEMPLATE, never the path as requested. A token in a URL is
 *     a credential; /api/uploads/a3f2…/complete is logged as
 *     /api/uploads/:slotToken/complete.
 *   - Tokens appear only as a short keyed digest, which is enough to ask
 *     "did a /complete ever arrive for this slot?" and useless for anything
 *     else. It cannot be reversed and it does not grant access.
 *
 * Anything added here later gets held to the same four rules.
 */

// Derived from a key that already exists rather than adding a required
// variable to .env, and derived rather than used directly so that a digest
// in a log file is not the same value as a contact digest in the database.
// With no key set — a dev container, a fresh install — a random one is
// generated per boot: correlation still works within a run of the process,
// and nothing carries across a restart, which is the safer way to be wrong.
const LOG_KEY = process.env.CONTACT_HMAC_KEY
  ? crypto.createHmac('sha256', process.env.CONTACT_HMAC_KEY).update('request-log').digest()
  : crypto.randomBytes(32);

/** Eight hex characters of a keyed digest. Correlates; reveals nothing. */
export function tag(value) {
  if (!value) return null;
  return crypto.createHmac('sha256', LOG_KEY).update(String(value)).digest('hex').slice(0, 8);
}

/**
 * The route as Express matched it, not as the client typed it. req.route is
 * set once a handler has run, which is why this is read at response time
 * rather than on the way in.
 *
 * An unmatched request has no template, so the path is redacted by shape:
 * any segment that looks like a token or an id becomes a placeholder. A 404
 * is exactly when a path is least trustworthy and most likely to be someone
 * probing, so it is also when guessing is least acceptable.
 */
function template(req) {
  // Captured by asyncRoute while the router still had it. Reading req.route
  // here instead would be wrong on the error path, where Express has already
  // unwound the mount prefix.
  if (req.logRoute) return req.logRoute;

  // req.originalUrl, never req.url or req.path: those two are rewritten to be
  // relative to the router that is handling the request, so by the time a
  // response finishes they have lost the mount prefix. That is how a line
  // came out as "/status", which is two different endpoints in this app.
  const pathname = (req.originalUrl || req.url || '/').split('?')[0];
  const rp = req.route?.path;

  // A request that ended inside middleware — a 401 from requireRole, the 404
  // from the uploads gate — never reached a handler, so nothing snapshotted
  // the prefix. Rebuild it: the route pattern says how many trailing segments
  // belong to the route, and everything before them is the mount.
  if (rp && rp !== '*') {
    const routeSegs = String(rp).split('/').filter(Boolean).length;
    const pathSegs = pathname.split('/').filter(Boolean);
    if (pathSegs.length >= routeSegs) {
      const prefix = pathSegs.slice(0, pathSegs.length - routeSegs).join('/');
      return `${prefix ? `/${prefix}` : ''}${rp === '/' ? '' : rp}` || '/';
    }
    return rp;
  }

  // No route pattern to trust — a 404, a static file, the frontend catch-all,
  // or somebody probing. Redact by shape. The email rule is not hypothetical:
  // /api/admin/moderators/:email puts an address in a path, and a near-miss
  // on that route would otherwise land somebody's email in the log.
  return pathname
    .split('/')
    .map((seg) => (
      /@/.test(seg) ? ':email'
        : /^[a-f0-9]{16,}$/i.test(seg) ? ':token'
          : /^\d+$/.test(seg) ? ':id'
            : seg
    ))
    .join('/')
    .slice(0, 120);
}

/**
 * Named parameters worth carrying, as digests. Only the ones that identify
 * a thing being acted on — never a value that is itself content.
 */
function params(req) {
  const out = [];
  for (const [k, v] of Object.entries(req.logParams || req.params || {})) {
    if (/token/i.test(k)) out.push(`${k}=${tag(v)}`);
  }
  // The draft token travels in the body or the query rather than the path,
  // and it is the thread tying a set of uploads to one submission — which is
  // the correlation an upload investigation actually needs.
  const draft = req.body?.draft_token || req.query?.draft_token;
  if (draft) out.push(`draft=${tag(draft)}`);
  return out;
}

export function requestLog(req, res, next) {
  req.id = crypto.randomBytes(4).toString('hex');
  // Echoed so a tester looking at devtools can hand over one string that
  // names the request on the server. The 11 September "Network error" banner
  // would have been one round instead of unsolved.
  res.setHeader('X-Request-Id', req.id);

  const started = process.hrtime.bigint();
  let done = false;

  const finish = (how) => {
    if (done) return;
    done = true;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const bits = [
      `[req] ${req.id}`,
      req.method,
      template(req),
      how === 'aborted' ? 'ABORTED' : res.statusCode,
      `${ms.toFixed(0)}ms`,
      ...params(req),
    ];
    // Whatever a handler chose to attach. Keyed values only, no free text,
    // so nothing a user typed can reach the log through this door.
    for (const [k, v] of Object.entries(res.locals.log || {})) bits.push(`${k}=${v}`);
    console.log(bits.join(' '));
  };

  res.on('finish', () => finish('finish'));
  // The one the upload case needs. A client that goes away mid-request —
  // the tab closed, the link dropped, a phone losing signal on a long
  // upload — fires 'close' with nothing written. Before this, that was
  // indistinguishable from the request never having been made at all.
  res.on('close', () => finish(res.writableEnded ? 'finish' : 'aborted'));

  next();
}

/**
 * The last stop. Anything asyncRoute catches lands here.
 *
 * The stack goes to the log; the client is told only that something went
 * wrong. An error message can carry a table name, a file path or a fragment
 * of somebody's report, and none of that belongs in a response.
 */
export function errorHandler(err, req, res, next) {
  console.error(`[req] ${req.id || '--------'} ERROR ${req.method} ${template(req)} ${err?.message || err}`);
  if (err?.stack) console.error(err.stack);
  // Headers already sent means a response was partly written before it
  // failed. There is no way to turn that into a 500, so hand it to Express,
  // which closes the connection.
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

/**
 * Last-ditch process handlers. With every route wrapped these should never
 * fire; they exist because "should never" is what the last two findings
 * were. A bare stack on stderr with no marker is hard to find in a journal
 * and easy to mistake for something else.
 *
 * Both still exit. Node has terminated on an unhandled rejection since v15
 * and continuing after one means running on state nobody reasoned about;
 * systemd restarts the unit in a second. The gain here is that the journal
 * says what happened rather than only showing a stack.
 */
export function installProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    console.error('[fatal] unhandled rejection — a promise rejected with nothing to catch it');
    console.error(reason?.stack || reason);
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    console.error('[fatal] uncaught exception');
    console.error(err?.stack || err);
    process.exit(1);
  });
}
