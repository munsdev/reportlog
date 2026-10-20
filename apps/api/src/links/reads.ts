/**
 * Reading links back. EVERY READ OF A LINK VALUE IS IN THIS FILE.
 *
 * Who reads (K7): the owner, administrators and moderators, through the
 * staff scope in routes.ts, and vetted journalists, through the desk, which
 * calls `checkedLinks` and nothing else here. Nothing public reaches this
 * file; the K4 sweep (test/db/links-k4.test.ts) walks every public route to
 * make sure a link value never comes out of one.
 *
 * A link is decrypted here and handed back as text. Nothing fetches it (K6,
 * X1): not to preview it, not to see whether it resolves.
 */
import { openValue } from './keys.ts';
import type { LinkKeys } from './keys.ts';
import { LinkRefusal } from './refusals.ts';
import { iso } from './rows.ts';
import type { Db, Outcome } from './rows.ts';

export type GroupFilter = 'unchecked' | Outcome;

export interface GroupView {
  id: number;
  /** Every copy is the same normalized address, so one is shown. Null once erased. */
  url: string | null;
  host: string | null;
  copies: number;
  lists: { id: number; title: string }[];
  outcome: Outcome | null;
  checked_at: string | null;
  checked_by: string | null;
  comment: string | null;
  first_seen: string | null;
  last_seen: string | null;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/** The check queue: one entry per group (K11), newest copies first. */
export async function groupsForCheck(
  db: Db,
  keys: LinkKeys,
  { filter = 'unchecked', limit = 100 }: { filter?: GroupFilter; limit?: number } = {},
): Promise<GroupView[]> {
  const size = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);
  let q = db
    .selectFrom('link_groups as g')
    .leftJoin('links as l', 'l.group_id', 'g.id')
    .select((eb) => [
      'g.id',
      'g.outcome',
      'g.checked_at',
      'g.checked_by',
      'g.comment',
      'g.created_at',
      eb.fn.count<string>('l.id').as('copies'),
      eb.fn.min('l.created_at').as('first_seen'),
      eb.fn.max('l.created_at').as('last_seen'),
    ])
    .groupBy('g.id');
  q = filter === 'unchecked' ? q.where('g.outcome', 'is', null) : q.where('g.outcome', '=', filter);
  const rows = await q
    .orderBy(
      ({ fn }) => fn.max('l.created_at'),
      (o) => o.desc().nullsLast(),
    )
    .orderBy('g.id', 'desc')
    .limit(size)
    .execute();
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];

  // One copy per group to show, and the lists its copies came from.
  const copies = await db
    .selectFrom('links as l')
    .innerJoin('list_entries as e', 'e.id', 'l.entry_id')
    .innerJoin('lists as li', 'li.id', 'e.list_id')
    .select(['l.group_id', 'l.value_enc', 'l.value_key', 'li.id as list_id', 'li.title'])
    .where('l.group_id', 'in', ids)
    .orderBy('l.id')
    .execute();

  return rows.map((r) => {
    const mine = copies.filter((c) => c.group_id === r.id);
    const first = mine[0];
    const url = first ? openValue(keys, first.value_enc, first.value_key) : null;
    const lists = new Map(mine.map((c) => [c.list_id, c.title]));
    return {
      id: r.id,
      url,
      host: url ? hostOf(url) : null,
      copies: Number(r.copies),
      lists: [...lists].map(([id, title]) => ({ id, title })),
      outcome: r.outcome as Outcome | null,
      checked_at: iso(r.checked_at),
      checked_by: r.checked_by,
      comment: r.comment,
      first_seen: iso(r.first_seen),
      last_seen: iso(r.last_seen),
    };
  });
}

export interface HistoryItem {
  at: string;
  by: string;
  kind: 'check' | 'comment' | 'erasure';
  outcome?: Outcome;
  comment?: string;
  reason_category?: string;
  erased?: number;
}

