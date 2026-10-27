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
import { Button } from '@/components/ui/button.tsx';
import { useMainAction } from '../nav/Menu.tsx';
import { PublicPage } from './PublicPage.tsx';

export function NotFoundPage() {
  const { label, href } = useMainAction();
  return (
    <PublicPage
      eyebrow="404"
      title="That page isn't here"
      lede="The link may be old, or the report may not be published yet. Check the reference, or start from the front page."
      width="prose"
    >
      <ul className="flex flex-wrap gap-3" aria-label="Where to go instead">
        <li>
          <Button asChild>
            {href === '/submit' ? <Link to="/submit">{label}</Link> : <a href={href}>{label}</a>}
          </Button>
        </li>
        <li>
          <Button asChild variant="secondary">
            <Link to="/">Front page</Link>
          </Button>
        </li>
      </ul>
    </PublicPage>
  );
}
