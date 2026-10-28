/**
 * A small "Follow us" button in a corner of the public pages an administrator
 * chose (Site → Social media), opening the accounts that are switched on.
 *
 * NEVER ON A FORM OR A DOOR, and that is not a setting. A page carries it
 * only if `socialFloatPageOf` names it (the front page, board, maps, about,
 * journalists), so a filing form, a list form and the rest are out by
 * construction; a door is also checked by name. One card asks one question,
 * and nothing in front of somebody filling a form may change underneath them.
 *
 * QUIET ON A DOOR AND ON THE LOCK SCREEN. It asks for the site only when the
 * page is past the password, on a page that may carry it: the same rule as
 * the development badge, so it can never close a door by asking something the
 * door may not.
 *
 * A strip of the accounts in the middle of the bottom row, the notices at its
 * left and an administrator's Edit at its right (index.html, .fab-dock).
 */
import { SOCIAL_RULES, socialFloatPageOf } from '@reportlog/contracts';
import type { PublicSocialLink } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { siteStatusQuery, useGateMode } from '@/features/identity/gateMode.ts';
import { siteQuery } from './site.tsx';
import { SocialMark } from '@/mockup/SocialMark.tsx';

export function FollowButton() {
  const onDoor = useGateMode() === 'door';
  const { pathname } = useLocation();
  const page = socialFloatPageOf(pathname);
  const status = useQuery(siteStatusQuery);
  const past = status.data !== undefined && !status.data.locked && !onDoor;
  const site = useQuery({ ...siteQuery, enabled: past && page !== null });
  const links = site.data?.social_links;
  if (onDoor || page === null || !links?.length) return null;
  if (!site.data?.social_float_pages?.includes(page)) return null;
  return <Bar links={links} siteName={site.data.plain_name} />;
}

/**
 * One rounded strip with one icon per account, each going straight to it
 * (the owner's call, 28 Oct, in place of a "Follow us" menu), in the middle
 * of the bottom row (index.html, .fab-dock).
 */
function Bar({ links, siteName }: { links: readonly PublicSocialLink[]; siteName: string }) {
  return (
    <nav className="social-bar" aria-label={`Follow ${siteName}`} data-follow-us>
      {links.map((l) => (
        <a
          key={l.id}
          href={l.url}
          rel="me noopener noreferrer"
          referrerPolicy="no-referrer"
          data-social={l.id}
          aria-label={`${siteName} on ${SOCIAL_RULES[l.id].name}`}
        >
          <SocialMark platform={l.id} />
        </a>
      ))}
    </nav>
  );
}
