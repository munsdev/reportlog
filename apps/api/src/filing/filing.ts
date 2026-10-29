/**
 * Sending a report, and confirming it from the emailed link.
 *
 * WHERE THE FORM ASKS FOR AN EMAIL, TWO STEPS, AND NOTHING IS FILED AT THE
 * FIRST. Sending checks everything and keeps the checked submission in
 * `report_submissions`; the report enters its logbook's chain only when the
 * reporter follows the link in their email. So an address nobody controls
 * never takes a place in a chain.
 *
 * WHERE IT DOES NOT, ONE STEP: SEALED ON ARRIVAL (owner decision E1). A form
 * that asks nothing anybody types and takes no files is an advanced contact
 * form (@reportlog/fields `formAsksEmail`). Its report is checked exactly as
 * any other and sealed into its chain inside the request's transaction:
 * nothing waits in `report_submissions`, no link is sent, and no contact row
 * is written, so there is no address to confirm, to sign in with, to correct
 * or withdraw from, or to tell of a decline. Hidden until a moderator
 * accepts it, like every report.
 *
 * THE SPINE is what every report is asked, whichever logbook asked the rest:
 * an address to reach the reporter (only where the form asks for one: it is
 * never sealed either way, so its absence changes no fingerprint), their
 * consent to the statement on the last card, and whether it may be
 * published. Everything else is the logbook's own questions, checked by
 * `buildAnswers` against them.
 *
 * WHAT IS SEALED IS WHAT WAS CHECKED. The answers, the publication answer
 * and the form version are kept with the token and sealed from there at
 * confirmation; a second request cannot change them. The form version is
 * the one the reporter was asked, not whatever it has become by the click.
 *
 * A GET ON THE LINK NEVER FILES. Mail scanners open links. Looking is a GET;
 * filing is a deliberate POST from the page the link opens.
 */
import type { Confirmation } from '@reportlog/contracts';
import {
  LIMITED_KINDS,
  buildAnswers,
  buildHeldValues,
  holdsAnything,
  maxLinksOf,
  normalizeAnswer,
  strictProblems,
  withoutWording,
} from '@reportlog/fields';
import type { FieldDefinition, FieldSettings } from '@reportlog/fields';
import { formDefinition, normalizeReportFields } from '@reportlog/seal';
import type { FormDefinition, FormQuestion } from '@reportlog/seal';
import type { Answers } from '@reportlog/fields';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Kysely, Transaction } from 'kysely';
import { appendReportVersion } from '../chain/append.ts';
import { ensureFormVersion } from '../chain/forms.ts';
import { prepareHeld } from '../chain/held.ts';
import type { LinkKeys } from '../links/keys.ts';
import { hasStagedHeld, stageHeld, takeStagedHeld } from '../reportValues/store.ts';
import { questionsFor } from '../chain/questions.ts';
import { isKnownDigest } from '../consent/cards.ts';
import { publicArchiveAvailable } from '../board/publication.ts';
import { isPublic } from '../board/published.ts';
import { countsOnlyLogbooks } from '../moderation/switches.ts';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { fileOutcome, releaseForSubmission, sealFiles, stillPreparing } from '../files/filing.ts';
import { draftFrom, filesFrozen, stagedFileNames } from '../files/slots.ts';
import { HttpError } from '../http/errors.ts';
import { looksLikeEmail, normalizeEmail, randomToken, sha256Hex } from '../identity/secrets.ts';
import { logbookBySlug } from '../logbooks/logbooks.ts';
import { flagReport } from '../moderation/flags.ts';
import { sealContact } from './contactKeys.ts';
import type { ContactKeyring } from './contactKeys.ts';
import { setPermission } from '../permissions/log.ts';
import { intakeIsOpen } from './intakeSwitch.ts';
import {
  DEFAULT_LINK_DAYS,
  TRY_LATER,
  countAddressToday,
  filingLimits,
  linkLife,
} from './limits.ts';

/**
 * How long a confirmation link lasts when nobody has set otherwise: 90 days
 * (D15), read at each Send from the filing settings (limits.ts). A held
 * report keeps the `expires_at` it was given; changing the setting moves
 * only the reports sent after. A report whose link runs out unused is
 * deleted whole, address included, by the nightly sweep.
 */
export const LINK_TTL_MS = DEFAULT_LINK_DAYS * 24 * 60 * 60 * 1000;

