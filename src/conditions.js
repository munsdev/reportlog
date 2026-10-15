/**
 * When a question is asked at all.
 *
 * ONE CARD ASKS ONE QUESTION, and nothing on the card in front of somebody
 * changes underneath them — so a question whose relevance depends on an
 * earlier answer cannot reveal itself on the same card. It has to be its own
 * card, shown or not shown. The form engine has supported exactly that since
 * it was written (`when` and `settled` in public/js/form.js), and the only
 * conditions in the whole application were three hardcoded ones: which
 * logbook, does it take files, did they say yes to having files.
 *
 * This is the operator's version of that. A question carries `shown_when`
 * and is asked only when it is satisfied.
 *
 * PURE. No database and no DOM, because three places need the same answer
 * and must not each have their own: the authoring guard in src/logbooks.js,
 * the answer validator in src/answers.js, and the form itself.
 *
 * IT IS PART OF WHAT A QUESTION MEANS, so it is sealed into the form
 * definition (src/formText.js) and is editable only while the logbook is a
 * draft. "Were you asked this?" is not a presentation detail — a report with
 * no answer to question 7 means something different depending on whether
 * question 7 was put to that reporter, and a reader checking an old report
 * has to be able to tell which.
 *
 * WRITTEN INTO THE DEFINITION ONLY WHEN THERE IS ONE. The absent-key rule,
 * for the usual reason: an unconditional `shown_when: null` would change the
 * form hash of every logbook that already exists, and therefore break the
 * `logbook_form` seal of every report ever filed against them.
 */

/**
 * The types a condition may be asked ABOUT.
 *
 * Enumerable answers only. A condition on free prose — "shown when the
 * account mentions police" — reads like a feature and is a trap: it would
 * re-run keyword matching at form time, in front of the reporter, with the
 * question appearing and disappearing as they typed. Triage over prose
 * belongs to the moderator's side, where it is reviewable.
 *
 * `place` is excluded even though it can carry options, because
 * `allowOther` lets a reporter type anything and a condition over a set
 * somebody can add to is not a fixed question.
 */
export const CONDITIONABLE_KINDS = new Set([
  'yes_no', 'choice_one', 'choice_many',
  // The declaration is the condition the whole pattern is built on: the
  // "what is it of?" question is asked only when somebody said they had
  // something. Two cards, because one card asks one question.
  'evidence_declaration',
]);

/** How a yes/no answer is written in a condition. Strings, like every other. */
export const YES = 'yes';
export const NO = 'no';

/**
 * The values a field of this kind can be matched against.
 *
 * Used by the authoring guard to refuse a condition naming an option that
 * does not exist — which would otherwise be a question that can never be
 * asked, discovered by nobody until a reporter failed to see it.
 */
export function matchableValues(field) {
  if (!field) return [];
  // The declaration seals a boolean, so the answers it can be matched
  // against are the same two. Named rather than falling through to
  // `settings.options`, which it has none of — that would have returned an
  // empty list and refused every condition on it as "no values".
  if (field.kind === 'yes_no' || field.kind === 'evidence_declaration') return [YES, NO];
  const options = Array.isArray(field.settings?.options) ? field.settings.options : [];
  return options.slice();
}

/**
 * Types that cannot CARRY a condition, as opposed to being asked about one.
 *
 * Only the upload question, and for a reason worth stating. Its card is not
 * one of the cards built from the questions: a logbook takes files if it has
 * an upload question at all, and the two evidence cards the form already has
 * are gated on THAT and nothing else (`lbTakesFiles` in public/js/form.js).
 * So a condition here would be stored, sealed into the form definition, and
 * never honoured — the archive would carry a record of a rule that no
 * reporter was ever subject to, which is worse than a setting that merely
 * does nothing.
 *
 * Whether the upload card should be conditional is a real question and the
 * answer is not "accept the key and ignore it". When it is wanted, the
 * evidence cards have to consult it, and this set is what will have to be
 * emptied deliberately to do that.
 */
export const CANNOT_CARRY_CONDITION = new Set(['file']);

