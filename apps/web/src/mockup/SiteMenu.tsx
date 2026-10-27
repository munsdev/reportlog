/**
 * The menu dialog (`.menu`), as the mock-up draws it: the wordmark and CLOSE,
 * the site's accounts as round icons, the main list, the second list, and a
 * foot with Easier reading and Sign in. It is a full-screen sheet over the
 * page; the `open` attribute is what shows it (site.css).
 *
 * What the mock-up leaves to a signed-in person is added to the second list
 * and the foot, in the same markup: the dashboard (with the reports waiting
 * for a moderator), the person's own pages, "Report a bug on this page" for
 * those the tracker admits, and Sign out.
 */
import { DIRECTORY_NAME, SOCIAL_RULES } from '@reportlog/contracts';
import type { MenuWaiting } from '@reportlog/contracts';
import { Link, useMatches, useNavigate } from '@tanstack/react-router';
import type { ReactNode, Ref } from 'react';
import { Count } from '@/components/ui/count.tsx';
import { useFollow } from '@/features/follow/useFollow.ts';
import type { SignedInMe } from '@/features/identity/session.ts';
import { useSignOut } from '@/features/identity/session.ts';
import { waitingWords } from '@/features/nav/waiting.ts';
import { entriesFor } from '@/features/staff-nav/entries.ts';
import { EasierReadingButton } from './EasierReading.tsx';
import { SocialMark } from './SocialMark.tsx';
import { Wordmark } from './Wordmark.tsx';

/** The main links, here and in the header. */
export const MAIN_LINKS = [
  { to: '/board', label: 'Reports' },
  { to: '/about', label: 'About' },
  { to: '/get-involved', label: 'Get involved' },
  { to: '/journalists', label: 'For journalists' },
] as const;

/** Whether a link is the page being read: itself, or a page inside it. */
export const isHere = (pathname: string, to: string): boolean =>
  pathname === to || pathname.startsWith(`${to}/`);

const GHOST = {
  '--bb': 'transparent',
  '--bf': '#fff',
  borderColor: '#A9B6C2',
  boxShadow: 'none',
} as React.CSSProperties;

export function SiteMenu({
  open,
  me,
  waiting,
  pathname,
  mainAction,
  closeRef,
  panelRef,
  onClose,
  onChoose,
}: {
  open: boolean;
  me: SignedInMe | null;
  waiting: MenuWaiting | undefined;
  pathname: string;
  mainAction: ReactNode;
  closeRef: Ref<HTMLButtonElement>;
  panelRef: Ref<HTMLDivElement>;
  onClose: () => void;
  onChoose: () => void;
}) {
  const { links, name } = useFollow('menu');
  const navigate = useNavigate();
  const out = useSignOut();
  const routeId = useMatches().at(-1)?.routeId;
  const bugs = me ? entriesFor(me).some((p) => p.to === '/feedback') : false;
  const here = (to: string) => (isHere(pathname, to) ? ({ 'aria-current': 'page' } as const) : {});
  const reports = waiting?.reports;
  return (
    <div
      ref={panelRef}
      className="menu"
      id="menu"
      role="dialog"
      aria-modal="true"
      aria-label="Site menu"
      {...(open ? { open: true } : {})}
    >
      <div className="wrap">
        <div className="menu-top">
          <Wordmark onClick={onChoose} />
          <button
            className="menu-btn"
            type="button"
            id="menu-close"
            ref={closeRef}
            onClick={onClose}
          >
            CLOSE
          </button>
        </div>
        {links.length ? (
          <div className="menu-follow" aria-label={`Follow ${name}`}>
            {links.map((l) => (
              <a
                key={l.id}
                href={l.url}
                rel="me noopener noreferrer"
                referrerPolicy="no-referrer"
                data-social={l.id}
                aria-label={`${name} on ${SOCIAL_RULES[l.id].name}`}
              >
                <SocialMark platform={l.id} />
              </a>
            ))}
          </div>
        ) : (
          <div className="menu-follow" />
        )}
        <nav className="menu-main" aria-label="Menu">
          <ul className="menu-list">
            <li>{mainAction}</li>
            {MAIN_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} onClick={onChoose} {...here(l.to)}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav className="menu-second" aria-label="More">
          <ul className="menu-list second">
            <li>
              <Link to="/how" onClick={onChoose} {...here('/how')}>
                How it works
              </Link>
            </li>
            <li>
              <Link to="/verify" onClick={onChoose} {...here('/verify')}>
                Check a report
              </Link>
            </li>
            <li>
              {/* The chooser lives here: the main button goes straight to the logbook. */}
              <Link to="/submit" onClick={onChoose} {...here('/submit')}>
                Send a tip or offer to help
              </Link>
            </li>
            <li>
              <Link to="/organizations" onClick={onChoose} {...here('/organizations')}>
                {DIRECTORY_NAME}
              </Link>
            </li>
            {me ? (
              <>
                <li>
                  <Link to="/home" onClick={onChoose} {...here('/home')}>
                    Your dashboard
                    {reports ? (
                      <Count
                        tone="onDeep"
                        value={reports}
                        label={`, ${waitingWords('reports', reports)}`}
                        className="ml-3"
                      />
                    ) : null}
                  </Link>
                </li>
                <li>
                  <Link to="/mine" onClick={onChoose} {...here('/mine')}>
                    My reports
                  </Link>
                </li>
                <li>
                  <Link to="/notifications" onClick={onChoose} {...here('/notifications')}>
                    Email updates
                  </Link>
                </li>
                <li>
                  <Link to="/access" onClick={onChoose} {...here('/access')}>
                    Your account
                  </Link>
                </li>
                {/* Role holders' second factor, on the role they HOLD so that somebody who has not proved one yet can find it. */}
                {me.heldRoles.length ? (
                  <li>
                    <Link to="/access/security" onClick={onChoose} {...here('/access/security')}>
                      Account and security
                    </Link>
                  </li>
                ) : null}
                {bugs && pathname !== '/feedback' ? (
                  <li>
                    <Link
                      to="/feedback"
                      {...(routeId ? { search: { from: routeId } } : {})}
                      onClick={onChoose}
                    >
                      Report a bug on this page
                    </Link>
                  </li>
                ) : null}
              </>
            ) : null}
          </ul>
        </nav>
        <div className="menu-foot">
          <EasierReadingButton className="btn sm flat ghost" style={GHOST} />
          {me ? (
            <>
              <span className="mono" style={{ color: 'var(--on-chrome-muted)', fontSize: '.8rem' }}>
                Signed in as {me.email}
              </span>
              <button
                className="btn sm flat ghost"
                type="button"
                style={GHOST}
                disabled={out.isPending}
                onClick={() => {
                  out.mutate(undefined, {
                    onSuccess: () => {
                      onChoose();
                      void navigate({ to: '/' });
                    },
                  });
                }}
              >
                {out.isPending ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : (
            <Link
              className="btn sm flat ghost"
              style={GHOST}
              to="/access/sign-in"
              onClick={onChoose}
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
