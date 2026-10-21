/**
 * A coordinator entering accounts collected offline, on somebody's behalf.
 *
 * The second way into a chain, and why it has to exist: a report is normally
 * held until the reporter clicks a link in their own email, and somebody who
 * filled in a paper form at a polling place cannot click anything. So the
 * gate is different, not absent. In place of the click, a named, signed-in,
 * accountable person attests that they received these accounts and typed
 * them up faithfully.
 *
 * THE ORGANIZATION INSIDE THE SEAL, THE COORDINATOR OUTSIDE IT. A filed
 * account seals `third_party`, the organization's NAME as it is at filing
 * (`filed_via`, so a rename cannot change what a sealed report says), how it
 * was collected and when it was attested. Who typed it, their address and
 * their private reference to the paper are bookkeeping: the filed draft
 * (which batch, which coordinator) and the contact details under the
 * thread's erasable key.
 *
 * STAGED, because bulk entry produces typos. Nothing reaches a chain until
 * the coordinator reviews the batch and attests to it, and an incomplete
 * account is left staged rather than filed or thrown away.
 */
import type { DraftPayload, IntakeBatch } from '@reportlog/contracts';
import { buildAnswers } from '@reportlog/fields';
import type { FieldDefinition } from '@reportlog/fields';
import { INTAKE_METHODS, normalizeReportFields } from '@reportlog/seal';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { appendReportVersion } from '../chain/append.ts';
import { ensureFormVersion } from '../chain/forms.ts';
import { questionsFor } from '../chain/questions.ts';
import { isKnownDigest } from '../consent/cards.ts';
import type { DB } from '../db/schema.gen.ts';
import type { Files } from '../files/context.ts';
import { filesOn } from '../files/context.ts';
import { sealFiles } from '../files/filing.ts';
import { discardSlot, slotStatuses } from '../files/slots.ts';
import { notFound } from '../http/errors.ts';
import { notAllowed } from '../identity/guards.ts';
import type { SignedIn } from '../identity/sessions.ts';
import { logbookBySlug } from '../logbooks/logbooks.ts';
import type { LogbookSummary } from '@reportlog/contracts';
import { sealContact } from './contactKeys.ts';
import type { ContactKeyring } from './contactKeys.ts';
import { answerRefusals, intakeClosed, notConfigured, refused, startThread } from './filing.ts';
import { accountDraft, fileProblems } from './intakeFiles.ts';
import { intakeIsOpen } from './intakeSwitch.ts';

/**
 * The organizations this person may file for. Every organization role
 * (coordinator or manager) may; a role added to organizations later must be
 * added here on purpose rather than inherit filing.
 */
export function coordinatorOrgs(user: SignedIn) {
  const mayFile: readonly string[] = ['coordinator', 'manager'];
  return user.memberships.filter((m) => mayFile.includes(m.role));
}

export function mayFileFor(user: SignedIn, organizationId: number): boolean {
  return coordinatorOrgs(user).some((m) => m.organization_id === organizationId);
}

const noBatch = () => notFound('There is no batch of yours with that number.');
const alreadyFiled = () => refused(409, 'already_filed', 'That batch has already been filed.');

function batches(db: Kysely<DB>) {
  return db
    .selectFrom('intake_batches as b')
    .innerJoin('organizations as o', 'o.id', 'b.organization_id')
    .select((eb) => [
      'b.id',
      'b.organization_id',
      'o.name as organization',
      'b.status',
      'b.created_at',
      'b.submitted_at',
      'b.coordinator_id',
      eb
        .selectFrom('intake_drafts as d')
        .whereRef('d.batch_id', '=', 'b.id')
        .select((e) => e.fn.countAll<number>().as('n'))
        .as('entries'),
      eb
        .selectFrom('intake_drafts as d')
        .whereRef('d.batch_id', '=', 'b.id')
        .where('d.report_id', 'is not', null)
        .select((e) => e.fn.countAll<number>().as('n'))
        .as('filed'),
    ]);
}
type BatchRow = Awaited<ReturnType<ReturnType<typeof batches>['executeTakeFirstOrThrow']>>;

function presentBatch(b: BatchRow): IntakeBatch {
  return {
    id: b.id,
    organization_id: b.organization_id,
    organization: b.organization,
    status: b.status === 'submitted' ? 'submitted' : 'draft',
    created_at: b.created_at.toISOString(),
    submitted_at: b.submitted_at ? b.submitted_at.toISOString() : null,
    entries: b.entries ?? 0,
    filed: b.filed ?? 0,
  };
}

