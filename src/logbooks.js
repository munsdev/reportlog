/**
 * Logbooks: one named intake, with a questionnaire an operator built.
 *
 * STATE IS COMPUTED, NEVER STORED. Whether a logbook is accepting reports
 * is a question about the clock, and the clock is authoritative — so it is
 * answered at the moment somebody asks rather than flipped by a timer. A
 * timer is only as punctual as its last run, this deployment's run daily,
 * and a logbook due to open at 09:00 would have opened whenever the timer
 * next woke. Computing also survives the box being down over the boundary,
 * which a timer does not.
 */
import { pool } from './db.js';
import {
  fieldType, canFilter, FIELD_TYPE_IDS, FILE_TYPE, LOCATION_TYPE,
} from './fieldTypes.js';
import { LOCATION_SCOPES } from './gazetteer.js';
import { normalizeCondition, CANNOT_CARRY_CONDITION } from './conditions.js';

export const LOGBOOK_STATES = ['draft', 'scheduled', 'open', 'closed'];

/**
 * What state this row is in, at this moment.
 *
 * Order matters and is the whole of the lifecycle:
 *   draft      never launched. The field set is still editable.
 *   scheduled  launched, but its opening time has not arrived.
 *   open       accepting reports.
 *   closed     not accepting. Reports already filed stay published and
 *              stay verifiable — closing an intake is not retiring a record.
 */
export function stateOf(row, now = new Date()) {
  if (!row || !row.launched_at) return 'draft';
  if (row.closed_at) return 'closed';
  if (row.opens_at && new Date(row.opens_at) > now) return 'scheduled';
  if (row.closes_at && new Date(row.closes_at) <= now) return 'closed';
  return 'open';
}

export function isAccepting(row, now = new Date()) {
  return stateOf(row, now) === 'open';
}

/**
 * `accepts_files` IS DERIVED, NOT STORED, and that is the whole point.
 *
 * A logbook takes files if, and only if, it asks for them — if it has an
 * upload question. There used to be a stored `accepts_files` switch sitting
 * beside the questions rather than among them, which meant one decision had
 * two controls and an operator building a form had to know that asking for a
 * photo was configured somewhere other than everything else they asked for.
 *
 * Computed here rather than at each caller so there is one authority and no
 * caller can read a stale one. Every read of a logbook goes through this
 * shape, including the RETURNING clauses below, so the answer cannot differ
 * between a list and an update.
 *
 * The physical column survives, unread, as the thing migration 032 backfilled
 * the upload questions FROM. It is named in no query but that migration.
 *
 * `files_frozen_at` is a different question and is stored: it is not "does
 * this logbook ask for files" but "has somebody pulled the handle", which is
 * a protective act and worth recording the time of.
 */
const SHAPE = `id, slug, title, blurb, launched_at, opens_at, closes_at, closed_at, outside_access,
  created_at, updated_at, files_frozen_at, editorial_notes_enabled,
  max_files, max_total_bytes, max_image_bytes, max_video_bytes, max_audio_bytes,
  max_document_bytes, max_video_seconds, max_document_pages, attachment_kinds,
  EXISTS (SELECT 1 FROM logbook_fields f
           WHERE f.logbook_id = logbooks.id AND f.kind = '${FILE_TYPE}') AS accepts_files,
  (SELECT count(*)::int FROM logbook_fields f WHERE f.logbook_id = logbooks.id)
    AS question_count`;

function present(row) {
  if (!row) return null;
  return { ...row, state: stateOf(row) };
}

export async function listLogbooks(client = pool) {
  const { rows } = await client.query(`SELECT ${SHAPE} FROM logbooks ORDER BY created_at DESC`);
  return rows.map(present);
}

/** Only the ones a reporter could file to right now. */
export async function openLogbooks(client = pool) {
  const { rows } = await client.query(
    `SELECT ${SHAPE} FROM logbooks
      WHERE launched_at IS NOT NULL AND closed_at IS NULL
        AND (opens_at IS NULL OR opens_at <= now())
        AND (closes_at IS NULL OR closes_at > now())
      ORDER BY opens_at NULLS FIRST, id`,
  );
  return rows.map(present);
}

