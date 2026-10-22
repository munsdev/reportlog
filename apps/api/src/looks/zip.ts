/**
 * A minimal zip reader for look packs, and only for look packs.
 *
 * WHY NOT A LIBRARY: a look pack is a look.json and some fonts, at most 120
 * files and 10 MB. What it needs from a zip reader is less than any library
 * offers, and what it must refuse is more than they refuse by default. This
 * reads the central directory, refuses the whole archive if any entry's name
 * or kind is wrong, and only then inflates, with Node's own zlib, into
 * memory. Nothing is ever written to disk, by this or by its caller: the
 * bytes go to check(), and to the database only if check() is satisfied.
 *
 * WHAT IS REFUSED, BEFORE A SINGLE BYTE IS INFLATED:
 *   - a name with `..`, `.`, an empty segment, a leading `/`, a backslash,
 *     a drive letter, a control character or anything beyond plain ASCII
 *   - a symbolic link or any other entry that is not a file or a folder
 *   - the same name twice (the second could hide behind the first)
 *   - encryption, ZIP64, a split archive, a method other than stored or deflate
 *   - more entries, or more declared bytes, than a pack may hold
 *   - entries whose data overlap (one way a small zip claims to be large)
 * AND WHILE INFLATING: a file that grows past the size it declared (zlib's
 * maxOutputLength stops it there), or whose CRC or local header disagrees
 * with the central directory.
 *
 * Every refusal is a sentence a person can read, like check()'s.
 */
import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipLimits {
  /** Entries, folders included. */
  entries: number;
  /** Bytes one file may hold once inflated. */
  fileBytes: number;
  /** Bytes all files together may hold once inflated. */
  totalBytes: number;
}

export type ZipResult =
  { ok: true; files: Map<string, Uint8Array> } | { ok: false; problems: string[] };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const NOT_A_ZIP = 'This is not a .zip file this site can read.';

// Unix file kinds, from the top half of a central entry's external attributes.
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const MADE_BY_UNIX = 3;

/** A name a person could have meant: printable ASCII, no backslash, no colon. */
const SAFE_NAME = /^[\x21-\x7e]+$/;

interface Entry {
  name: string;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  localOffset: number;
  folder: boolean;
}

function pathProblem(name: string): string | null {
  if (!SAFE_NAME.test(name) || name.includes('\\') || name.includes(':'))
    return `"${shownName(name)}" has a name this site does not accept. Use plain letters, digits, dots, hyphens and underscores.`;
  if (name.startsWith('/')) return `"${name}" is an absolute path. A pack's paths start inside it.`;
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  if (segments.some((s) => s === '..'))
    return `"${name}" points outside the pack. A pack may not use "..".`;
  if (segments.some((s) => s === '' || s === '.'))
    return `"${name}" has an empty or "." part in its path.`;
  return null;
}

/** A name as it may be shown: control characters and anything non-ASCII as "?". */
function shownName(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, '?').slice(0, 120);
}

/**
 * Every file in the archive, or every reason it is refused. Folders are
 * checked and then dropped: a pack's paths say where its files are.
 */
