import { placementOn } from '@reportlog/contracts';
import type { PublicSocialLink, SocialPlacement } from '@reportlog/contracts';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';

/**
 * The accounts to show at one placement, and the site's name for their
 * labels. An empty list means draw nothing: no account is switched on, the
 * placement is switched off on Site → Social media, or this is a door (where
 * `useSite` asks nothing, so there is nothing to show).
 */
export function useFollow(placement: SocialPlacement): {
  links: readonly PublicSocialLink[];
  name: string;
} {
  const site = useSite().data;
  const name = plainSiteName(site);
  if (!placementOn(site?.social_placements, placement)) return { links: [], name };
  return { links: site?.social_links ?? [], name };
}
