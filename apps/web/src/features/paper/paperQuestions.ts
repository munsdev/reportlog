/**
 * A form's questions, put into the one shape the paper copy draws.
 *
 * A logbook and a list describe their questions differently (a logbook's
 * settings, a list's flattened options and depth), so each has an adapter
 * here and the page draws only `PaperSection`s. Nothing here is sent
 * anywhere: the paper copy is a picture of the form, and what is typed in
 * from it goes through the ordinary filing or intake path, which checks it.
 */
import type { FormQuestion, ListFormQuestion } from '@reportlog/contracts';
import {
  YES,
  cardHeading,
  cardsOf,
  offeredOptions,
  optionCode,
  optionLabel,
} from '@reportlog/fields';

export interface PaperOption {
  code: string;
  label: string;
}

export interface PaperQuestion {
  key: string;
  /** Its number on the paper, counted across the whole form. */
  n: number;
  kind: string;
  label: string;
  help?: string;
  required: boolean;
  options: PaperOption[];
  allowOther: boolean;
  /** A yes/no drawn as one tick box. */
  checkbox: boolean;
  /** A location: what to write. Lines on paper, never a list of every state. */
  place?: 'state' | 'county' | 'country' | 'either' | 'any';
  min?: number;
  max?: number;
  /** How many lines a several-links question gets. */
  rows: number;
  /** "Answer only if …", in words, already resolved to question numbers. */
  onlyIf?: string;
}

export interface PaperSection {
  /** A heading only where several questions share one card. */
  heading?: string;
  questions: PaperQuestion[];
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** The words for an "only if", naming the earlier question by its number. */
function onlyIfWords(
  when: { field: string; in: string[] } | undefined,
  earlier: ReadonlyMap<string, PaperQuestion>,
): string | undefined {
  if (!when) return undefined;
  const target = earlier.get(when.field);
  if (!target) return 'Answer only if it applies.';
  if (target.kind === 'yes_no' || target.kind === 'evidence_declaration') {
    const yes = when.in.includes(YES);
    return `Answer only if you answered ${yes ? 'yes' : 'no'} to question ${String(target.n)}.`;
  }
  const words = when.in
    .map((code) => target.options.find((o) => o.code === code)?.label ?? code)
    .map((w) => `“${w}”`)
    .join(' or ');
  return `Answer only if you chose ${words} in question ${String(target.n)}.`;
}

function logbookPlace(settings: Record<string, unknown>): NonNullable<PaperQuestion['place']> {
  if (settings.depth === 'county') return 'county';
  if (settings.scope === 'world') return 'country';
  if (settings.scope === 'both') return 'either';
  return 'state';
}

/** A logbook's questions, in its order, in the cards the online form shows. */
export function logbookSections(fields: readonly FormQuestion[]): PaperSection[] {
  const seen = new Map<string, PaperQuestion>();
  let n = 0;
  return cardsOf(fields).map((card) => {
    const questions = card.map((f) => {
      const s = f.settings;
      const offered = offeredOptions(s) ?? [];
      const min = num(s.min);
      const max = num(s.max);
      const q: PaperQuestion = {
        key: f.key,
        n: ++n,
        kind: f.kind,
        label: f.label,
        ...(f.help ? { help: f.help } : {}),
        required: f.required,
        options: offered.map((o) => ({ code: optionCode(o), label: optionLabel(o) })),
        allowOther: s.allowOther === true,
        checkbox: f.kind === 'yes_no' && s.checkbox === true,
        // A place with a list of names (every state, say) is written in, not ticked.
        ...(f.kind === 'location' ? { place: logbookPlace(s) } : {}),
        ...(f.kind === 'place' ? { place: 'any' as const } : {}),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        // Erasable links take up to three (fieldTypes.ts).
        rows: f.kind === 'private_link' ? 3 : 1,
      };
      const onlyIf = onlyIfWords(f.shown_when, seen);
      if (onlyIf) q.onlyIf = onlyIf;
      seen.set(f.key, q);
      return q;
    });
    const heading = card.length > 1 ? cardHeading(card) : undefined;
    return heading ? { heading, questions } : { questions };
  });
}

/** A list's questions: one to a section, as its form shows them. */
export function listSections(fields: readonly ListFormQuestion[]): PaperSection[] {
  return fields.map((f, i) => {
    const q: PaperQuestion = {
      key: f.key,
      n: i + 1,
      kind: f.kind,
      label: f.label,
      ...(f.help ? { help: f.help } : {}),
      required: f.required,
      options: f.options.map((code, j) => ({ code, label: f.option_labels?.[j] ?? code })),
      allowOther: f.allow_other,
      checkbox: false,
      ...(f.kind === 'location' ? { place: f.depth === 'county' ? 'county' : 'state' } : {}),
      ...(f.kind === 'place' ? { place: 'any' as const } : {}),
      // A question taking several links gets a line for each, up to five.
      rows: Math.min(Math.max(f.max_values, 1), 5),
    };
    return { questions: [q] };
  });
}
