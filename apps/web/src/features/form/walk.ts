/**
 * Which questions are being asked, what has been answered, and what goes to
 * the server: in one walk, in the operator's order, because they decide
 * each other.
 *
 * THE SAME CODE AS THE SERVER. A question carrying `shown_when` is asked only
 * when an earlier answer satisfies it, and visibility cascades. Rather than a
 * second copy of that rule here (the old form had one, and a suite to keep
 * the two in step), the page runs `buildAnswers` from @reportlog/fields, the
 * function the server seals with. What the reporter is shown and what will be
 * sealed cannot disagree, because they are one computation.
 *
 * The server still decides: this only decides what somebody is shown.
 */
import type { FormQuestion } from '@reportlog/contracts';
import {
  FILE_TYPE,
  buildAnswers,
  cardsOf,
  conditionMet,
  describeAnswer,
  isAsked,
  normalizeAnswer,
  placeLabel,
} from '@reportlog/fields';
import type { Answers, FieldDefinition, FieldSettings } from '@reportlog/fields';

/** What a control holds, before the server normalizes it. */
export type RawValue = string | string[];
export type RawAnswers = Record<string, RawValue | undefined>;

export function definitionsOf(questions: readonly FormQuestion[]): FieldDefinition[] {
  return questions.map((q) => ({
    key: q.key,
    kind: q.kind,
    label: q.label,
    ...(q.help ? { help: q.help } : {}),
    required: q.required,
    ...(q.shown_when ? { shown_when: q.shown_when } : {}),
    settings: q.settings,
  }));
}

/**
 * What the page sends. Only the questions being asked contribute: a control
 * still holding something typed before an earlier answer changed sends
 * nothing, so the review, the payload and the record all say the same.
 *
 * A date-and-time box reads in the reporter's own clock; it is sent as UTC so
 * the answer means the same thing read anywhere.
 */
export function toSubmission(
  questions: readonly FormQuestion[],
  raw: RawAnswers,
): Record<string, unknown> {
  const asked = new Set(askedQuestions(questions, raw).map((q) => q.key));
  const all = toRawSubmission(questions, raw);
  return Object.fromEntries(Object.entries(all).filter(([key]) => asked.has(key)));
}

/** The answers as they would be sealed, from what the controls hold now. */
export function sealedAnswers(questions: readonly FormQuestion[], raw: RawAnswers): Answers {
  // Required-ness is not this function's business: it is asked "what would
  // be sealed", and an unanswered required question simply has no key yet.
  const defs = definitionsOf(questions).map((d) => ({ ...d, required: false }));
  return buildAnswers(defs, toRawSubmission(questions, raw)).answers ?? {};
}

// The same conversion as toSubmission, without the asked-filter, which needs
// the answers this produces (buildAnswers applies the conditions itself).
function toRawSubmission(questions: readonly FormQuestion[], raw: RawAnswers) {
  const out: Record<string, unknown> = {};
  for (const q of questions) {
    const v = raw[q.key];
    if (v === undefined) continue;
    out[q.key] =
      q.kind === 'datetime' && typeof v === 'string' && v && !Number.isNaN(new Date(v).getTime())
        ? new Date(v).toISOString()
        : v;
  }
  return out;
}

/**
 * The questions being asked right now, in order. The upload question has no
 * card of its own (the files workstream owns that step), so it is never one.
 */
export function askedQuestions(
  questions: readonly FormQuestion[],
  raw: RawAnswers,
): FormQuestion[] {
  const answers = sealedAnswers(questions, raw);
  // `isAsked` is the server's rule: its own "only if", and for a question
  // whose options depend on an earlier answer, whether any list applies.
  return questions.filter((q) => q.kind !== FILE_TYPE && isAsked(asDefinition(q), answers));
}

const asDefinition = (q: FormQuestion): FieldDefinition => ({
  key: q.key,
  kind: q.kind,
  label: q.label,
  ...(q.shown_when ? { shown_when: q.shown_when } : {}),
  settings: q.settings,
});

/**
 * The cards, in order, each the questions it asks right now (cards.ts in
 * @reportlog/fields). A card is named by its FIRST question's key, asked or
 * not, so a card keeps its place in the browser's history while a part of it
 * comes and goes. A card none of whose questions is asked is not shown.
 */
export function askedCards(
  questions: readonly FormQuestion[],
  raw: RawAnswers,
): { id: string; parts: FormQuestion[] }[] {
  const asked = new Set(askedQuestions(questions, raw).map((q) => q.key));
  return cardsOf(questions.filter((q) => q.kind !== FILE_TYPE))
    .map((card) => ({ id: card[0]?.key ?? '', parts: card.filter((q) => asked.has(q.key)) }))
    .filter((c) => c.parts.length > 0);
}

/** Every card there could be, by id, asked or not. */
export function everyCardId(questions: readonly FormQuestion[]): string[] {
  return cardsOf(questions.filter((q) => q.kind !== FILE_TYPE)).map((c) => c[0]?.key ?? '');
}

