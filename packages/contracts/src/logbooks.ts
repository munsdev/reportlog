/**
 * Logbooks and the builder (workstream B).
 *
 * TWO AUDIENCES. What shapes a logbook is staff-only and lives under
 * /api/admin/. What a reporter needs (which logbooks are open, and what one
 * of them asks) is public, because the form has to render before anybody has
 * signed in. A draft is never public.
 *
 * Request bodies are typed loosely on purpose (a title is a string, not a
 * string of 1 to 120 characters): the module refuses with a sentence a person
 * can read, and a schema error would refuse first with one they cannot.
 */
import { z } from 'zod';
import { Cover } from './cover.ts';
import { defineRoute } from './route.ts';
import { PublicSocialLink } from './social.ts';

export const LogbookState = z.enum(['draft', 'scheduled', 'open', 'closed']);
export type LogbookState = z.infer<typeof LogbookState>;

/** `shown_when`: asked only when an earlier question's answer is one of `in`. */
export const Condition = z.object({ field: z.string(), in: z.array(z.string()) });
export type Condition = z.infer<typeof Condition>;

/**
 * The settings a question may carry. STRICT, because settings are sealed into
 * the form definition: a key nothing reads would still change the hash of
 * every report filed against it.
 */
/**
 * An offered answer: a plain string (its own code and label, as before), or
 * a code that is sealed with a label that is shown (ruling 48).
 */
export const OptionInput = z.union([z.string(), z.object({ code: z.string(), label: z.string() })]);
export type OptionInput = z.infer<typeof OptionInput>;

export const QuestionSettingsInput = z.strictObject({
  maxLength: z.number().int().optional(),
  options: z.array(OptionInput).optional(),
  /** In place of `options`: which list is offered depends on an earlier answer. */
  option_sets: z.array(z.object({ when: Condition, options: z.array(OptionInput) })).optional(),
  /** Help in place of the question's own while an earlier answer holds. */
  help_when: z.array(z.object({ when: Condition, help: z.string() })).optional(),
  /** On the first of several questions sharing a card: the card's own question. */
  card_question: z.string().optional(),
  /** Shown on the card of the question before it. */
  same_card: z.boolean().optional(),
  allowOther: z.boolean().optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  /** Whole numbers only. */
  integer: z.boolean().optional(),
  /** `hour`: the number is picked from the 24 hours. */
  picker: z.string().optional(),
  /** A yes/no asked as one tick box: true when ticked, nothing when not. */
  checkbox: z.boolean().optional(),
  scope: z.string().optional(),
  /** `county` asks for the county after the state; absent means state only. */
  depth: z.string().optional(),
  /** `postal` seals a state as AZ; `fips` seals a county as 04013 (with `within`). */
  code: z.string().optional(),
  /** On a `fips` county: the key of the earlier `postal` state question. */
  within: z.string().optional(),
  /** On a date, time or date and time: the earliest and latest answer taken (E4). */
  earliest: z.string().optional(),
  latest: z.string().optional(),
});
export type QuestionSettingsInput = z.infer<typeof QuestionSettingsInput>;

const Timestamp = z.string();
const Id = z.coerce.number().int().positive();

/** A question as the builder sees it. */
export const Question = z.object({
  id: z.number().int(),
  key: z.string(),
  kind: z.string(),
  label: z.string(),
  help: z.string().nullable(),
  required: z.boolean(),
  filterable: z.boolean(),
  shown_when: Condition.nullable(),
  settings: z.record(z.string(), z.unknown()),
  position: z.number().int(),
});
export type Question = z.infer<typeof Question>;