/**
 * Check and normalize a `shown_when` as written by an operator.
 *
 * `earlier` is every field that comes BEFORE this one, in the operator's
 * order. Forward references are refused rather than resolved: a question
 * answered on card 9 cannot decide whether card 4 is asked, and allowing it
 * would also admit cycles, which have no answer at all.
 *
 * Returns { ok, condition } or { ok: false, reason }.
 */
export function normalizeCondition(spec, earlier) {
  if (spec === null || spec === undefined || spec === '') return { ok: true, condition: null };
  if (typeof spec !== 'object' || Array.isArray(spec)) return { ok: false, reason: 'shape' };

  const field = typeof spec.field === 'string' ? spec.field.trim() : '';
  if (!field) return { ok: false, reason: 'no-field' };

  const target = earlier.find((f) => f.key === field);
  // Deliberately one reason for "there is no such question" and "it comes
  // after this one": an operator reordering their draft hits the second
  // constantly, and the message has to say which.
  if (!target) return { ok: false, reason: 'unknown-field' };
  if (!CONDITIONABLE_KINDS.has(target.kind)) return { ok: false, reason: 'kind' };

  const raw = Array.isArray(spec.in) ? spec.in : [spec.in];
  const values = [...new Set(raw.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean))];
  if (!values.length) return { ok: false, reason: 'no-values' };

  const allowed = matchableValues(target);
  const unknown = values.filter((v) => !allowed.includes(v));
  if (unknown.length) return { ok: false, reason: 'unknown-value', unknown };

  // ORDER IS THE TARGET'S, NOT THE OPERATOR'S. The condition is sealed into
  // the form definition, so two operators writing the same condition with
  // the values in a different order must produce the same hash.
  values.sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
  return { ok: true, condition: { field, in: values } };
}

/**
 * Is this condition satisfied by the answers given so far?
 *
 * Takes NORMALIZED answers — the map buildAnswers is assembling — so the
 * shapes are the ones src/answers.js guarantees: a boolean for yes_no, a
 * string for choice_one, a sorted array for choice_many.
 *
 * AN UNANSWERED CONTROLLING QUESTION MEANS NOT SHOWN. Somebody who skipped
 * the question that decides this one has not asked for it, and the
 * alternative — showing a dependent question by default — would put a
 * question in front of people it was written to spare.
 */
export function conditionMet(condition, answers) {
  if (!condition) return true;
  const given = answers ? answers[condition.field] : undefined;
  if (given === undefined || given === null) return false;
  if (typeof given === 'boolean') return condition.in.includes(given ? YES : NO);
  if (Array.isArray(given)) return given.some((v) => condition.in.includes(v));
  return condition.in.includes(given);
}

/**
 * Which of these fields are actually asked, given a set of answers.
 *
 * IN ORDER, because visibility cascades: question 5 may depend on 3, which
 * depends on 1, and a hidden 3 has no answer, so 5 is hidden too. Evaluated
 * against the answers accumulated so far rather than the whole map, which is
 * the same thing when conditions can only look backwards — and refusing
 * forward references in `normalizeCondition` is what makes it the same
 * thing.
 *
 * Returns a Set of keys. Takes already-normalized answers.
 */
export function askedKeys(fields, answers) {
  const asked = new Set();
  for (const f of fields) {
    if (!f.shown_when || conditionMet(f.shown_when, answers)) asked.add(f.key);
  }
  return asked;
}

/**
 * One line of plain English for a condition, for the builder and the
 * logbook file's human-readable half.
 *
 * Here rather than in a template because the operator reads this to check
 * they have written what they meant, and it must not drift from what
 * `conditionMet` does.
 */
export function describeCondition(condition, fields) {
  if (!condition) return '';
  const target = (fields || []).find((f) => f.key === condition.field);
  const name = target ? target.label : condition.field;
  if (target && target.kind === 'yes_no') {
    return `Asked only when “${name}” is ${condition.in.includes(YES) ? 'yes' : 'no'}.`;
  }
  const list = condition.in.map((v) => `“${v}”`).join(' or ');
  return `Asked only when “${name}” is ${list}.`;
}
