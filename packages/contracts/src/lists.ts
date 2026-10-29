/**
 * Lists (workstream E): the second format, beside logbooks.
 *
 * FOUR AUDIENCES, and the split is the security model:
 *
 *   /api/lists/…        a visitor: the form, and published counts. Each list
 *                       decides for itself whether the site password applies.
 *   /api/admin/lists    administrators: make and change lists.
 *   /api/list-review    moderators and administrators: bulk review.
 *   /api/forget/:token  the erasure link from an email. Plain HTML, not here:
 *                       it is not called by the website.
 *
 * NOTHING HERE RETURNS WHAT SOMEBODY WROTE TO ANYBODY BUT A MODERATOR. The
 * only public read of entries is a count, over questions an operator ticked,
 * on a list that is listed and whose counts an operator published.
 *
 * Request bodies are typed loosely on purpose: the module refuses with a
 * sentence a person can read, and a schema error would refuse first with one
 * they cannot.
 */
import { z } from 'zod';
import { Cover } from './cover.ts';
import { defineRoute } from './route.ts';
import { DoorFields } from './door.ts';

const Id = z.coerce.number().int().positive();
const Timestamp = z.string();

export const ListVisibility = z.enum(['hidden', 'password', 'listed']);
export type ListVisibility = z.infer<typeof ListVisibility>;
export const ListOutsideAccess = z.enum(['closed', 'link', 'door']);
export type ListOutsideAccess = z.infer<typeof ListOutsideAccess>;
export const ListEmailMode = z.enum(['auto', 'required']);
export type ListEmailMode = z.infer<typeof ListEmailMode>;
export const Retention = z.enum(['absent', 'transient', 'durable']);
export type Retention = z.infer<typeof Retention>;
export const ReviewState = z.enum(['received', 'approved', 'rejected']);
export type ReviewState = z.infer<typeof ReviewState>;
export const TriageState = z.enum(['new', 'triaged', 'actioned', 'closed']);
export type TriageState = z.infer<typeof TriageState>;

/** One stored answer: the shapes @reportlog/fields normalizes to. */
export const ListAnswer = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export const ListAnswers = z.record(z.string(), ListAnswer);

// ── the visitor's form ──────────────────────────────────────────────────

/** A question as the visitor's form needs it, and nothing of the operator's. */
export const ListFormQuestion = z.object({
  key: z.string(),
  kind: z.string(),
  label: z.string(),
  help: z.string().nullable(),
  required: z.boolean(),
  max_values: z.number().int(),
  /** The codes offered, which is what is sent and kept. A plain option is its own code. */
  options: z.array(z.string()),
  /** The words for each of `options`, in order. Only when some option has a code. */
  option_labels: z.array(z.string()).optional(),
  /** On a link question asking what kind each link is: the kinds, and every row shown. */
  link_types: z.array(z.object({ code: z.string(), label: z.string() })).optional(),
  fixed_rows: z.boolean().optional(),
  /** On a date, time or date-and-time question: its earliest and latest answer (E4). */
  earliest: z.string().optional(),
  latest: z.string().optional(),
  allow_other: z.boolean(),
  /** The places a location question offers. Only on a location question. */
  places: z.array(z.object({ code: z.string(), name: z.string() })).optional(),
  /** Present, as `county`, when the state is followed by a county picker. */
  depth: z.literal('county').optional(),
  /** Whether this answer is erased on the timer. The card says so. */
  erased: z.boolean(),
});
export type ListFormQuestion = z.infer<typeof ListFormQuestion>;

export const ListForm = z.object({
  slug: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  /** The cover page (decision 78); absent where there is none. */
  cover: Cover.optional(),
  accepting: z.boolean(),
  opens_at: Timestamp.nullable(),
  closes_at: Timestamp.nullable(),
  /** Whether the form shows an address card at all. Derived, never stored. */
  asks_email: z.boolean(),
  /**
   * WHEN an address is needed, so the form can say the true reason:
   * always (everybody), if-written (only somebody who wrote something),
   * never (nothing here is about a person).
   */
  email_when: z.enum(['always', 'if-written', 'never']),
  /** WHY: so the site can reply, or so the person can have it deleted. */
  email_reason: z.enum(['reply', 'erase']),
  /** The list's "We'll write back" switch: the form says the team will use the address to reply. */
  write_back: z.boolean(),
  personal_keys: z.array(z.string()),
  /** How long the personal half is kept, in days; null when only the link erases it. */
  personal_days: z.number().int().nullable(),
  fields: z.array(ListFormQuestion),
});
export type ListForm = z.infer<typeof ListForm>;

