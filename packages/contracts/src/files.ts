/**
 * Files and evidence (workstream F).
 *
 * FOUR AUDIENCES. A reporter attaching files while filing (public, and part
 * of filing: these calls pass a logbook opened outside the site password,
 * see FILING_CALLS in apps/api/src/identity/doors.ts). A reporter answering
 * an evidence request through the link they were emailed. A moderator
 * deciding what of a report's files is published, and asking for evidence.
 * An administrator setting what is taken and how much.
 *
 * THE BYTES THEMSELVES are not JSON and have no contract here: a file is sent
 * with `PUT /api/uploads/:slot` (or `/api/evidence/:token/files/:slot`) as
 * application/octet-stream, with the draft token in the X-Draft-Token header;
 * published copies are read from `/api/files/public/:key` (plus `/poster`
 * and `/page/:n`). Their paths are named in FILE_PATHS so client and server
 * spell them once.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

const Timestamp = z.string();
const Id = z.coerce.number().int().positive();

export const FILE_KINDS = ['photo', 'video', 'audio', 'document'] as const;
export const FileKind = z.enum(FILE_KINDS);
export type FileKind = z.infer<typeof FileKind>;

/** Raw byte routes, outside the JSON contracts. */
export const FILE_PATHS = {
  upload: (slot: string) => `/api/uploads/${slot}`,
  evidenceUpload: (token: string, slot: string) => `/api/evidence/${token}/files/${slot}`,
  publicFile: (key: string) => `/api/files/public/${key}`,
  publicPoster: (key: string) => `/api/files/public/${key}/poster`,
  publicPage: (key: string, n: number) => `/api/files/public/${key}/page/${String(n)}`,
  moderatorView: (id: number, what: 'rendition' | 'poster' | 'original') =>
    `/api/moderate/files/file/${String(id)}/${what}`,
  moderatorPage: (id: number, n: number) =>
    `/api/moderate/files/file/${String(id)}/page/${String(n)}`,
} as const;
export const DRAFT_HEADER = 'x-draft-token';

/** What the page needs to know before somebody picks a file. */
export const UploadConfig = z.object({
  enabled: z.boolean(),
  kinds: z.array(FileKind),
  /** Media types for the file picker's `accept`. */
  accept: z.array(z.string()),
  max_files: z.number().int(),
  max_total_bytes: z.number().int(),
  max_bytes: z.object({
    photo: z.number(),
    video: z.number(),
    audio: z.number(),
    document: z.number(),
  }),
  max_video_seconds: z.number().int(),
  max_document_pages: z.number().int(),
});
export type UploadConfig = z.infer<typeof UploadConfig>;

export const getUploadConfig = defineRoute({
  method: 'GET',
  path: '/api/uploads/config',
  summary: 'Whether this logbook takes files now, which kinds, and how much.',
  query: z.object({ logbook: z.string().max(80) }),
  response: UploadConfig,
});

export const newUploadDraft = defineRoute({
  method: 'POST',
  path: '/api/uploads/draft',
  summary: 'A token to stage files under while a report is written. It grants nothing on its own.',
  response: z.object({ draft_token: z.string() }),
});

export const createUpload = defineRoute({
  method: 'POST',
  path: '/api/uploads',
  summary: 'Reserve a place for one file. Every limit is checked before a byte is sent.',
  body: z.object({
    draft_token: z.string().optional(),
    logbook: z.string().optional(),
    /** The address the form collected: what the staging quota is keyed on. */
    email: z.string().optional(),
    name: z.string().max(1000).optional(),
    type: z.string().max(200).optional(),
    size: z.number().optional(),
  }),
  response: z.object({ slot_token: z.string() }),
});

export const UploadStatus = z.object({
  slot_token: z.string(),
  name: z.string(),
  size: z.number(),
  /** pending, uploaded, processing, clean, rejected, unreadable, infected, expired */
  status: z.string(),
  detail: z.string().nullable(),
});
export type UploadStatus = z.infer<typeof UploadStatus>;

export const getUploadStatus = defineRoute({
  method: 'GET',
  path: '/api/uploads/status',
  summary: "Where each of a draft's files stands. The draft token goes in X-Draft-Token.",
  response: z.object({ files: z.array(UploadStatus) }),
});

export const removeUpload = defineRoute({
  method: 'DELETE',
  path: '/api/uploads/:slot',
  summary: 'Remove a file before the report is sent. The draft token goes in X-Draft-Token.',
  params: z.object({ slot: z.string().max(100) }),
  response: z.object({ ok: z.literal(true) }),
});

export const UploadReceived = z.object({ status: z.string() });

// ── the public board ────────────────────────────────────────────────────

export const PublishedFile = z.object({
  ordinal: z.number().int(),
  /** The SHA-256 of the file as submitted, which the report seals. */
  sha256: z.string(),
  /** The published copy's type: it is re-encoded, so not the original's. */
  media_type: z.string(),
  alt_text: z.string(),
  /** For FILE_PATHS.publicFile and friends. */
  key: z.string(),
  has_poster: z.boolean(),
  pages: z.number().int(),
});
export type PublishedFile = z.infer<typeof PublishedFile>;

