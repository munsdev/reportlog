/**
 * The form a report was answered against, as text that can be hashed.
 *
 * A launched logbook's questions are frozen, with one opening: a new
 * OPTIONAL question may be added. So a form has versions, and every report
 * seals the hash of the version its reporter was actually asked
 * (`logbook_form`).
 *
 * WHAT IS IN A DEFINITION: the slug and, in the operator's order, each
 * question's key, kind, label, help, required, shown_when and settings —
 * everything that changes what a question MEANS. Not the title, not whether
 * it is a board filter: those are delivery and change no answer.
 *
 * `help` and `shown_when` are written only when there is one. Writing either
 * unconditionally would rehash every form definition in existence and break
 * the `logbook_form` seal of every report filed against them.
 *
 * Never re-serialize a stored definition to hash it: hash the stored string.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { canonicalJson, sha256Hex } from './hash.ts';

export const FORM_DEFINITION_VERSION = 1;

export interface FormQuestion {
  key: string;
  kind: string;
  label: string;
  help?: string;
  required: boolean;
  shown_when?: { field: string; in: string[] };
  settings: Record<string, unknown>;
}

export interface FormDefinition {
  reportlog_form: number;
  logbook: string;
  questions: FormQuestion[];
}

export function formDefinition(slug: string, fields: readonly FieldDefinition[]): FormDefinition {
  return {
    reportlog_form: FORM_DEFINITION_VERSION,
    logbook: slug,
    questions: fields.map((f) => ({
      key: f.key,
      kind: f.kind,
      label: f.label,
      ...(f.help ? { help: f.help } : {}),
      required: Boolean(f.required),
      // ONLY WHEN THERE IS ONE. See above.
      ...(f.shown_when ? { shown_when: f.shown_when } : {}),
      settings: f.settings ?? {},
    })),
  };
}

/** The definition text and its hash. */
export function formText(
  slug: string,
  fields: readonly FieldDefinition[],
): { definition: string; hash: string } {
  const definition = canonicalJson(formDefinition(slug, fields));
  return { definition, hash: sha256Hex(definition) };
}
