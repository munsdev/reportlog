/**
 * A ROW OF TABS: a set of pages that belong together, as links under a
 * page's title (docs/design/navigation.md, section 05), the current one
 * marked with `aria-current` and a 3px brand underline. Links with
 * addresses, not ARIA tabs: Back works and each page can be bookmarked.
 * Brand, not action: a tab is a link.
 *
 * Used where a page has pages of its own: the public board's, a staff page's
 * own sections (the file settings, the journalist requests), anchors on the
 * journalist desk. A staff AREA's pages are not tabs any more: they are the
 * staff sidebar's entries (StaffShell.tsx).
 *
 * NOTHING SCROLLS SIDEWAYS, hidden or not:
 *
 *   - On a wide screen the tabs sit in one row. The ones that do not fit go
 *     into a "More" dropdown at its end, and the current page's tab is always
 *     one of those left in the row. Before the row is measured (the first
 *     paint, or a browser that cannot measure), it wraps instead, so no tab
 *     is ever out of reach.
 *   - Below 768px it is one dropdown that names where you are
 *     ("Section: Reports") and lists every tab.
 *
 * Each dropdown is a button with `aria-expanded` and a list of links; Escape
 * or a press outside closes it, and focus goes back to the button.
 */
import { Link } from '@tanstack/react-router';
import type { LinkProps } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.ts';
import { usePopup } from './popup.ts';
import { usePhone } from './waiting.ts';

export interface Tab {
  to: NonNullable<LinkProps['to']>;
  hash?: string | undefined;
  label: string;
  current: boolean;
}

const key = (t: Tab) => `${t.to}#${t.hash ?? ''}`;

const TAB =
  'flex min-h-11 items-center border-b-[3px] px-3 label-face text-[0.8125rem] whitespace-nowrap';

export function TabRow({
  label,
  tabs,
  className,
}: {
  /** What the row is, for a screen reader: "The board", "File settings". */
  label: string;
  tabs: readonly Tab[];
  className?: string | undefined;
}) {
  const phone = usePhone();
  return (
    <nav aria-label={label} className={cn('min-w-0 print:hidden', className)}>
      {phone ? <TabSelect tabs={tabs} /> : <TabLine tabs={tabs} />}
    </nav>
  );
}

function TabLink({
  tab,
  className,
  onChoose,
}: {
  tab: Tab;
  className?: string;
  onChoose?: () => void;
}) {
  return (
    <Link
      to={tab.to}
      {...(tab.hash ? { hash: tab.hash } : {})}
      // Marked by `current`, which the caller decides, never by the
      // router's own guess: one tab is "here", and only one.
      activeOptions={{ exact: true, includeSearch: false, includeHash: true }}
      activeProps={{}}
      aria-current={tab.current ? 'page' : undefined}
      onClick={onChoose}
      className={className}
    >
      {tab.label}
    </Link>
  );
}

// ── a wide screen: one row, the rest under More ─────────────────────────

/** What the ruler measured: the row's width, each tab's, and the More button's. */
interface Space {
  avail: number;
  widths: readonly number[];
  more: number;
}

const sameSpace = (a: Space | null, b: Space | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.avail === b.avail &&
    a.more === b.more &&
    a.widths.length === b.widths.length &&
    a.widths.every((w, i) => w === b.widths[i]));

/**
 * Which tabs stay in the row, given what was measured: all of them if they
 * fit, else as many as fit beside More, in order, the current one always
 * among them. `null` (nothing measured) means all of them, wrapping.
 */
export function tabsInRow(tabs: readonly Tab[], space: Space | null): ReadonlySet<number> | null {
  if (!space || space.avail === 0 || space.widths.every((w) => w === 0)) return null;
  const all = new Set(tabs.map((_, i) => i));
  const total = space.widths.reduce((a, b) => a + b, 0);
  if (total <= space.avail) return all;
  const room = space.avail - space.more;
  const current = tabs.findIndex((t) => t.current);
  const keep = new Set<number>();
  let used = current >= 0 ? (space.widths[current] ?? 0) : 0;
  for (let i = 0; i < tabs.length; i += 1) {
    if (i === current) continue;
    const w = space.widths[i] ?? 0;
    if (used + w > room) break;
    keep.add(i);
    used += w;
  }
  if (current >= 0) keep.add(current);
  return keep;
}

