/**
 * Written accounts (W4): what reporters wrote in their own words, and tip
 * descriptions, checked before a vetted journalist can read them.
 *
 * NOTHING HERE IS PUBLIC. Every route is for a moderator or an administrator
 * (who accepted the moderator agreement), except the two for the reporter
 * reading their own words. The words travel only in these responses, never in
 * a list that a public page, an export or the chain reads.
 *
 * AN ITEM IS NAMED BY A `ref` STRING, so a screen can put it in a URL:
 *   `report-<id>`      a report's text (report_values.id, the newest version)
 *   `tip-<entry>-<key>` a tip's long-text answer (list entry and question)
 * Treat it as opaque; take it from an item, never build one.
 *
 * The check applies to the WORDS, not to one row: a version that only adds
 * files keeps its clearance, and a correction that changes the words starts
 * again unchecked (gap report D2).
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

const Timestamp = z.string();
const ThreadParams = z.object({ threadId: z.uuid() });
const RefParams = z.object({ ref: z.string().min(3).max(120) });

/** `redacted` is "checked with redaction": journalists read the separate copy. */
export const TextOutcome = z.enum(['checked', 'redacted', 'withheld', 'illegal']);
export type TextOutcome = z.infer<typeof TextOutcome>;

/** The tabs of the queue. `illegal` is erased, so it has no tab, only a count of what was. */
export const TextFilter = z.enum(['waiting', 'checked', 'redacted', 'withheld']);
export type TextFilter = z.infer<typeof TextFilter>;

export const TextSource = z.enum(['report', 'tip']);

/** Who made and who reviewed the journalists' copy. Never the copy's words. */
export const TextRedactionInfo = z.object({
  redacted_by: z.string(),
  redacted_at: Timestamp,
  /** The moderator's reason, for the record. Never shown to a journalist. */
  reason: z.string(),
  reviewed_by: z.string().nullable(),
  reviewed_at: Timestamp.nullable(),
  review_verdict: z.enum(['approved', 'returned']).nullable(),
});
export type TextRedactionInfo = z.infer<typeof TextRedactionInfo>;

export const TextItem = z.object({
  ref: z.string(),
  source: TextSource,
  /** The words as written. Null only if they could not be opened. */
  text: z.string().nullable(),
  length: z.number().int(),
  outcome: TextOutcome.nullable(),
  checked_at: Timestamp.nullable(),
  checked_by: z.string().nullable(),
  /**
   * Whether journalists may read it if cleared: a report's reporter has
   * `journalist_sharing` granted NOW; a tip always. When false the only
   * choices are withheld and illegal, and the server refuses the others.
   */
  shared: z.boolean(),
  /** A report's public reference. Null for a tip. */
  reference: z.string().nullable(),
  /** The report's thread, to open its page. Null for a tip. */
  thread_id: z.string().nullable(),
  /** Where, as the report or tip said it: "Fulton County, Georgia". Null if it did not say. */
  place: z.string().nullable(),
  /** The logbook or list it came from. */
  form_title: z.string(),
  /** Whether the report's answers are public (it allows publishing). Always false for a tip. */
  answers_public: z.boolean(),
  received_at: Timestamp,
  redaction: TextRedactionInfo.nullable(),
});
export type TextItem = z.infer<typeof TextItem>;

export const TextCounts = z.object({
  waiting: z.number().int(),
  checked: z.number().int(),
  redacted: z.number().int(),
  withheld: z.number().int(),
});

export const listTexts = defineRoute({
  method: 'GET',
  path: '/api/moderation/texts',
  summary: 'The written accounts queue: report text and tip descriptions, by check.',
  query: z.object({
    filter: TextFilter.optional(),
    page: z.coerce.number().int().min(1).max(10000).optional(),
  }),
  response: z.object({
    filter: TextFilter,
    counts: TextCounts,
    items: z.array(TextItem),
    page: z.number().int(),
    pages: z.number().int(),
  }),
});
export const TEXT_PAGE_SIZE = 20;

export const TextHistoryItem = z.object({
  at: Timestamp,
  by: z.string(),
  kind: z.enum(['checked', 'redacted', 'withheld', 'illegal', 'review_approved', 'review_returned']),
  reason_category: z.string().nullable(),
});

export const getText = defineRoute({
  method: 'GET',
  path: '/api/moderation/texts/:ref',
  summary: 'One written account with the journalists’ copy (if there is one) and its history.',
  params: RefParams,
  response: z.object({
    item: TextItem,
    /** The journalists' copy, as saved. Null when there is none. */
    redacted: z.string().nullable(),
    history: z.array(TextHistoryItem),
  }),
});

