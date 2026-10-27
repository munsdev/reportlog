/**
 * THE HEADER: one sticky bar, the same at every width (docs/design/
 * navigation.md, section 01), in the page's widest container (1216px,
 * whatever the theme's page width) so the bar does not move between pages. The wordmark on the left, linking home; the
 * Menu button on the right; nothing else, so it never wraps and never
 * scrolls sideways. Its 6px bottom rule is the brand rule, or the progress
 * track on a filing card (progress.tsx).
 *
 * ON A DOOR it is the wordmark alone, and asks nothing. A door page may call
 * only the filing calls; asking who is signed in would be refused there and
 * put the password back. So the part that asks is not even mounted.
 *
 * THE MENU closes on Close, Escape, a click outside it and choosing any
 * link; it also closes when the address changes (Back, say), because it is
 * open AT an address. Focus moves to its first link on open, is kept inside
 * (the menu and the Close button) while open, and goes back to the Menu
 * button on close. The page behind does not scroll while it is open.
 */
import { Link, useLocation } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';
import { useGateMode } from '../identity/gateMode.ts';
import { useMe } from '../identity/session.ts';
import { SiteMenu, useMainAction } from './Menu.tsx';
import { MENU_ID, MenuButton } from './MenuButton.tsx';
import { ProgressRule, useProgressPercent } from './progress.tsx';
import { usePhone, useWaiting } from './waiting.ts';
import { Wordmark } from './Wordmark.tsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]';

/**
 * What can take focus inside `root`, in order, leaving out a folded area's
 * pages (hidden with the `hidden` attribute, the only way the menu hides
 * anything: the desktop and phone shapes are rendered, not merely shown).
 */
function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]'));
}

export function SiteHeader() {
  const door = useGateMode() === 'door';
  const percent = useProgressPercent();
  const { pathname } = useLocation();
  // Open AT an address: moving to another closes it, Back included.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = !door && openAt === pathname;
  return (
    <>
      <header className="sticky top-0 z-40 bg-deep text-on-deep print:hidden">
        <div className="mx-auto flex h-14 max-w-[76rem] items-center justify-between gap-4 px-[max(1rem,env(safe-area-inset-left))] md:h-16 md:px-8">
          <Wordmark />
          {door ? null : (
            <div className="flex shrink-0 items-center gap-2 md:gap-3">
              <FileAction />
              <MenuControl
                open={open}
                onOpen={() => {
                  setOpenAt(pathname);
                }}
                onClose={() => {
                  setOpenAt(null);
                }}
                pathname={pathname}
              />
            </div>
          )}
        </div>
        {/* While the menu is open, its own rule is the one at the bottom. */}
        {open ? (
          <div aria-hidden="true" className="h-px bg-line-on-deep" />
        ) : (
          <ProgressRule percent={percent} />
        )}
      </header>
      {open ? (
        // The page behind, dimmed. Decoration: a click on it is caught by
        // the header's outside-click listener, not by this element.
        <div aria-hidden="true" className="fixed inset-0 z-30 bg-deeper/55 print:hidden" />
      ) : null}
    </>
  );
}

/**
 * The header's one button: straight to the front page's first button's
 * target (the logbook, as the operator arranged it), not to the chooser,
 * which is in the menu. Not mounted on a door, so it asks nothing there.
 */
function FileAction() {
  const { label, href } = useMainAction();
  return (
    <Button asChild size="md" className="focus-visible:outline-on-deep" data-file-action>
      {href === '/submit' ? <Link to="/submit">{label}</Link> : <a href={href}>{label}</a>}
    </Button>
  );
}

function MenuControl({
  open,
  onOpen,
  onClose,
  pathname,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  pathname: string;
}) {
  const me = useMe().data;
  const waiting = useWaiting(me);
  const phone = usePhone();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  // The latest onClose, for the listeners below without re-adding them.
  const closing = useRef(onClose);
  useEffect(() => {
    closing.current = onClose;
  }, [onClose]);
  const close = useCallback(() => {
    closing.current();
    button.current?.focus();
  }, []);

  // Focus in on open. The menu's contents can arrive a moment after it
  // opens (who is signed in, the counts), so this runs again as they do,
  // but only while focus has not got in yet: never pulled from where the
  // person has since moved it.
  useEffect(() => {
    if (!open || panel.current?.contains(document.activeElement)) return;
    focusables(panel.current)[0]?.focus();
  }, [open, me, waiting, phone]);

  // The page behind stays where it is while the menu is open.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = was;
    };
  }, [open]);

  // Escape, the focus trap and a click outside. On the document, in the
  // capture phase, so Escape here is handled before anything else on the
  // page hears it (a Save bar's Escape is Cancel: it sees the key handled).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const ring = [...(button.current ? [button.current] : []), ...focusables(panel.current)];
      const first = ring[0];
      const last = ring.at(-1);
      if (!first || !last) return;
      const at = document.activeElement;
      const inside = ring.some((el) => el === at);
      if (!inside || (e.shiftKey && at === first) || (!e.shiftKey && at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      const header = button.current?.closest('header');
      if (target && header && !header.contains(target)) close();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open, close]);

  return (
    <>
      <MenuButton
        ref={button}
        open={open}
        reportsWaiting={waiting?.reports}
        onToggle={() => {
          if (open) close();
          else onOpen();
        }}
      />
      <nav
        ref={panel}
        id={MENU_ID}
        aria-label="Main menu"
        hidden={!open}
        className={cn(
          'absolute inset-x-0 top-full flex flex-col overflow-y-auto overscroll-contain',
          // A phone's sheet fills the screen under the bar; a desktop's
          // panel is as tall as it needs, and scrolls if the window is not.
          'min-h-[calc(100dvh-3.5rem-1px)] max-h-[calc(100dvh-3.5rem-1px)] bg-deeper',
          'md:min-h-0 md:max-h-[calc(100dvh-4rem-1px)]',
        )}
      >
        {open ? (
          <SiteMenu
            me={me?.signedIn ? me : null}
            waiting={waiting}
            pathname={pathname}
            phone={phone}
            onChoose={close}
          />
        ) : null}
      </nav>
    </>
  );
}
