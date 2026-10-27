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
 * THE MARKUP IS THE MOCK-UP'S (`staff_chrome`, `sidebar` and `spage` in
 * docs/ui-mockup/src/staff.py) with its class names, styled by
 * mockup/site.css: `site-head staff-head`, `badge-staff`, `nav-public`,
 * `who-chip` (a plain link to the account page), `menu-btn sb-open`, the
 * `.menu` dialog (open by its `open` attribute), `staff-layout`, `sb sb-side`
 * and `sb-g`. One addition the mock-up lacks, the owner's decision: Sign out
 * at the foot of the desktop sidebar too.
 *
 * The account menu this replaces is gone: the chip is one link, and the
 * person's own pages (My reports, Email updates, Signing in) are the sidebar's
 * "You" group.
 *
 * NEVER ON A DOOR: the root draws this only past the password, because it
 * asks who is signed in (CLAUDE.md, "A door page calls only the calls named
 * in front of the password"). Who may open each page is still each route's
 * own guard (`StaffOnly`, `OnlyFor`); this decides only what is offered.
 */
import type { MenuWaiting } from '@reportlog/contracts';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { SiteFooter } from '@/components/ui/site-footer.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { Wordmark } from '@/mockup/Wordmark.tsx';
import { PauseBanner } from '../flood/IntakePaused.tsx';
import type { SignedInMe } from '../identity/session.ts';
import { useSignOut } from '../identity/session.ts';
import { entryAt, sectionsFor } from '../staff-nav/entries.ts';
import type { StaffEntry } from '../staff-nav/entries.ts';
import { BugLink } from './Menu.tsx';
import { usePopup, useNoScroll } from './popup.ts';
import { useWaiting, waitingWords } from './waiting.ts';

const DRAWER_ID = 'menu';

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

/** The mock-up's menu-foot buttons: outlined on the dark ground, no shadow. */
const FOOT_STYLE = {
  '--bb': 'transparent',
  '--bf': '#fff',
  borderColor: '#A9B6C2',
  boxShadow: 'none',
} as CSSProperties;

export function StaffShell({
  me,
  children,
}: {
  /** Who is signed in; `null` while that is still being asked. */
  me: SignedInMe | null;
  children: ReactNode;
}) {
  useBodyClass('light', 'staff');
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
    <div data-staff-app>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-head staff-head print:hidden">
        <div className="wrap">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Wordmark to="/home" />
            <span className="badge-staff">{me?.heldRoles.length === 0 ? 'Account' : 'Staff'}</span>
          </div>
          <div className="head-right">
            <Link className="nav-public" to="/">
              View the public site
            </Link>
            {me ? (
              <Link
                className="who-chip"
                to="/access"
                aria-label={`Your account, ${me.email}`}
                aria-current={pathname === '/access' ? 'page' : undefined}
              >
                <i>{me.email.slice(0, 1)}</i>
                <span>Account</span>
              </Link>
            ) : null}
            <button
              ref={drawerButton}
              className="menu-btn sb-open"
              type="button"
              aria-expanded={drawerOpen}
              aria-controls={DRAWER_ID}
              onClick={() => {
                setDrawerAt(pathname);
              }}
            >
              MENU
            </button>
          </div>
        </div>
      </header>
      <PauseBanner />
      <div className="staff-layout wrap">
        <aside className="sb sb-side print:hidden" aria-label="Staff areas">
          <StaffSidebar me={me} waiting={waiting} pathname={pathname} />
          {me ? <SignOutFoot /> : null}
        </aside>
        <main id="main" tabIndex={-1} className="staff-main">
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
  const sections = me ? sectionsFor(me) : [];
  return (
    <nav className={tone === 'drawer' ? 'sb sb-drawer' : undefined} aria-label="Staff areas">
      {me ? null : <p className="muted">Loading…</p>}
      {sections.map((section) => (
        <div className="sb-g" key={section.id}>
          <h3>{section.label}</h3>
          <ul>
            {section.pages.map((p) => (
              <li key={`${p.to}#${p.hash ?? ''}`}>
                <SideLink entry={p} here={here === p} waiting={waiting} onChoose={onChoose} />
              </li>
            ))}
            {me && section.id === 'help' ? (
              <BugLink me={me} pathname={pathname} onChoose={onChoose ?? noop} className="" />
            ) : null}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SideLink({
  entry,
  here,
  waiting,
  onChoose,
}: {
  entry: StaffEntry;
  here: boolean;
  waiting: MenuWaiting | undefined;
  onChoose: (() => void) | undefined;
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
    >
      {entry.label}
      {n && entry.waiting ? (
        <span className="n">
          <span aria-hidden="true">{n}</span>
          <span className="sr-only">, {waitingWords(entry.waiting, n)}</span>
        </span>
      ) : null}
    </Link>
  );
}

/** Sign out, at the foot of the desktop sidebar (the owner's decision). */
function SignOutFoot() {
  const out = useSignOut();
  const navigate = useNavigate();
  return (
    <div className="sb-g">
      <button
        type="button"
        className="btn sm flat ghost"
        disabled={out.isPending}
        onClick={() => {
          out.mutate(undefined, {
            onSuccess: () => {
              void navigate({ to: '/' });
            },
          });
        }}
      >
        {out.isPending ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

// ── the phone's menu ────────────────────────────────────────────────────

/**
 * The mock-up's `.menu` dialog: the wordmark and Close above, the groups,
 * then "View the public site" and Sign out. `.menu` shows by its `open`
 * attribute. A dialog, so what is behind it is out of reach while it is open.
 */
function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // No opener to put in the Tab ring: the drawer covers it (see StaffShell).
  const none = useRef<HTMLElement>(null);
  usePopup({ open: true, onClose, button: none, panel, trap: true });
  useNoScroll(true);
  const out = useSignOut();
  const navigate = useNavigate();
  // `open` is the stylesheet's switch (`.menu[open]`), not a div attribute
  // React knows. It must be `true`: React drops an empty string for `open`,
  // and the drawer never showed.
  const open = { open: true } as Record<string, boolean>;
  return (
    <div
      ref={panel}
      className="menu print:hidden"
      id={DRAWER_ID}
      role="dialog"
      aria-modal="true"
      aria-label="Staff menu"
      {...open}
    >
      <div className="wrap">
        {/* Close comes first in the page, so it is where focus lands. */}
        <div className="menu-top">
          <Wordmark to="/home" onClick={onClose} />
          <button className="menu-btn" type="button" onClick={onClose}>
            CLOSE
          </button>
        </div>
        {children}
        <div className="menu-foot">
          <Link className="btn sm flat" to="/" style={FOOT_STYLE} onClick={onClose}>
            View the public site
          </Link>
          <button
            className="btn sm flat"
            type="button"
            style={FOOT_STYLE}
            disabled={out.isPending}
            onClick={() => {
              out.mutate(undefined, {
                onSuccess: () => {
                  onClose();
                  void navigate({ to: '/' });
                },
              });
            }}
          >
            {out.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
}
