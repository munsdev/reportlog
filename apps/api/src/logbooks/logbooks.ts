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
import type { Cover, LogbookSummary, Question, QuestionSettingsInput } from '@reportlog/contracts';
import {
  CANNOT_CARRY_CONDITION,
  FILE_TYPE,
  LOCATION_SCOPES,
  LOCATION_TYPE,
  MAX_PRIVATE_LINKS,
  canFilter,
  cardProblem,
  fieldType,
  formAsksEmail,
  isFieldKind,
  isPublishedFreeText,
  LIMITED_KINDS,
  limitsOf,
  normalizeCondition,
  optionArray,
  withoutWording,
} from '@reportlog/fields';
import type { Condition, FieldDefinition, FieldSettings, Option } from '@reportlog/fields';
import { sql } from 'kysely';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { ensureFormVersion } from '../chain/forms.ts';
import { questionsFor } from '../chain/questions.ts';
import type { DB, LogbookFields } from '../db/schema.gen.ts';
import { coverOf } from '../site/cover.ts';
import { slugBlock } from '../site/slugs.ts';
import { LogbookRefusal, refuse } from './refusals.ts';
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
    'logbooks.files_frozen_at',
    'logbooks.outside_access',
    'logbooks.email_required',
    'logbooks.email_optional',
    'logbooks.accepts_notes',
    'logbooks.publish_by_terms',
    'logbooks.show_on_front',
    'logbooks.short_slug',
    'logbooks.cover',
    // What E1's email rule reads: each question's kind and settings.
    sql<{ kind: string; settings: FieldSettings | null }[] | null>`(
      SELECT json_agg(json_build_object('kind', f.kind, 'settings', f.settings))
        FROM logbook_fields f WHERE f.logbook_id = logbooks.id
    )`.as('question_shapes'),
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
    files_frozen_at: iso(row.files_frozen_at),
    outside_access: outsideAccess(row.outside_access),
    email_required: row.email_required,
    // NULL (every logbook that existed) is off (D21).
    email_optional: row.email_optional === true,
    // NULL (every logbook that existed) is off: the attached note and link
    // questions are not asked until an operator turns this on (N1).
    accepts_notes: row.accepts_notes === true,
    // DERIVED, like asks_for_files: a question somebody types into or files
    // ask for an address; the operator's switch can only add one (E1).
    // Erasable text and links do not oblige an address by themselves (D8):
    // the form asks for one only when the reporter wrote something.
    asks_email: formAsksEmail(
      (row.question_shapes ?? []).filter(
        (q) => q.kind !== 'private_text' && q.kind !== 'private_link',
      ),
      row.email_required,
    ),
    publish_by_terms: row.publish_by_terms,
    show_on_front: row.show_on_front,
    short_slug: row.short_slug,
    cover: coverOf(row.cover),
  };
}

