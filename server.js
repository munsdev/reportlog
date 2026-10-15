import './src/nodeFloor.js';
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import authRoutes, { attachUser } from './src/routes/auth.js';
import reportsRoutes from './src/routes/reports.js';
import uploadsRoutes from './src/routes/uploads.js';
import meRoutes from './src/routes/me.js';
import evidenceRoutes from './src/routes/evidence.js';
import moderatorsRoutes from './src/routes/moderators.js';
import adminRoutes from './src/routes/admin.js';
import legalRoutes from './src/routes/legal.js';
import feedbackRoutes from './src/routes/feedback.js';
import { publicRouter as logbookPublicRoutes, adminRouter as logbookAdminRoutes } from './src/routes/logbooks.js';
import publicApiRoutes from './src/routes/publicApi.js';
import pressRoutes from './src/routes/press.js';
import orgRoutes from './src/routes/orgs.js';
import intakeRoutes from './src/routes/intake.js';
import statsRoutes from './src/routes/stats.js';
import mapRoutes from './src/routes/map.js';
import homeRoutes from './src/routes/home.js';
import siteAccessRoutes from './src/routes/siteAccess.js';
import setupRoutes from './src/routes/setup.js';
import allianceRoutes from './src/routes/alliance.js';
import invitationRoutes from './src/routes/invitations.js';
import {
  publicRouter as listPublicRoutes, adminRouter as listAdminRoutes,
  reviewRouter as listReviewRoutes, erasePage as listErasePage,
  mailConfirmPage as listMailConfirmPage,
} from './src/routes/lists.js';
import { doors, outsidePass } from './src/doors.js';
import { hasSiteAccess } from './src/siteAccess.js';
import { requireSiteAccess } from './src/siteAccess.js';
import { buildManifest } from './src/webManifest.js';
import { renderIndex, assertAnchors } from './src/indexPage.js';
import { armDevModeOnDeploy, DEV_MODE_HOURS } from './src/devMode.js';
import { recordCardTexts } from './src/consentText.js';
import { requestLog, errorHandler, installProcessHandlers } from './src/requestLog.js';
import { asyncRoute } from './src/asyncRoute.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Installed before anything else can throw, so a failure during startup is
// reported the same way as one during a request.
installProcessHandlers();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind nginx — needed so req.secure reflects X-Forwarded-Proto
/**
 * The Content-Security-Policy.
 *
 * `script-src 'self'` is the whole point, and it is only possible because NO
 * PAGE IN public/ CARRIES INLINE SCRIPT. The usual escape from that — a
 * per-request nonce — is not available here: nginx serves public/ straight
 * off disk in production, so most pages are never rendered by this process.
 * A policy that had to allow 'unsafe-inline' would be most of the way to no
 * policy at all, and this app writes other people's words into the DOM in
 * over a hundred places.
 *
 * WHAT IS DELIBERATELY NOT HERE. There is no `default-src`, so images,
 * media and fetches are not restricted. Uploads go browser-to-bucket and
 * attachments are served from that bucket, whose origin is a per-deployment
 * setting — a directive naming it cannot be written once and shipped, and
 * one guessed here would break uploads on somebody else's installation.
 * `style-src 'self'` is there, without 'unsafe-inline', because the markup
 * carries no inline `style` attribute any more.
 *
 * Restated in contrib/nginx/*.conf, because in production nginx answers for
 * public/ and this process never sees those requests. `npm test` checks the
 * two agree.
 */
