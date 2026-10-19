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