const SlugParams = z.object({ slug: z.string() });

export const listOpenLists = defineRoute({
  method: 'GET',
  path: '/api/lists',
  summary: 'The lists taking entries that anybody past the site password may see.',
  response: z.object({
    lists: z.array(
      z.object({
        slug: z.string(),
        title: z.string(),
        blurb: z.string().nullable(),
        /** Shown on Get involved. */
        on_get_involved: z.boolean(),
        /** The site's contact form: the footer, the menu, About and the terms link to it. */
        is_contact: z.boolean(),
      }),
    ),
  }),
});

export const getListForm = defineRoute({
  method: 'GET',
  path: '/api/lists/:slug',
  summary: "A list's form. A list somebody may not see is 404, never 403.",
  params: SlugParams,
  response: ListForm,
});

export const ValueCount = z.object({
  value: z.string(),
  received: z.number().int(),
  approved: z.number().int(),
});

export const FieldCounts = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.string(),
  values: z.array(ValueCount),
});
export type FieldCounts = z.infer<typeof FieldCounts>;

/** The questions a count was computed under. A list's form is editable, so this travels with it. */
export const CountDefinition = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.string(),
  options: z.array(z.string()).nullable(),
});

export const ListTotals = z.object({
  received: z.number().int(),
  approved: z.number().int(),
  last_entry: Timestamp.nullable(),
});

export const ListCounts = z.object({
  slug: z.string(),
  title: z.string(),
  /** Received AND approved, always both. */
  totals: ListTotals,
  definition: z.array(CountDefinition),
  fields: z.array(FieldCounts),
  /** The line that goes beside every number (platform.ts NOT_A_SAMPLE). */
  not_a_sample: z.string(),
});
export type ListCounts = z.infer<typeof ListCounts>;

export const getListCounts = defineRoute({
  method: 'GET',
  path: '/api/lists/:slug/counts',
  summary: 'Published counts: only a listed list whose counts an administrator published.',
  params: SlugParams,
  response: ListCounts,
});

export const sendListEntry = defineRoute({
  method: 'POST',
  path: '/api/lists/:slug/entries',
  summary: 'Send one entry. Nothing sent here is published.',
  params: SlugParams,
  body: z.object({
    answers: z.record(z.string(), z.unknown()).optional(),
    email: z.string().nullable().optional(),
    email_consent: z.boolean().optional(),
    /** The door's fields (door.ts): the hidden box, the start token, the puzzle. */
    ...DoorFields,
  }),
  response: z.object({
    ok: z.literal(true),
    /** Whether an erasure link was emailed. */
    erasure_mailed: z.boolean(),
    /** Whether anything in it can be erased. */
    erasable: z.boolean(),
  }),
});

// ── administrators: making and changing lists ──────────────────────────

export const ListQuestion = z.object({
  id: z.number().int(),
  key: z.string(),
  kind: z.string(),
  label: z.string(),
  help: z.string().nullable(),
  required: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
  max_values: z.number().int(),
  aggregatable: z.boolean(),
  retention: Retention,
});
export type ListQuestion = z.infer<typeof ListQuestion>;

export const ListDetail = z.object({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  cover: Cover.nullable().optional(),
  visibility: ListVisibility,
  outside_access: ListOutsideAccess,
  email_mode: ListEmailMode,
  /** "We'll write back": reviewers may open an entry's address, and the form says so. */
  write_back: z.boolean(),
  /** Whether the front page advertises it while it is open. */
  show_on_front: z.boolean(),
  /** Whether Get involved shows it while it is open. */
  on_get_involved: z.boolean(),
  /** Whether it is the site's contact form (one list at most). */
  is_contact: z.boolean(),
  notify: z.boolean(),
  notify_email: z.string().nullable(),
  notify_pending_email: z.string().nullable(),
  opens_at: Timestamp.nullable(),
  closes_at: Timestamp.nullable(),
  closed_at: Timestamp.nullable(),
  accepting: z.boolean(),
  aggregates_published: z.boolean(),
  /** Derived from the questions every time, never stored. */
  requires_email: z.boolean(),
  personal_keys: z.array(z.string()),
  countable_keys: z.array(z.string()),
  created_at: Timestamp,
  fields: z.array(ListQuestion),
});
export type ListDetail = z.infer<typeof ListDetail>;

