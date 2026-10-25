/**
 * Checking the site's social media accounts before they are stored.
 *
 * STRICTER THAN THE READ, like the front page's sections: an id it cannot
 * place, or a platform named twice, is a screen sending something wrong and
 * is refused in words. An address is checked by the same `socialAddress`
 * the screen uses as it is typed, and what is stored is the address it
 * stands for (a handle becomes a link). A platform the screen left out is
 * kept as it was.
 */
import {
  SOCIAL_PLATFORMS,
  SOCIAL_RULES,
  resolveSocialLinks,
  socialAddress,
} from '@reportlog/contracts';
import type { SocialLink, SocialPlatform } from '@reportlog/contracts';
import type { Checked } from './result.ts';

const KNOWN = new Set<string>(SOCIAL_PLATFORMS);

export function validateSocialLinks(
  current: readonly SocialLink[],
  links: readonly { id: string; address: string; shown: boolean }[],
): Checked<SocialLink[]> {
  const next = new Map<SocialPlatform, SocialLink>(current.map((l) => [l.id, l]));
  const seen = new Set<string>();
  for (const l of links) {
    if (!KNOWN.has(l.id)) {
      return { ok: false, error: `There is no platform called “${l.id}” to link to.` };
    }
    if (seen.has(l.id)) {
      return { ok: false, error: 'A platform is listed twice. Each one goes in once.' };
    }
    seen.add(l.id);
    const id = l.id as SocialPlatform;
    const { name } = SOCIAL_RULES[id];
    const address = socialAddress(id, l.address);
    if (!address.ok) return { ok: false, error: `${name}: ${address.error}` };
    if (l.shown && address.url === null) {
      return {
        ok: false,
        error: `${name} is switched on with no address. Add one, or switch it off.`,
      };
    }
    next.set(id, { id, url: address.url, shown: l.shown });
  }
  return { ok: true, value: resolveSocialLinks([...next.values()]) };
}
