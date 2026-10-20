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
    z.object({
      published: z.literal(true),
      logbooks: z.array(BoardLogbook),
      /**
       * Whether the board may also be downloaded as a spreadsheet: the
       * distribution switch (decision 11), off until an administrator says yes.
       */
      downloads: z.boolean(),
    }),
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
    /**
     * Narrowed to one place a heat map reads, with fewer reports than the
     * map's threshold: no reports and no total, because either is the count
     * the map withholds (docs/decisions.md, decision 6).
     */
    z.object({
      published: z.literal(true),
      withheld: z.literal(true),
      threshold: z.number().int(),
      reason: z.string(),
    }),
    PublicationOff,
  ]),
});

export const getBoardReport = defineRoute({
  method: 'GET',
  path: '/api/board/reports/:ref',
  summary:
    'One published report, with the archive’s note on it if there is one. Editorial source links are staff-only (decision 37).',
  params: RefParams,
  response: z.union([
    z.object({ published: z.literal(true), report: PublicReport }),
    PublicationOff,
  ]),
});

/** Not JSON: registered without a response schema. Listed so the path has one description. */
export const BOARD_CSV_PATH = '/api/board/reports.csv';

export const Stats = z.object({
  as_of: Timestamp,
  note: z.string(),
  /** The line that goes beside every number (platform.ts NOT_A_SAMPLE). */
  not_a_sample: z.string(),
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
            /**
             * Present only for a place question a heat map reads, when some of
             * its areas are under the map's threshold. Those are named here
             * and absent from `counts`; `reports` is their sum only when there are two or
             * more, since one area's sum is its count. As the map does.
             */
            withheld: z
              .object({
                threshold: z.number().int(),
                areas: z.array(z.string()),
                reports: z.number().int().nullable(),
              })
              .optional(),
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

/**
 * One wording of the publication question, by the digest a report seals.
 * `introduced_by_role` is a role, never a person: this leaves the building.
 */
export const ConsentText = z.object({
  digest: z.string(),
  variant: z.string(),
  body: z.string(),
  introduced_by_role: z.string(),
  first_seen_at: Timestamp,
});
export type ConsentText = z.infer<typeof ConsentText>;

export const getPublicConsentTexts = defineRoute({
  method: 'GET',
  path: '/api/v1/consent-texts',
  summary:
    'Every wording of the publication question this site has shown, by digest, oldest first.',
  response: z.object({
    texts: z.array(ConsentText),
    api_version: z.literal(1),
    licence: z.string(),
  }),
});

// ── the press pack ──────────────────────────────────────────────────────

export const PressFile = z.object({
  /** What to ask for: `/api/press/<key>`. */
  key: z.string(),
  /** The name a downloaded copy is saved under, before its version is added. */
  name: z.string(),
  label: z.string(),
  blurb: z.string().nullable(),
  type: z.string(),
  /** Null when the file is listed but was not built: worth seeing, not hiding. */
  bytes: z.number().int().nullable(),
  /** Set when this file was built apart from the rest of the pack. */
  version: z.string().nullable(),
  note: z.string().nullable(),
});

export const getPressPack = defineRoute({
  method: 'GET',
  path: '/api/press',
  summary:
    "The deployment's own documents for press and reviewers, built ahead of time. ReportLog ships none.",
  response: z.object({
    /** none: no pack is built. unreadable: its manifest could not be read. */
    state: z.enum(['ready', 'none', 'unreadable']),
    version: z.string().nullable(),
    commit: z.string().nullable(),
    built_at: z.string().nullable(),
    files: z.array(PressFile),
    /** Documents carry numbers: the same line goes above them (platform.ts NOT_A_SAMPLE). */
    not_a_sample: z.string(),
  }),
});

/** One file of the pack, as a download. Not JSON, so not a contract. */
export const PRESS_FILE_PATH = '/api/press/:key';
