/**
 * A LIST AS A FILE.
 *
 * The same document a starting point ships as (`templates/*.json`, read by
 * `parseListTemplate`): an administrator downloads one from a list and
 * uploads it to make another. One reader for shipped and uploaded files, so
 * an upload is refused for exactly what a shipped template would be.
 *
 * UPLOADING ALWAYS MAKES A HIDDEN LIST, like applying a template, and never
 * touches a list that exists. The file carries the form and nothing anybody
 * sent through it.
 *
 * THE `email` DECLARATION IS WRITTEN FROM THE QUESTIONS, never stored. A
 * downloaded file therefore always passes the reader's check that the
 * declaration matches what the questions mean.
 */
import { FieldRuleError, collectionRequirements } from './fields.ts';
import { createFromParsed } from './manage.ts';
import type { ListOverrides } from './manage.ts';
import { refuse } from './refusals.ts';
import type { Db, LoadedList } from './rows.ts';
import { LIST_FILE_VERSION, parseListTemplate } from './templates.ts';

/** Every key is written only when it applies, so a plain list's file stays short. */
export function toListFile(list: LoadedList) {
  const { requiresEmail } = collectionRequirements(list.fields);
  return {
    reportlog_list: LIST_FILE_VERSION,
    slug: list.slug,
    title: list.title,
    ...(list.blurb ? { blurb: list.blurb } : {}),
    email: requiresEmail ? ('required' as const) : ('none' as const),
    ...(list.email_mode === 'required' ? { ask_email: 'always' as const } : {}),
    ...(list.strict ? { strict: true } : {}),
    // Absent unless on, like every other key here: a file from before the
    // switch existed reads the same as one with it off.
    ...(list.write_back ? { write_back: true } : {}),
    fields: list.fields.map((f) => ({
      key: f.key,
      kind: f.kind,
      label: f.label,
      ...(f.help ? { help: f.help } : {}),
      required: f.required,
      max_values: f.max_values,
      aggregatable: f.aggregatable,
      retention: f.retention,
      ...(Object.keys(f.settings).length ? { settings: f.settings } : {}),
    })),
  };
}

/** Make a hidden list from an uploaded file, or refuse it in a sentence. */
export async function createFromFile(
  db: Db,
  raw: unknown,
  overrides: ListOverrides = {},
): Promise<LoadedList> {
  let template;
  try {
    template = parseListTemplate(raw, 'That file');
  } catch (e) {
    if (e instanceof FieldRuleError) return refuse('bad-file', e.message);
    throw e;
  }
  return createFromParsed(db, template, overrides);
}
