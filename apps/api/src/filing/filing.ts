/**
 * Sending a report, and confirming it from the emailed link.
 *
 * TWO STEPS, AND NOTHING IS FILED AT THE FIRST. Sending checks everything and
 * keeps the checked submission in `report_submissions`; the report enters
 * its logbook's chain only when the reporter follows the link in their
 * email. So an address nobody controls never takes a place in a chain.
 *
 * THE SPINE is what every report is asked, whichever logbook asked the rest:
 * an address to reach the reporter, their consent to the statement on the
 * last card, and whether it may be published. Everything else is the
 * logbook's own questions, checked by `buildAnswers` against them.
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
import { buildAnswers } from '@reportlog/fields';
import { normalizeReportFields } from '@reportlog/seal';
import type { Answers } from '@reportlog/fields';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Kysely, Transaction } from 'kysely';
import { appendReportVersion } from '../chain/append.ts';
import { ensureFormVersion } from '../chain/forms.ts';
import { questionsFor } from '../chain/questions.ts';
import { isKnownDigest } from '../consent/cards.ts';
import { isPublic } from '../board/published.ts';
import type { DB } from '../db/schema.gen.ts';
import type { Mailer } from '../email/mailer.ts';
import { fileOutcome, releaseForSubmission, sealFiles, stillPreparing } from '../files/filing.ts';
import { draftFrom } from '../files/slots.ts';
import { HttpError } from '../http/errors.ts';
import { looksLikeEmail, normalizeEmail, randomToken, sha256Hex } from '../identity/secrets.ts';
import { logbookBySlug } from '../logbooks/logbooks.ts';
import { flagReport } from '../moderation/flags.ts';
import { sealContact } from './contactKeys.ts';
import type { ContactKeyring } from './contactKeys.ts';
import { intakeIsOpen } from './intakeSwitch.ts';

/**
 * How long a confirmation link lasts. A day: somebody who files on a Friday
 * night and reads their mail on Sunday finds it dead, and that is a real
 * cost. Longer would keep an unconfirmed address in the clear for longer.
 */
export const LINK_TTL_MS = 24 * 60 * 60 * 1000;

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
}

export interface FilingDeps {
  db: Kysely<DB>;
  mailer: Mailer;
  siteOrigin: string;
  ring: ContactKeyring | null;
  publicRefPrefix: string;
}

export const confirmEmail = (logbookTitle: string, link: string) => ({
  subject: 'Confirm your report',
  text:
    `You sent a report to “${logbookTitle}”. To file it, open this link and press “Confirm and file my report”:\n\n` +
    `${link}\n\n` +
    'Nothing is filed until you do. The link works for 24 hours to confirm, and after that it shows you where your report stands.\n\n' +
    'If you did not send this, ignore this email. Nothing happens without the link.',
});

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
): Promise<{ filesDropped: string[] }> {
  const { db } = deps;
  if (!(await intakeIsOpen(db))) throw intakeClosed();
  if (!deps.ring) throw notConfigured();

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

  const email = normalizeEmail(b.email);
  const problems: string[] = [];
  if (!looksLikeEmail(email)) problems.push('Enter an email address we can reach you at.');
  if (b.consent !== true) problems.push('Confirm the statement on the last card.');

  // The questions these answers are checked against, as a version. Sealed
  // at confirmation, so what is sealed is the form this person was asked.
  const questions = await questionsFor(db, lb.id);
  const form = await ensureFormVersion(db, lb, questions);
  const { answers, errors } = buildAnswers(questions, b.answers ?? {});
  problems.push(...errors.map((e) => `${e}.`));
  if (problems.length) throw refused(400, 'incomplete', problems.join(' '));

  // The digest arrives from the client, so it is not trusted: it has to name
  // wording this site actually put on screen, and the general card's at that.
  const digest = b.may_publish_digest ?? '';
  if (!(await isKnownDigest(db, digest, 'general'))) {
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
    may_publish: b.may_publish === true,
    may_publish_digest: digest,
  };
  // Shaped exactly as it will be sealed, now, so a submission that cannot be
  // sealed is refused while the reporter is still here to hear it.
  normalizeReportFields({ logbook: lb.slug, ...payload });

  if (b.draft_token !== undefined && b.draft_token !== '') draftFrom(b.draft_token);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  const files = await db.transaction().execute(async (trx) => {
    const sub = await trx
      .insertInto('report_submissions')
      .values({
        token_hash: sha256Hex(token),
        logbook_id: lb.id,
        form_id: form.id,
        payload: JSON.stringify(payload),
        email,
        expires_at: expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
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
    ...confirmEmail(lb.title, `${deps.siteOrigin}/file/confirm/${token}`),
  });
  return { filesDropped: files.dropped };
}

const tokenLooksRight = (t: string) => /^[a-f0-9]{64}$/.test(t);

const linkNotFound = () =>
  refused(404, 'not_found', 'This link is not one this site sent, or it is no longer in use.');

async function submissionFor(db: Kysely<DB>, token: string) {
  if (!tokenLooksRight(token)) return undefined;
  return db
    .selectFrom('report_submissions as s')
    .innerJoin('logbooks as l', 'l.id', 's.logbook_id')
    .select(['s.id', 's.expires_at', 's.confirmed_at', 's.thread_id', 'l.title as logbook_title'])
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
    .select(['r.public_ref', 'r.may_publish', 'h.withdrawn', 'h.moderation_status'])
    .where('h.thread_id', '=', threadId)
    .executeTakeFirstOrThrow();
  const files = submissionId === undefined ? null : await fileOutcome(db, submissionId);
  return {
    // The board's own rule (board/published.ts), so the two cannot disagree.
    state: isPublic(head) ? 'public' : 'received',
    logbook_title: logbookTitle,
    public_ref: head.public_ref,
    ...(files ? { files } : {}),
  };
}

export async function confirmationState(db: Kysely<DB>, token: string): Promise<Confirmation> {
  const row = await submissionFor(db, token);
  if (!row) throw linkNotFound();
  if (row.thread_id) return threadState(db, row.thread_id, row.logbook_title, row.id);
  if (row.expires_at < new Date()) return { state: 'expired', logbook_title: row.logbook_title };
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
        's.expires_at',
        's.confirmed_at',
        'l.slug',
      ])
      .where('s.id', '=', found.id)
      .forUpdate('s')
      .executeTakeFirstOrThrow();
    if (row.confirmed_at || !row.email) return null;
    if (row.expires_at < new Date()) return null;
    return fileFromSubmission(trx, deps.publicRefPrefix, ring, {
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
  row: {
    id: number;
    logbook_id: number;
    form_id: number;
    payload: unknown;
    email: string;
    slug: string;
  },
): Promise<string> {
  const payload = row.payload as StagedPayload;
  const threadId = randomUUID();
  // The finished files, sealed into this version and linked to exactly it.
  const files = await sealFiles(trx, { submissionId: row.id }, threadId);
  const { row: report } = await appendReportVersion(trx, {
    logbookId: row.logbook_id,
    threadId,
    fields: normalizeReportFields({ logbook: row.slug, ...payload }),
    attachments: files.manifest,
    formId: row.form_id,
    publicRefPrefix,
  });
  await files.link(report.id);
  await startThread(trx, threadId, report);
  // Under a key of its own, so the reporter can have it erased later
  // without anything append-only being touched. See contactKeys.ts.
  await sealContact(trx, ring, { threadId, email: row.email, filedBy: 'reporter' });
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
