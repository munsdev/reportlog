/**
 * Lifting metadata out of an image's container, without decoding a pixel.
 *
 * NOT HOW A FILE IS MADE SAFE. Every photo is decoded and re-encoded by the
 * worker (media.ts), so the copy that can be published is built from pixels
 * alone. This runs AFTER that, on everything the encoders produce, because
 * "the encoder does not copy metadata" is a property of one version of one
 * tool, and a later release quietly starting to would leak a location
 * silently. It also says what the ORIGINAL carried, for the encrypted record.
 *
 * Container walking only: a malformed file stops the walk, it does not crash
 * a decoder we would then have to trust.
 */
export interface Stripped {
  clean: Buffer;
  removed: { segment: string; bytes: number }[];
}

export function stripMetadata(buf: Buffer, type: string): Stripped {
  if (type === 'image/jpeg') return stripJpeg(buf);
  if (type === 'image/png') return stripPng(buf);
  if (type === 'image/webp') return stripWebp(buf);
  return { clean: buf, removed: [] };
}

/**
 * JPEG: copy every segment except APP1–APP15 (EXIF, XMP, ICC, maker notes),
 * COM, and an APP0 that is not JFIF. After SOS the rest is image data.
 */
function stripJpeg(buf: Buffer): Stripped {
  const out: Buffer[] = [buf.subarray(0, 2)];
  const removed: Stripped['removed'] = [];
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xda) {
      out.push(buf.subarray(i));
      i = buf.length;
      break;
    }
    if (i + 4 > buf.length) break;
    const len = buf.readUInt16BE(i + 2);
    const segment = buf.subarray(i, i + 2 + len);
    const jfif = marker === 0xe0 && segment.subarray(4, 8).toString('latin1') === 'JFIF';
    const metadata =
      (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe || (marker === 0xe0 && !jfif);
    if (metadata)
      removed.push({ segment: `0xFF${marker.toString(16).toUpperCase()}`, bytes: segment.length });
    else out.push(segment);
    i += 2 + len;
  }
  return { clean: Buffer.concat(out), removed };
}

/** PNG: an allow-list of the chunks that draw the picture. Text, eXIf, tIME go. */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'sBIT',
  'bKGD',
  'pHYs',
  'acTL',
  'fcTL',
  'fdAT',
]);
function stripPng(buf: Buffer): Stripped {
  const out: Buffer[] = [buf.subarray(0, 8)];
  const removed: Stripped['removed'] = [];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const total = 12 + len;
    if (i + total > buf.length) break;
    if (PNG_KEEP.has(type)) out.push(buf.subarray(i, i + total));
    else removed.push({ segment: type, bytes: total });
    i += total;
    if (type === 'IEND') break;
  }
  return { clean: Buffer.concat(out), removed };
}

/** WebP: drop EXIF and XMP chunks and rewrite the outer size. */
function stripWebp(buf: Buffer): Stripped {
  const out: Buffer[] = [];
  const removed: Stripped['removed'] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const fourcc = buf.subarray(i, i + 4).toString('latin1');
    const size = buf.readUInt32LE(i + 4);
    const total = 8 + size + (size % 2);
    if (i + total > buf.length) break;
    if (fourcc === 'EXIF' || fourcc === 'XMP ') removed.push({ segment: fourcc, bytes: total });
    else out.push(buf.subarray(i, i + total));
    i += total;
  }
  const payload = Buffer.concat(out);
  const header = Buffer.from(buf.subarray(0, 12));
  header.writeUInt32LE(payload.length + 4, 4);
  return { clean: Buffer.concat([header, payload]), removed };
}
