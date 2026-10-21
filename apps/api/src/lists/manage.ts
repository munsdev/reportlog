/**
 * What an administrator does to a list: make one, change its switches, change
 * its questions, and remove one nobody has used.
 *
 * EVERY WRITE TO A LIST'S QUESTIONS GOES THROUGH `assertCollectable`, here and
 * not in a route, for the reason a logbook's one-way door is in its module: a
 * guard in a route is a guard the next route forgets.
 *
 * THERE IS NO ONE-WAY DOOR. A list seals nothing, so its questions can be
 * reworded, removed and reordered after entries arrive. A question's KEY is
 * fixed once it exists (the database says so too), because every stored
 * answer is filed under it.
 *
 * NOTHING HERE READS WHICH TEMPLATE MADE A LIST. A template is applied once
 * and is then over.
 */
import { FIELD_TYPES, isFieldKind } from '@reportlog/fields';
import type { FieldSettings } from '@reportlog/fields';
import { sql } from 'kysely';
import {
  FORBIDDEN_KINDS,
  FieldRuleError,
  assertCollectable,
  collectionRequirements,
  defaultRetention,
  optionsOf,
} from './fields.ts';
import type { ListField } from './fields.ts';
import { refuse } from './refusals.ts';
import { isRetention } from './retention.ts';
import type { Retention } from './retention.ts';
import { pendingCount } from './review.ts';
import { iso, isAccepting, listById } from './rows.ts';
import type { Db, LoadedList } from './rows.ts';
import { shippedTemplate, shippedTemplates } from './templates.ts';
import type { ListTemplate } from './templates.ts';

export const VISIBILITIES = ['hidden', 'password', 'listed'] as const;
export const OUTSIDE = ['closed', 'link', 'door'] as const;
export const EMAIL_MODES = ['auto', 'required'] as const;

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The shape the staff screens read. `requires_email` is DERIVED, every time. */
export function describe(list: LoadedList, now: Date = new Date()) {
  const req = collectionRequirements(list.fields);
  return {
    id: list.id,
    slug: list.slug,
    title: list.title,
    blurb: list.blurb,
    visibility: list.visibility as (typeof VISIBILITIES)[number],
    outside_access: list.outside_access as (typeof OUTSIDE)[number],
    email_mode: list.email_mode as (typeof EMAIL_MODES)[number],
    notify: list.notify,
    notify_email: list.notify_email,
    notify_pending_email: list.notify_pending_email,
    opens_at: iso(list.opens_at),
    closes_at: iso(list.closes_at),
    closed_at: iso(list.closed_at),
    accepting: isAccepting(list, now),
    aggregates_published: list.aggregates_published,
    requires_email: req.requiresEmail,
    personal_keys: req.personalKeys,
    countable_keys: req.aggregatableKeys,
    created_at: new Date(list.created_at).toISOString(),
    fields: list.fields.map((f) => ({
      id: f.id,
      key: f.key,
      kind: f.kind,
      label: f.label,
      help: f.help,
      required: f.required,
      settings: f.settings,
      max_values: f.max_values,
      aggregatable: f.aggregatable,
      retention: f.retention,
    })),
  };
}

export async function requireList(db: Db, id: number): Promise<LoadedList> {
  return (await listById(db, id)) ?? refuse('no-list');
}

/** Every list, with what the staff table shows beside it. */
export async function allLists(db: Db) {
  const rows = await db
    .selectFrom('lists')
    .select('id')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const out = [];
  for (const r of rows) {
    const list = await requireList(db, r.id);
    const counts = await db
      .selectFrom('list_entries')
      .select([
        sql<string>`count(*)`.as('received'),
        sql<string>`count(*) FILTER (WHERE review_state = 'received')`.as('waiting'),
      ])
      .where('list_id', '=', r.id)
      .executeTakeFirstOrThrow();
    out.push({
      ...describe(list),
      received: Number(counts.received),
      waiting: Number(counts.waiting),
    });
  }
  return out;
}

/** The kinds a list may ask: the one shared vocabulary, less the two that belong to a logbook. */
export function listKinds() {
  return FIELD_TYPES.filter((t) => !FORBIDDEN_KINDS.has(t.id)).map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
  }));
}