/**
 * Could this question still be asked, given the answers so far? For the
 * progress bar only: a question nobody has ruled out still counts towards
 * what is left, so on the way forward the bar never lurches backwards.
 *
 * Ruled out CASCADES, as being asked does: a question that hangs off a
 * question nobody will be asked is no longer possible either. Without that,
 * a form whose follow-ups hang off follow-ups ends with the bar short of the
 * end, still counting cards that can never come.
 */
export function stillPossible(
  q: FormQuestion,
  questions: readonly FormQuestion[],
  raw: RawAnswers,
  answers: Answers = sealedAnswers(questions, raw),
): boolean {
  if (q.kind === FILE_TYPE) return false;
  if (!q.shown_when) return true;
  // An answer is only ever in `answers` while its own question is asked.
  if (answers[q.shown_when.field] !== undefined) return conditionMet(q.shown_when, answers);
  // Conditions point at EARLIER questions only (normalizeCondition), so
  // this ends.
  const decider = questions.find((d) => d.key === q.shown_when?.field);
  return decider ? stillPossible(decider, questions, raw, answers) : false;
}

const isEmpty = (v: RawValue | undefined) =>
  v === undefined || (typeof v === 'string' ? v.trim() === '' : v.length === 0);

/**
 * What stops somebody leaving this card, in a sentence, or null. Required
 * means required OF THE PEOPLE ASKED: a hidden question is never checked.
 */
export function cardProblem(
  q: FormQuestion,
  raw: RawAnswers,
  /** The whole form, so an answer that depends on an earlier one (a county in its state, a list chosen by method) is checked against it. */
  questions?: readonly FormQuestion[],
): string | null {
  const v = raw[q.key];
  if (isEmpty(v)) return q.required ? 'An answer is needed here.' : null;
  const answers = questions ? sealedAnswers(questions, raw) : undefined;
  if (
    normalizeAnswer(
      q.kind,
      toRawSubmission([q], raw)[q.key],
      q.settings,
      answers ? { answers } : undefined,
    ) === null
  ) {
    return 'That is not an answer this question takes. Check it, or clear it.';
  }
  return null;
}

/** An answer in the words the reporter read: the review card's rows. */
export function shownAnswer(
  q: FormQuestion,
  raw: RawAnswers,
  questions?: readonly FormQuestion[],
): string | null {
  const v = raw[q.key];
  if (isEmpty(v) || v === undefined) return null;
  // A CHOICE BY ITS LABEL, never its code; from the list this reporter was
  // offered when the question has several.
  if (q.kind === 'choice_one' || q.kind === 'choice_many') {
    const answers = questions ? sealedAnswers(questions, raw) : undefined;
    return describeAnswer(asDefinition(q), v, answers);
  }
  if (Array.isArray(v)) return v.join(', ');
  if (q.kind === 'yes_no') return v === 'yes' ? 'Yes' : 'No';
  if (q.kind === 'number' && (q.settings as FieldSettings).picker === 'hour') {
    return describeAnswer(asDefinition(q), Number(v));
  }
  // A state or county written by code alone (AZ, 04013) names itself.
  if (q.kind === 'location' && typeof q.settings.code === 'string') {
    return describeAnswer(asDefinition(q), v);
  }
  if (q.kind === 'evidence_declaration')
    return v === 'yes' ? 'Yes, I have something' : 'No, I do not';
  if (q.kind === 'location') {
    // THE NAME, NOT THE CODE: a code is not something a reporter can check.
    const all = [...(q.places?.subdivisions ?? []), ...(q.places?.countries ?? [])];
    // A county is not in that list; the gazetteer names it with its state.
    return all.find((p) => p.code === v)?.name ?? placeLabel(v);
  }
  if (q.kind === 'datetime') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
  }
  return v;
}

/**
 * Sealed answers back into what the controls hold, so a correction starts
 * from what the report says now. A date-and-time goes back into the
 * reporter's own clock, the way the box shows it.
 */
export function rawFromAnswers(
  questions: readonly FormQuestion[],
  answers: Record<string, unknown>,
): RawAnswers {
  const out: RawAnswers = {};
  for (const q of questions) {
    const v = answers[q.key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'boolean') out[q.key] = v ? 'yes' : 'no';
    else if (Array.isArray(v)) out[q.key] = v.map(String);
    else if (q.kind === 'datetime' && typeof v === 'string') out[q.key] = localDateTime(v);
    else if (typeof v === 'string' || typeof v === 'number') out[q.key] = String(v);
  }
  return out;
}

function localDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The controls after one answer changes. Undefined clears it (an unticked
 * box). CHANGING A STATE CLEARS ITS COUNTY: a county is only ever an answer
 * inside the state chosen beside it (`within`), so one left over from another
 * state would be an answer nobody gave.
 */
export function withChange(
  questions: readonly FormQuestion[],
  raw: RawAnswers,
  key: string,
  value: RawValue | undefined,
): RawAnswers {
  const cleared = new Set(
    raw[key] !== value ? questions.filter((q) => q.settings.within === key).map((q) => q.key) : [],
  );
  if (value === undefined) cleared.add(key);
  return Object.fromEntries([
    ...Object.entries(raw).filter(([k]) => !cleared.has(k) && k !== key),
    ...(value === undefined ? [] : [[key, value] as const]),
  ]);
}
