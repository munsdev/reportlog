/**
 * The tester flag.
 *
 * NOT A ROLE. It composes with whatever somebody already is, and it is not a
 * rung on the role ladder: every grantable role is another path through the
 * role ceiling, and a flag that opens one tracker should not be one. Who may
 * set it is still decided in @reportlog/access, beside the ladder. It is written to the role audit in the same transaction
 * as the change (axis `flag`), so one query answers "what was granted to
 * whom" for both.
 *
 * Administrators (the owner included) and Access Managers give it, the same
 * two who grant access. That rule is @reportlog/access's `canSetFlag`.
 */
import type { SystemRole } from '@reportlog/access';
import type { Database } from '../db/database.ts';
import { setTester } from '../identity/flags.ts';

/** Kept for the feedback routes; the change itself is identity's (flags.ts), which asks @reportlog/access. */
export function setTesterFlag(
  db: Database,
  {
    actor,
    email,
    tester,
  }: { actor: { email: string; role: SystemRole }; email: string; tester: boolean },
): Promise<{ unchanged: boolean }> {
  return setTester(db, { actor, email, tester });
}

export async function listTesters(db: Database) {
  return db
    .selectFrom('users')
    .select(['email', 'role'])
    .where('is_tester', '=', true)
    .orderBy('email')
    .execute();
}
