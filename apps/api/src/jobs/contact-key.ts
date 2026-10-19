/**
 * CONTACT_KEY is never rotated, and this is what notices if it was.
 *
 * Every reporter's address is encrypted under a per-report key wrapped by
 * CONTACT_KEY (apps/api/src/filing/contactKeys.ts). Change CONTACT_KEY and
 * every address stored so far becomes unreadable, silently: the site keeps
 * running and the damage shows only when somebody tries to reach a
 * reporter. So the first deploy records a fingerprint of the key, and from
 * then on a deploy refuses to switch, and the doctor fails, if the key in
 * the settings no longer matches it.
 *
 * The fingerprint is SHA-256 of the key's 32 random bytes. That reveals
 * nothing usable about the key; it can only say "same" or "different".
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function fingerprint(contactKey: string): string {
  return createHash('sha256').update(Buffer.from(contactKey, 'base64')).digest('hex');
}

const file = (stateDir: string) => path.join(stateDir, 'contact-key.sha256');

export async function recordedFingerprint(stateDir: string): Promise<string | undefined> {
  try {
    return (await readFile(file(stateDir), 'utf8')).trim() || undefined;
  } catch {
    return undefined;
  }
}

export type KeyCheck =
  | { state: 'unset' }
  | { state: 'first'; fingerprint: string }
  | { state: 'same' }
  | { state: 'changed' };

export function compare(contactKey: string | undefined, recorded: string | undefined): KeyCheck {
  if (!contactKey) return { state: 'unset' };
  const now = fingerprint(contactKey);
  if (!recorded) return { state: 'first', fingerprint: now };
  return now === recorded ? { state: 'same' } : { state: 'changed' };
}

/** For the deploy: record on first sight, refuse a change. Never overwrites a recorded one. */
export async function checkAndRecord(
  contactKey: string | undefined,
  stateDir: string,
): Promise<KeyCheck> {
  const result = compare(contactKey, await recordedFingerprint(stateDir));
  if (result.state === 'first') {
    await mkdir(stateDir, { recursive: true });
    await writeFile(`${file(stateDir)}.tmp`, `${result.fingerprint}\n`, { mode: 0o640 });
    await rename(`${file(stateDir)}.tmp`, file(stateDir));
  }
  return result;
}

export const CHANGED_MESSAGE =
  'CONTACT_KEY is not the key this archive was started with. Every reporter address stored under ' +
  'the old key is unreadable under this one. Put the original key back in the settings file (from ' +
  'the copy kept off the server). The key is never rotated.';
