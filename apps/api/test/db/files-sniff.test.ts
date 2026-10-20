/**
 * What a file is comes from its bytes: the per-format table, and the worker
 * acting on it.
 *
 * THE PROMISES UNDER TEST:
 *   - every format the site takes is recognised by its first bytes, and the
 *     containers that share a start (RIFF: WebP and WAV; ISO media: HEIC,
 *     MP4, MOV, M4A) are told apart by what follows;
 *   - a program, an empty file and anything unrecognised are nothing, so
 *     the worker refuses them whatever the browser said;
 *   - SVG is never taken: not by its declared type, and not by its bytes
 *     dressed up as a photo. It is markup a browser runs.
 *
 * Legacy's table (scripts/selftest.js "type sniffing") case for case, plus
 * the real files the tools make, through the worker.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/database.ts';
import {
  ALLOWED_TYPES,
  KINDS,
  TYPES_OF,
  isAllowedType,
  kindFor,
  sniffType,
} from '../../src/files/kinds.ts';
import { createUploadSlot, draftHash, newDraftToken } from '../../src/files/slots.ts';
import { processSlot } from '../../src/files/worker.ts';
import {
  SECRET,
  TOOLS,
  evidenceOf,
  filesFor,
  isomAudioOnly,
  m4aMemo,
  removeDir,
  slotRow,
  stageAndSend,
  toolsMissing,
  webmClip,
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

const latin = (s: string) => Buffer.from(s, 'latin1');
const riff = (tag: string) => Buffer.concat([latin('RIFF'), Buffer.alloc(4), latin(tag)]);
/** An ISO media file's first box, naming its brand. */
const ftyp = (brand: string) =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), latin('ftyp'), latin(brand), Buffer.alloc(8)]);

describe('the table', () => {
  it.each([
    ['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['WebP', riff('WEBP'), 'image/webp'],
    // Both start RIFF: reading four bytes would hand a voice memo to an image decoder.
    ['WAV', riff('WAVE'), 'audio/wav'],
    ['HEIC (an iPhone photo)', ftyp('heic'), 'image/heic'],
    ['HEIF (mif1)', ftyp('mif1'), 'image/heic'],
    ['MOV (an iPhone video)', ftyp('qt  '), 'video/quicktime'],
    ['MP4', ftyp('isom'), 'video/mp4'],
    ['MP4 (mp42)', ftyp('mp42'), 'video/mp4'],
    // Sound alone in the same container says so in its brand.
    ['M4A (a voice memo)', ftyp('M4A '), 'audio/mp4'],
    ['WebM', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), 'video/webm'],
    ['MP3 with ID3', latin('ID3\x04\x00\x00\x00'), 'audio/mpeg'],
    ['bare MPEG audio', Buffer.from([0xff, 0xfb, 0x90, 0x00]), 'audio/mpeg'],
    ['ADTS AAC', Buffer.from([0xff, 0xf1, 0x50, 0x80]), 'audio/aac'],
    ['Ogg', latin('OggS\x00\x02'), 'audio/ogg'],
    ['PDF', latin('%PDF-1.7\n'), 'application/pdf'],
    // Readers accept a header anywhere in the first 1024 bytes, so this does too.
    [
      'PDF after leading junk',
      Buffer.concat([Buffer.alloc(20, 0x20), latin('%PDF-1.4\n')]),
      'application/pdf',
    ],
  ])('%s', (_name, bytes, type) => {
    expect(sniffType(bytes)).toBe(type);
    expect(isAllowedType(type)).toBe(true);
  });

  it.each([
    ['an ELF program', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])],
    ['a Windows program', latin('MZ\x90\x00')],
    ['an empty file', Buffer.alloc(0)],
    ['an unknown ISO brand', ftyp('xxxx')],
    ['RIFF that is neither', riff('AVI ')],
    [
      'an SVG',
      latin(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    ],
    ['an SVG without its declaration', latin('<svg onload="alert(1)"></svg>')],
    ['HTML', latin('<!doctype html><script>alert(1)</script>')],
    [
      'a PDF header past the first 1024 bytes',
      Buffer.concat([Buffer.alloc(1024, 0x20), latin('%PDF-1.4')]),
    ],
  ])('%s is nothing', (_name, bytes) => {
    expect(sniffType(bytes)).toBeNull();
  });

  it('every type taken belongs to exactly one kind', () => {
    for (const t of ALLOWED_TYPES) {
      expect(kindFor(t)).not.toBeNull();
      expect(KINDS.filter((k) => TYPES_OF[k].includes(t))).toHaveLength(1);
    }
  });
});

