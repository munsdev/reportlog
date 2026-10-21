/**
 * When a question is asked at all.
 *
 * ONE CARD ASKS ONE QUESTION, and nothing on the card in front of somebody
 * changes underneath them, so a question whose relevance depends on an
 * earlier answer is its own card, shown or not shown. A question carries
 * `shown_when` and is asked only when it is satisfied.
 *
 * PURE, because three places need the same answer: the authoring guard, the
 * answer builder, and the form itself.
 *
 * IT IS PART OF WHAT A QUESTION MEANS, so it is sealed into the form
 * definition and written there ONLY WHEN THERE IS ONE. A report with no
 * answer to question 7 means something different depending on whether
 * question 7 was put to that reporter.
 */
import { allOptionCodes } from './optionShape.ts';
import type { Answers, Condition, FieldDefinition } from './types.ts';

/**
 * The types a condition may be asked ABOUT: enumerable answers only. A
 * condition over free prose would re-run keyword matching in front of the
 * reporter as they typed. `place` is excluded because `allowOther` lets a
 * reporter type anything.
 */
export const CONDITIONABLE_KINDS: ReadonlySet<string> = new Set([
  'yes_no',
  'choice_one',
  'choice_many',
  'evidence_declaration',
]);

/** How a yes/no answer is written in a condition. Strings, like every other. */
export const YES = 'yes';
export const NO = 'no';

/** The values a field of this kind can be matched against. */
export function matchableValues(field: FieldDefinition | null | undefined): string[] {
  if (!field) return [];
  if (field.kind === 'yes_no' || field.kind === 'evidence_declaration') return [YES, NO];
  // CODES, NOT LABELS: a condition names what is sealed, so rewording a label
  // can never strand one. A plain string option is its own code.
  return allOptionCodes(field.settings);
}

/**
 * Types that cannot CARRY a condition. Only the upload question: its card is
 * not built from the questions, so a condition on it would be sealed and
 * never honoured.
 */
export const CANNOT_CARRY_CONDITION: ReadonlySet<string> = new Set(['file']);

export type ConditionRefusal =
  'shape' | 'no-field' | 'unknown-field' | 'kind' | 'no-values' | 'unknown-value';

export type NormalizedCondition =
  | { ok: true; condition: Condition | null }
  | { ok: false; reason: ConditionRefusal; unknown?: string[] };

/**
 * Check and normalize a `shown_when` as an operator wrote it.
 *
 * `earlier` is every question BEFORE this one, in the operator's order.
 * Forward references are refused: they would admit cycles, and they are what
 * lets `buildAnswers` work in a single pass.
 */
export function normalizeCondition(
  spec: unknown,
  earlier: readonly FieldDefinition[],
): NormalizedCondition {
  if (spec === null || spec === undefined || spec === '') return { ok: true, condition: null };
  if (typeof spec !== 'object' || Array.isArray(spec)) return { ok: false, reason: 'shape' };
  const s = spec as { field?: unknown; in?: unknown };

  const field = typeof s.field === 'string' ? s.field.trim() : '';
  if (!field) return { ok: false, reason: 'no-field' };

  const target = earlier.find((f) => f.key === field);
  if (!target) return { ok: false, reason: 'unknown-field' };
  if (!CONDITIONABLE_KINDS.has(target.kind)) return { ok: false, reason: 'kind' };

  const raw: unknown[] = Array.isArray(s.in) ? s.in : [s.in];
  const values = [
    ...new Set(raw.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)),
  ];
  if (!values.length) return { ok: false, reason: 'no-values' };

  const allowed = matchableValues(target);
  const unknown = values.filter((v) => !allowed.includes(v));
  if (unknown.length) return { ok: false, reason: 'unknown-value', unknown };

  // ORDER IS THE TARGET'S, NOT THE OPERATOR'S, because the condition is
  // sealed: the same condition written in a different order must hash the same.
  values.sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
  return { ok: true, condition: { field, in: values } };
}

/**
 * Is this condition satisfied by the (normalized) answers given so far?
 * AN UNANSWERED CONTROLLING QUESTION MEANS NOT SHOWN.
 */
export function conditionMet(
  condition: Condition | null | undefined,
  answers: Partial<Answers> | null | undefined,
): boolean {
  if (!condition) return true;
  const given = answers?.[condition.field];
  if (given === undefined) return false;
  if (typeof given === 'boolean') return condition.in.includes(given ? YES : NO);
  if (Array.isArray(given)) return given.some((v) => condition.in.includes(v));
  return condition.in.includes(String(given));
}

/** Which questions are actually asked, given a set of answers. In order. */
export function askedKeys(
  fields: readonly FieldDefinition[],
  answers: Partial<Answers> | null | undefined,
): Set<string> {
  const asked = new Set<string>();
  for (const f of fields) {
    if (!f.shown_when || conditionMet(f.shown_when, answers)) asked.add(f.key);
  }
  return asked;
}

/** One line of plain English for a condition, for the builder. */
export function describeCondition(
  condition: Condition | null | undefined,
  fields: readonly FieldDefinition[] | null | undefined,
): string {
  if (!condition) return '';
  const target = fields?.find((f) => f.key === condition.field);
  const name = target ? target.label : condition.field;
  if (target?.kind === 'yes_no') {
    return `Asked only when “${name}” is ${condition.in.includes(YES) ? 'yes' : 'no'}.`;
  }
  const list = condition.in.map((v) => `“${v}”`).join(' or ');
  return `Asked only when “${name}” is ${list}.`;
}
