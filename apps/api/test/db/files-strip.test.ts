/**
 * Lifting metadata out of a container: the WebP case, and doing it twice.
 *
 * THE PROMISES UNDER TEST:
 *   - a WebP's EXIF (with its GPS) and XMP are lifted out, the outer size is
 *     rewritten so the file still opens, and the worker's copy carries none
 *     of it; what was removed is on the encrypted record;
 *   - stripping is idempotent: stripping a stripped file changes no byte and
 *     removes nothing, for every format it walks. The worker strips what its
 *     encoders wrote (strip.ts says why), so a walk that kept finding or
 *     losing something on a second pass would be eating the picture.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/database.ts';
import { decryptBuffer } from '../../src/files/envelope.ts';
import { stripMetadata } from '../../src/files/strip.ts';
import { processSlot } from '../../src/files/worker.ts';
import {
  SECRET,
  TOOLS,
  evidenceOf,
  filesFor,
  jpegWithGps,
  pngWithText,
  removeDir,
  slotRow,
  stageAndSend,
  toolsMissing,
  webpWithExif,
} from './files-helpers.ts';
import { launchedLogbook, testDatabase } from './helpers.ts';

let db: Database;
let files: ReturnType<typeof filesFor>;
let lb: { id: number; slug: string };

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

function identify(buf: Buffer, ext: string, format: string): string {
  const p = join(files.dir, `inspect-${String(Math.random()).slice(2)}.${ext}`);
  writeFileSync(p, buf);
  // An empty answer (no profiles) comes with a warning on stderr; the answer is what counts.
  return execFileSync('identify', ['-format', format, p], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

describe.skipIf(toolsMissing)(
  `metadata stripping${TOOLS.length ? ` (missing: ${TOOLS.join(', ')})` : ''}`,
  () => {
    it('a WebP loses its EXIF and XMP, and still opens', () => {
      const original = webpWithExif(files.dir);
      // The fixture really carries them: the decoder sees both profiles before.
      expect(identify(original, 'webp', '%[profiles]')).toBe('exif,xmp');
      expect(original.includes(SECRET)).toBe(true);

      const { clean, removed } = stripMetadata(original, 'image/webp');
      expect(removed.map((r) => r.segment)).toEqual(['EXIF', 'XMP ']);
      expect(clean.includes(SECRET)).toBe(false);
      expect(clean.includes('TestCam')).toBe(false);
      // The RIFF size is the file's length less eight, or readers stop early.
      expect(clean.readUInt32LE(4)).toBe(clean.length - 8);
      expect(identify(clean, 'webp', '%wx%h')).toBe('64x48');
      expect(identify(clean, 'webp', '%[profiles]')).toBe('');
    });

    it('through the worker: the copy carries none of it, and the record says what went', async () => {
      const original = webpWithExif(files.dir);
      const slot = await stageAndSend(files, lb.id, original, 'image/webp', 'IMG_0002.webp');
      expect(await processSlot(files, slot.id)).toBe('clean');
      const done = await slotRow(files, slot.id);
      expect(done.media_type).toBe('image/webp');

      const rendition = await evidenceOf(files, done, '.rendition');
      expect(rendition.includes(SECRET)).toBe(false);
      expect(rendition.includes('TestCam')).toBe(false);
      expect(rendition.includes('Exif')).toBe(false);
      expect(identify(rendition, 'jpg', '%[EXIF:*]').trim()).toBe('');

      // The original is the evidence, whole.
      expect((await evidenceOf(files, done)).equals(original)).toBe(true);
      const meta = JSON.parse(
        decryptBuffer(
          files.ring.unwrap(done.dek_wrapped ?? Buffer.alloc(0)),
          done.meta_enc ?? Buffer.alloc(0),
        ).toString(),
      ) as { removed: { segment: string }[] };
      expect(meta.removed.map((r) => r.segment)).toEqual(['EXIF', 'XMP ']);
    });

    it.each([
      ['image/jpeg', () => jpegWithGps(files.dir)],
      ['image/png', () => pngWithText(files.dir)],
      ['image/webp', () => webpWithExif(files.dir)],
    ])('stripping a %s twice changes nothing the second time', (type, make) => {
      const once = stripMetadata(make(), type);
      expect(once.removed.length).toBeGreaterThan(0);
      const twice = stripMetadata(once.clean, type);
      expect(twice.removed).toEqual([]);
      expect(twice.clean.equals(once.clean)).toBe(true);
    });

    it('and what the worker wrote is already clean: a further strip is a no-op', async () => {
      for (const [body, type] of [
        [jpegWithGps(files.dir), 'image/jpeg'],
        [pngWithText(files.dir), 'image/png'],
        [webpWithExif(files.dir), 'image/webp'],
      ] as const) {
        const slot = await stageAndSend(files, lb.id, body, type);
        expect(await processSlot(files, slot.id)).toBe('clean');
        const done = await slotRow(files, slot.id);
        const rendition = await evidenceOf(files, done, '.rendition');
        const again = stripMetadata(rendition, done.rendition_media_type ?? '');
        expect(again.removed).toEqual([]);
        expect(again.clean.equals(rendition)).toBe(true);
      }
    });
  },
);

describe('a file with nothing to strip', () => {
  it('comes back byte for byte, for a type the walk does not know too', () => {
    const notAPhoto = Buffer.from('%PDF-1.4 whatever');
    expect(stripMetadata(notAPhoto, 'application/pdf')).toEqual({ clean: notAPhoto, removed: [] });
  });
});
