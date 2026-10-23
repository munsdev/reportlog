/**
 * The roster: everybody who holds a role, a flag or an organization, with how
 * much they filed and when they last acted as staff.
 *
 * NO AUTOMATED FLAGGING ON VOLUME, as in the old application. High volume is
 * the whole point of the coordinator role, and flagging it would fight the
 * design. Oversight is a person reading this page.
 *
 * WHAT COUNTS AS FILED. A report typed up through intake (an intake draft
 * with a report), counted by when the archive received it. Two numbers,
 * because they answer different questions: what this person typed up
 * themselves, and what their organizations filed through anybody.
 */
import { toRoleSet } from '@reportlog/access';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export const ROSTER_DEFAULT_DAYS = 30;

export async function roster(db: Kysely<DB>, days: number) {
  const since = sql<Date>`now() - make_interval(days => ${days})`;
  const people = await db
    .selectFrom('users as u')
    .select((eb) => [
      'u.id',
      'u.email',
      'u.roles',
      'u.is_tester',
      'u.is_team_member',
      'u.desks',
      eb
        .selectFrom('intake_drafts as d')
        .innerJoin('intake_batches as b', 'b.id', 'd.batch_id')
        .innerJoin('reports as r', 'r.id', 'd.report_id')
        .select(sql<number>`count(*)::int`.as('n'))
        .whereRef('b.coordinator_id', '=', 'u.id')
        .where('r.received_at', '>', since)
        .as('filed_by_them'),
      eb
        .selectFrom('intake_drafts as d')
        .innerJoin('intake_batches as b', 'b.id', 'd.batch_id')
        .innerJoin('reports as r', 'r.id', 'd.report_id')
        .select(sql<number>`count(*)::int`.as('n'))
        .where(
          'b.organization_id',
          'in',
          eb
            .selectFrom('organization_memberships as m')
            .select('m.organization_id')
            .whereRef('m.user_id', '=', 'u.id'),
        )
        .where('r.received_at', '>', since)
        .as('filed_for_orgs'),
      // Every trail that names a member of staff by address: moderating,
      // opening a reporter's contact details, a file, changing somebody's access.
      sql<Date | null>`greatest(
        (SELECT max(created_at) FROM moderation_log WHERE actor_email = u.email),
        (SELECT max(accessed_at) FROM contact_access_log WHERE staff_email = u.email),
        (SELECT max(created_at) FROM attachment_events WHERE actor_email = u.email),
        (SELECT max(created_at) FROM role_audit WHERE actor_email = u.email)
      )`.as('last_staff_action'),
    ])
    .where((eb) =>
      eb.or([
        eb('u.roles', '<>', sql<string[]>`'{}'::text[]`),
        eb('u.is_tester', '=', true),
        eb('u.is_team_member', '=', true),
        eb.exists(
          eb
            .selectFrom('organization_memberships as m')
            .select('m.id')
            .whereRef('m.user_id', '=', 'u.id'),
        ),
      ]),
    )
    .orderBy('u.email')
    .execute();

  const memberships = await db
    .selectFrom('organization_memberships as m')
    .innerJoin('organizations as o', 'o.id', 'm.organization_id')
    .select(['m.user_id', 'o.name', 'm.role'])
    .orderBy('o.name')
    .execute();

  return people.flatMap((p) => {
    return [
      {
        email: p.email,
        roles: toRoleSet(p.roles),
        tester: p.is_tester,
        teamMember: p.is_team_member,
        desks: p.desks,
        organizations: memberships
          .filter((m) => m.user_id === p.id)
          .map((m) => ({
            name: m.name,
            role: m.role === 'manager' ? ('manager' as const) : ('coordinator' as const),
          })),
        filedByThem: p.filed_by_them ?? 0,
        filedForTheirOrganizations: p.filed_for_orgs ?? 0,
        lastStaffAction: p.last_staff_action ? new Date(p.last_staff_action).toISOString() : null,
      },
    ];
  });
}
