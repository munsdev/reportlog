/**
 * Plan D, moderation and the EU platform items (session 4b).
 *
 * One file for the lot, as the workstream rules ask: the rejection reasons
 * (M1, D2), batch approval (M2), the agreement a person accepts before they
 * act (M8, generic so journalists reuse it), the public form to report
 * illegal content (D1), the threat flag (D5), the link in the confirmation
 * email that erases a reporter's address (I5), and the line that goes beside
 * every number (P3).
 *
 * Bodies are typed loosely where the server refuses with a sentence a person
 * can act on, as in moderation.ts.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

const Ok = z.object({ ok: z.literal(true) });
const ThreadId = z.uuid();

// ── P3: the line beside every number ────────────────────────────────────

/**
 * Wherever a number appears, this line appears with it. The only copy of the
 * words: the API serves it with each figure (`not_a_sample`), the website
 * shows it through one component, and nothing else spells it out.
 */
export const NOT_A_SAMPLE =
  'These are reports people chose to file. They are not a sample and cannot be read as a rate.';

// ── M1, D2: why a report was turned down ────────────────────────────────

/**
 * The fixed list a rejection email draws its reason from. The reporter is
 * told one of these, in these words, and never a moderator's own sentence:
 * that stays on the record (`comment`) and is not sent.
 */
export const REJECTION_REASONS = [
  { code: 'not_first_hand', label: 'It is not a first-hand account of something that happened.' },
  { code: 'outside_scope', label: 'It is outside what this logbook records.' },
  {
    code: 'identifies_private_person',
    label: 'It identifies a private person in a way we cannot publish.',
  },
  {
    code: 'unlawful_content',
    label: 'It contains content that is unlawful or that we cannot host.',
  },
  { code: 'abusive_or_spam', label: 'It is abusive, or it is spam or an advertisement.' },
  { code: 'duplicate', label: 'It repeats a report already filed.' },
  { code: 'cannot_assess', label: 'We could not understand it well enough to assess it.' },
] as const;
export type RejectionReasonCode = (typeof REJECTION_REASONS)[number]['code'];
export const RejectionReasonCodeSchema = z.enum(
  REJECTION_REASONS.map((r) => r.code) as [RejectionReasonCode, ...RejectionReasonCode[]],
);

export const getRejectionReasons = defineRoute({
  method: 'GET',
  path: '/api/moderation/rejection-reasons',
  summary: 'The fixed list of reasons a rejection email can give.',
  response: z.object({
    reasons: z.array(z.object({ code: RejectionReasonCodeSchema, label: z.string() })),
  }),
});

// ── M2: batch approval ──────────────────────────────────────────────────

export const MAX_BATCH = 100;

export const batchApproveReports = defineRoute({
  method: 'POST',
  path: '/api/moderation/reports/batch-approve',
  summary: 'Approve many reports at once. One approval is recorded per report; no reason is asked.',
  body: z.object({ thread_ids: z.array(ThreadId).min(1).max(MAX_BATCH) }),
  response: z.object({
    approved: z.array(ThreadId),
    skipped: z.array(z.object({ thread_id: ThreadId, why: z.string() })),
  }),
});

// ── M8: the agreement ───────────────────────────────────────────────────

export const AGREEMENT_AUDIENCES = ['moderator', 'journalist'] as const;
export type AgreementAudience = (typeof AGREEMENT_AUDIENCES)[number];
export const AgreementAudienceSchema = z.enum(AGREEMENT_AUDIENCES);
const AudienceParams = z.object({ audience: AgreementAudienceSchema });

export const AgreementState = z.object({
  audience: AgreementAudienceSchema,
  /** Null until the owner publishes one: then there is nothing to accept. */
  current: z
    .object({
      version: z.number().int(),
      body: z.string(),
      digest: z.string(),
      published_at: z.string(),
    })
    .nullable(),
  /** Whether the signed-in person has accepted the newest text. */
  accepted: z.boolean(),
});
export type AgreementState = z.infer<typeof AgreementState>;

/**
 * The journalist agreement as a public standard (/standards?tab=journalists):
 * the newest published text, its version and date, for anybody past the site
 * password, so somebody can read the terms before asking for desk access.
 * Accepting it still needs an approved, signed-in journalist, and nothing
 * about who accepted is here. The moderator agreement is not offered.
 */
export const getJournalistStandard = defineRoute({
  method: 'GET',
  path: '/api/standards/journalist',
  summary: 'The newest published journalist agreement, to read before applying.',
  response: z.object({
    current: z
      .object({ version: z.number().int(), body: z.string(), published_at: z.string() })
      .nullable(),
  }),
});

export const getAgreement = defineRoute({
  method: 'GET',
  path: '/api/agreement/:audience',
  summary: 'The newest agreement for this audience, and whether the signed-in person accepted it.',
  params: AudienceParams,
  response: AgreementState,
});

export const acceptAgreement = defineRoute({
  method: 'POST',
  path: '/api/agreement/:audience/accept',
  summary: 'Accept the newest agreement. The digest says which words were read.',
  params: AudienceParams,
  body: z.object({ digest: z.string().optional() }),
  response: Ok,
});

export const publishAgreement = defineRoute({
  method: 'POST',
  path: '/api/admin/agreement/:audience',
  summary: 'Publish a new version of an agreement. Everyone accepts it again before they act.',
  params: AudienceParams,
  body: z.object({ body: z.string().optional() }),
  response: z.object({ version: z.number().int() }),
});