describe('SVG never', () => {
  it('is not a type the site takes, under any of its names', () => {
    for (const t of ['image/svg+xml', 'IMAGE/SVG+XML', 'image/svg', 'text/xml', 'text/html'])
      expect(isAllowedType(t)).toBe(false);
    expect(ALLOWED_TYPES.some((t) => t.includes('svg'))).toBe(false);
  });

  it('a slot that declares it is refused before a byte is sent', async () => {
    await expect(
      createUploadSlot(
        files,
        { draft: draftHash(newDraftToken()) },
        {
          name: 'map.svg',
          type: 'image/svg+xml',
          size: 100,
          logbookId: lb.id,
          email: 'svg@example.org',
        },
      ),
    ).rejects.toMatchObject({ status: 400, code: 'unsupported_type' });
  });

  it('and its bytes declared as a PNG are refused by the worker, keeping nothing', async () => {
    const slot = await stageAndSend(
      files,
      lb.id,
      latin('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>'),
      'image/png',
      'picture.png',
    );
    expect(await processSlot(files, slot.id)).toBe('rejected');
    const done = await slotRow(files, slot.id);
    expect(done.status).toBe('rejected');
    expect(done.status_detail).toMatch(/not a photo, video, sound recording or PDF/);
    expect(done.dek_wrapped).toBeNull();
    expect(done.storage_key).toBeNull();
  });
});

describe('the worker believes the bytes', () => {
  it('an ELF program declared as a video is refused', async () => {
    const elf = Buffer.concat([
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
      Buffer.alloc(56),
    ]);
    const slot = await stageAndSend(files, lb.id, elf, 'video/mp4', 'clip.mp4');
    expect(await processSlot(files, slot.id)).toBe('rejected');
    expect((await slotRow(files, slot.id)).dek_wrapped).toBeNull();
  });

  it('an empty file is refused before it is staged', async () => {
    await expect(
      createUploadSlot(
        files,
        { draft: draftHash(newDraftToken()) },
        {
          name: 'empty.jpg',
          type: 'image/jpeg',
          size: 0,
          logbookId: lb.id,
          email: 'empty@example.org',
        },
      ),
    ).rejects.toMatchObject({ status: 400, code: 'too_large' });
  });

  describe.skipIf(toolsMissing)(
    `real files${TOOLS.length ? ` (missing: ${TOOLS.join(', ')})` : ''}`,
    () => {
      it('a WebP declared as a JPEG is decoded as the WebP it is', async () => {
        const slot = await stageAndSend(
          files,
          lb.id,
          webpWithExif(files.dir),
          'image/jpeg',
          'x.jpg',
        );
        expect(await processSlot(files, slot.id)).toBe('clean');
        const done = await slotRow(files, slot.id);
        expect(done.media_type).toBe('image/webp');
        expect(done.rendition_media_type).toBe('image/jpeg');
      });

      it('a WebM is a video, re-encoded to MP4 without its title', async () => {
        const original = webmClip(files.dir);
        expect(sniffType(original)).toBe('video/webm');
        const slot = await stageAndSend(files, lb.id, original, 'video/webm', 'clip.webm');
        expect(await processSlot(files, slot.id)).toBe('clean');
        const done = await slotRow(files, slot.id);
        expect(done).toMatchObject({
          media_type: 'video/webm',
          rendition_media_type: 'video/mp4',
          has_poster: true,
        });
        expect((await evidenceOf(files, done, '.rendition')).includes(SECRET)).toBe(false);
      });

      it('a voice memo in MP4 (M4A) is sound, not a video with no picture', async () => {
        const original = m4aMemo(files.dir);
        expect(sniffType(original)).toBe('audio/mp4');
        // Declared as a video: the browser's word changes nothing.
        const slot = await stageAndSend(files, lb.id, original, 'video/mp4', 'memo.m4a');
        expect(await processSlot(files, slot.id)).toBe('clean');
        const done = await slotRow(files, slot.id);
        expect(done).toMatchObject({
          media_type: 'audio/mp4',
          rendition_media_type: 'audio/mp4',
          has_poster: false,
        });
        expect((await evidenceOf(files, done, '.rendition')).includes(SECRET)).toBe(false);
      });

      it('sound alone under a video brand is refused in plain words, as legacy refused it', async () => {
        // The container says video (isom) and holds no picture. Legacy's
        // worker refused it ("no video track found"); so does this one. Named
        // in docs/status/R2-files-tests.md as a question, not changed here.
        const original = isomAudioOnly(files.dir);
        expect(sniffType(original)).toBe('video/mp4');
        const slot = await stageAndSend(files, lb.id, original, 'audio/mp4', 'recording.mp4');
        expect(await processSlot(files, slot.id)).toBe('refused');
        expect(await slotRow(files, slot.id)).toMatchObject({
          status: 'rejected',
          status_detail: 'there is no picture in this video',
          dek_wrapped: null,
        });
      });
    },
  );
});
