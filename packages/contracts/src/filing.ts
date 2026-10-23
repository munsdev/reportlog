/**
 * Filing and confirmation (workstream C).
 *
 * THREE AUDIENCES. A reporter filing (public, and the only calls a logbook
 * opened outside the site password lets through: see FILING_CALLS in
 * apps/api/src/identity/doors.ts). A signed-in reporter looking after their
 * own reports ("My reports"). And a coordinator entering accounts collected
 * on paper for an organization.
 *
 * Request bodies are typed loosely on purpose, as in logbooks.ts: the server
 * refuses with a sentence a person can act on, where a schema error would
 * refuse first with one they cannot.
 */
import { z } from 'zod';
import { DoorFields } from './door.ts';
import { FormQuestion } from './logbooks.ts';
import { defineRoute } from './route.ts';

const Timestamp = z.string();
const Id = z.coerce.number().int().positive();
const Answers = z.record(z.string(), z.unknown());

// ── filing ──────────────────────────────────────────────────────────────

export const submitReport = defineRoute({
  method: 'POST',
  path: '/api/reports',
  summary:
    'Send a report. Where the logbook asks for an email, nothing is filed until the link in it is followed; where it does not, the report is sealed on arrival.',
  body: z.object({
    logbook: z.string().optional(),
    /** The spine: where to reach the reporter. Never sealed. */
    email: z.string().optional(),
    /** The spine: the statement on the last card. */
    consent: z.boolean().optional(),
    answers: Answers.optional(),
    /** The spine: the publication answer. Not answering is "no". */
    may_publish: z.boolean().optional(),
    /** Issued by GET /api/publication-card, never computed by a client. */
    may_publish_digest: z.string().optional(),
    /** From POST /api/uploads/draft: the files staged while this was written. */
    draft_token: z.string().optional(),
    /** The form version the page showed (getPublicLogbook's `form`). */
    form: z.string().optional(),
    ...DoorFields,
  }),
  /**
   * PENDING for a logbook that asks for an email: nothing is filed until the
   * emailed link is followed. FILED for one that does not (owner decision E1):
   * sealed on arrival, and nothing more to do. No receipt either way: a
   * reporter is not handed a reference to a report nobody has yet accepted.
   */
  response: z.union([
    z.object({
      pending: z.literal(true),
      /**
       * Files staged before the logbook's uploads were frozen, dropped at Send
       * (decision 17). Present only when there were any. The report was sent.
       */
      files_dropped: z.array(z.string()).optional(),
    }),
    z.object({ filed: z.literal(true) }),
  ]),
});

/**
 * Where a confirmation link stands. A reporter is never told WHICH
 * non-public state their report is in: a moderator can always revisit a
 * decision, so nothing about it is final.
 */
/** Which attached files made it into the report, and why any did not (files workstream). */
const FileOutcome = z.object({
  attached: z.number().int(),
  not_attached: z.array(z.object({ name: z.string(), reason: z.string() })),
});

export const Confirmation = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unconfirmed'), logbook_title: z.string(), expires_at: Timestamp }),
  /** With the logbook's address, so the page can offer to file it again. */
  z.object({ state: z.literal('expired'), logbook_title: z.string(), logbook_slug: z.string() }),
  /** Files are still being prepared; nothing was filed yet. Press again shortly. */
  z.object({
    state: z.literal('preparing'),
    logbook_title: z.string(),
    files: z.array(z.string()),
  }),
  z.object({
    state: z.literal('received'),
    logbook_title: z.string(),
    public_ref: z.string(),
    files: FileOutcome.optional(),
    /**
     * Present while the site's public archive is switched off. The page then
     * says a report "may be published", never "public" (decisions.md §5): an
     * approved report is not public on a site that shows nothing.
     */
    archive_closed: z.literal(true).optional(),
  }),
  z.object({
    state: z.literal('public'),
    logbook_title: z.string(),
    public_ref: z.string(),
    files: FileOutcome.optional(),
  }),
  /**
   * Accepted, in a logbook published as counts only (Plan E): counted in the
   * public figures, its words shown nowhere. Never called "public".
   */
  z.object({
    state: z.literal('counted'),
    logbook_title: z.string(),
    public_ref: z.string(),
    files: FileOutcome.optional(),
  }),
]);
export type Confirmation = z.infer<typeof Confirmation>;

const TokenParams = z.object({ token: z.string().min(1).max(200) });

export const getConfirmation = defineRoute({
  method: 'GET',
  path: '/api/reports/confirm/:token',
  summary:
    'Where a confirmation link stands. Only looks: mail scanners open links, so a GET never files anything.',
  params: TokenParams,
  response: z.object({ confirmation: Confirmation }),
});

