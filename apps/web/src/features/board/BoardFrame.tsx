/**
 * The board's pages share a head and a row of tabs (public.md §03, §04):
 * Reports, By the numbers, Maps (only when a map is placed on the board),
 * Press pack (only when it holds a document). Arrivals and declines is
 * reached from How to use this, not from a tab. Each tab is its own address, and the one
 * being read says so, to a screen reader as `aria-current="page"` and to the
 * eye as a brand-coloured underline, never the action colour.
 *
 * The row is the site's `TabRow` (features/nav/AreaTabs.tsx): on a narrow
 * screen one dropdown, and on a wide one the tabs that do not fit go under
 * "More", so nothing scrolls sideways.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { BandPage, BandTabs } from '../../components/ui/band.tsx';
import { cn } from '../../lib/utils.ts';
import { placedMapsQuery } from '../maps/queries.ts';
import { pressQuery } from './queries.ts';

type BoardPath = '/board' | '/board/numbers' | '/board/maps' | '/board/activity' | '/board/press';

const TABS: readonly { to: BoardPath; label: string }[] = [
  { to: '/board', label: 'List' },
  { to: '/board/numbers', label: 'Numbers' },
  { to: '/board/maps', label: 'Maps' },
  { to: '/board/activity', label: 'Activity' },
  { to: '/board/press', label: 'Press pack' },
];

export function BoardTabs() {
  const placed = useQuery(placedMapsQuery());
  const path = useRouterState({ select: (s) => s.location.pathname }).replace(/\/$/, '');
  // A tab to an empty page is a promise the board does not keep.
  const hasMaps = Boolean(placed.data?.maps.some((m) => m.slot === 'board_tab'));
  // Nor a Press pack tab with nothing in the pack.
  const press = useQuery(pressQuery).data;
  const hasPress = press?.state === 'ready' && press.files.length > 0;
  const tabs = TABS.filter(
    (t) => (t.to !== '/board/maps' || hasMaps) && (t.to !== '/board/press' || hasPress),
  );
  return (
    <BandTabs
      label="Report views"
      tabs={tabs.map((t) => ({ to: t.to, label: t.label, current: path === t.to }))}
    />
  );
}

/**
 * A board page (mock-up board*.html): the same band on every tab (the
 * eyebrow, "Reports", the figure, the lead and the tabs), then the page.
 * A tab other than the list names itself with a heading of its own
 * (`heading`), under the band; the list needs none.
 */
export function BoardFrame({
  title,
  heading,
  lede,
  actions,
  width = 'wide',
  children,
}: {
  /** The browser tab's title. */
  title: string;
  /** This tab's own heading, under the band. */
  heading?: string;
  /** A sentence under this tab's heading. */
  lede?: ReactNode;
  actions?: ReactNode;
  width?: 'wide' | 'prose';
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <BandPage
      title={title}
      heading="Reports"
      eyebrow="Public record"
      lede="First-hand accounts a moderator has read and approved for publication, with their reporters’ permission. Published means judged publishable, which is a weaker claim than true."
      band={
        <>
          <BoardTabs />
        </>
      }
    >
      {heading || actions ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-2">
            {heading ? <h2 className="font-display text-section">{heading}</h2> : null}
            {lede ? <p className="max-w-[62ch] text-lede text-ink-alt">{lede}</p> : null}
          </div>
          {actions ? (
            <div className="flex flex-col gap-3 lg:shrink-0 lg:flex-row">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={cn('flex flex-col gap-6', width === 'prose' && 'max-w-prose')}>
        {children}
      </div>
    </BandPage>
  );
}
