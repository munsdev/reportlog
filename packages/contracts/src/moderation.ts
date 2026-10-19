/**
 * Moderation (workstream D1).
 *
 * THREE AUDIENCES. Moderators and administrators working the queue (one
 * scope, guarded once). Administrators alone for what is the chief editor's
 * or the operator's call: a note's state, the access log, the keyword list,
 * the archive switch, and whether a logbook uses notes. And a signed-in
 * reporter reading who opened their contact details, and why, without being
 * told who.
 *
 * Request bodies are typed loosely on purpose, as in filing.ts: the server
 * refuses with a sentence a person can act on.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

const Timestamp = z.string();
const ThreadParams = z.object({ threadId: z.uuid() });
const Answers = z.record(z.string(), z.unknown());
const Ok = z.object({ ok: z.literal(true) });

export const ModerationStatus = z.enum(['pending', 'valid', 'invalid', 'unknown']);
export type ModerationStatus = z.infer<typeof ModerationStatus>;
export const QueueStatusFilter = z.enum([
  'all',
  'pending',
  'valid',
  'invalid',
  'unknown',
  'withdrawn',
]);

/** One report in the queue. Never its contact details: those open one at a time, logged. */
export const QueueItem = z.object({
  thread_id: z.string(),
  public_ref: z.string(),
  received_at: Timestamp,
  logbook_slug: z.string(),
  logbook_title: z.string(),
  answers: Answers,
  /** The reporter's sealed answer. Approval never overrides it. */
  may_publish: z.boolean(),
  moderation_status: ModerationStatus,
  withdrawn: z.boolean(),
  /** A reporter's own withdrawal, which no moderator can undo. */
  reporter_withdrew: z.boolean(),
  versions: z.number().int(),
  filed_via: z.string().nullable(),
  intake_method: z.string().nullable(),
  /** Asks for a second read: the words that fired. A reading list, never a finding. */
  needs_review: z.boolean(),
  review_terms: z.array(z.string()),
  notes_enabled: z.boolean(),
  has_note: z.boolean(),
  has_contact: z.boolean(),
  file_count: z.number().int(),
  /** How many of this version's files a moderator has published (workstream F's decision, per file). */
  published_files: z.number().int(),
  /** The reporter's attachment permission, as it stands now. */
  files_permitted: z.boolean(),
  /** True only when the board shows it right now. */
  public: z.boolean(),
});
export type QueueItem = z.infer<typeof QueueItem>;

export const listQueue = defineRoute({
  method: 'GET',
  path: '/api/moderation/reports',
  summary: 'The moderation queue. Search spans every status.',
  query: z.object({
    status: QueueStatusFilter.default('pending'),
    q: z.string().max(200).optional(),
    flagged: z.enum(['true', 'false']).optional(),
    logbook: z.string().max(63).optional(),
    sort: z.enum(['newest', 'oldest']).optional(),
  }),
  response: z.object({
    reports: z.array(QueueItem),
    open_flags: z.number().int(),
    archive_published: z.boolean(),
  }),
});

export const HistoryEntry = z.object({
  action: z.string(),
  new_status: z.string().nullable(),
  /** Staff only. Null on the reporter's own actions: no address is stored for them. */
  actor_email: z.string().nullable(),
  by: z.enum(['staff', 'reporter']),
  comment: z.string().nullable(),
  created_at: Timestamp,
});

export const getQueueItem = defineRoute({
  method: 'GET',
  path: '/api/moderation/reports/:threadId',
  summary: 'One report in the queue, with what moderators and the reporter did to it.',
  params: ThreadParams,
  response: z.object({ report: QueueItem, history: z.array(HistoryEntry) }),
});

export const decideReport = defineRoute({
  method: 'POST',
  path: '/api/moderation/reports/:threadId/decision',
  summary: 'Approve (valid), decline (invalid) or mark unclear (unknown), with a reason.',
  params: ThreadParams,
  body: z.object({ status: z.string().optional(), comment: z.string().optional() }),
  response: Ok,
});