export const ListSummary = ListDetail.extend({
  received: z.number().int(),
  waiting: z.number().int(),
});
export type ListSummary = z.infer<typeof ListSummary>;

export const ListTemplateChoice = z.object({
  slug: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  requires_email: z.boolean(),
  questions: z.array(z.string()),
});
export type ListTemplateChoice = z.infer<typeof ListTemplateChoice>;

export const ListSummaryCounts = z.object({
  totals: ListTotals.extend({ rejected: z.number().int() }),
  definition: z.array(CountDefinition),
  fields: z.array(FieldCounts),
});

export const ListAdminDetail = ListDetail.extend({
  /** Where entries go when the list names no address of its own. */
  admin_email: z.string().nullable(),
  /** Counts beside the form, for the administrator. Internal, not publication. */
  summary: ListSummaryCounts,
  /** Set after naming a new address: whether its confirmation link was sent. */
  confirm_sent: z.boolean().nullable(),
});
export type ListAdminDetail = z.infer<typeof ListAdminDetail>;

const ListIdParams = z.object({ id: Id });

export const listLists = defineRoute({
  method: 'GET',
  path: '/api/admin/lists',
  summary: 'Every list, the starting points, and the kinds of question a list may ask.',
  response: z.object({
    lists: z.array(ListSummary),
    templates: z.array(ListTemplateChoice),
    kinds: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
    personal_days: z.number().int().nullable(),
  }),
});

export const createList = defineRoute({
  method: 'POST',
  path: '/api/admin/lists',
  summary: 'Make a list from a starting point. A new list starts hidden.',
  body: z.object({
    template: z.string(),
    slug: z.string().optional(),
    title: z.string().optional(),
  }),
  response: ListDetail,
});

/**
 * A list as a file: the document a starting point ships as, so one reader
 * serves both. Loose, because the reader, not this schema, says what is wrong
 * with a file in words an administrator can act on.
 */
export const ListFile = z.looseObject({
  reportlog_list: z.number(),
  slug: z.string(),
  title: z.string(),
  blurb: z.string().optional(),
  /** Derived from the questions when a file is written, and checked when one is read. */
  email: z.enum(['none', 'optional', 'required']).optional(),
  /** `always`: ask for an address even where the questions do not need one. Present only then. */
  ask_email: z.literal('always').optional(),
  /** Present only when true. */
  strict: z.boolean().optional(),
  /** "We'll write back". Present only when true. */
  write_back: z.boolean().optional(),
  fields: z.array(z.looseObject({ key: z.string(), kind: z.string(), label: z.string() })),
});
export type ListFile = z.infer<typeof ListFile>;

export const createListFromFile = defineRoute({
  method: 'POST',
  path: '/api/admin/lists/from-file',
  summary: 'Make a hidden list from a list file, optionally under another address and title.',
  body: z.object({
    file: z.unknown(),
    slug: z.string().optional(),
    title: z.string().optional(),
  }),
  response: ListDetail,
});

export const getList = defineRoute({
  method: 'GET',
  path: '/api/admin/lists/:id',
  summary: 'One list, its questions, and its counts so far.',
  params: ListIdParams,
  response: ListAdminDetail,
});

