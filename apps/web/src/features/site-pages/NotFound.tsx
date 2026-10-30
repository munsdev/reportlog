/**
 * The page for a wrong address (public.md §13): it says so, offers the way
 * to file and the way home. The most common wrong address is a report's
 * reference typed into the address bar, so it says to check the reference.
 *
 * "File a report" is the same target as the header's: straight to the
 * logbook the operator put first, not to the chooser.
 *
 * Drawn by the root route's `notFoundComponent` (routes/__root.tsx, the
 * navigation stage's file), which is where it is wired in.
 */
import { Link } from '@tanstack/react-router';
import { MockPage } from '../../mockup/Band.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { usePageTitle } from '../../mockup/usePageTitle.ts';
import { useMainAction } from '../nav/Menu.tsx';
import { useNoIndex } from './searchMeta.tsx';

export function NotFoundPage() {
  const { label, href } = useMainAction();
  useBodyClass('dark');
  usePageTitle('Page not found');
  // The address may look like a page that could be indexed (/<slug>).
  useNoIndex();
  return (
    <MockPage>
      <div className="wrap oops">
        <span className="eyebrow">404</span>
        <h1 className="display" style={{ fontSize: 'clamp(2.6rem,9vw,6rem)' }}>
          That page <br />
          <span className="two">isn&rsquo;t here</span>
        </h1>
        <p className="lead">
          The link may be old, or the report may not be published yet. Check the reference, or start
          from the front page.
        </p>
        <div className="btn-row" aria-label="Where to go instead">
          {href === '/submit' ? (
            <Link className="btn go" to="/submit">
              {label}
            </Link>
          ) : (
            <a className="btn go" href={href}>
              {label}
            </a>
          )}
          <Link className="btn ghost" to="/">
            Front page
          </Link>
        </div>
      </div>
    </MockPage>
  );
}