/** The column's CHECK allows exactly these three; anything else reads as shut. */
function outsideAccess(v: string): LogbookSummary['outside_access'] {
  return v === 'link' || v === 'door' ? v : 'closed';
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

/** By slug, or by the short address an operator gave it. The answer carries the real slug. */
export async function logbookByAddress(db: Db, address: string): Promise<LogbookSummary | null> {
  const row = await summaries(db)
    .where((eb) =>
      eb.or([eb('logbooks.slug', '=', address), eb('logbooks.short_slug', '=', address)]),
    )
    .executeTakeFirst();
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
  const block = await slugBlock(db, slug, 'logbook');
  if (block) refuse(block === 'reserved' ? 'slug-reserved' : 'slug-taken');
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
  spec: {
    title?: string | undefined;
    blurb?: string | null | undefined;
    email_required?: boolean | undefined;
    email_optional?: boolean | undefined;
    accepts_notes?: boolean | undefined;
    publish_by_terms?: boolean | undefined;
    show_on_front?: boolean | undefined;
    short_slug?: string | null | undefined;
    cover?: Cover | null | undefined;
  },
): Promise<LogbookSummary> {
  const set: {
    title?: string;
    blurb?: string | null;
    email_required?: boolean;
    email_optional?: boolean;
    accepts_notes?: boolean;
    publish_by_terms?: boolean;
    show_on_front?: boolean;
    short_slug?: string | null;
    cover?: string | null;
    updated_at: Date;
  } = {
    updated_at: new Date(),
  };
  if (spec.title !== undefined) set.title = checkTitle(spec.title);
  if (spec.blurb !== undefined) set.blurb = blurbOf(spec.blurb);
  // Not part of the form and never sealed, so it stays changeable after
  // launch: it decides what the next report is asked (E1).
  if (spec.email_required !== undefined) set.email_required = spec.email_required;
  // The optional card, likewise: never sealed, changes only what the next
  // reporter is shown.
  if (spec.email_optional !== undefined) set.email_optional = spec.email_optional;
  // Whether the held questions are asked at all. A setting, not a question,
  // so it may change after launch; reports already filed sealed what they held.
  if (spec.accepts_notes !== undefined) set.accepts_notes = spec.accepts_notes;
  // The same, for publication: it changes what the next reporter is shown,
  // and every report already filed sealed the wording its reporter saw.
  if (spec.publish_by_terms !== undefined) set.publish_by_terms = spec.publish_by_terms;
  // Whether the front page advertises it. Presentation only, so it too stays
  // changeable after launch.
  if (spec.show_on_front !== undefined) set.show_on_front = spec.show_on_front;
  // The cover page is presentation, never sealed, so it stays changeable.
  if (spec.cover !== undefined) set.cover = spec.cover === null ? null : JSON.stringify(spec.cover);
  // The short address is a second name, never sealed, so it stays changeable.
  if (spec.short_slug !== undefined) {
    const s = (spec.short_slug ?? '').trim().toLowerCase();
    if (!s) set.short_slug = null;
    else {
      if (!SLUG_RE.test(s)) refuse('slug');
      const block = await slugBlock(db, s, 'logbook', id);
      if (block) refuse(block === 'reserved' ? 'slug-reserved' : 'slug-taken');
      set.short_slug = s;
    }
  }
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
    //
    // Its editorial-notes switch does not cascade (the moderation workstream's
    // table), and a draft made from a file or a starting point can have one.
    // It is a setting, not a record: a draft has no reports, so no notes.
    await trx.deleteFrom('logbook_editorial_notes').where('logbook_id', '=', id).execute();
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

/**
 * Freeze or unfreeze this logbook's uploads. A PROTECTIVE HANDLE, not the
 * everyday control: whether a logbook asks for files is whether it has an
 * upload question, and after launch that question cannot be removed. This
 * is for a running logbook that must stop taking files now, without
 * touching the form anybody is halfway through.
 *
 * NOT BEHIND assertDraft. It is not a question and nothing sealed reads it,
 * so it is allowed before and after launch, both ways. It stops NEW upload
 * slots (files/slots.ts, and a trigger on upload_slots) and hides nothing
 * already filed or published. A report without files is still taken.
 *
 * Freezing a frozen logbook keeps the first time: when somebody first pulled
 * the handle is the fact worth keeping.
 */
export async function setFilesFrozen(db: Db, id: number, frozen: boolean): Promise<LogbookSummary> {
  await inTransaction(db, async (trx) => {
    await lock(trx, id);
    await trx
      .updateTable('logbooks')
      .set({
        files_frozen_at: frozen ? sql<Date>`coalesce(files_frozen_at, now())` : null,
        updated_at: new Date(),
      })
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
const SHARED_KEYS = ['help_when', 'card_question', 'same_card'] as const;
const SETTING_KEYS: Record<string, readonly string[]> = {
  short_text: ['maxLength'],
  long_text: ['maxLength'],
  place: ['options', 'allowOther'],
  location: ['scope', 'depth', 'code', 'within'],
  choice_one: ['options', 'option_sets'],
  choice_many: ['options', 'option_sets'],
  number: ['min', 'max', 'integer', 'picker'],
  yes_no: ['checkbox'],
  // The earliest and latest answer taken (owner decision E4).
  date: ['earliest', 'latest'],
  time: ['earliest', 'latest'],
  datetime: ['earliest', 'latest'],
  // Held outside the report, erasable (packages/fields/src/held.ts).
  private_text: ['maxLength'],
  private_link: ['maxValues'],
};
const NEEDS_OPTIONS: ReadonlySet<string> = new Set(['choice_one', 'choice_many']);
const OPTION_CODE_RE = /^[a-z0-9][a-z0-9_]{0,62}$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A list of choices: all plain strings (each its own code, exactly as before
 * codes existed) or all `{ code, label }` pairs. Not a mix: a list whose
 * choices half have codes would be half rewordable after launch, and nobody
 * reading the builder could tell which half.
 */
function cleanOptions(raw: unknown, required: boolean): Option[] {
  if (!Array.isArray(raw)) return required ? refuse('choice-options') : [];
  if (raw.some((o) => isObj(o))) {
    const out: Option[] = [];
    for (const o of raw) {
      if (!isObj(o) || Object.keys(o).some((k) => k !== 'code' && k !== 'label'))
        return refuse('option-codes');
      const code = typeof o.code === 'string' ? o.code.trim() : '';
      const label = typeof o.label === 'string' ? o.label.trim() : '';
      if (!OPTION_CODE_RE.test(code) || !label || label.length > 200) refuse('option-codes');
      if (out.some((x) => typeof x !== 'string' && x.code === code)) refuse('option-codes');
      out.push({ code, label });
    }
    if (out.length > 200) refuse('choice-options');
    return out;
  }
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
  const allowed = [...(SETTING_KEYS[kind] ?? []), ...(kind === FILE_TYPE ? [] : SHARED_KEYS)];
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
  if ('maxValues' in out) {
    const n = out.maxValues;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_PRIVATE_LINKS)
      refuse('max-values');
  }
  /* OPTION SETS REPLACE THE LIST, so a question with them has no `options`
     key at all (not an empty one): one place says what is offered. Each
     set's `when` is checked against the earlier questions by `checkSettingConditions`,
     which needs the form around it. */
  if (out.option_sets !== undefined) {
    const sets: unknown = out.option_sets;
    if (
      !Array.isArray(sets) ||
      !sets.length ||
      sets.length > 20 ||
      (given?.options !== undefined && optionArray(given.options).length > 0)
    )
      refuse('option-sets');
    out.option_sets = sets.map((set: unknown) => {
      if (!isObj(set) || !isObj(set.when)) return refuse('option-sets');
      return { when: set.when as unknown as Condition, options: cleanOptions(set.options, true) };
    });
    delete out.options;
  } else if (allowed.includes('options')) {
    out.options = cleanOptions(out.options, NEEDS_OPTIONS.has(kind));
  }
  if (out.help_when !== undefined) {
    const helps: unknown = out.help_when;
    if (!Array.isArray(helps) || !helps.length || helps.length > 20) refuse('help-when');
    out.help_when = helps.map((h: unknown) => {
      const help = isObj(h) && typeof h.help === 'string' ? h.help.trim() : '';
      if (!isObj(h) || !isObj(h.when) || !help || help.length > 1000) return refuse('help-when');
      return { when: h.when as unknown as Condition, help };
    });
  }
  if (out.card_question !== undefined) {
    const q = typeof out.card_question === 'string' ? out.card_question.trim() : '';
    if (!q || q.length > 160) refuse('card-question');
    out.card_question = q;
  }
  // FLAGS ARE WRITTEN ONLY WHEN TRUE. Settings are sealed, and `false` is what
  // an absent flag already means, so storing it would make two sealed forms
  // for one behaviour.
  for (const flag of ['same_card', 'integer', 'checkbox'] as const) {
    if (out[flag] === undefined) continue;
    if (typeof out[flag] !== 'boolean') refuse('setting-kind', `It was “${flag}”.`);
    if (!out[flag]) Reflect.deleteProperty(out, flag);
  }
  if (kind === 'number') {
    const { min, max } = out;
    const ok = (v: unknown) =>
      v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v));
    if (!ok(min) || !ok(max) || (typeof min === 'number' && typeof max === 'number' && min > max)) {
      refuse('number-range');
    }
    // Read as unknown: settings arrive as JSON, whatever the type says.
    const picker: unknown = out.picker;
    if (
      picker !== undefined &&
      (picker !== 'hour' || out.integer !== true || min !== 0 || max !== 23)
    ) {
      refuse('number-picker');
    }
  }
  /* A DATE OR TIME LIMIT IS WRITTEN IN THE KIND'S OWN FORM (2026-11-03,
     07:00:00, or a UTC moment), the form an answer is sealed in, so the two
     compare as written. Only when set: settings are sealed into the form, and
     a question without limits must hash as it always did. A limit that is not
     a day, a time or a moment of the question's kind is refused, as is an
     earliest after the latest. Absent-key rule: an empty limit is no key. */
  if (LIMITED_KINDS.has(kind)) {
    for (const k of ['earliest', 'latest'] as const) {
      const v: unknown = out[k];
      if (v === undefined) continue;
      if (typeof v === 'string' && !v.trim()) {
        Reflect.deleteProperty(out, k);
        continue;
      }
      // A moment without its offset would mean whatever this server's clock says.
      if (
        kind === 'datetime' &&
        !(typeof v === 'string' && /(Z|[+-]\d{2}:?\d{2})$/i.test(v.trim()))
      )
        refuse('date-limits');
      const written = limitsOf(kind, { [k]: v })[k];
      if (written === undefined) refuse('date-limits');
      out[k] = written;
    }
    if (out.earliest !== undefined && out.latest !== undefined && out.earliest > out.latest)
      refuse('date-limits');
  }
  /* A LOCATION SCOPE THAT IS NOT ONE OF THE THREE is refused here rather than
     tolerated downstream. `scopeOf` falls back to the default for an unknown
     scope, which is right at answer time, but it means a typo on the way in
     would silently narrow a logbook meant for countries down to US states.
     The door is one-way, so this is the only moment it can be caught. */
  if (kind === LOCATION_TYPE && !(out.scope && LOCATION_SCOPES.includes(out.scope))) {
    refuse('location-scope');
  }
  /* DEPTH IS WRITTEN ONLY AS `county` (owner decision 44). Settings are
     sealed, and `state` is what an absent depth already means, so storing it
     would make two sealed forms for one behaviour. County is US-only: no
     outline data names a county anywhere else. */
  if (kind === LOCATION_TYPE && 'depth' in out) {
    // Read as unknown: settings arrive as JSON, whatever the type says.
    const depth: unknown = out.depth;
    if (depth === 'state') delete out.depth;
    else if (depth !== 'county' || out.scope !== 'us') refuse('location-depth');
  }
  /* HOW A PLACE IS WRITTEN. `postal` (AZ) for a US state, `fips` (04013) for a
     US county inside an earlier `postal` question (`within`, checked with the
     form around it). Absent is the hierarchical code every earlier form seals. */
  if (kind === LOCATION_TYPE && (out.code !== undefined || out.within !== undefined)) {
    const code: unknown = out.code;
    const fine =
      out.scope === 'us' &&
      ((code === 'postal' && out.depth === undefined && out.within === undefined) ||
        (code === 'fips' && out.depth === 'county' && typeof out.within === 'string'));
    if (!fine) refuse('location-code');
  }
  return out;
}

/**
 * The conditions inside a question's settings (its option sets, its help),
 * each checked and normalized against the questions before it, as a
 * `shown_when` is. Returns the settings with every `when` in its sealed order.
 */
function checkSettingConditions(
  settings: FieldSettings,
  earlier: readonly FieldDefinition[],
): FieldSettings {
  const norm = (when: unknown): Condition => {
    const c = normalizeCondition(when, earlier);
    if (!c.ok) return refuse(CONDITION_REFUSAL[c.reason]);
    return c.condition ?? refuse('shown-when-no-values');
  };
  const out: FieldSettings = { ...settings };
  if (Array.isArray(settings.option_sets)) {
    out.option_sets = settings.option_sets.map((s) => ({ ...s, when: norm(s.when) }));
  }
  if (Array.isArray(settings.help_when)) {
    out.help_when = settings.help_when.map((h) => ({ ...h, when: norm(h.when) }));
  }
  /* A COUNTY SITS INSIDE AN EARLIER STATE asked by postal code: that is what
     the server checks a county against. */
  if (settings.code === 'fips') {
    const state = earlier.find((f) => f.key === settings.within);
    if (state?.kind !== LOCATION_TYPE || state.settings?.code !== 'postal') refuse('location-code');
  }
  return out;
}

/**
 * Everything about a whole question list that no single question can say:
 * every condition still looks back at something that can be answered that
 * way, every county still has its state before it, and the cards are shaped
 * as cards may be (packages/fields/src/cards.ts).
 */
function checkForm(questions: readonly FieldDefinition[], code: RefusalCode = 'breaks-condition') {
  checkConditions(questions, code);
  questions.forEach((q, i) => {
    try {
      checkSettingConditions(q.settings ?? {}, questions.slice(0, i));
    } catch (e) {
      if (e instanceof LogbookRefusal) refuse(code, `It is “${q.label}”.`);
      throw e;
    }
  });
  if (cardProblem(questions)) refuse('card-shape');
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
    // Nothing a reporter types freely is published: a logbook may ask only the
    // held kinds. (Questions that already exist keep working; see updateField.)
    if (isPublishedFreeText({ kind, settings: settingsFor(kind, spec.settings) }))
      refuse('free-text');
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

    const settings = checkSettingConditions(
      settingsFor(kind, spec.settings),
      toDefinitions(existing),
    );
    // A NEW OPTIONAL QUESTION ON A LAUNCHED LOGBOOK MAY HAVE A CONDITION:
    // nobody has been asked it yet, so there is nothing for one to invalidate.
    const shown_when = conditionFor(kind, spec.shown_when, toDefinitions(existing));
    // Where it lands among the cards: last, so only its own shape can be wrong.
    if (
      cardProblem([
        ...toDefinitions(existing),
        { key, kind, label, settings, ...(shown_when ? { shown_when } : {}) },
      ])
    )
      refuse('card-shape');
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
    // AFTER LAUNCH, WORDING ONLY (ruling 48): its label, its help, and in its
    // settings only what `withoutWording` takes out. What it is asked under
    // (`required`, `shown_when`) is meaning, and refused outright.
    const meaning = change.required !== undefined || change.shown_when !== undefined;
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
    // Checked against the questions before this one, which excludes the
    // question itself, so it cannot be made to depend on its own answer.
    if (change.settings !== undefined) {
      next.settings = checkSettingConditions(
        settingsFor(current.kind, change.settings),
        toDefinitions(all.slice(0, index)),
      );
    }
    if (change.shown_when !== undefined) {
      next.shown_when = conditionFor(
        current.kind,
        change.shown_when,
        toDefinitions(all.slice(0, index)),
      );
    }
    if (
      lb.launched_at &&
      !sameJson(withoutWording(next.settings), withoutWording(current.settings))
    ) {
      refuse('launched-codes');
    }
    // A place may not be turned into an open box; one that already is may be
    // reworded (the Alert in the staff page says it stays published as typed).
    if (isPublishedFreeText(next) && !isPublishedFreeText(current)) refuse('free-text');
    // A change to this question's choices could strand a later condition.
    checkForm(toDefinitions(all.map((f) => (f.id === fieldId ? next : f))));

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
    // Reworded after launch: a new form version, recorded now, so the next
    // reporter is asked it and every earlier report keeps the one it answered.
    if (lb.launched_at) await ensureFormVersion(trx, lb, await questionsFor(trx, logbookId));
    return presentQuestion(row);
  });
}

/** Equal as JSON values, whatever order their keys came in. */
function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : isObj(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined)
              .map((k) => [k, canon(v[k])]),
          )
        : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

export async function removeField(db: Db, logbookId: number, fieldId: number): Promise<void> {
  await inTransaction(db, async (trx) => {
    await assertDraft(trx, logbookId);
    const all = await fieldsFor(trx, logbookId);
    const target = all.find((f) => f.id === fieldId);
    if (!target) return refuse('no-field');
    const waiting = all.find((f) => f.shown_when?.field === target.key);
    if (waiting) refuse('depended-on', `It is “${waiting.label}”.`);
    // Option sets, help and a county's state can hang on it too.
    try {
      checkForm(toDefinitions(all.filter((f) => f.id !== fieldId)));
    } catch (e) {
      if (e instanceof LogbookRefusal) refuse('depended-on');
      throw e;
    }
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
    checkForm(toDefinitions(ordered), 'order-breaks-condition');
    for (const [position, id] of ids.entries()) {
      await trx.updateTable('logbook_fields').set({ position }).where('id', '=', id).execute();
    }
  });
}