export const LogbookSummary = z.object({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  state: LogbookState,
  launched_at: Timestamp.nullable(),
  opens_at: Timestamp.nullable(),
  closes_at: Timestamp.nullable(),
  closed_at: Timestamp.nullable(),
  created_at: Timestamp,
  updated_at: Timestamp,
  question_count: z.number().int(),
  /** Whether it has an upload question. Derived, never stored. */
  asks_for_files: z.boolean(),
  /**
   * When somebody froze its uploads, or null. A protective handle beside
   * the upload question, not instead of it, and never sealed.
   */
  files_frozen_at: Timestamp.nullable(),
  /**
   * Whether it can be filed to without the site password. Set through the
   * identity workstream's door route; read here so the builder can show it.
   */
  outside_access: z.enum(['closed', 'link', 'door']),
  /** The operator's override: ask for an email even where the questions do not need one (E1). */
  email_required: z.boolean(),
  /** Whether the form asks for an email: derived from the questions, or the override (E1). */
  asks_email: z.boolean(),
  /**
   * Publication is a condition of filing: the reporter is told, not asked,
   * and the report seals may_publish = true beside the terms' digest.
   * Changeable after launch; never sealed itself.
   */
  publish_by_terms: z.boolean(),
  /** Whether the front page advertises it while it is open. Never sealed. */
  show_on_front: z.boolean(),
  /** A second web address that opens this logbook's form (/volunteer). Never sealed; changeable. */
  short_slug: z.string().nullable(),
  /** The first card's words and call to action (decision 78). Never sealed. */
  cover: Cover.nullable().optional(),
});
export type LogbookSummary = z.infer<typeof LogbookSummary>;

export const LogbookDetail = LogbookSummary.extend({ fields: z.array(Question) });
export type LogbookDetail = z.infer<typeof LogbookDetail>;

export const StartingPoint = z.object({
  id: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  questions: z.number().int(),
  takes_files: z.boolean(),
  /** Whether anything is typed, rather than chosen. */
  typed: z.boolean(),
});
export type StartingPoint = z.infer<typeof StartingPoint>;

/** A logbook as a file: what is downloaded, uploaded, and what a starting point is. */
export const LogbookFileQuestion = z.object({
  key: z.string().optional(),
  kind: z.string(),
  label: z.string(),
  help: z.string().optional(),
  required: z.boolean().optional(),
  filterable: z.boolean().optional(),
  shown_when: Condition.optional(),
  options: z.array(OptionInput).optional(),
  option_sets: z.array(z.object({ when: Condition, options: z.array(OptionInput) })).optional(),
  help_when: z.array(z.object({ when: Condition, help: z.string() })).optional(),
  card_question: z.string().optional(),
  same_card: z.boolean().optional(),
  allow_other: z.boolean().optional(),
  scope: z.string().optional(),
  depth: z.string().optional(),
  code: z.string().optional(),
  within: z.string().optional(),
  max_length: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  integer: z.boolean().optional(),
  picker: z.string().optional(),
  checkbox: z.boolean().optional(),
  earliest: z.string().optional(),
  latest: z.string().optional(),
});
export const LogbookFile = z.looseObject({
  reportlog_logbook: z.number(),
  title: z.string(),
  slug: z.string().optional(),
  blurb: z.string().optional(),
  accepts_files: z.boolean().optional(),
  /** The logbook's own upload caps (files workstream), only when it set them. */
  max_files: z.number().optional(),
  max_total_bytes: z.number().optional(),
  /** Whether moderators may attach editorial notes. Present only when true. */
  editorial_notes: z.boolean().optional(),
  /** `always`: ask for an email even where the questions do not need one (E1). Present only then. */
  ask_email: z.literal('always').optional(),
  questions: z.array(LogbookFileQuestion),
});
export type LogbookFile = z.infer<typeof LogbookFile>;

const Ok = z.object({ ok: z.literal(true) });
const LogbookParams = z.object({ id: Id });
const FieldParams = z.object({ id: Id, fieldId: Id });

// ── staff: the builder ──────────────────────────────────────────────────

export const listLogbooks = defineRoute({
  method: 'GET',
  path: '/api/admin/logbooks',
  summary: 'Every logbook, drafts included, newest first.',
  response: z.object({ logbooks: z.array(LogbookSummary) }),
});

export const listStartingPoints = defineRoute({
  method: 'GET',
  path: '/api/admin/logbooks/starting-points',
  summary: 'The question sets a new logbook can start from.',
  response: z.object({ starting_points: z.array(StartingPoint) }),
});

