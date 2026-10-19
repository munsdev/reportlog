/**
 * Logbooks: one named intake each, with questions an operator built.
 *
 * STATE IS COMPUTED, NEVER STORED. Whether a logbook is taking reports is a
 * question about the clock, and the clock is authoritative, so it is answered
 * when somebody asks (`stateOf`) rather than flipped by a timer. A timer is
 * only as punctual as its last run, and computing survives the server being
 * down across the boundary, which a timer does not.
 *
 * EVERY CHANGE TO A QUESTION GOES THROUGH THIS MODULE, and every one of them
 * runs inside a transaction that holds the logbook's row lock. That is what
 * makes the one-way door a door: a launch and an edit to the draft cannot
 * interleave, so one of them wins whole. The database refuses changes after
 * launch as well (logbook_fields_guard); this module refuses first, and says
 * why.
 */
import type { LogbookSummary, Question, QuestionSettingsInput } from '@reportlog/contracts';
import {
  CANNOT_CARRY_CONDITION,
  FILE_TYPE,
  LOCATION_SCOPES,
  LOCATION_TYPE,
  canFilter,
  fieldType,
  isFieldKind,
  normalizeCondition,
} from '@reportlog/fields';
import type { Condition, FieldDefinition, FieldSettings } from '@reportlog/fields';
import { sql } from 'kysely';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { ensureFormVersion } from '../chain/forms.ts';
import { questionsFor } from '../chain/questions.ts';
import type { DB, LogbookFields } from '../db/schema.gen.ts';
import { refuse } from './refusals.ts';
import type { RefusalCode } from './refusals.ts';

export { LogbookRefusal } from './refusals.ts';

type Db = Kysely<DB>;

export const LOGBOOK_STATES = ['draft', 'scheduled', 'open', 'closed'] as const;
export type LogbookState = (typeof LOGBOOK_STATES)[number];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const KEY_RE = /^[a-z0-9][a-z0-9_]{0,38}$/;

// ── state ───────────────────────────────────────────────────────────────

interface Clocked {
  launched_at: Date | string | null;
  opens_at: Date | string | null;
  closes_at: Date | string | null;
  closed_at: Date | string | null;
}

/**
 * What state a logbook is in at this moment. The order is the whole of the
 * lifecycle:
 *
 *   draft      never launched. Its questions are still editable.
 *   scheduled  launched, but its opening time has not arrived.
 *   open       taking reports.
 *   closed     not taking reports. Reports already filed stay as they are:
 *              closing an intake is not retiring a record.
 */
export function stateOf(row: Clocked, now = new Date()): LogbookState {
  if (!row.launched_at) return 'draft';
  if (row.closed_at) return 'closed';
  if (row.opens_at && new Date(row.opens_at) > now) return 'scheduled';
  if (row.closes_at && new Date(row.closes_at) <= now) return 'closed';
  return 'open';
}

export function isAccepting(row: Clocked, now = new Date()): boolean {
  return stateOf(row, now) === 'open';
}

// ── reading ─────────────────────────────────────────────────────────────

const iso = (d: Date | string | null): string | null =>
  d === null ? null : new Date(d).toISOString();

/**
 * Every read of a logbook goes through this shape, so a list and a single
 * read cannot disagree. `asks_for_files` is DERIVED: a logbook takes files if,
 * and only if, it has an upload question. A stored switch beside the
 * questions would be one decision with two controls.
 */
function summaries(db: Db) {
  return db.selectFrom('logbooks').select((eb) => [
    'logbooks.id',
    'logbooks.slug',
    'logbooks.title',
    'logbooks.blurb',
    'logbooks.launched_at',
    'logbooks.opens_at',
    'logbooks.closes_at',
    'logbooks.closed_at',
    'logbooks.created_at',
    'logbooks.updated_at',
    eb
      .selectFrom('logbook_fields as f')
      .whereRef('f.logbook_id', '=', 'logbooks.id')
      .select((e) => e.fn.countAll<number>().as('n'))
      .as('question_count'),
    eb
      .exists(
        eb
          .selectFrom('logbook_fields as f')
          .whereRef('f.logbook_id', '=', 'logbooks.id')
          .where('f.kind', '=', FILE_TYPE)
          .select(sql<number>`1`.as('one')),
      )
      .as('asks_for_files'),
  ]);
}

