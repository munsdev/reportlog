/**
 * What a list may ask, what counting a question costs, and what collecting
 * one obliges the form to do.
 *
 * TWO FLAGS THAT LOOK LIKE ONE, and keeping them apart is the point of this
 * file:
 *
 *   1. IS THIS QUESTION PERSONAL? Derived from its kind, never an operator's
 *      choice, and an unknown kind counts as personal.
 *   2. MAY ITS ANSWERS BE COUNTED? An operator's deliberate tick, off by
 *      default.
 *
 * They come apart in both directions: an internal triage category is
 * impersonal and still nobody's business; a state chosen from a list is
 * identifying at row level and fine as a count.
 *
 * THE GATE: a form that may collect free text or anything else about a person
 * must ask for an address, so it can erase on request. A form that collects a
 * link and two dropdowns must not: the address would be the only personal
 * thing on it, collected in order to protect itself. DERIVED FROM THE
 * QUESTIONS, never ticked beside them, because a box an operator ticks is a
 * box an operator can forget. It lives here rather than in a route, so every
 * path goes through it.
 *
 * Pure: no database.
 */
import { allOptionCodes } from '@reportlog/fields';
import type { FieldSettings } from '@reportlog/fields';
import { CLASSES, isRetention } from './retention.ts';
import type { Retention } from './retention.ts';

/** A list's question, as a template declares it and `list_fields` holds it. */
export interface ListField {
  key: string;
  kind: string;
  label: string;
  help?: string | null | undefined;
  required?: boolean | undefined;
  settings?: FieldSettings | null | undefined;
  max_values?: number | undefined;
  aggregatable?: boolean | undefined;
  retention?: Retention | undefined;
  /** Switched off without being removed. Not stored today; honoured if passed. */
  enabled?: boolean | undefined;
}

/**
 * Kinds that carry something about a person. Free text is personal WHATEVER
 * it is labelled, because a box a stranger can type into collects whatever
 * they type, often an account of what somebody else did. `place` is here
 * because it is prose and prose names streets.
 */
export const PERSONAL_KINDS: ReadonlySet<string> = new Set([
  'short_text',
  'long_text',
  'email',
  'place',
]);

/**
 * Kinds that carry nothing about a person: a link points at public material,
 * a choice is the operator's vocabulary rather than the submitter's words.
 *
 * `location` IS HERE AND `place` IS NOT. A location answer is one code from a
 * closed list the map outlines produced, so the finest thing it can say is the
 * finest thing a map can draw. What protects a thin area is a map's
 * threshold, not erasure: erasing the code would only make a count fall away
 * months later with nothing saying why.
 */
export const IMPERSONAL_KINDS: ReadonlySet<string> = new Set([
  'choice_one',
  'choice_many',
  'yes_no',
  'number',
  'date',
  'time',
  'datetime',
  'url',
  'location',
]);

/**
 * Not available on a list at all. A file is what a logbook takes; a list is
 * for material already published elsewhere. An evidence declaration is a
 * promise about a report, and there is no report here. Named here rather than
 * left to fall through the normalizer, because falling through is a builder
 * that offers the type and a form that refuses every answer to it.
 */
export const FORBIDDEN_KINDS: ReadonlySet<string> = new Set(['file', 'evidence_declaration']);

/**
 * ONLY A CLOSED VOCABULARY CAN BE COUNTED. A cell of one IS the sentence
 * somebody typed.
 *
 * MUST STAY IN STEP WITH `list_fields_aggregatable_check` in the lists
 * migration; a unit test reads both. This side is stricter: it also requires
 * a real closed option set (`hasClosedVocabulary`), which a CHECK cannot see.
 */
export const AGGREGATABLE_KINDS: ReadonlySet<string> = new Set([
  'choice_one',
  'choice_many',
  'yes_no',
  'number',
  'date',
  'time',
  'datetime',
  'place',
]);

/** Kinds whose answers go to the links module, encrypted, and never into the answers (Plan D §5). */
export const LINK_KINDS: ReadonlySet<string> = new Set(['url']);

