/**
 * The tester flag.
 *
 * NOT A ROLE. It composes with whatever somebody already is, and it is
 * deliberately outside @reportlog/access: every grantable role is another
 * path through the role ceiling, and a flag that opens one tracker should
 * not be one. It is still written to the role audit in the same transaction
 * as the change (axis `flag`), so one query answers "what was granted to
 * whom" for both.
 *
 * Administrators (the owner included) and Access Managers give it, the same
 * two who grant access.
 */
import type { Database } from '../db/database.ts';
import { HttpError } from '../http/errors.ts';
import { ensureUser, recordRoleChange } from '../identity/roles.ts';
import { looksLikeEmail, normalizeEmail } from '../identity/secrets.ts';

export async function setTesterFlag(
  db: Database,
  { actorEmail, email, tester }: { actorEmail: string; email: string; tester: boolean },
): Promise<{ unchanged: boolean }> {
  const subject = normalizeEmail(email);
  if (!looksLikeEmail(subject)) {
    throw new HttpError(400, 'bad_email', 'Enter a valid email address.');
  }
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
      actorEmail,
      subjectEmail: subject,
      axis: 'flag',
      action: tester ? 'grant' : 'revoke',
      detail: 'tester',
    });
    return { unchanged: false };
  });
}

export async function listTesters(db: Database) {
  return db
    .selectFrom('users')
    .select(['email', 'role'])
    .where('is_tester', '=', true)
    .orderBy('email')
    .execute();
}
