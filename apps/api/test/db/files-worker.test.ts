/**
 * The media worker, with the real tools on real files.
 *
 * THE PROMISE UNDER TEST: what could ever be published carries no camera
 * metadata and no location, because it was rebuilt from the picture or the
 * sound alone; and the original survives, byte for byte, encrypted under the
 * file's own key, as evidence.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureFormVersion } from '../../src/chain/forms.ts';
import { questionsFor } from '../../src/chain/questions.ts';
import type { Database } from '../../src/db/database.ts';
import { decryptBuffer } from '../../src/files/envelope.ts';
import { setLogbookLimits } from '../../src/files/limits.ts';
import {
  createUploadSlot,
  draftHash,
  newDraftToken,
  receiveUpload,
  releaseDraft,
} from '../../src/files/slots.ts';
import { readAll } from '../../src/files/storage.ts';
import { processSlot, workOnce } from '../../src/files/worker.ts';
import { sha256Hex } from '../../src/identity/secrets.ts';
import {
  SECRET,
  TOOLS,
  audioWithTags,
  filesFor,
  jpegWithGps,
  pdfWithAuthor,
  pngWithText,
  removeDir,
  toolsMissing,
  videoWithLocation,
} from './files-helpers.ts';
import { launchedLogbook, testDatabase } from './helpers.ts';

let db: Database;
let files: ReturnType<typeof filesFor>;
let lb: { id: number; slug: string };

/** Stage a file and press Send, as a reporter does. Returns the slot's id. */
async function staged(body: Buffer, type: string, name = 'file') {
  const owner = { draft: draftHash(newDraftToken()) };
  const { slot_token } = await createUploadSlot(files, owner, {
    name,
    type,
    size: body.length,
    logbookId: lb.id,
    email: 'worker@example.org',
  });
  await receiveUpload(files, owner, slot_token, Readable.from([body]));
  const lbRow = await db
    .selectFrom('logbooks')
    .select(['id', 'slug', 'launched_at'])
    .where('id', '=', lb.id)
    .executeTakeFirstOrThrow();
  const form = await ensureFormVersion(db, lbRow, await questionsFor(db, lb.id));
  const sub = await db
    .insertInto('report_submissions')
    .values({
      token_hash: sha256Hex(newDraftToken()),
      logbook_id: lb.id,
      form_id: form.id,
      payload: '{}',
      email: 'worker@example.org',
      expires_at: new Date(Date.now() + 86_400_000),
    })
    .returning(['id', 'expires_at'])
    .executeTakeFirstOrThrow();
  await releaseDraft(db, {
    draft: owner.draft,
    submissionId: sub.id,
    logbookId: lb.id,
    expiresAt: sub.expires_at,
  });
  return db
    .selectFrom('upload_slots')
    .selectAll()
    .where('slot_token', '=', slot_token)
    .executeTakeFirstOrThrow();
}