export const refused = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);

export const intakeClosed = () =>
  refused(503, 'intake_closed', 'This site is not taking new reports at the moment.');

export const notConfigured = () =>
  refused(
    503,
    'not_configured',
    'This site cannot take reports yet: its operator has not set the key that protects reporters’ addresses.',
  );

/** What a submission stores and the seal is made from. */
interface StagedPayload {
  answers?: Answers;
  may_publish: boolean;
  may_publish_digest: string;
}

export interface Submission {
  logbook?: string | undefined;
  email?: string | undefined;
  consent?: boolean | undefined;
  answers?: Record<string, unknown> | undefined;
  may_publish?: boolean | undefined;
  may_publish_digest?: string | undefined;
  /** The files workstream's draft: the files staged while this was written. */
  draft_token?: string | undefined;
  /** The hash of the form version the page showed. */
  form?: string | undefined;
  /** G5: may journalists be shown the checked text and links. Not answering is no. */
  journalist_sharing?: boolean | undefined;
}

export interface FilingDeps {
  db: Kysely<DB>;
  mailer: Mailer;
  siteOrigin: string;
  ring: ContactKeyring | null;
  publicRefPrefix: string;
  /** Whether this site is taking files at all (the site-wide switch). */
  filesOn?: () => Promise<boolean>;
  /**
   * The keys a report's held text and links are kept under (reportValues/).
   * Null on a site without CONTACT_KEY, which then takes no held value.
   */
  linkKeys?: (() => Promise<LinkKeys>) | null;
}

export const confirmEmail = (
  logbookTitle: string,
  link: string,
  eraseLink?: string,
  days: number = DEFAULT_LINK_DAYS,
) => ({
  // The action first: a reporter who stops after the first line must know
  // the report is not filed yet (owner, 29 October 2026).
  subject: 'Action needed: confirm your report, or it won’t be filed',
  text:
    'Your report is not filed yet.\n\n' +
    `To file it, open this link and press “Confirm and file my report”:\n\n` +
    `${link}\n\n` +
    `Until you do, nothing is filed and nobody sees it. The link works for ${linkLife(days)}. If you don’t use it by then, your report and your email address are deleted.\n\n` +
    `(This is for your report to “${logbookTitle}”. If you didn’t send it, ignore this email. Nothing happens without the link.)` +
    (eraseLink
      ? '\n\n---\n\n' +
        'After your report is filed: you can have your email address erased at any time, without an account. ' +
        `Open this link and press the button. Nothing changes until you do, and your report stays filed:\n\n${eraseLink}`
      : ''),
});

/**
 * THE STRICT READING, for every path that seals (ruling 49, the voting
 * questionnaires §01). Refused, each in a sentence:
 *
 *   L7  a key the logbook does not ask. The shared `buildAnswers` still drops
 *       it (a list's form left open in a tab must not fail), so this runs only
 *       where a report is sealed. It is the reason a logbook with no text
 *       question cannot be sent free text under some other name (L3).
 *       an answer to a question whose "only if" does not hold, or whose option
 *       sets offer this reporter nothing. The form never sends one; anything
 *       that does is not the form.
 *       a value the question does not take: a choice not in its (conditional)
 *       list, a county outside its state, an hour that is not 0 to 23. For a
 *       required question `buildAnswers` already says "is needed"; an OPTIONAL
 *       one would otherwise lose the answer without a word.
 *
 * A blank value is not an answer and is never refused.
 */
export function answerRefusals(
  questions: readonly FieldDefinition[],
  body: Record<string, unknown>,
): string[] {
  const problems = strictProblems(questions, body);
  const label = (key: string) => questions.find((q) => q.key === key)?.label ?? key;
  const unknown = problems.filter((p) => p.reason === 'unknown').map((p) => p.key);
  const hidden = problems.filter((p) => p.reason === 'not-asked').map((p) => label(p.key));
  // A real day or time outside the question's limits (owner decision E4) is
  // said as that, not as a choice that was not offered.
  const outside = (key: string) => {
    const q = questions.find((x) => x.key === key);
    return Boolean(
      q && LIMITED_KINDS.has(q.kind) && normalizeAnswer(q.kind, body[key], {}) !== null,
    );
  };
  const notAccepted = problems.filter((p) => p.reason === 'not-accepted');
  const bad = notAccepted.filter((p) => !outside(p.key)).map((p) => label(p.key));
  const late = notAccepted.filter((p) => outside(p.key)).map((p) => label(p.key));
  return [
    ...(unknown.length
      ? [
          `This report has an answer the form did not ask for (${unknown.join(', ')}). Reload the page and try again.`,
        ]
      : []),
    ...(hidden.length
      ? [
          `This report answers a question that, given your other answers, is not asked (${hidden.join(', ')}). Reload the page and try again.`,
        ]
      : []),
    ...bad.map((l) => `${l} must be one of the choices offered.`),
    ...late.map((l) => `${l} is outside the dates or times this form takes.`),
  ];
}

