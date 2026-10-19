/**
 * Correcting an account a coordinator filed, AS THE COORDINATOR'S OWN ACT.
 *
 * Not through "My reports": that page is the reporter's, and the
 * permissions on it are theirs to give. A coordinator correcting there would
 * be the operator acting under the reporter's name. So this is the
 * coordinator's screen, their attestation, and their own log
 * (`coordinator_actions`), and it writes nothing a reporter owns.
 *
 * SEALED UNDER A CORRECTION'S RULES (correction.ts): a new version in the
 * same thread and chain, against the logbook's questions as they are now,
 * carrying the files, back to pending. The provenance block is sealed again
 * in full: the organization's name as it is now (each version says what it
 * was filed through when it was filed), how it was collected, the day, and a
 * NEW attestation time, because the coordinator attests to this correction
 * as they attested to the batch. The coordinator stays outside the seal.
 *
 * WHO: the coordinator who filed it, while they still file for that
 * organization. The same narrow rule as batches, which a coordinator sees
 * only their own of. The design, and why, is in docs/status/C2-filing.md.
 */
import type { IntakeFiling } from '@reportlog/contracts';
import { buildAnswers } from '@reportlog/fields';
import { INTAKE_METHODS, normalizeReportFields } from '@reportlog/seal';
import type { Kysely } from 'kysely';
import { questionsFor } from '../chain/questions.ts';
import type { DB } from '../db/schema.gen.ts';
import { notFound } from '../http/errors.ts';
import { notAllowed } from '../identity/guards.ts';
import type { SignedIn } from '../identity/sessions.ts';
import { fieldsFor } from '../logbooks/logbooks.ts';
import { forForm } from '../logbooks/routes.ts';
import { appendCorrection, lockHead } from './correction.ts';
import { refused } from './filing.ts';
import { mayFileFor } from './intake.ts';

const notYours = () => notFound('There is no account you filed with that reference.');

export interface CorrectionBody {
  answers?: Record<string, unknown> | undefined;
  comment?: string | undefined;
  may_publish?: boolean | undefined;
  intake_method?: string | undefined;
  collected_on?: string | undefined;
  attested?: boolean | undefined;
}

export class IntakeCorrection {
  private readonly db: Kysely<DB>;
  private readonly publicRefPrefix: string;

  constructor(db: Kysely<DB>, publicRefPrefix: string) {
    this.db = db;
    this.publicRefPrefix = publicRefPrefix;
  }

  /**
   * The thread, if this person filed it. Found from the thread's FIRST
   * version to the staged account that filed it, which its trigger froze at
   * filing, and that account's batch. A 404 that does not say whether the
   * thread exists.
   */
  private async ownedFiling(user: SignedIn, threadId: string) {
    const row = await this.db
      .selectFrom('reports as first')
      .innerJoin('intake_drafts as d', 'd.report_id', 'first.id')
      .innerJoin('intake_batches as b', 'b.id', 'd.batch_id')
      .innerJoin('report_heads as h', 'h.thread_id', 'first.thread_id')
      .innerJoin('reports as r', 'r.id', 'h.current_report_id')
      .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
      .select((eb) => [
        'first.thread_id',
        'b.id as batch_id',
        'b.organization_id',
        'd.ordinal',
        'h.moderation_status',
        'r.id as report_id',
        'r.public_ref',
        'r.received_at',
        'r.answers',
        'r.may_publish',
        'r.may_publish_digest',
        'r.filed_via',
        'r.intake_method',
        'r.collected_on',
        'r.logbook_id',
        'l.slug as logbook_slug',
        'l.title as logbook_title',
        eb
          .selectFrom('reports as v')
          .whereRef('v.thread_id', '=', 'first.thread_id')
          .select((e) => e.fn.countAll<number>().as('n'))
          .as('versions'),
      ])
      .where('first.thread_id', '=', threadId)
      .where('first.corrects_id', 'is', null)
      .where('b.coordinator_id', '=', user.id)
      .executeTakeFirst();
    if (!row) throw notYours();
    return row;
  }