/** Everything ever decided about a group, oldest first. */
export async function groupHistory(db: Db, groupId: number): Promise<HistoryItem[]> {
  const group = await db
    .selectFrom('link_groups')
    .select('id')
    .where('id', '=', groupId)
    .executeTakeFirst();
  if (!group) throw new LinkRefusal('no-group');
  const [checks, comments, erasures] = await Promise.all([
    db.selectFrom('link_checks').selectAll().where('group_id', '=', groupId).execute(),
    db.selectFrom('link_comments').selectAll().where('group_id', '=', groupId).execute(),
    db.selectFrom('link_erasures').selectAll().where('group_id', '=', groupId).execute(),
  ]);
  const items: HistoryItem[] = [
    ...checks.map((c) => ({
      at: new Date(c.created_at).toISOString(),
      by: c.actor_email,
      kind: 'check' as const,
      outcome: c.outcome as Outcome,
    })),
    ...comments.map((c) => ({
      at: new Date(c.created_at).toISOString(),
      by: c.actor_email,
      kind: 'comment' as const,
      comment: c.body,
    })),
    ...erasures.map((e) => ({
      at: new Date(e.created_at).toISOString(),
      by: e.actor_email,
      kind: 'erasure' as const,
      reason_category: e.reason_category,
      erased: e.erased_count,
    })),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

export interface EntryLink {
  entry_id: number;
  field_key: string;
  url: string;
  host: string | null;
  group_id: number;
  outcome: Outcome | null;
}

/** The links of a page of entries, for a moderator reviewing a list. */
export async function linksForEntries(
  db: Db,
  keys: LinkKeys,
  entryIds: readonly number[],
): Promise<EntryLink[]> {
  if (!entryIds.length) return [];
  const rows = await db
    .selectFrom('links as l')
    .innerJoin('link_groups as g', 'g.id', 'l.group_id')
    .select(['l.entry_id', 'l.field_key', 'l.value_enc', 'l.value_key', 'l.group_id', 'g.outcome'])
    .where('l.entry_id', 'in', [...entryIds])
    .orderBy('l.id')
    .execute();
  return rows.map((r) => {
    const url = openValue(keys, r.value_enc, r.value_key);
    return {
      entry_id: r.entry_id,
      field_key: r.field_key,
      url,
      host: hostOf(url),
      group_id: r.group_id,
      outcome: r.outcome as Outcome | null,
    };
  });
}

export interface CheckedLink {
  group_id: number;
  url: string;
  copies: number;
  comment: string | null;
  checked_at: string;
  /** The entries that carry it, for the desk to show each tip's own context (J9). */
  entry_ids: number[];
}

/**
 * FOR THE JOURNALIST DESK (session 5), AND FOR NOTHING ELSE. Checked groups
 * only (M5): an unchecked, withheld or illegal one never comes out of here,
 * whatever the caller asks. The desk decides who is a vetted journalist; this
 * decides which links one may see.
 */
export async function checkedLinks(
  db: Db,
  keys: LinkKeys,
  /** One page of the desk: these groups only (still checked ones only). */
  { groupIds }: { groupIds?: readonly number[] } = {},
): Promise<CheckedLink[]> {
  if (groupIds && !groupIds.length) return [];
  let q = db
    .selectFrom('links as l')
    .innerJoin('link_groups as g', 'g.id', 'l.group_id')
    .select(['l.group_id', 'l.entry_id', 'l.value_enc', 'l.value_key', 'g.comment', 'g.checked_at'])
    .where('g.outcome', '=', 'checked');
  if (groupIds) q = q.where('g.id', 'in', groupIds);
  const rows = await q.orderBy('g.checked_at', 'desc').orderBy('l.id').execute();
  const out = new Map<number, CheckedLink>();
  for (const r of rows) {
    const had = out.get(r.group_id);
    if (had) {
      had.copies += 1;
      if (!had.entry_ids.includes(r.entry_id)) had.entry_ids.push(r.entry_id);
      continue;
    }
    out.set(r.group_id, {
      group_id: r.group_id,
      url: openValue(keys, r.value_enc, r.value_key),
      copies: 1,
      comment: r.comment,
      checked_at: iso(r.checked_at) ?? '',
      entry_ids: [r.entry_id],
    });
  }
  return [...out.values()];
}
