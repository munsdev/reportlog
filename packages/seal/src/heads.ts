/**
 * THE LIST OF CHAINS, and the one value the daily timestamp covers.
 *
 * Once a day the anchor takes every launched logbook, its newest link and
 * how many reports it holds, and gets an outside timestamp over the digest of
 * that list. A logbook with no reports is listed at its genesis with a count
 * of 0: it exists from the moment it launches.
 *
 * ONCE LISTED, ALWAYS LISTED. With separate chains, deleting a whole logbook
 * leaves every other chain intact and nothing inside them notices. The list
 * notices: a logbook named in a published anchor must be named in every later
 * one, and its count can only grow. `contradictions` finds any that break
 * either rule, and the anchor refuses to publish a list that does. Do not
 * weaken it — it is the only thing that notices a logbook disappearing.
 */
import { canonicalJson, sha256Hex } from './hash.ts';

export const ANCHOR_FORMAT = 2;

export interface ChainHead {
  logbook: string;
  head: string;
  reports: number;
}

/** SHA-256 of the list, RFC 8785, lowercase hex. Anybody holding the list can recompute it. */
export function headsDigest(date: string, heads: readonly ChainHead[]): string {
  return sha256Hex(canonicalJson({ anchor_format: ANCHOR_FORMAT, date, chains: heads }));
}

export interface Contradictions {
  dropped: string[];
  shrunk: { logbook: string; was: number; now: number }[];
}

/** What the last published list says that `current` contradicts. */
export function contradictions(
  published: readonly { logbook: string; reports: number }[],
  current: readonly ChainHead[],
): Contradictions {
  const now = new Map(current.map((h) => [h.logbook, h]));
  const dropped: string[] = [];
  const shrunk: Contradictions['shrunk'] = [];
  for (const p of published) {
    const c = now.get(p.logbook);
    if (!c) dropped.push(p.logbook);
    else if (c.reports < p.reports)
      shrunk.push({ logbook: p.logbook, was: p.reports, now: c.reports });
  }
  return { dropped, shrunk };
}

export function isClean(c: Contradictions): boolean {
  return c.dropped.length === 0 && c.shrunk.length === 0;
}
