/**
 * Heat maps (workstream I): where published reports came from, as counts.
 *
 * TWO AUDIENCES:
 *
 *   /api/maps/…        a reader: which maps are placed where, and one map's
 *                      counts. Behind the site password like the rest.
 *   /api/admin/maps    administrators: make, change, arrange and delete maps,
 *                      and say which question places a report.
 *
 * WHAT A READER GETS IS DECIDED ON THE SERVER. The threshold is applied
 * before a map is sent, and an area under it travels as a bare code in
 * `suppressed.areas` with no count anywhere in the payload. There is no
 * reader-facing control for the threshold, the views or the feeds: a reader
 * who could lower the threshold could undo the only thing it is for.
 *
 * Request bodies are typed loosely on purpose: the module refuses with a
 * sentence a person can read, and a schema error would refuse first with one
 * they cannot.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

const Id = z.coerce.number().int().positive();

/** The two planes the outline data has: US states, and the world's countries. */
export const MapPlane = z.enum(['us', 'world']);
export type MapPlane = z.infer<typeof MapPlane>;
export const MAP_PLANES: readonly MapPlane[] = MapPlane.options;

/**
 * What a map's colour can show. `volume` is how many. `outcome` is the
 * operator's positive/negative reading of one closed question, as a share of
 * the reports that answered it.
 */
export const MapView = z.enum(['volume', 'outcome']);
export type MapView = z.infer<typeof MapView>;
export const MAP_VIEWS: readonly MapView[] = MapView.options;

export const Stance = z.enum(['positive', 'neutral', 'negative']);
export type Stance = z.infer<typeof Stance>;

/**
 * The floor under every threshold. The database has the same CHECK. 1, by
 * the owner's decision: an area may be shaded from its first report.
 */
export const MIN_AREA_FLOOR = 1;
export const DEFAULT_MIN_AREA = 3;

/**
 * WHERE A MAP CAN GO, and that is the whole list: places the website has,
 * not a page builder. Adding one is a line here and a `<MapSlot>` on the page
 * it names, never a migration (`heat_maps.slot` has no CHECK for that
 * reason). Every map also has its own address, /map/<slug>, whatever its
 * slot.
 *
 * The board's three are legacy's: a tab of its own, above the reports, and
 * with the figures (workstream D, apps/web/src/features/board/).
 */
export const MAP_SLOTS = [
  {
    id: 'own_page',
    label: 'Only at its own address',
    description:
      'At /map/<short name> and nowhere else. Somebody reaches it from a link you share.',
  },
  {
    id: 'board_tab',
    label: 'Its own tab on the board',
    description:
      'A Maps page beside the reports and the numbers, at /board/maps. Best for a map somebody comes to the board to read.',
  },
  {
    id: 'board_reports',
    label: 'Above the report board',
    description:
      'At the top of the list of reports, so the map and the reports it summarises are on one screen.',
  },
  {
    id: 'board_numbers',
    label: 'With the numbers',
    description:
      'Under the counts on the board’s “By the numbers” page, where a reader is already looking at totals.',
  },
  {
    id: 'home',
    label: 'The front page',
    description:
      'Below the buttons on the front page. The most visible place there is, and the one to think hardest about before using.',
  },
] as const;
export type MapSlotId = (typeof MAP_SLOTS)[number]['id'];
export const MAP_SLOT_IDS: readonly string[] = MAP_SLOTS.map((s) => s.id);
export const DEFAULT_MAP_SLOT: MapSlotId = 'own_page';

export function isMapSlot(id: unknown): id is MapSlotId {
  return typeof id === 'string' && MAP_SLOT_IDS.includes(id);
}

// ── what a reader gets ──────────────────────────────────────────────────

/** A placed map: what exists, what it is called, where it goes. No counts. */
export const PlacedMap = z.object({
  slug: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  slot: z.string(),
  position: z.number().int(),
});
export type PlacedMap = z.infer<typeof PlacedMap>;