export const getReportFiles = defineRoute({
  method: 'GET',
  path: '/api/files/report/:ref',
  summary: "A public report's files: how many it carries, and the ones published.",
  params: z.object({ ref: z.string().max(100) }),
  response: z.object({ attached: z.number().int(), published: z.array(PublishedFile) }),
});

// ── a moderator ─────────────────────────────────────────────────────────

export const ThreadFile = z.object({
  id: z.number().int(),
  ordinal: z.number().int(),
  original_name: z.string().nullable(),
  media_type: z.string(),
  byte_size: z.number(),
  sha256: z.string(),
  rendition_media_type: z.string(),
  publication: z.enum(['withheld', 'published', 'refused']),
  alt_text: z.string().nullable(),
  erased: z.boolean(),
  has_poster: z.boolean(),
  pages: z.number().int(),
  duration_seconds: z.number().nullable(),
  received_at: Timestamp,
});
export type ThreadFile = z.infer<typeof ThreadFile>;

export const FileEvent = z.object({
  attachment_id: z.number().int(),
  action: z.string(),
  actor: z.string(),
  actor_email: z.string().nullable(),
  reason: z.string().nullable(),
  at: Timestamp,
});

const ThreadParams = z.object({ threadId: z.uuid() });
const FileParams = z.object({ id: Id });

export const getThreadFiles = defineRoute({
  method: 'GET',
  path: '/api/moderate/files/:threadId',
  summary: "The files of a report's current version, and what the reporter permits.",
  params: ThreadParams,
  response: z.object({
    may_publish: z.boolean(),
    files_permitted: z.boolean(),
    /** The reporter withdrew it: its files were taken down and stay down. */
    withdrawn: z.boolean(),
    files: z.array(ThreadFile),
    events: z.array(FileEvent),
  }),
});

/** One report in the files queue, or the one a reference names. */
export const FileReport = z.object({
  thread_id: z.string(),
  /** The current version's reference. */
  public_ref: z.string(),
  logbook_title: z.string(),
  received_at: Timestamp,
  files: z.number().int(),
  /** Withheld, not erased, and nobody has decided on it yet. */
  undecided: z.number().int(),
  published: z.number().int(),
  may_publish: z.boolean(),
  files_permitted: z.boolean(),
  withdrawn: z.boolean(),
});
export type FileReport = z.infer<typeof FileReport>;

export const listFileReports = defineRoute({
  method: 'GET',
  path: '/api/moderate/files',
  summary:
    'Reports with files nobody has decided on yet, oldest first; or, with a reference, that one report.',
  query: z.object({ ref: z.string().max(100).optional() }),
  response: z.object({ reports: z.array(FileReport) }),
});

export const setFilePublication = defineRoute({
  method: 'POST',
  path: '/api/moderate/files/file/:id/publication',
  summary:
    "Publish, withhold or refuse one file. Publishing needs alt text and the reporter's permission.",
  params: FileParams,
  body: z.object({
    publication: z.enum(['published', 'withheld', 'refused']),
    alt_text: z.string().max(1000).optional(),
    reason: z.string().max(2000).optional(),
  }),
  response: z.object({ ok: z.literal(true) }),
});

export const getReportFilesForErasing = defineRoute({
  method: 'GET',
  path: '/api/admin/files/report/:ref',
  summary: "A report's files, by its reference, for an administrator choosing one to erase.",
  params: z.object({ ref: z.string().max(100) }),
  response: z.object({
    thread_id: z.string(),
    public_ref: z.string(),
    files: z.array(ThreadFile),
  }),
});

export const eraseFile = defineRoute({
  method: 'POST',
  path: '/api/admin/files/file/:id/erase',
  summary:
    'Erase one file by destroying its key. Its fingerprint stays in the report. Irreversible.',
  params: FileParams,
  body: z.object({ reason: z.string().max(2000).optional() }),
  response: z.object({ ok: z.literal(true) }),
});

// ── evidence requests: the moderator's side ─────────────────────────────

export const EvidenceAsk = z.object({
  id: z.number().int(),
  asked_by: z.string(),
  asked_at: Timestamp,
  message: z.string(),
  expires_at: Timestamp,
  used_at: Timestamp.nullable(),
  cancelled_at: Timestamp.nullable(),
  expired_at: Timestamp.nullable(),
});

export const getEvidenceState = defineRoute({
  method: 'GET',
  path: '/api/moderate/evidence/:threadId',
  summary: 'Whether this reporter may be asked for evidence, and every ask so far.',
  params: ThreadParams,
  response: z.object({
    askable: z.boolean(),
    /** Why not, in a sentence, when not. */
    why_not: z.string().nullable(),
    declared: z.boolean(),
    permitted: z.boolean(),
    open: EvidenceAsk.nullable(),
    history: z.array(EvidenceAsk),
  }),
});

export const askForEvidence = defineRoute({
  method: 'POST',
  path: '/api/moderate/evidence/:threadId',
  summary: 'Email the reporter a link to send what they said they had.',
  params: ThreadParams,
  body: z.object({ message: z.string().max(5000).optional() }),
  response: z.object({ ok: z.literal(true), expires_at: Timestamp }),
});

