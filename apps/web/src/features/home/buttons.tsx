/**
 * The front page's buttons: the ways in, in the operator's order, the first
 * the accent and no other. Drawn by the headline block (HeroBlock.tsx) as
 * the mock-up's `.btn-row`.
 */
import { getHomeButtons } from '@reportlog/contracts';
import type { HomeButton } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button.tsx';
import { call } from '@/lib/api.ts';
import { cn } from '@/lib/utils.ts';

export const homeButtonsQuery = queryOptions({
  queryKey: ['home-buttons'],
  queryFn: ({ signal }) => call(getHomeButtons, { signal }),
});

/**
 * Where a built-in that acts in place goes. The alert sign-up is the
 * journalist alert list (api/src/logbooks/homeButtons.ts), which has its own
 * page and needs no sign-in, so the button is a link to it. An action with
 * nowhere to go is not drawn rather than drawn dead.
 */
const ACTION_HREF: Record<string, string> = { alerts: '/journalists/alerts' };

export const hrefOf = (b: Pick<HomeButton, 'href' | 'action'>): string | null =>
  b.href ?? (b.action ? (ACTION_HREF[b.action] ?? null) : null);

/**
 * What the front page offers when the buttons cannot be fetched. The page
 * must never be a dead end because one call failed: these two are the
 * software's own destinations, so they exist on every deployment, and their
 * wording is the same as the built-ins' (api/src/logbooks/homeButtons.ts).
 */
export const FALLBACK_BUTTONS: readonly HomeButton[] = [
  {
    kind: 'builtin',
    ref: 'submit',
    label: 'Submit a Report',
    title: 'Submit a Report',
    href: '/submit',
    action: null,
    blurb: null,
    help: null,
    accent: true,
  },
  {
    kind: 'builtin',
    ref: 'board',
    label: 'View Live Report Board',
    title: 'View Live Report Board',
    href: '/board',
    action: null,
    blurb: null,
    help: null,
    accent: false,
  },
];

/**
 * THE FILING BUTTONS, wherever a page offers to take a report: one per open
 * logbook and list, straight to its form, in the order and with the labels
 * the operator arranged on the front page. A single "Submit a report" sent
 * people to a page asking which form, then to that form's opening card: two
 * pages before the first question, and a different front door from the home
 * page's.
 *
 * While the arrangement loads, or if it cannot be read, the old way in
 * stands in, so the page is never without one.
 */
export function FilingButtons({ className }: { className?: string }) {
  const q = useQuery(homeButtonsQuery);
  const filing = (q.data?.buttons ?? []).flatMap((b) => {
    const href = b.kind === 'logbook' || b.kind === 'list' ? hrefOf(b) : null;
    return href ? [{ b, href }] : [];
  });
  if (!filing.length) {
    return (
      <Button asChild size="lg" block className={cn('lg:w-auto', className)}>
        <a href="/submit">Submit a report</a>
      </Button>
    );
  }
  return (
    <>
      {filing.map(({ b, href }, i) => (
        <Button
          key={`${b.kind}:${b.ref}`}
          asChild
          size="lg"
          block
          variant={i === 0 ? 'primary' : 'secondary'}
          className={cn('lg:w-auto', className)}
        >
          <a href={href}>{b.label}</a>
        </Button>
      ))}
    </>
  );
}