function TabLine({ tabs }: { tabs: readonly Tab[] }) {
  const row = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLUListElement>(null);
  const [space, setSpace] = useState<Space | null>(null);
  // Measured again when the words on the tabs change (callers build a new
  // array on every render, so the array itself would measure forever).
  const words = tabs.map((t) => t.label).join('|');

  useLayoutEffect(() => {
    const box = row.current;
    const measure = ruler.current;
    if (!box || !measure || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      const widths = [...measure.children].map((el) => el.getBoundingClientRect().width);
      // The last child of the ruler is the More button.
      const more = widths.pop() ?? 0;
      const next = { avail: box.clientWidth, widths, more };
      setSpace((was) => (sameSpace(was, next) ? was : next));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    return () => {
      watch.disconnect();
    };
  }, [words]);

  const shown = tabsInRow(tabs, space);
  const inRow = shown ? tabs.filter((_, i) => shown.has(i)) : tabs;
  const rest = shown ? tabs.filter((_, i) => !shown.has(i)) : [];

  return (
    <div ref={row} className="relative">
      {/* The ruler: every tab and the More button laid out unseen, so the
          row knows their widths without drawing them twice for anybody. */}
      <ul
        ref={ruler}
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 flex h-0 w-max overflow-hidden"
      >
        {tabs.map((t) => (
          <li key={key(t)} className={cn(TAB, 'border-transparent')}>
            {t.label}
          </li>
        ))}
        <li className={cn(TAB, 'gap-1.5 border-transparent')}>
          More
          <Chevron />
        </li>
      </ul>
      <ul
        className={cn(
          'flex border-b border-line',
          // Unmeasured: wrap, so nothing is out of reach meanwhile.
          shown ? 'flex-nowrap' : 'flex-wrap',
        )}
      >
        {inRow.map((t) => (
          <li key={key(t)} className="shrink-0">
            <TabLink
              tab={t}
              className={cn(
                TAB,
                '-mb-px text-ink-alt hover:text-ink',
                t.current ? 'border-brand text-ink' : 'border-transparent',
              )}
            />
          </li>
        ))}
        {rest.length ? (
          <li className="-mb-px shrink-0">
            <TabMenu label="More" tabs={rest} align="end" />
          </li>
        ) : null}
      </ul>
    </div>
  );
}

// ── a phone: one dropdown ───────────────────────────────────────────────

function TabSelect({ tabs }: { tabs: readonly Tab[] }) {
  const here = tabs.find((t) => t.current);
  return (
    <div className="border-b border-line pb-2">
      <TabMenu
        label={here ? `Section: ${here.label}` : 'Sections'}
        tabs={tabs}
        align="start"
        wide
      />
    </div>
  );
}

// ── the dropdown both use ───────────────────────────────────────────────

function TabMenu({
  label,
  tabs,
  align,
  wide = false,
}: {
  label: string;
  tabs: readonly Tab[];
  align: 'start' | 'end';
  /** As wide as the page (a phone's one dropdown). */
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLUListElement>(null);
  const id = useId();
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  usePopup({ open, onClose: close, button, panel });
  // Up and down move between the links; Tab works as ever.
  useEffect(() => {
    const list = panel.current;
    if (!open || !list) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const links = [...list.querySelectorAll<HTMLElement>('a[href]')];
      const at = links.findIndex((l) => l === document.activeElement);
      const to = links[(at + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length];
      if (to) {
        e.preventDefault();
        to.focus();
      }
    };
    list.addEventListener('keydown', onKey);
    return () => {
      list.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const holdsCurrent = tabs.some((t) => t.current);
  return (
    <div className={cn('relative', wide && 'w-full')}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          // Down arrow opens it as a menu button does; focus goes to the first link.
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          wide
            ? 'flex min-h-11 w-full items-center justify-between gap-2 rounded-control border border-line bg-surface px-3 text-left label-face text-[0.8125rem] text-ink'
            : cn(
                TAB,
                'gap-1.5 text-ink-alt hover:text-ink',
                holdsCurrent ? 'border-brand text-ink' : 'border-transparent',
              ),
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        <Chevron open={open} />
      </button>
      <ul
        ref={panel}
        id={id}
        hidden={!open}
        className={cn(
          'absolute top-full z-30 mt-1 flex flex-col rounded-card border border-line bg-surface p-1 shadow-lg',
          wide ? 'inset-x-0' : 'w-max max-w-[min(20rem,calc(100vw-2rem))]',
          align === 'end' ? 'right-0' : 'left-0',
        )}
      >
        {tabs.map((t) => (
          <li key={key(t)}>
            <TabLink
              tab={t}
              onChoose={close}
              className="flex min-h-11 items-center rounded-control px-3 text-sm text-ink hover:bg-paper-alt aria-[current=page]:font-semibold aria-[current=page]:shadow-[inset_3px_0_0_var(--rl-brand)]"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      width="10"
      height="7"
      viewBox="0 0 12 8"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', open && 'rotate-180')}
    >
      <path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
