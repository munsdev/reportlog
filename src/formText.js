/**
 * The form a report was answered against, as bytes that can be hashed.
 * PURE: no database, so reportCore.js and the verifier can use it.
 * The storage side is src/logbookForms.js, and the reasoning is there.
 *
 * WHAT IS IN A DEFINITION: the logbook's slug and, in the operator's order,
 * each question's key, kind, label, help, whether it is required, when it is
 * asked at all, and its settings — everything that changes what a question
 * MEANS. Not the title or blurb, not whether the logbook takes files, not
 * whether a question is a board filter: those are delivery, may change, and
 * change no answer.
 *
 * `help` is written only when there is some, the same absent-key rule the
 * rest of the archive runs on. `shown_when` likewise, and there it is
 * load-bearing rather than tidy: writing it unconditionally would change the
 * hash of every form definition that already exists, and so break the sealed
 * `logbook_form` of every report ever filed against them.
 *
 * WHY WHETHER A QUESTION WAS ASKED BELONGS IN HERE. A report with no answer
 * to question 7 means one thing if question 7 was put to that reporter and
 * another if it was not, and somebody checking an old report must be able to
 * tell which. So the condition travels with the questions it was answered
 * against, not as a setting that might have changed since.
 *
 * Never re-serialize a stored definition to hash it: hash the string.
 */
import canonicalize from 'canonicalize';
import { sha256Hex } from './crypto.js';

export const FORM_DEFINITION_VERSION = 1;

/** The object whose RFC 8785 serialization is the definition. */
export function formDefinition(slug, fields) {
  return {
    reportlog_form: FORM_DEFINITION_VERSION,
    logbook: slug,
    questions: fields.map((f) => ({
      key: f.key,
      kind: f.kind,
      label: f.label,
      ...(f.help ? { help: f.help } : {}),
      required: Boolean(f.required),
      // ONLY WHEN THERE IS ONE. See the note above: an unconditional key
      // here rehashes every form definition in existence.
      ...(f.shown_when ? { shown_when: f.shown_when } : {}),
      settings: f.settings || {},
    })),
  };
}

/** The definition text and its hash, from a logbook's slug and questions. */
export function formText(slug, fields) {
  const definition = canonicalize(formDefinition(slug, fields));
  return { definition, hash: sha256Hex(definition) };
}

