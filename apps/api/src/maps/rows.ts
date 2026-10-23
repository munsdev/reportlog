/**
 * A heat map's row, read once and shaped once, so every caller sees numbers
 * where the database has bigint arrays and a checked reading where it has
 * jsonb.
 */
import type { HeatMapAdmin, MapPlane, MapView, Stance } from '@reportlog/contracts';
import { Stance as StanceSchema } from '@reportlog/contracts';
import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { HeatMaps } from '../db/schema.gen.ts';

export interface HeatMapRow {
  id: number;
  slug: string;
  title: string;
  blurb: string | null;
  enabled: boolean;
  min_area: number;
  county_min: number | null;
  planes: MapPlane[];
  views: MapView[];
  logbook_ids: number[];
  list_ids: number[];
  outcome_logbook_id: number | null;
  outcome_key: string | null;
  outcome_stances: Record<string, Stance>;
  slot: string;
  position: number;
  updated_at: Date;
}

// pg returns a bigint[] as strings; only the scalar int8 has a parser.
const ids = (value: unknown): number[] =>
  Array.isArray(value) ? value.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];

/** Only the stances that are one of the three, so a hand-edited row reads as less, never as more. */
export function stancesOf(value: unknown): Record<string, Stance> {
  const out: Record<string, Stance> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [answer, stance] of Object.entries(value)) {
      const s = StanceSchema.safeParse(stance);
      if (s.success) out[answer] = s.data;
    }
  }
  return out;
}

export function shape(r: Selectable<HeatMaps>): HeatMapRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    blurb: r.blurb,
    enabled: r.enabled,
    min_area: r.min_area,
    county_min: r.county_min,
    planes: r.planes.filter((p): p is MapPlane => p === 'us' || p === 'world'),
    views: r.views.filter((v): v is MapView => v === 'volume' || v === 'outcome'),
    logbook_ids: ids(r.logbook_ids),
    list_ids: ids(r.list_ids),
    outcome_logbook_id: r.outcome_logbook_id,
    outcome_key: r.outcome_key,
    outcome_stances: stancesOf(r.outcome_stances),
    slot: r.slot,
    position: r.position,
    updated_at: r.updated_at,
  };
}

export function toAdmin(r: HeatMapRow): HeatMapAdmin {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    blurb: r.blurb,
    enabled: r.enabled,
    min_area: r.min_area,
    county_min: r.county_min,
    planes: r.planes,
    views: r.views,
    logbook_ids: r.logbook_ids,
    list_ids: r.list_ids,
    outcome:
      r.outcome_logbook_id !== null && r.outcome_key !== null
        ? { logbook_id: r.outcome_logbook_id, key: r.outcome_key, stances: r.outcome_stances }
        : null,
    slot: r.slot,
    position: r.position,
    updated_at: r.updated_at.toISOString(),
  };
}

export async function mapBySlug(db: Database, slug: string): Promise<HeatMapRow | null> {
  const r = await db
    .selectFrom('heat_maps')
    .selectAll()
    .where('slug', '=', slug)
    .executeTakeFirst();
  return r ? shape(r) : null;
}

export async function mapById(db: Database, id: number): Promise<HeatMapRow | null> {
  const r = await db.selectFrom('heat_maps').selectAll().where('id', '=', id).executeTakeFirst();
  return r ? shape(r) : null;
}

export async function allMaps(db: Database): Promise<HeatMapRow[]> {
  const rows = await db
    .selectFrom('heat_maps')
    .selectAll()
    .orderBy('slot')
    .orderBy('position')
    .orderBy('id')
    .execute();
  return rows.map(shape);
}
