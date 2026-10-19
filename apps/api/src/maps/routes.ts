/**
 * Heat maps over HTTP.
 *
 *   /api/maps, /api/maps/:slug   a reader. Behind the site password like the
 *                                rest of the site: nothing here is a door.
 *   /api/admin/maps/…            administrators, guarded once for the scope.
 *
 * A reader's map comes only from `computeMap`, which applies the publication
 * rule and the threshold itself. Nothing on the staff side can reach a
 * reader except through it.
 */
import {
  MAP_SLOTS,
  arrangeHeatMaps,
  createHeatMap,
  deleteHeatMap,
  getMap,
  listHeatMaps,
  listMapCandidates,
  listPlacedMaps,
  previewHeatMap,
  setListPlaceQuestion,
  setLogbookPlaceQuestion,
  updateHeatMap,
} from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PUBLICATION_OFF, publicArchiveAvailable } from '../board/publication.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { roleGuard } from '../identity/guards.ts';
import { MapCache, computeMap } from './aggregate.ts';
import {
  arrangeMaps,
  candidates,
  createMap,
  deleteMap,
  setListPlace,
  setLogbookPlace,
  updateMap,
} from './manage.ts';
import { allMaps, mapById, mapBySlug, toAdmin } from './rows.ts';

export interface MapRouteDeps {
  db: Database;
  /** How long one computation serves every reader. Tests pass 0. */
  cacheMs?: number;
}

const bodyOf = (request: FastifyRequest): Record<string, unknown> =>
  (request.body ?? {}) as Record<string, unknown>;

export function mapRoutes(app: FastifyInstance, { db, cacheMs = 60_000 }: MapRouteDeps): void {
  const cache = new MapCache(cacheMs);

  // ── a reader ──────────────────────────────────────────────────────────

  route(app, listPlacedMaps, async () => ({
    // The placement list: no counts, no threshold, no feeds. A site that
    // publishes no archive places no maps either (board/publication.ts).
    maps: !(await publicArchiveAvailable(db))
      ? []
      : (await allMaps(db))
          .filter((m) => m.enabled)
          .map((m) => ({
            slug: m.slug,
            title: m.title,
            blurb: m.blurb,
            slot: m.slot,
            position: m.position,
          })),
  }));

  route(app, getMap, async ({ params }) => {
    // THE ARCHIVE'S OWN SWITCH OUTRANKS EVERY MAP, and is asked before the
    // cache so switching it off takes effect at once.
    if (!(await publicArchiveAvailable(db))) throw notFound(PUBLICATION_OFF.reason);
    const map = await cache.get(
      params.slug,
      async () => (await computeMap(db, await mapBySlug(db, params.slug))).map,
    );
    // A disabled map and one that never existed answer alike.
    if (!map.published) throw notFound(map.reason);
    return map;
  });

  // ── administrators ───────────────────────────────────────────────────

  void app.register((staff, _opts, done) => {
    staff.addHook('preHandler', roleGuard(['admin']));
    // Any change an operator makes is seen by readers at once, not after the
    // cache's minute: turning a map off must take it off. Cleared after the
    // write and before the reply, so nothing can read in between.
    const changed = async <T>(write: Promise<T>): Promise<T> => {
      try {
        return await write;
      } finally {
        cache.clear();
      }
    };

    route(staff, listHeatMaps, async () => ({
      maps: (await allMaps(db)).map(toAdmin),
      slots: MAP_SLOTS.map((s) => ({ id: s.id, label: s.label, description: s.description })),
    }));

    route(staff, listMapCandidates, () => candidates(db));

    route(staff, createHeatMap, ({ request }) => changed(createMap(db, bodyOf(request))));

    route(staff, updateHeatMap, ({ params, request }) =>
      changed(updateMap(db, Number(params.id), bodyOf(request))),
    );

    route(staff, deleteHeatMap, async ({ params }) => {
      await changed(deleteMap(db, Number(params.id)));
      return { ok: true as const };
    });

    route(staff, arrangeHeatMaps, async ({ request }) => {
      const b = bodyOf(request);
      return { maps: await changed(arrangeMaps(db, b.slot, b.ids)) };
    });

    route(staff, previewHeatMap, async ({ params }) => {
      const row = await mapById(db, Number(params.id));
      if (!row) throw notFound('That map does not exist.');
      return computeMap(db, row, { preview: true });
    });

    route(staff, setLogbookPlaceQuestion, async ({ params, request }) => {
      await changed(setLogbookPlace(db, Number(params.id), bodyOf(request).key ?? null));
      return candidates(db);
    });

    route(staff, setListPlaceQuestion, async ({ params, request }) => {
      await changed(setListPlace(db, Number(params.id), bodyOf(request).key ?? null));
      return candidates(db);
    });

    done();
  });
}
