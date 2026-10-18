/**
 * Keeping `consent_texts` in step with the card the code shows.
 *
 * Insert-only: a changed sentence is a new row with a new digest, and
 * reports filed before it keep pointing at the old one. Run at boot, so the
 * row a report's digest names exists before any report can name it (and the
 * foreign key on reports.may_publish_digest insists on that).
 */
import { CARD_VARIANTS, cardLines, digestOf } from '@reportlog/seal';
import type { CardVariant } from '@reportlog/seal';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export async function recordCardTexts(db: Kysely<DB>): Promise<void> {
  for (const variant of CARD_VARIANTS) {
    const lines = cardLines(variant).map((l) => l.trim());
    await db
      .insertInto('consent_texts')
      .values({
        digest: digestOf(lines),
        variant,
        body: lines.join('\n').normalize('NFC'),
        introduced_by_role: 'deployment',
      })
      .onConflict((oc) => oc.column('digest').doNothing())
      .execute();
  }
}

/**
 * Has this deployment actually shown this wording? With a variant, it must
 * be wording of THAT card.
 */
export async function isKnownDigest(
  db: Kysely<DB>,
  digest: unknown,
  variant?: CardVariant,
): Promise<boolean> {
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) return false;
  let q = db.selectFrom('consent_texts').select('digest').where('digest', '=', digest);
  if (variant) q = q.where('variant', '=', variant);
  return (await q.executeTakeFirst()) !== undefined;
}
