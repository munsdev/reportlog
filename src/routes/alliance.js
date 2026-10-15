/**
 * The public Alliance directory.
 *
 * Mounted behind requireSiteAccess rather than on /api/v1, deliberately and
 * reversibly. The directory IS meant to be public, but this deployment is
 * gated while it is being finished, and an organization opting in today
 * would find itself published on an internet that cannot yet see the site
 * it is being published beside. The two failure modes are not symmetrical:
 * behind the curtain it is merely not public yet, which is fixed by opening
 * the site; in front of it, an organization's name and headcount are out
 * before anybody meant them to be, and that cannot be taken back.
 *
 * Moving it to /api/v1 when the site opens is one line here and one in
 * server.js.
 */
import express from 'express';
import { directory, DIRECTORY_NAME, DISCLAIMER } from '../alliance.js';
import { asyncRoute } from '../asyncRoute.js';

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  // The disclaimer ships with the rows rather than living only in the page
  // template. A client that renders this directory should not be able to
  // render it without the sentence that says what it is not.
  res.json({
    name: DIRECTORY_NAME,
    disclaimer: DISCLAIMER,
    organizations: await directory(),
  });
}));

export default router;