/** The shipped starting points, as the "make a list" screen offers them. */
export function templateChoices() {
  return shippedTemplates().map((t) => ({
    slug: t.slug,
    title: t.title,
    blurb: t.blurb,
    requires_email: t.requiresEmail,
    questions: t.fields.map((f) => f.label),
  }));
}

async function insertQuestions(
  db: Db,
  listId: number,
  fields: readonly (ListField & { retention: Retention })[],
) {
  for (const [position, f] of fields.entries()) {
    await db
      .insertInto('list_fields')
      .values({
        list_id: listId,
        key: f.key,
        kind: f.kind,
        label: f.label.trim(),
        help: f.help ?? null,
        required: f.required === true,
        position,
        settings: JSON.stringify(f.settings ?? {}),
        max_values: f.max_values ?? 1,
        aggregatable: f.aggregatable === true,
        retention: f.retention,
      })
      .execute();
  }
}

/**
 * Make a list from a template, optionally under another address and title (a
 * deployment running two check-in lists needs two addresses).
 *
 * A NEW LIST STARTS HIDDEN, and nobody outside reaches it until an
 * administrator says so. Making a list is not publishing one.
 */
export async function createFromTemplate(
  db: Db,
  templateSlug: string,
  { slug, title }: { slug?: string | undefined; title?: string | undefined } = {},
): Promise<LoadedList> {
  const t: ListTemplate | null = shippedTemplate(templateSlug);
  if (!t) return refuse('no-template');
  const useSlug = slug?.trim() ? slug.trim().toLowerCase() : t.slug;
  if (!SLUG.test(useSlug)) refuse('slug');
  const useTitle = title?.trim() ? title.trim() : t.title;
  if (useTitle.length > 120) refuse('title');

  // A caller already inside a transaction (a deployment template) keeps it,
  // so the list lands with everything else the caller writes, or not at all.
  const inTransaction = <T>(fn: (trx: Db) => Promise<T>): Promise<T> =>
    db.isTransaction ? fn(db) : db.transaction().execute(fn);
  const id = await inTransaction(async (trx) => {
    const taken = await trx
      .selectFrom('lists')
      .select('id')
      .where('slug', '=', useSlug)
      .executeTakeFirst();
    // Never over a live list: its form is editable, so re-applying a template
    // would silently discard an operator's edits.
    if (taken) refuse('slug-taken');
    const row = await trx
      .insertInto('lists')
      .values({
        slug: useSlug,
        title: useTitle,
        blurb: t.blurb,
        email_mode: t.email_mode,
        strict: t.strict,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await insertQuestions(trx, row.id, t.fields);
    return row.id;
  });
  return requireList(db, id);
}

export interface SettingsPatch {
  title?: string | undefined;
  blurb?: string | null | undefined;
  visibility?: string | undefined;
  outside_access?: string | undefined;
  email_mode?: string | undefined;
  notify?: boolean | undefined;
  aggregates_published?: boolean | undefined;
  closed?: boolean | undefined;
  opens_at?: string | null | undefined;
  closes_at?: string | null | undefined;
}

function when(v: string | null): Date | null {
  if (v === null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? refuse('when') : d;
}

/** A list's switches. Only what is named changes. */
export async function updateSettings(
  db: Db,
  id: number,
  patch: SettingsPatch,
): Promise<LoadedList> {
  const list = await requireList(db, id);
  const set: Record<string, unknown> = {};

  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t || t.length > 120) refuse('title');
    set.title = t;
  }
  if (patch.blurb !== undefined) {
    const b = (patch.blurb ?? '').trim();
    if (b.length > 1000) refuse('blurb');
    set.blurb = b || null;
  }
  const visibility = patch.visibility ?? list.visibility;
  if (patch.visibility !== undefined) {
    if (!VISIBILITIES.includes(patch.visibility as 'hidden')) refuse('visibility');
    set.visibility = patch.visibility;
  }
  // OPEN WITHOUT THE PASSWORD ONLY WHILE LISTED (the table's CHECK says so
  // too). Asking for both at once is refused in words; making a list hidden or
  // team-only closes the outside door with it, because the alternative is
  // refusing to hide something, which is the wrong way round.
  let outside = patch.outside_access ?? list.outside_access;
  if (patch.outside_access !== undefined && !OUTSIDE.includes(patch.outside_access as 'closed')) {
    refuse('outside');
  }
  if (visibility !== 'listed' && outside !== 'closed') {
    if (patch.outside_access !== undefined && patch.outside_access !== 'closed') {
      refuse('outside-needs-listed');
    }
    outside = 'closed';
  }
  if (outside !== list.outside_access) set.outside_access = outside;
  if (patch.email_mode !== undefined) {
    if (!EMAIL_MODES.includes(patch.email_mode as 'auto')) refuse('email-mode');
    set.email_mode = patch.email_mode;
  }
  if (patch.notify !== undefined) set.notify = patch.notify;
  if (patch.aggregates_published !== undefined) {
    set.aggregates_published = patch.aggregates_published;
  }
  // Only when the switch actually moves: saving a closed list's other
  // settings must not move the moment it was closed.
  if (patch.closed !== undefined && patch.closed !== (list.closed_at !== null)) {
    set.closed_at = patch.closed ? new Date() : null;
  }
  const opens = patch.opens_at !== undefined ? when(patch.opens_at) : list.opens_at;
  const closes = patch.closes_at !== undefined ? when(patch.closes_at) : list.closes_at;
  if (opens && closes && new Date(opens) >= new Date(closes)) refuse('schedule-order');
  if (patch.opens_at !== undefined) set.opens_at = opens;
  if (patch.closes_at !== undefined) set.closes_at = closes;

  if (Object.keys(set).length) {
    await db
      .updateTable('lists')
      .set({ ...set, updated_at: sql<Date>`now()` })
      .where('id', '=', list.id)
      .execute();
  }
  return requireList(db, list.id);
}

function settingsOf(raw: unknown): FieldSettings | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as FieldSettings)
    : null;
}