export function readZip(input: Uint8Array, limits: ZipLimits): ZipResult {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const refuse = (...problems: string[]): ZipResult => ({ ok: false, problems });

  // ── the end record: the last thing in the file, before a comment ≤ 64 KB.
  if (buf.length < 22) return refuse(NOT_A_ZIP);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      end = i;
      break;
    }
  }
  if (end < 0) return refuse(NOT_A_ZIP);
  const disk = buf.readUInt16LE(end + 4);
  const cdDisk = buf.readUInt16LE(end + 6);
  const onDisk = buf.readUInt16LE(end + 8);
  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    return refuse('This .zip uses ZIP64, which a look pack never needs. Make an ordinary .zip.');
  if (disk !== 0 || cdDisk !== 0 || onDisk !== count)
    return refuse('This .zip is split across several files. Make it one .zip.');
  if (count > limits.entries) return refuse('The pack has too many files.');
  if (cdOffset + cdSize > end) return refuse(NOT_A_ZIP);

  // ── the central directory: every name and kind, before anything is read.
  const problems: string[] = [];
  const entries: Entry[] = [];
  const names = new Set<string>();
  let at = cdOffset;
  let declared = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > cdOffset + cdSize || buf.readUInt32LE(at) !== CENTRAL) return refuse(NOT_A_ZIP);
    const madeBy = buf.readUInt16LE(at + 4) >> 8;
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compressed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const external = buf.readUInt32LE(at + 38);
    const localOffset = buf.readUInt32LE(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > cdOffset + cdSize) return refuse(NOT_A_ZIP);
    // Read as Latin-1, byte for byte, so a byte outside ASCII is seen as
    // itself and refused, whatever the UTF-8 flag claims.
    const name = buf.toString('latin1', at + 46, at + 46 + nameLength);
    at = next;

    const bad = pathProblem(name);
    if (bad) {
      problems.push(bad);
      continue;
    }
    if (names.has(name)) {
      problems.push(`"${name}" is in the pack twice.`);
      continue;
    }
    names.add(name);
    const kind = madeBy === MADE_BY_UNIX ? (external >>> 16) & S_IFMT : 0;
    if (kind === S_IFLNK) {
      problems.push(`"${name}" is a link. A pack holds only files.`);
      continue;
    }
    const folder = name.endsWith('/') || kind === S_IFDIR;
    if (kind !== 0 && kind !== S_IFREG && kind !== S_IFDIR) {
      problems.push(`"${name}" is not an ordinary file.`);
      continue;
    }
    if (folder && (size !== 0 || !name.endsWith('/'))) {
      problems.push(`"${name}" is a folder with something odd about it.`);
      continue;
    }
    if (flags & 0x0001 || flags & 0x0040) {
      problems.push(`"${name}" is encrypted. A pack is never encrypted.`);
      continue;
    }
    if (method !== 0 && method !== 8) {
      problems.push(`"${name}" is compressed in a way this site does not read. Use ordinary zip.`);
      continue;
    }
    if (size > limits.fileBytes) {
      problems.push(`"${name}" is larger than ${megabytes(limits.fileBytes)}.`);
      continue;
    }
    declared += size;
    entries.push({ name, method, crc, compressed, size, localOffset, folder });
  }
  if (declared > limits.totalBytes)
    problems.push(`The pack is larger than ${megabytes(limits.totalBytes)}.`);
  if (problems.length) return refuse(...problems);

  // ── each file's own header, and where its data sits. No two may overlap.
  const spans: { start: number; end: number; entry: Entry }[] = [];
  for (const entry of entries) {
    const h = entry.localOffset;
    if (h + 30 > cdOffset || buf.readUInt32LE(h) !== LOCAL) return refuse(NOT_A_ZIP);
    const localName = buf.toString('latin1', h + 30, h + 30 + buf.readUInt16LE(h + 26));
    if (localName !== entry.name || buf.readUInt16LE(h + 8) !== entry.method)
      return refuse(`"${entry.name}" says different things in two places. Make the .zip again.`);
    const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
    const stop = start + entry.compressed;
    if (stop > cdOffset) return refuse(NOT_A_ZIP);
    spans.push({ start: h, end: stop, entry });
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    const before = spans[i - 1];
    const span = spans[i];
    if (before && span && span.start < before.end)
      return refuse('Two files in this .zip share the same bytes. Make the .zip again.');
  }

  // ── only now: inflate, never past the size each file declared.
  const files = new Map<string, Uint8Array>();
  for (const { entry, end: stop } of spans) {
    if (entry.folder) continue;
    const data = buf.subarray(stop - entry.compressed, stop);
    let bytes: Buffer;
    if (entry.method === 0) {
      if (entry.compressed !== entry.size) return refuse(NOT_A_ZIP);
      bytes = Buffer.from(data);
    } else {
      try {
        // maxOutputLength must be at least 1; an empty file inflates to nothing.
        bytes = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) });
      } catch {
        return refuse(`"${entry.name}" could not be unpacked, or is larger than it says.`);
      }
    }
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc)
      return refuse(`"${entry.name}" is damaged. Make the .zip again.`);
    files.set(entry.name, new Uint8Array(bytes));
  }
  return { ok: true, files };
}

function megabytes(n: number): string {
  return `${String(Math.round(n / 1_000_000))} MB`;
}
