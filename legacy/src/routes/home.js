/**
 * The front page's buttons.
 *
 * BEHIND THE GATE, like the list endpoint it sits beside. The front page's
 * buttons name every open logbook and list on the deployment, which is a
 * catalogue of what this archive collects — not something to hand out in
 * front of a password. What a visitor without the password may be offered
 * is decided in one place, `src/doors.js`, and this is not on that
 * allow-list.
 *
 * src/homeButtons.js resolves the arrangement and holds the reasoning.
 */
import express from 'express';
import { hasSiteAccess, LOCKED } from '../siteAccess.js';
import { homeButtons } from '../homeButtons.js';
import { asyncRoute } from '../asyncRoute.js';

const router = express.Router();

router.get('/buttons', asyncRoute(async (req, res) => {
  if (!await hasSiteAccess(req)) return res.status(401).json(LOCKED);
  res.json({ buttons: await homeButtons() });
}));

export default router;
