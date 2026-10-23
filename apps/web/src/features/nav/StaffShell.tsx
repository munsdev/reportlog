/**
 * THE STAFF AREA'S FRAME: what a signed-in staff person sees on a staff
 * page, in place of the public header and menu. An app's frame, like a
 * hosting dashboard's: a slim top bar, a sidebar of the areas, and a wide
 * content column.
 *
 *   - The TOP BAR: the site's wordmark, "View the public site", and the
 *     account menu (who is signed in, their account pages, Sign out).
 *   - The SIDEBAR lists every staff page this person may open, grouped by
 *     area, from `entries.ts` and nothing else, so it offers exactly what the
 *     public menu used to. The pages that were an area's tabs are its entries
 *     here, so a staff page no longer draws a row of area tabs. The current
 *     page is marked with `aria-current`; the queue carries its waiting count.
 *   - Below 768px the sidebar is a DRAWER behind the "Staff menu" button in
 *     the top bar: focus moves in and stays in, Escape closes it, and focus
 *     goes back to the button. It closes when the address changes.
 *   - The CONTENT is as wide as the window allows up to 75rem, not the public
 *     theme's page width: tables and queues need the room.
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
import { useCallback, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
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
import { usePhone, useWaiting, waitingWords } from './waiting.ts';
import { Wordmark } from './Wordmark.tsx';

const DRAWER_ID = 'staff-drawer';
const ACCOUNT_ID = 'staff-account';
const ON_DEEP_FOCUS = 'focus-visible:outline-on-deep';

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
  const phone = usePhone();
  // Open AT an address, as the site menu is: moving closes it, Back included.
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const drawerOpen = phone && drawerAt === pathname;
  const drawerButton = useRef<HTMLButtonElement>(null);
  const closeDrawer = useCallback(() => {
    setDrawerAt(null);
  }, []);

  return (
    <div data-staff-app className="flex min-h-dvh flex-col bg-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-card focus:bg-surface focus:p-2"
      >
        Skip to the content
      </a>
      <header className="sticky top-0 z-40 bg-deep text-on-deep print:hidden">
        <div className="flex h-12 items-center gap-2 pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] md:gap-4 md:px-5">
          <Wordmark />
          <span className="hidden shrink-0 rounded-control border border-line-on-deep px-1.5 py-0.5 label-face text-[0.6875rem] text-on-deep-muted sm:inline">
            Staff
          </span>
          <div className="flex-1" />
          <Link
            to="/"
            className={cn(
              'hidden min-h-11 shrink-0 items-center px-2 text-sm text-on-deep underline-offset-4 hover:underline md:inline-flex',
              ON_DEEP_FOCUS,
            )}
          >
            View the public site
          </Link>
          {me ? <AccountMenu me={me} pathname={pathname} /> : null}
          {phone ? (
            <button
              ref={drawerButton}
              type="button"
              aria-expanded={drawerOpen}
              aria-controls={DRAWER_ID}
              onClick={() => {
                setDrawerAt(drawerOpen ? null : pathname);
              }}
              className={cn(
                '-mr-1 inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control px-2.5 label-face text-sm text-on-deep hover:bg-deeper',
                drawerOpen && 'bg-deeper',
                ON_DEEP_FOCUS,
              )}
            >
              Staff menu
              <svg width="18" height="12" viewBox="0 0 20 14" aria-hidden="true" focusable="false">
                <path d="M0 1h20M0 7h20M0 13h20" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          ) : null}
        </div>
        <div aria-hidden="true" className="h-1 bg-brand-on-deep" />
      </header>
      <PauseBanner />
      <div className="flex min-w-0 flex-1">
        {phone ? null : (
          <aside className="sticky top-[3.25rem] h-[calc(100dvh-3.25rem)] w-60 shrink-0 overflow-y-auto overscroll-contain border-r border-line bg-surface print:hidden lg:w-64">
            <StaffSidebar me={me} waiting={waiting} pathname={pathname} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <main
            id="main"
            className="mx-auto w-full max-w-[75rem] min-w-0 flex-1 pt-6 pr-[max(1rem,env(safe-area-inset-right))] pb-16 pl-[max(1rem,env(safe-area-inset-left))] md:px-8 md:pt-8"
          >
            {children}
          </main>
          <SiteFooter />
        </div>
      </div>
      {drawerOpen ? (
        <Drawer button={drawerButton} onClose={closeDrawer}>
          <StaffSidebar me={me} waiting={waiting} pathname={pathname} onChoose={closeDrawer} />
          <div className="border-t border-line px-3 py-3">
            <Link to="/" onClick={closeDrawer} className={SIDE_LINK}>
              View the public site
            </Link>
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}

// ── the sidebar ─────────────────────────────────────────────────────────

const SIDE_LINK = cn(
  'flex min-h-10 items-center justify-between gap-2 rounded-control px-3 text-sm text-ink-alt hover:bg-paper-alt hover:text-ink',
  'aria-[current=page]:bg-paper-alt aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-[inset_3px_0_0_var(--rl-brand)]',
);

/** Every staff page this person may open, by area, then the groups outside the areas. */
export function StaffSidebar({
  me,
  waiting,
  pathname,
  onChoose,
}: {
  me: SignedInMe | null;
  waiting: MenuWaiting | undefined;
  pathname: string;
  onChoose?: () => void;
}) {
  const here = entryAt(pathname);
  const sections = me ? [...areasFor(me), ...groupsFor(me)] : [];
  return (
    <nav aria-label="Staff areas" className="px-3 py-4">
      {me ? null : <p className="px-3 text-sm text-muted">Loading…</p>}
      <ul className="flex flex-col gap-4">
        {sections.map((section) => (
          <li key={section.id} className="border-t-2 border-line pt-4 first:border-t-0 first:pt-0">
            {/* A label naming its list, not a heading: the page's own
                headings stay the only ones a reader jumps between there.
                Full size and in the ink colour, with a rule above each
                group: at 11px in the muted grey the groups ran together
                and the labels read as decoration. */}
            <p id={`staff-area-${section.id}`} className="mb-1.5 px-3 label-face text-sm text-ink">
              {section.label}
            </p>
            <ul aria-labelledby={`staff-area-${section.id}`} className="flex flex-col gap-0.5">
              {section.pages.map((p) => (
                <li key={`${p.to}#${p.hash ?? ''}`}>
                  <SideLink entry={p} here={here === p} waiting={waiting} onChoose={onChoose} />
                </li>
              ))}
              {me && section.id === 'work' ? (
                <BugLink
                  me={me}
                  pathname={pathname}
                  onChoose={onChoose ?? noop}
                  className={SIDE_LINK}
                />
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const noop = () => undefined;

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
      className={SIDE_LINK}
    >
      <span className="min-w-0">{entry.label}</span>
      {n && entry.waiting ? (
        <Count value={n} label={`, ${waitingWords(entry.waiting, n)}`} />
      ) : null}
    </Link>
  );
}

// ── the phone's drawer ──────────────────────────────────────────────────

function Drawer({
  button,
  onClose,
  children,
}: {
  button: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  usePopup({ open: true, onClose, button, panel, trap: true });
  useNoScroll(true);
  return (
    <>
      {/* The page behind, dimmed; a press on it closes the drawer (usePopup). */}
      <div
        aria-hidden="true"
        className="fixed inset-x-0 top-[3.25rem] bottom-0 z-30 bg-deeper/55 print:hidden"
      />
      <div
        ref={panel}
        id={DRAWER_ID}
        className="fixed top-[3.25rem] bottom-0 left-0 z-40 w-[min(20rem,85vw)] overflow-y-auto overscroll-contain border-r border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-lg print:hidden"
      >
        {children}
      </div>
    </>
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
          'inline-flex min-h-11 max-w-[14rem] items-center gap-2 rounded-control px-2 text-sm text-on-deep hover:bg-deeper',
          open && 'bg-deeper',
          ON_DEEP_FOCUS,
        )}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-on-deep font-label text-xs font-bold text-deep uppercase"
        >
          {me.email.slice(0, 1)}
        </span>
        <span className="sr-only">Account: </span>
        <span className="hidden truncate lg:inline">{me.email}</span>
        <span className="sr-only lg:hidden">{me.email}</span>
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
          <li className="md:hidden">
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
