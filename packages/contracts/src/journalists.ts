/**
 * The journalist alert list: sign up, confirm by link, leave by link.
 *
 * Signing up collects a name, an outlet, an address and the states a
 * journalist covers, and nothing else. Being on the list grants no access
 * to anything that is not public.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

export const JournalistSignup = z.object({
  name: z.string().trim().min(1).max(120),
  outlet: z.string().trim().min(1).max(160),
  email: z.string().trim().min(3).max(254),
  /** Place codes such as `US-AZ`. */
  states: z.array(z.string().max(12)).min(1).max(60),
});
export type JournalistSignup = z.infer<typeof JournalistSignup>;

export const signUpForAlerts = defineRoute({
  method: 'POST',
  path: '/api/journalists/signup',
  summary:
    'Ask to be on the journalist alert list. Sends a confirmation email; the answer is the same whether or not the address is already known.',
  body: JournalistSignup,
  response: z.object({ ok: z.literal(true) }),
});

/**
 * What an emailed link says. `gone` is an unknown link and an expired one
 * alike, so the page cannot be used to learn whose address is on the list.
 */
export const AlertLink = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('pending'),
    /** Partly hidden: enough to tell one's own addresses apart. */
    address: z.string(),
    states: z.array(z.string()),
  }),
  z.object({
    state: z.literal('active'),
    address: z.string(),
    states: z.array(z.string()),
  }),
  z.object({ state: z.literal('confirmed'), address: z.string() }),
  z.object({ state: z.literal('stopped') }),
  z.object({ state: z.literal('gone') }),
]);
export type AlertLink = z.infer<typeof AlertLink>;

const LinkParams = z.object({ token: z.string().max(128) });

export const describeAlertConfirm = defineRoute({
  method: 'GET',
  path: '/api/journalists/confirm/:token',
  summary: 'What a confirmation link would do. Changes nothing: mail scanners open links.',
  params: LinkParams,
  response: AlertLink,
});

export const confirmAlerts = defineRoute({
  method: 'POST',
  path: '/api/journalists/confirm/:token',
  summary: 'Put the address on the alert list. Only this call does.',
  params: LinkParams,
  response: AlertLink,
});

export const describeAlertStop = defineRoute({
  method: 'GET',
  path: '/api/journalists/stop/:token',
  summary: 'What the unsubscribe link in an alert would do. Changes nothing.',
  params: LinkParams,
  response: AlertLink,
});

export const stopAlerts = defineRoute({
  method: 'POST',
  path: '/api/journalists/stop/:token',
  summary: 'Take the address off the alert list. No sign-in needed.',
  params: LinkParams,
  response: AlertLink,
});

// ── J7a: asking for vetted access ────────────────────────────────────────
//
// From the alert subscription: the subscriber gives their address, and if it
// is on the list an emailed link opens the request form. Text and links
// only; nothing is uploaded.

export const askForAccessLink = defineRoute({
  method: 'POST',
  path: '/api/journalists/access',
  summary:
    'Email a link to the access request form to an address on the alert list. The answer is the same for any address.',
  body: z.object({ email: z.string().trim().min(3).max(254) }),
  response: z.object({ ok: z.literal(true) }),
});

const WorkLink = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https?:\/\/[^\s]+$/i, 'A link starts with http:// or https://');

export const AccessRequestBody = z.object({
  outlet: z.string().trim().min(1).max(160),
  /** What they do there: reporter, editor, producer. */
  role: z.string().trim().min(1).max(120),
  /** Published work, so the owner can see who they are. */
  links: z.array(WorkLink).min(1).max(5),
  press_card_number: z.string().trim().max(80).optional(),
  press_card_issuer: z.string().trim().max(160).optional(),
});
export type AccessRequestBody = z.infer<typeof AccessRequestBody>;

/** What the emailed request link says. `gone` is unknown and expired alike. */
export const AccessLink = z.discriminatedUnion('state', [
  z.object({ state: z.literal('open'), address: z.string() }),
  z.object({ state: z.literal('pending'), address: z.string() }),
  z.object({ state: z.literal('approved'), address: z.string() }),
  z.object({ state: z.literal('gone') }),
]);
export type AccessLink = z.infer<typeof AccessLink>;