/**
 * A COORDINATOR FILES NO HELD VALUE YET. Their paths (intake.ts,
 * intakeCorrection.ts) seal through `appendReportVersion` like any other, but
 * nothing carries a held value from a batch or a paper form into the store,
 * so one sent is refused rather than dropped without a word.
 */
export function coordinatorHeldRefusals(
  questions: readonly FieldDefinition[],
  body: Record<string, unknown>,
  answers: Answers | undefined,
): string[] {
  const built = buildHeldValues(questions, body, answers);
  if (holdsAnything(built.held) || built.problems.length) {
    return [
      'Text and links that are never published cannot be filed for somebody else yet. Leave them out.',
    ];
  }
  if (built.errors.length) {
    return ['This logbook needs text or a link that cannot be filed for somebody else yet.'];
  }
  return [];
}

/** The held values a submission sent that are not ones its question takes, as sentences. */
export function heldRefusals(
  questions: readonly FieldDefinition[],
  problems: readonly { key: string; reason: 'not-accepted' | 'too-many' }[],
): string[] {
  return problems.map((p) => {
    const q = questions.find((x) => x.key === p.key);
    const label = q?.label ?? p.key;
    if (p.reason === 'too-many') {
      const n = maxLinksOf(q?.settings);
      return `${label} takes at most ${String(n)} link${n === 1 ? '' : 's'}.`;
    }
    return q?.kind === 'private_link'
      ? `${label} must be a web address starting with http:// or https://.`
      : `${label} must be written as text.`;
  });
}

/**
 * THE VERSION THIS REPORTER WAS ACTUALLY ASKED. Normally the current one. But
 * a launched logbook may be reworded (ruling 48), so the page that was open
 * may have shown words that have since changed. When the page says which
 * version it showed, and that version differs from today's ONLY IN WORDING
 * (the same questions, in the same order, asked the same way, with the same
 * codes), that version is sealed: it is the text the reporter read, and the
 * answers checked against today's questions mean the same under it.
 *
 * Anything else (an unknown hash, a version with a question since added) seals
 * today's version, as before: the answers were checked against today's.
 */
export async function formAsked(
  db: Kysely<DB>,
  lb: { id: number; slug: string; launched_at: Date | string | null },
  questions: readonly FieldDefinition[],
  shown: string | undefined,
): Promise<{ id: number; hash: string }> {
  const current = await ensureFormVersion(db, lb, questions);
  if (!shown || shown === current.hash || !/^[a-f0-9]{64}$/.test(shown)) return current;
  const row = await db
    .selectFrom('logbook_forms')
    .select(['id', 'form_hash', 'definition'])
    .where('logbook_id', '=', lb.id)
    .where('form_hash', '=', shown)
    .executeTakeFirst();
  if (!row) return current;
  const skeleton = (qs: readonly FormQuestion[]) =>
    JSON.stringify(
      canonical(
        qs.map((q) => [
          q.key,
          q.kind,
          q.required,
          q.shown_when ?? null,
          withoutWording(q.settings as FieldSettings),
        ]),
      ),
    );
  let then: FormDefinition;
  try {
    then = JSON.parse(row.definition) as FormDefinition;
  } catch {
    return current;
  }
  const now = formDefinition(lb.slug, questions);
  return skeleton(then.questions) === skeleton(now.questions)
    ? { id: row.id, hash: row.form_hash }
    : current;
}

/** Keys in one order, so two settings objects compare as values. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === 'object' && v !== null) {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/**
 * Check a submission and keep it for confirmation. Every refusal is a
 * sentence, and they come in the order that tells the truth about why:
 * a closed site before a missing answer, because telling somebody an answer
 * is missing when the site was never going to take their report is a lie
 * about why they were refused.
 */