type SummaryRow = Awaited<ReturnType<ReturnType<typeof summaries>['executeTakeFirstOrThrow']>>;

function present(row: SummaryRow): LogbookSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    blurb: row.blurb,
    state: stateOf(row),
    launched_at: iso(row.launched_at),
    opens_at: iso(row.opens_at),
    closes_at: iso(row.closes_at),
    closed_at: iso(row.closed_at),
    created_at: iso(row.created_at) ?? '',
    updated_at: iso(row.updated_at) ?? '',
    question_count: row.question_count ?? 0,
    asks_for_files: Boolean(row.asks_for_files),
  };
}

export async function listLogbooks(db: Db): Promise<LogbookSummary[]> {
  const rows = await summaries(db)
    .orderBy('logbooks.created_at', 'desc')
    .orderBy('logbooks.id', 'desc')
    .execute();
  return rows.map(present);
}

/** Only the ones a reporter could file to right now. */
export async function openLogbooks(db: Db): Promise<LogbookSummary[]> {
  const rows = await summaries(db)
    .where('logbooks.launched_at', 'is not', null)
    .where('logbooks.closed_at', 'is', null)
    .where((eb) =>
      eb.or([eb('logbooks.opens_at', 'is', null), eb('logbooks.opens_at', '<=', sql<Date>`now()`)]),
    )
    .where((eb) =>
      eb.or([
        eb('logbooks.closes_at', 'is', null),
        eb('logbooks.closes_at', '>', sql<Date>`now()`),
      ]),
    )
    .orderBy(sql`logbooks.opens_at NULLS FIRST`)
    .orderBy('logbooks.id')
    .execute();
  return rows.map(present);
}

/**
 * Every logbook that has ever been open to reporters, including the ones
 * since closed. NOT the same list as `openLogbooks`: the form offers what is
 * taking reports now, and the board offers everything anybody could have
 * filed to, because a closed logbook's reports are exactly the ones somebody
 * wants to read afterwards. A draft is in neither.
 */
export async function launchedLogbooks(db: Db): Promise<LogbookSummary[]> {
  const rows = await summaries(db)
    .where('logbooks.launched_at', 'is not', null)
    .orderBy(sql`coalesce(logbooks.opens_at, logbooks.launched_at) DESC`)
    .orderBy('logbooks.id', 'desc')
    .execute();
  return rows.map(present);
}

export async function logbookById(db: Db, id: number): Promise<LogbookSummary | null> {
  const row = await summaries(db).where('logbooks.id', '=', id).executeTakeFirst();
  return row ? present(row) : null;
}

export async function logbookBySlug(db: Db, slug: string): Promise<LogbookSummary | null> {
  const row = await summaries(db).where('logbooks.slug', '=', slug).executeTakeFirst();
  return row ? present(row) : null;
}

function presentQuestion(r: Selectable<LogbookFields>): Question {
  return {
    id: r.id,
    key: r.key,
    kind: r.kind,
    label: r.label,
    help: r.help,
    required: r.required,
    filterable: r.filterable,
    shown_when: (r.shown_when ?? null) as Condition | null,
    settings: r.settings as Record<string, unknown>,
    position: r.position,
  };
}

/** A logbook's questions, in the operator's order. */
export async function fieldsFor(db: Db, logbookId: number): Promise<Question[]> {
  const rows = await db
    .selectFrom('logbook_fields')
    .selectAll()
    .where('logbook_id', '=', logbookId)
    .orderBy('position')
    .orderBy('id')
    .execute();
  return rows.map(presentQuestion);
}

/** The subset a board draws filters from. Nothing is a filter unless an operator said so. */
export async function filterableFields(db: Db, logbookId: number): Promise<Question[]> {
  return (await fieldsFor(db, logbookId)).filter((f) => f.filterable && canFilter(f.kind));
}

