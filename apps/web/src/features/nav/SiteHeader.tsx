/**
 * THE HEADER, as the mock-up draws it (`.site-head`): the wordmark, the main
 * links, the "File a report" button and the MENU box, and, behind MENU, the
 * menu dialog (mockup/SiteMenu.tsx). Markup, classes and order are the
 * mock-up's; what is behind them is the app's.
 *
 * ON A DOOR it is the wordmark alone, and asks nothing. A door page may call
 * only the filing calls; asking who is signed in would be refused there and
 * put the password back. So the part that asks is not even mounted.
 *
 * THE MENU closes on CLOSE, Escape, choosing any link, and when the address
 * changes (Back, say), because it is open AT an address. Focus moves to
 * CLOSE on open, is kept inside the dialog while open, and goes back to MENU
 * on a close the person made. The page behind does not scroll while it is
 * open.
 *
 * "File a report" goes straight to the front page's first button's target
 * (the logbook, as the operator arranged it), not to the chooser, which is in
 * the menu. The mock-up leaves the button out on a filing page (`body.form`,
 * in site.css): one card, one question.
 */
import { Link, useLocation } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Count } from '@/components/ui/count.tsx';
import { MAIN_LINKS, SiteMenu, isHere } from '@/mockup/SiteMenu.tsx';
import { Wordmark } from '@/mockup/Wordmark.tsx';
import { useGateMode } from '../identity/gateMode.ts';
import { useMe } from '../identity/session.ts';
import { useMainAction } from './Menu.tsx';
import { useWaiting, waitingWords } from './waiting.ts';

/** The label the mock-up gives the main button when the operator has not named one. */
function fileLabel(label: string, href: string): string {
  return href === '/submit' && label === 'Submit a report' ? 'File a report' : label;
}

function MainButton({
  className,
  onClick,
  style,
}: {
  className: string;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const { label, href } = useMainAction();
  const text = fileLabel(label, href);
  return href === '/submit' ? (
    <Link
      to="/submit"
      className={className}
      data-file-action
      {...(style ? { style } : {})}
      {...(onClick ? { onClick } : {})}
    >
      {text}
    </Link>
  ) : (
    <a
      href={href}
      className={className}
      data-file-action
      {...(style ? { style } : {})}
      {...(onClick ? { onClick } : {})}
    >
      {text}
    </a>
  );
}

export function SiteHeader() {
  const door = useGateMode() === 'door';
  return door ? (
    <header className="site-head">
      <div className="wrap">
        <Wordmark />
      </div>
    </header>
  ) : (
    <HeaderAndMenu />
  );
}

function HeaderAndMenu() {
  const { pathname } = useLocation();
  const me = useMe().data;
  const waiting = useWaiting(me);
  // Open AT an address: moving to another closes it, Back included.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const opener = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const choose = useCallback(() => {
    setOpenAt(null);
  }, []);
  const close = useCallback(() => {
    setOpenAt(null);
    opener.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    closer.current?.focus();
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = panel.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])');
      const first = f?.[0];
      const last = f?.[f.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture phase: Escape here is handled before anything else on the
    // page hears it (a Save bar's Escape is Cancel).
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = was;
    };
  }, [open, close]);

  const reports = !open && waiting?.reports ? waiting.reports : 0;
  return (
    <>
      <header className="site-head">
        <div className="wrap">
          <Wordmark />
          <div className="head-right">
            <nav className="nav-links" aria-label="Main">
              {MAIN_LINKS.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  {...(isHere(pathname, l.to) ? { 'aria-current': 'page' as const } : {})}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <MainButton className="btn go sm" />
            <button
              ref={opener}
              className="menu-btn"
              type="button"
              id="menu-open"
              aria-expanded={open}
              aria-controls="menu"
              onClick={() => {
                setOpenAt(pathname);
              }}
            >
              MENU
              {reports ? (
                <Count
                  value={reports}
                  label={`. ${waitingWords('reports', reports)}`}
                  className="ml-2"
                />
              ) : null}
            </button>
          </div>
        </div>
      </header>
      <SiteMenu
        open={open}
        me={me?.signedIn ? me : null}
        waiting={waiting}
        pathname={pathname}
        mainAction={<MainButton className="btn lg" style={{ marginBottom: 10 }} onClick={choose} />}
        closeRef={closer}
        panelRef={panel}
        onClose={close}
        onChoose={choose}
      />
    </>
  );
}