/**
 * Returns the names of any files dropped at Send because the logbook's
 * uploads were frozen while the report was written (decision 17), so the
 * reporter is told on the page that says "check your email".
 */
export async function stageSubmission(
  deps: FilingDeps,
  b: Submission,
): Promise<{ filed: false; filesDropped: string[] } | { filed: true; publicRef: string }> {
  const { db } = deps;
  if (!(await intakeIsOpen(db))) throw intakeClosed();

  const slug = typeof b.logbook === 'string' ? b.logbook.trim() : '';
  if (!slug) throw refused(400, 'no_logbook', 'Choose which logbook this report is for.');
  const lb = await logbookBySlug(db, slug);
  if (!lb || lb.state === 'draft')
    throw refused(404, 'not_found', 'There is no logbook at that address.');
  if (lb.state !== 'open') {
    throw refused(
      503,
      'logbook_closed',
      lb.state === 'scheduled'
        ? 'That logbook has not opened yet.'
        : 'That logbook is closed and is not taking reports.',
    );
  }

  // The questions these answers are checked against, as a version. Sealed
  // at confirmation, so what is sealed is the form this person was asked.
  const allQuestions = await questionsFor(db, lb.id);
  // Where the operator has not turned on attached notes (N1), the held
  // questions are not asked: a value sent for one is refused below rather than
  // dropped, and they do not make the form offer an address.
  const questions = lb.accepts_notes ? allQuestions : allQuestions.filter((q) => !isHeld(q));
  // E1: derived from the questions, or the operator's switch (logbooks.ts).
  // Erasable text and links are NOT among the questions that oblige an
  // address (D8): the address is needed only when the reporter wrote
  // something, which is checked below.
  const asksEmail = lb.asks_email;
  const asksHeld = questions.some((q) => q.kind === 'private_text' || q.kind === 'private_link');
  // Only a form that keeps an address needs the key that protects it.
  if (asksEmail && !deps.ring) throw notConfigured();
  const email = normalizeEmail(b.email);
  // D8, D20: where the operator turned the optional card on, an address may
  // be given or skipped. Given, it holds the report until its link is
  // followed, exactly as for a form that requires one; skipped, the report
  // is filed at once. A blank is a skip. Off (NULL) for every logbook until
  // the owner turns it on (D21).
  const optionalCard = !asksEmail && (lb.email_optional || asksHeld);
  const holds = asksEmail || (optionalCard && email !== '');
  if (holds && !deps.ring) throw notConfigured();
  const problems: string[] = [];
  if ((asksEmail || (optionalCard && email !== '')) && !looksLikeEmail(email))
    problems.push('Enter an email address we can reach you at.');
  // An address sent to a form that does not ask for one is not kept, and not
  // quietly dropped either: the page that sent it is not this form.
  if (!lb.accepts_notes) {
    const sent = allQuestions.filter((q) => isHeld(q) && !isEmptyValue(b.answers?.[q.key]));
    if (sent.length)
      problems.push(
        'This logbook does not take an attached note or link. Reload the page and send it again.',
      );
  }
  if (!asksEmail && !optionalCard && email)
    problems.push(
      'This form does not ask for an email address. Reload the page and send it again.',
    );
  if (b.consent !== true) problems.push('Confirm the statement on the last card.');

  const form = await formAsked(db, lb, allQuestions, b.form);
  const { answers, errors } = buildAnswers(questions, b.answers ?? {});
  problems.push(...answerRefusals(questions, b.answers ?? {}));
  problems.push(...errors.map((e) => `${e}.`));
  // Text and links kept apart from the report, so they can be erased (W1).
  const built = buildHeldValues(questions, b.answers ?? {}, answers);
  problems.push(...built.errors.map((e) => `${e}.`), ...heldRefusals(questions, built.problems));
  // D8: words or a link need an address, so they can be corrected, withdrawn
  // or erased. Without either, the address stays as the form decided.
  if (holdsAnything(built.held) && !asksEmail && email === '')
    problems.push('Enter an email address we can reach you at, because you wrote something.');
  if (problems.length) throw refused(400, 'incomplete', problems.join(' '));
  const held = holdsAnything(built.held) ? built.held : undefined;
  // A held value is kept only for a report that waits for its link below.
  // Without the keys it cannot be kept at all.
  if (held && (!holds || !deps.linkKeys)) throw notConfigured();

  // The digest arrives from the client, so it is not trusted: it has to name
  // wording this site actually put on screen, and the general card's at that.
  //
  // AND IT HAS TO BE THE WORDING THIS LOGBOOK SHOWS. Where publication is a
  // condition of filing the reporter was told, not asked, so the only honest
  // record is `true` beside the terms' digest: a `false` there would seal an
  // answer to a question nobody put. Anywhere else the terms are refused,
  // because that reporter was asked.
  const digest = b.may_publish_digest ?? '';
  if (lb.publish_by_terms) {
    if (b.may_publish !== true || !(await isKnownDigest(db, digest, 'terms'))) {
      throw refused(
        400,
        'unknown_wording',
        'Reports filed here are published, and this page showed different terms. Reload the page and send it again.',
      );
    }
  } else if (!(await isKnownDigest(db, digest, 'general'))) {
    throw refused(
      400,
      'unknown_wording',
      'The question about publishing was not one this site asks. Reload the page and answer it again.',
    );
  }
  // NOT ANSWERING IS "NO". The card says so before anybody acts, and the
  // answer is sealed with the wording it answered either way.
  const payload: StagedPayload = {
    ...(answers ? { answers } : {}),
    may_publish: lb.publish_by_terms || b.may_publish === true,
    may_publish_digest: digest,
  };
  // Shaped exactly as it will be sealed, now, so a submission that cannot be
  // sealed is refused while the reporter is still here to hear it.
  normalizeReportFields({ logbook: lb.slug, ...payload });

  if (!holds) {
    // Files always ask for an address (E1), so a form without one has no
    // upload question and nothing can have been staged for it.
    if (b.draft_token) {
      const staged = await stagedFileNames(db, {
        draft: draftFrom(b.draft_token),
        logbookId: lb.id,
      });
      if (staged.length) {
        throw refused(
          409,
          'files_off',
          `This form does not take files, so your report was not sent. Remove ${staged.join(', ')} and send it again.`,
        );
      }
    }
    const publicRef = await db.transaction().execute(async (trx) => {
      const threadId = randomUUID();
      const { row: report } = await appendReportVersion(trx, {
        logbookId: lb.id,
        threadId,
        fields: normalizeReportFields({ logbook: lb.slug, ...payload }),
        formId: form.id,
        publicRefPrefix: deps.publicRefPrefix,
      });
      await startThread(trx, threadId, report);
      await recordSharing(trx, threadId, b.journalist_sharing === true);
      return report.public_ref;
    });
    return { filed: true, publicRef };
  }

  if (b.draft_token !== undefined && b.draft_token !== '') {
    // A FILING THAT CARRIES A FILE IS REFUSED WHILE UPLOADS ARE OFF (decision
    // 38), not filed with the file quietly left out: the reporter would
    // believe the evidence was in the record. Nothing has been stored yet,
    // so they can send again without it.
    const staged = await stagedFileNames(db, { draft: draftFrom(b.draft_token), logbookId: lb.id });
    if (staged.length && ((await filesFrozen(db, lb.id)) || !(await (deps.filesOn?.() ?? false)))) {
      throw refused(
        409,
        'files_off',
        `This site is not taking files at the moment, so your report was not sent. Remove ${staged.join(', ')} and send it again.`,
      );
    }
  }

  const token = randomToken();
  const ring = deps.ring;
  if (!ring) throw notConfigured();
  const limits = await filingLimits(db);
  const expiresAt = new Date(Date.now() + limits.link_days * 24 * 60 * 60 * 1000);
  const files = await db.transaction().execute(async (trx) => {
    // D5: counted before anything is kept, in this transaction, so a refusal
    // leaves nothing behind. Only a digest under a key of the day is stored.
    const { over } = await countAddressToday(trx, ring, email, limits.address_daily_cap);
    if (over) throw refused(429, 'try_later', TRY_LATER);
    const sub = await trx
      .insertInto('report_submissions')
      .values({
        token_hash: sha256Hex(token),
        logbook_id: lb.id,
        form_id: form.id,
        payload: JSON.stringify(payload),
        email,
        expires_at: expiresAt,
        journalist_sharing: b.journalist_sharing === true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // Never in `payload`, which outlives confirmation: encrypted, beside it.
    if (held && deps.linkKeys) await stageHeld(trx, await deps.linkKeys(), sub.id, held);
    // Files staged while the report was written now belong to it, and the
    // worker may start on them: nothing is worked on before Send. On a
    // logbook whose uploads were frozen meanwhile they are dropped instead.
    return releaseForSubmission(trx, {
      draftToken: b.draft_token,
      submissionId: sub.id,
      logbookId: lb.id,
      expiresAt,
    });
  });
  await deps.mailer.send({
    to: email,
    ...confirmEmail(
      lb.title,
      `${deps.siteOrigin}/file/confirm/${token}`,
      `${deps.siteOrigin}/file/erase/${token}`,
      limits.link_days,
    ),
  });
  return { filed: false, filesDropped: files.dropped };
}

const tokenLooksRight = (t: string) => /^[a-f0-9]{64}$/.test(t);

const linkNotFound = () =>
  refused(404, 'not_found', 'This link is not one this site sent, or it is no longer in use.');

async function submissionFor(db: Kysely<DB>, token: string) {
  if (!tokenLooksRight(token)) return undefined;
  return db
    .selectFrom('report_submissions as s')
    .innerJoin('logbooks as l', 'l.id', 's.logbook_id')
    .select([
      's.id',
      's.expires_at',
      's.confirmed_at',
      's.thread_id',
      'l.title as logbook_title',
      'l.slug as logbook_slug',
    ])
    .where('s.token_hash', '=', sha256Hex(token))
    .executeTakeFirst();
}

/** Where a confirmed thread stands, in the only words a reporter is given. */
async function threadState(
  db: Kysely<DB>,
  threadId: string,
  logbookTitle: string,
  submissionId?: number,
): Promise<Confirmation> {
  const head = await db
    .selectFrom('report_heads as h')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .select(['r.public_ref', 'r.may_publish', 'r.logbook_id', 'h.withdrawn', 'h.moderation_status'])
    .where('h.thread_id', '=', threadId)
    .executeTakeFirstOrThrow();
  const files = submissionId === undefined ? null : await fileOutcome(db, submissionId);
  const common = {
    logbook_title: logbookTitle,
    public_ref: head.public_ref,
    ...(files ? { files } : {}),
  };
  // The board's own rule (board/published.ts) AND its archive switch, so the
  // two cannot disagree: with the archive off, nothing is public, approved or
  // not (decisions.md §5).
  const archiveOpen = await publicArchiveAvailable(db);
  if (isPublic(head) && archiveOpen) {
    // A counts-only logbook (Plan E) counts an accepted report and shows it
    // nowhere, so it is "counted", never "public".
    const counted = (await countsOnlyLogbooks(db)).has(head.logbook_id);
    return { state: counted ? 'counted' : 'public', ...common };
  }
  return {
    state: 'received',
    ...common,
    ...(archiveOpen ? {} : { archive_closed: true as const }),
  };
}

export async function confirmationState(db: Kysely<DB>, token: string): Promise<Confirmation> {
  const row = await submissionFor(db, token);
  if (!row) throw linkNotFound();
  if (row.thread_id) return threadState(db, row.thread_id, row.logbook_title, row.id);
  // With the logbook's address, so the page can offer to file again.
  if (row.expires_at < new Date())
    return { state: 'expired', logbook_title: row.logbook_title, logbook_slug: row.logbook_slug };
  return {
    state: 'unconfirmed',
    logbook_title: row.logbook_title,
    expires_at: row.expires_at.toISOString(),
  };
}

/**
 * File the report. Pressing twice (or a scanner and then a person) files it
 * once: the row is locked and re-read inside the transaction, and stamped in
 * the same transaction as the report it produced, so the two never disagree.
 */
export async function confirmSubmission(
  deps: FilingDeps,
  token: string,
): Promise<{ confirmation: Confirmation; just_confirmed: boolean }> {
  const { db } = deps;
  const found = await submissionFor(db, token);
  if (!found) throw linkNotFound();
  if (!deps.ring) throw notConfigured();
  const ring = deps.ring;
  // Opened only for a report that holds a value: loading the keys makes the
  // link secret on first use, under whatever CONTACT_KEY is current.
  const linkKeys = deps.linkKeys ?? null;

  // Files still being prepared: this is not the moment to seal, because
  // confirming is the last moment the manifest can change. Nothing is
  // written and the link is not spent; pressing again later is how the
  // reporter comes back.
  if (!found.thread_id && found.expires_at >= new Date()) {
    const waiting = await stillPreparing(db, found.id);
    if (waiting.length) {
      return {
        confirmation: { state: 'preparing', logbook_title: found.logbook_title, files: waiting },
        just_confirmed: false,
      };
    }
  }

  const threadId = await db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('report_submissions as s')
      .innerJoin('logbooks as l', 'l.id', 's.logbook_id')
      .select([
        's.id',
        's.logbook_id',
        's.form_id',
        's.payload',
        's.email',
        's.journalist_sharing',
        's.expires_at',
        's.confirmed_at',
        'l.slug',
      ])
      .where('s.id', '=', found.id)
      .forUpdate('s')
      .executeTakeFirstOrThrow();
    if (row.confirmed_at || !row.email) return null;
    if (row.expires_at < new Date()) return null;
    return fileFromSubmission(trx, deps.publicRefPrefix, ring, linkKeys, {
      ...row,
      email: row.email,
    });
  });

  const confirmation = await confirmationState(db, token);
  return { confirmation, just_confirmed: threadId !== null };
}

