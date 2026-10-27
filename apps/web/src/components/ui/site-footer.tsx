/**
 * The footer on every page (`.site-foot`), as the mock-up draws it: the
 * wordmark and slogan, four columns of links, and a base line with Sign in,
 * Easier reading and the attribution.
 *
 * THE ATTRIBUTION IS NOT THE SITE'S NAME. "Powered by ReportLog" stays
 * whatever the deployment calls itself, and it is written from the
 * software's own constant, never from the site's name: a deployment naming
 * itself is not a deployment claiming to have written this, and AGPL
 * attribution belongs where a reader can see it. It links to the source
 * (nothing is fetched from its host), and the licence is named beside it.
 *
 * The version line is left out where there is no number to show (a
 * development checkout) rather than inventing one.
 *
 * The slogan is the operator's words (Footer slogan), the accounts the ones
 * switched on for the footer; with none, the Follow column is not drawn.
 * On a door `useSite` asks nothing, so both are simply absent there, and so
 * is Sign in, which a door may not reach.
 */
import {
  DIRECTORY_NAME,
  SOCIAL_RULES,
  SOFTWARE_LICENCE,
  SOFTWARE_NAME,
  SOFTWARE_SOURCE,
} from '@reportlog/contracts';
import type { SiteVersion } from '@reportlog/contracts';
import { Link } from '@tanstack/react-router';
import { useSite } from '@/components/ui/site.tsx';
import { useFollow } from '@/features/follow/useFollow.ts';
import { useGateMode } from '@/features/identity/gateMode.ts';
import { EasierReadingButton } from '@/mockup/EasierReading.tsx';
import { SocialMark } from '@/mockup/SocialMark.tsx';
import { Wordmark } from '@/mockup/Wordmark.tsx';

export function versionLine(version: SiteVersion | undefined): string | null {
  if (!version) return null;
  const { release, build } = version;
  if (release && build) return `Version ${release} (${build})`;
  if (release) return `Version ${release}`;
  if (build) return `Build ${build}`;
  return null;
}

export function SiteFooter() {
  const follow = useFollow('footer');
  const site = useSite().data;
  const door = useGateMode() === 'door';
  const [big, ...small] = (site?.copy.footer_slogan ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const version = versionLine(site?.version);
  return (
    <footer className="site-foot">
      <div className="wrap">
        <div className="foot-top">
          <Wordmark />
          {big ? (
            <p className="foot-slogan">
              {big}
              {small.length ? (
                <>
                  <br />
                  <span>{small.join(' ')}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="foot-cols">
          <div>
            <h4>Project</h4>
            <Link to="/about">About</Link>
            <br />
            <Link to="/get-involved">Get involved</Link>
            <br />
            <Link to="/journalists" hash="press">
              Press
            </Link>
          </div>
          <div>
            <h4>Using the site</h4>
            <Link to="/how">How it works</Link>
            <br />
            <Link to="/verify">Check a report</Link>
            <br />
            <Link to="/standards">Moderation standard</Link>
            <br />
            <Link to="/organizations">{DIRECTORY_NAME}</Link>
          </div>
          <div>
            <h4>Legal</h4>
            <Link to="/legal">Imprint &amp; privacy</Link>
            <br />
            <Link to="/terms">Terms</Link>
            <br />
            <Link to="/illegal-content">Report illegal content</Link>
          </div>
          {follow.links.length ? (
            <div>
              <h4>Follow</h4>
              <div className="social">
                {follow.links.map((l) => (
                  <a
                    key={l.id}
                    href={l.url}
                    rel="me noopener noreferrer"
                    referrerPolicy="no-referrer"
                    data-social={l.id}
                    aria-label={`${follow.name} on ${SOCIAL_RULES[l.id].name}`}
                  >
                    <SocialMark platform={l.id} />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="foot-base">
          <div className="links">
            {door ? null : <Link to="/access/sign-in">Sign in</Link>}
            <EasierReadingButton />
          </div>
          <span data-attribution>
            Powered by{' '}
            <a href={SOFTWARE_SOURCE} rel="noopener">
              {SOFTWARE_NAME}
            </a>
            , free software under the {SOFTWARE_LICENCE} licence
            {version ? ` · ${version}` : ''}
          </span>
        </div>
      </div>
    </footer>
  );
}
