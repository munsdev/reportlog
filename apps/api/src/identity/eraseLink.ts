/**
 * The erase link in the confirmation email (I5).
 *
 * A REPORTER NEEDS NO ACCOUNT TO ERASE THEIR ADDRESS. The email that asks
 * them to confirm carries a second link, to a page that SHOWS what erasing
 * would do and CHANGES NOTHING until a button on it is pressed. The look is a
 * GET and the erasure a POST, so a mail scanner or a link preview that opens
 * the link erases nothing.
 *
 * THE TOKEN IS THE CONFIRMATION TOKEN. It was emailed to the one person who
 * can read that inbox, and it already shows them where their report stands;
 * a second secret would be a second thing to lose. It is looked up by hash
 * and never logged (the request log carries the route pattern only).
 *
 * WHAT IT DOES is what the signed-in erase does, through the same function
 * (`eraseReporterContact`): destroy the key the address is kept under. The
 * report is NOT withdrawn (owner decision 39). Afterwards the confirmation
 * row is gone, so the link answers "not found": there is nothing left for it
 * to find, which is the point.
 *
 * BEFORE THE REPORT IS FILED there is nothing to erase: the report is only
 * staged, and the address is dropped by letting the confirmation lapse.
 */
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { eraseReporterContact } from '../filing/mine.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { limiter } from './limiter.ts';
import { sha256Hex } from './secrets.ts';

const gone = () =>
  notFound('This link does not match anything. If you already used it, your address is erased.');

async function submissionOf(db: Kysely<DB>, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw gone();
  const row = await db
    .selectFrom('report_submissions as s')
    .innerJoin('logbooks as l', 'l.id', 's.logbook_id')
    .leftJoin('report_heads as h', 'h.thread_id', 's.thread_id')
    .leftJoin('reports as r', 'r.id', 'h.current_report_id')
    .select(['s.thread_id', 'l.title as logbook_title', 'r.public_ref'])
    .where('s.token_hash', '=', sha256Hex(token))
    .executeTakeFirst();
  if (!row) throw gone();
  return row;
}

export function eraseLinkRoutes(app: FastifyInstance, deps: { db: Kysely<DB> }): void {
  const { db } = deps;
  const perClient = limiter({ max: 30, windowMs: 60 * 60 * 1000 });

  route(app, C.lookEraseLink, async ({ params, request }) => {
    perClient.take(request.ip);
    const row = await submissionOf(db, params.token);
    return {
      state: row.thread_id ? ('filed' as const) : ('not_yet_filed' as const),
      logbook_title: row.logbook_title,
      public_ref: row.public_ref ?? null,
    };
  });

  route(app, C.eraseViaLink, async ({ params, request }) => {
    perClient.take(request.ip);
    const body = request.body as { confirm?: boolean };
    const row = await submissionOf(db, params.token);
    if (!row.thread_id) {
      throw new HttpError(
        409,
        'not_filed',
        'Your report has not been filed yet, so there is nothing to erase. Ignore the email and nothing is kept.',
      );
    }
    if (body.confirm !== true) {
      throw new HttpError(
        400,
        'incomplete',
        'Press the button to confirm that you want this erased.',
      );
    }
    await eraseReporterContact(db, row.thread_id);
    return { ok: true as const };
  });
}
