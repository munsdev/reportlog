/**
 * Reading this deployment's imprint and privacy policy.
 *
 * BEHIND THE SITE PASSWORD, like every other word on the site and unlike
 * the consent texts.
 *
 * That looks backwards for an imprint, which in much of the EU has to be
 * readily available — so the reasoning, for whoever wonders later. The
 * obligation attaches to a deployment the public can reach, and a
 * deployment the public can reach is not gated: the curtain is a
 * pre-launch measure and lifting it is what going live means. A gated
 * deployment, meanwhile, is somebody's half-finished install, and
 * publishing the operator's legal name and home address to anybody who
 * finds the hostname is a real cost with nothing bought — the gate exists
 * precisely to keep the site's writing off the internet until its operator
 * is ready. So: gated while gated, public the moment it is public, which
 * is the moment it matters.
 *
 * Writing them is admin-only and lives in routes/admin.js.
 */
import express from 'express';
import { renderCopy } from '../figures.js';
import { legalSettings, resolveLegalText, LEGAL_KINDS } from '../legalText.js';
import { siteCopy } from '../siteCopy.js';
import { asyncRoute } from '../asyncRoute.js';

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  try {
    const settings = await legalSettings();
    // Short. An operator who has just corrected their privacy policy should
    // not find the old one still being served an hour later.
    res.set('Cache-Control', 'no-cache');
    res.json(Object.fromEntries(LEGAL_KINDS.map((k) => [k, resolveLegalText(settings, k)])));
  } catch (e) {
    // null, never a placeholder and never a guess. A deployment that has
    // published no imprint must not appear to have published one because
    // the database hiccuped.
    console.error('[legal] read failed', e);
    res.json(Object.fromEntries(LEGAL_KINDS.map((k) => [k, null])));
  }
}));

/**
 * The words this deployment puts on its own pages.
 *
 * Mounted here rather than in its own router because it is the same kind of
 * thing as the imprint — operator-written text, read by the page, behind
 * the gate like every other word on the site.
 *
 * Every slot always resolves: what the operator wrote, or what the software
 * ships. There is no null here and no "not written yet", which is the
 * deliberate difference from the legal text above. A front page has a safe
 * default; a privacy policy does not.
 */
router.get('/copy', asyncRoute(async (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache');
    // {{ … }} placeholders become numbers here, on the way out — the stored
    // text keeps the placeholder, so the editor edits what was written.
    res.json(await renderCopy(await siteCopy()));
  } catch (e) {
    // An empty object leaves the markup's own wording in place, which is
    // the same text the fallbacks carry.
    console.error('[legal] copy read failed', e);
    res.json({});
  }
}));

export default router;