export interface QuestionInput {
  id?: number | null | undefined;
  key?: string | undefined;
  kind?: string | undefined;
  label?: string | undefined;
  help?: string | null | undefined;
  required?: boolean | undefined;
  settings?: Record<string, unknown> | null | undefined;
  max_values?: number | undefined;
  aggregatable?: boolean | undefined;
  retention?: string | undefined;
}

/**
 * Replace a list's questions with the set given, in the order given.
 *
 * WHOLE SET, ONE TRANSACTION. The rules are about the form as a whole (the
 * address requirement is derived from every question at once), so they are
 * checked against the set the administrator is about to have, never one
 * question at a time against a half-edited form.
 *
 * A known id keeps its row AND ITS KEY AND KIND, whatever was sent. No id is a
 * new question. A question left out is removed; its earlier answers stay where
 * they were filed, and removing the question that asked erases nothing.
 */
export async function replaceFields(
  db: Db,
  id: number,
  submitted: readonly QuestionInput[],
): Promise<LoadedList> {
  if (!submitted.length) refuse('no-fields');
  const list = await requireList(db, id);
  const byId = new Map(list.fields.map((f) => [f.id, f]));

  const fields = submitted.map((f, position) => {
    const prior = f.id !== undefined && f.id !== null ? byId.get(f.id) : undefined;
    if (f.id !== undefined && f.id !== null && !prior) refuse('no-field');
    const key = prior ? prior.key : (f.key ?? '').trim();
    const kind = prior ? prior.kind : (f.kind ?? '').trim();
    const settings = f.settings === undefined ? (prior?.settings ?? null) : settingsOf(f.settings);
    const retention = f.retention ?? prior?.retention ?? defaultRetention(kind);
    return {
      id: prior?.id ?? null,
      key,
      kind,
      label: (f.label ?? '').trim(),
      help: f.help?.trim() ? f.help.trim() : null,
      required: f.required === true,
      position,
      settings: settings ?? {},
      max_values: Math.min(
        Math.max(Math.floor(f.max_values ?? prior?.max_values ?? 1) || 1, 1),
        20,
      ),
      aggregatable: f.aggregatable === true,
      retention: retention as Retention,
    };
  });

  for (const f of fields) {
    if (!isRetention(f.retention))
      refuse('field-rule', `“${f.label || f.key}” has an unknown lifetime.`);
    if (f.label.length > 200) refuse('label');
    // An unknown kind would be saved (the rules treat it as personal, the safe
    // reading) and then refuse every answer anybody gave it. Refused here,
    // where the person who typed it can see why.
    if (!isFieldKind(f.kind)) refuse('kind', `There is no kind of question called “${f.kind}”.`);
    // A choice with nothing to choose from is a card nobody can answer.
    if ((f.kind === 'choice_one' || f.kind === 'choice_many') && !optionsOf(f).length) {
      refuse('options', `“${f.label || f.key}” has no options to choose from. Add at least one.`);
    }
  }

  let checked;
  try {
    // hasRequiredEmail is the DERIVED requirement, so the address clause holds
    // by construction; this is here for every other refusal in it.
    checked = assertCollectable(fields, {
      hasRequiredEmail: collectionRequirements(fields).requiresEmail,
    });
  } catch (e) {
    if (e instanceof FieldRuleError) refuse('field-rule', e.message);
    throw e;
  }

  await db.transaction().execute(async (trx) => {
    const keep = fields.flatMap((f) => (f.id === null ? [] : [f.id]));
    let gone = trx.deleteFrom('list_fields').where('list_id', '=', list.id);
    if (keep.length) gone = gone.where('id', 'not in', keep);
    await gone.execute();
    for (const [i, f] of checked.fields.entries()) {
      const row = fields[i];
      if (!row) continue;
      const values = {
        label: f.label,
        help: row.help,
        required: row.required,
        position: row.position,
        settings: JSON.stringify(row.settings),
        max_values: row.max_values,
        aggregatable: row.aggregatable,
        retention: f.retention,
      };
      if (row.id !== null) {
        await trx
          .updateTable('list_fields')
          .set({ ...values, updated_at: sql<Date>`now()` })
          .where('list_id', '=', list.id)
          .where('id', '=', row.id)
          .execute();
      } else {
        const taken = await trx
          .selectFrom('list_fields')
          .select('id')
          .where('list_id', '=', list.id)
          .where('key', '=', row.key)
          .executeTakeFirst();
        if (taken) refuse('key-taken');
        await trx
          .insertInto('list_fields')
          .values({ list_id: list.id, key: row.key, kind: row.kind, ...values })
          .execute();
      }
    }
    await trx
      .updateTable('lists')
      .set({ updated_at: sql<Date>`now()` })
      .where('id', '=', list.id)
      .execute();
  });
  return requireList(db, list.id);
}