export const updateList = defineRoute({
  method: 'PATCH',
  path: '/api/admin/lists/:id',
  summary: "A list's switches. Only what is named changes.",
  params: ListIdParams,
  body: z.object({
    title: z.string().optional(),
    /** The web address. Old addresses stop working when it changes. */
    slug: z.string().optional(),
    blurb: z.string().nullable().optional(),
    /** The cover page; null clears it. */
    cover: Cover.nullable().optional(),
    visibility: z.string().optional(),
    outside_access: z.string().optional(),
    email_mode: z.string().optional(),
    write_back: z.boolean().optional(),
    show_on_front: z.boolean().optional(),
    on_get_involved: z.boolean().optional(),
    is_contact: z.boolean().optional(),
    notify: z.boolean().optional(),
    /** Naming an address other than the admin one sends it a link first. */
    notify_email: z.string().nullable().optional(),
    aggregates_published: z.boolean().optional(),
    closed: z.boolean().optional(),
    opens_at: z.string().nullable().optional(),
    closes_at: z.string().nullable().optional(),
  }),
  response: ListAdminDetail,
});

export const ListQuestionInput = z.object({
  /** An existing question's id. Absent or null for a new question. */
  id: z.number().int().nullable().optional(),
  key: z.string().optional(),
  kind: z.string().optional(),
  label: z.string().optional(),
  help: z.string().nullable().optional(),
  required: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).nullable().optional(),
  max_values: z.number().optional(),
  aggregatable: z.boolean().optional(),
  retention: z.string().optional(),
});
export type ListQuestionInput = z.infer<typeof ListQuestionInput>;

export const downloadListFile = defineRoute({
  method: 'GET',
  path: '/api/admin/lists/:id/file',
  summary: 'A list as a file: its title and questions, not what anybody sent through it.',
  params: ListIdParams,
  response: ListFile,
});

export const replaceListQuestions = defineRoute({
  method: 'PUT',
  path: '/api/admin/lists/:id/fields',
  summary: "Replace a list's questions with this set, in this order. Checked as a whole.",
  params: ListIdParams,
  body: z.object({ fields: z.array(ListQuestionInput) }),
  response: ListDetail,
});

export const deleteList = defineRoute({
  method: 'DELETE',
  path: '/api/admin/lists/:id',
  summary: 'Delete a list nobody has used. One that has taken entries is closed instead.',
  params: ListIdParams,
  response: z.object({ deleted: z.string() }),
});

// ── administrators: a subject access request ────────────────────────────

export const FoundListEntry = z.object({
  id: z.number().int(),
  list_id: z.number().int(),
  created_at: Timestamp,
  review_state: ReviewState,
  triage_state: TriageState,
  answers: ListAnswers,
  erasable_answers: ListAnswers.nullable(),
  /** The address searched for, when the entry is under it. Never decrypted. */
  email: z.string().nullable(),
  has_email: z.boolean(),
  /** When the clock erases the personal half. Null: kept until its holder erases it. */
  personal_expires_at: Timestamp.nullable(),
});
export type FoundListEntry = z.infer<typeof FoundListEntry>;

export const ListSearchResult = z.object({
  query: z.string(),
  entries: z.array(FoundListEntry),
  lists: z.array(
    z.object({
      id: z.number().int(),
      slug: z.string(),
      title: z.string(),
      fields: z.array(z.object({ key: z.string(), label: z.string() })),
    }),
  ),
  /** More matched than were sent. Narrow the words. */
  more: z.boolean(),
});
export type ListSearchResult = z.infer<typeof ListSearchResult>;

/**
 * A POST, so what is looked for (usually somebody's name or address) is in no
 * address bar, browser history or access log.
 */
export const searchListEntries = defineRoute({
  method: 'POST',
  path: '/api/admin/lists/search',
  summary:
    'Every entry, on any list, whose personal half has these words or this address in it. ' +
    'What has been erased is not found.',
  body: z.object({ q: z.string().optional() }),
  response: ListSearchResult,
});

// ── moderators: review, in bulk ─────────────────────────────────────────

export const ReviewQueue = z.object({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  waiting: z.number().int(),
  oldest: Timestamp.nullable(),
  /** Of the waiting entries, how many hold a link nobody has judged yet. */
  with_links: z.number().int(),
  /** Of the waiting entries, how many hold a written account (a tip description). */
  with_written: z.number().int(),
});

export const listReviewQueues = defineRoute({
  method: 'GET',
  path: '/api/list-review',
  summary: 'Every list, with how much is waiting.',
  response: z.object({ queues: z.array(ReviewQueue) }),
});