/**
 * Questions as the sealing code and the answer builder read them. THE SAME
 * SHAPE `questionsFor` in the chain produces: `help` and `shown_when` are
 * absent, not null, when there is none, because the form definition writes
 * them only when they apply.
 */
export function toDefinitions(questions: readonly Question[]): FieldDefinition[] {
  return questions.map((q) => ({
    key: q.key,
    kind: q.kind,
    label: q.label,
    ...(q.help ? { help: q.help } : {}),
    required: q.required,
    ...(q.shown_when ? { shown_when: q.shown_when } : {}),
    settings: q.settings,
  }));
}

export async function logbookDetail(db: Db, id: number) {
  const lb = await logbookById(db, id);
  if (!lb) return refuse('no-logbook');
  return { ...lb, fields: await fieldsFor(db, id) };
}

// ── names ───────────────────────────────────────────────────────────────

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/** A question key, derived from its label once and never changed afterwards. */
export function keyify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 39)
    .replace(/_+$/, '');
}

// ── locking ─────────────────────────────────────────────────────────────

async function inTransaction<T>(db: Db, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  // A caller already inside a transaction (making a logbook from a file)
  // keeps it: the whole file lands or none of it does.
  return db.isTransaction ? fn(db as Transaction<DB>) : db.transaction().execute(fn);
}

interface Locked {
  id: number;
  slug: string;
  launched_at: Date | null;
}