/**
 * Remove a list, ONLY ONE NOBODY HAS USED. Deleting cascades to its entries,
 * links and erasure links, which would destroy what the format exists to keep
 * and break every erasure email already sent. The database refuses too.
 */
export async function deleteUnused(db: Db, id: number): Promise<{ deleted: string }> {
  const list = await requireList(db, id);
  const used = await db
    .selectFrom('list_entries')
    .select('id')
    .where('list_id', '=', list.id)
    .limit(1)
    .executeTakeFirst();
  if (used) refuse('has-entries');
  await db.deleteFrom('lists').where('id', '=', list.id).execute();
  return { deleted: list.slug };
}

/** Every list with how much is waiting, for the moderators. */
export async function reviewQueues(db: Db) {
  const rows = await db
    .selectFrom('lists')
    .select(['id', 'slug', 'title'])
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const out = [];
  for (const r of rows) out.push({ ...r, ...(await pendingCount(db, r.id)) });
  return out;
}

/**
 * The lists the front page offers: listed and taking entries, nothing else.
 * This module answers it for the front page's buttons, so the two can never
 * disagree about whether a list is open.
 */
export async function openListedLists(db: Db, now: Date = new Date()) {
  const rows = await db
    .selectFrom('lists')
    .select(['slug', 'title', 'blurb', 'opens_at', 'closes_at', 'closed_at', 'outside_access'])
    .where('visibility', '=', 'listed')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.filter((l) => isAccepting(l, now));
}

/** Buttons for the front page (`ButtonSources.lists` in the logbooks module). */
export async function listButtons(db: Db) {
  return (await openListedLists(db)).map((l) => ({
    ref: l.slug,
    label: l.title,
    href: `/list/${l.slug}`,
    blurb: l.blurb,
  }));
}

/**
 * What the password page offers: lists an administrator set to `door` that are
 * listed and taking entries. A `link` list works without the password too, but
 * is not shown; that is the whole difference between the two.
 */
export async function listDoors(db: Db) {
  return (await openListedLists(db))
    .filter((l) => l.outside_access === 'door')
    .map((l) => ({ kind: 'list' as const, slug: l.slug, title: l.title, href: `/list/${l.slug}` }));
}
