/**
 * "My reports": what a reporter can do with their own reports once signed
 * in with the address they filed from.
 *
 * WHOSE REPORT IT IS is decided by the keyed digest of the address beside
 * the thread's contact key (contactKeys.ts), and nothing else. After an
 * erasure that digest is gone, so the report is nobody's: it stays in the
 * archive, sealed, and no longer appears here.
 *
 * A CORRECTION IS A NEW VERSION, never an edit. The same logbook's questions,
 * answered again and checked exactly as a new report is, appended to the
 * same logbook's chain in the same thread. The version it corrects is not
 * touched and still verifies.
 */
import type { MyReport, MyReportDetail } from '@reportlog/contracts';
import { buildAnswers } from '@reportlog/fields';
import { normalizeReportFields } from '@reportlog/seal';
import type { Kysely } from 'kysely';
import { appendReportVersion } from '../chain/append.ts';
import { ensureFormVersion } from '../chain/forms.ts';
import { questionsFor } from '../chain/questions.ts';
import { manifestFor } from '../chain/record.ts';
import type { DB } from '../db/schema.gen.ts';
import { notFound } from '../http/errors.ts';
import { fieldsFor } from '../logbooks/logbooks.ts';
import { forForm } from '../logbooks/routes.ts';
import { flagReport } from '../moderation/flags.ts';
import { NONE_GRANTED, permissionHistory, permissionsForMany } from '../permissions/log.ts';
import { emailDigest, eraseContact } from './contactKeys.ts';
import type { ContactKeyring } from './contactKeys.ts';
import { notConfigured, refused } from './filing.ts';

const notYours = () => notFound('There is no report of yours with that reference.');

function reportsOf(db: Kysely<DB>) {
  return db
    .selectFrom('contact_keys as k')
    .innerJoin('report_heads as h', 'h.thread_id', 'k.thread_id')
    .innerJoin('reports as r', 'r.id', 'h.current_report_id')
    .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
    .select((eb) => [
      'h.thread_id',
      'h.current_report_id',
      'h.withdrawn',
      'h.moderation_status',
      'r.public_ref',
      'r.received_at',
      'r.answers',
      'r.may_publish',
      'r.may_publish_digest',
      'r.logbook_id',
      'l.slug as logbook_slug',
      'l.title as logbook_title',
      eb
        .selectFrom('reports as v')
        .whereRef('v.thread_id', '=', 'h.thread_id')
        .select((e) => e.fn.min('v.received_at').as('first'))
        .as('first_received_at'),
      eb
        .selectFrom('reports as v')
        .whereRef('v.thread_id', '=', 'h.thread_id')
        .select((e) => e.fn.countAll<number>().as('n'))
        .as('versions'),
    ]);
}

type Row = Awaited<ReturnType<ReturnType<typeof reportsOf>['executeTakeFirstOrThrow']>>;

function present(r: Row, permissions: MyReport['permissions']): MyReport {
  return {
    thread_id: r.thread_id,
    public_ref: r.public_ref,
    logbook_slug: r.logbook_slug,
    logbook_title: r.logbook_title,
    received_at: r.received_at.toISOString(),
    first_received_at: new Date(r.first_received_at ?? r.received_at).toISOString(),
    versions: r.versions ?? 1,
    answers: (r.answers ?? {}) as Record<string, unknown>,
    may_publish: r.may_publish,
    withdrawn: r.withdrawn,
    moderation_status: r.moderation_status,
    permissions,
  };
}

export class Mine {
  private readonly db: Kysely<DB>;
  private readonly ring: ContactKeyring | null;
  private readonly publicRefPrefix: string;

  constructor(db: Kysely<DB>, ring: ContactKeyring | null, publicRefPrefix: string) {
    this.db = db;
    this.ring = ring;
    this.publicRefPrefix = publicRefPrefix;
  }

  private digest(email: string): string {
    if (!this.ring) throw notConfigured();
    return emailDigest(this.ring, email);
  }

  async list(email: string): Promise<MyReport[]> {
    const rows = await reportsOf(this.db)
      .where('k.email_hmac', '=', this.digest(email))
      .orderBy('r.received_at', 'desc')
      .execute();
    // One query for every card's permissions rather than one per card.
    const perms = await permissionsForMany(
      this.db,
      rows.map((r) => r.thread_id),
    );
    return rows.map((r) => present(r, perms.get(r.thread_id) ?? { ...NONE_GRANTED }));
  }

  /** A thread this address owns, or a 404 that does not say whether it exists. */
  async owned(email: string, threadId: string): Promise<Row> {
    const row = await reportsOf(this.db)
      .where('k.email_hmac', '=', this.digest(email))
      .where('h.thread_id', '=', threadId)
      .executeTakeFirst();
    if (!row) throw notYours();
    return row;
  }

  async detail(email: string, threadId: string): Promise<MyReportDetail> {
    const row = await this.owned(email, threadId);
    const perms = await permissionsForMany(this.db, [threadId]);
    const actions = await this.db
      .selectFrom('reporter_actions')
      .select(['action', 'comment', 'created_at'])
      .where('thread_id', '=', threadId)
      .orderBy('id', 'desc')
      .execute();
    return {
      ...present(row, perms.get(threadId) ?? { ...NONE_GRANTED }),
      questions: (await fieldsFor(this.db, row.logbook_id)).map(forForm),
      permission_history: await permissionHistory(this.db, threadId),
      actions: actions.map((a) => ({
        action: a.action,
        comment: a.comment,
        at: a.created_at.toISOString(),
      })),
    };
  }