/**
 * UNKNOWN KINDS COUNT AS PERSONAL. A question type added next year is one
 * nobody remembered to classify; defaulting it to impersonal would let it
 * escape the gate silently. The failure mode is an unnecessary email, not an
 * unerasable record.
 */
export function isPersonalKind(kind: string): boolean {
  if (FORBIDDEN_KINDS.has(kind)) return true;
  return !IMPERSONAL_KINDS.has(kind);
}

/**
 * The lifetime a question's answer gets when nothing says otherwise. Personal
 * kinds are erased on the timer; impersonal ones are kept, because sweeping a
 * state or a verdict would destroy the count for no gain.
 */
export function defaultRetention(kind: string): Retention {
  return isPersonalKind(kind) ? CLASSES.TRANSIENT : CLASSES.DURABLE;
}

export function retentionOf(field: Pick<ListField, 'kind' | 'retention'>): Retention {
  return field.retention ?? defaultRetention(field.kind);
}

/** A question is collected unless it is switched off or classed absent. */
export function isCollected(field: ListField): boolean {
  return field.enabled !== false && field.retention !== CLASSES.ABSENT;
}

/**
 * The CODES a question offers: what is stored and counted. A plain string
 * option is its own code, so a list made before codes reads as it always did.
 */
export function optionsOf(field: Pick<ListField, 'settings'>): string[] {
  return allOptionCodes(field.settings);
}

/**
 * Whether a closed option set really exists, which is what makes a question
 * countable in practice and not only by kind. `allowOther` disqualifies a
 * place: counting it would publish whatever people typed into the escape hatch.
 */
export function hasClosedVocabulary(field: Pick<ListField, 'kind' | 'settings'>): boolean {
  if (['yes_no', 'number', 'date', 'time', 'datetime'].includes(field.kind)) return true;
  return optionsOf(field).length > 0 && field.settings?.allowOther !== true;
}

export interface Requirements {
  personalKeys: string[];
  forbiddenKeys: string[];
  aggregatableKeys: string[];
  collectsPersonal: boolean;
  /**
   * THE FORM MUST ASK FOR AN ADDRESS, not every submission must carry one.
   * Whether a given submission needs it depends on what arrived, and
   * `fileEntry` decides that from the answers. An address with no erasure
   * route is a contact detail collected for nothing; an erasure route with no
   * address is a promise with no way to keep it. So the two travel together.
   */
  requiresEmail: boolean;
  requiresErasureRoute: boolean;
  keepsPersonalIndefinitely: boolean;
}

/** What a set of questions obliges the form to do. */
export function collectionRequirements(fields: readonly ListField[] = []): Requirements {
  const personal: string[] = [];
  const forbidden: string[] = [];
  const aggregatable: string[] = [];
  let durablePersonal = false;
  for (const f of fields) {
    if (!isCollected(f)) continue;
    if (FORBIDDEN_KINDS.has(f.kind)) {
      forbidden.push(f.key);
      continue;
    }
    if (f.aggregatable) aggregatable.push(f.key);
    if (isPersonalKind(f.kind)) {
      personal.push(f.key);
      if (retentionOf(f) === CLASSES.DURABLE) durablePersonal = true;
    }
  }
  return {
    personalKeys: personal,
    forbiddenKeys: forbidden,
    aggregatableKeys: aggregatable,
    collectsPersonal: personal.length > 0,
    requiresEmail: personal.length > 0,
    requiresErasureRoute: personal.length > 0,
    keepsPersonalIndefinitely: durablePersonal,
  };
}

/** A question an operator must not be able to save, refused in words. */
export class FieldRuleError extends Error {
  override name = 'FieldRuleError';
}

const KEY = /^[a-z0-9][a-z0-9_]{0,62}$/;

/**
 * Refuse one question. Throws rather than returning a verdict, because every
 * caller is a write path and the only correct handling is not to save it.
 * Returns the question with its retention stated.
 */
