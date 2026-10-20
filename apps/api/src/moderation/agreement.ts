/**
 * The agreement a person accepts before they act (M8).
 *
 * GENERIC ON PURPOSE. The audience is a word ('moderator' now, 'journalist'
 * in the journalist desk), so the second user of this is a new guard line and
 * not a second implementation. The texts and the acceptances are two
 * append-only tables: a new version is a new row, and whether somebody may
 * act now is a read of what they accepted against the newest text, never a
 * flag that could be left switched on.
 *
 * NO TEXT, NOTHING TO ACCEPT. Until the owner publishes an agreement for an
 * audience the guard lets that audience through: a fresh install must be
 * able to moderate its first report. The owner publishing one is what turns
 * the requirement on, for everybody at once.
 */
import { createHash } from 'node:crypto';
import type { AgreementAudience } from '@reportlog/contracts';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { requireRole } from '../identity/guards.ts';
import type { SystemRole } from '@reportlog/access';

export const MAX_AGREEMENT = 20000;

const digestOf = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex');

export async function newestText(db: Kysely<DB>, audience: AgreementAudience) {
  return db
    .selectFrom('agreement_texts')
    .select(['id', 'version', 'body', 'digest', 'created_at'])
    .where('audience', '=', audience)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();
}

/** True when there is nothing to accept, or this person accepted the newest text. */
export async function hasAccepted(
  db: Kysely<DB>,
  audience: AgreementAudience,
  email: string,
): Promise<boolean> {
  const text = await newestText(db, audience);
  if (!text) return true;
  const row = await db
    .selectFrom('agreement_acceptances')
    .select('id')
    .where('text_id', '=', text.id)
    .where('user_email', '=', email)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

export async function agreementState(db: Kysely<DB>, audience: AgreementAudience, email: string) {
  const text = await newestText(db, audience);
  return {
    audience,
    current: text
      ? {
          version: text.version,
          body: text.body,
          digest: text.digest,
          published_at: text.created_at.toISOString(),
        }
      : null,
    accepted: await hasAccepted(db, audience, email),
  };
}

export async function publishAgreement(
  db: Kysely<DB>,
  audience: AgreementAudience,
  body: unknown,
  actor: string,
): Promise<number> {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new HttpError(400, 'incomplete', 'Write the agreement before publishing it.');
  if (text.length > MAX_AGREEMENT) {
    throw new HttpError(
      400,
      'too_long',
      `Keep the agreement under ${String(MAX_AGREEMENT)} characters.`,
    );
  }
  // Two administrators publishing at once must not both become version 5.
  return db.transaction().execute(async (trx) => {
    const last = await trx
      .selectFrom('agreement_texts')
      .select('version')
      .where('audience', '=', audience)
      .orderBy('version', 'desc')
      .limit(1)
      .forUpdate()
      .executeTakeFirst();
    const version = (last?.version ?? 0) + 1;
    await trx
      .insertInto('agreement_texts')
      .values({ audience, version, body: text, digest: digestOf(text), created_by: actor })
      .execute();
    return version;
  });
}

export async function accept(
  db: Kysely<DB>,
  audience: AgreementAudience,
  email: string,
  digest: unknown,
): Promise<void> {
  const text = await newestText(db, audience);
  if (!text) throw new HttpError(404, 'not_found', 'There is no agreement to accept.');
  // The words that were on screen, not whatever is newest by the time the
  // button is pressed: a new version published meanwhile must be read again.
  if (digest !== text.digest) {
    throw new HttpError(
      409,
      'agreement_changed',
      'The agreement changed while you were reading it. Read the new one and accept it again.',
    );
  }
  await db
    .insertInto('agreement_acceptances')
    .values({ text_id: text.id, user_email: email })
    .execute();
}

export async function acceptances(db: Kysely<DB>, audience: AgreementAudience) {
  const rows = await db
    .selectFrom('agreement_acceptances as a')
    .innerJoin('agreement_texts as t', 't.id', 'a.text_id')
    .select(['a.user_email', 't.version', 'a.accepted_at'])
    .where('t.audience', '=', audience)
    .orderBy('a.id', 'desc')
    .execute();
  return rows.map((r) => ({
    user_email: r.user_email,
    version: r.version,
    accepted_at: r.accepted_at.toISOString(),
  }));
}

export const agreementRequired = (audience: AgreementAudience) =>
  new HttpError(
    403,
    'agreement_required',
    audience === 'moderator'
      ? 'Read and accept the moderator agreement before you work on reports.'
      : 'Read and accept the agreement before you continue.',
  );

/**
 * The guard for a whole scope: the role check, and then the agreement. Every
 * moderator scope uses this one line instead of a bare `roleGuard`, so a
 * route added to the scope later cannot forget to ask.
 */
export function agreementGuard(
  db: Kysely<DB>,
  audience: AgreementAudience,
  roles: readonly SystemRole[],
): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest) => {
    const user = requireRole(request, roles);
    if (!(await hasAccepted(db, audience, user.email))) throw agreementRequired(audience);
  };
}

/** The moderator scopes' guard: moderators and administrators, having accepted. */
export const moderatorGuard = (db: Kysely<DB>) =>
  agreementGuard(db, 'moderator', ['moderator', 'admin']);