export const ReviewLink = z.object({
  field_key: z.string(),
  /** Normalized (trackers stripped), decrypted for a moderator. Never fetched. */
  url: z.string(),
  host: z.string(),
  /** Whether the host is one the operator knows. Unfamiliar ones are for the reviewer's eye. */
  known_host: z.boolean(),
  /** The link's group (one per distinct address) and how it was checked; null: not yet. */
  group_id: z.number().int(),
  outcome: z.enum(['checked', 'withheld', 'illegal']).nullable(),
  /** What kind of link the tip said it is, in words; only where its form asked. */
  kind: z.string().optional(),
  /** The group's comment for journalists, edited beside the verdict. */
  comment: z.string().nullable(),
});

export const ReviewEntry = z.object({
  id: z.number().int(),
  created_at: Timestamp,
  review_state: ReviewState,
  triage_state: TriageState,
  answers: ListAnswers,
  /** Shown to a moderator, whose job is to read it. Still swept on schedule. */
  erasable_answers: ListAnswers.nullable(),
  has_email: z.boolean(),
  erased: z.boolean(),
  links: z.array(ReviewLink),
  /**
   * Its tip descriptions, each named by the `ref` the written-account routes
   * take (texts.ts), and their decision. Never the words: those are in
   * `erasable_answers`, and the note editor opens them through `openText`.
   */
  texts: z.array(
    z.object({
      ref: z.string(),
      field_key: z.string(),
      outcome: z.enum(['redacted', 'withheld']).nullable(),
    }),
  ),
});
export type ReviewEntry = z.infer<typeof ReviewEntry>;

/** No "one address sending many": no network address is kept (owner ruling 40). */
export const ReviewClusters = z.object({
  busiest_minutes: z.array(z.object({ minute: z.string(), count: z.number().int() })),
});

export const ReviewBatch = z.object({
  list: z.object({
    id: z.number().int(),
    slug: z.string(),
    title: z.string(),
    /** Whether the page offers "Show address" on each entry. */
    write_back: z.boolean(),
  }),
  fields: z.array(
    z.object({ key: z.string(), label: z.string(), kind: z.string(), retention: Retention }),
  ),
  state: ReviewState,
  entries: z.array(ReviewEntry),
  clusters: ReviewClusters,
});
export type ReviewBatch = z.infer<typeof ReviewBatch>;

export const getReviewBatch = defineRoute({
  method: 'GET',
  path: '/api/list-review/:id',
  summary: "A page of one list's entries, with what makes skimming them safe.",
  params: ListIdParams,
  query: z.object({
    state: ReviewState.optional(),
    limit: z.coerce.number().int().optional(),
    // The review page's filters (owner, 29 October 2026). Staff work filters
    // on a staff queue, not filters on public data.
    /** Only entries holding a link nobody has judged yet. */
    links: z.enum(['true', 'false']).optional(),
    /** Only entries holding a written account (a tip description). */
    written: z.enum(['true', 'false']).optional(),
  }),
  response: ReviewBatch,
});

export const reviewListEntries = defineRoute({
  method: 'POST',
  path: '/api/list-review/:id/review',
  summary: 'Approve or reject THE ENTRIES NAMED: the page looked at, never "everything waiting".',
  params: ListIdParams,
  body: z.object({ state: z.string(), ids: z.array(z.number().int()) }),
  response: z.object({ changed: z.number().int() }),
});

export const triageListEntries = defineRoute({
  method: 'POST',
  path: '/api/list-review/:id/triage',
  summary: 'Mark entries as dealt with. A different question from review.',
  params: ListIdParams,
  body: z.object({ state: z.string(), ids: z.array(z.number().int()) }),
  response: z.object({ changed: z.number().int() }),
});

export const revealListAddress = defineRoute({
  method: 'POST',
  path: '/api/list-review/:id/entries/:entryId/address',
  summary:
    "Open one entry's email address, on a list that writes back. Each opening is recorded " +
    'before the address is read; the record never holds the address.',
  params: z.object({ id: Id, entryId: Id }),
  response: z.object({ address: z.string() }),
});
