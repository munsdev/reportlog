/**
 * The kinds of question a form can ask.
 *
 * THIS IS THE ONLY LIST OF QUESTIONS THE SOFTWARE KNOWS, and it is a list of
 * TYPES, not of questions. There is no built-in "when did it happen" or
 * "where was it": an operator who wants those adds a `date` and a `place`.
 *
 * ADDING A TYPE is additive: a row here, a card in the builder, a control in
 * the form, and a case in `normalizeAnswer`. A sealed answer is unaffected,
 * because the seal holds the ANSWER, not the type's definition.
 */
import type { FieldKind, FieldSettings } from './types.ts';

export interface FieldTypeInfo {
  id: FieldKind;
  label: string;
  description: string;
  settings: FieldSettings;
}

export const FIELD_TYPES: readonly FieldTypeInfo[] = [
  {
    id: 'short_text',
    label: 'Short text',
    description: 'One line. A name, a reference, a job title.',
    settings: { maxLength: 200 },
  },
  {
    id: 'long_text',
    label: 'Long text',
    description: 'Several paragraphs. An account, a description, context.',
    settings: { maxLength: 5000 },
  },
  {
    id: 'date',
    label: 'Date',
    description: 'A calendar day. Add two if a thing has a start and an end.',
    settings: {},
  },
  {
    id: 'time',
    label: 'Time of day',
    description: 'A clock time, with no date attached.',
    settings: {},
  },
  {
    id: 'datetime',
    label: 'Date and time',
    description: 'A moment. Stored with its offset, so it survives being read elsewhere.',
    settings: {},
  },
  {
    id: 'place',
    label: 'Place',
    description: 'Somewhere. Free text, or a list the operator supplies.',
    settings: { options: [], allowOther: true },
  },
  // THE TYPE THE HEAT MAPS READ. `place` seals whatever somebody typed, and
  // no care downstream turns "Phoenix" and "phoenix az" into one count. This
  // seals A CODE FROM A FIXED LIST (`US-AZ`, `DE`), derived from the map's own
  // outlines, so every answer is a place a map can draw. One string, so no new
  // shape in the sealed object. Both types stay: they are different questions.
  {
    id: 'location',
    label: 'Location on a map',
    description:
      'A country, or a US state or territory, chosen from a list. ' +
      'This is the question a heat map counts — pick this one rather than Place ' +
      'if the answers need to add up. Only one per logbook can feed a map.',
    settings: { scope: 'us' },
  },
  {
    id: 'choice_one',
    label: 'Choose one',
    description: 'A list where exactly one answer applies.',
    settings: { options: [] },
  },
  {
    id: 'choice_many',
    label: 'Choose any',
    description: 'A list where more than one answer can apply.',
    settings: { options: [] },
  },
  { id: 'yes_no', label: 'Yes or no', description: 'A plain either-or.', settings: {} },
  // THE EVIDENCE DECLARATION: "I have photos, video, audio or documents of
  // this", with nothing uploaded. Its own type, not a yes/no an operator
  // words, so the request flow can find which question it was. It seals a
  // BOOLEAN, exactly as yes_no does. It is NOT the permission to be asked
  // later: that is revocable and lives outside the seal.
  {
    id: 'evidence_declaration',
    label: 'Evidence they have but are not uploading',
    description:
      'Asks whether they have photos, video, audio or documents ' +
      'of this, without asking for them. A moderator can ask later, if the ' +
      'reporter also gives permission to be asked. Add a short text ' +
      'question after it, shown only when the answer is yes, for what it ' +
      'is of.',
    settings: {},
  },
  {
    id: 'number',
    label: 'Number',
    description: 'A count or a measurement.',
    settings: { min: null, max: null },
  },
  {
    id: 'email',
    label: 'Email address',
    description: 'A second address, beside the one the spine already collects.',
    settings: {},
  },
  {
    id: 'url',
    label: 'Web address',
    description:
      'A link. Sealed as typed, so a page that later disappears still has a record of what was pointed at.',
    settings: {},
  },
  // THE ONE TYPE WHOSE ANSWER IS NOT IN `answers`, deliberately. A report's
  // files are sealed in a top-level `attachments` key computed from what was
  // actually stored. This question only says WHERE THE FORM ASKS. Folding a
  // file answer into `answers` would seal the same fact twice, in two shapes.
  {
    id: 'file',
    label: 'Photos, video or documents',
    description:
      'A place to attach files. Put it where you want to ask for them — ' +
      'a logbook takes files if, and only if, it has one of these. Everything is ' +
      're-encoded, so camera metadata and location do not survive.',
    settings: {},
  },
];

/** The upload type. A form has at most one. */
export const FILE_TYPE = 'file' satisfies FieldKind;

/** Types that never carry a sealed answer of their own. */
export const UNSEALED_TYPES: ReadonlySet<string> = new Set([FILE_TYPE]);

export const FIELD_TYPE_IDS: readonly FieldKind[] = FIELD_TYPES.map((t) => t.id);

export function fieldType(id: string): FieldTypeInfo | null {
  return FIELD_TYPES.find((t) => t.id === id) ?? null;
}

export function isFieldKind(id: string): id is FieldKind {
  return FIELD_TYPE_IDS.includes(id as FieldKind);
}

/** Types whose answers are a list rather than a single value. */
export const MULTI_TYPES: ReadonlySet<string> = new Set(['choice_many']);

/**
 * Types the board knows how to draw a filter for. Not a permission and not a
 * default: `filterable` is the operator's choice, per question. Long text is
 * excluded because a filter over prose is what search already is.
 */
export const FILTERABLE_TYPES: ReadonlySet<string> = new Set([
  'short_text',
  'date',
  'datetime',
  'place',
  'choice_one',
  'choice_many',
  'yes_no',
  'number',
  'location',
  'evidence_declaration',
]);

export const EVIDENCE_DECLARATION_TYPE = 'evidence_declaration' satisfies FieldKind;
export const LOCATION_TYPE = 'location' satisfies FieldKind;

export function canFilter(kind: string): boolean {
  return FILTERABLE_TYPES.has(kind);
}
