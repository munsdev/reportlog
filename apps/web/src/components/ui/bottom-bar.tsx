/**
 * A bar fixed to the bottom of the screen publishes its height, so the
 * things that float in a corner (the "Under active development" badge, a
 * toast) sit above it instead of covering its buttons.
 *
 * The Save bar has always done this with `--rl-savebar-height`. The filing
 * form's Back/Next bar and the moderator's Decide bar did not, so on a phone
 * the badge sat on top of Next. This is the same idea for every other bar:
 * `--rl-bottom-bar-height` on <html>, measured, and 0 while the bar is not
 * actually fixed (the card bar is part of the page from `sm` up).
 *
 * Read it through `ABOVE_BOTTOM_BARS`, which takes whichever is taller.
 */
import { useEffect, useRef } from 'react';
import type { ComponentProps, RefObject } from 'react';

export const ABOVE_BOTTOM_BARS =
  'max(var(--rl-savebar-height,0px),var(--rl-bottom-bar-height,0px))';

export function useBottomBarHeight(ref: RefObject<HTMLElement | null>, on = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const root = document.documentElement;
    const measure = () => {
      const fixed = getComputedStyle(el).position === 'fixed';
      root.style.setProperty('--rl-bottom-bar-height', `${String(fixed ? el.offsetHeight : 0)}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    watch?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      watch?.disconnect();
      root.style.removeProperty('--rl-bottom-bar-height');
    };
  }, [ref, on]);
}

/** A <div> that is a bottom bar: the same element, publishing its height. */
export function BottomBar(props: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null);
  useBottomBarHeight(ref);
  return <div ref={ref} {...props} />;
}