/**
 * One shaded area. `assessed` is the outcome view's denominator: only reports
 * from the outcome question's logbook can carry a stance, so dividing by `n`
 * would drag every area toward "evenly split".
 */
export const AreaCount = z.object({
  n: z.number().int(),
  assessed: z.number().int(),
  pos: z.number().int(),
  neg: z.number().int(),
  neu: z.number().int(),
});
export type AreaCount = z.infer<typeof AreaCount>;

export const PublishedMap = z.object({
  published: z.literal(true),
  slug: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  as_of: z.string(),
  note: z.string(),
  /** The line that goes beside every number (platform.ts NOT_A_SAMPLE). */
  not_a_sample: z.string(),
  threshold: z.number().int(),
  /** What is being counted, named by the server: an entry is not a report. */
  unit: z.object({ one: z.string(), many: z.string() }),
  planes: z.array(MapPlane),
  views: z.array(MapView),
  outcome_question: z.string().nullable(),
  /**
   * The answer key a click on an area can filter the board by, or null when
   * the logbooks feeding the map seal their place under different keys.
   */
  filter_key: z.string().nullable(),
  /** Only areas at or over the threshold. */
  areas: z.record(z.string(), AreaCount),
  /**
   * Areas under it, as BARE CODES. `reports` is their total, and null when
   * there is exactly one: then the total would be that area's count.
   */
  suppressed: z.object({
    areas: z.array(z.string()),
    reports: z.number().int().nullable(),
  }),
  /**
   * The county threshold, or null when the map shows states only. A county
   * under it is never sent on its own: it is only part of its state's count.
   */
  county_threshold: z.number().int().nullable(),
  /** Only counties at or over `county_threshold`, keyed `US-AZ-04013`. */
  counties: z.record(z.string(), AreaCount),
});
export type PublishedMap = z.infer<typeof PublishedMap>;

export const UnpublishedMap = z.object({
  published: z.literal(false),
  reason: z.string(),
});

export const MapAggregate = z.discriminatedUnion('published', [PublishedMap, UnpublishedMap]);
export type MapAggregate = z.infer<typeof MapAggregate>;

export const listPlacedMaps = defineRoute({
  method: 'GET',
  path: '/api/maps',
  summary: 'The maps that are turned on, and where each one goes.',
  response: z.object({ maps: z.array(PlacedMap) }),
});

export const getMap = defineRoute({
  method: 'GET',
  path: '/api/maps/:slug',
  summary: 'One map: its counts, with every area under its threshold sent without a count.',
  params: z.object({ slug: z.string() }),
  response: MapAggregate,
});

// ── administrators ──────────────────────────────────────────────────────

export const HeatMapAdmin = z.object({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  enabled: z.boolean(),
  min_area: z.number().int(),
  /** Null: states only. N: a county is shown on its own from N reports. */
  county_min: z.number().int().nullable(),
  planes: z.array(MapPlane),
  views: z.array(MapView),
  /** Empty means every logbook. */
  logbook_ids: z.array(z.number().int()),
  /** Empty means no lists. */
  list_ids: z.array(z.number().int()),
  outcome: z
    .object({
      logbook_id: z.number().int(),
      key: z.string(),
      stances: z.record(z.string(), Stance),
    })
    .nullable(),
  slot: z.string(),
  position: z.number().int(),
  updated_at: z.string(),
});
export type HeatMapAdmin = z.infer<typeof HeatMapAdmin>;

export const MapSlotInfo = z.object({ id: z.string(), label: z.string(), description: z.string() });

export const listHeatMaps = defineRoute({
  method: 'GET',
  path: '/api/admin/maps',
  summary: 'Every map, on or off, in slot order, and the slots there are.',
  response: z.object({ maps: z.array(HeatMapAdmin), slots: z.array(MapSlotInfo) }),
});

/** A question as the map panel needs it. */
const CandidateQuestion = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.string(),
});

