/**
 * What one offered answer IS.
 *
 * TWO SHAPES, and the older one stays exactly as it was. A plain string is
 * its own code and its own label: what is sealed is what was shown. A
 * `{ code, label }` pair seals the CODE and shows the LABEL, so the words can
 * be reworded after launch without touching a sealed answer (the owner's
 * ruling 48), while the code can never change.
 *
 * THE ABSENT-KEY RULE, ONCE MORE. A form whose options are plain strings
 * writes plain strings into its settings, so its form definition, and the
 * `logbook_form` seal of every report filed against it, is byte for byte what
 * it was. Nothing here rewrites a string option into a pair.
 *
 * Pure and dependency-free, so conditions.ts can read codes without reaching
 * the option-set logic that itself evaluates conditions (options.ts).
 */
import type { CodedOption, Option, OptionSet } from './types.ts';

/** A code: lowercase letters, digits and underscores, like a question's key. */
export const OPTION_CODE = /^[a-z0-9][a-z0-9_]{0,62}$/;

export function isCodedOption(o: unknown): o is CodedOption {
  return (
    typeof o === 'object' &&
    o !== null &&
    !Array.isArray(o) &&
    typeof (o as CodedOption).code === 'string' &&
    typeof (o as CodedOption).label === 'string'
  );
}

/** What is sealed. A plain string is its own code. */
export function optionCode(o: Option): string {
  return typeof o === 'string' ? o : o.code;
}

/** What a person reads. A plain string is its own label. */
export function optionLabel(o: Option): string {
  return typeof o === 'string' ? o : o.label;
}

/** A list of options as stored, keeping only the two shapes this reads. */
export function optionArray(raw: unknown): Option[] {
  return Array.isArray(raw)
    ? raw.filter((o): o is Option => typeof o === 'string' || isCodedOption(o))
    : [];
}

/** The sets a question's options depend on, as stored. */
export function optionSetsOf(settings: { option_sets?: unknown } | null | undefined): OptionSet[] {
  const raw = settings?.option_sets;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is OptionSet =>
      typeof s === 'object' &&
      s !== null &&
      typeof (s as OptionSet).when === 'object' &&
      (s as OptionSet).when !== null &&
      Array.isArray((s as OptionSet).options),
  );
}

/**
 * Every code a question could ever seal, in the order first offered: its
 * plain list, or every set's, without repeats. A code shared by two sets
 * (`other`) is ONE code, which is what makes it countable across them.
 */
export function allOptionCodes(
  settings: { options?: unknown; option_sets?: unknown } | null | undefined,
): string[] {
  const sets = optionSetsOf(settings);
  const lists = sets.length ? sets.map((s) => s.options) : [settings?.options];
  const out: string[] = [];
  for (const list of lists) {
    for (const o of optionArray(list)) {
      const code = optionCode(o);
      if (!out.includes(code)) out.push(code);
    }
  }
  return out;
}