function presentDraft(d: {
  id: number;
  ordinal: number;
  payload: unknown;
  public_ref: string | null;
  thread_id: string | null;
}) {
  return {
    id: d.id,
    ordinal: d.ordinal,
    payload: (d.payload ?? {}) as DraftPayload,
    public_ref: d.public_ref,
    thread_id: d.thread_id,
  };
}

/** One reading of each logbook for a whole batch: what was judged is what gets sealed. */
type LogbookCache = Map<string, { lb: LogbookSummary; questions: FieldDefinition[] } | null>;

export class Intake {
  private readonly db: Kysely<DB>;
  private readonly ring: ContactKeyring | null;
  private readonly publicRefPrefix: string;
  private readonly files: Files | null;

  constructor(
    db: Kysely<DB>,
    ring: ContactKeyring | null,
    publicRefPrefix: string,
    files: Files | null = null,
  ) {
    this.db = db;
    this.ring = ring;
    this.publicRefPrefix = publicRefPrefix;
    this.files = files;
  }

  async createBatch(user: SignedIn, organizationId: number | undefined): Promise<IntakeBatch> {
    if (organizationId === undefined || !mayFileFor(user, organizationId)) {
      throw notAllowed('You are not filing for that organization.');
    }
    const made = await this.db
      .insertInto('intake_batches')
      .values({ organization_id: organizationId, coordinator_id: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    return this.batch(user, made.id);
  }

  /**
   * A coordinator sees their own batches only. Whether coordinators should
   * see each other's was decided the narrow way, as in the old application.
   */
  async listBatches(user: SignedIn): Promise<IntakeBatch[]> {
    const rows = await batches(this.db)
      .where('b.coordinator_id', '=', user.id)
      .orderBy('b.created_at', 'desc')
      .orderBy('b.id', 'desc')
      .execute();
    return rows.map(presentBatch);
  }

  async batch(user: SignedIn, id: number): Promise<IntakeBatch> {
    const row = await batches(this.db)
      .where('b.id', '=', id)
      .where('b.coordinator_id', '=', user.id)
      .executeTakeFirst();
    if (!row) throw noBatch();
    return presentBatch(row);
  }

  async drafts(batchId: number) {
    const rows = await this.db
      .selectFrom('intake_drafts as d')
      .leftJoin('reports as r', 'r.id', 'd.report_id')
      .select(['d.id', 'd.ordinal', 'd.payload', 'r.public_ref', 'r.thread_id'])
      .where('d.batch_id', '=', batchId)
      .orderBy('d.ordinal')
      .execute();
    return rows.map(presentDraft);
  }

  async addDraft(user: SignedIn, batchId: number, payload: DraftPayload) {
    const batch = await this.batch(user, batchId);
    if (batch.status !== 'draft') throw alreadyFiled();
    if (!mayFileFor(user, batch.organization_id)) {
      throw notAllowed('You no longer file for this organization.');
    }
    const row = await this.db
      .insertInto('intake_drafts')
      .values({
        batch_id: batch.id,
        ordinal: sql<number>`coalesce((SELECT max(ordinal) + 1 FROM intake_drafts WHERE batch_id = ${batch.id}), 1)`,
        payload: JSON.stringify(payload),
      })
      .returning(['id', 'ordinal', 'payload'])
      .executeTakeFirstOrThrow();
    return presentDraft({ ...row, public_ref: null, thread_id: null });
  }

  private async ownedDraft(user: SignedIn, draftId: number) {
    const row = await this.db
      .selectFrom('intake_drafts as d')
      .innerJoin('intake_batches as b', 'b.id', 'd.batch_id')
      .select(['d.id', 'd.report_id', 'b.organization_id'])
      .where('d.id', '=', draftId)
      .where('b.coordinator_id', '=', user.id)
      .executeTakeFirst();
    if (!row) throw notFound('There is no account of yours with that number.');
    if (row.report_id !== null) {
      throw refused(409, 'already_filed', 'That account has been filed and can no longer change.');
    }
    return row;
  }

  /**
   * An account this person may still change: theirs, not filed, and (for
   * attaching files, which hands something over in the organization's name)
   * while they still file for its organization.
   */
  async stagedAccount(user: SignedIn, draftId: number, opts: { forFiles?: boolean } = {}) {
    const row = await this.ownedDraft(user, draftId);
    if (opts.forFiles && !mayFileFor(user, row.organization_id)) {
      throw notAllowed('You no longer file for this organization.');
    }
    return row;
  }

  async updateDraft(user: SignedIn, draftId: number, payload: DraftPayload) {
    await this.ownedDraft(user, draftId);
    const row = await this.db
      .updateTable('intake_drafts')
      .set({ payload: JSON.stringify(payload), updated_at: new Date() })
      .where('id', '=', draftId)
      .returning(['id', 'ordinal', 'payload'])
      .executeTakeFirstOrThrow();
    return presentDraft({ ...row, public_ref: null, thread_id: null });
  }

  async removeDraft(user: SignedIn, draftId: number): Promise<void> {
    await this.ownedDraft(user, draftId);
    // Its files go with it: nothing would ever file them.
    const owner = { draft: accountDraft(draftId) };
    for (const s of await slotStatuses(this.db, owner)) {
      await discardSlot(this.db, owner, s.slot_token);
    }
    await this.db.deleteFrom('intake_drafts').where('id', '=', draftId).execute();
  }

  /**
   * What an account is missing. It is checked the way a reporter's own
   * report is, against that logbook's questions as they are now, and the
   * logbook has to be open: filing through a coordinator is still filing.
   * The publication answer is required, on the wording coordinators are
   * shown: the coordinator records what the person they spoke to said.
   */
  async problemsOf(
    payload: DraftPayload,
    cache: LogbookCache,
    db: Kysely<DB> = this.db,
    draftId?: number,
  ) {
    const problems: string[] = [];
    const slug = typeof payload.logbook === 'string' ? payload.logbook.trim() : '';
    if (!slug) {
      problems.push('needs a logbook');
    } else {
      if (!cache.has(slug)) {
        const lb = await logbookBySlug(db, slug);
        cache.set(slug, lb ? { lb, questions: await questionsFor(db, lb.id) } : null);
      }
      const hit = cache.get(slug);
      if (!hit || hit.lb.state === 'draft') problems.push('names a logbook that does not exist');
      else if (hit.lb.state !== 'open') problems.push('names a logbook that is not taking reports');
      else {
        problems.push(...answerRefusals(hit.questions, payload.answers ?? {}));
        problems.push(...buildAnswers(hit.questions, payload.answers ?? {}).errors);
        if (draftId !== undefined) {
          problems.push(
            ...(await fileProblems(
              db,
              draftId,
              { id: hit.lb.id, questions: hit.questions },
              hit.lb.asks_for_files && (await filesOn(this.files)),
            )),
          );
        }
      }
    }
    if (!INTAKE_METHODS.some((m) => m === payload.intake_method)) {
      problems.push('needs to say how the account was collected');
    }
    if (payload.may_publish !== true && payload.may_publish !== false) {
      problems.push('needs the answer to whether it may be published');
    } else if (!(await isKnownDigest(db, payload.may_publish_digest, 'coordinator'))) {
      problems.push('the publication answer does not name wording this site shows coordinators');
    }
    if (payload.collected_on && !/^\d{4}-\d{2}-\d{2}$/.test(payload.collected_on)) {
      problems.push('the day it was collected is not a date');
    }
    return problems;
  }

  async review(user: SignedIn, batchId: number) {
    const batch = await this.batch(user, batchId);
    const cache: LogbookCache = new Map();
    const entries = [];
    for (const d of await this.drafts(batch.id)) {
      const filed = d.public_ref !== null;
      entries.push({
        id: d.id,
        ordinal: d.ordinal,
        filed,
        problems: filed ? [] : await this.problemsOf(d.payload, cache, this.db, d.id),
      });
    }
    return {
      batch,
      entries,
      ready: entries.filter((e) => !e.filed && !e.problems.length).length,
      blocked: entries.filter((e) => !e.filed && e.problems.length).length,
    };
  }

  /**
   * Attest and file. The point of no return, written to be one: a single
   * transaction, and every report gets the same attestation time because one
   * person attested to them in one act.
   *
   * THE SWITCH FIRST, before the batch is even looked up: the second door
   * into the chain closes with the first one. A coordinator keeps their
   * staged work while it is closed and can still edit it.
   */
  async submit(user: SignedIn, batchId: number, attested: boolean | undefined) {
    if (!(await intakeIsOpen(this.db))) throw intakeClosed();
    if (!this.ring) throw notConfigured();
    const ring = this.ring;
    const batch = await this.batch(user, batchId);
    if (batch.status !== 'draft') throw alreadyFiled();
    // Asked again now, not only when the batch was opened: somebody who has
    // since left the organization no longer files in its name.
    if (!mayFileFor(user, batch.organization_id)) {
      throw notAllowed('You no longer file for this organization.');
    }
    // A specific statement, not a box that says "ok". The page shows the
    // words; this refuses without them, so a client that skips the dialog
    // cannot file anything.
    if (attested !== true) {
      throw refused(400, 'not_attested', 'The attestation is needed before a batch can be filed.');
    }
    const attestedAt = new Date().toISOString();

    return this.db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom('intake_batches')
        .select('status')
        .where('id', '=', batch.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (locked.status !== 'draft') throw alreadyFiled();
      // The name as it is now, read inside the transaction: this is what is sealed.
      const org = await trx
        .selectFrom('organizations')
        .select('name')
        .where('id', '=', batch.organization_id)
        .executeTakeFirstOrThrow();
      const drafts = await trx
        .selectFrom('intake_drafts')
        .select(['id', 'ordinal', 'payload'])
        .where('batch_id', '=', batch.id)
        .where('report_id', 'is', null)
        .orderBy('ordinal')
        .execute();

      const cache: LogbookCache = new Map();
      const forms = new Map<string, number>();
      const filed: { ordinal: number; public_ref: string; files_dropped?: string[] }[] = [];
      for (const draft of drafts) {
        const payload = (draft.payload ?? {}) as DraftPayload;
        if ((await this.problemsOf(payload, cache, trx, draft.id)).length) continue;
        const hit = cache.get(String(payload.logbook).trim());
        if (!hit) continue;
        const { lb, questions } = hit;
        // The version of the questions this batch was judged against.
        let formId = forms.get(lb.slug);
        if (formId === undefined) {
          formId = (await ensureFormVersion(trx, lb, questions)).id;
          forms.set(lb.slug, formId);
        }
        const threadId = randomUUID();
        // The account's finished files, sealed into this version and linked
        // to exactly it (the review above held back any not finished).
        const sealed = await sealFiles(trx, { draft: accountDraft(draft.id) }, threadId);
        const { row } = await appendReportVersion(trx, {
          logbookId: lb.id,
          threadId,
          fields: normalizeReportFields({
            logbook: lb.slug,
            answers: buildAnswers(questions, payload.answers ?? {}).answers,
            may_publish: payload.may_publish,
            may_publish_digest: payload.may_publish_digest,
            third_party: true,
            filed_via: org.name,
            intake_method: payload.intake_method,
            attested_at: attestedAt,
            ...(payload.collected_on ? { collected_on: payload.collected_on } : {}),
          }),
          attachments: sealed.manifest,
          formId,
          publicRefPrefix: this.publicRefPrefix,
        });
        await sealed.link(row.id);
        await startThread(trx, threadId, row);
        // One accountable, reachable person per record: the coordinator. The
        // source's own contact details are deliberately not collected.
        await sealContact(trx, ring, {
          threadId,
          email: user.email,
          filedBy: 'coordinator',
          organization: org.name,
        });
        await trx
          .updateTable('intake_drafts')
          .set({ report_id: row.id, updated_at: new Date() })
          .where('id', '=', draft.id)
          .execute();
        filed.push({
          ordinal: draft.ordinal,
          public_ref: row.public_ref,
          // Frozen since they were attached (decision 19): filed without them, and said.
          ...(sealed.dropped.length ? { files_dropped: sealed.dropped } : {}),
        });
      }

      const remaining = drafts.length - filed.length;
      // A batch with accounts still staged stays open, so the coordinator can
      // fix them and file the rest rather than starting again.
      if (remaining === 0) {
        await trx
          .updateTable('intake_batches')
          .set({ status: 'submitted', submitted_at: new Date() })
          .where('id', '=', batch.id)
          .execute();
      }
      return { filed, still_staged: remaining, attested_at: attestedAt };
    });
  }
}
