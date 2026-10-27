/**
 * The journalist alert list: sign up, confirm by link, change or pause
 * alerts by link or from the desk, and leave.
 *
 * Signing up collects a name, an address and the states covered, and, for
 * somebody also asking for desk access (owner decision 69), their outlet
 * and the request. Being on the list grants no access to anything that is
 * not public; only the owner approving a request does.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

/** What a request for desk access says, apart from the outlet it is made from. */
export const AccessRequestDetails = z.object({
  /** What they do there: reporter, editor, producer. */
  role: z.string().trim().min(1).max(120),
  /**
   * Who they are, in their own words, so the owner can tell. Free text: the
   * form suggests links to published work but does not demand them, because
   * a freelancer or a local reporter may have none to give, and a list of
   * URLs was never the only way to show who somebody is.
   */
  about: z.string().trim().min(1).max(4000),
  press_card_number: z.string().trim().max(80).optional(),
  press_card_issuer: z.string().trim().max(160).optional(),
});

export const JournalistSignup = z.object({
  name: z.string().trim().min(1).max(120),
  /** Asked of somebody asking for desk access, and then required. */
  outlet: z.string().trim().max(160).optional(),
  email: z.string().trim().min(3).max(254),
  /** Absent means on. Off is for somebody who wants only desk access. */
  alerts: z.enum(['on', 'off']).optional(),
  /** Place codes such as `US-AZ`. At least one while alerts are on. */
  states: z.array(z.string().max(12)).max(60),
  /** Asking for desk access too. Sent to the owner once the address is confirmed. */
  access: AccessRequestDetails.optional(),
});
export type JournalistSignup = z.infer<typeof JournalistSignup>;

export const signUpForAlerts = defineRoute({
  method: 'POST',
  path: '/api/journalists/signup',
  summary:
    'Sign up for alerts, desk access, or both. Sends a confirmation email; the answer is the same whether or not the address is already known.',
  body: JournalistSignup,
  response: z.object({ ok: z.literal(true) }),
});

/**
 * Where a subscriber's request for desk access stands, as the pages behind
 * their own links show it. A revoked request reads `none`: they may ask again.
 */
export const DeskAccess = z.enum(['none', 'pending', 'approved']);
export type DeskAccess = z.infer<typeof DeskAccess>;

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
    alerts: z.enum(['on', 'off']),
    /** Whether confirming also sends a request for desk access. */
    desk: DeskAccess,
  }),
  z.object({
    state: z.literal('active'),
    address: z.string(),
    states: z.array(z.string()),
  }),
  z.object({ state: z.literal('confirmed'), address: z.string(), desk: DeskAccess }),
  /** Alerts are off; the address is still on the list (decision 47). */
  z.object({ state: z.literal('paused'), address: z.string() }),
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
  summary: 'What the stop link in an alert would do. Changes nothing.',
  params: LinkParams,
  response: AlertLink,
});

export const stopAlerts = defineRoute({
  method: 'POST',
  path: '/api/journalists/stop/:token',
  summary:
    'Turn alerts off, in one POST. The address stays on the list, with any desk access. No sign-in needed.',
  params: LinkParams,
  response: AlertLink,
});

// ── Alert settings (owner decision 47) ───────────────────────────────────
//
// The link in every alert opens a page to change the states and turn alerts
// off or on; a journalist on the desk changes the same two things there.

export const AlertSettingsBody = z.object({
  /** Place codes such as `US-AZ`, checked as on signup: at least one while alerts are on. */
  states: z.array(z.string().max(12)).max(60),
  alerts: z.enum(['on', 'off']),
});
export type AlertSettingsBody = z.infer<typeof AlertSettingsBody>;

export const AlertSettings = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('open'),
    address: z.string(),
    /** Place codes, so the page can show them as choices. */
    states: z.array(z.string()),
    alerts: z.enum(['on', 'off']),
    /** Their request for desk access, so the page can offer one or say where it stands. */
    desk: DeskAccess,
  }),
  z.object({ state: z.literal('removed') }),
  z.object({ state: z.literal('gone') }),
]);
export type AlertSettings = z.infer<typeof AlertSettings>;

