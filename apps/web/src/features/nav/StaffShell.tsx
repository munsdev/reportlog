/**
 * THE STAFF AREA'S FRAME: what a signed-in staff person sees on a staff
 * page, in place of the public header and menu. An app's frame, like a
 * hosting dashboard's: a slim top bar, a sidebar of the areas, and a wide
 * content column.
 *
 *   - The TOP BAR (docs/ui-mockup, `staff_chrome`): the site's wordmark, a
 *     Staff badge, "View the public site", the account chip (who is signed
 *     in, their account pages, Sign out) and, below 900px, Menu.
 *   - The SIDEBAR lists every staff page this person may open, grouped by
 *     area, from `entries.ts` and nothing else, so it offers exactly what the
 *     public menu used to. The pages that were an area's tabs are its entries
 *     here, so a staff page no longer draws a row of area tabs. The current
 *     page is marked with `aria-current`; the queue carries its waiting count.
 *   - Below 900px (the mock-up's breakpoint, not the public menu's 768) the
 *     sidebar is a full-screen DRAWER behind the "Menu" button in the top
 *     bar, with its own Close button, "View the public site" and Sign out:
 *     focus moves in and stays in, Escape closes it, and focus goes back to
 *     the button. It closes when the address changes.
 *   - The CONTENT is a column beside a 240px sidebar, in a page 1240px wide
 *     at most (the mock-up's `body.staff`), not the public theme's width.
 *
 * It follows the chosen look through the same tokens as every page (deep
 * ground for the bar, surface for the sidebar, the look's radius and faces),
 * with fewer heavy rules than the public pages.
 *
 * NEVER ON A DOOR: the root draws this only past the password, because it
 * asks who is signed in (CLAUDE.md, "A door page calls only the calls named
 * in front of the password"). Who may open each page is still each route's
 * own guard (`StaffOnly`, `OnlyFor`); this decides only what is offered.
 */
import type { MenuWaiting } from '@reportlog/contracts';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Count } from '@/components/ui/count.tsx';
import { SiteFooter } from '@/components/ui/site-footer.tsx';
import { cn } from '@/lib/utils.ts';
import { PauseBanner } from '../flood/IntakePaused.tsx';
import type { SignedInMe } from '../identity/session.ts';
import { rolesLabel, useSignOut } from '../identity/session.ts';
import { areasFor, entryAt, groupsFor } from '../staff-nav/entries.ts';
import type { StaffEntry } from '../staff-nav/entries.ts';
import { AccountLinks, BugLink } from './Menu.tsx';
import { usePopup, useNoScroll } from './popup.ts';
import { useWaiting, waitingWords } from './waiting.ts';
import { Wordmark } from './Wordmark.tsx';

const DRAWER_ID = 'staff-drawer';
const ACCOUNT_ID = 'staff-account';
const ON_DEEP_FOCUS = 'focus-visible:outline-on-deep';

