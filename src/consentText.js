import crypto from 'node:crypto';
import { pool } from './db.js';

/**
 * The publication card's wording, and the digest that ties a stored answer
 * to the sentence it answered.
 *
 * WHY THE SERVER OWNS THIS TEXT. The digest is written into the hashed
 * object, so it has to be computed from what the reporter actually read. The
 * server cannot digest text that lives only in `public/index.html` — nginx
 * serves that file directly and nothing here has ever seen it. The remaining
 * option, letting the browser send the digest, would allow a client to seal a
 * claim about a sentence it never displayed: a false statement inside the
 * fingerprint, which is worse than no digest at all.
 *
 * So the text lives here, the form asks for it (`GET /api/reports/consent-text`),
 * and the digest is computed from the same string that was sent. There is one
 * copy, so there is nothing to drift from.
 *
 * WHY IT IS NOT "CONSENT". The archive's lawful basis is deliberately not
 * Article 6(1)(a) consent — that would drag in the Article 7(3) withdrawal
 * right and make Article 17 erasure hardest to resist, on an archive that
 * cannot delete. The card therefore asks a question about the report rather
 * than soliciting permission in the legal sense. Calling it consent while not
 * honouring withdrawal is the pattern regulators treat as deceptive. The file
 * is named for the card, the key is `may_publish`, and the word consent
 * appears in neither.
 */

/** The card, in display order. Changing any of this changes the digest. */
export const CARD = {
  question: 'Should this report be published?',
  body: [
    'If it is published, it goes on a public archive that anyone can read, '
      + 'search and download. Publication is permanent. You can ask later for a '
      + 'published report to be hidden from the public archive, but it cannot be '
      + 'unpublished as though it had never been public.',
    // THE REPORT'S OWN WORDS, and only those. This sentence used to read
    // "your report and anything you attached to it", which was true when
    // there was one permission. There are two: publishing the words and
    // publishing the files are separate decisions, and the second can be
    // taken back afterwards while this one cannot. One sentence covering
    // both described a permission model that no longer exists.
    'This covers the report itself — your answers, in your words. Your '
      + 'email address is not part of what would be published.',
    // THE FILES, SAID SEPARATELY, because the answer is different in kind.
    // src/renditions.js reads this permission at the moment of publishing
    // rather than trusting it from earlier, and taking it back takes
    // published files down — so "you can change your mind" is a promise the
    // code actually keeps, and the card is allowed to make it.
    'Anything you attached is asked about separately, and that one you can '
      + 'change your mind about: switching it off later takes any published '
      + 'file back down. This answer, about the report itself, is sealed into '
      + 'the record and cannot be changed afterwards.',
  ],
  // Shown only when a coordinator is filing on somebody else's behalf.
  //
  // It is here because `filed_via` is inside the hashed object and is public,
  // while an organization a reporter states about themselves is Tier B and
  // encrypted. Two different things sharing one word, and the general card's
  // sentence would be false on this path if it named organizations at all.
  coordinatorNote: 'The organization this was filed through is part of the '
    + 'report and is public.',
  // What makes the question visibly optional rather than merely optional. A
  // person who knows they can walk past it before they act has been offered a
  // choice; one who finds out afterwards has been handled.
  optionality: 'Your report is recorded and reviewed either way. If you do not '
    + 'answer, it will not be published.',
  options: {
    yes: 'Yes, it may be published',
    no: 'No, keep it out of the public archive',
  },
};

/**
 * Every visible line of the card, in the order it is read.
 *
 * The option labels are in here because they are part of what was answered.
 * Leaving them out would let "Yes, it may be published" become something else
 * without the digest noticing.
 */
export function cardLines(variant) {
  const body = variant === 'coordinator'
    ? [...CARD.body, CARD.coordinatorNote]
    : CARD.body;
  return [
    CARD.question,
    ...body,
    CARD.optionality,
    CARD.options.yes,
    CARD.options.no,
  ];
}

/**
 * The normalization, stated here so it can never quietly change: trim each
 * line, join with a single newline, Unicode NFC, UTF-8, SHA-256, lowercase
 * hex, all 64 characters.
 *
 * Not truncated. A short digest saves nothing and invites an argument about
 * collisions on a value that is sealed forever.
 */
export function digestOf(lines) {
  const normalized = lines.map((l) => l.trim()).join('\n').normalize('NFC');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export const VARIANTS = ['general', 'coordinator'];

/** The text and digest for one variant, as the form should render it. */
export function cardFor(variant) {
  const v = VARIANTS.includes(variant) ? variant : 'general';
  const lines = cardLines(v);
  return {
    variant: v,
    question: CARD.question,
    body: v === 'coordinator' ? [...CARD.body, CARD.coordinatorNote] : CARD.body,
    optionality: CARD.optionality,
    options: CARD.options,
    digest: digestOf(lines),
  };
}

/**
 * Record a variant's current text if this exact wording has not been seen.
 *
 * Insert-only. A changed sentence is a new row with a new digest; reports
 * filed before it keep pointing at the old one, which is still readable. The
 * table's own trigger refuses UPDATE and DELETE, so an edit is not available
 * even by mistake.
 *
 * Called at boot rather than at filing time so that the row a report's digest
 * names is already there before any report can name it.
 */
export async function recordCardTexts() {
  for (const variant of VARIANTS) {
    const lines = cardLines(variant);
    await pool.query(
      `INSERT INTO consent_texts (digest, variant, body, introduced_by_role)
       VALUES ($1, $2, $3, 'deployment')
       ON CONFLICT (digest) DO NOTHING`,
      [digestOf(lines), variant, lines.join('\n')],
    );
  }
}

/** Every wording this deployment has ever shown. Published, not private. */
export async function allCardTexts() {
  const { rows } = await pool.query(
    `SELECT digest, variant, body, introduced_by_role, first_seen_at
     FROM consent_texts ORDER BY first_seen_at, digest`,
  );
  return rows;
}

/**
 * Is this digest one this deployment has actually shown?
 *
 * The answer and the digest both arrive from the client, so neither is
 * trusted. A digest naming wording that was never on screen here would make
 * the sealed record uninterpretable, which is the one failure this whole
 * mechanism exists to prevent.
 */
export async function isKnownDigest(digest, variant = null) {
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) return false;
  // With a variant, the digest must name wording of THAT card: a coordinator
  // records what the person they spoke to agreed to, on the wording
  // coordinators are shown.
  const { rows } = variant
    ? await pool.query('SELECT 1 FROM consent_texts WHERE digest = $1 AND variant = $2', [digest, variant])
    : await pool.query('SELECT 1 FROM consent_texts WHERE digest = $1', [digest]);
  return rows.length > 0;
}
