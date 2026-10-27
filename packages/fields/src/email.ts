/**
 * WHEN A LOGBOOK ASKS FOR AN EMAIL ADDRESS (owner decision E1).
 *
 * Automatically when it asks a question somebody types into, or takes files;
 * the operator may require one on any other form too. A form that asks for
 * neither is an advanced contact form: what it can be sent is the operator's
 * own vocabulary, so there is nothing of the reporter's to confirm, correct
 * or erase, and the report is sealed the moment it arrives.
 *
 * DERIVED FROM THE QUESTIONS, never ticked beside them, so a text question
 * added later cannot be forgotten: the form starts asking for an address the
 * moment it asks for words. (A list decides the same thing for itself, from
 * its own idea of what is personal: apps/api/src/lists/fields.ts.)
 *
 * Pure: no database.
 */
import type { FieldDefinition } from './types.ts';

/**
 * Kinds a person types into, so whatever they type is theirs:
 *
 *   short_text, long_text   free text, whatever the label says.
 *   email                   a second address is an address.
 *   url                     typed, and a link can name a person's own page.
 *   place                   free text unless it is a closed list (below).
 *   private_text,           held outside the report, erasable, never
 *     private_link          published (held.ts).
 *
 * NOT here, because the answer is the operator's vocabulary or a bounded
 * value that cannot carry a sentence: a choice, yes/no, a location code, a
 * number, a date, a time, a date and time.
 */
export const TYPED_KINDS: ReadonlySet<string> = new Set([
  'short_text',
  'long_text',
  'email',
  'url',
  // Erasable text and links (held.ts): typed, and the reporter's to correct
  // or erase, which is what the address is for (gap report D8).
  'private_text',
  'private_link',
]);

/**
 * Kinds that oblige an address for what happens AFTER filing:
 *
 *   file                    files take an address: the staging quota is keyed
 *                           on it, and a file is the reporter's to withdraw.
 *   evidence_declaration    "I have something but am not uploading it" exists
 *                           so a moderator can ask for it later, by email.
 */
export const CONTACT_KINDS: ReadonlySet<string> = new Set(['file', 'evidence_declaration']);

/** Every kind the rule has classed, either way. Anything else asks for an address. */
const CLASSED_SILENT: ReadonlySet<string> = new Set([
  'choice_one',
  'choice_many',
  'yes_no',
  'number',
  'date',
  'time',
  'datetime',
  'location',
  'place',
]);

/**
 * Whether one question makes its form ask for an address. A `place` with a
 * closed list (`allowOther` false and choices to pick from) is a choice; with
 * the escape hatch it is a box to type in. AN UNKNOWN KIND ASKS: a kind added
 * next year that nobody classed must fail towards an unnecessary address, not
 * towards a report nobody can correct.
 */
export function questionNeedsEmail(q: Pick<FieldDefinition, 'kind' | 'settings'>): boolean {
  if (TYPED_KINDS.has(q.kind) || CONTACT_KINDS.has(q.kind)) return true;
  if (q.kind === 'place') {
    const options = q.settings?.options;
    return q.settings?.allowOther !== false || !Array.isArray(options) || !options.length;
  }
  return !CLASSED_SILENT.has(q.kind);
}

/** Whether a form asks for an email address: E1's rule, with the operator's override. */
export function formAsksEmail(
  questions: readonly Pick<FieldDefinition, 'kind' | 'settings'>[],
  operatorRequires = false,
): boolean {
  return operatorRequires || questions.some(questionNeedsEmail);
}

/**
 * Whether a logbook question would be sealed as the reporter typed it: the
 * plain text kinds and a place that takes any words. A logbook may not ask
 * one (nothing a reporter types freely reaches the public record); the held
 * kinds are the free text it may ask. Lists are not subject to this.
 */
export function isPublishedFreeText(q: Pick<FieldDefinition, 'kind' | 'settings'>): boolean {
  if (q.kind === 'place') return questionNeedsEmail(q);
  return (
    q.kind === 'short_text' || q.kind === 'long_text' || q.kind === 'url' || q.kind === 'email'
  );
}