  async detail(user: SignedIn, threadId: string): Promise<IntakeFiling> {
    const row = await this.ownedFiling(user, threadId);
    const filed = await this.db
      .selectFrom('reports as r')
      .innerJoin('intake_drafts as d', 'd.report_id', 'r.id')
      .innerJoin('intake_batches as b', 'b.id', 'd.batch_id')
      .innerJoin('users as u', 'u.id', 'b.coordinator_id')
      .select(['r.public_ref', 'r.received_at', 'u.email'])
      .where('r.thread_id', '=', threadId)
      .executeTakeFirstOrThrow();
    const corrections = await this.db
      .selectFrom('coordinator_actions as a')
      .innerJoin('reports as r', 'r.id', 'a.report_id')
      .innerJoin('users as u', 'u.id', 'a.coordinator_id')
      .select(['r.public_ref', 'u.email', 'a.comment', 'a.created_at'])
      .where('a.thread_id', '=', threadId)
      .orderBy('a.id', 'desc')
      .execute();
    return {
      thread_id: row.thread_id,
      public_ref: row.public_ref,
      logbook_slug: row.logbook_slug,
      logbook_title: row.logbook_title,
      batch_id: row.batch_id,
      ordinal: row.ordinal,
      filed_via: row.filed_via ?? '',
      intake_method: row.intake_method ?? '',
      collected_on: row.collected_on,
      may_publish: row.may_publish,
      answers: (row.answers ?? {}) as Record<string, unknown>,
      questions: (await fieldsFor(this.db, row.logbook_id)).map(forForm),
      versions: row.versions ?? 1,
      received_at: row.received_at.toISOString(),
      moderation_status: row.moderation_status,
      history: [
        ...corrections.map((c) => ({
          action: 'correct' as const,
          public_ref: c.public_ref,
          by: c.email,
          comment: c.comment,
          at: c.created_at.toISOString(),
        })),
        {
          action: 'filed' as const,
          public_ref: filed.public_ref,
          by: filed.email,
          comment: null,
          at: filed.received_at.toISOString(),
        },
      ],
    };
  }

  async correct(user: SignedIn, threadId: string, b: CorrectionBody): Promise<string> {
    const owned = await this.ownedFiling(user, threadId);
    // Asked now, not when it was filed: somebody who has since left the
    // organization no longer acts in its name.
    if (!mayFileFor(user, owned.organization_id)) {
      throw notAllowed('You no longer file for this organization.');
    }
    const comment = b.comment?.trim() ?? '';
    const questions = await questionsFor(this.db, owned.logbook_id);
    const { answers, errors } = buildAnswers(questions, b.answers ?? {});
    const problems = errors.map((e) => `${e}.`);
    if (!comment) problems.push('Say why you are correcting it.');
    const method = b.intake_method ?? owned.intake_method ?? '';
    if (!INTAKE_METHODS.some((m) => m === method)) {
      problems.push('Say how the account was collected.');
    }
    // Left out, the day carries forward; '' says it is not known.
    const day = b.collected_on === undefined ? (owned.collected_on ?? '') : b.collected_on.trim();
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day))
      problems.push('The day it was collected is not a date.');
    if (problems.length) throw refused(400, 'incomplete', problems.join(' '));
    if (b.attested !== true) {
      throw refused(400, 'not_attested', 'The attestation is needed before a correction is filed.');
    }
    // The reporter's rule, for the same reason: tightening is allowed,
    // loosening would manufacture a permission the source never gave.
    if (b.may_publish === true && !owned.may_publish) {
      throw refused(
        400,
        'cannot_loosen',
        'A correction cannot give permission to publish that the report did not already have.',
      );
    }
    const attestedAt = new Date().toISOString();

    return this.db.transaction().execute(async (trx) => {
      const headId = await lockHead(trx, threadId);
      // A correction that landed since this was read would be corrected blind.
      if (headId !== owned.report_id) {
        throw refused(
          409,
          'moved_on',
          'This account was corrected again while you were working. Open it again and start from what it says now.',
        );
      }
      // The name as it is now, read inside the transaction: this is what is sealed.
      const org = await trx
        .selectFrom('organizations')
        .select('name')
        .where('id', '=', owned.organization_id)
        .executeTakeFirstOrThrow();
      const fields = normalizeReportFields({
        logbook: owned.logbook_slug,
        answers,
        may_publish: b.may_publish ?? owned.may_publish,
        may_publish_digest: owned.may_publish_digest,
        third_party: true,
        filed_via: org.name,
        intake_method: method,
        attested_at: attestedAt,
        ...(day ? { collected_on: day } : {}),
      });
      const row = await appendCorrection(trx, {
        threadId,
        headId,
        logbookId: owned.logbook_id,
        questions,
        fields,
        publicRefPrefix: this.publicRefPrefix,
      });
      await trx
        .insertInto('coordinator_actions')
        .values({
          thread_id: threadId,
          action: 'correct',
          report_id: row.id,
          coordinator_id: user.id,
          organization_id: owned.organization_id,
          comment,
        })
        .execute();
      return row.public_ref;
    });
  }
}
