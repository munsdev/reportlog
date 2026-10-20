/** Every kind of question a form can ask. A list of TYPES, never of questions. */
export type FieldKind =
  | 'short_text'
  | 'long_text'
  | 'date'
  | 'time'
  | 'datetime'
  | 'place'
  | 'location'
  | 'choice_one'
  | 'choice_many'
  | 'yes_no'
  | 'evidence_declaration'
  | 'number'
  | 'email'
  | 'url'
  | 'file';

export type LocationScope = 'us' | 'world' | 'both';
export type LocationDepth = 'state' | 'county';

/**
 * A question's settings. Loose on purpose: settings are stored as JSON and
 * read back as JSON, and each normalizer reads only the keys it knows.
 */
export interface FieldSettings {
  maxLength?: number;
  options?: string[];
  allowOther?: boolean;
  min?: number | null;
  max?: number | null;
  scope?: LocationScope;
  /** Written only as `county`; absent means state (gazetteer.ts). */
  depth?: LocationDepth;
  [key: string]: unknown;
}

/** When a question is asked at all. See conditions.ts. */
export interface Condition {
  field: string;
  in: string[];
}

/**
 * One question, as the form definition and the answer builder read it.
 *
 * `help` and `shown_when` are optional rather than nullable, and that is
 * the absent-key rule showing up in the type: a question without help has
 * no `help` key, which is not the same thing as `help: null`.
 */
export interface FieldDefinition {
  key: string;
  kind: FieldKind | (string & {});
  label: string;
  help?: string | null | undefined;
  required?: boolean | number | null | undefined;
  shown_when?: Condition | null | undefined;
  settings?: FieldSettings | null | undefined;
}

/** The one shape each type normalizes to. */
export type AnswerValue = string | number | boolean | string[];

/** A sealed answer map. An unanswered question has no key. */
export type Answers = Record<string, AnswerValue>;
