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
import { conditionMet } from './conditions.ts';
import { UNSEALED_TYPES } from './fieldTypes.ts';
import { normalizeAnswer } from './normalize.ts';
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
    if (f.shown_when && !conditionMet(f.shown_when, answers)) continue;
    // The upload question never produces a sealed answer, so it is skipped
    // before the required check rather than failing every submission.
    if (UNSEALED_TYPES.has(f.kind)) continue;
    const value = normalizeAnswer(f.kind, body?.[f.key], f.settings ?? {});
    if (value === null) {
      if (f.required) errors.push(`${f.label} is needed`);
      continue;
    }
    answers[f.key] = value;
  }
  // Questions the form does not have are DROPPED SILENTLY, not rejected: a
  // form left open in a tab must not fail on a key nobody can see.
  return { answers: Object.keys(answers).length ? answers : undefined, errors };
}