/**
 * Every logbook that has ever been open to reporters — including the ones
 * since closed.
 *
 * NOT the same list as openLogbooks, and the difference matters. The
 * reporting form must offer only what is taking reports right now; the
 * board must offer everything anybody could have filed to, because closing
 * a logbook is what happens when its work is DONE and its reports are
 * exactly the ones somebody will want to read afterwards. Serving the open
 * list to the board left a finished logbook's reports in the archive and
 * out of every filter.
 *
 * A draft is in neither: it has never been public and nothing can have been
 * filed to it.
 */
export async function launchedLogbooks(client = pool) {
  const { rows } = await client.query(
    `SELECT ${SHAPE} FROM logbooks
      WHERE launched_at IS NOT NULL
      ORDER BY coalesce(opens_at, launched_at) DESC, id DESC`,
  );
  return rows.map(present);
}

export async function logbookBySlug(slug, client = pool) {
  const { rows } = await client.query(`SELECT ${SHAPE} FROM logbooks WHERE slug = $1`, [slug]);
  return present(rows[0]);
}

export async function logbookById(id, client = pool) {
  const { rows } = await client.query(`SELECT ${SHAPE} FROM logbooks WHERE id = $1`, [id]);
  return present(rows[0]);
}

export async function fieldsFor(logbookId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, logbook_id, key, kind, label, help, required, filterable, settings, shown_when, position
       FROM logbook_fields WHERE logbook_id = $1 ORDER BY position, id`,
    [logbookId],
  );
  return rows;
}

/** The subset a board draws filters from. */
export async function filterableFields(logbookId, client = pool) {
  return (await fieldsFor(logbookId, client)).filter((f) => f.filterable && canFilter(f.kind));
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const KEY_RE = /^[a-z0-9][a-z0-9_]{0,38}$/;

export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

/** A field key, derived from a label but never changed afterwards. */
export function keyify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 39);
}

export async function createLogbook({ title, slug, blurb }, client = pool) {
  const t = String(title || '').trim();
  if (t.length < 1 || t.length > 120) return { ok: false, reason: 'title' };
  const s = slug ? String(slug).trim() : slugify(t);
  if (!SLUG_RE.test(s)) return { ok: false, reason: 'slug' };
  try {
    const { rows } = await client.query(
      `INSERT INTO logbooks (slug, title, blurb) VALUES ($1, $2, $3) RETURNING ${SHAPE}`,
      [s, t, blurb ? String(blurb).trim() : null],
    );
    return { ok: true, logbook: present(rows[0]) };
  } catch (e) {
    if (e.code === '23505') return { ok: false, reason: 'slug-taken' };
    throw e;
  }
}

/**
 * THE FIELD SET IS EDITABLE ONLY WHILE THE LOGBOOK IS A DRAFT.
 *
 * This is the freeze, guarded here rather than in a route, so every path
 * that could touch a field goes through it.
 *
 * WITH EXACTLY ONE OPENING, and it is worth being precise about why it is
 * safe. A launched logbook may still gain a NEW OPTIONAL field, and may
 * never lose one, rename one, make one required, or change what one means.
 *
 * Adding an optional question is safe because of the rule the whole archive
 * already runs on: a key enters the hashed object only when it applies.
 * Reports filed before the new question exists carry no key for it and hash
 * exactly as they did; reports filed after carry it only if answered. No
 * existing report changes, nothing rehashes, and the seal of each one still
 * describes the form its reporter actually saw.
 *
 * Everything else is refused because it would rewrite the meaning of
 * answers already sealed. Making a field required retroactively claims the
 * archive holds an answer it does not. Removing one orphans every answer
 * under that key. Editing a label leaves the seal pointing at a question
 * whose words have changed, which is the same fault that makes a category
 * un-renameable.
 */
async function assertDraft(logbookId, client) {
  const lb = await logbookById(logbookId, client);
  if (!lb) return { ok: false, reason: 'no-logbook' };
  if (lb.launched_at) return { ok: false, reason: 'launched' };
  return { ok: true, logbook: lb };
}

/**
 * Launch. THE ONE-WAY DOOR — there is no unlaunch, deliberately, because
 * the only thing unlaunching could mean is "let me edit the questions
 * again", and by then somebody may have answered them.
 *
 * A logbook with no fields cannot launch. A report is a logbook's answers,
 * so a logbook that asks nothing would file reports that say nothing, and
 * the operator who built it meant to add questions.
 */
export async function launch(logbookId, client = pool) {
  const lb = await logbookById(logbookId, client);
  if (!lb) return { ok: false, reason: 'no-logbook' };
  if (lb.launched_at) return { ok: false, reason: 'already-launched' };

  const { rows: fields } = await client.query(
    'SELECT count(*)::int AS n FROM logbook_fields WHERE logbook_id = $1', [logbookId],
  );
  if (!fields[0].n) return { ok: false, reason: 'no-fields' };

  const { rows } = await client.query(
    `UPDATE logbooks SET launched_at = now(), updated_at = now()
      WHERE id = $1 AND launched_at IS NULL RETURNING ${SHAPE}`,
    [logbookId],
  );
  // Lost the race with another launch. Not an error worth raising: the
  // logbook is launched, which is what was asked for.
  if (!rows.length) return { ok: false, reason: 'already-launched' };
  return { ok: true, logbook: present(rows[0]) };
}

/**
 * Delete a logbook that has never been used.
 *
 * WHY THERE WAS NO DELETE AT ALL, and why this one is so narrow.
 *
 * A LAUNCHED LOGBOOK CAN NEVER BE DELETED, and that is not a policy that
 * could be relaxed by an operator who is sure. It is its own hash chain,
 * `reports` is append-only, and the daily anchor's rule is that a logbook
 * on a published list stays on every later one with a count that only
 * grows — `src/chainHeads.js` refuses to publish a list that breaks it,
 * because that refusal is the only thing that would notice a whole
 * logbook disappearing. A delete here would turn the archive's strongest
 * guarantee into a button.
 *
 * BUT A DRAFT IS NOT THAT. It has never been launched, so it has never
 * been on an anchor list, has never taken a report and has no chain. It
 * is a form somebody half-built, and until now it was permanent: the
 * screen offered no way to remove one, so a typo in a slug — which is not
 * editable — left a logbook on the page forever. Lists have had
 * `deleteUnused` for exactly this.
 *
 * THE TWO CHECKS ARE BELT AND BRACES ON PURPOSE. `launched_at` being null
 * should mean there are no reports, and the count is taken anyway: if
 * those two ever disagree, the disagreement is a bug and the safe reading
 * of it is "do not delete".
 */
export async function deleteDraft(logbookId, client = pool) {
  const lb = await logbookById(logbookId, client);
  if (!lb) return { ok: false, reason: 'no-logbook' };
  if (lb.launched_at) return { ok: false, reason: 'launched' };

  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM reports WHERE logbook_id = $1', [logbookId],
  );
  if (rows[0].n > 0) return { ok: false, reason: 'has-reports' };

  /* THE QUESTIONS CASCADE; THE FORM VERSIONS DO NOT.
     `logbook_fields` carries ON DELETE CASCADE (migration 027) and
     `logbook_forms` does not (migration 031) — deliberately, because a
     sealed form is what a report was answered against and must outlive
     casual deletion. For a draft there are no reports and so nothing
     depending on those rows, but the foreign key does not know that and
     would refuse the delete. So they go first, explicitly, in the same
     transaction.
     IN A TRANSACTION because a half-done delete would leave a logbook
     with its form versions gone — which is the one state that makes
     `immutableFieldsFor` throw rather than rebuild a different object. */
  const own = client === pool ? await pool.connect() : client;
  try {
    if (own !== client) await own.query('BEGIN');
    await own.query('DELETE FROM logbook_forms WHERE logbook_id = $1', [logbookId]);
    const { rowCount } = await own.query(
      'DELETE FROM logbooks WHERE id = $1 AND launched_at IS NULL', [logbookId],
    );
    if (own !== client) await own.query(rowCount ? 'COMMIT' : 'ROLLBACK');
    // Lost the race with a launch between the check above and the delete.
    // Nothing was removed and nothing is half-removed.
    if (!rowCount) return { ok: false, reason: 'launched' };
  } catch (e) {
    if (own !== client) await own.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (own !== client) own.release();
  }
  return { ok: true, deleted: lb.slug };
}

export async function addField(logbookId, spec, client = pool) {
  const lb = await logbookById(logbookId, client);
  if (!lb) return { ok: false, reason: 'no-logbook' };

  // THE ONE THING A LAUNCHED LOGBOOK MAY DO. See assertDraft above for why
  // this is safe and why nothing else is. A required field after launch is
  // refused on the same ground as making an existing one required: the
  // reports already filed did not answer it and never will, so the form
  // would be claiming something of them that is not true.
  if (lb.launched_at && spec.required) return { ok: false, reason: 'launched-required' };

  const kind = String(spec.kind || '');
  if (!FIELD_TYPE_IDS.includes(kind)) return { ok: false, reason: 'kind' };

  if (kind === FILE_TYPE) {
    // AN UPLOAD QUESTION IS NEVER REQUIRED. It seals no answer, so nothing
    // here can tell whether it was satisfied — buildAnswers skips it
    // outright, and a required one would either fail every submission
    // forever or be a rule that quietly does nothing. Whether files are
    // actually needed is the attachment layer's question, asked where the
    // files are.
    if (spec.required) return { ok: false, reason: 'file-required' };
    // AT MOST ONE. Two upload questions would be two places to put the same
    // files, and the manifest they seal into is one list per report with
    // nothing in it saying which question a file came from — so the second
    // one would be a question the archive cannot answer.
    const { rows: already } = await client.query(
      'SELECT 1 FROM logbook_fields WHERE logbook_id = $1 AND kind = $2 LIMIT 1',
      [logbookId, FILE_TYPE],
    );
    if (already.length) return { ok: false, reason: 'file-exists' };
  }
  const label = String(spec.label || '').trim();
  if (label.length < 1 || label.length > 160) return { ok: false, reason: 'label' };

  const key = spec.key ? String(spec.key).trim() : keyify(label);
  if (!KEY_RE.test(key)) return { ok: false, reason: 'key' };

  // A filterable flag on a type with no filter control would be a setting
  // that silently does nothing — the same fault as a palette in a dropdown
  // with no CSS behind it.
  const filterable = Boolean(spec.filterable) && canFilter(kind);

  const defaults = fieldType(kind).settings || {};
  const settings = { ...defaults, ...(spec.settings || {}) };

  /* A LOCATION SCOPE THAT IS NOT ONE OF THE THREE is refused here rather
     than tolerated downstream. `scopeAccepts` falls back to the default
     for an unrecognised scope instead of throwing, which is right at
     answer time — a stored typo must not make an existing question reject
     every answer — but it means a typo on the way IN would silently narrow
     a logbook meant for countries down to US states, and the operator
     would find out from reporters. The launch door is one-way, so this is
     the only moment it can be caught. */
  if (kind === LOCATION_TYPE && !LOCATION_SCOPES.includes(settings.scope)) {
    return { ok: false, reason: 'location-scope' };
  }

  // WHEN THIS QUESTION IS ASKED. Checked against the questions that come
  // BEFORE it, because a condition may only look backwards — a question
  // answered on card 9 cannot decide whether card 4 is put, and refusing
  // forward references is also what makes cycles impossible.
  // src/conditions.js has the rest.
  //
  // A NEW OPTIONAL QUESTION ON A LAUNCHED LOGBOOK MAY HAVE ONE. Nobody has
  // been asked it yet, so there are no answers for a condition to
  // invalidate — the same reasoning that lets the question be added at all.
  const cond = normalizeCondition(spec.shown_when, await fieldsFor(logbookId, client));
  if (cond.ok && cond.condition && CANNOT_CARRY_CONDITION.has(kind)) {
    return { ok: false, reason: 'shown-when-unsupported-kind' };
  }
  if (!cond.ok) {
    return {
      ok: false,
      reason: `shown-when-${cond.reason}`,
      ...(cond.unknown ? { unknown: cond.unknown } : {}),
    };
  }

  try {
    const { rows } = await client.query(
      `INSERT INTO logbook_fields (logbook_id, key, kind, label, help, required, filterable, settings, shown_when, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         coalesce((SELECT max(position) + 1 FROM logbook_fields WHERE logbook_id = $1), 0))
       RETURNING id, logbook_id, key, kind, label, help, required, filterable, settings, shown_when, position`,
      [logbookId, key, kind, label, spec.help ? String(spec.help).trim() : null,
        Boolean(spec.required), filterable, JSON.stringify(settings),
        cond.condition ? JSON.stringify(cond.condition) : null],
    );
    return { ok: true, field: rows[0] };
  } catch (e) {
    if (e.code === '23505') return { ok: false, reason: 'key-taken' };
    throw e;
  }
}

/**
 * Edit a field. THE KEY IS NOT EDITABLE and is not accepted here: it is
 * sealed into every report that answers the field, so changing it would
 * orphan those answers from the question they answered.
 */
export async function updateField(logbookId, fieldId, spec, client = pool) {
  const guard = await assertDraft(logbookId, client);
  if (!guard.ok) return guard;

  const { rows: existing } = await client.query(
    'SELECT kind FROM logbook_fields WHERE id = $1 AND logbook_id = $2', [fieldId, logbookId],
  );
  if (!existing.length) return { ok: false, reason: 'no-field' };
  const kind = existing[0].kind;

  const label = spec.label === undefined ? null : String(spec.label).trim();
  if (label !== null && (label.length < 1 || label.length > 160)) return { ok: false, reason: 'label' };

  // The condition, when the caller named one. Checked against the questions
  // before this one, which excludes the field itself — so a question cannot
  // be made to depend on its own answer.
  let shownWhen = null;
  if (spec.shown_when !== undefined) {
    const all = await fieldsFor(logbookId, client);
    const self = all.findIndex((f) => String(f.id) === String(fieldId));
    const earlier = self === -1 ? all : all.slice(0, self);
    const cond = normalizeCondition(spec.shown_when, earlier);
    if (cond.ok && cond.condition && CANNOT_CARRY_CONDITION.has(kind)) {
      return { ok: false, reason: 'shown-when-unsupported-kind' };
    }
    if (!cond.ok) {
      return {
        ok: false,
        reason: `shown-when-${cond.reason}`,
        ...(cond.unknown ? { unknown: cond.unknown } : {}),
      };
    }
    shownWhen = cond.condition ? JSON.stringify(cond.condition) : null;
  }

  const { rows } = await client.query(
    `UPDATE logbook_fields SET
       label      = coalesce($3, label),
       help       = CASE WHEN $4::boolean THEN $5 ELSE help END,
       required   = coalesce($6, required),
       filterable = coalesce($7, filterable),
       settings   = coalesce($8, settings),
       shown_when = CASE WHEN $9::boolean THEN $10::jsonb ELSE shown_when END
     WHERE id = $1 AND logbook_id = $2
     RETURNING id, logbook_id, key, kind, label, help, required, filterable, settings, shown_when, position`,
    [fieldId, logbookId, label,
      spec.help !== undefined, spec.help ? String(spec.help).trim() : null,
      spec.required === undefined ? null : Boolean(spec.required),
      spec.filterable === undefined ? null : (Boolean(spec.filterable) && canFilter(kind)),
      spec.settings === undefined ? null : JSON.stringify(spec.settings),
      spec.shown_when !== undefined, shownWhen],
  );
  return { ok: true, field: rows[0] };
}

export async function removeField(logbookId, fieldId, client = pool) {
  const guard = await assertDraft(logbookId, client);
  if (!guard.ok) return guard;
  const { rowCount } = await client.query(
    'DELETE FROM logbook_fields WHERE id = $1 AND logbook_id = $2', [fieldId, logbookId],
  );
  return rowCount ? { ok: true } : { ok: false, reason: 'no-field' };
}

/** Reorder in one statement, so a half-applied order cannot be left behind. */
export async function reorderFields(logbookId, orderedIds, client = pool) {
  const guard = await assertDraft(logbookId, client);
  if (!guard.ok) return guard;
  const ids = (Array.isArray(orderedIds) ? orderedIds : []).map(Number).filter(Boolean);
  if (!ids.length) return { ok: false, reason: 'order' };
  await client.query(
    `UPDATE logbook_fields SET position = ord.pos
       FROM unnest($2::bigint[]) WITH ORDINALITY AS ord(fid, pos)
      WHERE logbook_fields.id = ord.fid AND logbook_fields.logbook_id = $1`,
    [logbookId, ids],
  );
  return { ok: true };
}

/** Close or reopen. Touches nothing hashed and is always reversible. */
export async function setClosed(logbookId, closed, client = pool) {
  const { rows } = await client.query(
    `UPDATE logbooks SET closed_at = CASE WHEN $2::boolean THEN now() ELSE NULL END,
            updated_at = now()
      WHERE id = $1 RETURNING ${SHAPE}`,
    [logbookId, Boolean(closed)],
  );
  return rows.length ? { ok: true, logbook: present(rows[0]) } : { ok: false, reason: 'no-logbook' };
}

/**
 * Whether somebody WITHOUT the site password may file into this logbook:
 * 'closed' (the default), 'link' (anybody with its /file/ address) or 'door'
 * (also linked from the password page). Migration 047.
 *
 * FILING ONLY. It opens the form and the confirmation link, nothing else —
 * the board, the other logbooks and the rest of the site stay behind the
 * password. src/doors.js holds the exact allow-list. Not behind the one-way
 * door: it changes who can reach the form, not what the form asks.
 */
export const OUTSIDE_ACCESS = Object.freeze(['closed', 'link', 'door']);
export async function setOutsideAccess(logbookId, value, client = pool) {
  if (!OUTSIDE_ACCESS.includes(value)) return { ok: false, reason: 'outside' };
  const { rows } = await client.query(
    `UPDATE logbooks SET outside_access = $2, updated_at = now()
      WHERE id = $1 RETURNING ${SHAPE}`,
    [logbookId, value],
  );
  return rows.length ? { ok: true, logbook: present(rows[0]) } : { ok: false, reason: 'no-logbook' };
}

export async function setSchedule(logbookId, { opensAt, closesAt }, client = pool) {
  const { rows } = await client.query(
    `UPDATE logbooks SET opens_at = $2, closes_at = $3, updated_at = now()
      WHERE id = $1 RETURNING ${SHAPE}`,
    [logbookId, opensAt || null, closesAt || null],
  );
  return rows.length ? { ok: true, logbook: present(rows[0]) } : { ok: false, reason: 'no-logbook' };
}

/**
 * Freeze or unfreeze this logbook's uploads. A PROTECTIVE MEASURE, not the
 * everyday control.
 *
 * Whether a logbook asks for files is its questions' business — it has an
 * upload question or it does not — and after launch a question cannot be
 * removed. This is the handle for the case that rule leaves untended: a
 * running logbook that must stop taking files NOW, without touching the form
 * anybody is halfway through answering, and without waiting on a decision
 * about the whole site.
 *
 * ALLOWED BOTH WAYS, BEFORE AND AFTER LAUNCH, and it is not a question, so it
 * is not behind the one-way door. Nothing about it is sealed: a report's files
 * live in its own `attachments` key, present only when there were any, so
 * freezing adds nothing to reports already filed and unfreezing takes nothing
 * from them. It stops NEW uploads and never hides a file already published.
 *
 * The time is stored rather than a boolean, because "somebody pulled this
 * handle, and when" is the useful fact about a protective act. Null is the
 * ordinary state.
 */
export async function setFilesFrozen(logbookId, frozen, client = pool) {
  const { rows } = await client.query(
    `UPDATE logbooks SET files_frozen_at = CASE WHEN $2::boolean THEN coalesce(files_frozen_at, now()) END,
       updated_at = now()
      WHERE id = $1 RETURNING ${SHAPE}`,
    [logbookId, Boolean(frozen)],
  );
  return rows.length ? { ok: true, logbook: present(rows[0]) } : { ok: false, reason: 'no-logbook' };
}

/**
 * Whether a moderator may attach an editorial note to a report in this
 * logbook.
 *
 * PER LOGBOOK AND NOT PER DEPLOYMENT, because what a note is FOR varies. An
 * election logbook publishing accounts that name officials by role, place
 * and time needs one; an internal safety log that publishes nothing has no
 * use for the feature and should not have the control in front of its
 * moderators. Off by default, like every other switch here.
 *
 * NOT A ONE-WAY DOOR, unlike launching. Turning notes off hides no note
 * already written — the notes stay, and a logbook whose operator changes
 * their mind has not lost the editorial record. It stops NEW ones, which is
 * the only thing a switch can honestly promise.
 */
export async function setEditorialNotes(logbookId, enabled, client = pool) {
  const { rows } = await client.query(
    `UPDATE logbooks SET editorial_notes_enabled = $2, updated_at = now()
      WHERE id = $1 RETURNING ${SHAPE}`,
    [logbookId, Boolean(enabled)],
  );
  return rows.length ? { ok: true, logbook: present(rows[0]) } : { ok: false, reason: 'no-logbook' };
}

/**
 * This logbook's own upload limits.
 *
 * NOT BEHIND assertDraft, and that is the whole point. Every other change
 * to a launched logbook is refused because the questions it asked are
 * sealed into every report filed against it. A limit is not a question. It
 * changes no answer anybody gave, nothing hashed reads it, and it is
 * exactly the thing an operator learns the right value for from real
 * traffic — a cap that could only be set before launch could never be
 * corrected on the night it turned out to be wrong.
 *
 * Only the keys sent are written. A key nobody sent is not a key set to
 * its default: writing all nine on every save would freeze this logbook
 * against every later change to the site, which is the opposite of what
 * leaving a box empty means.
 *
 * `validateLimits` in src/attachments.js has already been past the values,
 * and the ranges live there once.
 */
export async function setLogbookLimits(logbookId, values, client = pool) {
  const { LIMIT_RANGES } = await import('./attachments.js');
  const sets = []; const args = [logbookId];
  for (const [key, range] of Object.entries(LIMIT_RANGES)) {
    if (!(key in values)) continue;
    args.push(values[key]);
    sets.push(`${range.column} = $${args.length}`);
  }
  if ('kinds' in values) {
    args.push(values.kinds);
    sets.push(`attachment_kinds = $${args.length}`);
  }
  if (!sets.length) {
    const lb = await logbookById(logbookId, client);
    return lb ? { ok: true, logbook: lb } : { ok: false, reason: 'no-logbook' };
  }
  const { rows } = await client.query(
    `UPDATE logbooks SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1 RETURNING ${SHAPE}`, args,
  );
  return rows.length ? { ok: true, logbook: present(rows[0]) } : { ok: false, reason: 'no-logbook' };
}

/**
 * Whether this logbook will accept an upload right now: it asks for files and
 * nobody has frozen it. The site's own storage switch is a separate gate and
 * is checked beside this, not inside it.
 */
export function takesFiles(row) {
  return Boolean(row && row.accepts_files && !row.files_frozen_at);
}
