/**
 * Who a list emails its new entries to, and how an address agrees to it.
 *
 * THE DEFAULT IS THE DEPLOYMENT'S ADMIN ADDRESS, read at send time, so a list
 * that never named its own follows the setting. ANY OTHER ADDRESS CONFIRMS
 * FIRST: it is held as pending, sent a link, and until it is clicked mail keeps
 * going where it went before. A typo would otherwise send people's messages to
 * a stranger. Naming a different address makes the earlier link worthless.
 *
 * The link is stored hashed, like an erasure token. Nothing here sends mail;
 * the routes do.
 */
import type { AnswerValue } from '@reportlog/fields';
import { sql } from 'kysely';
import { hashToken, newToken, TOKEN_PATTERN } from './erasure.ts';
import { refuse } from './refusals.ts';
import type { Db, LoadedList, ListRow } from './rows.ts';

export const CONFIRM_DAYS = 7;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Where this list's entries go right now, or null for nowhere. */
export function recipientFor(
  list: Pick<ListRow, 'notify' | 'notify_email'>,
  adminEmail: string | null,
): string | null {
  if (!list.notify) return null;
  return list.notify_email ?? adminEmail ?? null;
}

/**
 * Name an address. The admin address (or none) applies at once; any other is
 * held until it confirms. Returns the plaintext token for the email, the only
 * moment it exists.
 */
export async function nameRecipient(
  db: Db,
  listId: number,
  email: string | null,
  { adminEmail, now = new Date() }: { adminEmail: string | null; now?: Date },
): Promise<{ pending: boolean; token: string | null; email: string | null }> {
  const want = (email ?? '').trim().toLowerCase();
  const admin = (adminEmail ?? '').trim().toLowerCase();
  if (!want || want === admin) {
    await db
      .updateTable('lists')
      .set({ notify_email: null, notify_pending_email: null, updated_at: sql<Date>`now()` })
      .where('id', '=', listId)
      .execute();
    return { pending: false, token: null, email: null };
  }
  if (!EMAIL.test(want)) refuse('not-an-email');
  const row = await db
    .selectFrom('lists')
    .select('notify_email')
    .where('id', '=', listId)
    .executeTakeFirst();
  if (row?.notify_email === want) {
    // Already confirmed. Clear anything pending and change nothing else.
    await db
      .updateTable('lists')
      .set({ notify_pending_email: null })
      .where('id', '=', listId)
      .execute();
    return { pending: false, token: null, email: want };
  }
  const token = newToken();
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('lists')
      .set({ notify_pending_email: want, updated_at: sql<Date>`now()` })
      .where('id', '=', listId)
      .execute();
    await trx
      .insertInto('list_notify_confirmations')
      .values({
        token_hash: hashToken(token),
        list_id: listId,
        email: want,
        expires_at: new Date(now.getTime() + CONFIRM_DAYS * 864e5),
      })
      .execute();
  });
  return { pending: true, token, email: want };
}

/**
 * The address clicked. Only the address the link was sent to, only while it
 * is still the one pending, only once, and only for a week.
 */
export async function confirmRecipient(
  db: Db,
  token: string | null | undefined,
): Promise<{ ok: true; title: string; email: string } | { ok: false }> {
  if (!token || !TOKEN_PATTERN.test(token)) return { ok: false };
  const hash = hashToken(token);
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('list_notify_confirmations as c')
      .innerJoin('lists as l', 'l.id', 'c.list_id')
      .select([
        'c.list_id',
        'c.email',
        'c.used_at',
        'c.expires_at',
        'l.notify_pending_email',
        'l.title',
      ])
      .where('c.token_hash', '=', hash)
      .forUpdate()
      .executeTakeFirst();
    if (
      !row ||
      row.used_at ||
      new Date(row.expires_at) < new Date() ||
      row.notify_pending_email !== row.email
    ) {
      return { ok: false as const };
    }
    await trx
      .updateTable('lists')
      .set({ notify_email: row.email, notify_pending_email: null, updated_at: sql<Date>`now()` })
      .where('id', '=', row.list_id)
      .execute();
    await trx
      .updateTable('list_notify_confirmations')
      .set({ used_at: sql<Date>`now()` })
      .where('token_hash', '=', hash)
      .execute();
    return { ok: true as const, title: row.title, email: row.email };
  });
}

const said = (v: AnswerValue) =>
  Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : v === false ? 'No' : String(v);

/**
 * The email for one entry: every answer, labelled as the form asked it. Plain
 * text, so nothing a stranger typed can arrive as markup.
 */
export function entryMail(
  list: Pick<LoadedList, 'title' | 'fields'>,
  {
    answers,
    erasable,
    email,
    emailConsent,
  }: {
    answers: Record<string, AnswerValue>;
    erasable: Record<string, AnswerValue> | null;
    email: string | null;
    emailConsent: boolean;
  },
): { subject: string; text: string } {
  const all: Record<string, AnswerValue> = { ...answers, ...(erasable ?? {}) };
  const lines = list.fields
    .filter((f) => all[f.key] !== undefined)
    .map((f) => {
      const v = all[f.key];
      return `${f.label}\n${v === undefined ? '' : said(v)}`;
    });
  const who = email
    ? `Their email address\n${email}${emailConsent ? ' (they said you may write back)' : ' (they did not ask for a reply)'}`
    : 'They gave no email address.';
  return {
    subject: `New on ${list.title}`,
    text:
      `${lines.length ? lines.join('\n\n') : '(No answers.)'}\n\n${who}\n\n` +
      "This copy is in your inbox now, and the site's deletion timer cannot reach it. If the " +
      'person asks for what they sent to be deleted, delete this email too.',
  };
}
