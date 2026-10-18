/**
 * Wrap an async route handler so a rejected promise becomes next(err).
 *
 * Express 4 does not do this itself. An async handler that rejects — a
 * database hiccup, a storage timeout, a bug — produces an unhandled
 * rejection, and Node has terminated the process on those since v15. The
 * client gets a dropped connection with no status code, the service dies,
 * and the only trace is a stack on stderr. For an archive whose whole
 * promise is that a report does not get lost, that is the worst available
 * failure mode: it is silent at both ends.
 *
 * Every async handler in src/routes/ goes through this. That is asserted
 * mechanically by scripts/selftest.js rather than left to reviewers, because
 * this is a rule that fails by omission — one route missed still crashes the
 * app, and nothing about the missing wrapper is visible until it does.
 *
 * Express 5 catches async rejections natively and is the real fix. It is
 * deliberately not being taken yet: a framework bump on an app this close to
 * going live is a bigger risk than a wrapper, and the wrapper is removable in
 * one commit on the day Express 5 lands. Recorded as a decision, not left as
 * an oversight.
 */
export function asyncRoute(handler) {
  return function wrapped(req, res, next) {
    // Snapshot which route this is while Express still knows. req.baseUrl and
    // req.route are unwound once the router stack returns, so by the time the
    // response finishes — or the error handler runs — the mount prefix is
    // gone and a log line says "/status" instead of
    // "/api/site-access/status". Taken here because this is the one place
    // every async handler in the app passes through.
    if (req.route) {
      req.logRoute = `${req.baseUrl || ''}${req.route.path === '/' ? '' : req.route.path}` || '/';
      req.logParams = { ...req.params };
    }
    // Promise.resolve rather than assuming the handler is async: this also
    // covers a synchronous handler that happens to return a promise.
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
}
