/**
 * Organization intake links (Plan E, PE3: the trusted lane).
 *
 * WHAT ONE IS. A link an organization's manager (or somebody who grants
 * access) makes and hands to the organization's volunteers. A person who
 * opens it, signed in, joins the organization as a COORDINATOR, and from
 * then on files for it while signed in (filing/intake.ts), so their reports
 * are sealed as the organization's and sort first in the queue. It never
 * makes a manager: managers cannot make managers (identity/organizations.ts),
 * and a link must not be a way round that.
 *
 * A LINK CAN LEAK, so each has a USE LIMIT and an OFF SWITCH, and both are
 * enforced by the database as well (the migration's triggers): a use past
 * the limit, or on a link that is off, is refused even if this code forgot
 * to ask. A link switched off stays off; a new one is made instead.
 *
 * The token travels once and is stored as a hash, like an invitation. Each
 * use is a row (who, when), and the join is in role_audit like any other.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { organizationName } from '../identity/organizations.ts';
import { recordRoleChange } from '../identity/roles.ts';
import { randomToken, sha256Hex } from '../identity/secrets.ts';

const refuse = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);

const GONE =
  'This intake link does not work. Ask the organization that gave it to you for a new one.';
export const OFF = 'This intake link has been switched off. Ask the organization for a new one.';
export const FULL =
  'This intake link has been used as many times as it may be. Ask the organization for a new one.';

function links(db: Kysely<DB>) {
  return db.selectFrom('organization_intake_links as k').select((eb) => [
    'k.id',
    'k.organization_id',
    'k.label',
    'k.max_uses',
    'k.created_by',
    'k.created_at',
    'k.disabled_at',
    eb
      .selectFrom('organization_intake_link_uses as u')
      .whereRef('u.link_id', '=', 'k.id')
      .select((e) => e.fn.countAll<string>().as('n'))
      .as('uses'),
  ]);
}

type Row = Awaited<ReturnType<ReturnType<typeof links>['execute']>>[number];

const present = (r: Row) => ({
  id: r.id,
  label: r.label,
  max_uses: r.max_uses,
  uses: Number(r.uses ?? 0),
  created_by: r.created_by,
  created_at: r.created_at.toISOString(),
  disabled_at: r.disabled_at ? r.disabled_at.toISOString() : null,
});

export async function listIntakeLinks(db: Kysely<DB>, organizationId: number) {
  const rows = await links(db)
    .where('k.organization_id', '=', organizationId)
    .orderBy('k.id', 'desc')
    .execute();
  return rows.map(present);
}

export async function createIntakeLink(
  db: Kysely<DB>,
  input: { organizationId: number; label: string; maxUses: number; actor: string },
) {
  const label = input.label.trim();
  if (!label)
    throw refuse(400, 'label_required', 'Give the link a name, so you know which one it is later.');
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 10000) {
    throw refuse(400, 'invalid_limit', 'A link may be used between 1 and 10,000 times.');
  }
  if ((await organizationName(db, input.organizationId)) === null) {
    throw notFound('There is no such organization.');
  }
  const token = randomToken();
  const made = await db
    .insertInto('organization_intake_links')
    .values({
      organization_id: input.organizationId,
      token_hash: sha256Hex(token),
      label,
      max_uses: input.maxUses,
      created_by: input.actor,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const row = await links(db).where('k.id', '=', made.id).executeTakeFirstOrThrow();
  return { link: present(row), token };
}

export async function disableIntakeLink(
  db: Kysely<DB>,
  input: { organizationId: number; linkId: number; actor: string },
) {
  const row = await links(db)
    .where('k.id', '=', input.linkId)
    .where('k.organization_id', '=', input.organizationId)
    .executeTakeFirst();
  if (!row) throw notFound('There is no such intake link in this organization.');
  if (!row.disabled_at) {
    await db
      .updateTable('organization_intake_links')
      .set({ disabled_at: new Date(), disabled_by: input.actor })
      .where('id', '=', input.linkId)
      .execute();
  }
  return present(await links(db).where('k.id', '=', input.linkId).executeTakeFirstOrThrow());
}

async function byToken(db: Kysely<DB>, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  return (await links(db).where('k.token_hash', '=', sha256Hex(token)).executeTakeFirst()) ?? null;
}

/** What the link's page shows before anybody joins. */
export async function describeIntakeLink(db: Kysely<DB>, token: string) {
  const row = await byToken(db, token);
  if (!row) throw notFound(GONE);
  const organization = (await organizationName(db, row.organization_id)) ?? '';
  const why = row.disabled_at ? OFF : Number(row.uses ?? 0) >= row.max_uses ? FULL : null;
  return { organization, usable: why === null, why };
}

/**
 * Join as a coordinator. Somebody already in the organization keeps the role
 * they have (a manager is never made a coordinator by a link) and uses
 * nothing up.
 */
export async function joinByIntakeLink(
  db: Kysely<DB>,
  input: { token: string; userId: number; email: string },
) {
  const row = await byToken(db, input.token);
  if (!row) throw notFound(GONE);
  return db.transaction().execute(async (trx) => {
    const name = (await organizationName(trx, row.organization_id)) ?? String(row.organization_id);
    const existing = await trx
      .selectFrom('organization_memberships')
      .select('id')
      .where('organization_id', '=', row.organization_id)
      .where('user_id', '=', input.userId)
      .executeTakeFirst();
    if (existing) {
      return { organization_id: row.organization_id, organization: name, already_member: true };
    }
    // Asked here for a sentence; the trigger asks again, under a lock.
    const locked = await trx
      .selectFrom('organization_intake_links')
      .select(['disabled_at', 'max_uses'])
      .where('id', '=', row.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (locked.disabled_at) throw refuse(410, 'link_off', OFF);
    const used = await trx
      .selectFrom('organization_intake_link_uses')
      .select((e) => e.fn.countAll<string>().as('n'))
      .where('link_id', '=', row.id)
      .executeTakeFirstOrThrow();
    if (Number(used.n) >= locked.max_uses) throw refuse(410, 'link_full', FULL);
    await trx
      .insertInto('organization_intake_link_uses')
      .values({ link_id: row.id, user_id: input.userId })
      .execute();
    await trx
      .insertInto('organization_memberships')
      .values({ organization_id: row.organization_id, user_id: input.userId, role: 'coordinator' })
      .execute();
    await recordRoleChange(trx, {
      actorEmail: input.email,
      subjectEmail: input.email,
      axis: 'organization',
      action: 'grant',
      detail: `joined ${name} as coordinator through the intake link "${row.label}"`,
      organizationId: row.organization_id,
    });
    return { organization_id: row.organization_id, organization: name, already_member: false };
  });
}
