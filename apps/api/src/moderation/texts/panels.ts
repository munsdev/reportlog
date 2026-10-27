/**
 * What a report's own page and its reporter's page show about the words and
 * links the report holds (W4). Reads decrypt, so the routes that call these
 * are behind the moderator scope, or check that the thread is the reporter's.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../../db/schema.gen.ts';
import { notFound } from '../../http/errors.ts';
import type { LinkKeys } from '../../links/keys.ts';
import { sharingGrantedAmong } from '../../permissions/log.ts';
import { eraseHeldValuesOf } from '../../reportValues/erase.ts';
import { erasuresOf, readForModerator } from '../../reportValues/reads.ts';
import { present } from './items.ts';
import type { Outcome } from './items.ts';

type Db = Kysely<DB>;

type TextState = 'waiting' | 'redacted' | 'withheld';
type LinkState = 'waiting' | 'checked' | 'withheld';
const textState = (o: string | null | undefined): TextState =>
  o === 'redacted' || o === 'withheld' ? o : 'waiting';
const linkState = (o: string | null | undefined): LinkState =>
  o === 'checked' || o === 'withheld' ? o : 'waiting';

async function threadReports(db: Db, threadId: string) {
  const head = await db
    .selectFrom('report_heads')
    .select('current_report_id')
    .where('thread_id', '=', threadId)
    .executeTakeFirst();
  if (!head) throw notFound('There is no report with that reference.');
  const all = await db
    .selectFrom('reports')
    .select('id')
    .where('thread_id', '=', threadId)
    .execute();
  return { head: head.current_report_id, all: all.map((r) => r.id) };
}

async function erasedMarkers(db: Db, reportIds: readonly number[]) {
  const seen = new Set<string>();
  const out: { kind: 'private_text' | 'private_link'; field_key: string; erased_at: string }[] = [];
  for (const e of await erasuresOf(db, reportIds)) {
    const k = `${e.fieldKey}:${String(e.position)}:${e.fingerprint}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: e.kind, field_key: e.fieldKey, erased_at: e.erasedAt });
  }
  return out;
}

/** The moderator's report page: the newest version's words and links, and the tombstones. */
export async function reportWritten(db: Db, keys: LinkKeys, threadId: string) {
  const { head, all } = await threadReports(db, threadId);
  // Ids and groups only: no value is decrypted for a link here, and the words
  // are opened one at a time through openText, which logs each opening.
  const held = await db
    .selectFrom('report_values')
    .select(['id', 'kind', 'group_id'])
    .where('report_id', '=', head)
    .orderBy('position')
    .orderBy('id')
    .execute();
  const ids = held.filter((h) => h.kind === 'private_text').map((h) => h.id);
  const cands = ids.length
    ? await db
        .selectFrom('report_values as rv')
        .leftJoin('text_items as ti', 'ti.fingerprint', 'rv.fingerprint')
        .select([
          'rv.id as subject_id',
          'rv.fingerprint',
          'ti.id as item_id',
          'ti.outcome',
          'ti.checked_at',
          'ti.checked_by',
        ])
        .where('rv.id', 'in', ids)
        .execute()
    : [];
  const texts = await present(
    db,
    keys,
    cands.map((c) => ({
      source: 'report' as const,
      subject_id: c.subject_id,
      field_key: null,
      fingerprint: c.fingerprint,
      at: new Date(),
      item_id: c.item_id,
      outcome: c.outcome as Outcome | null,
      checked_at: c.checked_at,
      checked_by: c.checked_by,
    })),
  );
  const groupIds = held.flatMap((h) =>
    h.kind === 'private_link' && h.group_id ? [h.group_id] : [],
  );
  const groups = groupIds.length
    ? await db
        .selectFrom('link_groups')
        .select(['id', 'outcome'])
        .where('id', 'in', groupIds)
        .execute()
    : [];
  const links = [];
  for (const h of held.filter((x) => x.kind === 'private_link')) {
    const g = groups.find((x) => x.id === h.group_id);
    let alsoTips = 0;
    let alsoReports = 0;
    if (h.group_id) {
      const t = await db
        .selectFrom('links')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('group_id', '=', h.group_id)
        .executeTakeFirstOrThrow();
      alsoTips = Number(t.n);
      const r = await db
        .selectFrom('report_values as rv')
        .innerJoin('report_heads as hd', 'hd.current_report_id', 'rv.report_id')
        .select((eb) => eb.fn.count<string>('hd.thread_id').distinct().as('n'))
        .where('rv.group_id', '=', h.group_id)
        .where('hd.thread_id', '<>', threadId)
        .executeTakeFirstOrThrow();
      alsoReports = Number(r.n);
    }
    links.push({
      group_id: h.group_id,
      ref: `link-${String(h.id)}`,
      outcome: (g?.outcome ?? null) as 'checked' | 'withheld' | 'illegal' | null,
      also_tips: alsoTips,
      also_reports: alsoReports,
    });
  }
  const shared = (await sharingGrantedAmong(db, [threadId])).has(threadId);
  return { texts, links, erased: await erasedMarkers(db, all), shared };
}

/** The reporter's own view of what they wrote. The caller has proved the thread is theirs. */
export async function myWritten(db: Db, keys: LinkKeys, threadId: string) {
  const { head, all } = await threadReports(db, threadId);
  const held = await readForModerator(db, keys, [head]);
  const prints = held.map((h) => h.fingerprint);
  const items = prints.length
    ? await db
        .selectFrom('text_items')
        .select(['fingerprint', 'outcome', 'checked_at'])
        .where('fingerprint', 'in', prints)
        .execute()
    : [];
  const groupIds = held.flatMap((h) => (h.groupId ? [h.groupId] : []));
  const groups = groupIds.length
    ? await db
        .selectFrom('link_groups')
        .select(['id', 'outcome', 'checked_at'])
        .where('id', 'in', groupIds)
        .execute()
    : [];
  const shared = (await sharingGrantedAmong(db, [threadId])).has(threadId);
  return {
    texts: held
      .filter((h) => h.kind === 'private_text')
      .map((h) => {
        const it = items.find((i) => i.fingerprint === h.fingerprint);
        const o = it?.outcome;
        return {
          field_key: h.fieldKey,
          text: h.value,
          outcome: textState(o),
          checked_at: it?.checked_at ? new Date(it.checked_at).toISOString() : null,
        };
      }),
    links: held
      .filter((h) => h.kind === 'private_link')
      .map((h) => {
        const g = groups.find((x) => x.id === h.groupId);
        const o = g?.outcome;
        return {
          field_key: h.fieldKey,
          url: h.value,
          outcome: linkState(o),
          checked_at: g?.checked_at ? new Date(g.checked_at).toISOString() : null,
        };
      }),
    erased: await erasedMarkers(db, all),
    shared,
  };
}

/** The reporter erasing everything they wrote, every version. Returns how many values went. */
export async function eraseMyWritten(db: Db, threadId: string): Promise<number> {
  const { all } = await threadReports(db, threadId);
  return db
    .transaction()
    .execute((trx) =>
      eraseHeldValuesOf(trx, all, { reason: 'reporter-request', actor: 'reporter' }),
    );
}