export const listAgreementAcceptances = defineRoute({
  method: 'GET',
  path: '/api/admin/agreement/:audience/acceptances',
  summary: 'Who accepted which version, and when.',
  params: AudienceParams,
  response: z.object({
    acceptances: z.array(
      z.object({ user_email: z.string(), version: z.number().int(), accepted_at: z.string() }),
    ),
  }),
});

// ── D1: report illegal content ──────────────────────────────────────────

export const CONTENT_DECISIONS = ['removed', 'restricted', 'no_action'] as const;
export type ContentDecision = (typeof CONTENT_DECISIONS)[number];

export const submitContentNotice = defineRoute({
  method: 'POST',
  path: '/api/illegal-content',
  summary: 'Report content on this site as illegal. A receipt is sent if an email is given.',
  body: z.object({
    where_found: z.string().optional(),
    explanation: z.string().optional(),
    good_faith: z.boolean().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  }),
  response: z.object({ receipt: z.string(), emailed: z.boolean() }),
});

export const ContentNoticeStatus = z.object({
  receipt: z.string(),
  received_at: z.string(),
  status: z.enum(['open', 'decided']),
  decision: z.enum(CONTENT_DECISIONS).nullable(),
  decision_reason: z.string().nullable(),
  decided_at: z.string().nullable(),
});
export type ContentNoticeStatus = z.infer<typeof ContentNoticeStatus>;

export const getContentNoticeStatus = defineRoute({
  method: 'GET',
  path: '/api/illegal-content/status/:token',
  summary: 'Where a notice stands, by the link emailed to its sender.',
  params: z.object({ token: z.string().min(10).max(200) }),
  response: ContentNoticeStatus,
});

export const ContentNoticeRow = z.object({
  id: z.number().int(),
  receipt: z.string(),
  where_found: z.string(),
  explanation: z.string(),
  sender_name: z.string().nullable(),
  has_email: z.boolean(),
  status: z.enum(['open', 'decided']),
  decision: z.enum(CONTENT_DECISIONS).nullable(),
  decision_reason: z.string().nullable(),
  created_at: z.string(),
});
export type ContentNoticeRow = z.infer<typeof ContentNoticeRow>;

export const listContentNotices = defineRoute({
  method: 'GET',
  path: '/api/moderation/illegal-content',
  summary: 'Notices of illegal content, open ones first.',
  response: z.object({ notices: z.array(ContentNoticeRow) }),
});

export const decideContentNotice = defineRoute({
  method: 'POST',
  path: '/api/moderation/illegal-content/:id/decision',
  summary:
    'Decide a notice, with a reason. The sender is emailed the decision if they gave an address.',
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ decision: z.string().optional(), reason: z.string().optional() }),
  response: z.object({ ok: z.literal(true), emailed: z.boolean() }),
});

// ── D5: threat to life or safety ────────────────────────────────────────

export const THREAT_SUBJECTS = ['report', 'tip'] as const;
export const ThreatSubject = z.enum(THREAT_SUBJECTS);

export const raiseThreat = defineRoute({
  method: 'POST',
  path: '/api/moderation/threats',
  summary: 'Flag a report or a tip as a threat to life or safety. The owner is emailed at once.',
  body: z.object({
    subject_kind: ThreatSubject.optional(),
    subject_ref: z.string().optional(),
    note: z.string().optional(),
  }),
  response: z.object({ ok: z.literal(true), owner_emailed: z.boolean() }),
});

export const clearThreat = defineRoute({
  method: 'POST',
  path: '/api/moderation/threats/clear',
  summary: 'Clear a threat flag, with a note. The flag and its clearing both stay on the record.',
  body: z.object({
    subject_kind: ThreatSubject.optional(),
    subject_ref: z.string().optional(),
    note: z.string().optional(),
  }),
  response: Ok,
});

export const listThreats = defineRoute({
  method: 'GET',
  path: '/api/moderation/threats',
  summary: 'Threat flags that are still raised.',
  response: z.object({
    threats: z.array(
      z.object({
        subject_kind: ThreatSubject,
        subject_ref: z.string(),
        note: z.string(),
        raised_by: z.string(),
        raised_at: z.string(),
      }),
    ),
  }),
});

// ── I5: erase your address from the confirmation email ──────────────────

export const EraseLinkLook = z.object({
  /** What pressing the button will do, in a sentence. Nothing changes on this call. */
  state: z.enum(['filed', 'not_yet_filed']),
  logbook_title: z.string(),
  public_ref: z.string().nullable(),
});
export type EraseLinkLook = z.infer<typeof EraseLinkLook>;

export const lookEraseLink = defineRoute({
  method: 'GET',
  path: '/api/erase/:token',
  summary: 'What the erase link in a confirmation email would do. Changes nothing.',
  params: z.object({ token: z.string().min(10).max(200) }),
  response: EraseLinkLook,
});

export const eraseViaLink = defineRoute({
  method: 'POST',
  path: '/api/erase/:token',
  summary: 'Destroy the key your address is kept under. The report stays; nothing is withdrawn.',
  params: z.object({ token: z.string().min(10).max(200) }),
  body: z.object({ confirm: z.boolean().optional() }),
  response: Ok,
});
