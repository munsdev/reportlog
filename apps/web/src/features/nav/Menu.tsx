/**
 * What the public pages and the staff frame share about the menu: the page's
 * main action (the operator's first front-page button) and the "Report a bug
 * on this page" link. The menus themselves are mockup/SiteMenu.tsx and
 * StaffShell.tsx.
 */
import { getHomeButtons } from '@reportlog/contracts';
import type { HomeButton } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link, useMatches } from '@tanstack/react-router';
import { call } from '@/lib/api.ts';
import type { SignedInMe } from '../identity/session.ts';
import { entriesFor } from '../staff-nav/entries.ts';

// The same key as the front page's own query, so the two share one answer.
const homeButtonsQuery = queryOptions({
  queryKey: ['home-buttons'],
  queryFn: ({ signal }) => call(getHomeButtons, { signal }),
});

/**
 * The page's main action: the operator's first front-page button that goes
 * somewhere, or "Submit a report" while it loads, if it cannot be read, or
 * when it is the built-in one under its own name.
 */
export function mainAction(buttons: readonly HomeButton[] | undefined): {
  label: string;
  href: string;
} {
  const first = buttons?.find((b) => b.href);
  if (!first?.href) return { label: 'Submit a report', href: '/submit' };
  if (first.kind === 'builtin' && first.ref === 'submit' && first.label === first.title)
    return { label: 'Submit a report', href: first.href };
  return { label: first.label || first.title, href: first.href };
}

/** The main action as the page should draw it, asking for the front page's buttons itself. */
export function useMainAction(): { label: string; href: string } {
  return mainAction(useQuery(homeButtonsQuery).data?.buttons);
}

function useHereRouteId(): string | undefined {
  // Which screen this is, as the router names it: feedback filed from here
  // says where it came from without carrying the address, which can hold a
  // token (an invitation's, say).
  return useMatches().at(-1)?.routeId;
}

/**
 * "Report a bug on this page", for those the feedback tracker admits. It
 * says which screen it was opened from by the router's name for it.
 */
export function BugLink({
  me,
  pathname,
  onChoose,
  className,
}: {
  me: SignedInMe;
  pathname: string;
  onChoose: () => void;
  className: string;
}) {
  const routeId = useHereRouteId();
  const bugs = entriesFor(me).some((p) => p.to === '/feedback');
  if (!bugs || pathname === '/feedback') return null;
  return (
    <li>
      <Link
        to="/feedback"
        {...(routeId ? { search: { from: routeId } } : {})}
        activeOptions={{ exact: true, includeSearch: true }}
        onClick={onChoose}
        className={className}
      >
        Report a bug on this page
      </Link>
    </li>
  );
}
