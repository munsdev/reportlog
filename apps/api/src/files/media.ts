/**
 * Re-encoding, so no camera metadata or location survives.
 *
 * NOT TRIMMING: DECODING AND REBUILDING. Every file that can be published is
 * decoded to pixels or samples and encoded again by a tool that is told to
 * carry nothing else across. The copy is built from the picture or the sound
 * alone, so it can only contain what we put in it: no GPS, no camera serial,
 * no capture time, no author, no embedded thumbnail of the uncropped photo.
 * Then strip.ts walks the result anyway (see why there).
 *
 *   photo     ImageMagick: JPEG, PNG, WebP, HEIC in; JPEG out (PNG stays PNG,
 *             for transparency). Turned upright first, since the turn was
 *             metadata too.
 *   video     ffmpeg: H.264 and AAC in MP4, at most 1280 wide, plus one still
 *   audio     ffmpeg: AAC in MP4
 *   document  pdftoppm: each page to a JPEG. The PDF itself is never published
 *
 * The parsers that do this are memory-unsafe C fed files chosen by whoever
 * wants this site down. So: never in the server's process, always a child
 * process with an argument list (never a shell), a time limit, ImageMagick's
 * own resource limits, and an explicit decoder named for the type we sniffed,
 * so a file cannot pick a different, riskier one by what it says it is.
 */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { kindFor } from './kinds.ts';
import { stripMetadata } from './strip.ts';

const run = promisify(execFile);

export const TRANSCODE_TIMEOUT_MS = 5 * 60 * 1000;

/** A failure that is the file's fault: it is refused. */
export class RejectFile extends Error {
  override name = 'RejectFile';
  /** `rejected` breaks a rule (too long, too many pages); `unreadable` will not decode. */
  readonly status: 'rejected' | 'unreadable';
  constructor(message: string, status: 'rejected' | 'unreadable' = 'unreadable') {
    super(message);
    this.status = status;
  }
}

async function tool(bin: string, args: string[], timeout = TRANSCODE_TIMEOUT_MS) {
  try {
    return await run(bin, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
  } catch (e) {
    const err = e as { killed?: boolean; signal?: string; stderr?: string; message: string };
    if (err.killed || err.signal === 'SIGKILL') {
      throw new RejectFile(
        `${bin} ran out of time: the file may be damaged, or built to be slow to decode`,
      );
    }
    const detail = (err.stderr ?? err.message).trim().split('\n').pop() ?? '';
    throw new RejectFile(`${bin} could not read it: ${detail}`.slice(0, 300));
  }
}

/** Which tools each media type needs, and nothing else's. */
const TOOLS_FOR: Readonly<Record<string, readonly string[]>> = {
  'image/jpeg': ['convert'],
  'image/png': ['convert'],
  'image/webp': ['convert'],
  'image/heic': ['convert'],
  'image/heif': ['convert'],
  'video/mp4': ['ffmpeg', 'ffprobe'],
  'video/quicktime': ['ffmpeg', 'ffprobe'],
  'video/webm': ['ffmpeg', 'ffprobe'],
  'audio/mpeg': ['ffmpeg', 'ffprobe'],
  'audio/mp4': ['ffmpeg', 'ffprobe'],
  'audio/aac': ['ffmpeg', 'ffprobe'],
  'audio/ogg': ['ffmpeg', 'ffprobe'],
  'audio/wav': ['ffmpeg', 'ffprobe'],
  'audio/webm': ['ffmpeg', 'ffprobe'],
  'application/pdf': ['pdfinfo', 'pdftoppm'],
};

/** The packages a server installs for each tool, for the sentence an operator reads. */
export const PACKAGE_FOR: Readonly<Record<string, string>> = {
  convert: 'imagemagick (with HEIC support: libheif)',
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffmpeg',
  pdfinfo: 'poppler-utils',
  pdftoppm: 'poppler-utils',
};

const found = new Map<string, boolean>();
async function haveTool(bin: string): Promise<boolean> {
  const known = found.get(bin);
  if (known !== undefined) return known;
  let ok = false;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    try {
      await access(join(dir, bin), constants.X_OK);
      ok = true;
      break;
    } catch {
      // not here
    }
  }
  found.set(bin, ok);
  return ok;
}

