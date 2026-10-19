/**
 * CONTACT_KEY is never changed by accident, and this is what notices if it was.
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
 *
 * A PLANNED ROTATION is let through (workstream C2,
 * apps/api/src/filing/rotateContactKey.ts): the new key in CONTACT_KEY and
 * the recorded one in CONTACT_KEY_PREVIOUS reads as `rotating`, not
 * `changed`. Nothing is recorded then; `reportlog contact-key rotate`
 * records the new key once every row has moved to it. A changed key with no
 * previous one, or beside a previous one that is not the recorded key, is
 * still refused.
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
  // `previousLeftOver`: the rotation is done and CONTACT_KEY_PREVIOUS can go.
  | { state: 'same'; previousLeftOver?: true }
  | { state: 'rotating' }
  | { state: 'changed' };

export function compare(
  contactKey: string | undefined,
  recorded: string | undefined,
  previousKey?: string,
): KeyCheck {
  if (!contactKey) return { state: 'unset' };
  const now = fingerprint(contactKey);
  if (!recorded) return { state: 'first', fingerprint: now };
  const previous = previousKey ? fingerprint(previousKey) : undefined;
  if (now === recorded) {
    return previous && previous !== now
      ? { state: 'same', previousLeftOver: true }
      : { state: 'same' };
  }
  return previous === recorded ? { state: 'rotating' } : { state: 'changed' };
}

async function record(stateDir: string, fp: string): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(`${file(stateDir)}.tmp`, `${fp}\n`, { mode: 0o640 });
  await rename(`${file(stateDir)}.tmp`, file(stateDir));
}

/**
 * For the deploy: record on first sight, refuse a change, let a planned
 * rotation through. Never overwrites a recorded one.
 */
export async function checkAndRecord(
  contactKey: string | undefined,
  stateDir: string,
  previousKey?: string,
): Promise<KeyCheck> {
  const result = compare(contactKey, await recordedFingerprint(stateDir), previousKey);
  if (result.state === 'first') await record(stateDir, result.fingerprint);
  return result;
}

/**
 * The one way the recorded fingerprint is replaced: after a rotation has
 * moved every row to this key (`reportlog contact-key rotate`).
 */
export async function recordRotated(contactKey: string, stateDir: string): Promise<void> {
  await record(stateDir, fingerprint(contactKey));
}

export const CHANGED_MESSAGE =
  'CONTACT_KEY is not the key this archive was started with. Every reporter address stored under ' +
  'the old key is unreadable under this one. Put the original key back in the settings file (from ' +
  'the copy kept off the server). To rotate it on purpose, keep the original in ' +
  'CONTACT_KEY_PREVIOUS and run `reportlog contact-key rotate` (deploy/README.md).';
