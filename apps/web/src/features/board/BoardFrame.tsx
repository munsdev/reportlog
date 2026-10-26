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
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { plainSiteName, useSite } from '../../components/ui/site.tsx';
import { Eyebrow, Lede } from '../../components/ui/type.tsx';
import { cn } from '../../lib/utils.ts';
import { placedMapsQuery } from '../maps/queries.ts';
import { pressQuery } from './queries.ts';
import { TabRow } from '../nav/AreaTabs.tsx';

type BoardPath = '/board' | '/board/numbers' | '/board/maps' | '/board/activity' | '/board/press';

const TABS: readonly { to: BoardPath; label: string }[] = [
  { to: '/board', label: 'Reports' },
  { to: '/board/numbers', label: 'By the numbers' },
  { to: '/board/maps', label: 'Maps' },
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
    <TabRow
      label="The board"
      tabs={tabs.map((t) => ({ to: t.to, label: t.label, current: path === t.to }))}
    />
  );
}

/**
 * A board page: the eyebrow, its heading and lede, the actions beside the
 * heading on a desktop (under it on a phone), the tabs, then the page.
 */
export function BoardFrame({
  title,
  eyebrow,
  lede,
  actions,
  width = 'wide',
  children,
}: {
  title: string;
  /** The site's name on the board itself; "Live report board" on its tabs. */
  eyebrow?: string;
  lede?: ReactNode;
  actions?: ReactNode;
  width?: 'wide' | 'prose';
  children: ReactNode;
}) {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${site}`;
  }, [title, site]);
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3">
          <Eyebrow>{eyebrow ?? 'Live report board'}</Eyebrow>
          <h1 className="font-display text-title">{title}</h1>
          {lede ? <Lede>{lede}</Lede> : null}
        </div>
        {actions ? (
          <div className="flex flex-col gap-3 lg:shrink-0 lg:flex-row">{actions}</div>
        ) : null}
      </header>
      <BoardTabs />
      <div className={cn('flex flex-col gap-6', width === 'prose' && 'max-w-prose')}>
        {children}
      </div>
    </section>
  );
}
