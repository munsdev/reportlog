/**
 * The page for a wrong address (public.md §13): it says so, offers the way
 * home and to the board, and the reference field, because the most common
 * wrong address is a report's reference typed into the address bar.
 *
 * Drawn by the root route's `notFoundComponent` (routes/__root.tsx, the
 * navigation stage's file), which is where it is wired in.
 */
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button.tsx';
import { PublicPage } from './PublicPage.tsx';

export function NotFoundPage() {
  return (
    <PublicPage title="Nothing here" lede="There is no page at this address." width="prose">
      <ul className="flex flex-wrap gap-3" aria-label="Where to go instead">
        <li>
          <Button asChild variant="secondary">
            <Link to="/">Home</Link>
          </Button>
        </li>
        <li>
          <Button asChild variant="secondary">
            <Link to="/board">Board</Link>
          </Button>
        </li>
      </ul>
    </PublicPage>
  );
}
