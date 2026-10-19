/**
 * Files in an intake account: what the person a coordinator spoke to handed
 * over (a photo, a recording), attached to the account itself.
 *
 * THE FILES WORKSTREAM'S MACHINERY, UNCHANGED IN WHAT IT PROMISES. Every
 * file goes through the same slot, the same limits for its logbook, the
 * same encryption from the first byte, the same worker, and is sealed into
 * the report by the same `sealFiles` in the same transaction as the report.
 * Three things differ, because a coordinator is not an anonymous visitor:
 *
 *   - The owner is the ACCOUNT, not a free draft token. Its draft hash is
 *     derived from the account's id under a label of its own, so no draft
 *     token anybody could send to the public upload routes reaches it, and
 *     every route here first asks whether the account is this coordinator's.
 *   - No per-address quota. The quota keeps one address from filling
 *     staging through free drafts; a coordinator stages many people's
 *     accounts under their own name, signed in.
 *   - Released at once, because attaching a file to an account is handing
 *     it over: the files are ready by the time the batch is reviewed, and
 *     the review says which are not.
 *
 * An account stays staged for as long as the coordinator needs, so its
 * files are kept for INTAKE_FILE_DAYS rather than a confirmation link's day.
 * The review names any that ran out.
 */
import type { IntakeFile } from '@reportlog/contracts';
import { FILE_TYPE } from '@reportlog/fields';
import type { FieldDefinition } from '@reportlog/fields';
import type { Kysely } from 'kysely';
import type { Readable } from 'node:stream';
import type { DB } from '../db/schema.gen.ts';
import type { Files } from '../files/context.ts';
import { filesOn } from '../files/context.ts';
import { createUploadSlot, discardSlot, receiveUpload, slotStatuses } from '../files/slots.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { sha256Hex } from '../identity/secrets.ts';
import type { SignedIn } from '../identity/sessions.ts';
import { logbookBySlug } from '../logbooks/logbooks.ts';

export const INTAKE_FILE_DAYS = 30;

/** The account's files, as F's slots know an owner. Never a token anybody holds. */
export const accountDraft = (draftId: number): string =>
  sha256Hex(`reportlog-intake-account:${String(draftId)}`);

/** What this needs from Intake, named here so the two files do not import each other. */
interface StagedAccounts {
  stagedAccount(user: SignedIn, draftId: number, opts: { forFiles?: boolean }): Promise<unknown>;
}

const off = () => new HttpError(404, 'files_off', 'This site is not taking files at the moment.');

export class IntakeFiles {
  private readonly db: Kysely<DB>;
  private readonly intake: StagedAccounts;
  private readonly files: Files | null;

  constructor(db: Kysely<DB>, intake: StagedAccounts, files: Files | null) {
    this.db = db;
    this.intake = intake;
    this.files = files;
  }

  private async on(): Promise<Files> {
    if (!this.files || !(await filesOn(this.files))) throw off();
    return this.files;
  }

  async list(user: SignedIn, draftId: number): Promise<IntakeFile[]> {
    await this.intake.stagedAccount(user, draftId, { forFiles: true });
    const rows = await slotStatuses(this.db, { draft: accountDraft(draftId) });
    return rows.map((s) => ({
      slot_token: s.slot_token,
      name: s.declared_name,
      size: s.declared_size,
      status: s.status,
      detail: s.status_detail,
    }));
  }

  /**
   * A place for one file. The logbook is the one chosen in the dialog, which
   * may not be saved yet; the first file fixes it (F's rule), and the review
   * refuses an account whose files were attached for another logbook.
   */
  async add(
    user: SignedIn,
    draftId: number,
    body: { logbook: string | undefined; name: string; type: string; size: number },
  ): Promise<{ slot_token: string }> {
    const files = await this.on();
    await this.intake.stagedAccount(user, draftId, { forFiles: true });
    const slug = (body.logbook ?? '').trim();
    const lb = slug ? await logbookBySlug(this.db, slug) : null;
    if (!slug) {
      throw new HttpError(
        400,
        'no_logbook',
        'Choose the logbook for this account before attaching files.',
      );
    }
    if (lb?.state !== 'open') {
      throw new HttpError(404, 'not_found', 'That logbook is not taking reports.');
    }
    if (!lb.asks_for_files) {
      throw new HttpError(400, 'no_files_here', 'This logbook does not take files.');
    }
    const made = await createUploadSlot(
      files,
      { draft: accountDraft(draftId) },
      { name: body.name, type: body.type, size: body.size, logbookId: lb.id, coordinator: true },
    );
    await this.db
      .updateTable('upload_slots')
      .set({ expires_at: new Date(Date.now() + INTAKE_FILE_DAYS * 24 * 60 * 60 * 1000) })
      .where('slot_token', '=', made.slot_token)
      .execute();
    return made;
  }

  async receive(
    user: SignedIn,
    draftId: number,
    slot: string,
    body: Readable,
  ): Promise<{ status: string }> {
    const files = await this.on();
    await this.intake.stagedAccount(user, draftId, { forFiles: true });
    return receiveUpload(files, { draft: accountDraft(draftId) }, slot, body);
  }

  async remove(user: SignedIn, draftId: number, slot: string): Promise<void> {
    await this.intake.stagedAccount(user, draftId, { forFiles: true });
    if (!(await discardSlot(this.db, { draft: accountDraft(draftId) }, slot))) {
      throw notFound('There is no such file on this account.');
    }
    if (this.files) {
      const { drainDeletions } = await import('../files/worker.ts');
      await drainDeletions(this.files).catch(() => undefined);
    }
  }
}

/**
 * What stops an account's files being filed, in the review's words. A file
 * that is not ready is never quietly left out: the coordinator watched it
 * upload, so the account waits, or they remove it.
 */
export async function fileProblems(
  db: Kysely<DB>,
  draftId: number,
  logbook: { id: number; questions: readonly FieldDefinition[] },
  filesTaken: boolean,
): Promise<string[]> {
  const slots = await db
    .selectFrom('upload_slots')
    .select(['declared_name', 'status', 'status_detail', 'logbook_id'])
    .where('draft_hash', '=', accountDraft(draftId))
    .where('promoted_at', 'is', null)
    .where('status', '!=', 'withdrawn')
    .orderBy('id')
    .execute();
  const problems: string[] = [];
  const name = (s: { declared_name: string }) => `“${s.declared_name || 'a file'}”`;
  for (const s of slots) {
    if (s.logbook_id !== logbook.id) {
      problems.push(`${name(s)} was attached for another logbook: remove it, or attach it again`);
    } else if (s.status === 'pending') {
      problems.push(`${name(s)} did not finish sending: remove it, or attach it again`);
    } else if (s.status === 'uploaded' || s.status === 'processing') {
      problems.push(`${name(s)} is still being prepared: look again in a minute`);
    } else if (s.status === 'expired') {
      problems.push(
        `${name(s)} was kept ${String(INTAKE_FILE_DAYS)} days without being filed and has gone: remove it, and attach it again`,
      );
    } else if (s.status !== 'clean') {
      problems.push(
        `${name(s)} was not accepted${s.status_detail ? ` (${s.status_detail})` : ''}: remove it to file the account without it`,
      );
    }
  }
  const asked = logbook.questions.find((q) => q.kind === FILE_TYPE);
  if (filesTaken && asked?.required === true && !slots.some((s) => s.logbook_id === logbook.id)) {
    problems.push('needs at least one file');
  }
  return problems;
}
