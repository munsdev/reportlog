// Where published reports came from. See src/mapData.js for what is
// counted and why, and src/heatMaps.js for who may configure it.
import express from 'express';
import { getMap } from '../mapData.js';
import { placedHeatMaps } from '../heatMaps.js';
import { publicArchiveAvailable } from '../publication.js';
import { MAP_SLOTS } from '../mapSlots.js';
import { asyncRoute } from '../asyncRoute.js';

const router = express.Router();

/* THE PLACEMENT LIST: which maps exist, what they are called, where they
   go. No counts and no thresholds — this is what the front end needs to
   put a map in a slot, and nothing a reader could use to undo one.
   An unpublished archive has no maps to place, and says so the same way
   everything else does rather than 404ing. */
router.get('/', asyncRoute(async (req, res) => {
  if (!await publicArchiveAvailable()) return res.json({ published: false, maps: [] });
  res.json({
    published: true,
    maps: await placedHeatMaps(),
    // The slots are the front end's own, but sending them means the page
    // does not carry a second copy of the list that can drift from this one.
    slots: MAP_SLOTS.map((s) => ({
      id: s.id, container: s.container, pane: s.pane, sub: s.sub || null,
    })),
  });
}));

/* 200 with `published: false`, never 404 or 403 — the same answer
   /api/stats gives for the same reason. A deployment that does not
   publish a map has not lost one and is not refusing this particular
   caller; it is saying it does not publish one, which is true, useful,
   and something a client can render.

   A SLUG THAT DOES NOT EXIST GETS THE SAME SHAPE, deliberately. Answering
   404 for an unknown map and 200 for a disabled one tells an unauthenticated
   caller which maps an operator has made but not published, which is
   build state given away free. */
router.get('/:slug', asyncRoute(async (req, res) => {
  // The module decides which refusal applies and says so in its own
  // words; this route does not second-guess it.
  res.json(await getMap(req.params.slug));
}));

export default router;
