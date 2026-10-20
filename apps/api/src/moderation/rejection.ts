/**
 * Telling a reporter their report was turned down (M1, D2).
 *
 * WHAT IS SENT: one reason from the fixed list (@reportlog/contracts
 * `REJECTION_REASONS`), the plain fact that the report stays in the record
 * and was not published, and the terms clause. NEVER the moderator's own
 * sentence: that stays on the record for oversight and is not sent.
 *
 * ONLY A REJECTED REPORT SENDS ANYTHING. Removing a link or a tip emails
 * nobody (D2): the terms of use say they may be checked, withheld, removed
 * and reported to a hotline, which is the notice.
 *
 * THE ADDRESS IS OPENED BY THE SERVER, NOT BY A PERSON. The moderator who
 * declines never sees it. That decrypt is logged as what it is, a row in
 * `decision_notices` saying `sent`, and not as a person reading contact
 * details (`contact_access_log`), so the two are never mistaken for each
 * other (I4, decision 41).
 *
 * A REPORT WHOSE EMAIL KEY WAS DESTROYED GETS NO EMAIL. Nobody can be told,
 * and that is recorded as `no_key` rather than hidden: the decline stands.
 *
 * The email goes out after the decision is committed. A mail provider that is
 * down must not stop a moderator declining, and a failed send is recorded
 * (`failed`) so somebody can see it did not go.
 */
import { REJECTION_REASONS } from '@reportlog/contracts';
import type { RejectionReasonCode } from '@reportlog/contracts';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { openContact } from '../filing/contactKeys.ts';
import type { ContactKeyring } from '../filing/contactKeys.ts';
import { HttpError } from '../http/errors.ts';

export type NoticeOutcome = 'sent' | 'no_key' | 'failed' | 'not_configured';

export function reasonLabel(code: unknown): string | null {
  return REJECTION_REASONS.find((r) => r.code === code)?.label ?? null;
}

/** The refusal a decline gets when it names no reason from the list. */
export function requireReasonCode(code: unknown): RejectionReasonCode {
  if (reasonLabel(code) === null) {
    throw new HttpError(
      400,
      'reason_required',
      'Choose the reason the reporter will be told. It has to be one from the list.',
    );
  }
  return code as RejectionReasonCode;
}

export function rejectionEmail(input: {
  publicRef: string;
  logbookTitle: string;
  reason: string;
  termsUrl: string;
}) {
  return {
    subject: `About your report ${input.publicRef}`,
    text:
      `We reviewed your report ${input.publicRef} to “${input.logbookTitle}” and decided not to publish it.\n\n` +
      `The reason: ${input.reason}\n\n` +
      'Your report has not been published. It stays in the archive’s sealed record, unchanged, and nobody can read it on the public board.\n\n' +
      `This decision follows our terms of use, which say what we publish and what we hold back, and how to ask us to look again: ${input.termsUrl}\n`,
  };
}

export async function sendRejectionNotice(
  deps: {
    db: Kysely<DB>;
    mailer: Mailer;
    ring: ContactKeyring | null;
    siteOrigin: string;
  },
  input: { threadId: string; reportId: number; reasonCode: RejectionReasonCode; actor: string },
): Promise<NoticeOutcome> {
  const { db } = deps;
  const outcome = await attempt();
  // Recorded either way. A failure to write this does not undo the decision.
  await db
    .insertInto('decision_notices')
    .values({
      thread_id: input.threadId,
      report_id: input.reportId,
      reason_code: input.reasonCode,
      outcome,
      actor_email: input.actor,
    })
    .execute();
  return outcome;

  async function attempt(): Promise<NoticeOutcome> {
    if (!deps.ring) return 'not_configured';
    const contact = await openContact(db, deps.ring, input.threadId);
    if (!contact?.email) return 'no_key';
    const row = await db
      .selectFrom('reports as r')
      .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
      .select(['r.public_ref', 'l.title'])
      .where('r.id', '=', input.reportId)
      .executeTakeFirstOrThrow();
    try {
      await deps.mailer.send({
        to: contact.email,
        ...rejectionEmail({
          publicRef: row.public_ref,
          logbookTitle: row.title,
          reason: reasonLabel(input.reasonCode) ?? '',
          termsUrl: `${deps.siteOrigin}/terms`,
        }),
      });
      return 'sent';
    } catch {
      // Not the error: a provider's message can carry the address.
      return 'failed';
    }
  }
}
