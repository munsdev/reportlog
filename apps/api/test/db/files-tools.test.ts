/**
 * A media tool missing from the server holds back only the files that need
 * it (`TOOLS_FOR` in media.ts).
 *
 * THE PROMISES UNDER TEST:
 *   - without ffmpeg, photos and documents are still prepared, and videos
 *     and sound recordings wait, untouched, with a status naming the
 *     package to install; without ImageMagick it is the other way round,
 *     and without poppler only documents wait;
 *   - a file that waits is not refused: its key and bytes are kept, and the
 *     next pass after the package is installed prepares it, in the same
 *     running worker.
 *
 * The tools are hidden by pointing PATH at a directory holding only the ones
 * a case allows, as an unfinished install would.
 */
import { accessSync, constants, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/database.ts';
import { missingToolsFor } from '../../src/files/media.ts';
import { workOnce } from '../../src/files/worker.ts';
import {
  TOOLS,
  audioWithTags,
  filesFor,
  jpegWithGps,
  pdfWithAuthor,
  removeDir,
  slotRow,
  stageAndSend,
  toolsMissing,
  videoWithLocation,
} from './files-helpers.ts';
import { launchedLogbook, testDatabase } from './helpers.ts';

let db: Database;
let files: ReturnType<typeof filesFor>;
let lb: { id: number; slug: string };
const PATH = process.env.PATH ?? '';
let fixtures: { photo: Buffer; video: Buffer; audio: Buffer; pdf: Buffer };

/** Where a tool is installed, or null. */
function installed(bin: string): string | null {
  for (const dir of PATH.split(delimiter)) {
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return join(dir, bin);
    } catch {
      // not here
    }
  }
  return null;
}

/** PATH holding only these of the worker's tools: the real ones, linked from where they are. */
function onlyTools(...bins: string[]): void {
  const dir = join(files.dir, `bin-${bins.join('-')}`);
  mkdirSync(dir, { recursive: true });
  for (const bin of bins) {
    const real = installed(bin);
    if (!real) throw new Error(`${bin} is not installed here`);
    if (!existsSync(join(dir, bin))) symlinkSync(real, join(dir, bin));
  }
  process.env.PATH = dir;
}

/** Stage one of each kind and run a pass. Returns each slot as it is after. */
async function onePass() {
  const slots = {
    photo: await stageAndSend(files, lb.id, fixtures.photo, 'image/jpeg', 'photo.jpg'),
    video: await stageAndSend(files, lb.id, fixtures.video, 'video/quicktime', 'clip.mov'),
    audio: await stageAndSend(files, lb.id, fixtures.audio, 'audio/mpeg', 'memo.mp3'),
    pdf: await stageAndSend(files, lb.id, fixtures.pdf, 'application/pdf', 'letter.pdf'),
  };
  await workOnce(files);
  return {
    photo: await slotRow(files, slots.photo.id),
    video: await slotRow(files, slots.video.id),
    audio: await slotRow(files, slots.audio.id),
    pdf: await slotRow(files, slots.pdf.id),
  };
}

const waiting = (pkg: string) => ({
  status: 'uploaded',
  status_detail: `waiting for ${pkg} to be installed on the server`,
});