export const LogbookCandidate = z.object({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  launched: z.boolean(),
  /** The question that places a report, or null: this logbook is on no map yet. */
  place_key: z.string().nullable(),
  /** Its location questions. Empty says why it cannot be mapped. */
  places: z.array(CandidateQuestion),
  /** Its questions with a fixed set of answers, any of which can colour an outcome. */
  outcomes: z.array(CandidateQuestion.extend({ options: z.array(z.string()) })),
});
export type LogbookCandidate = z.infer<typeof LogbookCandidate>;

export const ListCandidate = z.object({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  place_key: z.string().nullable(),
  /** Its location questions, and whether each one's answers are kept. */
  places: z.array(CandidateQuestion.extend({ durable: z.boolean() })),
});
export type ListCandidate = z.infer<typeof ListCandidate>;

export const listMapCandidates = defineRoute({
  method: 'GET',
  path: '/api/admin/maps/candidates',
  summary: 'Every logbook and list, with the questions that could feed a map.',
  response: z.object({ logbooks: z.array(LogbookCandidate), lists: z.array(ListCandidate) }),
});

const HeatMapInput = z.object({
  slug: z.unknown().optional(),
  title: z.unknown().optional(),
  blurb: z.unknown().optional(),
  enabled: z.unknown().optional(),
  min_area: z.unknown().optional(),
  county_min: z.unknown().optional(),
  planes: z.unknown().optional(),
  views: z.unknown().optional(),
  logbook_ids: z.unknown().optional(),
  list_ids: z.unknown().optional(),
  outcome: z.unknown().optional(),
  slot: z.unknown().optional(),
  position: z.unknown().optional(),
});

export const createHeatMap = defineRoute({
  method: 'POST',
  path: '/api/admin/maps',
  summary: 'Make a map. It is off until it is turned on.',
  body: HeatMapInput,
  response: HeatMapAdmin,
});

export const updateHeatMap = defineRoute({
  method: 'PATCH',
  path: '/api/admin/maps/:id',
  summary: 'Change a map. Only the settings sent are changed.',
  params: z.object({ id: Id }),
  body: HeatMapInput,
  response: HeatMapAdmin,
});

export const deleteHeatMap = defineRoute({
  method: 'DELETE',
  path: '/api/admin/maps/:id',
  summary: 'Delete a map. It holds no reports, so no report goes with it.',
  params: z.object({ id: Id }),
  response: z.object({ ok: z.literal(true) }),
});

export const arrangeHeatMaps = defineRoute({
  method: 'PUT',
  path: '/api/admin/maps/arrangement',
  summary: 'Put these maps in this slot, in this order.',
  body: z.object({ slot: z.unknown(), ids: z.unknown() }),
  response: z.object({ maps: z.array(HeatMapAdmin) }),
});

export const previewHeatMap = defineRoute({
  method: 'GET',
  path: '/api/admin/maps/:id/preview',
  summary:
    'What a map would publish if it were on, under the same threshold, and how many reports it could not place.',
  params: z.object({ id: Id }),
  response: z.object({
    map: MapAggregate,
    unplaced: z.object({ no_question: z.number().int(), country_only: z.number().int() }),
  }),
});

export const setLogbookPlaceQuestion = defineRoute({
  method: 'PUT',
  path: '/api/admin/maps/places/logbooks/:id',
  summary: 'Say which location question places this logbook’s reports, or none.',
  params: z.object({ id: Id }),
  body: z.object({ key: z.unknown() }),
  response: z.object({ logbooks: z.array(LogbookCandidate), lists: z.array(ListCandidate) }),
});

export const setListPlaceQuestion = defineRoute({
  method: 'PUT',
  path: '/api/admin/maps/places/lists/:id',
  summary: 'Say which location question places this list’s entries, or none.',
  params: z.object({ id: Id }),
  body: z.object({ key: z.unknown() }),
  response: z.object({ logbooks: z.array(LogbookCandidate), lists: z.array(ListCandidate) }),
});
