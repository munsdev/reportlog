/**
 * The publication card's wording, and the digest that ties an answer to the
 * sentence it answered.
 *
 * THE SERVER OWNS THIS TEXT. The digest is sealed into the report, so it has
 * to be computed from what the reporter actually read. The form fetches the
 * card from the API and the digest is computed from the same string, so there
 * is one copy and nothing to drift from. A client never supplies a digest the
 * server has not issued.
 *
 * WHY IT IS NOT "CONSENT". The archive's lawful basis is deliberately not
 * GDPR Article 6(1)(a) consent, which would bring the Article 7(3)
 * withdrawal right to an archive that cannot delete. The card asks a question
 * about the report, the key is `may_publish`, and the word consent appears in
 * neither.
 *
 * CHANGING ANY LINE CHANGES THE DIGEST. That is correct: a new wording is a
 * new row in `consent_texts`, and old reports keep pointing at the old one.
 */
import { sha256Hex } from './hash.ts';

export const CARD = {
  question: 'Should this report be published?',
  body: [
    'If it is published, it goes on a public archive that anyone can read, ' +
      'search and download. Publication is permanent. You can ask later for a ' +
      'published report to be hidden from the public archive, but it cannot be ' +
      'unpublished as though it had never been public.',
    // THE REPORT'S OWN WORDS, and only those. Publishing the words and
    // publishing the files are separate decisions, and only the second can
    // be taken back.
    'This covers the report itself — your answers, in your words. Your ' +
      'email address is not part of what would be published.',
    'Anything you attached is asked about separately, and that one you can ' +
      'change your mind about: switching it off later takes any published ' +
      'file back down. This answer, about the report itself, is sealed into ' +
      'the record and cannot be changed afterwards.',
  ],
  // Only when a coordinator files on somebody's behalf: `filed_via` is sealed
  // and public, unlike an organization a reporter mentions about themselves.
  coordinatorNote: 'The organization this was filed through is part of the report and is public.',
  // What makes the question visibly optional before anybody acts.
  optionality:
    'Your report is recorded and reviewed either way. If you do not ' +
    'answer, it will not be published.',
  options: {
    yes: 'Yes, it may be published',
    no: 'No, keep it out of the public archive',
  },
} as const;

export const CARD_VARIANTS = ['general', 'coordinator'] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number];

/**
 * Every visible line, in reading order. The option labels are included:
 * they are part of what was answered.
 */
export function cardLines(variant: CardVariant): string[] {
  const body: string[] =
    variant === 'coordinator' ? [...CARD.body, CARD.coordinatorNote] : [...CARD.body];
  return [CARD.question, ...body, CARD.optionality, CARD.options.yes, CARD.options.no];
}

/**
 * The normalization, stated so it can never quietly change: trim each line,
 * join with a single newline, Unicode NFC, UTF-8, SHA-256, lowercase hex, all
 * 64 characters.
 */
export function digestOf(lines: readonly string[]): string {
  return sha256Hex(
    lines
      .map((l) => l.trim())
      .join('\n')
      .normalize('NFC'),
  );
}

export interface Card {
  variant: CardVariant;
  question: string;
  body: string[];
  optionality: string;
  options: { yes: string; no: string };
  digest: string;
}

/** The text and digest of one variant, as the form renders it. */
export function cardFor(variant: string): Card {
  const v: CardVariant = variant === 'coordinator' ? 'coordinator' : 'general';
  return {
    variant: v,
    question: CARD.question,
    body: v === 'coordinator' ? [...CARD.body, CARD.coordinatorNote] : [...CARD.body],
    optionality: CARD.optionality,
    options: { ...CARD.options },
    digest: digestOf(cardLines(v)),
  };
}

/**
 * THE TERMS, for a logbook where publication is a condition of filing
 * (`logbooks.publish_by_terms`). Not a question and not dressed as one: no
 * options, no "if you do not answer". The reporter is told before they send,
 * and the report seals `may_publish: true` beside THIS digest, so the record
 * says the `true` was a term accepted by filing rather than a box ticked.
 *
 * Kept apart from CARD_VARIANTS on purpose: every variant of the card says
 * filing works either way, and here it does not. Recorded in consent_texts
 * under the variant 'terms', so its digest reads back like the others.
 */
export const TERMS = {
  heading: 'Reports filed here are published',
  body: [
    'By sending this report you agree that, once a moderator approves it, it ' +
      'goes on a public archive that anyone can read, search and download. ' +
      'Publication is permanent. You can ask later for a published report to ' +
      'be hidden from the public archive, but it cannot be unpublished as ' +
      'though it had never been public.',
    'This covers the report itself — your answers, in your words. Your email ' +
      'address is not part of what is published, and anything you attached is ' +
      'asked about separately.',
  ],
} as const;

export function termsLines(): string[] {
  return [TERMS.heading, ...TERMS.body];
}

export interface Terms {
  heading: string;
  body: string[];
  digest: string;
}

/** The terms and their digest, as the form shows them. */
export function termsFor(): Terms {
  return { heading: TERMS.heading, body: [...TERMS.body], digest: digestOf(termsLines()) };
}
