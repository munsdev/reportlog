/**
 * What every pop-up in the navigation does the same way: the staff app's
 * drawer and account menu, and a tab row's dropdowns.
 *
 * Escape closes it and puts focus back on the button that opened it; so
 * does a press outside it (without taking focus back, since the press put
 * it somewhere already). With `trap`, Tab and Shift+Tab go round inside it
 * and the button, as in the site menu; without, Tab may leave, and leaving
 * closes it, so nothing stays open behind the person's back.
 *
 * Listened for on the document in the capture phase, so Escape here is
 * handled before anything else on the page hears it (a Save bar's Escape is
 * Cancel).
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]';

/** What can take focus inside `root`, in order, leaving out anything `hidden`. */
export function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]'));
}

export function usePopup({
  open,
  onClose,
  button,
  panel,
  trap = false,
  focusFirst = true,
}: {
  open: boolean;
  onClose: () => void;
  button: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
  trap?: boolean;
  /** Move focus to the first thing inside on open. */
  focusFirst?: boolean;
}): void {
  // The latest onClose, for the listeners below without re-adding them.
  const closing = useRef(onClose);
  useEffect(() => {
    closing.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !focusFirst) return;
    if (panel.current?.contains(document.activeElement)) return;
    focusables(panel.current)[0]?.focus();
  }, [open, focusFirst, panel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closing.current();
        button.current?.focus();
        return;
      }
      if (e.key !== 'Tab' || !trap) return;
      const ring = [...(button.current ? [button.current] : []), ...focusables(panel.current)];
      if (!ring.length) return;
      // Moved by hand, every time: the panel need not follow its button in
      // the page (the drawer is drawn after the content), so the browser's
      // own next stop could be outside it.
      e.preventDefault();
      const at = ring.findIndex((el) => el === document.activeElement);
      const next =
        at < 0
          ? e.shiftKey
            ? ring.length - 1
            : 0
          : (at + (e.shiftKey ? -1 : 1) + ring.length) % ring.length;
      ring[next]?.focus();
    };
    const outside = (target: EventTarget | null) =>
      target instanceof Node &&
      !panel.current?.contains(target) &&
      !button.current?.contains(target);
    const onPointer = (e: PointerEvent) => {
      if (outside(e.target)) closing.current();
    };
    // Without a trap, Tab past the end leaves: the pop-up goes with it.
    const onFocus = (e: FocusEvent) => {
      if (!trap && outside(e.target)) closing.current();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('focusin', onFocus, true);
    };
  }, [open, trap, button, panel]);
}

/** The page behind stays where it is while `on`. */
export function useNoScroll(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = was;
    };
  }, [on]);
}
