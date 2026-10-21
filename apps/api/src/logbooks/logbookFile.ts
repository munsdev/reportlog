/**
 * A LOGBOOK AS A FILE.
 *
 * One plain JSON document describes a logbook: its title and its questions,
 * in order. It is what an administrator downloads, what they upload to make a
 * new one, and what a starting point ships as. One shape for all three, so a
 * starting point is nothing but a logbook file somebody wrote in advance.
 *
 *   {
 *     "reportlog_logbook": 1,
 *     "title": "Election incidents",
 *     "slug": "election-incidents",          optional, made from the title
 *     "blurb": "…",                          optional
 *     "accepts_files": false,                optional, older files
 *     "editorial_notes": true,               optional, present only when on
 *     "ask_email": "always",                 optional: ask for an email even
 *                                            where the questions do not (E1)
 *     "questions": [
 *       { "key": "state", "kind": "place", "label": "Which state?",
 *         "help": "…", "required": true, "filterable": true,
 *         "options": ["Alabama", "…"], "allow_other": false },
 *       { "key": "clip_of", "kind": "short_text", "label": "What is it of?",
 *         "shown_when": { "field": "has_files", "in": ["yes"] } }
 *     ]
 *   }
 *
 * UPLOADING ALWAYS MAKES A DRAFT. Nothing arrives launched, so a file can be
 * as wrong as it likes without anything reaching a reporter. The file carries
 * no reports and no chain: it is the questions, not the record.
 *
 * KEYS THAT BELONG TO OTHER WORKSTREAMS, read and written here so a file
 * round-trips: `max_files` and `max_total_bytes` become the logbook's own
 * upload caps (files), and `editorial_notes` turns on the moderation
 * workstream's per-logbook notes switch. `editorial_notes` is written only
 * when the switch is on, so a file from a logbook without notes is the same
 * file it always was, and `false` is read as "off", which is what no key
 * means anyway.
 */
import { LogbookFile } from '@reportlog/contracts';
import type { LogbookDetail, QuestionSettingsInput } from '@reportlog/contracts';
import {
  FILE_TYPE,
  LIMITED_KINDS,
  isFieldKind,
  optionArray,
  optionSetsOf,
} from '@reportlog/fields';
import type { HelpWhen } from '@reportlog/fields';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import {
  addField,
  createLogbook,
  fieldsFor,
  logbookById,
  logbookDetail,
  slugify,
} from './logbooks.ts';
import { LogbookRefusal, refuse } from './refusals.ts';
import { setLogbookLimits, validateLimits } from '../files/limits.ts';
import { notesEnabled, setNotesEnabled } from '../moderation/notes.ts';

export const LOGBOOK_FILE_VERSION = 1;

