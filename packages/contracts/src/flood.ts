/**
 * Plan E, session PE3: in the record and on the moderator screen.
 *
 *   - public: counts by place and time, arrival hours, declined reports by
 *     reason, whether intake is paused, and every switch use with its time;
 *   - moderators: the flood screen, bulk decline, tip links declined by time
 *     window, the pause and puzzle switches, organizations as a set;
 *   - administrators: "publish as counts only", per logbook;
 *   - organizations: intake links with a use limit and an off switch.
 *
 * Nothing public here carries a report's content or a reference: counts,
 * labels and times only.
 */
import { z } from 'zod';
import { PublicationOff } from './board.ts';
import { defineRoute } from './route.ts';

const Timestamp = z.string();
const ThreadId = z.uuid();
const Count = z.number().int().nonnegative();

/** Where a report came from, as the public is told. */
export const ORIGINS = ['organization', 'open_form'] as const;
export const Origin = z.enum(ORIGINS);
export type Origin = z.infer<typeof Origin>;

/** A count split by where the reports came from. */
export const ByOrigin = z.object({ organization: Count, open_form: Count });
export type ByOrigin = z.infer<typeof ByOrigin>;

// ── public: counts ──────────────────────────────────────────────────────

export const PlaceCount = ByOrigin.extend({
  /** The answer as sealed: `US-AZ`, or a county `US-AZ-04013`. */
  place: z.string(),
  label: z.string(),
});

export const LogbookCounts = z.object({
  slug: z.string(),
  title: z.string(),
  /** Its published reports are shown only as these counts, never one by one. */
  counts_only: z.boolean(),
  published: ByOrigin,
  /**
   * By place, for a counts-only logbook (empty otherwise: its reports show
   * their own place). An area under the logbook's small-area threshold (or a
   * heat map's, whichever is higher) is named without its count, in
   * `withheld_places`, never here.
   */
  by_place: z.array(PlaceCount),
  withheld_places: z
    .object({ threshold: Count, areas: z.array(z.string()), reports: Count.nullable() })
    .optional(),
  /** By the day they arrived (UTC), for a counts-only logbook. */
  by_day: z.array(ByOrigin.extend({ day: z.string() })),
  /** By the hour they arrived (UTC), every logbook: a burst looks like a burst. */
  by_hour: z.array(ByOrigin.extend({ hour: Timestamp })),
});
export type LogbookCounts = z.infer<typeof LogbookCounts>;

export const getPublicCounts = defineRoute({
  method: 'GET',
  path: '/api/board/counts',
  summary:
    'Published reports counted by where they came from, by place and by arrival time. Counts only.',
  response: z.union([
    z.object({
      published: z.literal(true),
      as_of: Timestamp,
      note: z.string(),
      /** The operator's words for each origin. */
      labels: z.object({ organization: z.string(), open_form: z.string() }),
      logbooks: z.array(LogbookCounts),
    }),
    PublicationOff,
  ]),
});

export const getDeclinedCounts = defineRoute({
  method: 'GET',
  path: '/api/board/declined',
  summary: 'How many reports a moderator declined, by the reason given. Counts only, no content.',
  response: z.union([
    z.object({
      published: z.literal(true),
      as_of: Timestamp,
      note: z.string(),
      logbooks: z.array(
        z.object({
          slug: z.string(),
          title: z.string(),
          by_reason: z.array(z.object({ code: z.string(), label: z.string(), reports: Count })),
        }),
      ),
    }),
    PublicationOff,
  ]),
});

// ── public: the switches ────────────────────────────────────────────────

export const SWITCHES = ['pause_intake', 'puzzle', 'counts_only', 'small_area'] as const;
export const SwitchName = z.enum(SWITCHES);
export const PUZZLE_LEVELS = ['normal', 'harder'] as const;
export const PuzzleLevel = z.enum(PUZZLE_LEVELS);
export type PuzzleLevel = z.infer<typeof PuzzleLevel>;

export const PublicSwitchUse = z.object({
  switch: SwitchName,
  value: z.string(),
  /** The logbook, for counts_only and small_area. */
  subject: z.string().nullable(),
  at: Timestamp,
});

export const IntakePause = z.object({
  paused: z.boolean(),
  since: Timestamp.nullable(),
  /** The sentence the forms and the site show while paused. */
  notice: z.string(),
});
export type IntakePause = z.infer<typeof IntakePause>;