async function fileFromSubmission(
  trx: Transaction<DB>,
  publicRefPrefix: string,
  ring: ContactKeyring,
  linkKeys: (() => Promise<LinkKeys>) | null,
  row: {
    id: number;
    logbook_id: number;
    form_id: number;
    payload: unknown;
    email: string;
    slug: string;
    journalist_sharing: boolean | null;
  },
): Promise<string> {
  const payload = row.payload as StagedPayload;
  const threadId = randomUUID();
  // The finished files, sealed into this version and linked to exactly it.
  const files = await sealFiles(trx, { submissionId: row.id }, threadId);
  // Its held text and links, removed from where they waited as they are
  // read, sealed as fingerprints and stored under fresh keys (W1).
  const waiting = await hasStagedHeld(trx, row.id);
  if (waiting && !linkKeys) throw notConfigured();
  const keys = waiting && linkKeys ? await linkKeys() : null;
  const staged = keys ? await takeStagedHeld(trx, keys, row.id) : undefined;
  const { row: report } = await appendReportVersion(trx, {
    logbookId: row.logbook_id,
    threadId,
    fields: normalizeReportFields({ logbook: row.slug, ...payload }),
    attachments: files.manifest,
    formId: row.form_id,
    publicRefPrefix,
    ...(staged && keys ? { held: { keys, rows: prepareHeld(staged) } } : {}),
  });
  await files.link(report.id);
  await startThread(trx, threadId, report);
  // Under a key of its own, so the reporter can have it erased later
  // without anything append-only being touched. See contactKeys.ts.
  await sealContact(trx, ring, { threadId, email: row.email, filedBy: 'reporter' });
  await recordSharing(trx, threadId, row.journalist_sharing === true);
  // The address leaves this table now: it lives on only under the key.
  await trx
    .updateTable('report_submissions')
    .set({ confirmed_at: sql`now()`, thread_id: threadId, email: null })
    .where('id', '=', row.id)
    .execute();
  return threadId;
}

