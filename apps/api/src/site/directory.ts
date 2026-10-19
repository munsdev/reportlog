/**
 * The directory of organizations that asked to be listed (the old
 * application's "Alliance").
 *
 * NOT CHAINED, and that is the design: participation is mutable state about a
 * living relationship, and sealing it would make membership permanently
 * unremovable. The boundary check keeps the seal and chain code from ever
 * reaching this folder.
 *
 * WHAT THE NAME COSTS. Any directory of organizations reads as a membership
 * body with a bar to clear, and no such bar exists. So the disclaimer is
 * served with the rows (see the contract), and the page cannot show one
 * without the other.
 *
 * LOGOS ARE NOT HERE YET. They need file storage, which the files
 * workstream is building.
 */
import {
  DIRECTORY_DISCLAIMER,
  DIRECTORY_LEAVING,
  DIRECTORY_NAME,
  DIRECTORY_WHAT_APPEARS,
} from '@reportlog/contracts';
import type { Listing } from '@reportlog/contracts';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { notFound } from '../http/errors.ts';

/** A member is somebody who ACCEPTED: a pending invitation is a row in another table. */
const memberCount = sql<number>`(SELECT count(*) FROM organization_memberships m WHERE m.organization_id = o.id)::int`;

/**
 * The directory, ranked BY MEMBER COUNT ONLY, and the reason is load-bearing.
 * Ranking by report count would be a public incentive to file more reports,
 * and the archive's whole value is that its contents were not manufactured.
 * Members cannot be manufactured by typing. So no report count appears here
 * at all.
 *
 * An organization with nobody in it still appears, showing an honest zero:
 * one that opted in and was silently left out is the worse outcome.
 */
export async function directory(db: Database) {
  const rows = await db
    .selectFrom('organizations as o')
    .select(['o.name', 'o.details', 'o.listed_at', memberCount.as('member_count')])
    .where('o.listed', '=', true)
    .orderBy('member_count', 'desc')
    .orderBy('o.name', 'asc')
    .execute();
  return rows.map((r) => ({
    name: r.name,
    details: r.details?.trim() ? r.details : null,
    // The table's CHECK: a listed organization has a date.
    joined: (r.listed_at ?? new Date(0)).toISOString(),
    member_count: r.member_count,
  }));
}

/**
 * Switch listing on or off. `listed_at` is set the first time and never
 * cleared, so an organization that leaves and comes back keeps the date it
 * actually joined rather than looking new.
 */
export async function setListed(db: Database, organizationId: number, listed: boolean) {
  const row = await db
    .updateTable('organizations')
    .set({
      listed,
      listed_at: sql`CASE WHEN ${listed} AND listed_at IS NULL THEN now() ELSE listed_at END`,
      updated_at: new Date(),
    })
    .where('id', '=', organizationId)
    .returning(['listed', 'listed_at'])
    .executeTakeFirst();
  if (!row) throw notFound('There is no organization with that number.');
  return row;
}

/** The state of one organization's listing, with everything the toggle has to say. */
export async function listing(db: Database, organizationId: number): Promise<Listing> {
  const row = await db
    .selectFrom('organizations as o')
    .select(['o.name', 'o.listed', 'o.listed_at', memberCount.as('member_count')])
    .where('o.id', '=', organizationId)
    .executeTakeFirst();
  if (!row) throw notFound('There is no organization with that number.');
  return {
    organization: row.name,
    listed: row.listed,
    joined: row.listed_at ? row.listed_at.toISOString() : null,
    member_count: row.member_count,
    directory_name: DIRECTORY_NAME,
    what_appears: [...DIRECTORY_WHAT_APPEARS],
    disclaimer: DIRECTORY_DISCLAIMER,
    leaving: DIRECTORY_LEAVING,
  };
}
