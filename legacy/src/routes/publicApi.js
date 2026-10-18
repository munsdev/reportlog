/**
 * The public API. Version 1.
 *
 * Sits in front of the site password, which everything else on /api does
 * not. That is the whole point: an endpoint anyone can build against has to
 * be reachable by people who have no account here and never will.
 *
 * The address is versioned and the shape under /api/v1 is a promise. Fields
 * may be added; existing ones are not renamed, retyped or removed without a
 * /api/v2. Somebody's dashboard should still work in a year, and there is
 * no way to tell them it broke.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getStats } from '../stats.js';
import { allCardTexts } from '../consentText.js';
import { RELEASE_VERSION } from '../appVersion.js';
import { SITE_ORIGIN } from '../siteOrigin.js';
import { asyncRoute } from '../asyncRoute.js';
import { publicArchiveAvailable, PUBLICATION_OFF } from '../publication.js';

const router = express.Router();

// Public data, so any page may read it. Reads only: no cookies are accepted
// or sent, and nothing here is a write, so there is nothing for a hostile
// page to forge.
router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '86400');
  res.set('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// Generous, because this is meant to be used. It exists so that one badly
// written widget polling in a loop cannot take the site down for everyone
// else; the minute-long cache behind it means most of these never reach the
// database anyway.
router.use(rateLimit({ windowMs: 60 * 1000, max: 120, keyGenerator: (req) => req.ip }));

// An index that describes itself, so somebody who finds this address
// without finding the documentation still knows what they have.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    name: 'ReportLog public API',
    version: 1,
    documentation: `${SITE_ORIGIN}/api.html`,
    // SCOPED, AND THE SCOPE IS THE POINT. This used to say the data was
    // CC BY 4.0 with no limit on what "the data" meant, which is a licence
    // the operator cannot grant. A report is its reporter's own account:
    // they permitted publication here, not relicensing by anybody who
    // fetches it. What the operator genuinely can offer is what these two
    // endpoints actually serve — counts it computed, and wordings it wrote.
    //
    // Nothing here serves report text, so this is not a restriction on
    // anything that used to work. It is the same offer, stated honestly
    // enough that it survives being read by a lawyer.
    licence: {
      covers: 'The aggregate counts and the consent wordings served under /api/v1.',
      terms: 'CC BY 4.0',
      attribution: `ReportLog — ${SITE_ORIGIN}`,
      excludes: 'The reports themselves. Each is its own author\'s account, published here '
        + 'with their permission; that permission is not ours to pass on, so no licence over '
        + 'report content is offered or implied.',
    },
    endpoints: {
      '/api/v1/stats': 'Aggregate counts over the published record. Cached for 60 seconds.',
      '/api/v1/consent-texts': 'Every wording of the publication question this site has shown, by digest. A published report seals the digest of the exact sentence its reporter answered; this is how that digest is read back.',
    },
    stability: 'Fields may be added. Existing fields will not be renamed, retyped or removed without a new version at /api/v2.',
  });
});

router.get('/stats', asyncRoute(async (req, res) => {
  // A deployment that does not publish an archive does not publish counts
  // over it either. An aggregate is still a statement about the reports,
  // and "247 reports, 12 in Ohio" from a site that publishes none of them
  // is the archive leaking out through the one door left open.
  if (!await publicArchiveAvailable()) {
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ ...PUBLICATION_OFF, api_version: 1 });
  }
  try {
    const body = await getStats();
    // A minute matches the server-side cache, so a client honouring this
    // never asks for something newer than exists.
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      ...body,
      api_version: 1,
      release: RELEASE_VERSION,
      licence: `CC BY 4.0 (these figures only; not the reports) — ${SITE_ORIGIN}`,
      documentation: `${SITE_ORIGIN}/api.html`,
    });
  } catch (e) {
    console.error('[public-api] stats failed', e);
    res.status(503).json({ error: 'unavailable' });
  }
}));

/**
 * The wording behind every sealed publication answer.
 *
 * Here rather than behind the site password, for the reason at the top of
 * this file. A report's `may_publish` is sealed beside the digest of the
 * exact sentence that was answered, and the value means nothing without the
 * sentence — so somebody checking a published report needs this, and by
 * definition they are somebody with no account here. Leaving it behind the
 * password would have made a verifiable claim checkable only by people who
 * are already inside.
 *
 * Append-only at the database, so an entry that has been published stays
 * readable. Who introduced a wording is recorded as a role rather than a
 * person, because this leaves the building.
 */
router.get('/consent-texts', asyncRoute(async (req, res) => {
  try {
    // An hour: these change about never, and a reader checking an old report
    // needs the row that was in force then, which is not going to move.
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      texts: await allCardTexts(),
      api_version: 1,
      // These wordings are the site's own, so they are genuinely the
      // operator's to license — unlike the reports answered against them.
      licence: `CC BY 4.0 (these wordings only; not the reports) — ${SITE_ORIGIN}`,
      documentation: `${SITE_ORIGIN}/api.html`,
    });
  } catch (e) {
    console.error('[public-api] consent-texts failed', e);
    res.status(503).json({ error: 'unavailable' });
  }
}));

export default router;