export const createLogbook = defineRoute({
  method: 'POST',
  path: '/api/admin/logbooks',
  summary: 'Make a draft logbook, from nothing or from a starting point.',
  body: z.object({
    title: z.string(),
    slug: z.string().optional(),
    blurb: z.string().optional(),
    starting_point: z.string().optional(),
  }),
  response: LogbookDetail,
});

export const createLogbookFromFile = defineRoute({
  method: 'POST',
  path: '/api/admin/logbooks/from-file',
  summary: 'Make a draft logbook from a logbook file.',
  body: z.object({ file: z.unknown() }),
  response: LogbookDetail,
});

export const getLogbook = defineRoute({
  method: 'GET',
  path: '/api/admin/logbooks/:id',
  summary: 'One logbook and its questions.',
  params: LogbookParams,
  response: LogbookDetail,
});

export const updateLogbook = defineRoute({
  method: 'PATCH',
  path: '/api/admin/logbooks/:id',
  summary:
    'Change the title or the description. Neither is part of the form, so both stay editable after launch.',
  params: LogbookParams,
  body: z.object({
    title: z.string().optional(),
    blurb: z.string().nullable().optional(),
    /** Ask for an email even where the questions do not need one (E1). Changeable after launch. */
    email_required: z.boolean().optional(),
    /** Publication as a condition of filing rather than a question. Changeable after launch. */
    publish_by_terms: z.boolean().optional(),
    /** Show it on the front page while it is open. Changeable after launch. */
    show_on_front: z.boolean().optional(),
    /** The short web address; null or blank clears it. */
    short_slug: z.string().nullable().optional(),
    /** The cover page; null clears it. Changeable after launch; never sealed. */
    cover: Cover.nullable().optional(),
  }),
  response: LogbookDetail,
});

export const deleteLogbook = defineRoute({
  method: 'DELETE',
  path: '/api/admin/logbooks/:id',
  summary: 'Delete a draft. A launched logbook is never deleted.',
  params: LogbookParams,
  response: z.object({ deleted: z.string() }),
});

export const addQuestion = defineRoute({
  method: 'POST',
  path: '/api/admin/logbooks/:id/fields',
  summary: 'Add a question. After launch, only an optional one.',
  params: LogbookParams,
  body: z.object({
    kind: z.string(),
    label: z.string(),
    key: z.string().optional(),
    help: z.string().nullable().optional(),
    required: z.boolean().optional(),
    filterable: z.boolean().optional(),
    settings: QuestionSettingsInput.optional(),
    shown_when: Condition.nullable().optional(),
  }),
  response: Question,
});

export const updateQuestion = defineRoute({
  method: 'PATCH',
  path: '/api/admin/logbooks/:id/fields/:fieldId',
  summary:
    'Change a question while the logbook is a draft. After launch, only its wording and whether it is a board filter.',
  params: FieldParams,
  body: z.object({
    label: z.string().optional(),
    help: z.string().nullable().optional(),
    required: z.boolean().optional(),
    filterable: z.boolean().optional(),
    settings: QuestionSettingsInput.optional(),
    shown_when: Condition.nullable().optional(),
  }),
  response: Question,
});

export const removeQuestion = defineRoute({
  method: 'DELETE',
  path: '/api/admin/logbooks/:id/fields/:fieldId',
  summary: 'Remove a question from a draft.',
  params: FieldParams,
  response: Ok,
});

export const reorderQuestions = defineRoute({
  method: 'PUT',
  path: '/api/admin/logbooks/:id/fields/order',
  summary: "Put a draft's questions in this order. Every question, once each.",
  params: LogbookParams,
  body: z.object({ ids: z.array(z.number().int()) }),
  response: Ok,
});

export const launchLogbook = defineRoute({
  method: 'POST',
  path: '/api/admin/logbooks/:id/launch',
  summary: 'Launch: open it to reporters and fix its questions for good.',
  params: LogbookParams,
  response: LogbookDetail,
});

