/**
 * The daily anchor and chain files (workstream D2).
 *
 * A chain file is checked with `checkChainFile` from @reportlog/seal, by
 * anybody, without this server. The schema below describes it loosely on
 * purpose where it carries sealed content: `hashed_fields` is exactly what
 * was hashed, and a schema that named its keys would strip one the day a
 * logbook gains an optional question.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

const Hex64 = z.string().regex(/^[a-f0-9]{64}$/);

export const ChainFileSchema = z.object({
  chain_file_format: z.number().int(),
  kind: z.enum(['complete', 'published']),
  logbook: z.string(),
  title: z.string().optional(),
  genesis: Hex64,
  chain_length: z.number().int(),
  exported_at: z.string().optional(),
  forms: z.array(z.object({ hash: Hex64, definition: z.string() })).optional(),
  how_to_check: z.string().optional(),
  anchors: z
    .array(
      z.object({
        date: z.string(),
        head: Hex64,
        reports: z.number().int(),
        root_chain_hash: Hex64.optional(),
        public_log_ref: z.string().nullable().optional(),
      }),
    )
    .optional(),
  reports: z
    .array(
      z.object({
        public_ref: z.string(),
        hashed_fields: z.record(z.string(), z.unknown()),
        content_hash: Hex64,
        prev_chain_hash: Hex64,
        chain_hash: Hex64,
      }),
    )
    .optional(),
});
export type ChainFileShape = z.infer<typeof ChainFileSchema>;

const SlugParams = z.object({ slug: z.string().min(1).max(64) });

export const getPublishedChainFile = defineRoute({
  method: 'GET',
  path: '/api/chain/:slug',
  summary:
    "A logbook's published reports as a chain file: each report's fingerprint and link checkable on its own.",
  params: SlugParams,
  response: ChainFileSchema,
});

export const getCompleteChainFile = defineRoute({
  method: 'GET',
  path: '/api/admin/chain/:slug',
  summary:
    'Every version of every report in a logbook, published or not, in chain order. Administrators only.',
  params: SlugParams,
  response: ChainFileSchema,
});

export const AnchorRun = z.object({
  outcome: z.enum(['published', 'partly_published', 'not_published', 'refused', 'failed']),
  anchor_date: z.string().nullable(),
  detail: z.string(),
  finished_at: z.string(),
});

export const getAnchorStatus = defineRoute({
  method: 'GET',
  path: '/api/admin/anchor',
  summary: 'Whether the daily anchor is running and reaching the transparency log.',
  response: z.object({
    health: z.object({
      status: z.enum(['ok', 'warn', 'fail']),
      detail: z.string(),
    }),
    anchors: z.array(
      z.object({
        date: z.string(),
        root_chain_hash: Hex64,
        public_log_ref: z.string().nullable(),
        logbooks: z.number().int(),
      }),
    ),
    runs: z.array(AnchorRun),
  }),
});

// ── backups and archive exports, for the owner (decision 10) ────────────

/**
 * One finished file on the server: a database backup (pg_dump) or an
 * archive export (every report replayable elsewhere). Named by the server,
 * and fetched only by that name.
 */
export const CopyFile = z.object({
  name: z.string(),
  bytes: z.number().int(),
  made_at: z.string(),
});
export type CopyFile = z.infer<typeof CopyFile>;

const CopyKind = z.enum(['backup', 'export']);

/** What is running now, or how the last one ended. Kept in memory: a restart forgets it. */
export const CopyJob = z.object({
  kind: CopyKind,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  /** Null while running. */
  ok: z.boolean().nullable(),
  /** One sentence: what happened, or why it did not. */
  summary: z.string().nullable(),
});

export const CopiesState = z.object({
  /** Null when this server has no backup settings it can use, with the reason. */
  unavailable: z.string().nullable(),
  backups: z.array(CopyFile),
  exports: z.array(CopyFile),
  backup_health: z.object({
    state: z.enum(['none', 'ok', 'stale']),
    max_age_hours: z.number(),
  }),
  /** The last off-site copy the backup job sent, if one is configured. */
  offsite: z.object({ at: z.string(), bytes: z.number().int() }).nullable(),
  /** The last backup that failed, from any start (the timer or this screen). */
  failure: z.object({ at: z.string(), step: z.string(), why: z.string() }).nullable(),
  running: CopyJob.nullable(),
  last: CopyJob.nullable(),
  /**
   * Restoring is done at the server's command line, never from a page: this
   * is the command, with this server's folder in it. Null when unavailable.
   */
  restore_command: z.string().nullable(),
});
export type CopiesState = z.infer<typeof CopiesState>;

export const getCopies = defineRoute({
  method: 'GET',
  path: '/api/admin/copies',
  summary:
    'Backups and archive exports on this server, and whether one is being made. The owner only.',
  response: CopiesState,
});

export const startCopy = defineRoute({
  method: 'POST',
  path: '/api/admin/copies',
  summary:
    'Start a backup or an archive export. One at a time; the screen asks again until it is done. The owner only.',
  body: z.object({ kind: CopyKind }),
  response: CopiesState,
});

/**
 * Not JSON: the file itself, streamed, registered without a response schema.
 * Each download is written to the audit trail before the first byte leaves.
 */
export const COPY_DOWNLOAD_PATH = '/api/admin/copies/:kind/:name';
export const copyDownloadPath = (kind: 'backup' | 'export', name: string) =>
  `/api/admin/copies/${kind}/${encodeURIComponent(name)}`;