let heicDecoder: boolean | undefined;
/** ImageMagick without libheif reads every format but HEIC. */
async function canDecodeHeic(): Promise<boolean> {
  if (heicDecoder === undefined) {
    try {
      const { stdout } = await run('convert', ['-list', 'format'], { timeout: 20_000 });
      heicDecoder = /^\s*HEIC\*?\s+\S*\s+r/m.test(stdout);
    } catch {
      heicDecoder = false;
    }
  }
  return heicDecoder;
}

/** Every tool this type needs that is not installed: the file waits for them. */
export async function missingToolsFor(type: string): Promise<string[]> {
  const missing: string[] = [];
  for (const bin of TOOLS_FOR[type] ?? []) if (!(await haveTool(bin))) missing.push(bin);
  if (
    !missing.length &&
    (type === 'image/heic' || type === 'image/heif') &&
    !(await canDecodeHeic())
  ) {
    missing.push('convert');
  }
  return missing;
}

export interface Built {
  renditionPath: string;
  renditionType: string;
  posterPath: string | null;
  /** A document's pages after the first (the first is the rendition). */
  morePages: string[];
  pageCount: number | null;
  duration: number | null;
  meta: Record<string, unknown>;
}

export interface MediaLimits {
  maxVideoSeconds: number;
  maxDocumentPages: number;
}

/** ImageMagick's own ceilings, so one image cannot take the machine. */
const MAGICK_LIMITS = [
  '-limit',
  'memory',
  '256MiB',
  '-limit',
  'map',
  '512MiB',
  '-limit',
  'disk',
  '1GiB',
  '-limit',
  'area',
  '128MP',
  '-limit',
  'time',
  '120',
];
const CODER: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
};

/** Re-encode an image to JPEG (or PNG) and make sure nothing rode along. */
async function rebuildImage(
  input: string,
  type: string,
  out: string,
  toPng: boolean,
): Promise<void> {
  const coder = CODER[type];
  if (!coder) throw new RejectFile(`not a photo this site re-encodes (${type})`);
  await tool('convert', [
    ...MAGICK_LIMITS,
    `${coder}:${input}[0]`,
    '-auto-orient',
    '-strip',
    '-resize',
    '4096x4096>',
    ...(toPng
      ? ['-define', 'png:exclude-chunks=date,time', `png:${out}`]
      : ['-quality', '88', `jpeg:${out}`]),
  ]);
  await scrub(out, toPng ? 'image/png' : 'image/jpeg');
}

/** Belt and braces: walk what an encoder wrote and lift out anything that is not picture. */
async function scrub(path: string, type: string): Promise<void> {
  const { clean } = stripMetadata(await readFile(path), type);
  await writeFile(path, clean);
}

interface Probe {
  duration: number;
  video: boolean;
  audio: boolean;
  width: number | null;
  height: number | null;
}
async function probe(input: string): Promise<Probe> {
  const { stdout } = await tool(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,width,height',
      '-of',
      'json',
      input,
    ],
    20_000,
  );
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number }[];
  };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  return {
    duration: Math.round(Number(j.format?.duration ?? 0) * 100) / 100,
    video: Boolean(v),
    audio: Boolean(j.streams?.some((s) => s.codec_type === 'audio')),
    width: v?.width ?? null,
    height: v?.height ?? null,
  };
}

/** Nothing in the container but the picture and the sound, and no encoder's name either. */
const FF_CLEAN = [
  '-map_metadata',
  '-1',
  '-map_chapters',
  '-1',
  '-sn',
  '-dn',
  '-fflags',
  '+bitexact',
];

/**
 * Build the copy that may one day be published, in `dir`. Everything is
 * written there; the caller removes the directory.
 */