export const cancelEvidenceAsk = defineRoute({
  method: 'DELETE',
  path: '/api/moderate/evidence/:threadId',
  summary: 'Withdraw the open ask. Its link stops working; the record of asking stays.',
  params: ThreadParams,
  response: z.object({ cancelled: z.number().int() }),
});

// ── evidence requests: the reporter's side, through the emailed link ────

const TokenParams = z.object({ token: z.string().max(100) });

export const getEvidenceRequest = defineRoute({
  method: 'GET',
  path: '/api/evidence/:token',
  summary: 'What was asked, and what may be sent. Nothing about the report but its reference.',
  params: TokenParams,
  response: z.object({
    message: z.string(),
    asked_at: Timestamp,
    expires_at: Timestamp,
    public_ref: z.string(),
    logbook_title: z.string(),
    uploads: UploadConfig,
  }),
});

export const createEvidenceUpload = defineRoute({
  method: 'POST',
  path: '/api/evidence/:token/files',
  summary: 'Reserve a place for one file answering this request.',
  params: TokenParams,
  body: z.object({
    name: z.string().max(1000).optional(),
    type: z.string().max(200).optional(),
    size: z.number().optional(),
  }),
  response: z.object({ slot_token: z.string() }),
});

export const getEvidenceUploads = defineRoute({
  method: 'GET',
  path: '/api/evidence/:token/files',
  summary: 'Where each file sent for this request stands.',
  params: TokenParams,
  response: z.object({ files: z.array(UploadStatus) }),
});

export const removeEvidenceUpload = defineRoute({
  method: 'DELETE',
  path: '/api/evidence/:token/files/:slot',
  summary: 'Remove a file before sending.',
  params: z.object({ token: z.string().max(100), slot: z.string().max(100) }),
  response: z.object({ ok: z.literal(true) }),
});

export const sendEvidence = defineRoute({
  method: 'POST',
  path: '/api/evidence/:token/send',
  summary: 'Add the finished files to the report, as a new version of it. The link is then spent.',
  params: TokenParams,
  response: z.object({ public_ref: z.string(), attached: z.number().int() }),
});

// ── an administrator ────────────────────────────────────────────────────

const Layer = <T extends z.ZodType>(t: T) =>
  z.object({
    logbook: t.nullable(),
    site: t.nullable(),
    shipped: t,
    effective: t,
    source: z.enum(['logbook', 'site', 'shipped', 'both']),
  });

export const FileLimitLayers = z.object({
  maxImageBytes: Layer(z.number()),
  maxVideoBytes: Layer(z.number()),
  maxAudioBytes: Layer(z.number()),
  maxDocumentBytes: Layer(z.number()),
  maxVideoSeconds: Layer(z.number()),
  maxDocumentPages: Layer(z.number()),
  maxFiles: Layer(z.number()),
  maxTotalBytes: Layer(z.number()),
  kinds: Layer(z.array(FileKind)),
});
export type FileLimitLayers = z.infer<typeof FileLimitLayers>;

/** Limits as typed: a number, or null / '' to clear. Only the keys sent are written. */
const LimitsBody = z.looseObject({
  maxImageBytes: z.unknown().optional(),
  maxVideoBytes: z.unknown().optional(),
  maxAudioBytes: z.unknown().optional(),
  maxDocumentBytes: z.unknown().optional(),
  maxVideoSeconds: z.unknown().optional(),
  maxDocumentPages: z.unknown().optional(),
  maxFiles: z.unknown().optional(),
  maxTotalBytes: z.unknown().optional(),
  kinds: z.unknown().optional(),
});

export const FileSettings = z.object({
  /** Storage and FILES_KEY are set: without them nothing can be taken. */
  configured: z.boolean(),
  why_not: z.string().nullable(),
  /** The administrator's own switch: null when they have not used it. */
  enabled_stored: z.boolean().nullable(),
  /** Whether files are taken now. */
  enabled: z.boolean(),
  limits: FileLimitLayers,
});
export type FileSettings = z.infer<typeof FileSettings>;

export const getFileSettings = defineRoute({
  method: 'GET',
  path: '/api/admin/files/settings',
  summary: "The site's file switch, kinds and limits, each with where it comes from.",
  response: FileSettings,
});

export const setFileSettings = defineRoute({
  method: 'PUT',
  path: '/api/admin/files/settings',
  summary: "Change the site's file switch, kinds or limits. Only what is sent changes.",
  body: LimitsBody.extend({ enabled: z.boolean().nullable().optional() }),
  response: FileSettings,
});

export const getLogbookFileLimits = defineRoute({
  method: 'GET',
  path: '/api/admin/files/logbooks/:id/limits',
  summary: "A logbook's own file kinds and limits, over the site's.",
  params: FileParams,
  response: FileLimitLayers,
});

export const setLogbookFileLimits = defineRoute({
  method: 'PUT',
  path: '/api/admin/files/logbooks/:id/limits',
  summary: "Change a logbook's file kinds or limits, launched or not. Only what is sent changes.",
  params: FileParams,
  body: LimitsBody,
  response: FileLimitLayers,
});
