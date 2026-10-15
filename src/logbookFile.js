/**
 * A LOGBOOK AS A FILE.
 *
 * One plain JSON document describes a logbook: its title, whether it takes
 * files, and its questions in order. It is what an administrator downloads
 * from a logbook, what they upload to make a new one, and what a template
 * ships as. One shape for all three, so a template is nothing but a logbook
 * file somebody wrote in advance.
 *
 *   {
 *     "reportlog_logbook": 1,
 *     "title": "Election incidents",
 *     "slug": "election-incidents",          optional — made from the title
 *     "blurb": "…",                          optional
 *     "accepts_files": false,
 *     "editorial_notes": true,                optional — off unless present
 *     "max_files": 1,                         optional — the site's limit otherwise
 *     "max_total_bytes": 314572800,           optional — the site's limit otherwise
 *     "questions": [
 *       { "key": "state", "kind": "place", "label": "Which state?",
 *         "help": "…", "required": true, "filterable": true,
 *         "options": ["Alabama", "…"], "allow_other": false },
 *       { "key": "clip_of", "kind": "short_text", "label": "What is it of?",
 *         "shown_when": { "field": "has_files", "in": ["yes"] } }
 *     ]
 *   }
 *
 * UPLOADING ALWAYS MAKES A DRAFT. Nothing arrives launched: a draft can be
 * read, changed and launched deliberately, and launching is the one step
 * that cannot be undone. A file can therefore be as wrong as it likes
 * without anything reaching a reporter.
 *
 * The file carries no reports and no chain. It is the questions, not the
 * record — downloading a logbook's REPORTS is the archive export.
 */
import { pool } from './db.js';
import { FIELD_TYPE_IDS, FILE_TYPE } from './fieldTypes.js';
import {
  createLogbook, addField, logbookById, fieldsFor, slugify,
} from './logbooks.js';

export const LOGBOOK_FILE_VERSION = 1;

const KEY_RE = /^[a-z0-9][a-z0-9_]{0,38}$/;
const CHOICE_KINDS = new Set(['choice_one', 'choice_many', 'place']);

/** Everything wrong with a file, as plain sentences. Empty when it is fine. */
export function validateLogbookFile(f) {
  const errors = [];
  if (!f || typeof f !== 'object' || Array.isArray(f)) return ['That is not a logbook file.'];
  if (f.reportlog_logbook !== LOGBOOK_FILE_VERSION) {
    errors.push(`This is not a version ${LOGBOOK_FILE_VERSION} logbook file.`);
  }
  const title = String(f.title || '').trim();
  if (!title || title.length > 120) errors.push('The title must be 1 to 120 characters.');
  if (f.slug !== undefined && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(f.slug))) {
    errors.push('The web address may use lowercase letters, digits and hyphens only.');
  }
  if (!Array.isArray(f.questions) || !f.questions.length) {
    errors.push('A logbook needs at least one question.');
    return errors;
  }
  const keys = new Set();
  f.questions.forEach((q, i) => {
    const n = `Question ${i + 1}`;
    if (!q || typeof q !== 'object') { errors.push(`${n} is not a question.`); return; }
    if (!FIELD_TYPE_IDS.includes(q.kind)) errors.push(`${n} has an unknown kind "${q.kind}".`);
    const label = String(q.label || '').trim();
    if (!label || label.length > 160) errors.push(`${n} needs a question of 1 to 160 characters.`);
    if (q.key !== undefined) {
      if (!KEY_RE.test(String(q.key))) errors.push(`${n} has a key that is not lowercase letters, digits and underscores.`);
      else if (keys.has(q.key)) errors.push(`${n} repeats the key "${q.key}".`);
      else keys.add(q.key);
    }
    if (CHOICE_KINDS.has(q.kind) && q.kind !== 'place') {
      if (!Array.isArray(q.options) || !q.options.length) errors.push(`${n} needs a list of choices.`);
    }
    if (q.options !== undefined && !(Array.isArray(q.options)
      && q.options.every((o) => typeof o === 'string' && o.trim()))) {
      errors.push(`${n} has choices that are not all plain text.`);
    }
  });
  return errors;
}

/** The first slug from `base`, `base-2`, `base-3`… not already taken. */
async function freeSlug(base, client) {
  const root = (base || 'logbook').slice(0, 58);
  for (let i = 1; i < 1000; i += 1) {
    const s = i === 1 ? root : `${root}-${i}`;
    const { rows } = await client.query('SELECT 1 FROM logbooks WHERE slug = $1', [s]);
    if (!rows.length) return s;
  }
  throw new Error('no free slug');
}

/**
 * Make a DRAFT logbook from a file, all or nothing, in one transaction.
 *
 * A slug that is taken gets a number on the end rather than failing: the
 * slug is sealed into every report and never changes, so an upload must not
 * silently join an existing logbook's chain.
 */