/** In front of the password: the report and tip forms ask it on a door too. */
export const getIntakePause = defineRoute({
  method: 'GET',
  path: '/api/intake-pause',
  summary: 'Whether intake is paused, since when, and what the site says about it.',
  response: IntakePause,
});

export const getSwitchLog = defineRoute({
  method: 'GET',
  path: '/api/board/switches',
  summary: 'Every use of the flood switches and the counts-only setting, with its time.',
  response: z.object({ pause: IntakePause, puzzle: PuzzleLevel, uses: z.array(PublicSwitchUse) }),
});

// ── moderators: the flood screen ────────────────────────────────────────

/** Reports by where they stand. Staff only. */
export const StaffTotals = z.object({
  received: Count,
  accepted: Count,
  declined: Count,
  /** Not yet decided, or marked unclear. */
  waiting: Count,
  withdrawn: Count,
});

export const getFloodScreen = defineRoute({
  method: 'GET',
  path: '/api/moderation/flood',
  summary:
    'Submissions per hour for 24 hours (reports and tips), refusals per hour by check, and identical answer sets.',
  response: z.object({
    since: Timestamp,
    hours: z.array(z.object({ hour: Timestamp, reports: Count, tips: Count })),
    checks: z.array(z.string()),
    refusals: z.array(z.object({ hour: Timestamp, check: z.string(), refusals: Count })),
    /** Answer sets more than one report in 24 hours shares, largest first. */
    identical: z.array(
      z.object({
        answer_set: z.string(),
        logbook_slug: z.string(),
        reports: Count,
        pending: Count,
        first_at: Timestamp,
        last_at: Timestamp,
      }),
    ),
    pause: IntakePause,
    puzzle: PuzzleLevel,
    /**
     * Every report filed, by where it stands now: staff only, never public
     * for what is not accepted (decision 36). `received` is every thread;
     * the other four add up to it.
     */
    totals: z.object({
      all: StaffTotals,
      by_logbook: z.array(StaffTotals.extend({ slug: z.string(), title: z.string() })),
      /** Sent and not yet confirmed by the emailed link, unexpired. */
      unconfirmed: Count,
    }),
  }),
});

export const MAX_BULK = 500;

export const bulkDeclineReports = defineRoute({
  method: 'POST',
  path: '/api/moderation/reports/bulk-decline',
  summary:
    'Decline many reports with one reason. One decision is recorded per report, with who and when; no email is sent.',
  body: z.object({
    thread_ids: z.array(ThreadId).min(1).max(MAX_BULK),
    reason_code: z.string(),
    comment: z.string().max(2000).optional(),
    /** The queue filter that showed them, kept with the record. */
    filter: z.record(z.string(), z.string()).optional(),
  }),
  response: z.object({
    bulk_id: z.number().int(),
    declined: z.array(ThreadId),
    skipped: z.array(z.object({ thread_id: ThreadId, why: z.string() })),
  }),
});

export const bulkDeclineLinks = defineRoute({
  method: 'POST',
  path: '/api/moderation/links/bulk-decline',
  summary:
    'Withhold every unchecked tip link that arrived in a time window. One check is recorded per link group.',
  body: z.object({ from: Timestamp, to: Timestamp }),
  response: z.object({ bulk_id: z.number().int(), withheld: Count }),
});

export const SwitchState = z.object({
  pause: IntakePause,
  puzzle: PuzzleLevel,
  /** Staff see who. */
  uses: z.array(PublicSwitchUse.extend({ by: z.string() })),
});

export const getSwitches = defineRoute({
  method: 'GET',
  path: '/api/moderation/switches',
  summary: 'The flood switches as they stand, and every use with who and when.',
  response: SwitchState,
});

export const setIntakePause = defineRoute({
  method: 'POST',
  path: '/api/moderation/switches/pause',
  summary: 'Pause intake (both forms refuse and a public notice appears), or take it back.',
  body: z.object({ paused: z.boolean() }),
  response: SwitchState,
});

export const setPuzzleLevel = defineRoute({
  method: 'POST',
  path: '/api/moderation/switches/puzzle',
  summary: 'Make the proof of work harder, or put it back.',
  body: z.object({ level: PuzzleLevel }),
  response: SwitchState,
});

