/**
 * The permissions a reporter gives and takes back, and the projection that
 * says what they currently are.
 *
 * NOT PART OF THE RECORD. Nothing here is sealed or chained, and the
 * boundary check forbids the seal and the chain code from ever reaching this
 * folder. The publication answer given at filing is `may_publish`, and it IS
 * sealed, because a sealed answer must never change. These are ongoing
 * permissions that exist to be changed, so they live where changing them is
 * recorded: a revocable value inside the fingerprint would make a report
 * verify differently because somebody changed their mind.
 *
 *   contact_passing         may a moderator pass the reporter's contact
 *                           details to somebody asking to follow up
 *   attachment_publication  may the files attached to the report be
 *                           published: a second layer on top of may_publish,
 *                           which covers the report's own words
 *   evidence_request        may an editor come back and ask for the evidence
 *                           the reporter said they had. NOT the declaration
 *                           itself, which is a sealed answer: what somebody
 *                           said they had is a fact about the filing; whether
 *                           they want to be asked about it is not
 *
 * THE CURRENT VALUE IS A PROJECTION: the newest row for a thread and a
 * permission wins. NO ROWS MEANS NOT GRANTED, the safe direction.
 *
 * ONLY EVER WRITTEN FOR THE REPORTER. There is no moderator path to
 * `setPermission`, and the table's own CHECK says `actor = 'reporter'`.
 */
import { PERMISSIONS } from '@reportlog/contracts';
import type { Permission, Permissions } from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export { PERMISSIONS };

/** Written once, so no caller invents a shape or defaults one to true by accident. */
export const NONE_GRANTED: Readonly<Permissions> = Object.freeze({
  contact_passing: false,
  attachment_publication: false,
  evidence_request: false,
});

export function isPermission(name: unknown): name is Permission {
  return typeof name === 'string' && (PERMISSIONS as readonly string[]).includes(name);
}

/**
 * The current permissions of many threads in one query, because "My reports"
 * draws every report a person filed and one query per card is how a list
 * gets slow quietly. Every thread asked about is in the map.
 */
export async function permissionsForMany(
  db: Kysely<DB>,
  threadIds: readonly string[],
): Promise<Map<string, Permissions>> {
  const out = new Map<string, Permissions>(threadIds.map((t) => [t, { ...NONE_GRANTED }]));
  if (!threadIds.length) return out;
  const rows = await db
    .selectFrom('report_permissions_log')
    .select(['thread_id', 'permission', 'granted'])
    .distinctOn(['thread_id', 'permission'])
    .where('thread_id', 'in', threadIds)
    .orderBy('thread_id')
    .orderBy('permission')
    .orderBy('id', 'desc')
    .execute();
  for (const r of rows) {
    const current = out.get(r.thread_id);
    if (current && isPermission(r.permission)) current[r.permission] = r.granted;
  }
  return out;
}

export async function permissionsFor(db: Kysely<DB>, threadId: string): Promise<Permissions> {
  return (await permissionsForMany(db, [threadId])).get(threadId) ?? { ...NONE_GRANTED };
}

/**
 * Record a grant or a revocation, for the reporter. No reason is required:
 * taking back a permission over your own details or photographs is nobody's
 * business to justify. One offered is kept.
 */
export async function setPermission(
  db: Kysely<DB>,
  input: { threadId: string; permission: Permission; granted: boolean; reason?: string | null },
): Promise<void> {
  if (!isPermission(input.permission)) {
    throw new Error(`unknown permission: ${String(input.permission)}`);
  }
  await db
    .insertInto('report_permissions_log')
    .values({
      thread_id: input.threadId,
      permission: input.permission,
      granted: input.granted,
      reason: input.reason?.trim() ? input.reason.trim() : null,
    })
    .execute();
}

/** Every grant and revocation for a thread, newest first: a switch with a memory. */
export async function permissionHistory(db: Kysely<DB>, threadId: string) {
  const rows = await db
    .selectFrom('report_permissions_log')
    .select(['permission', 'granted', 'reason', 'created_at'])
    .where('thread_id', '=', threadId)
    .orderBy('id', 'desc')
    .execute();
  return rows
    .filter((r) => isPermission(r.permission))
    .map((r) => ({
      permission: r.permission as Permission,
      granted: r.granted,
      reason: r.reason,
      at: r.created_at.toISOString(),
    }));
}