export async function createFromFile(file, { client: given } = {}) {
  const errors = validateLogbookFile(file);
  if (errors.length) return { ok: false, errors };

  const client = given || await pool.connect();
  try {
    if (!given) await client.query('BEGIN');
    const slug = await freeSlug(file.slug || slugify(file.title), client);
    const made = await createLogbook({ title: file.title, slug, blurb: file.blurb }, client);
    if (!made.ok) throw new Error(`createLogbook: ${made.reason}`);
    const id = made.logbook.id;
    // WHETHER THIS LOGBOOK USES EDITORIAL NOTES, carried in the file rather
    // than as a template key, because it is a property of the logbook and
    // travels with it: a logbook downloaded from one deployment and uploaded
    // to another should arrive asking the same questions AND set up the same
    // way. Absent in every file written before migration 036, and absent
    // means off, which is the default everywhere else too.
    if (file.editorial_notes === true) {
      await client.query('UPDATE logbooks SET editorial_notes_enabled = true WHERE id = $1', [id]);
    }
    // THE UPLOAD CAPS, when the file names them. Absent means the site's own
    // limits, which is what every logbook had before migration 037 — so a
    // file written before this says nothing and changes nothing. The
    // database's CHECK is what refuses a nonsense number, rather than a
    // second copy of the range here that could disagree with it.
    if (file.max_files !== undefined || file.max_total_bytes !== undefined) {
      await client.query(
        `UPDATE logbooks SET max_files = coalesce($2, max_files),
                             max_total_bytes = coalesce($3, max_total_bytes)
          WHERE id = $1`,
        [id, file.max_files ?? null, file.max_total_bytes ?? null],
      );
    }
    for (const q of file.questions) {
      const settings = {};
      if (q.options) settings.options = q.options.map((o) => o.trim());
      if (q.kind === 'place') settings.allowOther = q.allow_other !== false;
      const added = await addField(id, {
        key: q.key, kind: q.kind, label: q.label, help: q.help,
        required: Boolean(q.required), filterable: Boolean(q.filterable), settings,
        // Passed straight through to addField, which validates it against
        // the questions already added — so a file naming a question that is
        // not there yet, or that comes later, is refused here with the
        // reason rather than creating a logbook whose conditions are
        // unsatisfiable. Absent in every file written before migration 034,
        // and undefined means "always asked".
        shown_when: q.shown_when,
      }, client);
      if (!added.ok) throw new Error(`addField "${q.label}": ${added.reason}`);
    }
    // `accepts_files` IS STILL READ FROM A FILE, and still means what it did:
    // this logbook takes files. It is no longer a column — it is an upload
    // question — so an older file naming it gets one added at the end rather
    // than being refused or quietly ignored. A file that carries an upload
    // question of its own already has one from the loop above, and addField
    // refuses a second, so it is skipped here instead of failing the import.
    //
    // Both directions stay readable: a file written before migration 032 still
    // produces a logbook that takes files, and a file written after says the
    // same thing twice without conflict.
    if (file.accepts_files && !file.questions.some((q) => q.kind === FILE_TYPE)) {
      const added = await addField(id, {
        key: 'attachments',
        kind: FILE_TYPE,
        label: 'Photos, video or documents',
        help: 'Anything that shows what happened. Everything is re-encoded, so camera'
          + ' metadata and location do not survive.',
      }, client);
      if (!added.ok) throw new Error(`addField "attachments": ${added.reason}`);
    }
    if (!given) await client.query('COMMIT');
    return { ok: true, logbook: await logbookById(id, client) };
  } catch (e) {
    if (!given) await client.query('ROLLBACK');
    return { ok: false, errors: [String(e.message || e)] };
  } finally {
    if (!given) client.release();
  }
}

/** One logbook's questions, as a file that createFromFile would accept. */
export async function toFile(logbookId, client = pool) {
  const lb = await logbookById(logbookId, client);
  if (!lb) return null;
  const fields = await fieldsFor(lb.id, client);
  return {
    reportlog_logbook: LOGBOOK_FILE_VERSION,
    title: lb.title,
    slug: lb.slug,
    ...(lb.blurb ? { blurb: lb.blurb } : {}),
    // DERIVED, and kept in the file so a copy read by an older deployment
    // still takes files. It restates what the upload question below already
    // says; createFromFile reads either and never acts on both.
    accepts_files: Boolean(lb.accepts_files),
    // Only when it is on, so a file from a logbook that does not use notes
    // is byte-identical to one written before migration 036 — which is what
    // lets a logbook move to an older deployment.
    ...(lb.editorial_notes_enabled ? { editorial_notes: true } : {}),
    // Only when set, so a logbook on the site's own limits writes a file
    // identical to one from before migration 037.
    ...(lb.max_files === null || lb.max_files === undefined ? {} : { max_files: lb.max_files }),
    ...(lb.max_total_bytes === null || lb.max_total_bytes === undefined
      ? {} : { max_total_bytes: Number(lb.max_total_bytes) }),
    questions: fields.map((f) => ({
      key: f.key,
      kind: f.kind,
      label: f.label,
      ...(f.help ? { help: f.help } : {}),
      required: f.required,
      filterable: f.filterable,
      // Only when there is one, so a file from a logbook with no conditions
      // is byte-identical to one written before migration 034 — which is
      // what lets a deployment move a logbook to an older one.
      ...(f.shown_when ? { shown_when: f.shown_when } : {}),
      ...(f.settings?.options?.length ? { options: f.settings.options } : {}),
      ...(f.kind === 'place' ? { allow_other: f.settings?.allowOther !== false } : {}),
    })),
  };
}
