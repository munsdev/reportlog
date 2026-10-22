/**
 * AREA TABS: the second level, on the page (docs/design/navigation.md,
 * section 05). Every page in a staff area shows the area's pages as a row
 * of links under its title, the current one marked with `aria-current` and
 * a 3px brand underline. Links with addresses, not ARIA tabs: Back works and
 * each page can be bookmarked. Brand, not action: a tab is a link.
 *
 * On a phone the row scrolls sideways inside the page gutter, with a fade on
 * the right while there is more, and brings the current tab into view on
 * load. It never wraps.
 *
 * WHERE IT IS DRAWN. A page puts `<AreaTabs />` under its own heading and
 * lede. Until a page does, the site's frame draws the same row at the top of
 * the page (`AreaTabsFallback` in __root.tsx), so no staff page is without
 * one. A page drawing its own takes the slot, and the frame's steps aside,
 * so the row is never shown twice.
 *
 * `TabRow` is the row itself, for a set of pages that is not a staff area
 * (the board's own tabs, which are public).
 */
import { Link, useLocation } from '@tanstack/react-router';
import type { LinkProps } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { useGateMode } from '../identity/gateMode.ts';
import { useMe } from '../identity/session.ts';
import { STAFF_AREAS, areaAt, entryAt, entriesFor } from '../staff-nav/entries.ts';
import type { AreaId } from '../staff-nav/entries.ts';

export interface Tab {
  to: NonNullable<LinkProps['to']>;
  hash?: string | undefined;
  label: string;
  current: boolean;
}

export function TabRow({
  label,
  tabs,
  className,
}: {
  /** What the row is, for a screen reader: the area's name. */
  label: string;
  tabs: readonly Tab[];
  className?: string | undefined;
}) {
  const scroller = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    // The current tab in view on load, without moving the page itself.
    const current = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && el.scrollWidth > el.clientWidth) {
      el.scrollLeft = Math.max(
        0,
        current.offsetLeft - el.clientWidth / 2 + current.offsetWidth / 2,
      );
    }
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [tabs]);

  return (
    <nav aria-label={label} className={cn('relative print:hidden', className)}>
      <ul
        ref={scroller}
        className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => (
          <li key={`${t.to}#${t.hash ?? ''}`} className="shrink-0">
            <Link
              to={t.to}
              {...(t.hash ? { hash: t.hash } : {})}
              // Marked by `current`, which the caller decides, never by the
              // router's own guess: one tab is "here", and only one.
              activeOptions={{ exact: true, includeSearch: false, includeHash: true }}
              activeProps={{}}
              aria-current={t.current ? 'page' : undefined}
              className={cn(
                '-mb-px flex min-h-11 items-center border-b-[3px] border-transparent px-3 label-face text-[0.8125rem] whitespace-nowrap text-ink-alt hover:text-ink',
                t.current && 'border-brand text-ink',
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
      {more ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-paper"
        />
      ) : null}
    </nav>
  );
}

// ── staff areas ─────────────────────────────────────────────────────────

interface Slot {
  /** A page has drawn its own row: the frame's steps aside. */
  claimed: boolean;
  claim: () => () => void;
}

const SlotContext = createContext<Slot>({ claimed: false, claim: () => () => undefined });

/** Around the frame and the page, so the page's own row can take the slot. */
export function AreaTabsSlot({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState(0);
  const [slot] = useState(() => ({
    claim: () => {
      setClaims((n) => n + 1);
      return () => {
        setClaims((n) => n - 1);
      };
    },
  }));
  return (
    <SlotContext.Provider value={{ claimed: claims > 0, claim: slot.claim }}>
      {children}
    </SlotContext.Provider>
  );
}

/**
 * This page's area as tabs, for the person looking: only the pages they may
 * open, and nothing when that is fewer than two. `area` names it when the
 * page's address does not (it rarely needs to).
 */
export function AreaTabs({ area, className }: TabsProps) {
  const { claim } = useContext(SlotContext);
  // Before paint, so the frame's row is never seen beside this one.
  useLayoutEffect(() => claim(), [claim]);
  return <StaffTabs area={area} className={className} />;
}

/**
 * For a screen that stands in front of an area's pages and must not offer
 * them (the moderator agreement's gate, say): takes the slot and draws
 * nothing, so the frame's row steps aside too.
 */
export function useHideAreaTabs(): void {
  const { claim } = useContext(SlotContext);
  useLayoutEffect(() => claim(), [claim]);
}

/** The frame's row, drawn until the page draws its own. */
export function AreaTabsFallback({ className }: { className?: string | undefined }) {
  const { claimed } = useContext(SlotContext);
  if (claimed) return null;
  return <StaffTabs className={className} />;
}

interface TabsProps {
  /** The area, when the page's address does not say it. */
  area?: AreaId | undefined;
  className?: string | undefined;
}

function StaffTabs(props: TabsProps) {
  // Never on a door: what follows asks who is signed in.
  if (useGateMode() === 'door') return null;
  return <StaffTabsFor {...props} />;
}

function StaffTabsFor({ area, className }: TabsProps) {
  const { pathname } = useLocation();
  const which = area ? STAFF_AREAS.find((a) => a.id === area) : areaAt(pathname);
  const me = useMe().data;
  if (!which || !me?.signedIn) return null;
  const pages = entriesFor(me, which.pages);
  if (pages.length < 2) return null;
  const here = entryAt(pathname);
  return (
    <TabRow
      label={which.label}
      className={className}
      tabs={pages.map((p) => ({
        to: p.to,
        hash: p.hash,
        label: p.tab ?? p.label,
        current: here === p,
      }))}
    />
  );
}
