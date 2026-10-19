/**
 * The wording behind every sealed publication answer, read back by digest.
 *
 * A report seals `may_publish` beside the digest of the exact sentence its
 * reporter answered (packages/seal/src/consent.ts), and the answer means
 * nothing without the sentence. Somebody checking a published report needs
 * this, so it is part of the public API.
 *
 * NOT ASKED OF THE ARCHIVE SWITCH, as legacy did not ask it. These are the
 * site's own sentences, not the archive: a reporter checking their own
 * report's seal needs the wording whether or not the site shows its archive
 * this week, and nothing here says anything about any report. The
 * publication-switch test names this route as the one deliberate exception.
 *
 * `consent_texts` is append-only in the database, so a wording once listed
 * stays listed. Who introduced it is a role, never a person.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export async function allConsentTexts(db: Kysely<DB>) {
  const rows = await db
    .selectFrom('consent_texts')
    .select(['digest', 'variant', 'body', 'introduced_by_role', 'first_seen_at'])
    .orderBy('first_seen_at')
    .orderBy('digest')
    .execute();
  return rows.map((r) => ({ ...r, first_seen_at: new Date(r.first_seen_at).toISOString() }));
}