const KEY_RE = /^[a-z0-9][a-z0-9_]{0,38}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const NEEDS_OPTIONS: ReadonlySet<string> = new Set(['choice_one', 'choice_many']);
const TEXT_KINDS: ReadonlySet<string> = new Set(['short_text', 'long_text']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Everything wrong with a file, as plain sentences, all at once. Empty when it
 * is fine. Pure, so what a file may contain is testable without a database.
 * The deeper checks (a condition that looks forward, a scope that is not one
 * of three) are the module's, and are said when the file is imported.
 */
export function validateLogbookFile(f: unknown): string[] {
  if (!isRecord(f)) return ['That is not a logbook file.'];
  const errors: string[] = [];
  if (f.reportlog_logbook !== LOGBOOK_FILE_VERSION) {
    errors.push(`This is not a version ${String(LOGBOOK_FILE_VERSION)} logbook file.`);
  }
  const title = typeof f.title === 'string' ? f.title.trim() : '';
  if (!title || title.length > 120) errors.push('The title must be 1 to 120 characters.');
  if (f.slug !== undefined && !(typeof f.slug === 'string' && SLUG_RE.test(f.slug))) {
    errors.push('The web address may use lowercase letters, digits and hyphens only.');
  }
  if (f.editorial_notes !== undefined && typeof f.editorial_notes !== 'boolean') {
    errors.push('"editorial_notes" must be true or false.');
  }
  if (f.ask_email !== undefined && f.ask_email !== 'always') {
    errors.push('"ask_email" is "always", or left out.');
  }
  if (!Array.isArray(f.questions) || !f.questions.length) {
    errors.push('A logbook needs at least one question.');
    return errors;
  }
  const keys = new Set<string>();
  f.questions.forEach((q: unknown, i) => {
    const n = `Question ${String(i + 1)}`;
    if (!isRecord(q)) {
      errors.push(`${n} is not a question.`);
      return;
    }
    const kind = typeof q.kind === 'string' ? q.kind : '';
    if (!isFieldKind(kind)) errors.push(`${n} has an unknown kind "${kind}".`);
    const label = typeof q.label === 'string' ? q.label.trim() : '';
    if (!label || label.length > 160) errors.push(`${n} needs a question of 1 to 160 characters.`);
    if (q.key !== undefined) {
      if (typeof q.key !== 'string' || !KEY_RE.test(q.key)) {
        errors.push(`${n} has a key that is not lowercase letters, digits and underscores.`);
      } else if (keys.has(q.key)) errors.push(`${n} repeats the key "${q.key}".`);
      else keys.add(q.key);
    }
    const hasSets = Array.isArray(q.option_sets) && q.option_sets.length > 0;
    if (NEEDS_OPTIONS.has(kind) && !hasSets && !(Array.isArray(q.options) && q.options.length)) {
      errors.push(`${n} needs a list of choices.`);
    }
    // A choice is plain text, or a code with a label (ruling 48).
    const choiceOk = (o: unknown) =>
      (typeof o === 'string' && o.trim()) ||
      (isRecord(o) && typeof o.code === 'string' && typeof o.label === 'string' && o.label.trim());
    if (q.options !== undefined && !(Array.isArray(q.options) && q.options.every(choiceOk))) {
      errors.push(`${n} has choices that are neither plain text nor a code with a label.`);
    }
    for (const flag of [
      'required',
      'filterable',
      'allow_other',
      'same_card',
      'integer',
      'checkbox',
    ] as const) {
      if (q[flag] !== undefined && typeof q[flag] !== 'boolean') {
        errors.push(`${n} says "${flag}" with something other than true or false.`);
      }
    }
  });
  return errors;
}

/** The settings a file question describes, in the builder's terms. */
function settingsOf(q: LogbookFile['questions'][number]): QuestionSettingsInput {
  return {
    ...(q.options ? { options: q.options.map((o) => (typeof o === 'string' ? o.trim() : o)) } : {}),
    ...(q.option_sets ? { option_sets: q.option_sets } : {}),
    ...(q.help_when ? { help_when: q.help_when } : {}),
    ...(q.card_question !== undefined ? { card_question: q.card_question } : {}),
    ...(q.same_card ? { same_card: true } : {}),
    ...(q.kind === 'location' && q.code !== undefined ? { code: q.code } : {}),
    ...(q.kind === 'location' && q.within !== undefined ? { within: q.within } : {}),
    ...(q.kind === 'number' && q.integer ? { integer: true } : {}),
    ...(q.kind === 'number' && q.picker !== undefined ? { picker: q.picker } : {}),
    ...(q.kind === 'yes_no' && q.checkbox ? { checkbox: true } : {}),
    ...(q.kind === 'place' ? { allowOther: q.allow_other !== false } : {}),
    ...(q.kind === 'location' && q.scope !== undefined ? { scope: q.scope } : {}),
    ...(q.kind === 'location' && q.depth !== undefined ? { depth: q.depth } : {}),
    ...(TEXT_KINDS.has(q.kind) && q.max_length !== undefined ? { maxLength: q.max_length } : {}),
    ...(q.kind === 'number' && q.min !== undefined ? { min: q.min } : {}),
    ...(q.kind === 'number' && q.max !== undefined ? { max: q.max } : {}),
    ...(LIMITED_KINDS.has(q.kind) && q.earliest !== undefined ? { earliest: q.earliest } : {}),
    ...(LIMITED_KINDS.has(q.kind) && q.latest !== undefined ? { latest: q.latest } : {}),
  };
}

/** The first slug from `base`, `base-2`, `base-3`… not already taken. */
async function freeSlug(db: Kysely<DB>, base: string): Promise<string> {
  const root = (base || 'logbook').slice(0, 58).replace(/-+$/, '') || 'logbook';
  for (let i = 1; i < 1000; i += 1) {
    const s = i === 1 ? root : `${root}-${String(i)}`;
    const taken = await db
      .selectFrom('logbooks')
      .select('id')
      .where('slug', '=', s)
      .executeTakeFirst();
    if (!taken) return s;
  }
  throw new Error('freeSlug: no free web address');
}

export interface FileOverrides {
  /** The operator's own title, which wins over the file's when it is not blank. */
  title?: string | undefined;
  /** Exactly this address, refused if taken. Without one, a free one is found. */
  slug?: string | undefined;
  blurb?: string | undefined;
  /**
   * Who is making it, recorded as whoever turned on editorial notes when the
   * file asks for them. Every route passes the signed-in administrator.
   */
  by?: string | undefined;
}

/**
 * Make a DRAFT logbook from a file, all or nothing, in one transaction.
 *
 * A slug the file names that is taken gets a number on the end rather than
 * failing: the slug is sealed into every report, so an upload must never
 * silently join an existing logbook's chain. An address the operator typed
 * themselves is used exactly, or refused.
 */
export async function createFromFile(
  db: Kysely<DB>,
  raw: unknown,
  overrides: FileOverrides = {},
): Promise<LogbookDetail> {
  const errors = validateLogbookFile(raw);
  const parsed = LogbookFile.safeParse(raw);
  if (errors.length || !parsed.success) {
    return refuse(
      'bad-file',
      errors.length ? errors.join(' ') : 'Its questions are not in the shape this software reads.',
    );
  }
  const file = parsed.data;

  // A caller already inside a transaction (a deployment template) keeps it,
  // so the logbook lands with everything else the caller writes, or not at all.
  const inTransaction = <T>(fn: (trx: Kysely<DB>) => Promise<T>): Promise<T> =>
    db.isTransaction ? fn(db) : db.transaction().execute(fn);
  const id = await inTransaction(async (trx) => {
    const ownTitle = overrides.title?.trim();
    const title = ownTitle === undefined || ownTitle === '' ? file.title : ownTitle;
    // An operator who named it gets an address from their name, not the file's.
    const slug = overrides.slug?.trim()
      ? overrides.slug.trim()
      : await freeSlug(trx, ownTitle ? slugify(ownTitle) : (file.slug ?? slugify(title)));
    const made = await createLogbook(trx, { title, slug, blurb: overrides.blurb ?? file.blurb });

    for (const [i, q] of file.questions.entries()) {
      try {
        await addField(trx, made.id, {
          key: q.key,
          kind: q.kind,
          label: q.label,
          help: q.help ?? null,
          required: Boolean(q.required),
          filterable: Boolean(q.filterable),
          settings: settingsOf(q),
          // Validated against the questions already added, so a file naming a
          // question that is not there yet, or that comes later, is refused
          // with the reason rather than making a logbook whose conditions
          // can never be met.
          shown_when: q.shown_when,
        });
      } catch (e) {
        if (e instanceof LogbookRefusal)
          refuse('bad-file', `Question ${String(i + 1)}: ${e.message}`);
        throw e;
      }
    }
    // `accepts_files` IS STILL READ, and still means what it did: this logbook
    // takes files. It is no longer a switch but an upload question, so an
    // older file naming it gets one at the end. A file that already has an
    // upload question says the same thing twice, without conflict.
    if (file.accepts_files && !file.questions.some((q) => q.kind === FILE_TYPE)) {
      await addField(trx, made.id, {
        key: 'attachments',
        kind: FILE_TYPE,
        label: 'Photos, video or documents',
        help: 'Anything that shows what happened. Everything is re-encoded, so camera metadata and location do not survive.',
      });
    }
    // The upload caps (files workstream), only when the file names them.
    const caps = {
      ...(file.max_files !== undefined ? { maxFiles: file.max_files } : {}),
      ...(file.max_total_bytes !== undefined ? { maxTotalBytes: file.max_total_bytes } : {}),
    };
    if (Object.keys(caps).length) {
      const v = validateLimits(caps);
      if (!v.ok) refuse('bad-file', v.message);
      else await setLogbookLimits(trx, made.id, v.values);
    }
    // Editorial notes, only when the file turns them on. Off is the default
    // and needs no row (logbook_editorial_notes: no row is off).
    if (file.editorial_notes === true) {
      await setNotesEnabled(trx, made.id, true, overrides.by ?? 'a logbook file');
    }
    if (file.ask_email === 'always') {
      await trx
        .updateTable('logbooks')
        .set({ email_required: true })
        .where('id', '=', made.id)
        .execute();
    }
    return made.id;
  });
  return logbookDetail(db, id);
}

/** One logbook's questions, as a file `createFromFile` would accept. */
export async function toFile(db: Kysely<DB>, logbookId: number): Promise<LogbookFile | null> {
  const lb = await logbookById(db, logbookId);
  if (!lb) return null;
  const fields = await fieldsFor(db, lb.id);
  // The upload caps, ONLY when this logbook set them, so a file from a
  // logbook on the site's limits looks as it always did.
  const caps = await db
    .selectFrom('logbook_file_limits')
    .select(['max_files', 'max_total_bytes'])
    .where('logbook_id', '=', lb.id)
    .executeTakeFirst();
  return {
    reportlog_logbook: LOGBOOK_FILE_VERSION,
    title: lb.title,
    slug: lb.slug,
    ...(lb.blurb ? { blurb: lb.blurb } : {}),
    // DERIVED, and kept so a copy read by an older deployment still takes
    // files. It restates what the upload question already says.
    accepts_files: lb.asks_for_files,
    ...(caps?.max_files != null ? { max_files: caps.max_files } : {}),
    ...(caps?.max_total_bytes != null ? { max_total_bytes: caps.max_total_bytes } : {}),
    // Only when on, so a file from a logbook without notes looks as it did.
    ...((await notesEnabled(db, lb.id)) ? { editorial_notes: true } : {}),
    // Only when the operator asked for an address the questions do not need (E1).
    ...(lb.email_required ? { ask_email: 'always' as const } : {}),
    questions: fields.map((f) => {
      const s = f.settings;
      const options = optionArray(s.options);
      return {
        key: f.key,
        kind: f.kind,
        label: f.label,
        ...(f.help ? { help: f.help } : {}),
        required: f.required,
        filterable: f.filterable,
        // Only when there is one, so a file from a logbook with no conditions
        // is the same file an older deployment wrote.
        ...(f.shown_when ? { shown_when: f.shown_when } : {}),
        ...(options.length ? { options } : {}),
        ...(f.kind === 'place' ? { allow_other: s.allowOther !== false } : {}),
        // Carried so a location question does not come back asking for US
        // states when it was made for countries. The old file format lost it.
        ...(f.kind === 'location' && typeof s.scope === 'string' ? { scope: s.scope } : {}),
        // Only when it is `county`, so a state question's file is unchanged.
        ...(f.kind === 'location' && s.depth === 'county' ? { depth: s.depth } : {}),
        ...(TEXT_KINDS.has(f.kind) && typeof s.maxLength === 'number'
          ? { max_length: s.maxLength }
          : {}),
        ...(f.kind === 'number' && typeof s.min === 'number' ? { min: s.min } : {}),
        ...(f.kind === 'number' && typeof s.max === 'number' ? { max: s.max } : {}),
        // The settings ruling 48's forms carry, each only when it is there, so
        // a file from a logbook without them is the file it always was.
        ...(Array.isArray(s.option_sets) ? { option_sets: optionSetsOf(s) } : {}),
        ...(Array.isArray(s.help_when) ? { help_when: s.help_when as HelpWhen[] } : {}),
        ...(typeof s.card_question === 'string' ? { card_question: s.card_question } : {}),
        ...(s.same_card === true ? { same_card: true } : {}),
        ...(f.kind === 'location' && typeof s.code === 'string' ? { code: s.code } : {}),
        ...(f.kind === 'location' && typeof s.within === 'string' ? { within: s.within } : {}),
        ...(f.kind === 'number' && s.integer === true ? { integer: true } : {}),
        ...(f.kind === 'number' && typeof s.picker === 'string' ? { picker: s.picker } : {}),
        ...(f.kind === 'yes_no' && s.checkbox === true ? { checkbox: true } : {}),
        // E4's limits, only when set, so a file without them is unchanged.
        ...(LIMITED_KINDS.has(f.kind) && typeof s.earliest === 'string'
          ? { earliest: s.earliest }
          : {}),
        ...(LIMITED_KINDS.has(f.kind) && typeof s.latest === 'string' ? { latest: s.latest } : {}),
      };
    }),
  };
}