export const confirmReport = defineRoute({
  method: 'POST',
  path: '/api/reports/confirm/:token',
  summary: 'Confirm: file the report into its logbook. Pressing twice files it once.',
  params: TokenParams,
  response: z.object({ confirmation: Confirmation, just_confirmed: z.boolean() }),
});

// ── whether the site takes new reports ──────────────────────────────────

export const getIntakeSwitch = defineRoute({
  method: 'GET',
  path: '/api/intake-switch',
  summary: 'Whether this site is taking new reports at all.',
  response: z.object({ open: z.boolean() }),
});

export const IntakeSwitchAdmin = z.object({
  open: z.boolean(),
  /** Null when nobody has decided, which reads as open. */
  stored: z.boolean().nullable(),
});

export const getIntakeSwitchAdmin = defineRoute({
  method: 'GET',
  path: '/api/admin/intake-switch',
  summary: 'The intake switch, and whether anybody has set it.',
  response: IntakeSwitchAdmin,
});

export const setIntakeSwitch = defineRoute({
  method: 'PUT',
  path: '/api/admin/intake-switch',
  summary:
    'Open or close the site to new reports. Closing leaves corrections and everything filed alone.',
  body: z.object({ open: z.boolean().nullable() }),
  response: IntakeSwitchAdmin,
});

// ── my reports ──────────────────────────────────────────────────────────

export const PERMISSIONS = [
  'contact_passing',
  'attachment_publication',
  'evidence_request',
] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;
export const Permissions = z.object({
  contact_passing: z.boolean(),
  attachment_publication: z.boolean(),
  evidence_request: z.boolean(),
});
export type Permissions = z.infer<typeof Permissions>;

export const MyReport = z.object({
  thread_id: z.string(),
  /** The current version's reference. */
  public_ref: z.string(),
  logbook_slug: z.string(),
  logbook_title: z.string(),
  /** When the current version was filed. */
  received_at: Timestamp,
  first_received_at: Timestamp,
  versions: z.number().int(),
  answers: Answers,
  may_publish: z.boolean(),
  withdrawn: z.boolean(),
  /** 'pending' until a moderator has looked; anything else, they have. */
  moderation_status: z.string(),
  permissions: Permissions,
});
export type MyReport = z.infer<typeof MyReport>;

export const listMyReports = defineRoute({
  method: 'GET',
  path: '/api/mine/reports',
  summary: 'The reports filed from the signed-in address.',
  response: z.object({ reports: z.array(MyReport) }),
});

const ThreadParams = z.object({ threadId: z.uuid() });

export const MyReportDetail = MyReport.extend({
  /**
   * The current version's fingerprint and chain link, for the signed
   * declaration: it declares one exact sealed version, and anyone can check
   * these on the verify page.
   */
  content_hash: z.string(),
  chain_hash: z.string(),
  /** The logbook's questions as they are now: a correction answers these. */
  questions: z.array(FormQuestion),
  /**
   * How many of the report's files are on the public site now. Switching off
   * file publication takes these down, so the page asks first when it is
   * not 0.
   */
  published_files: z.number().int(),
  permission_history: z.array(
    z.object({
      permission: Permission,
      granted: z.boolean(),
      reason: z.string().nullable(),
      at: Timestamp,
    }),
  ),
  actions: z.array(z.object({ action: z.string(), comment: z.string().nullable(), at: Timestamp })),
});
export type MyReportDetail = z.infer<typeof MyReportDetail>;

export const getMyReport = defineRoute({
  method: 'GET',
  path: '/api/mine/reports/:threadId',
  summary: 'One of your reports, with what a correction would be asked.',
  params: ThreadParams,
  response: MyReportDetail,
});

export const correctMyReport = defineRoute({
  method: 'POST',
  path: '/api/mine/reports/:threadId/correct',
  summary:
    'Answer the logbook again: a new version in the same thread. May take back permission to publish, never give it.',
  params: ThreadParams,
  body: z.object({
    answers: Answers.optional(),
    comment: z.string().optional(),
    may_publish: z.boolean().optional(),
  }),
  response: z.object({ public_ref: z.string() }),
});

export const withdrawMyReport = defineRoute({
  method: 'POST',
  path: '/api/mine/reports/:threadId/withdraw',
  summary: 'Take a report off the public board. It stays in the archive, sealed.',
  params: ThreadParams,
  body: z.object({ comment: z.string().optional() }),
  response: z.object({ ok: z.literal(true) }),
});

