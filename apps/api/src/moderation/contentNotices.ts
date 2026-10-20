/**
 * A public form to report illegal content (D1).
 *
 * ANYBODY MAY SEND ONE, with or without an address. With one, they get a
 * receipt at once and the decision when it is made, each with a link to a page
 * showing where the notice stands. Without one, the receipt code on screen is
 * all they have, and the status page is reached from the link shown with it.
 *
 * THE ADDRESS IS KEPT ONLY UNTIL THE DECISION HAS BEEN SENT. Nothing needs it
 * after that, so it is blanked. `content_notice_events` (append-only) is the
 * record of what happened and when; the notice row is only its latest state.
 *
 * A DECISION GIVES ITS REASON. The sender is told what was decided and why in
 * a sentence a moderator wrote for them, and where to take it further.
 */
import { randomInt } from 'node:crypto';
import { CONTENT_DECISIONS } from '@reportlog/contracts';
import type { ContentDecision } from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { looksLikeEmail, normalizeEmail, randomToken, sha256Hex } from '../identity/secrets.ts';

// No 0, 1, I or O: a code read out over the phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const receiptCode = () =>
  `IC-${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

const refuse = (code: string, message: string) => new HttpError(400, code, message);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export interface Deps {
  db: Kysely<DB>;
  mailer: Mailer;
  siteOrigin: string;
}

const statusUrl = (deps: Deps, token: string) =>
  `${deps.siteOrigin}/illegal-content/status/${token}`;

export function receiptEmail(receipt: string, link: string) {
  return {
    subject: `We received your notice ${receipt}`,
    text:
      `We received your notice about content on this site. Your reference is ${receipt}.\n\n` +
      'A person on our team will look at it and tell you what was decided and why. You can see where it stands here:\n\n' +
      `${link}\n\n` +
      'If you did not send this, ignore it. Nothing happens without the link.\n',
  };
}

const DECISION_WORDS: Record<ContentDecision, string> = {
  removed: 'We removed the content.',
  restricted: 'We restricted access to the content.',
  no_action: 'We did not remove the content.',
};

export function decisionEmail(input: {
  receipt: string;
  decision: ContentDecision;
  reason: string;
  link: string;
  termsUrl: string;
}) {
  return {
    subject: `Our decision on your notice ${input.receipt}`,
    text:
      `We looked at your notice ${input.receipt}.\n\n${DECISION_WORDS[input.decision]}\n\n` +
      `Why: ${input.reason}\n\n` +
      `You can read this again here: ${input.link}\n\n` +
      `If you disagree, our terms of use say how to ask us to look again and who else you can turn to: ${input.termsUrl}\n`,
  };
}

export async function submitNotice(
  deps: Deps,
  b: {
    where_found?: unknown;
    explanation?: unknown;
    good_faith?: unknown;
    name?: unknown;
    email?: unknown;
  },
): Promise<{ receipt: string; emailed: boolean; token: string }> {
  const where = text(b.where_found);
  const why = text(b.explanation);
  const name = text(b.name);
  const email = text(b.email) ? normalizeEmail(b.email) : '';
  const problems: string[] = [];
  if (!where)
    problems.push('Say where the content is: an address on this site, or a report’s reference.');
  if (where.length > 2000) problems.push('Keep “where” under 2000 characters.');
  if (!why) problems.push('Explain why you think it is illegal.');
  if (why.length > 5000) problems.push('Keep the explanation under 5000 characters.');
  if (name.length > 200) problems.push('Keep the name under 200 characters.');
  if (email && !looksLikeEmail(email)) problems.push('That does not look like an email address.');
  if (b.good_faith !== true)
    problems.push('Confirm that you believe what you are telling us is accurate and complete.');
  if (problems.length) throw refuse('incomplete', problems.join(' '));

  const receipt = receiptCode();
  const token = randomToken();
  const { db } = deps;
  const id = await db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto('content_notices')
      .values({
        receipt,
        token_hash: sha256Hex(token),
        where_found: where,
        explanation: why,
        good_faith: true,
        sender_name: name || null,
        sender_email: email || null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('content_notice_events')
      .values({ notice_id: row.id, action: 'received', actor: 'sender' })
      .execute();
    return row.id;
  });
  let emailed = false;
  if (email) {
    emailed = await send(deps, id, 'receipt_sent', {
      to: email,
      ...receiptEmail(receipt, statusUrl(deps, token)),
    });
  }
  return { receipt, emailed, token };
}

async function send(
  deps: Deps,
  noticeId: number,
  done: 'receipt_sent' | 'decision_sent',
  message: { to: string; subject: string; text: string },
): Promise<boolean> {
  let ok = false;
  try {
    await deps.mailer.send(message);
    ok = true;
  } catch {
    // Not the error: a provider's message can carry the address.
    ok = false;
  }
  await deps.db
    .insertInto('content_notice_events')
    .values({ notice_id: noticeId, action: ok ? done : 'email_failed', actor: 'system' })
    .execute();
  return ok;
}

export async function statusByToken(db: Kysely<DB>, token: string) {
  const row = await db
    .selectFrom('content_notices')
    .select(['receipt', 'created_at', 'status', 'decision', 'decision_reason', 'decided_at'])
    .where((eb) =>
      eb.or([
        eb('token_hash', '=', sha256Hex(token)),
        eb('decision_token_hash', '=', sha256Hex(token)),
      ]),
    )
    .executeTakeFirst();
  if (!row) throw notFound('That link does not match a notice. It may have been mistyped.');
  return {
    receipt: row.receipt,
    received_at: row.created_at.toISOString(),
    status: row.status as 'open' | 'decided',
    decision: (row.decision as ContentDecision | null) ?? null,
    decision_reason: row.decision_reason,
    decided_at: row.decided_at?.toISOString() ?? null,
  };
}

export async function listNotices(db: Kysely<DB>) {
  const rows = await db
    .selectFrom('content_notices')
    .select([
      'id',
      'receipt',
      'where_found',
      'explanation',
      'sender_name',
      'sender_email',
      'status',
      'decision',
      'decision_reason',
      'created_at',
    ])
    // Open first, then newest first.
    .orderBy('status', 'asc')
    .orderBy('id', 'desc')
    .limit(500)
    .execute();
  // The address is not sent to the screen: a moderator deciding a notice
  // does not need it, and the decision email goes from here.
  return rows.map((r) => ({
    id: r.id,
    receipt: r.receipt,
    where_found: r.where_found,
    explanation: r.explanation,
    sender_name: r.sender_name,
    has_email: r.sender_email !== null,
    status: r.status as 'open' | 'decided',
    decision: (r.decision as ContentDecision | null) ?? null,
    decision_reason: r.decision_reason,
    created_at: r.created_at.toISOString(),
  }));
}

export async function decideNotice(
  deps: Deps,
  id: number,
  input: { decision: unknown; reason: unknown; actor: string },
): Promise<{ emailed: boolean }> {
  if (!CONTENT_DECISIONS.includes(input.decision as ContentDecision)) {
    throw refuse('invalid_decision', 'A decision is removed, restricted or no action.');
  }
  const reason = text(input.reason);
  if (reason.length < 10)
    throw refuse('reason_required', 'Give the reason. The sender is told it.');
  if (reason.length > 2000)
    throw refuse('reason_too_long', 'Keep the reason under 2000 characters.');
  const { db } = deps;
  const row = await db.transaction().execute(async (trx) => {
    const n = await trx
      .selectFrom('content_notices')
      .select(['id', 'receipt', 'status', 'sender_email', 'token_hash'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!n) throw notFound('There is no such notice.');
    if (n.status === 'decided') {
      throw new HttpError(409, 'already_decided', 'That notice has been decided.');
    }
    await trx
      .updateTable('content_notices')
      .set({
        status: 'decided',
        decision: input.decision as ContentDecision,
        decision_reason: reason,
        decided_by: input.actor,
        decided_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    await trx
      .insertInto('content_notice_events')
      .values({
        notice_id: id,
        action: 'decided',
        actor: input.actor,
        detail: input.decision as string,
      })
      .execute();
    return n;
  });
  let emailed = false;
  if (row.sender_email) {
    // The receipt's token is stored only as a hash, so the decision email
    // carries one of its own. Both links go on working.
    const token = randomToken();
    await db
      .updateTable('content_notices')
      .set({ decision_token_hash: sha256Hex(token) })
      .where('id', '=', id)
      .execute();
    emailed = await send(deps, id, 'decision_sent', {
      to: row.sender_email,
      ...decisionEmail({
        receipt: row.receipt,
        decision: input.decision as ContentDecision,
        reason,
        link: statusUrl(deps, token),
        termsUrl: `${deps.siteOrigin}/terms`,
      }),
    });
  }
  // Nothing needs the address any more.
  await db
    .updateTable('content_notices')
    .set({ sender_email: null })
    .where('id', '=', id)
    .execute();
  return { emailed };
}
