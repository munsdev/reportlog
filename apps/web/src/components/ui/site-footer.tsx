/**
 * The footer on every page: where to read more, the attribution, and which
 * release this is.
 *
 * THE ATTRIBUTION IS NOT THE SITE'S NAME. "Powered by ReportLog" stays
 * whatever the deployment calls itself, and it is written from the
 * software's own constant, never from the site's name: a deployment naming
 * itself is not a deployment claiming to have written this, and AGPL
 * attribution belongs where a reader can see it. A link is not a request:
 * nothing is fetched from the source's host.
 *
 * The version line is left out where there is no number to show (a
 * development checkout) rather than inventing one.
 *
 * The site's accounts elsewhere sit under the links, as marks, when any is
 * switched on (social-links.tsx). On a door `useSite` asks nothing, so the
 * row is simply absent there.
 *
 * "Easier reading" ends it (docs/design/navigation.md, section 06), drawn
 * by the slot the look system's switch fills (features/nav/EasierReadingSlot).
 */
import {
  DIRECTORY_NAME,
  SOFTWARE_LICENCE,
  SOFTWARE_NAME,
  SOFTWARE_SOURCE,
} from '@reportlog/contracts';
import type { SiteVersion } from '@reportlog/contracts';
import { Link } from '@tanstack/react-router';
import { useFollow } from '@/features/follow/useFollow.ts';
import { EasierReadingSlot } from '@/features/nav/EasierReadingSlot.tsx';
import { SocialLinks } from './social-links.tsx';

export function versionLine(version: SiteVersion | undefined): string | null {
  if (!version) return null;
  const { release, build } = version;
  if (release && build) return `Version ${release} (${build})`;
  if (release) return `Version ${release}`;
  if (build) return `Build ${build}`;
  return null;
}

const LINKS = [
  { to: '/about', label: 'About' },
  { to: '/how', label: 'How to use' },
  { to: '/standards', label: 'Moderation standard' },
  { to: '/legal', label: 'Imprint and privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/illegal-content', label: 'Report illegal content' },
  { to: '/organizations', label: DIRECTORY_NAME },
  // A plain link: the sign-up page asks the server for nothing until its
  // form is sent, so this is safe on a door, where the footer also shows.
  { to: '/journalists', label: 'For journalists' },
] as const;

export function SiteFooter() {
  const follow = useFollow('footer');
  return (
    <footer className="border-t border-line px-4 py-6 text-center text-sm text-muted print:hidden">
      <nav aria-label="About this site">
        <ul className="flex flex-wrap justify-center gap-x-4">
          {LINKS.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="inline-flex min-h-11 items-center underline">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {follow.links.length ? (
        <nav aria-label="Follow us elsewhere" className="mt-2">
          <SocialLinks links={follow.links} siteName={follow.name} variant="icons" />
        </nav>
      ) : null}
      <p className="mt-2" data-attribution>
        Powered by{' '}
        <a href={SOFTWARE_SOURCE} rel="noopener" className="underline">
          {SOFTWARE_NAME}
        </a>
        , free software under the {SOFTWARE_LICENCE} licence.
      </p>
      <EasierReadingSlot where="footer" />
    </footer>
  );
}