export const withdrawReport = defineRoute({
  method: 'POST',
  path: '/api/moderation/reports/:threadId/withdraw',
  summary: 'Take a report off the public board, with a reason. Nothing is deleted.',
  params: ThreadParams,
  body: z.object({ comment: z.string().optional() }),
  response: Ok,
});

export const restoreReport = defineRoute({
  method: 'POST',
  path: '/api/moderation/reports/:threadId/restore',
  summary: "Put back a report a moderator withdrew. Never a reporter's own withdrawal.",
  params: ThreadParams,
  body: z.object({ status: z.string().optional(), comment: z.string().optional() }),
  response: Ok,
});

export const markReportRead = defineRoute({
  method: 'POST',
  path: '/api/moderation/reports/:threadId/read',
  summary: 'Say a flagged report has had its second read. Not a decision; nothing is deleted.',
  params: ThreadParams,
  response: z.object({ ok: z.literal(true), cleared: z.number().int() }),
});

export const OpenedContact = z.object({
  filed_by: z.enum(['reporter', 'coordinator']),
  email: z.string().nullable(),
  organization: z.string().nullable(),
  /** The reporter had these erased. */
  erased: z.boolean(),
});

export const openReportContact = defineRoute({
  method: 'POST',
  path: '/api/moderation/reports/:threadId/contact',
  summary:
    "Open a reporter's contact details. A POST, because a reason is required and the reporter is shown it; logged before anything is read.",
  params: ThreadParams,
  body: z.object({ reason: z.string().optional() }),
  response: z.object({ contact: OpenedContact }),
});

// ── editorial notes ─────────────────────────────────────────────────────

export const NoteState = z.enum(['published', 'under_review', 'withdrawn']);

export const StaffNote = z.object({
  state: NoteState,
  body: z.string(),
  author_email: z.string(),
  written_at: Timestamp,
  versions: z.number().int(),
});

export const getReportNote = defineRoute({
  method: 'GET',
  path: '/api/moderation/reports/:threadId/note',
  summary: 'The note on a report, in full, with every version and its citations.',
  params: ThreadParams,
  response: z.object({
    enabled: z.boolean(),
    note: StaffNote.nullable(),
    versions: z.array(
      z.object({
        id: z.number().int(),
        body: z.string(),
        author_email: z.string(),
        revision_reason: z.string().nullable(),
        created_at: Timestamp,
      }),
    ),
    links: z.array(
      z.object({
        id: z.number().int(),
        title: z.string(),
        publisher: z.string().nullable(),
        published_on: z.string().nullable(),
        url: z.string(),
        added_by: z.string(),
      }),
    ),
  }),
});

export const writeReportNote = defineRoute({
  method: 'POST',
  path: '/api/moderation/reports/:threadId/note',
  summary: 'Write a note, or a new version of one. A revision needs a reason.',
  params: ThreadParams,
  body: z.object({ body: z.string().optional(), revision_reason: z.string().optional() }),
  response: z.object({ ok: z.literal(true), versions: z.number().int() }),
});

export const addNoteLink = defineRoute({
  method: 'POST',
  path: '/api/moderation/reports/:threadId/note/links',
  summary: 'Cite outside coverage beside a note.',
  params: ThreadParams,
  body: z.object({
    title: z.string().optional(),
    publisher: z.string().optional(),
    published_on: z.string().optional(),
    url: z.string().optional(),
  }),
  response: z.object({ ok: z.literal(true), id: z.number().int() }),
});

export const removeNoteLink = defineRoute({
  method: 'DELETE',
  path: '/api/moderation/reports/:threadId/note/links/:id',
  summary: 'Withdraw a citation. It stays on the record as withdrawn.',
  params: z.object({ threadId: z.uuid(), id: z.coerce.number().int().positive() }),
  response: Ok,
});

// ── administrators ──────────────────────────────────────────────────────

