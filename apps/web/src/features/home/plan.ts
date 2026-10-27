/**
 * Which blocks the front page draws, in which zone, with which number.
 *
 * The mock-up's front page is a headline, then zones that alternate between
 * the page's ground (`a`) and the light one (`b`), each with a numbered
 * heading. This turns the saved blocks into that: a block that is hidden,
 * incomplete (`blockProblem`) or a live part with nothing to show is not a
 * zone for a visitor, and the editor draws it dimmed where it stands.
 *
 * Zones are lettered b, a, b, a ... from the first one under the headline,
 * and the last one, when it is light, wears the tint. A call to action
 * block is a box inside whatever zone it falls in, so it takes no number.
 */
import { blockProblem, blockText } from '@reportlog/contracts';
import type { Block } from '@reportlog/contracts';

/** What the live parts have to show, known to the page and not to the block. */
export interface LiveFacts {
  /** Published reports, or undefined while the archive is not public. */
  published: number | undefined;
  hasMap: boolean;
  hasAccounts: boolean;
}

export interface Placed {
  block: Block;
  /** Whether a visitor sees it. */
  shown: boolean;
  /** Why not, in words, for the editor's badge. */
  why: string | null;
  zone: 'a' | 'b';
  /** "01", "02" ..., or null for a headline or a call to action. */
  num: string | null;
  tint: boolean;
}

export const moduleOf = (b: Block): string => blockText(b, 'module');

/** A live part that has nothing to draw yet says so; the page leaves it out. */
export function liveGap(b: Block, facts: LiveFacts): string | null {
  if (b.type !== 'live') return null;
  switch (moduleOf(b)) {
    case 'figures':
      return facts.published === undefined ? 'Shown once the archive is public.' : null;
    case 'map':
      return facts.hasMap ? null : 'No map is placed on the front page yet.';
    case 'social':
      return facts.hasAccounts ? null : 'No social media account is switched on.';
    default:
      return null;
  }
}

export function planBlocks(blocks: readonly Block[], facts: LiveFacts): Placed[] {
  const out: Placed[] = [];
  let zones = 0;
  let numbered = 0;
  for (const b of blocks) {
    const problem = blockProblem(b);
    const gap = liveGap(b, facts);
    const why = !b.shown ? 'Hidden from the public.' : (problem ?? gap);
    const shown = why === null;
    if (b.type === 'hero') {
      out.push({ block: b, shown, why, zone: 'b', num: null, tint: false });
      continue;
    }
    if (shown) zones += 1;
    // A hidden block takes the zone it would fall in, without using it up.
    const zone = (shown ? zones : zones + 1) % 2 === 1 ? 'b' : 'a';
    let num: string | null = null;
    if (b.type !== 'cta') {
      const n = shown ? ++numbered : numbered + 1;
      num = n < 10 ? `0${String(n)}` : String(n);
    }
    out.push({ block: b, shown, why, zone, num, tint: false });
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const p = out[i];
    if (p?.shown && p.block.type !== 'hero') {
      if (p.zone === 'b') p.tint = true;
      break;
    }
  }
  return out;
}