export const setLogbookClosed = defineRoute({
  method: 'POST',
  path: '/api/admin/logbooks/:id/closed',
  summary: 'Close or reopen a launched logbook. Reversible.',
  params: LogbookParams,
  body: z.object({ closed: z.boolean() }),
  response: LogbookDetail,
});

export const setLogbookSchedule = defineRoute({
  method: 'PUT',
  path: '/api/admin/logbooks/:id/schedule',
  summary: 'When a launched logbook opens and closes. Null for no limit.',
  params: LogbookParams,
  body: z.object({ opens_at: z.string().nullable(), closes_at: z.string().nullable() }),
  response: LogbookDetail,
});

export const setLogbookFilesFrozen = defineRoute({
  method: 'POST',
  path: '/api/admin/logbooks/:id/files/freeze',
  summary:
    'Freeze or unfreeze uploads to a logbook. Allowed before and after launch; nothing sealed changes.',
  params: LogbookParams,
  body: z.object({ frozen: z.boolean() }),
  response: LogbookDetail,
});

export const downloadLogbookFile = defineRoute({
  method: 'GET',
  path: '/api/admin/logbooks/:id/file',
  summary: 'A logbook as a file: its title and its questions, not its reports.',
  params: LogbookParams,
  response: LogbookFile,
});

// ── public: what a reporter sees ────────────────────────────────────────

export const PlaceOption = z.object({ code: z.string(), name: z.string() });

/** A question as the reporter's form needs it, and nothing else. */
export const FormQuestion = z.object({
  key: z.string(),
  kind: z.string(),
  label: z.string(),
  help: z.string().optional(),
  required: z.boolean(),
  shown_when: Condition.optional(),
  settings: z.record(z.string(), z.unknown()),
  /** Only on a location question: the places its picker offers. */
  places: z
    .object({ subdivisions: z.array(PlaceOption), countries: z.array(PlaceOption) })
    .optional(),
});
export type FormQuestion = z.infer<typeof FormQuestion>;

export const PublicLogbookSummary = z.object({
  slug: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  state: LogbookState,
  questions: z.number().int(),
});

export const listPublicLogbooks = defineRoute({
  method: 'GET',
  path: '/api/logbooks',
  summary:
    'The logbooks taking reports now, or, with include=closed, every one that ever has (for the board).',
  query: z.object({ include: z.enum(['open', 'closed']).default('open') }),
  response: z.object({ logbooks: z.array(PublicLogbookSummary) }),
});

export const getPublicLogbook = defineRoute({
  method: 'GET',
  path: '/api/logbooks/:slug',
  summary: 'What one launched logbook asks. A draft is not found.',
  params: z.object({ slug: z.string().min(1).max(63) }),
  response: z.object({
    slug: z.string(),
    title: z.string(),
    blurb: z.string().nullable(),
    state: LogbookState,
    opens_at: Timestamp.nullable(),
    closes_at: Timestamp.nullable(),
    accepting: z.boolean(),
    asks_for_files: z.boolean(),
    /**
     * Whether the form asks for an email (E1). Without one, the report is sealed
     * on arrival and the reporter cannot come back to correct or withdraw it.
     */
    asks_email: z.boolean(),
    /**
     * Present only where publication is a condition of filing: the terms the
     * form shows instead of asking, and the digest to send back with them.
     */
    publication_terms: z
      .object({ heading: z.string(), body: z.array(z.string()), digest: z.string() })
      .optional(),
    fields: z.array(FormQuestion),
    /** The board's filters: only what the operator marked. None is built in. */
    filters: z.array(FormQuestion),
    /** The hash of the form version these questions are; sent back with a report. */
    form: z.string().optional(),
    /**
     * The emergency notice for the opening card (decision 62), in the
     * operator's words or what ships. Sent here because a door may not ask
     * for the site's wording, and the notice must be drawn on a door too.
     */
    help_now: z.string(),
    /** The site's call to action, with its heading and button (decision 78). */
    site_cta: z
      .object({
        heading: z.string(),
        body: z.string(),
        button_label: z.string(),
        button_url: z.string(),
      })
      .optional(),
    /** This logbook's cover page; absent where there is none. Never sealed. */
    cover: Cover.optional(),
  }),
});

