/**
 * Cards: which questions are asked together.
 *
 * ONE CARD ASKS ONE QUESTION. Some questions have parts: "Which state and
 * county?" is one question with two dropdowns, and "When was it?" is a date,
 * an hour and a tick box. Each part is still its OWN question, with its own
 * key, kind, "only if" and required, and a part marks itself `same_card` to
 * be shown on the card of the question before it. The first part carries the
 * card's question (`card_question`); each part's own label names its control
 * and its answer ("State", "County").
 *
 * WHY A CARD OF QUESTIONS AND NOT A COMPOUND KIND. Everything downstream of a
 * form works one key at a time: the seal (an absent key is an unanswered
 * part), conditions, option sets, maps and alerts (the state is a location
 * question like any other), board filters, counts, exports, the desk. A kind
 * whose one answer was several keys would teach every one of those a second
 * shape. A card is only presentation, sealed with the form definition
 * because it is part of how a question was put (settings are sealed).
 *
 * NOTHING ON A CARD CHANGES UNDERNEATH ANYBODY, so what decides a part (its
 * `shown_when`, its option sets, its help) must be answered BEFORE the card:
 * a part may never depend on another part of its own card. The one thing that
 * moves on a card is a county list following the state chosen beside it,
 * which is what the person did, not something done to them; a county is
 * checked against its state on the server all the same (gazetteer.ts).
 */
import { settingConditions } from './options.ts';
import type { FieldDefinition } from './types.ts';

export function isSameCard(f: Pick<FieldDefinition, 'settings'>): boolean {
  return f.settings?.same_card === true;
}

/** The questions in order, gathered into cards. A card is never empty. */
export function cardsOf<T extends Pick<FieldDefinition, 'settings'>>(fields: readonly T[]): T[][] {
  const out: T[][] = [];
  for (const f of fields) {
    const last = out.at(-1);
    if (isSameCard(f) && last) last.push(f);
    else out.push([f]);
  }
  return out;
}

/** What a card asks: its first question's `card_question`, or that question's label. */
export function cardHeading(card: readonly Pick<FieldDefinition, 'label' | 'settings'>[]): string {
  const first = card[0];
  if (!first) return '';
  const q = first.settings?.card_question;
  return typeof q === 'string' && q.trim() ? q : first.label;
}

export type CardRefusal =
  'same-card-first' | 'same-card-kind' | 'card-question-follower' | 'same-card-depends';

/**
 * What is wrong with how a form's questions share cards, or null. Run over
 * the whole list after any change, as conditions are.
 */
export function cardProblem(
  fields: readonly FieldDefinition[],
): { reason: CardRefusal; key: string } | null {
  let card: FieldDefinition[] = [];
  for (const [i, f] of fields.entries()) {
    if (isSameCard(f)) {
      if (i === 0) return { reason: 'same-card-first', key: f.key };
      if (f.kind === 'file' || card.some((c) => c.kind === 'file'))
        return { reason: 'same-card-kind', key: f.key };
      if (typeof f.settings?.card_question === 'string')
        return { reason: 'card-question-follower', key: f.key };
      card.push(f);
    } else {
      card = [f];
    }
    // A part may hang only on what was answered before its card.
    const deciders = [
      ...(f.shown_when ? [f.shown_when] : []),
      ...settingConditions(f.settings),
    ].map((c) => c.field);
    if (card.length > 1 && deciders.some((k) => card.some((c) => c.key === k))) {
      return { reason: 'same-card-depends', key: f.key };
    }
  }
  return null;
}
