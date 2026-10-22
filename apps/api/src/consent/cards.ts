/**
 * Keeping `consent_texts` in step with the card the code shows.
 *
 * Insert-only: a changed sentence is a new row with a new digest, and
 * reports filed before it keep pointing at the old one. Run at boot, so the
 * row a report's digest names exists before any report can name it (and the
 * foreign key on reports.may_publish_digest insists on that).
 */
import { CARD_VARIANTS, cardLines, digestOf, termsLines } from '@reportlog/seal';
import type { CardVariant } from '@reportlog/seal';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

/** A wording a report's digest may name: a variant of the card, or the terms. */
export type Wording = CardVariant | 'terms';

export async function recordCardTexts(db: Kysely<DB>): Promise<void> {
  // The terms are recorded beside the card's variants, so a report filed
  // under them names wording this table can read back.
  const wordings: [Wording, string[]][] = [
    ...CARD_VARIANTS.map((v): [Wording, string[]] => [v, cardLines(v)]),
    ['terms', termsLines()],
  ];
  for (const [variant, raw] of wordings) {
    const lines = raw.map((l) => l.trim());
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
  variant?: Wording,
): Promise<boolean> {
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) return false;
  let q = db.selectFrom('consent_texts').select('digest').where('digest', '=', digest);
  if (variant) q = q.where('variant', '=', variant);
  return (await q.executeTakeFirst()) !== undefined;
}