  async correct(
    email: string,
    threadId: string,
    b: {
      answers?: Record<string, unknown> | undefined;
      comment?: string | undefined;
      may_publish?: boolean | undefined;
    },
  ): Promise<string> {
    const owned = await this.owned(email, threadId);
    const comment = b.comment?.trim() ?? '';

    // Against the questions as they are now, which may include an optional
    // one added since the report was filed.
    const questions = await questionsFor(this.db, owned.logbook_id);
    const { answers, errors } = buildAnswers(questions, b.answers ?? {});
    const problems = errors.map((e) => `${e}.`);
    if (!comment) problems.push('Say why you are correcting it.');
    if (problems.length) throw refused(400, 'incomplete', problems.join(' '));

    // A correction is a new sealed object, so it CAN carry a different
    // publication answer. Tightening is allowed: changing your mind towards
    // "keep it out" is the humane part of an archive that cannot unpublish.
    // Loosening is refused: a route that turned "do not publish" into
    // "publish" would manufacture a permission the author never gave.
    // Said nothing: the answer carries forward, with its wording.
    if (b.may_publish === true && !owned.may_publish) {
      throw refused(
        400,
        'cannot_loosen',
        'A correction cannot give permission to publish that the report did not already have.',
      );
    }
    const fields = normalizeReportFields({
      logbook: owned.logbook_slug,
      answers,
      may_publish: b.may_publish ?? owned.may_publish,
      may_publish_digest: owned.may_publish_digest,
    });

    return this.db.transaction().execute(async (trx) => {
      // Two corrections at once must not both correct the same version.
      const head = await trx
        .selectFrom('report_heads')
        .select('current_report_id')
        .where('thread_id', '=', threadId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const lb = await trx
        .selectFrom('logbooks')
        .select(['id', 'slug', 'launched_at'])
        .where('id', '=', owned.logbook_id)
        .executeTakeFirstOrThrow();
      const form = await ensureFormVersion(trx, lb, questions);

      // THE FILES COME WITH IT. A correction is a new version of the same
      // report, so it commits to the same files, in the same order, read
      // from the archive and never from the request. Without this a reporter
      // fixing a typo loses their photographs, and the new version VERIFIES
      // CLEANLY, because its manifest is simply absent.
      const manifest = await manifestFor(trx, head.current_report_id);
      const inherited = await trx
        .selectFrom('report_attachments')
        .select('attachment_id')
        .where('report_id', '=', head.current_report_id)
        .execute();

      const { row } = await appendReportVersion(trx, {
        logbookId: lb.id,
        threadId,
        correctsId: head.current_report_id,
        fields,
        attachments: manifest,
        formId: form.id,
        publicRefPrefix: this.publicRefPrefix,
      });
      if (inherited.length) {
        await trx
          .insertInto('report_attachments')
          .values(inherited.map((a) => ({ report_id: row.id, attachment_id: a.attachment_id })))
          .execute();
      }
      // Changed words need a fresh look, even on a report that was approved.
      await trx
        .updateTable('report_heads')
        .set({ current_report_id: row.id, moderation_status: 'pending', updated_at: new Date() })
        .where('thread_id', '=', threadId)
        .execute();
      // A correction gets its own look for the review flag: words that were
      // unremarkable before may not be now.
      await flagReport(trx, { reportId: row.id, threadId, logbookId: lb.id, answers: row.answers });
      await trx
        .insertInto('reporter_actions')
        .values({ thread_id: threadId, action: 'correct', report_id: row.id, comment })
        .execute();
      return row.public_ref;
    });
  }

  /**
   * Off the public board. The report stays in the archive, sealed. A reason
   * is asked for because a moderator has to understand a gap in the record.
   */
  async withdraw(email: string, threadId: string, comment: string | undefined): Promise<void> {
    await this.owned(email, threadId);
    const why = comment?.trim() ?? '';
    if (!why) throw refused(400, 'incomplete', 'Say why you are withdrawing it.');
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('report_heads')
        .set({ withdrawn: true, updated_at: new Date() })
        .where('thread_id', '=', threadId)
        .execute();
      await trx
        .insertInto('reporter_actions')
        .values({ thread_id: threadId, action: 'withdraw', comment: why })
        .execute();
    });
  }

  /**
   * Erase the contact details and withdraw the report, together, in one
   * transaction. What goes: the key the address was encrypted under, the
   * digest that linked the report to this address, and the confirmation-link
   * rows. The report itself never held the address and stays, verifiable.
   */
  async erase(email: string, threadId: string, confirm: boolean | undefined): Promise<void> {
    await this.owned(email, threadId);
    if (confirm !== true) {
      throw refused(400, 'incomplete', 'Confirm that you want your contact details erased.');
    }
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('report_heads')
        .set({ withdrawn: true, updated_at: new Date() })
        .where('thread_id', '=', threadId)
        .execute();
      await eraseContact(trx, threadId);
      await trx
        .insertInto('reporter_actions')
        .values({
          thread_id: threadId,
          action: 'erase',
          comment: 'Withdrawn, and contact details erased, at the reporter’s request.',
        })
        .execute();
    });
  }
}