export const eraseMyContact = defineRoute({
  method: 'POST',
  path: '/api/mine/reports/:threadId/erase',
  summary:
    'Erase your contact details from a report. It is not withdrawn: it stays as it was, sealed, and it never held your address.',
  params: ThreadParams,
  body: z.object({ confirm: z.boolean().optional() }),
  response: z.object({ ok: z.literal(true) }),
});

export const setMyPermission = defineRoute({
  method: 'POST',
  path: '/api/mine/reports/:threadId/permissions',
  summary: 'Give or take back one permission. Only you can.',
  params: ThreadParams,
  body: z.object({
    permission: z.string().optional(),
    granted: z.boolean().optional(),
    reason: z.string().optional(),
  }),
  response: z.object({ permissions: Permissions }),
});

// ── coordinator intake ──────────────────────────────────────────────────

export const IntakeOrganization = z.object({
  organization_id: z.number().int(),
  name: z.string(),
  role: z.string(),
});

export const IntakeBatch = z.object({
  id: z.number().int(),
  organization_id: z.number().int(),
  organization: z.string(),
  status: z.enum(['draft', 'submitted']),
  created_at: Timestamp,
  submitted_at: Timestamp.nullable(),
  entries: z.number().int(),
  filed: z.number().int(),
});
export type IntakeBatch = z.infer<typeof IntakeBatch>;

/** One account as a coordinator types it up. Everything optional until review. */
export const DraftPayload = z.looseObject({
  logbook: z.string().optional(),
  answers: Answers.optional(),
  intake_method: z.string().optional(),
  collected_on: z.string().optional(),
  /** The coordinator's own reference to the paper. Never sealed. */
  source_ref: z.string().optional(),
  may_publish: z.boolean().optional(),
  may_publish_digest: z.string().optional(),
});
export type DraftPayload = z.infer<typeof DraftPayload>;

export const IntakeDraft = z.object({
  id: z.number().int(),
  ordinal: z.number().int(),
  payload: DraftPayload,
  /** The reference it was FIRST filed as, once filed. A correction makes a new one. */
  public_ref: z.string().nullable(),
  /** Once filed: the thread a correction continues. */
  thread_id: z.string().nullable(),
});
export type IntakeDraft = z.infer<typeof IntakeDraft>;

export const listIntakeOrganizations = defineRoute({
  method: 'GET',
  path: '/api/intake/organizations',
  summary: 'The organizations you may file accounts for.',
  response: z.object({ organizations: z.array(IntakeOrganization) }),
});

export const createIntakeBatch = defineRoute({
  method: 'POST',
  path: '/api/intake/batches',
  summary: 'Start a batch of accounts for one organization.',
  body: z.object({ organization_id: z.number().int().optional() }),
  response: IntakeBatch,
});

export const listIntakeBatches = defineRoute({
  method: 'GET',
  path: '/api/intake/batches',
  summary: 'Your batches, newest first. Only your own.',
  response: z.object({ batches: z.array(IntakeBatch) }),
});

const BatchParams = z.object({ id: Id });

export const getIntakeBatch = defineRoute({
  method: 'GET',
  path: '/api/intake/batches/:id',
  summary: 'One of your batches and its accounts.',
  params: BatchParams,
  response: z.object({ batch: IntakeBatch, drafts: z.array(IntakeDraft) }),
});

export const addIntakeDraft = defineRoute({
  method: 'POST',
  path: '/api/intake/batches/:id/drafts',
  summary: 'Add an account to a batch that has not been filed.',
  params: BatchParams,
  body: DraftPayload,
  response: IntakeDraft,
});

export const updateIntakeDraft = defineRoute({
  method: 'PUT',
  path: '/api/intake/drafts/:id',
  summary: 'Change an account that has not been filed.',
  params: BatchParams,
  body: DraftPayload,
  response: IntakeDraft,
});

export const removeIntakeDraft = defineRoute({
  method: 'DELETE',
  path: '/api/intake/drafts/:id',
  summary: 'Remove an account that has not been filed.',
  params: BatchParams,
  response: z.object({ ok: z.literal(true) }),
});

export const reviewIntakeBatch = defineRoute({
  method: 'GET',
  path: '/api/intake/batches/:id/review',
  summary: 'What each account is still missing, before anything is filed.',
  params: BatchParams,
  response: z.object({
    batch: IntakeBatch,
    entries: z.array(
      z.object({
        id: z.number().int(),
        ordinal: z.number().int(),
        filed: z.boolean(),
        problems: z.array(z.string()),
      }),
    ),
    ready: z.number().int(),
    blocked: z.number().int(),
  }),
});

