/**
 * What kinds of file this archive takes, and what a file really is.
 *
 * FOUR KINDS, chosen between by an operator: photo, video, audio, document.
 * Kinds rather than media types, because "photos, video?" is the question an
 * operator has, and picking types by hand invites allowing JPEG and
 * forgetting that half of all phone photos are HEIC.
 *
 * ONE NAME PER KIND. Legacy's `kindFor` said "image" while the operator's list
 * said "photo", and every photograph was refused the day an upload was first
 * checked against that list. Here there is one vocabulary.
 *
 * WHAT A FILE IS COMES FROM ITS BYTES. The type a browser declares decides
 * only which limit to check before the bytes arrive; the worker sniffs the
 * real type and every later decision uses that.
 */
export const KINDS = ['photo', 'video', 'audio', 'document'] as const;
export type Kind = (typeof KINDS)[number];

export const TYPES_OF: Readonly<Record<Kind, readonly string[]>> = {
  photo: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm'],
  // A PDF is never published as a PDF: it can carry scripts, embedded files
  // and its author in half a dozen places. Its pages are rendered to images
  // and those are what anybody sees.
  document: ['application/pdf'],
};

export const ALLOWED_TYPES: readonly string[] = KINDS.flatMap((k) => TYPES_OF[k]);

export function isAllowedType(type: string): boolean {
  return ALLOWED_TYPES.includes(type.toLowerCase());
}

export function kindFor(type: string): Kind | null {
  const t = type.toLowerCase();
  return KINDS.find((k) => TYPES_OF[k].includes(t)) ?? null;
}

export function isKind(v: unknown): v is Kind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}

/** Kinds in the one order every list of them is reported in. */
export function inKindOrder(kinds: readonly string[]): Kind[] {
  return KINDS.filter((k) => kinds.includes(k));
}

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

/**
 * What the first bytes of a file say it is, or null. The browser's claim is
 * attacker-controlled in exactly the case that matters, so it is not asked.
 */
export function sniffType(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && ascii(b, 1, 4) === 'PNG' && b[0] === 0x89) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP')
    return 'image/webp';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') return 'audio/wav';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    return 'video/webm';
  // ISO media: HEIC photos and MP4/MOV video share a container; the brand in
  // the ftyp box tells them apart.
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'mif1', 'msf1'].includes(brand))
      return 'image/heic';
    if (brand === 'qt  ') return 'video/quicktime';
    if (['M4A ', 'M4B ', 'F4A '].includes(brand)) return 'audio/mp4';
    if (
      [
        'isom',
        'iso2',
        'iso4',
        'iso5',
        'iso6',
        'mp41',
        'mp42',
        'avc1',
        'M4V ',
        'dash',
        '3gp4',
        '3gp5',
      ].includes(brand)
    ) {
      return 'video/mp4';
    }
  }
  // The PDF header may sit anywhere in the first 1024 bytes; readers accept it.
  if (ascii(b, 0, Math.min(b.length, 1024)).includes('%PDF-')) return 'application/pdf';
  if (b.length >= 3 && ascii(b, 0, 3) === 'ID3') return 'audio/mpeg';
  if (b.length >= 4 && ascii(b, 0, 4) === 'OggS') return 'audio/ogg';
  // ADTS AAC, then a bare MPEG audio frame.
  if (b.length >= 2 && b[0] === 0xff && ((b[1] ?? 0) & 0xf6) === 0xf0) return 'audio/aac';
  if (b.length >= 2 && b[0] === 0xff && ((b[1] ?? 0) & 0xe6) === 0xe2) return 'audio/mpeg';
  return null;
}
