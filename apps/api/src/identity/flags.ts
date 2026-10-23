/**
 * The two flags: tester and team member.
 *
 * NOT ROLES. Each composes with whatever somebody already is and opens no
 * report: the tester flag opens the feedback tracker, the team-member flag
 * the team's pages. Who may set either is decided in @reportlog/access
 * (`canSetFlag`), so every grant asks the same package the role ladder does,
 * and each change is written to the role audit (axis `flag`) in the same
 * transaction as the change itself.
 *
 * DESKS ride on the team-member flag. They are display only: what somebody on
 * the team does, so their account page can say where to start. Taking somebody
 * off the team takes their desks with it (the database insists).
 */
import { canSetFlag } from '@reportlog/access';
import type { Flag, SystemRole } from '@reportlog/access';
import { DESK_IDS } from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { notAllowed } from './guards.ts';
import { ensureUser, recordRoleChange } from './roles.ts';
import { looksLikeEmail, normalizeEmail } from './secrets.ts';

export interface FlagActor {
  email: string;
  roles: readonly SystemRole[];
}

/** Keep only desks that exist, once each, in the list's own order. Never throws. */
export function normalizeDesks(raw: readonly unknown[] | null | undefined): string[] {
  const wanted = new Set((raw ?? []).map((d) => (typeof d === 'string' ? d.trim() : '')));
  return DESK_IDS.filter((id) => wanted.has(id));
}

function subjectOf(email: string): string {
  const subject = normalizeEmail(email);
  if (!looksLikeEmail(subject)) {
    throw new HttpError(400, 'bad_email', 'Enter a valid email address.');
  }
  return subject;
}

function mayOrRefuse(actor: FlagActor, flag: Flag): void {
  if (!canSetFlag(actor.roles, flag)) {
    throw notAllowed('Only administrators and Access Managers can change that.');
  }
}

/** Give or take the tester flag. */
export async function setTester(
  db: Kysely<DB>,
  { actor, email, tester }: { actor: FlagActor; email: string; tester: boolean },
): Promise<{ unchanged: boolean }> {
  mayOrRefuse(actor, 'tester');
  const subject = subjectOf(email);
  return db.transaction().execute(async (trx) => {
    const user = await ensureUser(trx, subject);
    const before = await trx
      .selectFrom('users')
      .select('is_tester')
      .where('id', '=', user.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (before.is_tester === tester) return { unchanged: true };
    await trx
      .updateTable('users')
      .set({ is_tester: tester, updated_at: new Date() })
      .where('id', '=', user.id)
      .execute();
    await recordRoleChange(trx, {
      actorEmail: actor.email,
      subjectEmail: subject,
      axis: 'flag',
      action: tester ? 'grant' : 'revoke',
      detail: 'tester',
    });
    return { unchanged: false };
  });
}

/**
 * Put somebody on the team, change their desks, or take them off it. The
 * desks are in the audit row's detail, so the trail says what was actually
 * given, not merely that something was.
 */
export async function setTeamMember(
  db: Kysely<DB>,
  {
    actor,
    email,
    teamMember,
    desks,
  }: { actor: FlagActor; email: string; teamMember: boolean; desks: readonly unknown[] },
): Promise<{ unchanged: boolean; desks: string[] }> {
  mayOrRefuse(actor, 'team_member');
  const subject = subjectOf(email);
  const clean = teamMember ? normalizeDesks(desks) : [];
  return db.transaction().execute(async (trx) => {
    const user = await ensureUser(trx, subject);
    const before = await trx
      .selectFrom('users')
      .select(['is_team_member', 'desks'])
      .where('id', '=', user.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (before.is_team_member === teamMember && before.desks.join(',') === clean.join(',')) {
      return { unchanged: true, desks: clean };
    }
    await trx
      .updateTable('users')
      .set({ is_team_member: teamMember, desks: clean, updated_at: new Date() })
      .where('id', '=', user.id)
      .execute();
    await recordRoleChange(trx, {
      actorEmail: actor.email,
      subjectEmail: subject,
      axis: 'flag',
      // Already on the team and only the desks moved: a change, not a grant.
      action: !teamMember ? 'revoke' : before.is_team_member ? 'change' : 'grant',
      detail: clean.length ? `team member: ${clean.join(', ')}` : 'team member',
    });
    return { unchanged: false, desks: clean };
  });
}
