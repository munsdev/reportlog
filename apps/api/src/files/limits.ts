/**
 * Whether files are taken at all, which kinds, and how much.
 *
 * THREE LAYERS, narrowest wins:
 *
 *   the logbook   logbook_file_limits, NULL unless somebody set it
 *   the site      file_settings, NULL unless somebody set it
 *   shipped       SHIPPED below: what applies when nobody has said
 *
 * A layer that set nothing is INVISIBLE, never read as zero: a logbook nobody
 * configured behaves exactly as its site does.
 *
 * KINDS INTERSECT RATHER THAN OVERRIDE. Every other limit is a number and the
 * narrower one wins. A kind list is a set, and a logbook naming video on a
 * site with video switched off must not get video: the site's list is a
 * ceiling, so the result is the intersection.
 *
 * LIMITS ARE NOT QUESTIONS. They change no answer anybody gave, so they may
 * be set on a launched logbook; a cap that could only be set before launch
 * could never be corrected.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { KINDS, inKindOrder, isKind } from './kinds.ts';
import type { Kind } from './kinds.ts';

export interface Limits {
  maxImageBytes: number;
  maxVideoBytes: number;
  maxAudioBytes: number;
  maxDocumentBytes: number;
  maxVideoSeconds: number;
  maxDocumentPages: number;
  maxFiles: number;
  maxTotalBytes: number;
  kinds: Kind[];
}
export type LimitKey = Exclude<keyof Limits, 'kinds'>;

const MB = 1024 * 1024;

/** What every deployment runs on until somebody sets otherwise. */
export const SHIPPED: Readonly<Limits> = Object.freeze({
  maxImageBytes: 25 * MB,
  maxVideoBytes: 150 * MB,
  maxAudioBytes: 60 * MB,
  maxDocumentBytes: 30 * MB,
  maxVideoSeconds: 180,
  maxDocumentPages: 40,
  maxFiles: 10,
  maxTotalBytes: 400 * MB,
  kinds: [...KINDS],
});

export const shippedLimits = (): Limits => ({ ...SHIPPED, kinds: [...SHIPPED.kinds] });

/**
 * What an operator may set each limit to: the points past which something
 * else breaks. THE SAME BOUNDS AS THE CHECKS in migration
 * 20261019180938_files.sql; a test asks the database to accept each bound and
 * refuse one past it.
 */
export const LIMIT_RANGES = {
  maxImageBytes: { column: 'max_image_bytes', min: 65536, max: 2147483648 },
  maxVideoBytes: { column: 'max_video_bytes', min: 65536, max: 2147483648 },
  maxAudioBytes: { column: 'max_audio_bytes', min: 65536, max: 2147483648 },
  maxDocumentBytes: { column: 'max_document_bytes', min: 65536, max: 2147483648 },
  maxVideoSeconds: { column: 'max_video_seconds', min: 5, max: 3600 },
  maxDocumentPages: { column: 'max_document_pages', min: 1, max: 1000 },
  maxFiles: { column: 'max_files', min: 1, max: 50 },
  maxTotalBytes: { column: 'max_total_bytes', min: 1048576, max: 2147483648 },
} as const satisfies Record<LimitKey, { column: string; min: number; max: number }>;

export const LIMIT_KEYS = Object.keys(LIMIT_RANGES) as LimitKey[];

type Column = (typeof LIMIT_RANGES)[LimitKey]['column'];
type LayerRow = Record<Column, number | null> & { attachment_kinds: string[] | null };

/** What a layer stores: a value per key, NULL where it says nothing. */
export type LayerValues = Record<LimitKey, number | null> & { kinds: Kind[] | null };

const COLUMNS = LIMIT_KEYS.map((k) => LIMIT_RANGES[k].column);

function toLayer(row: LayerRow | undefined): LayerValues {
  const out = { kinds: null } as LayerValues;
  for (const key of LIMIT_KEYS) {
    const v = row ? row[LIMIT_RANGES[key].column] : null;
    out[key] = v ?? null;
  }
  out.kinds = row && Array.isArray(row.attachment_kinds) ? inKindOrder(row.attachment_kinds) : null;
  return out;
}

export async function siteLayer(
  db: Kysely<DB>,
): Promise<LayerValues & { enabled: boolean | null }> {
  const row = await db
    .selectFrom('file_settings')
    .select([...COLUMNS, 'attachment_kinds', 'attachments_enabled'])
    .where('id', '=', true)
    .executeTakeFirst();
  return { ...toLayer(row), enabled: row?.attachments_enabled ?? null };
}

