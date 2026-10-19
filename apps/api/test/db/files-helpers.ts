/**
 * What the files tests share: a files context on a throwaway directory, and
 * real files carrying exactly the metadata re-encoding must remove.
 *
 * The fixtures are made here rather than checked in, so it is plain what is
 * inside each one: a GPS position, a camera, a turned picture, a location
 * on a video, an artist on a recording, an author on a PDF, each with a
 * marker string a test can look for in the bytes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '../../src/db/database.ts';
import { filesFrom } from '../../src/files/context.ts';
import type { Files } from '../../src/files/context.ts';

export const FILES_KEY = Buffer.alloc(32, 5).toString('base64');
export const SECRET = 'SECRET-PLACE-5252N';

export function filesFor(
  db: Database,
  dir = mkdtempSync(join(tmpdir(), 'rl-files-')),
): Files & { dir: string } {
  const f = filesFrom(db, {
    FILES_KEY,
    FILES_STORAGE: 'disk',
    FILES_DIR: dir,
    FILES_STAGING_QUOTA_REPORTS: 3,
  });
  if (typeof f === 'string') throw new Error(f);
  return { ...f, dir };
}

export const removeDir = (dir: string) => {
  rmSync(dir, { recursive: true, force: true });
};

function has(bin: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
/**
 * The tools the worker needs. Missing here, the media tests are skipped with
 * a reason; missing in CI, they fail, because a suite that quietly skips is
 * a suite nobody ran.
 */
export const TOOLS = ['convert', 'ffmpeg', 'ffprobe', 'pdfinfo', 'pdftoppm'].filter((b) => !has(b));
export const toolsMissing = TOOLS.length > 0 && !process.env.CI;

// ── a JPEG with EXIF: a camera, a description, orientation 6, and GPS ───

function exifSegment(): Buffer {
  const make = Buffer.from('TestCam\0', 'latin1');
  const desc = Buffer.from(`${SECRET}\0`, 'latin1');
  // Little-endian TIFF. IFD0 at 8 with 4 entries, then the GPS IFD, then data.
  const ifd0 = 8;
  const ifd0Size = 2 + 4 * 12 + 4;
  const gps = ifd0 + ifd0Size;
  const gpsSize = 2 + 2 * 12 + 4;
  let data = gps + gpsSize;
  const descAt = data;
  data += desc.length;
  const makeAt = data;
  data += make.length;
  const latAt = data;
  data += 24;
  const t = Buffer.alloc(data);
  t.write('II', 0, 'latin1');
  t.writeUInt16LE(42, 2);
  t.writeUInt32LE(ifd0, 4);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    t.writeUInt16LE(tag, at);
    t.writeUInt16LE(type, at + 2);
    t.writeUInt32LE(count, at + 4);
    if (type === 3 && count === 1) t.writeUInt16LE(value, at + 8);
    else t.writeUInt32LE(value, at + 8);
  };
  t.writeUInt16LE(4, ifd0);
  entry(ifd0 + 2, 0x010e, 2, desc.length, descAt); // ImageDescription
  entry(ifd0 + 14, 0x010f, 2, make.length, makeAt); // Make
  entry(ifd0 + 26, 0x0112, 3, 1, 6); // Orientation: turned
  entry(ifd0 + 38, 0x8825, 4, 1, gps); // GPSInfo
  t.writeUInt32LE(0, ifd0 + 50);
  t.writeUInt16LE(2, gps);
  t.writeUInt16LE(0x0001, gps + 2); // GPSLatitudeRef "N"
  t.writeUInt16LE(2, gps + 4);
  t.writeUInt32LE(2, gps + 6);
  t.write('N\0', gps + 10, 'latin1');
  entry(gps + 14, 0x0002, 5, 3, latAt); // GPSLatitude 52/1 31/1 12/1
  t.writeUInt32LE(0, gps + 26);
  desc.copy(t, descAt);
  make.copy(t, makeAt);
  [52, 1, 31, 1, 12, 1].forEach((v, i) => t.writeUInt32LE(v, latAt + i * 4));
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

/** A 64×48 red picture whose EXIF says: turn me, I was taken at 52°N, by TestCam. */
export function jpegWithGps(dir: string): Buffer {
  const plain = join(dir, 'plain.jpg');
  execFileSync('convert', ['-size', '64x48', 'xc:red', '-strip', `jpeg:${plain}`]);
  const jpg = readFileSync(plain);
  // Spliced in straight after the start-of-image marker.
  return Buffer.concat([jpg.subarray(0, 2), exifSegment(), jpg.subarray(2)]);
}

export function pngWithText(dir: string): Buffer {
  const out = join(dir, 'text.png');
  execFileSync('convert', ['-size', '20x10', 'xc:blue', '-set', 'comment', SECRET, `png:${out}`]);
  return readFileSync(out);
}

export function videoWithLocation(dir: string, seconds = 1): Buffer {
  // QuickTime, as a phone writes it: the MP4 muxer would drop the location.
  const out = join(dir, 'clip.mov');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${String(seconds)}:size=320x240:rate=10`,
    '-f',
    'lavfi',
    '-i',
    `sine=duration=${String(seconds)}`,
    '-metadata',
    'location=+52.5200+013.4050/',
    '-metadata',
    `title=${SECRET}`,
    '-metadata',
    'creation_time=2026-10-01T09:30:00Z',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-shortest',
    out,
  ]);
  return readFileSync(out);
}

export function audioWithTags(dir: string): Buffer {
  const out = join(dir, 'memo.mp3');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=duration=1',
    '-metadata',
    `artist=${SECRET}`,
    '-c:a',
    'libmp3lame',
    out,
  ]);
  return readFileSync(out);
}

/** A one-page PDF whose information dictionary names its author. */
export function pdfWithAuthor(pages = 1): Buffer {
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${String(4 + i)} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${String(pages)} >>`);
  objects.push(`<< /Author (${SECRET}) /Producer (TestWriter) >>`);
  for (let i = 0; i < pages; i++)
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${String(i + 1)} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
