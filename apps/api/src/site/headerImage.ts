/**
 * The header image: the optional picture behind the front page's headline.
 *
 * THROUGH THE FILES CODE, LIKE A LOGO. The bytes are decoded and re-encoded
 * by the same pipeline a reporter's photo goes through (`buildRendition`),
 * so nothing but the picture survives: no location, no camera, no author.
 * They are kept with the site's own file storage (`renditions`, the bucket
 * for bytes in the clear) under `headers/<random>.jpg`, and served from this
 * origin only (`GET /api/site/header-image/:file`), behind the site password
 * like the pages it appears on. No stock photo is ever loaded from anywhere.
 *
 * WHERE THE NAME LIVES. The settings column holds the file's random name
 * inside the header background JSON; the route that serves a file serves
 * only the name currently stored. A replaced or removed image's object is
 * queued for deletion in the same transaction that stops pointing at it.
 *
 * NOTHING HERE IS SEALED.
 */
import {
  HEADER_IMAGE_FILE,
  HEADER_IMAGE_MAX_BYTES,
  newHeaderImage,
  resolveLookOptions,
} from '@reportlog/contracts';
import type { LookOptions } from '@reportlog/contracts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import type { Files } from '../files/context.ts';
import { sniffType } from '../files/kinds.ts';
import { buildRendition, missingToolsFor, RejectFile } from '../files/media.ts';
import { afterCommit } from '../files/publication.ts';
import { queueDeletion } from '../files/slots.ts';
import { randomKey } from '../files/storage.ts';
import { HttpError } from '../http/errors.ts';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** What the re-encoded copy may weigh: it is drawn behind a headline, not printed. */
const STORED_MAX_BYTES = 4 * 1024 * 1024;

export const NO_STORAGE =
  'This site has nowhere to keep files yet, so it cannot take a header image. Ask whoever runs it to set up file storage.';

const refused = (message: string) => new HttpError(400, 'bad_image', message);

type Db = Kysely<DB>;

/** The options as stored, locked for the rest of the transaction. */
async function lockedOptions(trx: Db): Promise<LookOptions> {
  await trx
    .insertInto('site_settings')
    .values({ id: true })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  const row = await trx
    .selectFrom('site_settings')
    .select('look_options')
    .where('id', '=', true)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return resolveLookOptions(row.look_options);
}

async function writeOptions(trx: Db, options: LookOptions): Promise<void> {
  await trx
    .updateTable('site_settings')
    .set({ look_options: JSON.stringify(options), updated_at: sql`now()` })
    .where('id', '=', true)
    .execute();
}

/** The file name currently stored, or null. */
export async function storedHeaderFile(db: Db): Promise<string | null> {
  const row = await db
    .selectFrom('site_settings')
    .select('look_options')
    .where('id', '=', true)
    .executeTakeFirst();
  return resolveLookOptions(row?.look_options).header.image?.file ?? null;
}

export const headerKey = (file: string): string | null =>
  HEADER_IMAGE_FILE.test(file) ? `headers/${file}` : null;

/** Re-encode an image and keep it as the header image. Returns the options now stored. */
export async function saveHeaderImage(files: Files, body: Buffer): Promise<LookOptions> {
  if (body.length === 0) throw refused('Choose an image first.');
  if (body.length > HEADER_IMAGE_MAX_BYTES) {
    throw refused(
      `That image is too large. It can be at most ${String(HEADER_IMAGE_MAX_BYTES / 1024 / 1024)} MB; the page scales a photo down before sending it.`,
    );
  }
  // The bytes say what they are; a name or a header would be the uploader's claim.
  const type = sniffType(body);
  if (!type || !TYPES.includes(type)) throw refused('A header image must be a JPEG, PNG or WebP.');
  if ((await missingToolsFor(type)).length) {
    throw new HttpError(
      503,
      'tools_missing',
      'This site cannot re-encode images right now, so it cannot take a header image. Ask whoever runs it to check the server.',
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'reportlog-header-'));
  let file: string;
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
    if (clean.length > STORED_MAX_BYTES)
      throw refused('That image is too large once re-encoded. Try a smaller one.');
    const key = `${randomKey('headers')}.${built.renditionType === 'image/png' ? 'png' : 'jpg'}`;
    file = key.slice('headers/'.length);
    await files.storage.put('renditions', key, clean, clean.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  try {
    const next = await files.db.transaction().execute(async (trx) => {
      const before = await lockedOptions(trx);
      const old = before.header.image;
      // Replacing keeps how the owner had set the picture up; a first image
      // starts where the mock-up's does.
      const image = old ? { ...old, file } : newHeaderImage(file);
      const options = { ...before, header: { ...before.header, image } };
      await writeOptions(trx, options);
      if (old) await queueDeletion(trx, 'renditions', `headers/${old.file}`);
      return options;
    });
    await afterCommit(files);
    return next;
  } catch (e) {
    // Nothing points at it: do not leave it in the bucket.
    await files.storage.delete('renditions', `headers/${file}`).catch(() => undefined);
    throw e;
  }
}

/**
 * Write the owner's choices. The image can be switched off here but not
 * pointed anywhere new: `image.file` must be the one already uploaded, so a
 * stored name can never be made to name another object in the bucket.
 */
export async function saveLookOptions(
  db: Db,
  files: Files | null,
  input: LookOptions,
): Promise<LookOptions> {
  const next = await db.transaction().execute(async (trx) => {
    const before = await lockedOptions(trx);
    const old = before.header.image;
    const wanted = input.header.image;
    if (wanted && wanted.file !== old?.file) {
      throw refused('Add the image first, then choose how it is used.');
    }
    const options: LookOptions = { ...input };
    if (old && !wanted) await queueDeletion(trx, 'renditions', `headers/${old.file}`);
    await writeOptions(trx, options);
    return options;
  });
  await afterCommit(files);
  return next;
}

export async function removeHeaderImage(db: Db, files: Files | null): Promise<LookOptions> {
  const next = await db.transaction().execute(async (trx) => {
    const before = await lockedOptions(trx);
    const old = before.header.image;
    const options: LookOptions = { ...before, header: { ...before.header, image: null } };
    if (old) {
      await writeOptions(trx, options);
      await queueDeletion(trx, 'renditions', `headers/${old.file}`);
    }
    return options;
  });
  await afterCommit(files);
  return next;
}
