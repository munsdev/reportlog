/**
 * The words the files staff screens use, in one place, so a moderator reads
 * the same word for the same state on every screen.
 */
import type { FileKind, FileLimitLayers, ThreadFile } from '@reportlog/contracts';
import { megabytes } from '../uploader.ts';

export const PUBLICATION: Record<ThreadFile['publication'], string> = {
  withheld: 'Not published',
  published: 'Published',
  refused: 'Refused',
};

export const KIND_LABEL: Record<FileKind, string> = {
  photo: 'Photos',
  video: 'Video',
  audio: 'Sound recordings',
  document: 'Documents (PDF)',
};

/** What a file's record says happened, in words. */
export const EVENT: Record<string, string> = {
  published: 'Published',
  withheld: 'Not published',
  refused: 'Refused',
  taken_down: 'Taken down',
  erased: 'Erased',
  viewed_original: 'Original opened',
};

export const eventLabel = (action: string) => EVENT[action] ?? action;

export const ACTOR: Record<string, string> = {
  moderator: 'a moderator',
  reporter: 'the reporter',
  admin: 'an administrator',
  system: 'the site',
};

export function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** One line saying what a file is: its type, size, and length or pages. */
export function describeFile(f: ThreadFile): string {
  const parts = [f.media_type, megabytes(f.byte_size)];
  if (f.duration_seconds !== null) parts.push(clock(f.duration_seconds));
  if (f.pages > 1) parts.push(`${String(f.pages)} pages`);
  return parts.join(' · ');
}

export interface Consent {
  may_publish: boolean;
  files_permitted: boolean;
  withdrawn: boolean;
}

/**
 * Why a file cannot be published, or null when it can.
 *
 * CONSENT IS THE CEILING. The reporter's sealed answer and their revocable
 * file permission both have to say yes; the screen never offers publishing
 * past either, and the server and database refuse it regardless.
 */
export function whyNotPublishable(f: ThreadFile, consent: Consent): string | null {
  if (f.erased) return 'This file has been erased.';
  if (f.publication === 'published') return null;
  if (consent.withdrawn) return 'The reporter withdrew this report, so its files stay down.';
  if (!consent.may_publish)
    return 'The reporter did not agree to their report being published, so its files cannot be.';
  if (!consent.files_permitted)
    return 'The reporter has not agreed to their files being published. Only they can change that.';
  return null;
}

// ── limits ─────────────────────────────────────────────────────────────

export type NumberKey = Exclude<keyof FileLimitLayers, 'kinds'>;

/** Each limit as a person reads it: bytes are typed in megabytes. */
/**
 * Each limit as a person reads it: bytes are typed in megabytes. `min` and
 * `max` are in the box's own unit and match LIMIT_RANGES in
 * apps/api/src/files/limits.ts, so a number out of range is caught in words
 * a person typed rather than in bytes. The server decides regardless.
 */
export const LIMITS: readonly {
  key: NumberKey;
  label: string;
  unit: 'mb' | 'n';
  suffix: string;
  min: number;
  max: number;
}[] = [
  { key: 'maxImageBytes', label: 'Largest photo', unit: 'mb', suffix: 'MB', min: 1, max: 2048 },
  { key: 'maxVideoBytes', label: 'Largest video', unit: 'mb', suffix: 'MB', min: 1, max: 2048 },
  {
    key: 'maxVideoSeconds',
    label: 'Longest video',
    unit: 'n',
    suffix: 'seconds',
    min: 5,
    max: 3600,
  },
  {
    key: 'maxAudioBytes',
    label: 'Largest sound recording',
    unit: 'mb',
    suffix: 'MB',
    min: 1,
    max: 2048,
  },
  {
    key: 'maxDocumentBytes',
    label: 'Largest document',
    unit: 'mb',
    suffix: 'MB',
    min: 1,
    max: 2048,
  },
  {
    key: 'maxDocumentPages',
    label: 'Most pages in a document',
    unit: 'n',
    suffix: 'pages',
    min: 1,
    max: 1000,
  },
  {
    key: 'maxFiles',
    label: 'Most files on one report',
    unit: 'n',
    suffix: 'files',
    min: 1,
    max: 50,
  },
  {
    key: 'maxTotalBytes',
    label: 'Most on one report, all together',
    unit: 'mb',
    suffix: 'MB',
    min: 1,
    max: 2048,
  },
];

const MB = 1024 * 1024;

export function toBox(value: number | null, unit: 'mb' | 'n'): string {
  if (value === null) return '';
  return unit === 'mb' ? String(Math.round(value / MB)) : String(value);
}

/** A box as typed: null for empty (use the layer underneath), NaN for nonsense. */
export function fromBox(text: string, unit: 'mb' | 'n'): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (!/^[0-9]+$/.test(t)) return Number.NaN;
  return unit === 'mb' ? Number(t) * MB : Number(t);
}

export const BAD_NUMBER = 'A limit is a whole number, or empty to use the one underneath it.';

/** What is wrong with one box as typed, or null. */
export function boxProblem(text: string, limit: (typeof LIMITS)[number]): string | null {
  const t = text.trim();
  if (t === '') return null;
  if (!/^[0-9]+$/.test(t)) return BAD_NUMBER;
  const n = Number(t);
  if (n < limit.min || n > limit.max)
    return `Between ${String(limit.min)} and ${String(limit.max)} ${limit.suffix}.`;
  return null;
}