export const describeAccessLink = defineRoute({
  method: 'GET',
  path: '/api/journalists/access/:token',
  summary: 'What an access request link would do. Changes nothing.',
  params: LinkParams,
  response: AccessLink,
});

export const requestAccess = defineRoute({
  method: 'POST',
  path: '/api/journalists/access/:token',
  summary: 'Send an access request to the owner. Nothing is approved automatically.',
  params: LinkParams,
  body: AccessRequestBody,
  response: AccessLink,
});

// ── J7b, J7, J13: the owner's queue ──────────────────────────────────────

export const AccessRequestView = z.object({
  id: z.number().int(),
  name: z.string(),
  /** Partly hidden, as everywhere else the list shows an address. */
  address: z.string(),
  outlet: z.string(),
  role: z.string(),
  links: z.array(z.string()),
  press_card_number: z.string().nullable(),
  press_card_issuer: z.string().nullable(),
  states: z.array(z.string()),
  status: z.enum(['pending', 'approved', 'revoked']),
  requested_at: z.string(),
  decided_at: z.string().nullable(),
  decided_by: z.string().nullable(),
  revoked_at: z.string().nullable(),
});
export type AccessRequestView = z.infer<typeof AccessRequestView>;

export const listAccessRequests = defineRoute({
  method: 'GET',
  path: '/api/owner/journalists',
  summary: 'Access requests waiting, and journalists approved or revoked. The owner only.',
  response: z.object({ requests: z.array(AccessRequestView) }),
});

const RequestParams = z.object({ id: z.coerce.number().int().positive() });

export const approveAccessRequest = defineRoute({
  method: 'POST',
  path: '/api/owner/journalists/:id/approve',
  summary: 'Approve a request: the address becomes a journalist account. Recorded.',
  params: RequestParams,
  response: z.object({ ok: z.literal(true) }),
});

export const rejectAccessRequest = defineRoute({
  method: 'POST',
  path: '/api/owner/journalists/:id/reject',
  summary: 'Reject a request. What it said is deleted; the person stays on the alert list.',
  params: RequestParams,
  response: z.object({ ok: z.literal(true) }),
});

export const revokeJournalist = defineRoute({
  method: 'POST',
  path: '/api/owner/journalists/:id/revoke',
  summary: 'Take a journalist’s access away. Their next request is refused.',
  params: RequestParams,
  response: z.object({ ok: z.literal(true) }),
});

// ── J9 to J12: the desk ──────────────────────────────────────────────────
//
// Read-only and paginated, with a fixed page size: there is no export and no
// way to ask for everything at once (J11).

export const DESK_PAGE_SIZE = 20;

const PageQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).optional() });

/** One answer of a tip's multiple-choice questions, and how many tips gave it. */
export const DeskContext = z.object({
  question: z.string(),
  answers: z.array(z.object({ answer: z.string(), tips: z.number().int() })),
});

export const DeskLink = z.object({
  /** The URL as text. The site never makes it a link and never fetches it. */
  url: z.string(),
  /** How many tips carried it. */
  tips: z.number().int(),
  /** The moderator's comment for journalists, if there is one. */
  comment: z.string().nullable(),
  checked_at: z.string(),
  context: z.array(DeskContext),
});
export type DeskLink = z.infer<typeof DeskLink>;

export const DeskSource = z.object({
  title: z.string(),
  publisher: z.string().nullable(),
  published_on: z.string().nullable(),
  url: z.string(),
});

export const DeskReport = z.object({
  /** The public reference; the report itself is on the board. */
  reference: z.string(),
  note: z.string().nullable(),
  sources: z.array(DeskSource),
});
export type DeskReport = z.infer<typeof DeskReport>;

const Page = { page: z.number().int(), pages: z.number().int() };

export const deskLinks = defineRoute({
  method: 'GET',
  path: '/api/desk/links',
  summary: 'Checked links, one entry per link, a page at a time. Vetted journalists only.',
  query: PageQuery,
  response: z.object({ ...Page, links: z.array(DeskLink) }),
});

export const deskSources = defineRoute({
  method: 'GET',
  path: '/api/desk/sources',
  summary: 'Moderators’ Sources links and notes on published reports. Vetted journalists only.',
  query: PageQuery,
  response: z.object({ ...Page, reports: z.array(DeskReport) }),
});