describe.skipIf(toolsMissing)(
  `a missing tool${TOOLS.length ? ` (missing: ${TOOLS.join(', ')})` : ''}`,
  () => {
    beforeAll(async () => {
      db = testDatabase();
      files = filesFor(db);
      lb = await launchedLogbook(db, [
        { key: 'what', kind: 'long_text', label: 'What happened', required: true },
        { key: 'files', kind: 'file', label: 'Files' },
      ]);
      // Made while every tool is still on PATH.
      fixtures = {
        photo: jpegWithGps(files.dir),
        video: videoWithLocation(files.dir),
        audio: audioWithTags(files.dir),
        pdf: pdfWithAuthor(1),
      };
    });
    afterEach(() => {
      process.env.PATH = PATH;
    });
    afterAll(async () => {
      process.env.PATH = PATH;
      await db.destroy();
      removeDir(files.dir);
    });

    it('names, for each type, only the tools that type needs', async () => {
      onlyTools('convert');
      expect(await missingToolsFor('image/jpeg')).toEqual([]);
      expect(await missingToolsFor('video/mp4')).toEqual(['ffmpeg', 'ffprobe']);
      expect(await missingToolsFor('audio/mpeg')).toEqual(['ffmpeg', 'ffprobe']);
      expect(await missingToolsFor('application/pdf')).toEqual(['pdfinfo', 'pdftoppm']);
      onlyTools('ffmpeg', 'ffprobe', 'pdfinfo', 'pdftoppm');
      expect(await missingToolsFor('image/png')).toEqual(['convert']);
      expect(await missingToolsFor('image/webp')).toEqual(['convert']);
      expect(await missingToolsFor('video/webm')).toEqual([]);
      expect(await missingToolsFor('application/pdf')).toEqual([]);
    });

    it('without ffmpeg: photos and documents go ahead, video and sound wait', async () => {
      onlyTools('convert', 'pdfinfo', 'pdftoppm');
      const after = await onePass();
      expect(after.photo.status).toBe('clean');
      expect(after.pdf.status).toBe('clean');
      expect(after.video).toMatchObject(waiting('ffmpeg'));
      expect(after.audio).toMatchObject(waiting('ffmpeg'));
      // Waiting is not refusing: the key and the staged bytes are kept.
      for (const s of [after.video, after.audio]) {
        expect(s.dek_wrapped).not.toBeNull();
        expect(await files.storage.head('staging', s.staging_key)).not.toBeNull();
      }

      // ffmpeg installed while the worker runs: the next pass prepares them.
      process.env.PATH = PATH;
      await workOnce(files);
      expect((await slotRow(files, after.video.id)).status).toBe('clean');
      expect((await slotRow(files, after.audio.id)).status).toBe('clean');
    });

    it('without ImageMagick: photos wait, everything else goes ahead', async () => {
      onlyTools('ffmpeg', 'ffprobe', 'pdfinfo', 'pdftoppm');
      const after = await onePass();
      expect(after.photo).toMatchObject(waiting('imagemagick (with HEIC support: libheif)'));
      expect(after.video.status).toBe('clean');
      expect(after.audio.status).toBe('clean');
      expect(after.pdf.status).toBe('clean');
      process.env.PATH = PATH;
      await workOnce(files);
      expect((await slotRow(files, after.photo.id)).status).toBe('clean');
    });

    it('without poppler: only documents wait', async () => {
      onlyTools('convert', 'ffmpeg', 'ffprobe');
      const after = await onePass();
      expect(after.pdf).toMatchObject(waiting('poppler-utils'));
      expect([after.photo, after.video, after.audio].map((s) => s.status)).toEqual([
        'clean',
        'clean',
        'clean',
      ]);
      process.env.PATH = PATH;
      await workOnce(files);
      expect((await slotRow(files, after.pdf.id)).status).toBe('clean');
    });

    it('a tool gone between the check and the run: the file waits, it is not refused', async () => {
      // Executable, so the check passes; its interpreter is missing, so
      // starting it fails as a removed program does (ENOENT). As during an
      // upgrade that replaces the package under a running worker.
      const dir = join(files.dir, 'bin-vanishing');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'convert'), '#!/nonexistent/interpreter\n', { mode: 0o755 });
      process.env.PATH = dir;
      const slot = await stageAndSend(files, lb.id, fixtures.photo, 'image/jpeg', 'photo.jpg');
      await workOnce(files);
      const after = await slotRow(files, slot.id);
      expect(after).toMatchObject(waiting('imagemagick (with HEIC support: libheif)'));
      expect(after.dek_wrapped).not.toBeNull();
      process.env.PATH = PATH;
      await workOnce(files);
      expect((await slotRow(files, slot.id)).status).toBe('clean');
    });

    it('a file waiting for a tool is still being prepared, as far as confirming goes', async () => {
      onlyTools('convert');
      const after = await onePass();
      expect(after.video.status).toBe('uploaded');
      const { stillPreparing } = await import('../../src/files/filing.ts');
      expect(await stillPreparing(db, after.video.submission_id ?? 0)).toEqual(['clip.mov']);
    });
  },
);
