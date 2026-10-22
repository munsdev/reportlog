/**
 * What the Menu button opens (docs/design/navigation.md, sections 02 to 04):
 * on a desktop a PANEL under the bar with three rows (this site, staff, you);
 * below 768px a SHEET filling the screen under the bar, whose staff areas
 * fold. Both list the same links, from the same lists, for the same person.
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
import { Link, useMatches, useNavigate, useRouter } from '@tanstack/react-router';
import type { LinkProps } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Count } from '@/components/ui/count.tsx';
import { call } from '@/lib/api.ts';
import { cn } from '@/lib/utils.ts';
import type { SignedInMe } from '../identity/session.ts';
import { useSignOut } from '../identity/session.ts';
import { areaAt, areasFor, entryAt, groupsFor } from '../staff-nav/entries.ts';
import type { StaffArea, StaffEntry } from '../staff-nav/entries.ts';
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

/** A staff page's link: "you are here" by entries.ts's rule, and its waiting total. */
function PageLink({
  entry,
  here,
  waiting,
  onChoose,
  className,
}: {
  entry: StaffEntry;
  here: boolean;
  waiting: MenuWaiting | undefined;
  onChoose: () => void;
  className?: string;
}) {
  const n = entry.waiting ? waiting?.[entry.waiting] : undefined;
  return (
    <Link
      to={entry.to}
      {...(entry.hash ? { hash: entry.hash } : {})}
      // Exact, so the router marks only what entries.ts would; a report's
      // own page is marked as the queue by `aria-current` below.
      activeOptions={{ exact: true, includeSearch: false, includeHash: Boolean(entry.hash) }}
      aria-current={here ? 'page' : undefined}
      onClick={onChoose}
      className={cn(
        'flex min-h-11 items-center justify-between gap-2 rounded-control px-2 text-[0.9375rem] text-on-deep hover:bg-deep',
        'aria-[current=page]:bg-deep aria-[current=page]:font-semibold aria-[current=page]:shadow-[inset_3px_0_0_var(--rl-brand-on-deep)]',
        ON_DEEP_FOCUS,
        className,
      )}
    >
      <span>{entry.label}</span>
      {n && entry.waiting ? (
        <Count tone="onDeep" value={n} label={`, ${waitingWords(entry.waiting, n)}`} />
      ) : null}
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
function AccountLinks({
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

/** The "You" row's work links: the groups outside the areas, and the bug link. */
function WorkLinks({
  me,
  waiting,
  pathname,
  onChoose,
  linkClass,
  pageClass,
  labelled,
}: {
  me: SignedInMe;
  waiting: MenuWaiting | undefined;
  pathname: string;
  onChoose: () => void;
  linkClass: string;
  pageClass?: string;
  labelled: boolean;
}) {
  const routeId = useHereRouteId();
  const here = entryAt(pathname);
  const groups = groupsFor(me);
  const bugs = groups.some((g) => g.pages.some((p) => p.to === '/feedback'));
  return (
    <>
      {groups.map((g) => (
        <li key={g.id}>
          {labelled || g.id === 'organization' ? (
            <h3 className="label-face pt-3 text-[0.6875rem] text-on-deep-muted">{g.label}</h3>
          ) : null}
          <ul className={cn(!labelled && g.id !== 'organization' && 'flex flex-wrap gap-x-6')}>
            {g.pages.map((p) => (
              <li key={p.to}>
                <PageLink
                  entry={p}
                  here={here === p}
                  waiting={waiting}
                  onChoose={onChoose}
                  className={pageClass ?? linkClass}
                />
              </li>
            ))}
            {bugs && g.id === 'work' && pathname !== '/feedback' ? (
              <li>
                <Link
                  to="/feedback"
                  {...(routeId ? { search: { from: routeId } } : {})}
                  activeOptions={{ exact: true, includeSearch: true }}
                  onClick={onChoose}
                  className={cn(
                    'flex min-h-11 items-center rounded-control px-2 text-[0.9375rem] text-on-deep hover:bg-deep',
                    ON_DEEP_FOCUS,
                    pageClass,
                  )}
                >
                  Report a bug on this page
                </Link>
              </li>
            ) : null}
          </ul>
        </li>
      ))}
    </>
  );
}

// ── the desktop panel ───────────────────────────────────────────────────

export function MenuPanel({ me, waiting, pathname, onChoose }: MenuProps) {
  const here = entryAt(pathname);
  const areas = me ? areasFor(me) : [];
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

      {areas.length ? (
        <section aria-labelledby="menu-staff" className="pt-5">
          <h2 id="menu-staff" className="label-face mb-2 text-[0.6875rem] text-on-deep-muted">
            Staff
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-x-8 gap-y-6">
            {areas.map((a) => (
              <AreaColumn key={a.id} area={a} here={here} waiting={waiting} onChoose={onChoose} />
            ))}
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="menu-you"
        className={cn(
          'flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 pb-3',
          // One rule between rows: under row 1, and over this one only
          // when the staff row stands between them.
          areas.length > 0 && 'mt-5 border-t border-line-on-deep',
        )}
      >
        <h2 id="menu-you" className="sr-only">
          You
        </h2>
        {me ? (
          <>
            <ul className="flex flex-wrap items-center gap-x-6">
              <AccountLinks me={me} onChoose={onChoose} className={YOU_LINK} />
            </ul>
            <ul className="flex flex-wrap items-center gap-x-6">
              <WorkLinks
                me={me}
                waiting={waiting}
                pathname={pathname}
                onChoose={onChoose}
                linkClass={YOU_LINK}
                pageClass={cn(YOU_LINK, 'px-0 hover:bg-transparent')}
                labelled={false}
              />
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

function AreaColumn({
  area,
  here,
  waiting,
  onChoose,
}: {
  area: StaffArea;
  here: StaffEntry | null;
  waiting: MenuWaiting | undefined;
  onChoose: () => void;
}) {
  const first = area.pages[0];
  if (!first) return null;
  return (
    <div>
      <h3>
        <AreaHeadingLink
          entry={first}
          onChoose={onChoose}
          className={cn(
            'mb-1.5 flex min-h-11 items-center border-b-2 border-brand-on-deep label-face text-[0.8125rem] text-on-deep',
            ON_DEEP_FOCUS,
          )}
        >
          {area.label}
        </AreaHeadingLink>
      </h3>
      <ul>
        {area.pages.map((p) => (
          <li key={`${p.to}#${p.hash ?? ''}`}>
            <PageLink
              entry={p}
              here={here === p}
              waiting={waiting}
              onChoose={onChoose}
              className="-mx-2"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The way into an area, as a plain link the router follows. Not the
 * router's <Link>, which would mark it as the current page whenever its
 * first page is: "you are here" is said once, by the page's own link under
 * it, so a reader never hears it twice.
 */
function AreaHeadingLink({
  entry,
  onChoose,
  className,
  children,
}: {
  entry: StaffEntry;
  onChoose: () => void;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const to = { to: entry.to, ...(entry.hash ? { hash: entry.hash } : {}) };
  return (
    <a
      href={router.buildLocation(to).href}
      className={className}
      onClick={(e) => {
        // A new tab or window is the browser's to open, as with any link.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void router.navigate(to);
        onChoose();
      }}
    >
      {children}
    </a>
  );
}

// ── the phone sheet ─────────────────────────────────────────────────────

export function MenuSheet({ me, waiting, pathname, onChoose }: MenuProps) {
  const here = entryAt(pathname);
  const areas = me ? areasFor(me) : [];
  const current = areaAt(pathname);
  // The area holding this page starts open; opening one closes no other.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(current ? [current.id] : []));
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

      {areas.length ? (
        <section aria-labelledby="menu-staff">
          <SheetHeading id="menu-staff">Staff</SheetHeading>
          <ul className="border-t border-line-on-deep">
            {areas.map((a) => {
              const isOpen = open.has(a.id);
              const panel = `menu-area-${a.id}`;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panel}
                    className={cn(ITEM, isOpen && 'border-b-transparent')}
                    onClick={() => {
                      setOpen((was) => {
                        const next = new Set(was);
                        if (next.has(a.id)) next.delete(a.id);
                        else next.add(a.id);
                        return next;
                      });
                    }}
                  >
                    {a.label}
                    <svg
                      width="12"
                      height="8"
                      viewBox="0 0 12 8"
                      aria-hidden="true"
                      focusable="false"
                      className={cn('shrink-0', isOpen && 'rotate-180')}
                    >
                      <path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </button>
                  <ul
                    id={panel}
                    hidden={!isOpen}
                    className="border-b border-line-on-deep bg-deep py-1"
                  >
                    {a.pages.map((p) => (
                      <li key={`${p.to}#${p.hash ?? ''}`}>
                        <PageLink
                          entry={p}
                          here={here === p}
                          waiting={waiting}
                          onChoose={onChoose}
                          className="rounded-none pr-5 pl-9"
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {me ? (
        <>
          <ul aria-label="Your work">
            <WorkLinks
              me={me}
              waiting={waiting}
              pathname={pathname}
              onChoose={onChoose}
              linkClass={ITEM}
              pageClass={cn(ITEM, 'rounded-none px-5 text-base')}
              labelled
            />
          </ul>
          <section aria-labelledby="menu-you">
            <SheetHeading id="menu-you">Your account</SheetHeading>
            <ul className="border-t border-line-on-deep">
              <AccountLinks me={me} onChoose={onChoose} className={ITEM} />
            </ul>
            <div className="flex flex-wrap items-end justify-between gap-3 px-[max(1.25rem,env(safe-area-inset-left))] pt-5">
              <SignedInAs email={me.email} />
              <SignOutButton onChoose={onChoose} />
            </div>
          </section>
        </>
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