const CSP = [
  "script-src 'self'",
  // Elements AND attributes. An injected <style> block, a stylesheet from
  // anywhere but this origin, and an inline `style` attribute in markup are
  // all refused. That last one is possible because the markup carries none:
  // the static ones became classes, and the few a script needs (a swatch's
  // colour, an upload's progress width) are set through the CSSOM, which this
  // directive does not govern. Nothing in the frontend creates a style
  // element, sets cssText, or writes a style="" into a string — `npm test`
  // checks all three, and it is the check to run before adding one.
  "style-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

app.use(requestLog);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(asyncRoute(attachUser));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Unlock/status must stay reachable without the gate — everything else
// behind /api is blocked at requireSiteAccess until that password's given.
app.use('/api/site-access', siteAccessRoutes);
// The public API, also in front of the password. An endpoint other people
// build against is not public if it is behind a password only testers have.
app.use('/api/v1', publicApiRoutes);
// The page a list's erasure link lands on, in front of the password too.
// Asking for your own words to be deleted is a right, and a password prompt
// in the way of it is a refusal by another name. It serves plain HTML and
// a GET never erases — see src/routes/lists.js.
//
// UNDER /api/ ALTHOUGH IT IS A PAGE, because every installed box has its own
// copy of the nginx template from the day it was installed, and that copy
// proxies /api/ and nothing new. A /forget location would 404 on all of them
// until somebody edited nginx by hand — and the link is in emails already
// sent. /api/ is also the one prefix the service worker never caches.
app.use('/api/forget', listErasePage);
// Agreeing to receive a list's new entries. In front of the password for
// the same reason: the address being named may never have had it.
app.use('/api/list-mail', listMailConfirmPage);
// Lists, in front of the password, EACH ONE DECIDING. A list an
// administrator opened (outside_access link or door, migration 047) works
// without the password; every other one answers exactly what the gate would.
// The decision is pastCurtain in src/routes/lists.js.
app.use('/api/lists', listPublicRoutes);
// What the password page offers: titles and addresses of what is open.
app.get('/api/doors', asyncRoute(async (req, res) => res.json(await doors())));
// THE GATE, with one narrow exception: filing into a logbook an
// administrator opened without the password (outside_access, migration 047).
// outsidePass in src/doors.js is the whole allow-list. It runs first and only
// MARKS the request; the gate below is unchanged and reads the mark. Anything
// the allow-list does not name meets the password exactly as before.
app.use('/api', asyncRoute(async (req, res, next) => {
  if (!(await hasSiteAccess(req)) && await outsidePass(req)) req.outsidePass = true;
  next();
}));
app.use('/api', asyncRoute(requireSiteAccess));

// First-run setup. Behind requireSiteAccess like everything else — the
// curtain password is the only thing gating it, deliberately, and the
// router refuses every write once the deployment has an owner.
app.use('/api/setup', setupRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportsRoutes);
// Which logbooks are open and what each one asks.
//
// BEHIND THE CURTAIN, with the route that takes a report. It was briefly in
// front, on the reasoning that a form must render before anybody signs in —
// but /api/reports is gated, so a reporter is already past the curtain by
// the time a form is any use, and serving this in front would have handed
// every passer-by the titles of a deployment's intakes and the shape of
// their questionnaires. That is build state given away for nothing.
//
// A DRAFT IS NOT SERVED HERE AT ALL, gate or no gate: a questionnaire still
// being written is not discoverable by guessing a slug.
app.use('/api/logbooks', logbookPublicRoutes);
app.use('/api/list-review', listReviewRoutes);
// Sits behind requireSiteAccess like everything else. The router itself
// 404s entirely unless ATTACHMENTS_ENABLED is set and storage is configured.
app.use('/api/uploads', uploadsRoutes);
app.use('/api/me', meRoutes);
/* The door a reporter answers an evidence request through. Unauthenticated
   — somebody asked months after filing may no longer have their sign-in —
   but mounted BEHIND the site gate like /api/reports, because a gated
   deployment is gated for reporters too and the confirmation link already
   works that way. Making an exception here would be a hole in the curtain
   that nothing else has. */
app.use('/api/evidence', evidenceRoutes);
app.use('/api/moderators', moderatorsRoutes);
app.use('/api/admin/logbooks', logbookAdminRoutes);
app.use('/api/admin/lists', listAdminRoutes);
app.use('/api/admin', adminRoutes);
// The operator's own imprint and privacy policy, readable by anybody who
// can reach the site at all. Behind the gate on purpose — see the file.
app.use('/api/legal', legalRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/press', pressRoutes);
app.use('/api/orgs', orgRoutes);
// The invitee's side. Not under /api/orgs, because somebody following an
// invitation link has neither an account nor a membership yet.
app.use('/api/invitations', invitationRoutes);
// The Alliance directory. Public by intent; behind the curtain while the
// site is — see the note at the top of src/routes/alliance.js.
app.use('/api/alliance', allianceRoutes);
app.use('/api/intake', intakeRoutes);
// /updatenotes used to serve a catch-up document for testers who had been
// away. That document is gone — everybody following the project is current
// now, and the changelog says the same thing without a file that goes stale
// the moment it is written.
//
// The address is not deleted, because it was handed out in emails and in
// documents already printed. It falls through to the frontend's catch-all,
// where the route table lands it on the documents list. A link somebody
// saved six weeks ago arriving somewhere sensible costs one comment; a 404
// costs their trust in every other link we gave them.

app.use('/api/stats', statsRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/home', homeRoutes);

// Where the reportlog.app / reportlogs.app redirects land. Deliberately
// not behind requireSiteAccess: someone arriving here hasn't unlocked
// anything yet, and gating it would show a password box instead of the
// install instructions they followed a link to see.
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// How to stand one of these up. Same reasoning as /app and the same
// deliberate omission of requireSiteAccess: it is the link you hand to
// somebody who has NOT been let past the curtain, so gating it would show
// them a password box instead of the instructions they followed a link to
// read. It documents the software, so it names the software throughout and
// a renamed deployment does not rename it.
//
// public/docs.html is also served straight off disk by nginx, so
// /docs.html works on any deployment with no nginx change at all. This
// route only adds the tidier /docs, which needs the one-line location
// block in contrib/nginx/reportlog.conf.
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

// The style guide: every colour, size and component the site is built from,
// drawn with the classes that draw it. Ungated for the same reason as /docs
// — it is a page about the software's design, holds no reports and no
// settings, and is the link you hand to somebody working on the look. The
// file is also served straight off disk by nginx, so /styleguide.html works
// on any deployment; this route only adds the tidier /styleguide.
app.get('/styleguide', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'styleguide.html'));
});