export const setNoteState = defineRoute({
  method: 'POST',
  path: '/api/admin/moderation/reports/:threadId/note/state',
  summary:
    "Mark a note under review, withdraw it, or publish it again. The chief editor's call, with a reason.",
  params: ThreadParams,
  body: z.object({ state: z.string().optional(), comment: z.string().optional() }),
  response: z.object({ ok: z.literal(true), state: NoteState }),
});

export const getAccessLog = defineRoute({
  method: 'GET',
  path: '/api/admin/moderation/access-log',
  summary: "Who opened a reporter's contact details, and why. Reading it is recorded too.",
  query: z.object({
    months: z.coerce.number().int().min(1).max(120).default(12),
    thread: z.uuid().optional(),
  }),
  response: z.object({
    months: z.number().int(),
    entries: z.array(
      z.object({
        id: z.number().int(),
        staff_email: z.string(),
        kind: z.string(),
        reason: z.string().nullable(),
        accessed_at: Timestamp,
        thread_id: z.string().nullable(),
        public_ref: z.string().nullable(),
      }),
    ),
  }),
});

export const KeywordsState = z.object({
  /** Not chosen, chosen, and chosen-as-empty are three different answers. */
  using_default: z.boolean(),
  terms: z.array(z.string()),
  default_count: z.number().int(),
  set_by: z.string().nullable(),
  set_at: Timestamp.nullable(),
});

export const getReviewKeywords = defineRoute({
  method: 'GET',
  path: '/api/admin/moderation/keywords',
  summary: 'The words that raise a review flag.',
  response: KeywordsState,
});

export const setReviewKeywords = defineRoute({
  method: 'PUT',
  path: '/api/admin/moderation/keywords',
  summary: 'Replace the list (one term per line, or an array), or put the shipped list back.',
  body: z.object({
    terms: z.union([z.string(), z.array(z.string())]).optional(),
    reset: z.boolean().optional(),
  }),
  response: KeywordsState,
});

export const ArchiveState = z.object({
  /** What the site does now. */
  published: z.boolean(),
  /** Null when nobody has chosen, which is on. */
  stored: z.boolean().nullable(),
});

export const getArchiveSwitch = defineRoute({
  method: 'GET',
  path: '/api/admin/moderation/archive',
  summary: 'Whether this site publishes a public archive at all.',
  response: ArchiveState,
});

export const setArchiveSwitch = defineRoute({
  method: 'PUT',
  path: '/api/admin/moderation/archive',
  summary: 'Turn the public archive on or off. Null puts it back to "nobody chose" (on).',
  body: z.object({ published: z.boolean().nullable() }),
  response: ArchiveState,
});

export const listNotesSwitches = defineRoute({
  method: 'GET',
  path: '/api/admin/moderation/logbooks',
  summary: 'Every launched logbook, and whether it uses editorial notes.',
  response: z.object({
    logbooks: z.array(
      z.object({ slug: z.string(), title: z.string(), notes_enabled: z.boolean() }),
    ),
  }),
});

export const setNotesSwitch = defineRoute({
  method: 'PUT',
  path: '/api/admin/moderation/logbooks/:slug/notes',
  summary: 'Turn editorial notes on or off for one logbook.',
  params: z.object({ slug: z.string().min(1).max(63) }),
  body: z.object({ enabled: z.boolean() }),
  response: z.object({ slug: z.string(), notes_enabled: z.boolean() }),
});

// ── the reporter ────────────────────────────────────────────────────────

export const getMyReportAccesses = defineRoute({
  method: 'GET',
  path: '/api/mine/reports/:threadId/accesses',
  summary:
    'When somebody on staff opened your contact details or a file’s original, and the reason they gave. Never who.',
  params: ThreadParams,
  response: z.object({
    accesses: z.array(
      z.object({
        what: z.enum(['contact', 'file_original']),
        reason: z.string().nullable(),
        accessed_at: Timestamp,
      }),
    ),
  }),
});
