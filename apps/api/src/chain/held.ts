/**
 * Turning held values into what the seal commits to (W1).
 *
 * Every held value gets a nonce of its own, made here from the server's
 * random source and never from the request, and its fingerprint is made by
 * the seal's own function, the one a reader's browser would run. The values
 * and nonces go to the erasable store (reportValues/); only the fingerprints
 * go to the seal. appendReportVersion is the one caller that writes both,
 * in one transaction, from the same rows.
 */
import { randomBytes } from 'node:crypto';
import type { HeldValues } from '@reportlog/fields';
import { heldFingerprint } from '@reportlog/seal';
import type { LinkFingerprints, ReportFields, TextFingerprints } from '@reportlog/seal';
import type { HeldRow, HeldSlot } from '../reportValues/store.ts';

/** One row per value, each with a fresh nonce: text first, then links, in question order as given. */
export function prepareHeld(held: HeldValues | undefined): HeldRow[] {
  if (!held) return [];
  const rows: HeldRow[] = [];
  for (const [fieldKey, value] of Object.entries(held.text ?? {})) {
    const nonce = randomBytes(32).toString('hex');
    rows.push({
      fieldKey,
      kind: 'private_text',
      position: 0,
      nonce,
      value,
      fingerprint: heldFingerprint(nonce, value),
    });
  }
  for (const [fieldKey, links] of Object.entries(held.links ?? {})) {
    links.forEach((value, position) => {
      const nonce = randomBytes(32).toString('hex');
      rows.push({
        fieldKey,
        kind: 'private_link',
        position,
        nonce,
        value,
        fingerprint: heldFingerprint(nonce, value),
      });
    });
  }
  return rows;
}

/**
 * The two sealed keys, from the values a version holds, each ONLY WHEN IT
 * HOLDS SOMETHING. Links in position order, which is the order sent.
 */
export function fingerprintKeys(
  slots: readonly HeldSlot[],
): Pick<ReportFields, 'text_fingerprints' | 'link_fingerprints'> {
  const text: TextFingerprints = {};
  const links: Record<string, { position: number; fingerprint: string }[]> = {};
  for (const s of slots) {
    if (s.kind === 'private_text') text[s.fieldKey] = s.fingerprint;
    else (links[s.fieldKey] ??= []).push({ position: s.position, fingerprint: s.fingerprint });
  }
  const linkPrints: LinkFingerprints = Object.fromEntries(
    Object.entries(links).map(([k, l]) => [
      k,
      l.sort((a, b) => a.position - b.position).map((x) => x.fingerprint),
    ]),
  );
  return {
    ...(Object.keys(text).length ? { text_fingerprints: text } : {}),
    ...(Object.keys(linkPrints).length ? { link_fingerprints: linkPrints } : {}),
  };
}
