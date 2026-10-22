/**
 * What the Menu button opens (docs/design/navigation.md, sections 02 to 04):
 * on a desktop a PANEL under the bar with three rows (this site, staff, you);
 * below 768px a SHEET filling the screen under the bar. Both list the same
 * links, from the same lists, for the same person.
 *
 * THE STAFF ROW IS ONE LINK, "Open the staff area", to the first staff page
 * this person may open. The staff pages themselves are listed in the staff
 * area's own sidebar (StaffShell.tsx), not here: the public menu stays the
 * public site's, whoever is reading it.
 *
 * Nothing here decides who may open what: the staff pages come from
 * `entries.ts` (each with its route's own guard), and the account links from
 * who is signed in. Opening the menu asks the server for the front page's
 * first button (for the main action's wording); the waiting totals were
 * already asked by the header.
 */
import { DIRECTORY_NAME, getHomeButtons } from '@reportlog/contracts';
import type { HomeButton, MenuWaiting } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link, useMatches, useNavigate } from '@tanstack/react-router';
import type { LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Count } from '@/components/ui/count.tsx';
import { call } from '@/lib/api.ts';
import { cn } from '@/lib/utils.ts';
import type { SignedInMe } from '../identity/session.ts';
import { useSignOut } from '../identity/session.ts';
import { entriesFor, staffHome } from '../staff-nav/entries.ts';
import { EasierReadingSlot } from './EasierReadingSlot.tsx';
import { waitingWords } from './waiting.ts';

// The same key as the front page's own query, so the two share one answer.
const homeButtonsQuery = queryOptions({
  queryKey: ['home-buttons'],
  queryFn: ({ signal }) => call(getHomeButtons, { signal }),
});

/** On the deep ground every focus ring is the light one. */
const ON_DEEP_FOCUS = 'focus-visible:outline-on-deep';

/**
 * The page's main action: the operator's first front-page button that goes
 * somewhere, or "Submit a report" while it loads, if it cannot be read, or
 * when it is the built-in one under its own name.
 */
export function mainAction(buttons: readonly HomeButton[] | undefined): {
  label: string;
  href: string;
} {
  const first = buttons?.find((b) => b.href);
  if (!first?.href) return { label: 'Submit a report', href: '/submit' };
  if (first.kind === 'builtin' && first.ref === 'submit' && first.label === first.title)
    return { label: 'Submit a report', href: first.href };
  return { label: first.label || first.title, href: first.href };
}

interface MenuProps {
  /** Who is signed in; `null` for a visitor. */
  me: SignedInMe | null;
  waiting: MenuWaiting | undefined;
  pathname: string;
  phone: boolean;
  /** Called when a link is chosen, after the router has been told where to go. */
  onChoose: () => void;
}

export function SiteMenu(props: MenuProps) {
  return (
    <div className="flex flex-1 flex-col bg-deeper text-on-deep">
      <div className="flex-1">
        {props.phone ? <MenuSheet {...props} /> : <MenuPanel {...props} />}
      </div>
      <div aria-hidden="true" className="h-1.5 shrink-0 bg-brand-on-deep" />
    </div>
  );
}

// ── the pieces both shapes share ────────────────────────────────────────

function MainAction({ onChoose, block }: { onChoose: () => void; block: boolean }) {
  const buttons = useQuery(homeButtonsQuery).data?.buttons;
  const { label, href } = mainAction(buttons);
  return (
    <Button asChild size={block ? 'lg' : 'md'} block={block} className={ON_DEEP_FOCUS}>
      {href === '/submit' ? (
        <Link to="/submit" onClick={onChoose}>
          {label}
        </Link>
      ) : (
        <a href={href} onClick={onChoose}>
          {label}
        </a>
      )}
    </Button>
  );
}

const PUBLIC_LINKS: readonly { to: NonNullable<LinkProps['to']>; label: string; hash?: string }[] =
  [
    { to: '/board', label: 'Board' },
    // The front page's "Check a report" until /verify has a page of its own
    // (docs/design/screens/public.md, section 06); then it points there.
    { to: '/', hash: 'check-a-report', label: 'Check a report' },
    { to: '/how', label: 'How to use' },
    { to: '/about', label: 'About' },
    { to: '/organizations', label: DIRECTORY_NAME },
    { to: '/', label: 'Home' },
  ];