/**
 * A new thread's head: where moderation will find it. Pending, never public.
 * Its words are read for the review flag in the same transaction, so a flag
 * and its report can never disagree (moderation/flags.ts never throws here).
 */
export async function startThread(
  trx: Transaction<DB>,
  threadId: string,
  report: { id: number; logbook_id: number; answers: unknown },
): Promise<void> {
  await trx
    .insertInto('report_heads')
    .values({ thread_id: threadId, current_report_id: report.id })
    .execute();
  await flagReport(trx, {
    reportId: report.id,
    threadId,
    logbookId: report.logbook_id,
    answers: report.answers,
  });
}

/**
 * G5: the sharing answer given at filing goes into the permissions log, the
 * reporter's own, and not into the sealed object. Only a yes is written: no
 * row already means no, and a log that says "no" for everyone who never
 * answered would claim a refusal nobody made.
 */
async function recordSharing(
  trx: Transaction<DB>,
  threadId: string,
  granted: boolean,
): Promise<void> {
  if (!granted) return;
  await setPermission(trx, { threadId, permission: 'journalist_sharing', granted: true });
}

const isHeld = (q: { kind: string }) => q.kind === 'private_text' || q.kind === 'private_link';

/** Nothing sent: absent, blank, or an empty list. */
const isEmptyValue = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.every((x) => isEmptyValue(x)));
