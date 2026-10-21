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
 * How a `location` answer is written. ABSENT is the hierarchical code
 * (`US-AZ`, `US-AZ-04013`), which is what every form before this setting
 * sealed. `postal` seals a US state's two-letter code alone (`AZ`); `fips`
 * seals a county's five-digit federal code alone (`04013`), inside the state
 * an earlier `postal` question names (`within`). See gazetteer.ts.
 */
export type LocationCode = 'postal' | 'fips';

/** An offered answer that seals a code and shows a label (optionShape.ts). */
export interface CodedOption {
  code: string;
  label: string;
}

/** A plain string is its own code and label, exactly as before codes existed. */
export type Option = string | CodedOption;

/** The options a question offers while an earlier answer holds (options.ts). */
export interface OptionSet {
  when: Condition;
  options: Option[];
}

/** Help that applies while an earlier answer holds (options.ts). */
export interface HelpWhen {
  when: Condition;
  help: string;
}

/**
 * A question's settings. Loose on purpose: settings are stored as JSON and
 * read back as JSON, and each normalizer reads only the keys it knows.
 */
export interface FieldSettings {
  maxLength?: number;
  options?: Option[];
  /** In place of `options`: which list is offered depends on an earlier answer. */
  option_sets?: OptionSet[];
  /** Help in place of `help` while an earlier answer holds. The first that holds wins. */
  help_when?: HelpWhen[];
  /** The card's own question, on the first of several questions sharing a card (cards.ts). */
  card_question?: string;
  /** Shown on the same card as the question before it (cards.ts). */
  same_card?: boolean;
  allowOther?: boolean;
  min?: number | null;
  max?: number | null;
  /** A number question that takes whole numbers only. */
  integer?: boolean;
  /** How a number is picked: `hour` is a list of the 24 hours. Shown only. */
  picker?: 'hour';
  /** A yes/no that is one tick box: ticked seals true, unticked seals nothing. */
  checkbox?: boolean;
  scope?: LocationScope;
  /** Written only as `county`; absent means state (gazetteer.ts). */
  depth?: LocationDepth;
  code?: LocationCode;
  /** On a `fips` county: the key of the `postal` state question it sits in. */
  within?: string;
  /**
   * On a list's repeated link question: each link is a row with a link and
   * one of these kinds of link, both or neither (apps/api/src/lists/policy.ts).
   */
  link_types?: CodedOption[];
  /** Every row of a repeated question shown from the start; none added or removed. */
  fixed_rows?: boolean;
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
