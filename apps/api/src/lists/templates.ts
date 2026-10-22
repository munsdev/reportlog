/**
 * The shipped starting points for a list: the Tip List, check-ins, a contact
 * form, election tips (owner decision 45), and the link tip list (the
 * owner's questionnaires of 21 October 2026, §04): three rows of a link and
 * what kind of link it is, nothing else asked, strict, no email. The Tip List stays general;
 * election tips is the election-specific one beside it, as
 * logbooks/templates/elections.json is for logbooks: it asks where (state,
 * then county), what day, and which of the elections logbook's kinds of
 * thing, so the journalist desk can show those beside a link. Counting is
 * off, as on every template (decision 42).
 *
 * A TEMPLATE IS NOT A MODE. Applying one writes the ordinary rows an
 * administrator could have typed by hand, and then it is over. NOTHING READS
 * "WHICH TEMPLATE IS THIS" TO DECIDE ANYTHING: there is no column recording it
 * and no branch asking. Link handling happens because a list HAS a url
 * question, not because it is "a tip list". Delete this file and the
 * JSON files, and no list already made behaves differently.
 *
 * THE `email` DECLARATION IS CHECKED AND THEN DISCARDED. Whether a form asks
 * for an address is derived from its questions, so a template states what it
 * believes, this refuses one whose belief is wrong, and nothing is stored. A
 * template collecting free text while declaring "email": "none" would quietly
 * collect unerasable words; it fails to load instead.
 *
 * Pure: imported JSON, no database. Applying one is in manage.ts.
 */
import type { FieldSettings } from '@reportlog/fields';
import { FieldRuleError, assertCollectable, collectionRequirements } from './fields.ts';
import type { ListField } from './fields.ts';
import { isRetention } from './retention.ts';
import type { Retention } from './retention.ts';
import checkIns from './templates/check-ins.json' with { type: 'json' };
import contact from './templates/contact.json' with { type: 'json' };
import electionTips from './templates/election-tips.json' with { type: 'json' };
import linkTips from './templates/link-tips.json' with { type: 'json' };
import tips from './templates/tips.json' with { type: 'json' };

export const LIST_FILE_VERSION = 1;

/** What a template may declare about addresses. Checked against the questions. */
export const EMAIL_DECLARATIONS = ['none', 'optional', 'required'] as const;

export interface ListTemplate {
  slug: string;
  title: string;
  blurb: string | null;
  /** "ask_email": "always" asks everybody; anything else leaves it to the questions. */
  email_mode: 'auto' | 'required';
  /** Refuse a key the form does not ask, rather than drop it (ruling 49). */
  strict: boolean;
  requiresEmail: boolean;
  fields: (ListField & { retention: Retention })[];
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function fieldFrom(raw: unknown, name: string, i: number): ListField {
  if (!isObject(raw))
    throw new FieldRuleError(`${name}: question ${String(i + 1)} is not a question.`);
  const settings = isObject(raw.settings) ? (raw.settings as FieldSettings) : undefined;
  const retention = raw.retention;
  if (retention !== undefined && !isRetention(retention)) {
    throw new FieldRuleError(`${name}: ${String(raw.key)} has an unknown lifetime.`);
  }
  return {
    key: str(raw.key) ?? '',
    kind: str(raw.kind) ?? '',
    label: str(raw.label) ?? '',
    ...(str(raw.help) ? { help: str(raw.help) } : {}),
    required: raw.required === true,
    ...(settings ? { settings } : {}),
    max_values: typeof raw.max_values === 'number' ? raw.max_values : 1,
    aggregatable: raw.aggregatable === true,
    ...(retention !== undefined ? { retention } : {}),
  };
}

export function parseListTemplate(def: unknown, name = 'a template'): ListTemplate {
  if (!isObject(def) || def.reportlog_list !== LIST_FILE_VERSION) {
    throw new FieldRuleError(
      `${name} is not a list template: it needs "reportlog_list": ${String(LIST_FILE_VERSION)}.`,
    );
  }
  const slug = str(def.slug);
  if (!slug || !SLUG.test(slug)) throw new FieldRuleError(`${name} has no usable slug.`);
  const title = str(def.title)?.trim();
  if (!title) throw new FieldRuleError(`${name} has no title.`);
  if (!Array.isArray(def.fields) || !def.fields.length) {
    throw new FieldRuleError(
      `${name} asks nothing, and a list that asks nothing collects nothing.`,
    );
  }
  if (def.strict !== undefined && typeof def.strict !== 'boolean') {
    throw new FieldRuleError(`${name} says "strict" with something other than true or false.`);
  }
  const email = def.email;
  if (email !== undefined && !EMAIL_DECLARATIONS.includes(email as 'none')) {
    throw new FieldRuleError(`${name} declares an unknown email mode: ${JSON.stringify(email)}.`);
  }

  const fields = def.fields.map((f, i) => fieldFrom(f, name, i));
  const derived = collectionRequirements(fields);
  // Refuses a form that cannot be collected honestly.
  const checked = assertCollectable(fields, { hasRequiredEmail: derived.requiresEmail });

  // THE DECLARATION AGAINST WHAT THE QUESTIONS ACTUALLY MEAN.
  if (email !== undefined && (email === 'required') !== derived.requiresEmail) {
    throw new FieldRuleError(
      `${name} declares "email": ${JSON.stringify(email)} but its questions ` +
        (derived.requiresEmail
          ? `DO require an address: ${derived.personalKeys.join(', ')} ${derived.personalKeys.length > 1 ? 'are' : 'is'} personal.`
          : 'do NOT require an address: nothing it collects is personal.'),
    );
  }

  return {
    slug,
    title,
    blurb: str(def.blurb) ?? null,
    email_mode: def.ask_email === 'always' ? 'required' : 'auto',
    strict: def.strict === true,
    requiresEmail: derived.requiresEmail,
    fields: checked.fields,
  };
}

const FILES = {
  tips,
  'election-tips': electionTips,
  'link-tips': linkTips,
  'check-ins': checkIns,
  contact,
} as const;

/** Every shipped template, in the order the "make a list" screen offers them. */
export function shippedTemplates(): ListTemplate[] {
  return Object.entries(FILES).map(([file, def]) => parseListTemplate(def, `${file}.json`));
}

export function shippedTemplate(slug: string): ListTemplate | null {
  return shippedTemplates().find((t) => t.slug === slug) ?? null;
}
