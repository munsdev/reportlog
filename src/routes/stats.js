// The site's own board reads the same aggregate the public API serves.
// See src/stats.js for what is counted and why.
import express from 'express';
import { getStats } from '../stats.js';
import { asyncRoute } from '../asyncRoute.js';
import { publicArchiveAvailable, PUBLICATION_OFF } from '../publication.js';

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  if (!await publicArchiveAvailable()) return res.json(PUBLICATION_OFF);
  res.json(await getStats());
}));

export default router;
