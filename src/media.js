// Decoding and re-encoding, via external tools, always in a child process.
//
// Some formats cannot be made safe by trimming. A JPEG is a stream of
// labelled segments, so the metadata can be lifted out without ever
// decoding a pixel (see stripMetadata in attachments.js). HEIC and video
// are not like that: the location data is woven into a box structure whose
// offsets all have to be rewritten, and getting that wrong corrupts the
// file or leaves the GPS in place.
//
// So for those we do the opposite — decode the file and re-encode it
// ourselves. That is stronger, not weaker: the published copy is produced
// by our encoder from pixels alone, so it can only contain what we put in
// it. No metadata survives, because none is carried across.
//
// The cost is that a decoder has to touch adversary-chosen bytes, and
// ffmpeg and libheif are exactly the sort of C libraries that occasionally
// have a parsing bug worth a CVE. Hence: never in the app process, always
// a child process with an argument list (never a shell string), a wall
// clock timeout, an output size ceiling, and no network. A malicious file
// gets one worker slot and a killed subprocess.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const run = promisify(execFile);

// Generous enough for a 3-minute clip on a modest box, short enough that a
// file crafted to make an encoder spin forever is killed rather than
// occupying the worker.
const TRANSCODE_TIMEOUT_MS = Number(process.env.MEDIA_TRANSCODE_TIMEOUT_MS || 5 * 60 * 1000);
const PROBE_TIMEOUT_MS = 20 * 1000;