export const listOrganizationLane = defineRoute({
  method: 'GET',
  path: '/api/moderation/organizations',
  summary: 'Each organization with reports in the queue, so its reports can be handled as a set.',
  response: z.object({
    organizations: z.array(
      z.object({ id: z.number().int(), name: z.string(), reports: Count, pending: Count }),
    ),
  }),
});

// ── administrators: counts only ─────────────────────────────────────────

/**
 * THE SMALL-AREA THRESHOLD of a counts-only logbook (Plan E, PE4): a place
 * with fewer published reports than this is sent without its count. The
 * floor is the heat maps' (`MIN_AREA_FLOOR`), and the database has the same
 * CHECK; the default is the floor.
 */
export const SMALL_AREA_FLOOR = 2;
export const SMALL_AREA_DEFAULT = 2;
export const SMALL_AREA_MAX = 100_000;

export const listCountsOnly = defineRoute({
  method: 'GET',
  path: '/api/admin/moderation/counts-only',
  summary:
    'Each launched logbook, whether it publishes as counts only, and its small-area threshold.',
  response: z.object({
    logbooks: z.array(
      z.object({
        slug: z.string(),
        title: z.string(),
        counts_only: z.boolean(),
        small_area: z.number().int(),
      }),
    ),
  }),
});

export const setSmallArea = defineRoute({
  method: 'PUT',
  path: '/api/admin/moderation/logbooks/:slug/small-area',
  summary:
    'The smallest count a place may be published with while this logbook is counts only. Below it, the place is named without its count.',
  params: z.object({ slug: z.string().min(1).max(63) }),
  /** Checked on the server, so a value below the floor is refused in a sentence. */
  body: z.object({ small_area: z.number() }),
  response: z.object({ slug: z.string(), small_area: z.number().int() }),
});

export const setCountsOnly = defineRoute({
  method: 'PUT',
  path: '/api/admin/moderation/logbooks/:slug/counts-only',
  summary: "Publish this logbook's accepted reports as counts only, or as entries.",
  params: z.object({ slug: z.string().min(1).max(63) }),
  body: z.object({ counts_only: z.boolean() }),
  response: z.object({ slug: z.string(), counts_only: z.boolean() }),
});

// ── organization intake links ───────────────────────────────────────────

const Id = z.string().regex(/^[1-9]\d{0,15}$/);
const OrgParams = z.object({ id: Id });

export const IntakeLink = z.object({
  id: z.number().int(),
  label: z.string(),
  max_uses: z.number().int(),
  uses: Count,
  created_by: z.string(),
  created_at: Timestamp,
  disabled_at: Timestamp.nullable(),
});
export type IntakeLink = z.infer<typeof IntakeLink>;

export const listIntakeLinks = defineRoute({
  method: 'GET',
  path: '/api/orgs/:id/intake-links',
  summary: "An organization's intake links, with how often each was used. Never the link itself.",
  params: OrgParams,
  response: z.object({ links: z.array(IntakeLink) }),
});

export const createIntakeLink = defineRoute({
  method: 'POST',
  path: '/api/orgs/:id/intake-links',
  summary: 'Make an intake link: whoever opens it, signed in, joins as a coordinator.',
  params: OrgParams,
  body: z.object({ label: z.string().max(120), max_uses: z.number().int().min(1).max(10000) }),
  /** The link is shown this once. */
  response: z.object({ link: IntakeLink, url: z.string() }),
});

export const disableIntakeLink = defineRoute({
  method: 'POST',
  path: '/api/orgs/:id/intake-links/:linkId/off',
  summary: 'Switch an intake link off, for good.',
  params: z.object({ id: Id, linkId: Id }),
  response: z.object({ link: IntakeLink }),
});

const TokenParams = z.object({ token: z.string().min(1).max(128) });

export const describeIntakeLink = defineRoute({
  method: 'GET',
  path: '/api/intake-links/:token',
  summary: 'Which organization an intake link joins, and whether it still works.',
  params: TokenParams,
  response: z.object({ organization: z.string(), usable: z.boolean(), why: z.string().nullable() }),
});

export const joinByIntakeLink = defineRoute({
  method: 'POST',
  path: '/api/intake-links/:token/join',
  summary: 'Join the organization as a coordinator. Signed in.',
  params: TokenParams,
  response: z.object({
    organization_id: z.number().int(),
    organization: z.string(),
    already_member: z.boolean(),
  }),
});