// BEFORE express.static, so this answers instead of the file on disk. The
// file stays in public/ as the fallback a bare static server would serve —
// it names the software, which is right when nothing has been renamed.
//
// In production nginx serves public/ itself, so it must be told to send
// this one path here instead. contrib/nginx/*.conf does; a deployment whose
// nginx predates that goes on serving the static file and is wrong only in
// the way it was already wrong. See contrib/README.md.
app.get('/manifest.webmanifest', async (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  // Named after the deployment, so a rename is not served from a cache.
  res.setHeader('Cache-Control', 'no-cache');
  res.json(await buildManifest());
});

// nginx serves public/ directly in production; this is a fallback so the
// app also works standalone (local dev, or if the nginx split ever drifts).
app.use(express.static(path.join(__dirname, 'public'), {
  // `/` must NOT be answered from disk. express.static's default index
  // behaviour would serve public/index.html here, ahead of the catch-all
  // below that renders the deployment's name into the tab — so the one
  // route that matters most would be the one route still saying ReportLog.
  index: false,
  setHeaders(res, filePath) {
    // Spelled out rather than left to mime lookup: an installable app hangs
    // on these two being served correctly.
    if (filePath.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
    // A stale service worker pins users to an old shell, so it is always
    // revalidated. (The browser also caps sw.js caching at 24h itself.)
    if (filePath.endsWith(`${path.sep}sw.js`)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Client-side routes (/board, /about/changelog, /r/:ref …) are real URLs, so
// anything that isn't a file or an API call has to return index.html and let
// the frontend route it. nginx does this with `try_files $uri $uri/
// /index.html`; mirroring it here keeps deep links working standalone too.
// /api/* is excluded so an unmatched endpoint still 404s as an API call
// rather than silently returning a page.
app.get('*', async (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  // Rendered rather than sent from disk, so the browser tab carries the
  // deployment's name in the FIRST frame instead of flashing the software's
  // and being corrected by script. Cached against the name; a rename is the
  // only thing that rebuilds it.
  res.type('html').send(await renderIndex());
});

// Last, after every route: anything asyncRoute caught arrives here, gets
// logged with the request id the client was given, and becomes a 500 rather
// than a dropped connection.
app.use(errorHandler);

// A deploy here is a git pull plus a restart, so a changed build id at
// boot means something just shipped — arm the "under active development"
// notice for testers. Deliberately non-fatal: the app must still start if
// the database is briefly unreachable.
// The row a report's digest names has to exist before any report can name
// it. Insert-only and idempotent: an unchanged wording is a no-op, a changed
// one is a new row, and the table's trigger refuses anything else.
//
// Non-fatal, like arm-on-deploy below: the app must still start if the
// database is briefly unreachable. A submission whose digest is unknown is
// refused at the route, so a failure here cannot let an uninterpretable
// permission into the archive.
recordCardTexts()
  .catch((e) => console.error('[consent-text] could not record the card wording', e));

armDevModeOnDeploy()
  .then((r) => {
    if (r.armed) console.log(`[dev-mode] build ${r.from} -> ${r.to}, notice armed for ${DEV_MODE_HOURS}h`);
  })
  .catch((e) => console.error('[dev-mode] arm-on-deploy failed', e));

// Fail at boot rather than serving a page that quietly ignores a rename.
// Substitution that silently matches nothing is the failure mode this whole
// arrangement exists to avoid, so it is checked once, loudly, on the way up.
assertAnchors();

const port = process.env.PORT || 5000;
app.listen(port, '127.0.0.1', () => {
  console.log(`ReportLog listening on 127.0.0.1:${port}`);
});
