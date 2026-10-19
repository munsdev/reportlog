/**
 * Organization logos.
 *
 * THROUGH THE FILES WORKSTREAM'S CODE, NOT BESIDE IT. The bytes are decoded
 * and re-encoded by the same pipeline a reporter's photo goes through
 * (`buildRendition`), so nothing but the picture survives: no location, no
 * camera, no author. They are kept with F's storage (`renditions`, the
 * bucket for bytes in the clear), through its interface, which speaks the S3
 * API and nothing provider-specific. A replaced logo's object is queued for
 * deletion in the same transaction that stops pointing at it.
 *
 * STORING IS NOT PUBLISHING. The public sees a logo only while its
 * organization is listed in the directory. The organization's managers and
 * the people who grant access see it whatever the listing says, so a manager
 * can check it before opting in.
 */
import { LOGO_MAX_BYTES, LOGO_TYPES } from '@reportlog/contracts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Files } from '../files/context.ts';
import { sniffType } from '../files/kinds.ts';
import { buildRendition, missingToolsFor, RejectFile } from '../files/media.ts';
import { afterCommit } from '../files/publication.ts';
import { queueDeletion } from '../files/slots.ts';
import { randomKey } from '../files/storage.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { recordRoleChange } from './roles.ts';

/** What the re-encoded copy may weigh: a logo is shown small. */
const STORED_MAX_BYTES = 4 * 1024 * 1024;

/** A served file name: the random part of the key and its extension. */
export const LOGO_FILE = /^[a-f0-9]{32}\.(png|jpg)$/;

export const logoUrl = (key: string | null): string | null =>
  key ? `/api/directory/${key}` : null;

const refused = (message: string) => new HttpError(400, 'bad_logo', message);

export const NO_STORAGE =
  'This site has nowhere to keep files yet, so it cannot take a logo. Ask whoever runs it to set up file storage.';

/**
 * Re-encode an image and keep it as the organization's logo. Returns the
 * new logo's address.
 */
export async function saveLogo(
  files: Files,
  args: {
    organizationId: number;
    actorEmail: string;
    /** Somebody who grants access changing an organization they do not manage. */
    isAdminOverride: boolean;
    body: Buffer;
  },
): Promise<string> {
  const { body } = args;
  if (body.length === 0) throw refused('Choose an image first.');
  if (body.length > LOGO_MAX_BYTES) {
    throw refused(
      `That image is too large. A logo can be at most ${String(LOGO_MAX_BYTES / 1024 / 1024)} MB.`,
    );
  }
  // The bytes say what they are; a name or a header would be the uploader's claim.
  const type = sniffType(body);
  if (!type || !(LOGO_TYPES as readonly string[]).includes(type)) {
    throw refused('A logo must be a PNG, JPEG or WebP image.');
  }
  const missing = await missingToolsFor(type);
  if (missing.length) {
    throw new HttpError(
      503,
      'tools_missing',
      'This site cannot re-encode images right now, so it cannot take a logo. Ask whoever runs it to check the server.',
    );
  }

  const exists = await files.db
    .selectFrom('organizations')
    .select('id')
    .where('id', '=', args.organizationId)
    .executeTakeFirst();
  if (!exists) throw notFound('There is no such organization.');

  const dir = await mkdtemp(join(tmpdir(), 'reportlog-logo-'));
  let key: string;
  try {
    const input = join(dir, 'original');
    await writeFile(input, body);
    let built;
    try {
      built = await buildRendition(input, type, dir, { maxVideoSeconds: 0, maxDocumentPages: 1 });
    } catch (e) {
      if (e instanceof RejectFile) throw refused('That image could not be read. Try another one.');
      throw e;
    }
    const clean = await readFile(built.renditionPath);
    if (clean.length > STORED_MAX_BYTES) {
      throw refused('That image is too large once re-encoded. Try a smaller one.');
    }
    key = `${randomKey('logos')}.${built.renditionType === 'image/png' ? 'png' : 'jpg'}`;
    await files.storage.put('renditions', key, clean, clean.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  try {
    await files.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('organizations')
        .select('logo_key')
        .where('id', '=', args.organizationId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('organizations')
        .set({ logo_key: key, updated_at: new Date() })
        .where('id', '=', args.organizationId)
        .execute();
      if (before.logo_key) await queueDeletion(trx, 'renditions', before.logo_key);
      if (args.isAdminOverride) await recordOverride(trx, args, 'replaced');
    });
  } catch (e) {
    // Nothing points at it: do not leave it in the bucket.
    await files.storage.delete('renditions', key).catch(() => undefined);
    throw e;
  }
  await afterCommit(files);
  return logoUrl(key) ?? '';
}

export async function removeLogo(
  files: Files | null,
  db: Kysely<DB>,
  args: { organizationId: number; actorEmail: string; isAdminOverride: boolean },
): Promise<void> {
  const found = await db.transaction().execute(async (trx) => {
    const before = await trx
      .selectFrom('organizations')
      .select('logo_key')
      .where('id', '=', args.organizationId)
      .forUpdate()
      .executeTakeFirst();
    if (!before) return false;
    if (!before.logo_key) return true;
    await trx
      .updateTable('organizations')
      .set({ logo_key: null, updated_at: new Date() })
      .where('id', '=', args.organizationId)
      .execute();
    await queueDeletion(trx, 'renditions', before.logo_key);
    if (args.isAdminOverride) await recordOverride(trx, args, 'removed');
    return true;
  });
  if (!found) throw notFound('There is no such organization.');
  await afterCommit(files);
}

/**
 * An administrator changing how an organization presents itself is an
 * action against that organization, so it is on the record, as a change to
 * its details is.
 */
function recordOverride(
  trx: Kysely<DB>,
  args: { organizationId: number; actorEmail: string },
  what: 'replaced' | 'removed',
) {
  return recordRoleChange(trx, {
    actorEmail: args.actorEmail,
    subjectEmail: args.actorEmail,
    axis: 'organization',
    action: 'change',
    detail: `an administrator ${what} the organization’s logo`,
    organizationId: args.organizationId,
  });
}

/**
 * The logo behind a served file name, and whether this person may see it:
 * anybody while its organization is listed, otherwise only those who could
 * change it.
 */
export async function logoToServe(
  db: Kysely<DB>,
  file: string,
  mayManage: (organizationId: number) => boolean,
): Promise<string | null> {
  if (!LOGO_FILE.test(file)) return null;
  const key = `logos/${file}`;
  const org = await db
    .selectFrom('organizations')
    .select(['id', 'listed'])
    .where('logo_key', '=', key)
    .executeTakeFirst();
  if (!org) return null;
  return org.listed || mayManage(org.id) ? key : null;
}