function PublicTiles({ onChoose, phone }: { onChoose: () => void; phone: boolean }) {
  return (
    <ul className={cn(phone ? 'grid grid-cols-2 gap-2.5' : 'flex flex-wrap gap-2.5')}>
      {PUBLIC_LINKS.map((l) => (
        <li key={`${l.to}#${l.hash ?? ''}`}>
          <Link
            to={l.to}
            {...(l.hash ? { hash: l.hash } : {})}
            activeOptions={{ exact: true, includeSearch: false, includeHash: true }}
            onClick={onChoose}
            className={cn(
              'flex min-h-11 items-center rounded-control border border-line-on-deep px-3.5 py-1.5 font-label text-[0.9375rem] leading-tight font-semibold text-on-deep hover:bg-deep aria-[current=page]:shadow-[inset_3px_0_0_var(--rl-brand-on-deep)]',
              // Two to a row on a phone: a long name wraps inside its tile.
              phone ? 'h-full' : 'whitespace-nowrap',
              ON_DEEP_FOCUS,
            )}
          >
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The one way from the public site into the staff area, with the reports
 * waiting for a moderator beside it for those the queue admits.
 */
function StaffAreaLink({
  me,
  waiting,
  onChoose,
  className,
}: {
  me: SignedInMe;
  waiting: MenuWaiting | undefined;
  onChoose: () => void;
  className: string;
}) {
  const home = staffHome(me);
  if (!home) return null;
  const n = waiting?.reports;
  return (
    <Link
      to={home.to}
      {...(home.hash ? { hash: home.hash } : {})}
      onClick={onChoose}
      className={className}
    >
      <span>Open the staff area</span>
      {n ? <Count tone="onDeep" value={n} label={`, ${waitingWords('reports', n)}`} /> : null}
    </Link>
  );
}

function useHereRouteId(): string | undefined {
  // Which screen this is, as the router names it: feedback filed from here
  // says where it came from without carrying the address, which can hold a
  // token (an invitation's, say).
  return useMatches().at(-1)?.routeId;
}

function SignOutButton({ onChoose }: { onChoose: () => void }) {
  const out = useSignOut();
  const navigate = useNavigate();
  return (
    <Button
      variant="secondary"
      busy={out.isPending}
      busyLabel="Signing out…"
      className={ON_DEEP_FOCUS}
      onClick={() => {
        out.mutate(undefined, {
          onSuccess: () => {
            onChoose();
            void navigate({ to: '/' });
          },
        });
      }}
    >
      Sign out
    </Button>
  );
}

function SignedInAs({ email }: { email: string }) {
  return (
    <p className="min-w-0 text-sm text-on-deep-muted">
      Signed in as <span className="font-mono break-all text-on-deep">{email}</span>
    </p>
  );
}

const YOU_LINK = cn(
  'inline-flex min-h-11 items-center gap-2 label-face text-xs text-on-deep hover:underline underline-offset-4 aria-[current=page]:underline aria-[current=page]:decoration-brand-on-deep aria-[current=page]:decoration-2',
  ON_DEEP_FOCUS,
);

/** The person's own links: their reports, their email, their account. */
export function AccountLinks({
  me,
  onChoose,
  className,
}: {
  me: SignedInMe;
  onChoose: () => void;
  className: string;
}) {
  const exact = { exact: true, includeSearch: false } as const;
  return (
    <>
      <li>
        <Link to="/mine" activeOptions={exact} onClick={onChoose} className={className}>
          My reports
        </Link>
      </li>
      <li>
        <Link to="/notifications" activeOptions={exact} onClick={onChoose} className={className}>
          Email updates
        </Link>
      </li>
      {/* /access is the account page for everybody; those who grant access
          reach it as "Roles", under People and access. */}
      {me.grantsAccess ? null : (
        <li>
          <Link to="/access" activeOptions={exact} onClick={onChoose} className={className}>
            Your account
          </Link>
        </li>
      )}
      {/* Role holders' second factor. On the role they HOLD, so somebody who
          has not proved one yet (and so acts with no role) can find it. */}
      {me.heldRole === 'user' ? null : (
        <li>
          <Link
            to="/access/security"
            activeOptions={exact}
            onClick={onChoose}
            className={className}
          >
            Account and security
          </Link>
        </li>
      )}
    </>
  );
}

/**
 * "Report a bug on this page", for those the feedback tracker admits. It
 * says which screen it was opened from by the router's name for it.
 */
export function BugLink({
  me,
  pathname,
  onChoose,
  className,
}: {
  me: SignedInMe;
  pathname: string;
  onChoose: () => void;
  className: string;
}) {
  const routeId = useHereRouteId();
  const bugs = entriesFor(me).some((p) => p.to === '/feedback');
  if (!bugs || pathname === '/feedback') return null;
  return (
    <li>
      <Link
        to="/feedback"
        {...(routeId ? { search: { from: routeId } } : {})}
        activeOptions={{ exact: true, includeSearch: true }}
        onClick={onChoose}
        className={className}
      >
        Report a bug on this page
      </Link>
    </li>
  );
}

// ── the desktop panel ───────────────────────────────────────────────────

const STAFF_TILE = cn(
  'inline-flex min-h-11 items-center gap-3 rounded-control border border-line-on-deep px-3.5 py-1.5 font-label text-[0.9375rem] leading-tight font-semibold text-on-deep hover:bg-deep',
  ON_DEEP_FOCUS,
);

export function MenuPanel({ me, waiting, pathname, onChoose }: MenuProps) {
  const staff = me ? staffHome(me) !== null : false;
  return (
    <div className="mx-auto max-w-[76rem] px-[max(1rem,env(safe-area-inset-left))] pt-6 md:px-8">
      <section aria-labelledby="menu-this-site" className="border-b border-line-on-deep pb-5">
        <h2 id="menu-this-site" className="sr-only">
          This site
        </h2>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="mr-2.5">
            <MainAction onChoose={onChoose} block={false} />
          </div>
          <PublicTiles onChoose={onChoose} phone={false} />
        </div>
      </section>

      {me && staff ? (
        <section aria-labelledby="menu-staff" className="pt-5">
          <h2 id="menu-staff" className="label-face mb-2 text-[0.6875rem] text-on-deep-muted">
            Staff
          </h2>
          <StaffAreaLink me={me} waiting={waiting} onChoose={onChoose} className={STAFF_TILE} />
        </section>
      ) : null}

      <section
        aria-labelledby="menu-you"
        className={cn(
          'flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 pb-3',
          // One rule between rows: under row 1, and over this one only
          // when the staff row stands between them.
          staff && 'mt-5 border-t border-line-on-deep',
        )}
      >
        <h2 id="menu-you" className="sr-only">
          You
        </h2>
        {me ? (
          <>
            <ul className="flex flex-wrap items-center gap-x-6">
              <AccountLinks me={me} onChoose={onChoose} className={YOU_LINK} />
              <BugLink me={me} pathname={pathname} onChoose={onChoose} className={YOU_LINK} />
            </ul>
            <div className="ml-auto flex flex-wrap items-center gap-4">
              <SignedInAs email={me.email} />
              <SignOutButton onChoose={onChoose} />
              <EasierReadingSlot where="menu" />
            </div>
          </>
        ) : (
          <>
            <Link to="/access/sign-in" onClick={onChoose} className={YOU_LINK}>
              Sign in
            </Link>
            <div className="ml-auto">
              <EasierReadingSlot where="menu" />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ── the phone sheet ─────────────────────────────────────────────────────

export function MenuSheet({ me, waiting, pathname, onChoose }: MenuProps) {
  const staff = me ? staffHome(me) !== null : false;
  const ITEM = cn(
    'flex min-h-12 w-full items-center justify-between gap-3 border-b border-line-on-deep px-5 font-label text-base font-semibold text-on-deep hover:bg-deep',
    ON_DEEP_FOCUS,
  );
  return (
    <div className="pb-6">
      <section
        aria-labelledby="menu-this-site"
        className="px-[max(1.25rem,env(safe-area-inset-left))] pt-5"
      >
        <h2 id="menu-this-site" className="sr-only">
          This site
        </h2>
        <MainAction onChoose={onChoose} block />
        <div className="pt-5">
          <PublicTiles onChoose={onChoose} phone />
        </div>
      </section>

      {me && staff ? (
        <section aria-labelledby="menu-staff">
          <SheetHeading id="menu-staff">Staff</SheetHeading>
          <div className="border-t border-line-on-deep">
            <StaffAreaLink me={me} waiting={waiting} onChoose={onChoose} className={ITEM} />
          </div>
        </section>
      ) : null}

      {me ? (
        <section aria-labelledby="menu-you">
          <SheetHeading id="menu-you">Your account</SheetHeading>
          <ul className="border-t border-line-on-deep">
            <AccountLinks me={me} onChoose={onChoose} className={ITEM} />
            <BugLink me={me} pathname={pathname} onChoose={onChoose} className={ITEM} />
          </ul>
          <div className="flex flex-wrap items-end justify-between gap-3 px-[max(1.25rem,env(safe-area-inset-left))] pt-5">
            <SignedInAs email={me.email} />
            <SignOutButton onChoose={onChoose} />
          </div>
        </section>
      ) : (
        <section aria-labelledby="menu-you" className="pt-5">
          <h2 id="menu-you" className="sr-only">
            You
          </h2>
          <ul className="border-t border-line-on-deep">
            <li>
              <Link to="/access/sign-in" onClick={onChoose} className={ITEM}>
                Sign in
              </Link>
            </li>
          </ul>
        </section>
      )}
      <div className="px-[max(1.25rem,env(safe-area-inset-left))] pt-4">
        <EasierReadingSlot where="menu" />
      </div>
    </div>
  );
}

function SheetHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="label-face px-[max(1.25rem,env(safe-area-inset-left))] pt-6 pb-2 text-[0.6875rem] text-on-deep-muted"
    >
      {children}
    </h2>
  );
}