// ── the front page's buttons ────────────────────────────────────────────

/**
 * What a button can lead to: a logbook, a list, a public map, one of the
 * site's own pages (`builtin`), or the row of social media icons (`social`).
 * Never an address typed in: there is no external link.
 */
export const ButtonKind = z.enum(['logbook', 'list', 'map', 'builtin', 'social']);

/** One stored entry. The order is the emphasis: the first is the accent. */
export const ArrangementEntry = z.object({
  kind: z.string(),
  ref: z.string(),
  label: z.string().nullable().optional(),
  /**
   * Hidden by the operator: never drawn, and never added back as a logbook
   * or list the arrangement does not mention (apps/api homeButtons.ts).
   */
  hidden: z.literal(true).optional(),
  /**
   * The second line, in the operator's words. Absent unless set: blank means
   * the target's own description, or none.
   */
  sub: z.string().nullable().optional(),
});
export type ArrangementEntry = z.infer<typeof ArrangementEntry>;

export const AvailableButton = z.object({
  kind: ButtonKind,
  ref: z.string(),
  label: z.string(),
  href: z.string().nullable(),
  action: z.string().nullable(),
  blurb: z.string().nullable(),
  help: z.string().nullable(),
  /** On the `social` button only: the accounts that are switched on, drawn as icons. */
  social: z.array(PublicSocialLink).optional(),
});
export type AvailableButton = z.infer<typeof AvailableButton>;

export const HomeButton = AvailableButton.extend({
  /** The record's own name, which a blank label falls back to. */
  title: z.string(),
  accent: z.boolean(),
});
export type HomeButton = z.infer<typeof HomeButton>;

export const getHomeButtons = defineRoute({
  method: 'GET',
  path: '/api/home-buttons',
  summary: "The front page's buttons, in order, with the accent on the first.",
  response: z.object({ buttons: z.array(HomeButton) }),
});

/**
 * Anything a button could lead to, whether or not it would be drawn now. The
 * editor lists them all, and marks the ones that would not show, with the
 * reason in words.
 */
export const ButtonTarget = AvailableButton.extend({
  showing: z.boolean(),
  why_not: z.string().nullable(),
});
export type ButtonTarget = z.infer<typeof ButtonTarget>;

export const HomeButtonsAdmin = z.object({
  buttons: z.array(HomeButton),
  /** Null when nobody has arranged the page; [] when every button was removed. */
  stored: z.array(ArrangementEntry).nullable(),
  available: z.object({
    logbooks: z.array(AvailableButton),
    lists: z.array(AvailableButton),
    builtins: z.array(AvailableButton),
    maps: z.array(AvailableButton),
    social: z.array(AvailableButton),
  }),
  /** Every possible target, showing or not. */
  targets: z.array(ButtonTarget),
  /**
   * The rows the editor starts from: the stored arrangement (or the shipped
   * one), with what the page would add at the end, minus the ones hidden.
   * Rows whose target would not draw are still here.
   */
  rows: z.array(ArrangementEntry),
});
export type HomeButtonsAdmin = z.infer<typeof HomeButtonsAdmin>;

export const getHomeButtonsAdmin = defineRoute({
  method: 'GET',
  path: '/api/admin/home-buttons',
  summary: 'What the front page shows, what is stored, and what could be on it.',
  response: HomeButtonsAdmin,
});

export const setHomeButtons = defineRoute({
  method: 'PUT',
  path: '/api/admin/home-buttons',
  summary: "Save the front page's order.",
  body: z.object({ order: z.array(ArrangementEntry) }),
  response: HomeButtonsAdmin,
});

export const clearHomeButtons = defineRoute({
  method: 'DELETE',
  path: '/api/admin/home-buttons',
  summary: 'Back to the shipped order.',
  response: HomeButtonsAdmin,
});