/** The logbook's row, locked until the transaction ends. */
async function lock(trx: Transaction<DB>, id: number): Promise<Locked> {
  const row = await trx
    .selectFrom('logbooks')
    .select(['id', 'slug', 'launched_at'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  return row ?? refuse('no-logbook');
}

/**
 * THE QUESTIONS ARE EDITABLE ONLY WHILE THE LOGBOOK IS A DRAFT.
 *
 * Here rather than in a route, so every path that could touch a question goes
 * through it. Returns the locked row, so the check and the change happen
 * under one lock: a launch cannot land between them.
 *
 * WITH EXACTLY ONE OPENING, in `addField`: a launched logbook may gain a new
 * OPTIONAL question. That is safe because a key enters the sealed object only
 * when it applies, so reports filed before the question existed carry no key
 * for it and hash exactly as they did. Everything else would rewrite the
 * meaning of answers already sealed: making a question required claims the
 * archive holds answers it does not; removing one orphans every answer under
 * its key; rewording one leaves the seal pointing at words that changed.
 */
export async function assertDraft(trx: Transaction<DB>, logbookId: number): Promise<Locked> {
  const lb = await lock(trx, logbookId);
  if (lb.launched_at) refuse('launched');
  return lb;
}

// ── the logbook itself ──────────────────────────────────────────────────

function checkTitle(title: string): string {
  const t = title.trim();
  if (t.length < 1 || t.length > 120) refuse('title');
  return t;
}

const blurbOf = (b: string | null | undefined) => (b?.trim() ? b.trim() : null);

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === '23505';
}

export async function createLogbook(
  db: Db,
  spec: { title: string; slug?: string | undefined; blurb?: string | undefined },
): Promise<LogbookSummary> {
  const title = checkTitle(spec.title);
  const slug = spec.slug?.trim() ? spec.slug.trim() : slugify(title);
  if (!SLUG_RE.test(slug)) refuse('slug');
  try {
    const row = await db
      .insertInto('logbooks')
      .values({ slug, title, blurb: blurbOf(spec.blurb) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (await logbookById(db, row.id)) ?? refuse('no-logbook');
  } catch (e) {
    if (isUniqueViolation(e)) refuse('slug-taken');
    throw e;
  }
}

/**
 * The title and the description. NOT behind the door: neither is in the form
 * definition (`formDefinition` in @reportlog/seal leaves them out on purpose),
 * so changing them changes no answer anybody gave. The slug is never
 * editable, and is not accepted here.
 */
export async function updateDetails(
  db: Db,
  id: number,
  spec: { title?: string | undefined; blurb?: string | null | undefined },
): Promise<LogbookSummary> {
  const set: { title?: string; blurb?: string | null; updated_at: Date } = {
    updated_at: new Date(),
  };
  if (spec.title !== undefined) set.title = checkTitle(spec.title);
  if (spec.blurb !== undefined) set.blurb = blurbOf(spec.blurb);
  const done = await db.updateTable('logbooks').set(set).where('id', '=', id).executeTakeFirst();
  if (!done.numUpdatedRows) refuse('no-logbook');
  return (await logbookById(db, id)) ?? refuse('no-logbook');
}

/**
 * LAUNCH. THE ONE-WAY DOOR. There is no unlaunch, because the only thing
 * unlaunching could mean is "let me edit the questions again", and by then
 * somebody may have answered them. Closing is the reversible thing.
 *
 * A logbook that asks nothing cannot launch: a report is a logbook's answers.
 *
 * The form version it launched with is recorded at the moment of launch, so
 * the first version exists before the first report rather than with it.
 */
export async function launch(db: Db, id: number): Promise<LogbookSummary> {
  await inTransaction(db, async (trx) => {
    const lb = await lock(trx, id);
    if (lb.launched_at) refuse('already-launched');
    const questions = await questionsFor(trx, id);
    if (!questions.length) refuse('no-fields');
    // Every path that writes a condition checks it, so this should never
    // fire. If it does, the safe reading is "do not freeze it like this".
    checkConditions(questions);
    const launched_at = new Date();
    await trx
      .updateTable('logbooks')
      .set({ launched_at, updated_at: launched_at })
      .where('id', '=', id)
      .execute();
    await ensureFormVersion(trx, { ...lb, launched_at }, questions);
  });
  return (await logbookById(db, id)) ?? refuse('no-logbook');
}

/**
 * Delete a logbook that was never launched.
 *
 * A LAUNCHED LOGBOOK IS NEVER DELETED, and that is not a permission level. It
 * is its own hash chain and the daily anchor names it from then on. A draft
 * has none of that: it is a half-built form, and a typo in a slug (which is
 * not editable) must not leave one on the page forever.
 *
 * Both checks, on purpose: a draft should have no reports, and the count is
 * taken anyway. If those ever disagree, the safe reading is "do not delete".
 */
export async function deleteDraft(db: Db, id: number): Promise<string> {
  return inTransaction(db, async (trx) => {
    const lb = await lock(trx, id);
    if (lb.launched_at) refuse('launched-not-deletable');
    const reports = await trx
      .selectFrom('reports')
      .select('id')
      .where('logbook_id', '=', id)
      .limit(1)
      .execute();
    if (reports.length) refuse('has-reports');
    // Its questions cascade. A draft has no form versions: only a launched
    // logbook gets one, and they are append-only.
    await trx
      .deleteFrom('logbooks')
      .where('id', '=', id)
      .where('launched_at', 'is', null)
      .execute();
    return lb.slug;
  });
}

/** Close or reopen. Touches nothing sealed and is always reversible. */
export async function setClosed(db: Db, id: number, closed: boolean): Promise<LogbookSummary> {
  await inTransaction(db, async (trx) => {
    const lb = await lock(trx, id);
    if (!lb.launched_at) refuse('not-launched');
    const now = new Date();
    await trx
      .updateTable('logbooks')
      .set({ closed_at: closed ? now : null, updated_at: now })
      .where('id', '=', id)
      .execute();
  });
  return (await logbookById(db, id)) ?? refuse('no-logbook');
}

function readTime(v: string | null): Date | null {
  if (v === null || v.trim() === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? refuse('schedule-time') : d;
}

export async function setSchedule(
  db: Db,
  id: number,
  spec: { opensAt: string | null; closesAt: string | null },
): Promise<LogbookSummary> {
  const opens_at = readTime(spec.opensAt);
  const closes_at = readTime(spec.closesAt);
  if (opens_at && closes_at && opens_at >= closes_at) refuse('schedule-order');
  await inTransaction(db, async (trx) => {
    const lb = await lock(trx, id);
    if (!lb.launched_at) refuse('not-launched');
    await trx
      .updateTable('logbooks')
      .set({ opens_at, closes_at, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  });
  return (await logbookById(db, id)) ?? refuse('no-logbook');
}

// ── questions ───────────────────────────────────────────────────────────

/**
 * Which settings each kind reads. A setting a kind does not read is refused
 * rather than stored: settings are SEALED into the form definition, so a key
 * nothing reads would still be in the hash of every report filed against it.
 */
const SETTING_KEYS: Record<string, readonly string[]> = {
  short_text: ['maxLength'],
  long_text: ['maxLength'],
  place: ['options', 'allowOther'],
  location: ['scope'],
  choice_one: ['options'],
  choice_many: ['options'],
  number: ['min', 'max'],
};
const NEEDS_OPTIONS: ReadonlySet<string> = new Set(['choice_one', 'choice_many']);

function cleanOptions(raw: unknown, required: boolean): string[] {
  if (!Array.isArray(raw)) return required ? refuse('choice-options') : [];
  const out: string[] = [];
  for (const o of raw) {
    if (typeof o !== 'string' || !o.trim() || o.trim().length > 200)
      return refuse('choice-options');
    const t = o.trim();
    if (out.includes(t)) refuse('choice-options');
    out.push(t);
  }
  if (out.length > 200 || (required && !out.length)) refuse('choice-options');
  return out;
}

/** The type's defaults, overlaid with what the operator set, checked. */
export function settingsFor(kind: string, given: QuestionSettingsInput | undefined): FieldSettings {
  const allowed = SETTING_KEYS[kind] ?? [];
  const out: FieldSettings = { ...(fieldType(kind)?.settings ?? {}) };
  for (const [k, v] of Object.entries(given ?? {})) {
    if (v === undefined) continue;
    if (!allowed.includes(k)) refuse('setting-kind', `It was “${k}”.`);
    out[k] = v;
  }
  if ('maxLength' in out) {
    const n = out.maxLength;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100_000) refuse('max-length');
  }
  if (allowed.includes('options')) out.options = cleanOptions(out.options, NEEDS_OPTIONS.has(kind));
  if (kind === 'number') {
    const { min, max } = out;
    const ok = (v: unknown) =>
      v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v));
    if (!ok(min) || !ok(max) || (typeof min === 'number' && typeof max === 'number' && min > max)) {
      refuse('number-range');
    }
  }
  /* A LOCATION SCOPE THAT IS NOT ONE OF THE THREE is refused here rather than
     tolerated downstream. `scopeOf` falls back to the default for an unknown
     scope, which is right at answer time, but it means a typo on the way in
     would silently narrow a logbook meant for countries down to US states.
     The door is one-way, so this is the only moment it can be caught. */
  if (kind === LOCATION_TYPE && !(out.scope && LOCATION_SCOPES.includes(out.scope))) {
    refuse('location-scope');
  }
  return out;
}

const CONDITION_REFUSAL = {
  shape: 'shown-when-shape',
  'no-field': 'shown-when-no-field',
  'unknown-field': 'shown-when-unknown-field',
  kind: 'shown-when-kind',
  'no-values': 'shown-when-no-values',
  'unknown-value': 'shown-when-unknown-value',
} as const satisfies Record<string, RefusalCode>;

/**
 * WHEN A QUESTION IS ASKED, checked against the questions BEFORE it. A
 * condition may only look backwards, which is also what makes a cycle
 * impossible and lets the answer builder work in one pass.
 */
function conditionFor(
  kind: string,
  spec: unknown,
  earlier: readonly FieldDefinition[],
): Condition | null {
  const cond = normalizeCondition(spec, earlier);
  if (!cond.ok) {
    const unknown = cond.unknown?.length
      ? `Not on its list: ${cond.unknown.map((v) => `“${v}”`).join(', ')}.`
      : undefined;
    return refuse(CONDITION_REFUSAL[cond.reason], unknown);
  }
  if (cond.condition && CANNOT_CARRY_CONDITION.has(kind)) refuse('shown-when-unsupported-kind');
  return cond.condition;
}

/**
 * Every condition in a proposed question list still holds. Run after any
 * change that could break one from the outside: removing, reordering, or
 * changing the choices of a question somebody else's condition names. The
 * legacy module allowed all three and left questions that could never be
 * asked.
 */
function checkConditions(
  questions: readonly FieldDefinition[],
  code: RefusalCode = 'breaks-condition',
) {
  questions.forEach((q, i) => {
    if (!q.shown_when) return;
    const cond = normalizeCondition(q.shown_when, questions.slice(0, i));
    if (!cond.ok) refuse(code, `It is “${q.label}”.`);
  });
}

export interface QuestionSpec {
  kind: string;
  label: string;
  key?: string | undefined;
  help?: string | null | undefined;
  required?: boolean | undefined;
  filterable?: boolean | undefined;
  settings?: QuestionSettingsInput | undefined;
  shown_when?: unknown;
}

function checkLabel(label: string): string {
  const l = label.trim();
  if (l.length < 1 || l.length > 160) refuse('label');
  return l;
}

function checkHelp(help: string | null | undefined): string | null {
  const h = help?.trim() ? help.trim() : null;
  if (h && h.length > 1000) refuse('help');
  return h;
}

export async function addField(db: Db, logbookId: number, spec: QuestionSpec): Promise<Question> {
  return inTransaction(db, async (trx) => {
    const lb = await lock(trx, logbookId);

    // THE ONE THING A LAUNCHED LOGBOOK MAY DO. A required question after
    // launch is refused on the same ground as making one required: the
    // reports already filed did not answer it and never will.
    if (lb.launched_at && spec.required) refuse('launched-required');

    const kind = spec.kind;
    if (!isFieldKind(kind)) refuse('kind');
    const label = checkLabel(spec.label);
    const key = spec.key?.trim() ? spec.key.trim() : keyify(label);
    if (!KEY_RE.test(key)) refuse('key');

    const existing = await fieldsFor(trx, logbookId);
    if (kind === FILE_TYPE) {
      // NEVER REQUIRED: it seals no answer, so nothing could tell whether it
      // was satisfied. AT MOST ONE: the manifest files seal into is one list
      // per report, with nothing saying which question a file came from.
      if (spec.required) refuse('file-required');
      if (existing.some((f) => f.kind === FILE_TYPE)) refuse('file-exists');
    }
    if (existing.some((f) => f.key === key)) refuse('key-taken');

    const settings = settingsFor(kind, spec.settings);
    // A NEW OPTIONAL QUESTION ON A LAUNCHED LOGBOOK MAY HAVE A CONDITION:
    // nobody has been asked it yet, so there is nothing for one to invalidate.
    const shown_when = conditionFor(kind, spec.shown_when, toDefinitions(existing));
    // A filter flag on a type with no filter control would be a setting that
    // silently does nothing.
    const filterable = Boolean(spec.filterable) && canFilter(kind);

    let row: Selectable<LogbookFields>;
    try {
      row = await trx
        .insertInto('logbook_fields')
        .values({
          logbook_id: logbookId,
          key,
          kind,
          label,
          help: checkHelp(spec.help),
          required: Boolean(spec.required),
          filterable,
          settings: JSON.stringify(settings),
          // NULL, never an object, when there is none: the form definition
          // writes `shown_when` only when it applies.
          shown_when: shown_when ? JSON.stringify(shown_when) : null,
          position: existing.length ? Math.max(...existing.map((f) => f.position)) + 1 : 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (e) {
      if (isUniqueViolation(e)) refuse('key-taken');
      throw e;
    }
    // After launch the question set has a new version. Recorded now, so it
    // exists before anybody is asked it.
    if (lb.launched_at) await ensureFormVersion(trx, lb, await questionsFor(trx, logbookId));
    return presentQuestion(row);
  });
}

export interface QuestionChange {
  label?: string | undefined;
  help?: string | null | undefined;
  required?: boolean | undefined;
  filterable?: boolean | undefined;
  settings?: QuestionSettingsInput | undefined;
  shown_when?: unknown;
}

/**
 * Change a question. THE KEY AND THE KIND ARE NOT EDITABLE and are not
 * accepted: the key is what every answer is sealed under.
 *
 * After launch, the one thing that may change is whether it is a board
 * filter. That is delivery, not meaning: it is not in the form definition,
 * and the database's own guard leaves it out for the same reason.
 */
export async function updateField(
  db: Db,
  logbookId: number,
  fieldId: number,
  change: QuestionChange,
): Promise<Question> {
  return inTransaction(db, async (trx) => {
    const lb = await lock(trx, logbookId);
    const meaning = Object.entries(change).some(([k, v]) => k !== 'filterable' && v !== undefined);
    if (lb.launched_at && meaning) refuse('launched');

    const all = await fieldsFor(trx, logbookId);
    const index = all.findIndex((f) => f.id === fieldId);
    const current = all[index];
    if (!current) return refuse('no-field');

    const next: Question = { ...current };
    if (change.label !== undefined) next.label = checkLabel(change.label);
    if (change.help !== undefined) next.help = checkHelp(change.help);
    if (change.required !== undefined) {
      if (change.required && current.kind === FILE_TYPE) refuse('file-required');
      next.required = change.required;
    }
    if (change.filterable !== undefined)
      next.filterable = change.filterable && canFilter(current.kind);
    if (change.settings !== undefined) next.settings = settingsFor(current.kind, change.settings);
    // Checked against the questions before this one, which excludes the
    // question itself, so it cannot be made to depend on its own answer.
    if (change.shown_when !== undefined) {
      next.shown_when = conditionFor(
        current.kind,
        change.shown_when,
        toDefinitions(all.slice(0, index)),
      );
    }
    // A change to this question's choices could strand a later condition.
    checkConditions(toDefinitions(all.map((f) => (f.id === fieldId ? next : f))));

    const row = await trx
      .updateTable('logbook_fields')
      .set({
        label: next.label,
        help: next.help,
        required: next.required,
        filterable: next.filterable,
        settings: JSON.stringify(next.settings),
        shown_when: next.shown_when ? JSON.stringify(next.shown_when) : null,
      })
      .where('id', '=', fieldId)
      .where('logbook_id', '=', logbookId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return presentQuestion(row);
  });
}

export async function removeField(db: Db, logbookId: number, fieldId: number): Promise<void> {
  await inTransaction(db, async (trx) => {
    await assertDraft(trx, logbookId);
    const all = await fieldsFor(trx, logbookId);
    const target = all.find((f) => f.id === fieldId);
    if (!target) return refuse('no-field');
    const waiting = all.find((f) => f.shown_when?.field === target.key);
    if (waiting) refuse('depended-on', `It is “${waiting.label}”.`);
    await trx
      .deleteFrom('logbook_fields')
      .where('id', '=', fieldId)
      .where('logbook_id', '=', logbookId)
      .execute();
  });
}

/**
 * Put the questions in this order, all at once, so a half-applied order
 * cannot be left behind. Every question, each once: a partial list would
 * leave the rest wherever they happened to be.
 */
export async function reorderFields(
  db: Db,
  logbookId: number,
  ids: readonly number[],
): Promise<void> {
  await inTransaction(db, async (trx) => {
    await assertDraft(trx, logbookId);
    const all = await fieldsFor(trx, logbookId);
    const byId = new Map(all.map((f) => [f.id, f]));
    if (
      ids.length !== all.length ||
      new Set(ids).size !== ids.length ||
      !ids.every((id) => byId.has(id))
    ) {
      refuse('order');
    }
    const ordered = ids.map((id) => byId.get(id)).filter((f): f is Question => f !== undefined);
    checkConditions(toDefinitions(ordered), 'order-breaks-condition');
    for (const [position, id] of ids.entries()) {
      await trx.updateTable('logbook_fields').set({ position }).where('id', '=', id).execute();
    }
  });
}
