/**
 * What a question offers, and says, given the answers before it.
 *
 * OPTION SETS. A question may offer one of several lists depending on an
 * earlier answer: "what went wrong" offers one list to somebody who voted in
 * person and another to somebody who voted by mail, under ONE key, so a code
 * the lists share (`other`, `wrong_ballot`) is one code and counts as one.
 * The first set whose `when` holds is the one offered. When none holds, the
 * question has nothing to offer and IS NOT ASKED, exactly as if its own
 * `shown_when` had failed; that is what lets a set be written per audience
 * without a second condition repeating it.
 *
 * A set may give a shared code a different label ("arrived late", "arrived
 * too late"): the label is what that reporter read, the code is what is
 * sealed and counted.
 *
 * HELP THAT DEPENDS ON AN ANSWER works the same way: the first `help_when`
 * that holds replaces `help`.
 *
 * Every `when` names an EARLIER question (checked at setup, as `shown_when`
 * is), so all of this is decided before the card is shown and nothing on it
 * changes underneath anybody.
 */
import { conditionMet } from './conditions.ts';
import {
  isCodedOption,
  optionArray,
  optionCode,
  optionLabel,
  optionSetsOf,
} from './optionShape.ts';
import type {
  Answers,
  FieldDefinition,
  FieldSettings,
  HelpWhen,
  Option,
  OptionSet,
} from './types.ts';

export * from './optionShape.ts';

type Given = Partial<Answers> | null | undefined;

/**
 * The options offered, given the answers so far, or null when the question
 * has option sets and none applies. Without answers (a caller with no
 * context), a question with sets offers every set's codes: a lenient reading
 * for display, never for refusing.
 */
export function offeredOptions(
  settings: FieldSettings | null | undefined,
  answers?: Given,
): Option[] | null {
  const sets = optionSetsOf(settings);
  if (!sets.length) return optionArray(settings?.options);
  if (answers === undefined) {
    const seen = new Set<string>();
    const all: Option[] = [];
    for (const s of sets) {
      for (const o of optionArray(s.options)) {
        if (seen.has(optionCode(o))) continue;
        seen.add(optionCode(o));
        all.push(o);
      }
    }
    return all;
  }
  const hit = sets.find((s) => conditionMet(s.when, answers));
  return hit ? optionArray(hit.options) : null;
}

/** The codes offered, given the answers so far. [] when none applies. */
export function offeredCodes(
  settings: FieldSettings | null | undefined,
  answers?: Given,
): string[] {
  return (offeredOptions(settings, answers) ?? []).map(optionCode);
}

/**
 * The words for a sealed code. The set the reporter was offered first, then
 * any set (a code keeps meaning what it meant), then the code itself: a code
 * no list names any more is shown as it is rather than hidden.
 */
export function labelForCode(
  settings: FieldSettings | null | undefined,
  code: string,
  answers?: Given,
): string {
  const offered = answers === undefined ? null : offeredOptions(settings, answers);
  const inOffered = offered?.find((o) => optionCode(o) === code);
  if (inOffered) return optionLabel(inOffered);
  const lists = [settings?.options, ...optionSetsOf(settings).map((s) => s.options)];
  for (const list of lists) {
    const o = optionArray(list).find((x) => optionCode(x) === code);
    if (o) return optionLabel(o);
  }
  return code;
}

function helpSets(settings: FieldSettings | null | undefined): HelpWhen[] {
  // Read as unknown: settings arrive as JSON, whatever the type says.
  const raw: unknown = settings?.help_when;
  if (!Array.isArray(raw)) return [];
  return raw.filter((h: unknown): h is HelpWhen => {
    if (typeof h !== 'object' || h === null) return false;
    const r = h as Record<string, unknown>;
    return typeof r.help === 'string' && typeof r.when === 'object' && r.when !== null;
  });
}

/** The help shown, given the answers so far: the first `help_when` that holds, else `help`. */
export function helpFor(
  field: Pick<FieldDefinition, 'help' | 'settings'>,
  answers: Given,
): string | undefined {
  const hit = helpSets(field.settings).find((h) => conditionMet(h.when, answers));
  if (hit) return hit.help;
  return field.help ?? undefined;
}

/**
 * Is this question asked, given the answers so far? Its own `shown_when`,
 * and, for a question with option sets, whether any set applies.
 */
export function isAsked(field: FieldDefinition, answers: Given): boolean {
  if (field.shown_when && !conditionMet(field.shown_when, answers)) return false;
  if (optionSetsOf(field.settings).length && offeredOptions(field.settings, answers ?? {}) === null)
    return false;
  return true;
}

/** Every condition a question's settings evaluate, for the authoring guard. */
export function settingConditions(settings: FieldSettings | null | undefined) {
  return [...optionSetsOf(settings).map((s) => s.when), ...helpSets(settings).map((h) => h.when)];
}

/**
 * A question's settings with every WORD taken out and every CODE left in:
 * what may not change once a logbook is launched (ruling 48). Two settings
 * that differ only here differ only in wording. A plain string option is its
 * own code, so rewording one is changing a code, and stays refused.
 *
 * MUST STAY IN STEP WITH `form_settings_without_wording` in the database
 * (migration 20261021113000_reword_after_launch.sql); a database test feeds
 * both the same settings.
 */
export function withoutWording(
  settings: FieldSettings | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(settings ?? {}) };
  const codes = (list: unknown) =>
    Array.isArray(list) ? list.map((o: unknown) => (isCodedOption(o) ? o.code : o)) : list;
  if ('options' in out) out.options = codes(out.options);
  if (Array.isArray(out.option_sets)) {
    out.option_sets = (out.option_sets as unknown[]).map((s) =>
      typeof s === 'object' && s !== null
        ? { ...(s as Record<string, unknown>), options: codes((s as OptionSet).options) }
        : s,
    );
  }
  if (Array.isArray(out.help_when)) {
    out.help_when = (out.help_when as unknown[]).map((h) => {
      if (typeof h !== 'object' || h === null) return h;
      return Object.fromEntries(
        Object.entries(h as Record<string, unknown>).filter(([k]) => k !== 'help'),
      );
    });
  }
  delete out.card_question;
  return out;
}
