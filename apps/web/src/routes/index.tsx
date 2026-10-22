/**
 * The front page (docs/design/screens/public.md §02): the operator's
 * headline and lede, the ways in as full-width buttons in the operator's
 * order (the first is the accent and no other is), what this archive is
 * for, the emergency notice, the home map, and checking a report.
 *
 * Phone first: one column. On a desktop, seven columns to five: the words on
 * the left, the buttons level with the headline on the right, and under them
 * the map beside "Check a report".
 */
import { getHomeButtons } from '@reportlog/contracts';
import type { HomeButton } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { Count } from '../components/ui/count.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';
import { Eyebrow, Lede, Meta } from '../components/ui/type.tsx';
import { CheckAReport } from '../features/board/CheckAReport.tsx';
import { boardReportsQuery } from '../features/board/queries.ts';
import { HelpNow } from '../features/form/HelpNow.tsx';
import { MapSlot } from '../features/maps/MapSlot.tsx';
import { call } from '../lib/api.ts';

export const homeButtonsQuery = queryOptions({
  queryKey: ['home-buttons'],
  queryFn: ({ signal }) => call(getHomeButtons, { signal }),
});

export const Route = createFileRoute('/')({
  component: Home,
});

/**
 * Where a built-in that acts in place goes. The alert sign-up is the
 * journalist alert list (api/src/logbooks/homeButtons.ts), which has its own
 * page and needs no sign-in, so the button is a link to it. An action with
 * nowhere to go is not drawn rather than drawn dead.
 */
const ACTION_HREF: Record<string, string> = { alerts: '/journalists/alerts' };

const hrefOf = (b: HomeButton): string | null =>
  b.href ?? (b.action ? (ACTION_HREF[b.action] ?? null) : null);

/**
 * The ways in, full width and stacked, each a link that looks like a button.
 * A button may carry a second line, its blurb, in the body face. The board's
 * carries the number of published reports, when it is known.
 */
export function HomeButtons({
  buttons,
  published,
}: {
  buttons: readonly HomeButton[];
  /** Published reports on the board, or undefined while unknown. */
  published?: number | undefined;
}) {
  const drawn = buttons.flatMap((b) => {
    const href = hrefOf(b);
    return href ? [{ b, href }] : [];
  });
  if (!drawn.length) return null;
  return (
    <ul className="flex flex-col gap-4" aria-label="What you can do here">
      {drawn.map(({ b, href }) => (
        <li key={`${b.kind}:${b.ref}`}>
          <Button
            asChild
            size="lg"
            block
            variant={b.accent ? 'primary' : 'secondary'}
            className={b.blurb ? 'min-h-18 flex-col gap-0.5' : undefined}
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
                <span className="font-sans text-[0.8125rem] font-normal tracking-normal normal-case">
                  {b.blurb}
                </span>
              ) : null}
            </a>
          </Button>
        </li>
      ))}
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

function Home() {
  const site = useSite().data;
  const query = useQuery(homeButtonsQuery);
  // The board's own first page: the same request the board makes, so its
  // number is the one the board shows, and it is already there on arrival.
  const board = useQuery(boardReportsQuery({}));
  const published = board.data?.published && 'total' in board.data ? board.data.total : undefined;
  const buttons = query.isError ? FALLBACK_BUTTONS : (query.data?.buttons ?? []);
  const name = plainSiteName(site);
  const headline = site?.copy.home_headline ?? 'ReportLog';
  useEffect(() => {
    document.title = `${headline} · ${name}`;
  }, [headline, name]);

  return (
    <div className="flex flex-col gap-10">
      {/* One column on a phone, in reading order: the words, the ways in,
          what the archive is for. On a desktop the ways in move to the right
          of the words, level with the headline, by grid placement alone, so
          the order a screen reader follows is the phone order everywhere. */}
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-x-10">
        <div className="flex flex-col gap-3 lg:col-span-7 lg:row-start-1">
          <Eyebrow>{name}</Eyebrow>
          <h1 className="font-display text-title">{headline}</h1>
          {site?.copy.home_lede ? (
            <Lede className="whitespace-pre-wrap">{site.copy.home_lede}</Lede>
          ) : null}
        </div>
        <div className="lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:pt-7">
          <Ways query={query} buttons={buttons} published={published} />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-7 lg:row-start-2">
          {site?.copy.home_intro ? (
            <p data-copy="home_intro" className="max-w-prose whitespace-pre-wrap">
              {site.copy.home_intro}
            </p>
          ) : null}
          {site ? <HelpNow text={site.copy.help_now} /> : null}
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-x-10">
        {/* Gone when no map is placed: absent, not an empty gap. */}
        <div className="min-w-0 empty:hidden lg:col-span-7">
          <MapSlot slot="home" />
        </div>
        <div className="lg:col-span-5">
          <Card variant="quiet" heading="Check a report">
            <CheckAReport help="Every report has a reference. Enter one to check it has not been changed." />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Ways({
  query,
  buttons,
  published,
}: {
  query: { isPending: boolean; isError: boolean };
  buttons: readonly HomeButton[];
  published: number | undefined;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      {query.isPending ? (
        <p role="status">Finding the ways in…</p>
      ) : (
        <HomeButtons buttons={buttons} published={published} />
      )}
      <Meta>Anyone can file. Sealed and timestamped on arrival.</Meta>
    </div>
  );
}
