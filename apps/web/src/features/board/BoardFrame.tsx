/**
 * The board's pages share a head and a row of tabs (mock-up board*.html):
 * Reports, Numbers, Maps (only when a map is placed on the board), Activity,
 * Press pack (only when it holds a document). Each tab is its own address,
 * and the one being read says so with `aria-current="page"`.
 *
 * The band is the same on every tab: the eyebrow, "Reports", the lead and
 * the tabs. There is no row of headline figures: a bare "N published" is
 * the number that gets quoted without the caveat, so the board never shows
 * one (owner decision 36). A tab other than the list opens with a line of
 * its own under the band.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Band, MockPage } from '../../mockup/Band.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { useJournalistAccess } from '../journalists/access.ts';
import { placedMapsQuery } from '../maps/queries.ts';
import { pressQuery } from './queries.ts';

type BoardPath =
  | '/board'
  | '/board/numbers'
  | '/board/maps'
  | '/board/activity'
  | '/board/press'
  | '/board/links'
  | '/board/accounts';

const TABS: readonly { to: BoardPath; label: string }[] = [
  { to: '/board', label: 'List' },
  { to: '/board/maps', label: 'Maps' },
  { to: '/board/numbers', label: 'Numbers' },
  { to: '/board/activity', label: 'Activity' },
  { to: '/board/press', label: 'Press pack' },
  // Journalists only (decision 81): the same layout, with these in it.
  { to: '/board/links', label: 'Links' },
  { to: '/board/accounts', label: 'Written accounts' },
];

export function BoardTabs() {
  const placed = useQuery(placedMapsQuery());
  const path = useRouterState({ select: (s) => s.location.pathname }).replace(/\/$/, '');
  // A tab to an empty page is a promise the board does not keep.
  const hasMaps = Boolean(placed.data?.maps.some((m) => m.slot === 'board_tab'));
  // Nor a Press pack tab with nothing in the pack.
  const press = useQuery(pressQuery).data;
  const hasPress = press?.state === 'ready' && press.files.length > 0;
  const journalist = useJournalistAccess() === 'yes';
  const tabs = TABS.filter(
    (t) =>
      (t.to !== '/board/maps' || hasMaps) &&
      (t.to !== '/board/press' || hasPress) &&
      ((t.to !== '/board/links' && t.to !== '/board/accounts') || journalist),
  );
  return (
    <nav className="tabs" aria-label="Report views">
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          activeProps={{}}
          {...(path === t.to ? { 'aria-current': 'page' as const } : {})}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * A board page. `list` is the report list (a plain wrap); every other tab
 * stacks its panels with the mock-up's 22px rhythm under a line of its own.
 */
export function BoardFrame({
  title,
  lede,
  list = false,
  children,
}: {
  /** The browser tab's title. */
  title: string;
  /** A sentence under the band, saying what this tab holds. */
  lede?: ReactNode;
  /** The report list: no stacking, the page lays itself out. */
  list?: boolean;
  children: ReactNode;
}) {
  useBodyClass('light');
  return (
    <MockPage>
      <Band
        motif
        eyebrow="Public record"
        title="Reports"
        tabTitle={title}
        lead="First-hand accounts a moderator has read and approved for publication, with their reporters’ permission. Published means judged publishable, which is a weaker claim than true."
        leadSize=".95rem"
      >
        <BoardTabs />
      </Band>
      {list ? (
        <div className="wrap">
          {lede ? (
            <p className="lead" style={{ paddingTop: 18, fontSize: '.95rem' }}>
              {lede}
            </p>
          ) : null}
          {children}
        </div>
      ) : (
        <div className="wrap" style={{ paddingTop: 22, display: 'grid', gap: 22 }}>
          {lede ? <p className="muted">{lede}</p> : null}
          {children}
        </div>
      )}
    </MockPage>
  );
}
