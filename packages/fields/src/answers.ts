/**
 * Build the answer map for one submission against one question set.
 *
 * THE ABSENT-KEY RULE APPLIES INSIDE THE MAP. A question nobody answered has
 * no entry at all, and `answers` itself is `undefined` (not `{}`) when nothing
 * was answered.
 *
 * This lives in `@reportlog/fields`, not with the sealing code, so a list
 * (which seals nothing) can use exactly the same rules without being able to
 * reach anything that writes to a chain.
 */
import { UNSEALED_TYPES } from './fieldTypes.ts';
import { normalizeAnswer } from './normalize.ts';
import { isAsked } from './options.ts';
import type { Answers, FieldDefinition } from './types.ts';

export interface BuiltAnswers {
  answers: Answers | undefined;
  errors: string[];
}

export function buildAnswers(
  fields: readonly FieldDefinition[],
  body: Record<string, unknown> | null | undefined,
): BuiltAnswers {
  const answers: Answers = {};
  const errors: string[] = [];
  for (const f of fields) {
    // WAS THIS QUESTION ASKED AT ALL? Evaluated against the answers built so
    // far, which is sufficient because a condition may only name an earlier
    // question. A question that was not put seals nothing, its `required`
    // does not apply, and an answer that arrives for it anyway is dropped.
    // A question whose option sets offer nothing to this reporter was not put
    // either (options.ts).
    if (!isAsked(f, answers)) continue;
    // The upload question never produces a sealed answer, so it is skipped
    // before the required check rather than failing every submission.
    if (UNSEALED_TYPES.has(f.kind)) continue;
    const value = normalizeAnswer(f.kind, body?.[f.key], f.settings ?? {}, { answers });
    if (value === null) {
      if (f.required) errors.push(`${f.label} is needed`);
      continue;
    }
    answers[f.key] = value;
  }
  // Questions the form does not have are DROPPED SILENTLY, not rejected: a
  // form left open in a tab must not fail on a key nobody can see. A path
  // that must refuse them says so with `strictProblems` below.
  return { answers: Object.keys(answers).length ? answers : undefined, errors };
}

/** Nothing was sent for it: no key, an empty box, or no boxes ticked. */
export function isBlankAnswer(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.every(isBlankAnswer))
  );
}

export type StrictReason = 'unknown' | 'not-asked' | 'not-accepted';

export interface StrictProblem {
  key: string;
  reason: StrictReason;
}

/**
 * THE STRICT READING of a submission (ElectionLog questionnaire §01, ruling
 * 49): every key sent must be a question the form has, asked of this person,
 * with a value it accepts. `buildAnswers` drops each of these without a word,
 * which is right for a form left open in a tab and wrong for a server that
 * promises to refuse them. Kept apart so a list can stay lenient.
 *
 *   unknown       a key the form does not have
 *   not-asked     an answer to a question whose "only if" does not hold, or
 *                 whose option sets offer this person nothing
 *   not-accepted  a value that is not one this question takes: a choice not
 *                 in its (conditional) list, a county outside its state, a
 *                 tick box sent as false
 *
 * A BLANK VALUE IS NOT AN ANSWER, so it is never refused: an empty box sent
 * for a hidden question has sent nothing.
 */
export function strictProblems(
  fields: readonly FieldDefinition[],
  body: Record<string, unknown> | null | undefined,
): StrictProblem[] {
  const sent = body ?? {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const problems: StrictProblem[] = [];
  for (const [key, v] of Object.entries(sent)) {
    if (!byKey.has(key) && !isBlankAnswer(v)) problems.push({ key, reason: 'unknown' });
  }
  const answers: Answers = {};
  for (const f of fields) {
    const v = sent[f.key];
    if (!isAsked(f, answers)) {
      if (!isBlankAnswer(v)) problems.push({ key: f.key, reason: 'not-asked' });
      continue;
    }
    if (UNSEALED_TYPES.has(f.kind) || isBlankAnswer(v)) continue;
    const value = normalizeAnswer(f.kind, v, f.settings ?? {}, { answers });
    if (value === null) {
      problems.push({ key: f.key, reason: 'not-accepted' });
      continue;
    }
    // A list with something in it that is not on offer is refused, though
    // the rest of it would normalize: `normalizeAnswer` keeps the good boxes.
    if (Array.isArray(v) && Array.isArray(value)) {
      const kept = new Set(value);
      if (v.some((x) => !isBlankAnswer(x) && !kept.has(String(x).trim()))) {
        problems.push({ key: f.key, reason: 'not-accepted' });
        continue;
      }
    }
    answers[f.key] = value;
  }
  return problems;
}