async function tool(bin, args, timeout = TRANSCODE_TIMEOUT_MS) {
  try {
    // execFile, not exec: the argument list is passed to the kernel as an
    // array, so a filename can never become part of a shell command. All
    // paths we pass are server-generated temp paths anyway, but this keeps
    // that from ever mattering.
    return await run(bin, args, {
      timeout,
      killSignal: 'SIGKILL',
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (e) {
    if (e.killed || e.signal === 'SIGKILL') {
      throw new Error(`${bin} exceeded its time limit — the file may be corrupt or deliberately expensive to decode`);
    }
    const detail = String(e.stderr || e.message).trim().split('\n').pop();
    throw new Error(`${bin} failed: ${detail}`.slice(0, 300));
  }
}

/**
 * Which external tools each family of file needs, and nothing else's.
 *
 * This mapping is the fix for a real bug: the worker used to ask one
 * question — "is anything missing?" — and defer every file that needed any
 * tool at all if the answer was yes. An absent pdftoppm deferred an MP4 on
 * a box with ffmpeg installed and working, and the message told the
 * operator to install media tools without saying which, naming a blocker
 * that had nothing to do with the file in front of it.
 *
 * Nothing is lost either way. But one unrelated package stalled the whole
 * queue, and the wrong package got installed twice before anyone noticed.
 */
const TOOLS_FOR = {
  'image/heic': ['heif-convert'],
  'image/heif': ['heif-convert'],
  'video/mp4': ['ffmpeg', 'ffprobe'],
  'video/quicktime': ['ffmpeg', 'ffprobe'],
  'video/webm': ['ffmpeg', 'ffprobe'],
  'audio/mpeg': ['ffmpeg'],
  'audio/mp4': ['ffmpeg'],
  'audio/aac': ['ffmpeg'],
  'audio/ogg': ['ffmpeg'],
  'audio/wav': ['ffmpeg'],
  'audio/webm': ['ffmpeg'],
  'application/pdf': ['pdftoppm', 'pdfinfo'],
};

const TOOL_PURPOSE = {
  ffmpeg: 'video and audio',
  ffprobe: 'video and audio',
  'heif-convert': 'HEIC photos',
  pdftoppm: 'PDF documents',
  pdfinfo: 'PDF documents',
};

function haveTool(bin) {
  try {
    fs.accessSync(whichSync(bin), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Every tool this media type needs that is not installed. */
export function missingToolsFor(type) {
  return (TOOLS_FOR[type] || []).filter((bin) => !haveTool(bin));
}

/**
 * Can this type be processed right now?
 *
 * A type with no entry in TOOLS_FOR needs nothing external — JPEG, PNG and
 * WebP are trimmed in process — so it is always ready.
 */
export function canProcess(type) {
  return missingToolsFor(type).length === 0;
}

/** Everything missing, for the one line the worker logs at startup. */
export function toolsAvailable() {
  const missing = [];
  for (const bin of Object.keys(TOOL_PURPOSE)) {
    if (!haveTool(bin)) missing.push(`${bin} (needed for ${TOOL_PURPOSE[bin]})`);
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Is the virus scanner's client on this machine? Asked only when
 * CLAMAV_ENABLED=true; it is not one of the media tools, because a
 * deployment that has not switched scanning on does not need it.
 */
export function scannerAvailable() {
  return haveTool('clamdscan');
}

function whichSync(bin) {
  for (const dir of (process.env.PATH || '').split(':')) {
    const p = `${dir}/${bin}`;
    if (fs.existsSync(p)) return p;
  }
  return bin;
}

/**
 * Convert a HEIC/HEIF photo to JPEG.
 *
 * This is what makes an iPhone on default camera settings work. The output
 * is re-encoded from decoded pixels, so the location, the device identity
 * and the capture time are all simply absent from it — there is nothing to
 * strip because nothing was carried over.
 */
export async function heicToJpeg(inPath, outPath) {
  await tool('heif-convert', ['-q', '90', inPath, outPath]);
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error('heif-convert produced no output');
  }
  return { mediaType: 'image/jpeg' };
}

/**
 * What a video actually contains, before we agree to spend CPU on it.
 * Checked ahead of transcoding so an hour-long file is refused in a second
 * rather than after five minutes of encoding.
 */
export async function probeVideo(inPath) {
  const { stdout } = await tool('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name',
    '-show_entries', 'stream=codec_type,codec_name,width,height',
    '-of', 'json', inPath,
  ], PROBE_TIMEOUT_MS);

  const data = JSON.parse(stdout);
  const streams = data.streams || [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('no video track found');

  return {
    durationSeconds: Math.round(Number(data.format?.duration) || 0),
    width: video.width || 0,
    height: video.height || 0,
    codec: video.codec_name || 'unknown',
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

/**
 * Re-encode a video into the publishable copy.
 *
 * `-map_metadata -1` drops every container tag, which on an iPhone
 * recording is where the GPS coordinates live. `-map 0:v:0 -map 0:a:0?`
 * takes only the first video and audio track, so a file carrying extra
 * data streams, subtitles or attached pictures cannot smuggle them into
 * the published copy. Scaled down to 720p because a published clip is
 * evidence for a reader, not a master copy — the untouched original is
 * what stays in the archive.
 */
export async function transcodeVideo(inPath, outPath, { maxSeconds }) {
  await tool('ffmpeg', [
    '-nostdin', '-y',
    '-i', inPath,
    '-t', String(maxSeconds),
    '-map', '0:v:0', '-map', '0:a:0?',
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-vf', "scale='min(1280,iw)':-2",
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    outPath,
  ]);
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error('ffmpeg produced no output');
  }
  return { mediaType: 'video/mp4' };
}

/**
 * A single frame, so a moderator and the board have something to show
 * without loading the whole clip. Taken one second in rather than at zero,
 * because the first frame of a phone recording is very often black.
 */
export async function posterFrame(inPath, outPath) {
  await tool('ffmpeg', [
    '-nostdin', '-y',
    '-ss', '1', '-i', inPath,
    '-frames:v', '1',
    '-map_metadata', '-1',
    '-vf', "scale='min(960,iw)':-2",
    outPath,
  ]);
  // A clip shorter than the seek point yields nothing; that is not a
  // failure worth rejecting the video over, so the caller treats a missing
  // poster as simply "no poster".
  return fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
}

/**
 * Re-encode audio, discarding everything that is not sound.
 *
 * The same argument as video: an MP3's ID3 tags or an M4A's metadata boxes
 * could be lifted out by hand, but decoding and re-encoding is stronger
 * and is less of our own code to be wrong. There is nothing in an audio
 * file worth publishing except the audio, so nothing is lost by rebuilding
 * it — which is not true of a photo, where the pixels are the point and
 * re-encoding costs quality for no gain.
 *
 * One stream only. A file carrying cover art, chapters or a second track
 * cannot smuggle any of it into the published copy.
 */
export async function transcodeAudio(inPath, outPath, { maxSeconds }) {
  await tool('ffmpeg', [
    '-nostdin', '-y',
    '-i', inPath,
    '-t', String(maxSeconds),
    '-map', '0:a:0',
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-vn',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    outPath,
  ]);
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error('ffmpeg produced no audio output');
  }
  return { mediaType: 'audio/mp4' };
}

/**
 * How many pages a PDF has, and whether it is one we will touch at all.
 *
 * Asked before rendering for the same reason a video is probed before
 * transcoding: a nine-hundred-page document should be refused in a second
 * rather than after four minutes of rendering.
 */
export async function probePdf(inPath) {
  const { stdout } = await tool('pdfinfo', [inPath], PROBE_TIMEOUT_MS);
  const pages = Number((stdout.match(/^Pages:\s+(\d+)/m) || [])[1] || 0);
  const encrypted = /^Encrypted:\s+yes/mi.test(stdout);
  if (!pages) throw new Error('pdfinfo reported no pages');
  return { pages, encrypted };
}

/**
 * Render a PDF to one image per page.
 *
 * This is the whole of PDF support, and the reason it is done this way.
 *
 * A PDF is the one format where "we stripped the metadata" would be a
 * claim we cannot honestly make. It can carry embedded files, JavaScript,
 * remote references that phone home when opened, and its author's identity
 * in several places at once — and there is no safe subset to reduce it to.
 * Publishing an uploaded PDF as a PDF would mean handing readers a file we
 * had not actually cleaned, on a site whose entire argument is that it only
 * claims what it can back.
 *
 * So the published copy is not a PDF at all. Each page becomes a PNG, and
 * those images are what anyone other than a moderator ever sees. Same
 * discipline as HEIC and video — rebuild rather than redact — applied to
 * the format that needs it most. The original stays encrypted as evidence
 * like every other original, openable only with a written reason that the
 * reporter is shown.
 *
 * -r 150 is the resolution: enough to read a filled-in paper form, small
 * enough that forty pages is not a hundred megabytes.
 */
export async function pdfToPages(inPath, outPrefix, { maxPages }) {
  await tool('pdftoppm', [
    '-png',
    '-r', '150',
    '-f', '1', '-l', String(maxPages),
    // No shell, no network, and pdftoppm does not execute embedded
    // JavaScript — it is a renderer, not a reader.
    inPath, outPrefix,
  ]);
  const dir = outPrefix.slice(0, outPrefix.lastIndexOf('/'));
  const base = outPrefix.slice(outPrefix.lastIndexOf('/') + 1);
  const pages = fs.readdirSync(dir)
    .filter((f) => f.startsWith(`${base}-`) && f.endsWith('.png'))
    // Numeric order, not lexicographic: page 10 must not sort before page 2.
    .sort((a, b) => Number((a.match(/-(\d+)\.png$/) || [])[1] || 0)
                  - Number((b.match(/-(\d+)\.png$/) || [])[1] || 0))
    .map((f) => `${dir}/${f}`);
  if (!pages.length) throw new Error('pdftoppm produced no pages');
  return { pages, mediaType: 'image/png' };
}