export function assertFieldDefinition(field: ListField): ListField & { retention: Retention } {
  if (!KEY.test(field.key)) {
    throw new FieldRuleError(
      `A question needs a key of lowercase letters, numbers and underscores, like this_one, not ${JSON.stringify(field.key)}.`,
    );
  }
  // What a count is named by when a tool asks, so a blank one is not cosmetic.
  if (!field.label.trim()) {
    throw new FieldRuleError(
      `The question ${field.key} has no label, and a label is what a count is named by.`,
    );
  }
  if (FORBIDDEN_KINDS.has(field.kind)) {
    throw new FieldRuleError(
      `A list cannot ask for ${field.kind === 'file' ? 'files' : 'an evidence declaration'}: uploads and evidence belong to a logbook.`,
    );
  }
  // KINDS OF LINK, asked beside each link: a code and a label each, on a link
  // question only. Codes because the desk and any count read them, and labels
  // can then be reworded.
  const types: unknown = field.settings?.link_types;
  if (types !== undefined) {
    const codes = Array.isArray(types)
      ? types.map((t: unknown) =>
          typeof t === 'object' &&
          t !== null &&
          typeof (t as { label?: unknown }).label === 'string'
            ? (t as { code?: unknown }).code
            : null,
        )
      : [];
    if (
      field.kind !== 'url' ||
      !codes.length ||
      codes.some((c) => typeof c !== 'string' || !/^[a-z0-9][a-z0-9_]{0,62}$/.test(c)) ||
      new Set(codes).size !== codes.length
    ) {
      throw new FieldRuleError(
        `“${field.label}”: kinds of link go on a link question, each with a code of lowercase letters, numbers and underscores and a label, no code twice.`,
      );
    }
  }
  if (
    field.settings?.fixed_rows !== undefined &&
    !(field.settings.fixed_rows === true && (field.max_values ?? 1) > 1)
  ) {
    throw new FieldRuleError(
      `“${field.label}”: showing every row from the start is for a question that takes more than one answer.`,
    );
  }
  const retention = retentionOf(field);
  if (!isRetention(retention)) {
    throw new FieldRuleError(
      `The question ${field.key} has an unknown lifetime: ${String(retention)}.`,
    );
  }
  if (field.aggregatable) {
    if (retention === CLASSES.ABSENT) {
      throw new FieldRuleError(`“${field.label}” is not collected, so it cannot be counted.`);
    }
    if (!AGGREGATABLE_KINDS.has(field.kind)) {
      throw new FieldRuleError(
        `“${field.label}” cannot be counted: only a closed vocabulary can be, because a count ` +
          'over what people type publishes what somebody wrote one cell at a time.',
      );
    }
    if (!hasClosedVocabulary(field)) {
      throw new FieldRuleError(
        `“${field.label}” has no closed set of options, so counting it would publish whatever ` +
          'people typed into the escape hatch.',
      );
    }
    if (isPersonalKind(field.kind) && retention === CLASSES.TRANSIENT) {
      throw new FieldRuleError(
        `“${field.label}” is counted but erased on a timer, so its count would shrink on its own. ` +
          'Keep its answers, or stop counting it.',
      );
    }
  }
  return { ...field, retention };
}

/** Refuse a whole form that cannot be collected honestly. */
export function assertCollectable(
  fields: readonly ListField[],
  { hasRequiredEmail = false }: { hasRequiredEmail?: boolean } = {},
): Requirements & { fields: (ListField & { retention: Retention })[] } {
  const checked = fields.map(assertFieldDefinition);
  const seen = new Set<string>();
  for (const f of checked) {
    if (seen.has(f.key)) throw new FieldRuleError(`Two questions share the key ${f.key}.`);
    seen.add(f.key);
  }
  const req = collectionRequirements(checked);
  if (req.requiresEmail && !hasRequiredEmail) {
    throw new FieldRuleError(
      `A form collecting ${req.personalKeys.join(', ')} must ask for an email address, because ` +
        'there is no other way to reach the person whose words it holds or to let them take them back.',
    );
  }
  return { ...req, fields: checked };
}