/** The reasons a moderator can give for erasing words (a category, never a description). */
export const TEXT_ERASE_REASONS = [
  'child-sexual-abuse',
  'terrorist-content',
  'non-consensual-intimate-imagery',
  'incitement-or-threats',
  'other-illegal',
  'personal-data',
] as const;

export const checkText = defineRoute({
  method: 'POST',
  path: '/api/moderation/texts/:ref/check',
  summary:
    'Record a check: checked, withheld, or illegal (which erases the words now). Checked needs the reporter’s permission.',
  params: RefParams,
  body: z.object({
    outcome: z.string(),
    /** Required for "illegal": one of TEXT_ERASE_REASONS. */
    reason: z.string().optional(),
  }),
  response: z.object({ outcome: TextOutcome, erased: z.boolean() }),
});

export const redactText = defineRoute({
  method: 'POST',
  path: '/api/moderation/texts/:ref/redact',
  summary:
    'Save the copy journalists read, with what was removed marked in square brackets. Marks the item checked with redaction. The original is never changed.',
  params: RefParams,
  body: z.object({
    /** The copy. Parts removed are marked in square brackets, e.g. [name removed]. */
    body: z.string(),
    /** Why, for the record (1 to 500 characters). Never shown to a journalist. */
    why: z.string(),
  }),
  response: z.object({ outcome: z.literal('redacted') }),
});

export const reviewRedaction = defineRoute({
  method: 'POST',
  path: '/api/moderation/texts/:ref/review',
  summary:
    'Another moderator, or the owner, reviews a redacted copy: approved, or returned (the copy is deleted and the account waits again).',
  params: RefParams,
  body: z.object({ verdict: z.string() }),
  response: z.object({ verdict: z.enum(['approved', 'returned']) }),
});

// ── the moderator's report page ──────────────────────────────────────────

export const ReportLinkPanel = z.object({
  /** link_groups.id: the check is made once on the Links page, for every copy. */
  group_id: z.number().int().nullable(),
  url: z.string(),
  outcome: z.enum(['checked', 'withheld', 'illegal']).nullable(),
  /** Tips and other reports that sent the same address, besides this one. */
  also_tips: z.number().int(),
  also_reports: z.number().int(),
});

export const ErasedMarker = z.object({
  kind: z.enum(['private_text', 'private_link']),
  field_key: z.string(),
  erased_at: Timestamp,
});

export const getReportWritten = defineRoute({
  method: 'GET',
  path: '/api/moderation/reports/:threadId/written',
  summary: 'The written account and links of a report, for its page, and what was erased.',
  params: ThreadParams,
  response: z.object({
    /** The newest version's written accounts, with `shared` saying whether journalists may read them. */
    texts: z.array(TextItem),
    links: z.array(ReportLinkPanel),
    /** Tombstones: that something was erased, and when. Never what. */
    erased: z.array(ErasedMarker),
    shared: z.boolean(),
  }),
});

// ── the reporter reading their own words ────────────────────────────────

export const MyWritten = z.object({
  texts: z.array(
    z.object({
      field_key: z.string(),
      text: z.string(),
      /** Where the check stands, in words a reporter can read: no check yet, or one. */
      outcome: z.enum(['waiting', 'checked', 'redacted', 'withheld']),
      checked_at: Timestamp.nullable(),
    }),
  ),
  links: z.array(
    z.object({
      field_key: z.string(),
      url: z.string(),
      outcome: z.enum(['waiting', 'checked', 'withheld']),
      checked_at: Timestamp.nullable(),
    }),
  ),
  erased: z.array(ErasedMarker),
  /** `journalist_sharing`, now. */
  shared: z.boolean(),
});
export type MyWritten = z.infer<typeof MyWritten>;

export const getMyWritten = defineRoute({
  method: 'GET',
  path: '/api/mine/reports/:threadId/written',
  summary: 'What you wrote on one of your reports, where each check stands, and what was erased.',
  params: ThreadParams,
  response: MyWritten,
});

export const eraseMyWritten = defineRoute({
  method: 'POST',
  path: '/api/mine/reports/:threadId/written/erase',
  summary:
    'Erase the words and links of your report (all versions). The record keeps a marker that something was erased, and when. Cannot be undone.',
  params: ThreadParams,
  body: z.object({ confirm: z.literal(true) }),
  response: z.object({ erased: z.number().int() }),
});