/** Wide enough for the sidebar beside the page: the mock-up's 900px. */
const NARROW = '(max-width: 899.98px)';
const noop = () => undefined;
function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return noop;
  const list = window.matchMedia(NARROW);
  list.addEventListener('change', onChange);
  return () => {
    list.removeEventListener('change', onChange);
  };
}
const isNarrow = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(NARROW).matches;
/** Whether the sidebar is a drawer (below 900px) instead of a column. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
}

export function StaffShell({
  me,
  children,
}: {
  /** Who is signed in; `null` while that is still being asked. */
  me: SignedInMe | null;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const waiting = useWaiting(me ?? undefined);
  const narrow = useNarrow();
  // Open AT an address, as the site menu is: moving closes it, Back included.
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const drawerOpen = narrow && drawerAt === pathname;
  const drawerButton = useRef<HTMLButtonElement>(null);
  const closeDrawer = useCallback(() => {
    setDrawerAt(null);
  }, []);
  // Focus goes back to the Menu button whenever the drawer goes, however it
  // went (Close, Escape, a link): the drawer covers the button while open,
  // so usePopup cannot be given it as its own button.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !drawerOpen) drawerButton.current?.focus();
    wasOpen.current = drawerOpen;
  }, [drawerOpen]);

  return (
    <div data-staff-app className="flex min-h-dvh flex-col bg-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-card focus:bg-surface focus:p-2"
      >
        Skip to the content
      </a>
      <header className="sticky top-0 z-40 border-b border-line-on-deep bg-deep text-on-deep print:hidden">
        <div className="mx-auto flex min-h-16 w-full max-w-[77.5rem] items-center justify-between gap-2.5 py-2 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
          <div className="flex min-w-0 items-center gap-2.5">
            <Wordmark />
            <span className="shrink-0 rounded-control bg-brand-on-deep px-2 py-0.5 font-mono text-[0.68rem] tracking-[0.12em] text-deep uppercase">
              {me?.heldRoles.length === 0 ? 'Account' : 'Staff'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/"
              className={cn(
                'hidden min-h-11 items-center px-2 text-sm font-semibold text-on-deep-muted hover:text-on-deep min-[900px]:inline-flex',
                ON_DEEP_FOCUS,
              )}
            >
              View the public site
            </Link>
            {me ? <AccountMenu me={me} pathname={pathname} /> : null}
            {narrow ? (
              <button
                ref={drawerButton}
                type="button"
                aria-expanded={drawerOpen}
                aria-controls={DRAWER_ID}
                onClick={() => {
                  setDrawerAt(pathname);
                }}
                className={cn(
                  'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control border-2 border-on-deep-muted px-3 font-mono text-xs tracking-[0.12em] text-on-deep uppercase hover:border-on-deep',
                  ON_DEEP_FOCUS,
                )}
              >
                Menu
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <PauseBanner />
      <div className="mx-auto grid w-full max-w-[77.5rem] min-w-0 flex-1 items-start gap-7 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] min-[900px]:grid-cols-[240px_minmax(0,1fr)]">
        {narrow ? null : (
          <aside className="sticky top-[76px] max-h-[calc(100dvh-92px)] overflow-y-auto overscroll-contain py-[22px] pb-8 print:hidden">
            <StaffSidebar me={me} waiting={waiting} pathname={pathname} />
          </aside>
        )}
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 pt-6 pb-10 outline-none min-[900px]:pt-[22px]"
        >
          {children}
        </main>
      </div>
      <SiteFooter />
      {drawerOpen ? (
        <Drawer onClose={closeDrawer}>
          <StaffSidebar
            me={me}
            waiting={waiting}
            pathname={pathname}
            onChoose={closeDrawer}
            tone="drawer"
          />
        </Drawer>
      ) : null}
    </div>
  );
}

// ── the sidebar ─────────────────────────────────────────────────────────

const SIDE_LINK = cn(
  'flex min-h-[2.375rem] items-center justify-between gap-2 rounded-control px-2.5 text-[0.92rem] text-ink hover:bg-paper-alt',
  'aria-[current=page]:bg-paper-alt aria-[current=page]:font-bold aria-[current=page]:shadow-[inset_3px_0_0_var(--rl-text)]',
);
const DRAWER_LINK = cn(
  'flex min-h-11 items-center justify-between gap-2 rounded-control px-2.5 text-[0.95rem] text-on-deep hover:bg-deeper',
  'aria-[current=page]:bg-deeper aria-[current=page]:font-bold aria-[current=page]:shadow-[inset_3px_0_0_var(--rl-brand-on-deep)]',
  ON_DEEP_FOCUS,
);

/** Every staff page this person may open, by group, in the mock-up's order. */
export function StaffSidebar({
  me,
  waiting,
  pathname,
  onChoose,
  tone = 'side',
}: {
  me: SignedInMe | null;
  waiting: MenuWaiting | undefined;
  pathname: string;
  onChoose?: () => void;
  tone?: 'side' | 'drawer';
}) {
  const here = entryAt(pathname);
  // An alias (the site password's second address) is never "here" itself.
  const drawer = tone === 'drawer';
  const sections = me ? [...groupsFor(me), ...areasFor(me)] : [];
  return (
    <nav aria-label="Your pages">
      {me ? null : <p className="px-3 text-sm text-muted">Loading…</p>}
      <ul
        className={cn(
          'flex flex-col',
          drawer && 'min-[700px]:grid min-[700px]:grid-cols-2 min-[700px]:gap-x-6',
        )}
      >
        {sections.map((section) => (
          <li
            key={section.id}
            className={cn(
              'border-t py-2.5 first:border-t-0 first:pt-0',
              drawer ? 'border-line-on-deep' : 'border-line',
              drawer && 'min-[700px]:[&:nth-child(2)]:border-t-0 min-[700px]:[&:nth-child(2)]:pt-0',
            )}
          >
            {/* A label naming its list, not a heading: the page's own
                headings stay the only ones a reader jumps between there. */}
            <p
              id={`staff-area-${section.id}${drawer ? '-d' : ''}`}
              className={cn(
                'mb-1 px-2.5 font-mono text-[0.68rem] font-medium tracking-[0.12em] uppercase',
                drawer ? 'text-on-deep-muted' : 'text-muted',
              )}
            >
              {section.label}
            </p>
            <ul
              aria-labelledby={`staff-area-${section.id}${drawer ? '-d' : ''}`}
              className="flex flex-col"
            >
              {section.pages.map((p) => (
                <li key={`${p.to}#${p.hash ?? ''}`}>
                  <SideLink
                    entry={p}
                    here={here === p}
                    waiting={waiting}
                    onChoose={onChoose}
                    drawer={drawer}
                  />
                </li>
              ))}
              {me && section.id === 'help' ? (
                <BugLink
                  me={me}
                  pathname={pathname}
                  onChoose={onChoose ?? noop}
                  className={drawer ? DRAWER_LINK : SIDE_LINK}
                />
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SideLink({
  entry,
  here,
  waiting,
  onChoose,
  drawer,
}: {
  entry: StaffEntry;
  here: boolean;
  waiting: MenuWaiting | undefined;
  onChoose: (() => void) | undefined;
  drawer: boolean;
}) {
  const n = entry.waiting ? waiting?.[entry.waiting] : undefined;
  return (
    <Link
      to={entry.to}
      {...(entry.hash ? { hash: entry.hash } : {})}
      // Marked by entries.ts's rule below, never by the router's guess: a
      // report's own page is the queue's, and one page is "here", once.
      activeOptions={{ exact: true, includeSearch: false, includeHash: Boolean(entry.hash) }}
      activeProps={{}}
      aria-current={here ? 'page' : undefined}
      onClick={onChoose}
      className={drawer ? DRAWER_LINK : SIDE_LINK}
    >
      <span className="min-w-0">{entry.label}</span>
      {n && entry.waiting ? (
        <Count
          value={n}
          label={`, ${waitingWords(entry.waiting, n)}`}
          className={drawer ? 'bg-on-deep text-deep' : 'bg-ink text-paper'}
        />
      ) : null}
    </Link>
  );
}

// ── the phone's drawer ──────────────────────────────────────────────────

/**
 * Full screen and dark, like the public site's menu (the mock-up's `.menu`):
 * the wordmark and Close above, the groups, then "View the public site" and
 * Sign out. A dialog, so what is behind it is out of reach while it is open.
 */
function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // No opener to put in the Tab ring: the drawer covers it (see StaffShell).
  const none = useRef<HTMLElement>(null);
  usePopup({ open: true, onClose, button: none, panel, trap: true });
  useNoScroll(true);
  const out = useSignOut();
  const navigate = useNavigate();
  return (
    <div
      ref={panel}
      id={DRAWER_ID}
      role="dialog"
      aria-modal="true"
      aria-label="Staff menu"
      className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-deep pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-on-deep print:hidden"
    >
      <div className="mx-auto grid w-full max-w-[77.5rem] gap-5 px-4 pt-3.5 pb-8">
        {/* Close comes first in the page, so it is where focus lands (the
            mock-up does the same), and last in the picture only by `order`. */}
        <div className="flex min-h-16 items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'order-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border-2 border-on-deep-muted px-3 font-mono text-xs tracking-[0.12em] text-on-deep uppercase hover:border-on-deep',
              ON_DEEP_FOCUS,
            )}
          >
            Close
          </button>
          <div className="order-1 min-w-0">
            <Wordmark />
          </div>
        </div>
        {children}
        <div className="flex flex-wrap items-center gap-3 border-t border-line-on-deep pt-4">
          <Link
            to="/"
            onClick={onClose}
            className={cn(
              'inline-flex min-h-11 items-center rounded-control border-2 border-on-deep-muted px-4 text-sm font-semibold text-on-deep hover:border-on-deep',
              ON_DEEP_FOCUS,
            )}
          >
            View the public site
          </Link>
          <button
            type="button"
            disabled={out.isPending}
            onClick={() => {
              out.mutate(undefined, {
                onSuccess: () => {
                  onClose();
                  void navigate({ to: '/' });
                },
              });
            }}
            className={cn(
              'inline-flex min-h-11 items-center rounded-control border-2 border-on-deep-muted px-4 text-sm font-semibold text-on-deep hover:border-on-deep',
              ON_DEEP_FOCUS,
            )}
          >
            {out.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── the account menu ────────────────────────────────────────────────────

const ACCOUNT_LINK =
  'flex min-h-10 w-full items-center rounded-control px-3 text-sm text-ink hover:bg-paper-alt aria-[current=page]:font-semibold';

function AccountMenu({ me, pathname }: { me: SignedInMe; pathname: string }) {
  // Open at an address, so following one of its links closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpenAt(null);
  }, []);
  usePopup({ open, onClose: close, button, panel });
  const out = useSignOut();
  const navigate = useNavigate();
  return (
    <div className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={ACCOUNT_ID}
        onClick={() => {
          setOpenAt(open ? null : pathname);
        }}
        className={cn(
          'inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] border-on-deep-muted px-2.5 text-[0.8rem] font-semibold text-on-deep',
          open && 'bg-deeper',
          ON_DEEP_FOCUS,
        )}
      >
        <span
          aria-hidden="true"
          className="inline-grid size-[1.625rem] shrink-0 place-items-center rounded-full bg-brand-on-deep text-[0.72rem] font-extrabold text-deep uppercase"
        >
          {me.email.slice(0, 1)}
        </span>
        <span className="sr-only">Account: {me.email}</span>
        <span aria-hidden="true" className="max-[520px]:hidden">
          Account
        </span>
      </button>
      <div
        ref={panel}
        id={ACCOUNT_ID}
        hidden={!open}
        className="absolute top-full right-0 z-50 mt-1 w-[min(18rem,calc(100vw-1.5rem))] rounded-card border border-line bg-surface p-2 text-ink shadow-lg"
      >
        <p className="border-b border-line px-3 pt-1 pb-2 text-sm">
          <span className="block text-muted">Signed in as</span>
          <span className="block font-mono break-all">{me.email}</span>
          <span className="block text-muted">{rolesLabel(me.roles)}</span>
        </p>
        <ul className="py-1">
          <li className="min-[900px]:hidden">
            <Link to="/" onClick={close} className={ACCOUNT_LINK}>
              View the public site
            </Link>
          </li>
          <AccountLinks me={me} onChoose={close} className={ACCOUNT_LINK} />
        </ul>
        <div className="border-t border-line px-1 pt-2">
          <Button
            variant="secondary"
            busy={out.isPending}
            busyLabel="Signing out…"
            onClick={() => {
              out.mutate(undefined, {
                onSuccess: () => {
                  close();
                  void navigate({ to: '/' });
                },
              });
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
