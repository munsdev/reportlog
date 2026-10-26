/**
 * The front page's buttons: the ways in, in the operator's order, the first
 * the accent and no other.
 *
 * BIG ON PURPOSE. The person this page is for may be standing in a queue,
 * stressed, on a phone they barely use. Each button is the width of the
 * screen and taller than a thumb, with the label in a size that can be read
 * at arm's length.
 */
import { getHomeButtons } from '@reportlog/contracts';
import type { HomeButton } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button.tsx';
import { Count } from '@/components/ui/count.tsx';
import { SocialLinks } from '@/components/ui/social-links.tsx';
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

/** The classes that make a link one of the front page's big buttons. */
export const BIG_BUTTON = 'min-h-16 text-base sm:min-h-18 sm:text-lg';

/**
 * The ways in, full width and stacked, each a link that looks like a button.
 * A button may carry a second line, its blurb, in the body face. The board's
 * carries the number of published reports, when it is known.
 */
export function HomeButtons({
  buttons,
  published,
  siteName = '',
  quiet = false,
}: {
  buttons: readonly HomeButton[];
  /** For the social icons' names ("<site> on Bluesky"). */
  siteName?: string;
  /** The info layout: every button secondary and ordinary-sized. */
  quiet?: boolean;
  /** Published reports on the board, or undefined while unknown. */
  published?: number | undefined;
}) {
  const drawn = buttons.flatMap((b): { b: HomeButton; href: string | null }[] => {
    // The row of social icons has no address of its own: it is its accounts.
    if (b.kind === 'social') return b.social?.length ? [{ b, href: null }] : [];
    const href = hrefOf(b);
    return href ? [{ b, href }] : [];
  });
  if (!drawn.length) return null;
  return (
    // ONE COLUMN, the accent first: on a desktop it is the page's right-hand
    // column (FrontPage.tsx), so a button is as wide as that column, not the page.
    <ul className="flex flex-col gap-3" aria-label="What you can do here">
      {drawn.map(({ b, href }) =>
        href === null ? (
          <li key={`${b.kind}:${b.ref}`} className="flex flex-col items-center gap-1 py-1">
            <p className="label-face text-sm">{b.label}</p>
            <SocialLinks links={b.social} siteName={siteName} variant="icons" />
            {b.blurb ? <p className="text-sm text-ink-alt">{b.blurb}</p> : null}
          </li>
        ) : (
          <li key={`${b.kind}:${b.ref}`}>
            <Button
              asChild
              size={quiet ? 'md' : 'lg'}
              block
              variant={b.accent && !quiet ? 'primary' : 'secondary'}
              className={quiet ? undefined : cn(BIG_BUTTON, b.blurb && 'flex-col gap-0.5 py-3')}
            >
              <a href={href}>
                <span className="inline-flex items-center gap-2">
                  {b.label}
                  {b.kind === 'builtin' && b.ref === 'board' && published !== undefined ? (
                    <Count
                      value={published}
                      label={`${String(published)} published report${published === 1 ? '' : 's'}`}
                    />
                  ) : null}
                </span>
                {b.blurb ? (
                  <span className="font-sans text-sm font-normal tracking-normal normal-case">
                    {b.blurb}
                  </span>
                ) : null}
              </a>
            </Button>
          </li>
        ),
      )}
    </ul>
  );
}

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