async function after(id: number) {
  return db.selectFrom('upload_slots').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

/** An evidence object, decrypted with the slot's own key. */
async function evidence(slot: Awaited<ReturnType<typeof after>>, suffix = ''): Promise<Buffer> {
  if (!slot.dek_wrapped || !slot.storage_key) throw new Error('no key or no object');
  const o = await files.storage.get('evidence', `${slot.storage_key}${suffix}`);
  if (!o) throw new Error(`no evidence object ${suffix}`);
  return decryptBuffer(files.ring.unwrap(slot.dek_wrapped), await readAll(o));
}

function inspect(buf: Buffer, ext: string, cmd: string[]): string {
  const p = join(files.dir, `inspect-${String(Math.random()).slice(2)}.${ext}`);
  writeFileSync(p, buf);
  const [bin = '', ...args] = cmd.map((c) => c.replace('{}', p));
  return execFileSync(bin, args, { encoding: 'utf8' });
}

beforeAll(async () => {
  db = testDatabase();
  files = filesFor(db);
  lb = await launchedLogbook(db, [
    { key: 'what', kind: 'long_text', label: 'What happened', required: true },
    { key: 'files', kind: 'file', label: 'Files' },
  ]);
});
afterAll(async () => {
  await db.destroy();
  removeDir(files.dir);
});

describe.skipIf(toolsMissing)(
  `re-encoding${TOOLS.length ? ` (missing: ${TOOLS.join(', ')})` : ''}`,
  () => {
    it('a photo loses its GPS, its camera and its description, and comes out upright', async () => {
      const original = jpegWithGps(files.dir);
      // The fixture really carries them: the tools see the GPS before.
      expect(
        inspect(original, 'jpg', ['identify', '-format', '%[EXIF:GPSLatitude]', '{}']),
      ).toContain('52/1');

      const slot = await staged(original, 'image/jpeg', 'IMG_0001.jpg');
      expect(await processSlot(files, slot.id)).toBe('clean');
      const done = await after(slot.id);

      const rendition = await evidence(done, '.rendition');
      expect(rendition.includes('Exif')).toBe(false);
      expect(rendition.includes(SECRET)).toBe(false);
      expect(rendition.includes('TestCam')).toBe(false);
      expect(inspect(rendition, 'jpg', ['identify', '-format', '%[EXIF:*]', '{}']).trim()).toBe('');
      // Turned as the camera said, then the instruction itself dropped.
      expect(inspect(rendition, 'jpg', ['identify', '-format', '%wx%h', '{}'])).toBe('48x64');
      expect(done.rendition_media_type).toBe('image/jpeg');

      // The ORIGINAL is the evidence: kept whole, and what the report seals.
      const kept = await evidence(done);
      expect(kept.equals(original)).toBe(true);
      expect(done.sha256).toBe(createHash('sha256').update(original).digest('hex'));
      expect(done.byte_size).toBe(original.length);
      expect(done.media_type).toBe('image/jpeg');

      // What was removed is on record, under the same key.
      const meta = JSON.parse(
        decryptBuffer(
          files.ring.unwrap(done.dek_wrapped ?? Buffer.alloc(0)),
          done.meta_enc ?? Buffer.alloc(0),
        ).toString(),
      ) as { removed: { segment: string }[] };
      expect(meta.removed.map((r) => r.segment)).toContain('0xFFE1');

      // And staging no longer holds it.
      expect(await files.storage.head('staging', done.staging_key)).toBeNull();
    });

    it('a PNG keeps its transparency format and loses its text', async () => {
      const slot = await staged(pngWithText(files.dir), 'image/png');
      expect(await processSlot(files, slot.id)).toBe('clean');
      const r = await evidence(await after(slot.id), '.rendition');
      expect(r.subarray(1, 4).toString()).toBe('PNG');
      expect(r.includes(SECRET)).toBe(false);
      expect(r.includes('tEXt')).toBe(false);
    });

    it('a video loses its location, title and capture time, and gets a clean still', async () => {
      const original = videoWithLocation(files.dir);
      expect(original.includes('+52.5200')).toBe(true);
      const slot = await staged(original, 'video/quicktime');
      expect(await processSlot(files, slot.id)).toBe('clean');
      const done = await after(slot.id);
      const r = await evidence(done, '.rendition');
      expect(r.includes('+52.5200')).toBe(false);
      expect(r.includes(SECRET)).toBe(false);
      expect(r.includes('Lavf')).toBe(false);
      const tags = inspect(r, 'mp4', [
        'ffprobe',
        '-v',
        'error',
        '-show_entries',
        'format_tags:stream_tags',
        '-of',
        'json',
        '{}',
      ]);
      expect(tags).not.toMatch(/location|creation_time|title/);
      expect(done.has_poster).toBe(true);
      const poster = await evidence(done, '.poster');
      expect(poster.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
      expect(Number(done.duration_seconds)).toBeGreaterThan(0.5);
    });

    it('a sound recording loses its tags', async () => {
      const original = audioWithTags(files.dir);
      expect(original.includes(SECRET)).toBe(true);
      const slot = await staged(original, 'audio/mpeg');
      expect(await processSlot(files, slot.id)).toBe('clean');
      const done = await after(slot.id);
      expect(done.rendition_media_type).toBe('audio/mp4');
      expect((await evidence(done, '.rendition')).includes(SECRET)).toBe(false);
    });

    it('a PDF is drawn as page images; the PDF and its author are never what is shown', async () => {
      const slot = await staged(pdfWithAuthor(2), 'application/pdf');
      expect(await processSlot(files, slot.id)).toBe('clean');
      const done = await after(slot.id);
      expect(done.page_count).toBe(2);
      for (const suffix of ['.rendition', '.page2']) {
        const page = await evidence(done, suffix);
        expect(page.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
        expect(page.includes(SECRET)).toBe(false);
      }
    });

    it('what the bytes are decides, not what the browser said', async () => {
      const slot = await staged(Buffer.from('MZ this is a program, not a photo'), 'image/jpeg');
      expect(await processSlot(files, slot.id)).toBe('rejected');
      const done = await after(slot.id);
      expect(done.status_detail).toMatch(/not a photo/);
      expect(done.dek_wrapped).toBeNull();
    });

    it('a photo that will not decode is refused as unreadable, and keeps nothing', async () => {
      const slot = await staged(
        Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]),
        'image/jpeg',
      );
      expect(await processSlot(files, slot.id)).toBe('refused');
      const done = await after(slot.id);
      expect(done.status).toBe('unreadable');
      expect(done.dek_wrapped).toBeNull();
      await workOnce(files);
      expect(await files.storage.head('staging', done.staging_key)).toBeNull();
    });

    it("a logbook's limits apply to what the file really is: too long, too many pages", async () => {
      await setLogbookLimits(db, lb.id, { maxVideoSeconds: 5, maxDocumentPages: 1 });
      try {
        const long = await staged(videoWithLocation(files.dir, 7), 'video/quicktime');
        expect(await processSlot(files, long.id)).toBe('refused');
        expect((await after(long.id)).status).toBe('rejected');
        const pdf = await staged(pdfWithAuthor(3), 'application/pdf');
        expect(await processSlot(files, pdf.id)).toBe('refused');
        expect((await after(pdf.id)).status_detail).toMatch(/3 pages/);
      } finally {
        await setLogbookLimits(db, lb.id, { maxVideoSeconds: null, maxDocumentPages: null });
      }
    });
  },
);

describe('the pass', () => {
  it('claims only released work, once, and sweeps what nobody sent', async () => {
    // Never sent: staged, but no Send.
    const owner = { draft: draftHash(newDraftToken()) };
    const { slot_token } = await createUploadSlot(files, owner, {
      name: 'a',
      type: 'image/jpeg',
      size: 4,
      logbookId: lb.id,
      email: 'sweep@example.org',
    });
    await receiveUpload(files, owner, slot_token, Readable.from([Buffer.alloc(4)]));
    await workOnce(files);
    let row = await db
      .selectFrom('upload_slots')
      .selectAll()
      .where('slot_token', '=', slot_token)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('uploaded');

    // Abandoned: past its time. Its key and its bytes go.
    await db
      .updateTable('upload_slots')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', row.id)
      .execute();
    const pass = await workOnce(files);
    expect(pass.swept).toBeGreaterThanOrEqual(1);
    row = await db
      .selectFrom('upload_slots')
      .selectAll()
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('expired');
    expect(row.dek_wrapped).toBeNull();
    expect(row.contact_hmac).toBeNull();
    expect(await files.storage.head('staging', row.staging_key)).toBeNull();
    expect(
      await db
        .selectFrom('storage_deletions')
        .select('id')
        .where('key', '=', row.staging_key)
        .execute(),
    ).toEqual([]);
  });

  it('a claim left by a worker that died is tried again', async () => {
    const slot = await staged(Buffer.from('anything'), 'image/jpeg');
    await db
      .updateTable('upload_slots')
      .set({ status: 'processing', claimed_at: new Date(Date.now() - 16 * 60 * 1000) })
      .where('id', '=', slot.id)
      .execute();
    const pass = await workOnce(files);
    expect(pass.requeued).toBeGreaterThanOrEqual(1);
    expect(['rejected', 'uploaded']).toContain((await after(slot.id)).status);
  });
});