export async function logbookLayer(db: Kysely<DB>, logbookId: number | null): Promise<LayerValues> {
  if (logbookId === null) return toLayer(undefined);
  const row = await db
    .selectFrom('logbook_file_limits')
    .select([...COLUMNS, 'attachment_kinds'])
    .where('logbook_id', '=', logbookId)
    .executeTakeFirst();
  return toLayer(row);
}

function resolveLimits(site: LayerValues, book: LayerValues): Limits {
  const out = shippedLimits();
  for (const key of LIMIT_KEYS) {
    const chosen = book[key] ?? site[key];
    if (chosen !== null) out[key] = chosen;
  }
  const ceiling = site.kinds ?? [...KINDS];
  out.kinds = KINDS.filter(
    (k) => ceiling.includes(k) && (book.kinds === null || book.kinds.includes(k)),
  );
  return out;
}

/** Every limit in force for a logbook, or for the site when none is named. */
export async function limitsFor(db: Kysely<DB>, logbookId: number | null): Promise<Limits> {
  return resolveLimits(await siteLayer(db), await logbookLayer(db, logbookId));
}

export type Source = 'logbook' | 'site' | 'shipped' | 'both';
export interface Layered<T> {
  logbook: T | null;
  site: T | null;
  shipped: T;
  effective: T;
  source: Source;
}

/**
 * EVERY LAYER'S OWN ANSWER, not just the one that won. Shown only the value in
 * force, an operator cannot tell a limit they set from one they inherited,
 * and the first thing they do is set all of them to what is showing, which
 * freezes the logbook against every later change to the site.
 */
export async function limitLayers(
  db: Kysely<DB>,
  logbookId: number | null,
): Promise<Record<LimitKey, Layered<number>> & { kinds: Layered<Kind[]> }> {
  const site = await siteLayer(db);
  const book = await logbookLayer(db, logbookId);
  const effective = resolveLimits(site, book);
  const out = {} as Record<LimitKey, Layered<number>> & { kinds: Layered<Kind[]> };
  for (const key of LIMIT_KEYS) {
    out[key] = {
      logbook: book[key],
      site: site[key],
      shipped: SHIPPED[key],
      effective: effective[key],
      source: book[key] !== null ? 'logbook' : site[key] !== null ? 'site' : 'shipped',
    };
  }
  out.kinds = {
    logbook: book.kinds,
    site: site.kinds,
    shipped: [...SHIPPED.kinds],
    effective: effective.kinds,
    // Kinds intersect, so when both named some neither layer owns the result.
    source:
      book.kinds && site.kinds ? 'both' : book.kinds ? 'logbook' : site.kinds ? 'site' : 'shipped',
  };
  return out;
}

export type LimitsInput = Partial<Record<LimitKey, unknown>> & { kinds?: unknown };
export type LimitValues = Partial<Record<LimitKey, number | null>> & { kinds?: Kind[] | null };

export type Validated =
  { ok: true; values: LimitValues } | { ok: false; reason: string; key?: string; message: string };

/**
 * Read limits an operator typed. Only the keys SENT come back: a key nobody
 * sent is not a key set to its default, and writing every column on every save
 * would quietly erase a layer the operator never touched.
 *
 * NULL CLEARS, and so does '' (an emptied number box). A 0 is refused, not a
 * clear: an operator aiming to unset a limit must not set the one value that
 * breaks the form.
 */