export const describeAlertSettings = defineRoute({
  method: 'GET',
  path: '/api/journalists/settings/:token',
  summary: 'The alert settings the link in an alert opens. Changes nothing.',
  params: LinkParams,
  response: AlertSettings,
});

export const changeAlertSettings = defineRoute({
  method: 'POST',
  path: '/api/journalists/settings/:token',
  summary: 'Change the states and turn alerts on or off. The address stays on the list.',
  params: LinkParams,
  body: AlertSettingsBody,
  response: AlertSettings,
});

export const leaveAlertList = defineRoute({
  method: 'POST',
  path: '/api/journalists/settings/:token/remove',
  summary:
    'Remove the address from the list entirely. This also ends journalist desk access, if it was given.',
  params: LinkParams,
  response: AlertSettings,
});

export const deskAlertSettings = defineRoute({
  method: 'GET',
  path: '/api/desk/alerts',
  summary: 'The signed-in journalist’s own alert settings.',
  response: AlertSettings,
});

export const changeDeskAlerts = defineRoute({
  method: 'POST',
  path: '/api/desk/alerts',
  summary: 'Change the signed-in journalist’s own states, or turn their alerts on or off.',
  body: AlertSettingsBody,
  response: AlertSettings,
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

export const AccessRequestBody = AccessRequestDetails.extend({
  outlet: z.string().trim().min(1).max(160),
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

/** The same request, from the change page behind every alert (owner decision 69). */
export const requestAccessFromSettings = defineRoute({
  method: 'POST',
  path: '/api/journalists/settings/:token/access',
  summary:
    'Ask for desk access from the page an alert links to. Nothing is approved automatically.',
  params: LinkParams,
  body: AccessRequestBody,
  response: AlertSettings,
});

// ── J7b, J7, J13: the owner's queue ──────────────────────────────────────

export const AccessRequestView = z.object({
  id: z.number().int(),
  name: z.string(),
  /** Partly hidden, as everywhere else the list shows an address. */
  address: z.string(),
  outlet: z.string(),
  role: z.string(),
  /** Who they are, as they wrote it. Null on a request sent before it was asked. */
  about: z.string().nullable(),
  /** Links, from a request sent when the form still asked for a list of them. */
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

const PageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  /** Words to find (decision 72); the only free filter on the desk. */
  q: z.string().trim().max(100).optional(),
  /** `true` keeps what falls in the states the journalist chose for alerts. */
  mine: z.enum(['true', 'false']).optional(),
});

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
  /** How many reports carried it whose reporters allow journalists to read their links. */
  reports: z.number().int(),
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

/**
 * A written account on the desk (W5, D7): the NOTE a moderator wrote from a
 * reporter's account or a tip's description, and, for a report, only while
 * the reporter allows journalists to read it. Never the original. No email, no entry id, no thread id,
 * no moderator's address, and nothing to say what was removed.
 */
export const DeskText = z.object({
  text: z.string(),
  /** A report's public reference (it is public on the board). Null for a tip. */
  reference: z.string().nullable(),
  /** Where it said, as the board would: "Fulton County, Georgia". */
  place: z.string().nullable(),
  /** Always a note a moderator wrote. The reporter's own words appear only where quoted. */
  outcome: z.literal('redacted'),
  /** Whether it came from a report or the tip line. */
  source: z.enum(['report', 'tip']),
  checked_at: z.string(),
});
export type DeskText = z.infer<typeof DeskText>;

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

export const deskTexts = defineRoute({
  method: 'GET',
  path: '/api/desk/texts',
  summary:
    'Written accounts a moderator checked and the reporter allows journalists to read, a page at a time. Vetted journalists only.',
  query: PageQuery,
  response: z.object({ ...Page, texts: z.array(DeskText) }),
});