export async function buildRendition(
  input: string,
  type: string,
  dir: string,
  limits: MediaLimits,
): Promise<Built> {
  const kind = kindFor(type);
  const base: Pick<Built, 'posterPath' | 'morePages' | 'pageCount' | 'duration'> = {
    posterPath: null,
    morePages: [],
    pageCount: null,
    duration: null,
  };

  if (kind === 'photo') {
    const png = type === 'image/png';
    const out = join(dir, png ? 'rendition.png' : 'rendition.jpg');
    // What the original carried, for the encrypted record. Trimming is only
    // possible on the segment formats; HEIC's travels in the original itself.
    const removed = stripMetadata(await readFile(input), type).removed;
    await rebuildImage(input, type, out, png);
    return {
      ...base,
      renditionPath: out,
      renditionType: png ? 'image/png' : 'image/jpeg',
      meta: {
        format: type,
        method: 'decoded and re-encoded; metadata not carried across',
        removed,
      },
    };
  }

  if (kind === 'video') {
    const p = await probe(input);
    if (!p.video) throw new RejectFile('there is no picture in this video', 'rejected');
    if (p.duration > limits.maxVideoSeconds) {
      throw new RejectFile(
        `the video is ${String(Math.round(p.duration))} seconds long; the limit is ${String(limits.maxVideoSeconds)}`,
        'rejected',
      );
    }
    const out = join(dir, 'rendition.mp4');
    await tool('ffmpeg', [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-i',
      input,
      '-t',
      String(limits.maxVideoSeconds),
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      ...FF_CLEAN,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-vf',
      "scale='trunc(min(1280,iw)/2)*2':-2",
      '-flags:v',
      '+bitexact',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-flags:a',
      '+bitexact',
      '-movflags',
      '+faststart',
      out,
    ]);
    // The still is taken from the CLEAN copy, so it cannot carry anything the
    // original did.
    const poster = join(dir, 'poster.jpg');
    let gotPoster = true;
    try {
      await tool('ffmpeg', [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-i',
        out,
        '-frames:v',
        '1',
        ...FF_CLEAN,
        '-flags:v',
        '+bitexact',
        '-q:v',
        '3',
        poster,
      ]);
      await scrub(poster, 'image/jpeg');
    } catch {
      gotPoster = false;
    }
    return {
      ...base,
      renditionPath: out,
      renditionType: 'video/mp4',
      posterPath: gotPoster ? poster : null,
      duration: p.duration,
      meta: {
        format: type,
        method: 're-encoded; container metadata not carried across',
        source: p,
      },
    };
  }

  if (kind === 'audio') {
    const p = await probe(input);
    if (!p.audio) throw new RejectFile('there is no sound in this recording', 'rejected');
    if (p.duration > limits.maxVideoSeconds) {
      throw new RejectFile(
        `the recording is ${String(Math.round(p.duration))} seconds long; the limit is ${String(limits.maxVideoSeconds)}`,
        'rejected',
      );
    }
    const out = join(dir, 'rendition.m4a');
    await tool('ffmpeg', [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-i',
      input,
      '-t',
      String(limits.maxVideoSeconds),
      '-vn',
      '-map',
      '0:a:0',
      ...FF_CLEAN,
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-flags:a',
      '+bitexact',
      '-movflags',
      '+faststart',
      out,
    ]);
    return {
      ...base,
      renditionPath: out,
      renditionType: 'audio/mp4',
      duration: p.duration,
      meta: { format: type, method: 're-encoded; tags not carried across' },
    };
  }

  if (kind === 'document') {
    const { stdout } = await tool('pdfinfo', [input], 30_000);
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0);
    // An encrypted PDF cannot be rendered without its password, and asking
    // for one would mean holding it.
    if (/^Encrypted:\s+yes/m.test(stdout)) {
      throw new RejectFile(
        'the PDF is password-protected, so its pages cannot be shown',
        'rejected',
      );
    }
    if (!pages) throw new RejectFile('the PDF has no pages', 'rejected');
    if (pages > limits.maxDocumentPages) {
      throw new RejectFile(
        `the PDF has ${String(pages)} pages; the limit is ${String(limits.maxDocumentPages)}`,
        'rejected',
      );
    }
    const prefix = join(dir, 'page');
    await tool('pdftoppm', [
      '-jpeg',
      '-jpegopt',
      'quality=85',
      '-r',
      '110',
      '-l',
      String(pages),
      input,
      prefix,
    ]);
    const made = (await readdir(dir))
      .filter((f) => /^page-\d+\.jpg$/.test(f))
      .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]))
      .map((f) => join(dir, f));
    if (!made.length) throw new RejectFile('no page of the PDF could be drawn');
    for (const page of made) await scrub(page, 'image/jpeg');
    return {
      ...base,
      renditionPath: made[0] ?? '',
      renditionType: 'image/jpeg',
      morePages: made.slice(1),
      pageCount: made.length,
      meta: {
        format: type,
        method: `drawn as ${String(made.length)} page image(s); the PDF itself is never published`,
        pages,
      },
    };
  }

  throw new RejectFile(`not a kind of file this site takes (${type})`);
}