export const submitIntakeBatch = defineRoute({
  method: 'POST',
  path: '/api/intake/batches/:id/submit',
  summary:
    'Attest to the batch and file every complete account. Incomplete ones stay staged, never discarded.',
  params: BatchParams,
  body: z.object({ attested: z.boolean().optional() }),
  response: z.object({
    filed: z.array(
      z.object({
        ordinal: z.number().int(),
        public_ref: z.string(),
        /** Files not kept: the logbook stopped taking files since they were attached (decision 19). */
        files_dropped: z.array(z.string()).optional(),
      }),
    ),
    still_staged: z.number().int(),
    attested_at: Timestamp,
  }),
});

// ── files in an account ─────────────────────────────────────────────────
//
// The coordinator attaches what the person gave them (a photo, a recording)
// to the account itself. The files are worked on at once, and sealed into
// the report when the batch is filed. The bytes are PUT, unparsed, to
// INTAKE_FILE_PATH, with no draft token: the account is the coordinator's.

export const INTAKE_FILE_PATH = (draftId: number, slot: string) =>
  `/api/intake/drafts/${String(draftId)}/files/${slot}`;

export const IntakeFile = z.object({
  slot_token: z.string(),
  name: z.string(),
  size: z.number(),
  /** pending, uploaded, processing, clean, rejected, unreadable, infected, expired */
  status: z.string(),
  detail: z.string().nullable(),
});
export type IntakeFile = z.infer<typeof IntakeFile>;

export const listIntakeDraftFiles = defineRoute({
  method: 'GET',
  path: '/api/intake/drafts/:id/files',
  summary: "An account's files and where each stands.",
  params: BatchParams,
  response: z.object({ files: z.array(IntakeFile) }),
});

export const addIntakeDraftFile = defineRoute({
  method: 'POST',
  path: '/api/intake/drafts/:id/files',
  summary:
    "Reserve a place for one file on an account, against its logbook's limits, before a byte is sent.",
  params: BatchParams,
  body: z.object({
    /** The logbook chosen in the dialog, which may not be saved yet. */
    logbook: z.string().optional(),
    name: z.string().max(1000).optional(),
    type: z.string().max(200).optional(),
    size: z.number().optional(),
  }),
  response: z.object({ slot_token: z.string() }),
});

export const removeIntakeDraftFile = defineRoute({
  method: 'DELETE',
  path: '/api/intake/drafts/:id/files/:slot',
  summary: 'Remove a file from an account that has not been filed.',
  params: z.object({ id: Id, slot: z.string().max(100) }),
  response: z.object({ ok: z.literal(true) }),
});

// ── correcting a filed account, as the coordinator ──────────────────────

const ThreadOnly = z.object({ threadId: z.uuid() });

/**
 * A report a coordinator filed, as its coordinator sees it. Not "My
 * reports": nothing here is the reporter's to give or take back.
 */
export const IntakeFiling = z.object({
  thread_id: z.string(),
  /** The current version's reference. */
  public_ref: z.string(),
  logbook_slug: z.string(),
  logbook_title: z.string(),
  batch_id: z.number().int(),
  ordinal: z.number().int(),
  /** The organization's name as the current version seals it. */
  filed_via: z.string(),
  intake_method: z.string(),
  collected_on: z.string().nullable(),
  may_publish: z.boolean(),
  answers: Answers,
  /** The logbook's questions as they are now: a correction answers these. */
  questions: z.array(FormQuestion),
  versions: z.number().int(),
  received_at: Timestamp,
  moderation_status: z.string(),
  /** Filing and every correction, newest first, with who did it. */
  history: z.array(
    z.object({
      action: z.enum(['filed', 'correct']),
      public_ref: z.string(),
      by: z.string(),
      comment: z.string().nullable(),
      at: Timestamp,
    }),
  ),
});
export type IntakeFiling = z.infer<typeof IntakeFiling>;

export const getIntakeFiling = defineRoute({
  method: 'GET',
  path: '/api/intake/reports/:threadId',
  summary: 'An account you filed, with what a correction would be asked.',
  params: ThreadOnly,
  response: IntakeFiling,
});

export const correctIntakeFiling = defineRoute({
  method: 'POST',
  path: '/api/intake/reports/:threadId/correct',
  summary:
    'Correct an account you filed: a new version in the same thread, attested by you. May take back permission to publish, never give it.',
  params: ThreadOnly,
  body: z.object({
    answers: Answers.optional(),
    comment: z.string().optional(),
    may_publish: z.boolean().optional(),
    intake_method: z.string().optional(),
    /** A calendar day, or '' to say it is not known. Left out, it carries forward. */
    collected_on: z.string().optional(),
    attested: z.boolean().optional(),
  }),
  response: z.object({ public_ref: z.string() }),
});
