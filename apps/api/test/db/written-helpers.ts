/**
 * What the written-accounts and report-link tests share: a logbook that asks
 * for erasable text and links, and a report filed with held values the way the
 * filing path does (append, then start the thread), shared or not.
 */
import type { HeldValues } from '@reportlog/fields';
import { normalizeReportFields } from '@reportlog/seal';
import { randomUUID } from 'node:crypto';
import { appendReportVersion } from '../../src/chain/append.ts';
import { prepareHeld } from '../../src/chain/held.ts';
import type { Database } from '../../src/db/database.ts';
import { startThread } from '../../src/filing/filing.ts';
import type { LinkKeys } from '../../src/links/keys.ts';
import { setPermission } from '../../src/permissions/log.ts';
import { GENERAL_DIGEST } from './helpers.ts';

export const HELD_QUESTIONS = [
  {
    key: 'outcome',
    kind: 'choice_one',
    label: 'How did it go?',
    settings: { options: ['ok', 'bad'] },
  },
  { key: 'what', kind: 'private_text', label: 'What happened' },
  { key: 'links', kind: 'private_link', label: 'Links', settings: { maxValues: 3 } },
];

export interface HeldThread {
  threadId: string;
  reportId: number;
  publicRef: string;
}

/** A report holding these values; `share` grants journalist_sharing, as the filing card would. */
export async function fileHeld(
  db: Database,
  keys: LinkKeys,
  lb: { id: number; slug: string },
  held: HeldValues,
  opts: { share?: boolean; threadId?: string; correctsId?: number } = {},
): Promise<HeldThread> {
  const threadId = opts.threadId ?? randomUUID();
  const out = await db.transaction().execute(async (trx) => {
    const { row } = await appendReportVersion(trx, {
      logbookId: lb.id,
      threadId,
      correctsId: opts.correctsId ?? null,
      fields: normalizeReportFields({
        logbook: lb.slug,
        answers: { outcome: 'bad' },
        may_publish: true,
        may_publish_digest: GENERAL_DIGEST,
      }),
      publicRefPrefix: 'RL-',
      held: { keys, rows: prepareHeld(held) },
    });
    if (opts.correctsId === undefined) await startThread(trx, threadId, row);
    else {
      await trx
        .updateTable('report_heads')
        .set({ current_report_id: row.id, moderation_status: 'pending' })
        .where('thread_id', '=', threadId)
        .execute();
    }
    return { threadId, reportId: row.id, publicRef: row.public_ref };
  });
  if (opts.share !== undefined && opts.correctsId === undefined) {
    await setPermission(db, { threadId, permission: 'journalist_sharing', granted: opts.share });
  }
  return out;
}

/** The text ref of a report's newest version's `what` answer. */
export async function textRef(db: Database, reportId: number): Promise<string> {
  const v = await db
    .selectFrom('report_values')
    .select('id')
    .where('report_id', '=', reportId)
    .where('kind', '=', 'private_text')
    .executeTakeFirstOrThrow();
  return `report-${String(v.id)}`;
}