export function validateLimits(input: LimitsInput): Validated {
  const values: LimitValues = {};
  for (const key of LIMIT_KEYS) {
    if (!(key in input)) continue;
    const raw = input[key];
    if (raw === null || raw === '') {
      values[key] = null;
      continue;
    }
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    const r = LIMIT_RANGES[key];
    if (!Number.isInteger(n)) {
      return {
        ok: false,
        reason: 'limit-not-a-number',
        key,
        message: `${label(key)} must be a whole number.`,
      };
    }
    if (n < r.min || n > r.max) {
      return {
        ok: false,
        reason: 'limit-out-of-range',
        key,
        message: `${label(key)} must be between ${String(r.min)} and ${String(r.max)}.`,
      };
    }
    values[key] = n;
  }
  // Each CHECK passes on its own here, so nothing but this would catch it: a
  // form that accepts a file and then refuses the report carrying it.
  for (const per of [
    'maxImageBytes',
    'maxVideoBytes',
    'maxAudioBytes',
    'maxDocumentBytes',
  ] as const) {
    const total = values.maxTotalBytes;
    const one = values[per];
    if (typeof total === 'number' && typeof one === 'number' && total < one) {
      return {
        ok: false,
        reason: 'total-under-one-file',
        key: per,
        message: `The total for one report is smaller than ${label(per).toLowerCase()}: a file could be accepted and then the report refused.`,
      };
    }
  }
  if ('kinds' in input) {
    const raw = input.kinds;
    if (raw === null) values.kinds = null;
    else if (!Array.isArray(raw)) {
      return { ok: false, reason: 'kinds-shape', message: 'Kinds are a list.' };
    } else {
      // A name the code does not know is a typo, and would silently narrow a
      // logbook to nothing.
      const bad: unknown = (raw as unknown[]).find((k) => !isKind(k));
      if (bad !== undefined) {
        return {
          ok: false,
          reason: 'kinds-unknown',
          key: JSON.stringify(bad),
          message: `${JSON.stringify(bad)} is not a kind of file this site knows.`,
        };
      }
      // Empty is allowed: taking none is a real answer.
      values.kinds = inKindOrder(raw as string[]);
    }
  }
  return { ok: true, values };
}

function label(key: LimitKey): string {
  return {
    maxImageBytes: 'The largest photo',
    maxVideoBytes: 'The largest video',
    maxAudioBytes: 'The largest sound recording',
    maxDocumentBytes: 'The largest document',
    maxVideoSeconds: 'The longest video or recording',
    maxDocumentPages: 'The most pages in a document',
    maxFiles: 'The number of files',
    maxTotalBytes: 'The total for one report',
  }[key];
}

function columnsOf(values: LimitValues): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const key of LIMIT_KEYS) {
    if (key in values) set[LIMIT_RANGES[key].column] = values[key] ?? null;
  }
  if ('kinds' in values) set.attachment_kinds = values.kinds ?? null;
  return set;
}

/** Store the site's own limits. Only the keys sent are written. */
export async function setSiteLimits(
  db: Kysely<DB>,
  values: LimitValues & { enabled?: boolean | null },
  by: string | null = null,
): Promise<void> {
  const set = columnsOf(values);
  if ('enabled' in values) set.attachments_enabled = values.enabled ?? null;
  if (!Object.keys(set).length) return;
  await db
    .updateTable('file_settings')
    .set({ ...set, updated_by: by, updated_at: new Date() })
    .where('id', '=', true)
    .execute();
}

/** Store a logbook's own limits, launched or not. Only the keys sent are written. */
export async function setLogbookLimits(
  db: Kysely<DB>,
  logbookId: number,
  values: LimitValues,
): Promise<void> {
  const set = columnsOf(values);
  if (!Object.keys(set).length) return;
  await db
    .insertInto('logbook_file_limits')
    .values({ logbook_id: logbookId, ...set })
    .onConflict((oc) => oc.column('logbook_id').doUpdateSet({ ...set, updated_at: new Date() }))
    .execute();
}

/** The per-file ceiling for one kind under these limits. */
export function maxBytesForKind(kind: Kind, limits: Limits): number {
  if (kind === 'video') return limits.maxVideoBytes;
  if (kind === 'audio') return limits.maxAudioBytes;
  if (kind === 'document') return limits.maxDocumentBytes;
  return limits.maxImageBytes;
}

/** How many files and bytes one report in this logbook may carry. */
export async function capsFor(db: Kysely<DB>, logbookId: number | null) {
  const { maxFiles, maxTotalBytes } = await limitsFor(db, logbookId);
  return { maxFiles, maxTotalBytes };
}

/**
 * IS THE FEATURE ON. Storage being configured is never negotiable: nothing
 * an administrator presses conjures somewhere to put the files. Then the
 * administrator's own switch, and only where they have not used it, the
 * deployment's environment. A stored false beats an environment true.
 */
export function attachmentsEnabled(
  stored: boolean | null,
  deployment: { configured: boolean; envDefault: boolean },
): boolean {
  if (!deployment.configured) return false;
  if (stored === true || stored === false) return stored;
  return deployment.envDefault;
}
