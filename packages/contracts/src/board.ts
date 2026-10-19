/**
 * The public board and the public read API (workstream D1).
 *
 * Everything here reads only what is published: approved by a moderator,
 * permitted by its reporter, not withdrawn, on a site that publishes an
 * archive. Behind the site password like the rest of the site (the board is
 * never a door).
 *
 * When the operator has switched the archive off, every read answers
 * `{ published: false, reason }` rather than a 404 or 403: the site has not
 * lost its archive and is not refusing this caller; it is saying, truthfully,
 * that it does not publish one.
 */
import { z } from 'zod';
import { FormQuestion } from './logbooks.ts';
import { defineRoute } from './route.ts';

const Timestamp = z.string();
const Answers = z.record(z.string(), z.unknown());
const RefParams = z.object({ ref: z.string().min(1).max(64) });

export const PublicationOff = z.object({ published: z.literal(false), reason: z.string() });

/** The archive's own statement about a report. Never its author: the byline is a house one. */
export const PublicNote = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('published'),
    body: z.string(),
    revised: z.boolean(),
    versions: z.number().int(),
    written_at: Timestamp,
  }),
  z.object({
    state: z.enum(['under_review', 'withdrawn']),
    notice: z.string(),
    revised: z.boolean(),
    written_at: Timestamp,
  }),
]);
export type PublicNote = z.infer<typeof PublicNote>;

export const PublicReport = z.object({
  public_ref: z.string(),
  received_at: Timestamp,
  logbook_slug: z.string(),
  logbook_title: z.string(),
  answers: Answers,
  /** This version corrects an earlier one in the same thread. */
  corrected: z.boolean(),
  chain_hash: z.string(),
  /** Public provenance: which organization it came through, never who typed it. */
  third_party: z
    .object({
      filed_via: z.string(),
      intake_method: z.string(),
      collected_on: z.string().optional(),
    })
    .optional(),
  editorial_note: PublicNote.optional(),
});
export type PublicReport = z.infer<typeof PublicReport>;

export const BoardLogbook = z.object({
  slug: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  /** Only the questions its maker marked as filters. Nothing is built in. */
  filters: z.array(FormQuestion),
});
export type BoardLogbook = z.infer<typeof BoardLogbook>;

export const getBoard = defineRoute({
  method: 'GET',
  path: '/api/board',
  summary:
    'What the board can be narrowed by: every launched logbook and its operator-chosen filters.',
  response: z.union([
    z.object({ published: z.literal(true), logbooks: z.array(BoardLogbook) }),
    PublicationOff,
  ]),
});

/**
 * The board's query. Besides these, `a.<question key>=<answer>` narrows by an
 * answer, accepted only with `logbook` and only for a question that logbook's
 * maker marked as a filter.
 */
export const BoardQuery = z
  .object({
    q: z.string().max(200).optional(),
    logbook: z.string().max(63).optional(),
    sort: z.enum(['newest', 'oldest']).optional(),
    page: z.coerce.number().int().min(1).max(10000).optional(),
  })
  .catchall(z.string().max(200));

export const listBoardReports = defineRoute({
  method: 'GET',
  path: '/api/board/reports',
  summary: 'Published reports, newest first. Search, logbook, and operator-chosen answer filters.',
  query: BoardQuery,
  response: z.union([
    z.object({
      published: z.literal(true),
      reports: z.array(PublicReport),
      total: z.number().int(),
      page: z.number().int(),
      page_size: z.number().int(),
    }),
    PublicationOff,
  ]),
});

export const PublicLink = z.object({
  id: z.number().int(),
  title: z.string(),
  publisher: z.string().nullable(),
  published_on: z.string().nullable(),
  url: z.string(),
});

export const getBoardReport = defineRoute({
  method: 'GET',
  path: '/api/board/reports/:ref',
  summary: 'One published report, with the archive’s note on it if there is one.',
  params: RefParams,
  response: z.union([
    z.object({ published: z.literal(true), report: PublicReport, links: z.array(PublicLink) }),
    PublicationOff,
  ]),
});

/** Not JSON: registered without a response schema. Listed so the path has one description. */
export const BOARD_CSV_PATH = '/api/board/reports.csv';

export const Stats = z.object({
  as_of: Timestamp,
  note: z.string(),
  confirmed_reports: z.object({
    by_disposition: z.object({
      published: z.number().int(),
      not_permitted: z.number().int(),
      under_review: z.number().int(),
      declined: z.number().int(),
      unclear: z.number().int(),
      withdrawn: z.number().int(),
    }),
    excludes: z.string(),
  }),
  published_reports: z.object({
    by_logbook: z.record(
      z.string(),
      z.object({
        title: z.string(),
        published: z.number().int(),
        by_question: z.record(
          z.string(),
          z.object({
            label: z.string(),
            counts: z.record(z.string(), z.number().int()),
            unanswered: z.number().int(),
          }),
        ),
      }),
    ),
  }),
});
export type Stats = z.infer<typeof Stats>;

export const getBoardStats = defineRoute({
  method: 'GET',
  path: '/api/board/stats',
  summary: 'The published counts, every one already broken out. No bare total.',
  response: z.union([Stats.extend({ published: z.literal(true) }), PublicationOff]),
});

export const Figure = z.object({
  id: z.string(),
  group: z.string(),
  label: z.string(),
  value: z.number(),
});

export const getFigures = defineRoute({
  method: 'GET',
  path: '/api/board/figures',
  summary: 'The figures an operator may put in their own wording, with their values now.',
  response: z.union([
    z.object({ published: z.literal(true), figures: z.array(Figure) }),
    PublicationOff,
  ]),
});

// ── the public API, version 1 ───────────────────────────────────────────

export const getPublicApi = defineRoute({
  method: 'GET',
  path: '/api/v1',
  summary: 'What the public API offers, and on what terms.',
  response: z.object({
    name: z.string(),
    version: z.literal(1),
    licence: z.object({ covers: z.string(), terms: z.string(), excludes: z.string() }),
    endpoints: z.record(z.string(), z.string()),
    stability: z.string(),
  }),
});

export const getPublicStats = defineRoute({
  method: 'GET',
  path: '/api/v1/stats',
  summary:
    'The published counts, for anybody to build on. Fields are added, never renamed or removed.',
  response: z.union([
    Stats.extend({ published: z.literal(true), api_version: z.literal(1), licence: z.string() }),
    PublicationOff.extend({ api_version: z.literal(1) }),
  ]),
});
