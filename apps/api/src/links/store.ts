/**
 * Keeping a link, and letting it go.
 *
 * ONE ROW PER LINK A TIP CARRIED, every tip keeping its own (K11). The value
 * is encrypted under a key of its own (K9); the row joins the group of every
 * copy of the same normalized address by its matching key, a keyed HMAC, so
 * a copy of the database cannot be searched by hashing a guessed link.
 *
 * A LATER COPY JOINS ITS GROUP, AND SO ITS CHECK (K12): "checked" and
 * "withheld" carry over. "Illegal" does not: that group's matching key was
 * destroyed with its links, so a later copy starts a new, unchecked group.
 * Only the blocklist stops later copies, and a copy it matches is never
 * written at all.
 */
import { sql } from 'kysely';
import type { PreparedLink } from '../lists/policy.ts';
import { hashesFor, isBlocked } from './blocklist.ts';
import { matchKey, sealValue } from './keys.ts';
import type { LinkKeys } from './keys.ts';
import type { Db } from './rows.ts';

/**
 * Store an entry's links. Inside the transaction that files the entry.
 * Returns the ones kept and how many the blocklist erased on arrival; the
 * second is never told to the person who sent them.
 */
export async function storeLinks(
  trx: Db,
  keys: LinkKeys,
  entryId: number,
  links: readonly PreparedLink[],
): Promise<{ kept: PreparedLink[]; blocked: number }> {
  const kept: PreparedLink[] = [];
  let blocked = 0;
  for (const l of links) {
    if (await isBlocked(trx, hashesFor(keys, l.url, l.host))) {
      blocked += 1;
      continue;
    }
    const key = matchKey(keys, l.url);
    await trx
      .insertInto('link_groups')
      .values({ match_key: key })
      .onConflict((oc) => oc.column('match_key').doNothing())
      .execute();
    const group = await trx
      .selectFrom('link_groups')
      .select('id')
      .where('match_key', '=', key)
      .executeTakeFirstOrThrow();
    const sealed = sealValue(keys, l.url);
    await trx
      .insertInto('links')
      .values({
        entry_id: entryId,
        field_key: l.fieldKey,
        group_id: group.id,
        value_enc: sealed.enc,
        value_key: sealed.key,
        // What kind of link the tip said it is, when its form asks (J9).
        link_type: l.type ?? null,
      })
      .execute();
    kept.push(l);
  }
  return { kept, blocked };
}

/**
 * Erase the links of entries whose personal half is being erased (T3): the
 * value and its key, by deleting the row. A group left with no copies, no
 * check and no comment goes too, and its matching key with it; a checked or
 * withheld one stays, so its check still covers a later copy (K12).
 */
export async function eraseEntryLinks(trx: Db, entryIds: readonly number[]): Promise<number> {
  if (!entryIds.length) return 0;
  const gone = await trx
    .deleteFrom('links')
    .where('entry_id', 'in', [...entryIds])
    .returning('group_id')
    .execute();
  const groups = [...new Set(gone.map((g) => g.group_id))];
  if (groups.length) await dropEmptyGroups(trx, groups);
  return gone.length;
}

async function dropEmptyGroups(trx: Db, groups: readonly number[]): Promise<void> {
  await trx
    .deleteFrom('link_groups')
    .where('id', 'in', [...groups])
    .where('outcome', 'is', null)
    .where('comment', 'is', null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('links')
            .select(sql<number>`1`.as('one'))
            .whereRef('links.group_id', '=', 'link_groups.id'),
        ),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('link_comments')
            .select(sql<number>`1`.as('one'))
            .whereRef('link_comments.group_id', '=', 'link_groups.id'),
        ),
      ),
    )
    .execute();
}
