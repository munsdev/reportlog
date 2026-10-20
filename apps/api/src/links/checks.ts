/**
 * The link check (M3, M6), the comment for journalists (M4), and the erasure
 * of an illegal link (X2, X4).
 *
 * A CHECK COVERS ITS GROUP: every copy of one address, from every tip, now
 * and later (K12). Three outcomes:
 *   checked   a journalist may see it (through the desk, checkedLinks).
 *   withheld  legal but abusive, worthless or harassing. Never shown to a
 *             journalist, not erased, until a moderator checks it again.
 *   illegal   every copy is erased now, value and key, and the group's
 *             matching key with them. A later copy is a new, unchecked
 *             group, unless the moderator blocklists it here or later.
 *
 * Each check and each comment edit is a row in an append-only history; the
 * group row holds the current one, written in the same transaction.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { addBlock } from './blocklist.ts';
import type { BlockKind, ReasonCategory } from './blocklist.ts';
import { domainHash, openValue } from './keys.ts';
import type { LinkKeys } from './keys.ts';
import { LinkRefusal } from './refusals.ts';
import { MAX_COMMENT } from './rows.ts';
import type { Outcome } from './rows.ts';

export interface CheckInput {
  outcome: Outcome;
  actor: string;
  /** Required for "illegal". */
  reason?: ReasonCategory | undefined;
  /** "illegal" only: also blocklist the exact address, or its whole domain. */
  block?: BlockKind | undefined;
}

export async function checkGroup(
  db: Kysely<DB>,
  keys: LinkKeys,
  groupId: number,
  input: CheckInput,
): Promise<{ outcome: Outcome; erased: number }> {
  if (input.outcome === 'illegal' && !input.reason) throw new LinkRefusal('reason-needed');
  return db.transaction().execute(async (trx) => {
    const group = await trx
      .selectFrom('link_groups')
      .select(['id', 'match_key', 'outcome'])
      .where('id', '=', groupId)
      .forUpdate()
      .executeTakeFirst();
    if (!group) throw new LinkRefusal('no-group');
    if (group.outcome === 'illegal') throw new LinkRefusal('already-erased');

    await trx
      .insertInto('link_checks')
      .values({ group_id: groupId, outcome: input.outcome, actor_email: input.actor })
      .execute();

    if (input.outcome !== 'illegal') {
      await trx
        .updateTable('link_groups')
        .set({ outcome: input.outcome, checked_at: new Date(), checked_by: input.actor })
        .where('id', '=', groupId)
        .execute();
      return { outcome: input.outcome, erased: 0 };
    }

    // Checked above, before the transaction.
    const reason: ReasonCategory = input.reason ?? 'other-illegal';
    // BEFORE the erasure: after it there is no key and no copy to take a
    // domain from.
    if (input.block === 'address' && group.match_key) {
      await addBlock(
        trx,
        { kind: 'address', hash: group.match_key },
        { reason, actor: input.actor },
      );
    } else if (input.block === 'domain') {
      const one = await trx
        .selectFrom('links')
        .select(['value_enc', 'value_key'])
        .where('group_id', '=', groupId)
        .executeTakeFirst();
      if (!one) throw new LinkRefusal('no-domain-left');
      const host = new URL(openValue(keys, one.value_enc, one.value_key)).hostname;
      await addBlock(
        trx,
        { kind: 'domain', hash: domainHash(keys, host) },
        { reason, actor: input.actor },
      );
    }

    const gone = await trx.deleteFrom('links').where('group_id', '=', groupId).executeTakeFirst();
    const erased = Number(gone.numDeletedRows);
    await trx
      .insertInto('link_erasures')
      .values({
        group_id: groupId,
        reason_category: reason,
        erased_count: erased,
        actor_email: input.actor,
      })
      .execute();
    await trx
      .updateTable('link_groups')
      .set({
        outcome: 'illegal',
        checked_at: new Date(),
        checked_by: input.actor,
        match_key: null,
        // Nothing is left for a journalist to read it beside.
        comment: null,
      })
      .where('id', '=', groupId)
      .execute();
    return { outcome: 'illegal' as const, erased };
  });
}

/** Set the group's comment for journalists. An empty one clears it; both are recorded. */
export async function commentGroup(
  db: Kysely<DB>,
  groupId: number,
  { body, actor }: { body: string; actor: string },
): Promise<{ comment: string | null }> {
  const text = body.trim();
  if (text.length > MAX_COMMENT) throw new LinkRefusal('comment-too-long');
  return db.transaction().execute(async (trx) => {
    const group = await trx
      .selectFrom('link_groups')
      .select(['outcome'])
      .where('id', '=', groupId)
      .forUpdate()
      .executeTakeFirst();
    if (!group) throw new LinkRefusal('no-group');
    if (group.outcome === 'illegal') throw new LinkRefusal('already-erased');
    await trx
      .insertInto('link_comments')
      .values({ group_id: groupId, body: text, actor_email: actor })
      .execute();
    await trx
      .updateTable('link_groups')
      .set({ comment: text || null })
      .where('id', '=', groupId)
      .execute();
    return { comment: text || null };
  });
}
