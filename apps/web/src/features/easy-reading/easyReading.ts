/**
 * Easier reading (docs/design/looks/README.md, section 07): a switch for the
 * reader, not the operator. On, this browser wears the High contrast palette
 * (High contrast dark when the site's palette is dark) with the Commons
 * theme: 7:1 colour, Atkinson Hyperlegible, 18px text, no page texture.
 *
 * It never changes what anybody else sees: the choice lives in this
 * browser's localStorage under `rl-easy` and nowhere else, and the site's
 * own look is still what the server says. The page applies it before its
 * first paint, through the same code that puts the remembered look back
 * (components/ui/site.tsx, `applyLook`), so a reader who turned it on never
 * sees a flash of the site's colours first.
 *
 * Every storage call is wrapped: a private window or blocked site data
 * throws, and the page must still render. The choice is then kept in memory
 * for as long as the page is open.
 */
import { isDarkPalette, layoutOf, paintedLayout } from '@reportlog/contracts';
import type { PaintedLook } from '@reportlog/contracts';

export const EASY_KEY = 'rl-easy';

/** The pair it paints, from the built-in pack, light or dark. */
export const EASY_READING = {
  palette: 'contrast',
  darkPalette: 'contrast-dark',
  theme: 'commons',
} as const;

// What was chosen on this page, for when storage refuses.
let inMemory = false;
const listeners = new Set<() => void>();

export function easyReadingOn(): boolean {
  try {
    const stored = localStorage.getItem(EASY_KEY);
    return stored === null ? inMemory : stored === 'on';
  } catch {
    return inMemory;
  }
}

/** Turn it on or off for this browser. Everything listening repaints. */
export function setEasyReading(on: boolean): void {
  inMemory = on;
  try {
    if (on) localStorage.setItem(EASY_KEY, 'on');
    else localStorage.removeItem(EASY_KEY);
  } catch {
    // Storage refused: it holds for this page only.
  }
  for (const l of listeners) l();
}

/**
 * Be told when it changes, here or in another tab of this browser (the
 * `storage` event), so every open page repaints. Returns the unsubscribe.
 */
export function onEasyReadingChange(listener: () => void): () => void {
  listeners.add(listener);
  const fromOtherTab = (e: StorageEvent) => {
    if (e.key === EASY_KEY || e.key === null) listener();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', fromOtherTab);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', fromOtherTab);
  };
}

/**
 * What the page should wear: the site's look, or, with Easier reading on,
 * High contrast (dark if the site's palette is dark) with Commons. Whether a
 * palette is dark comes with the look from the server, so a palette from an
 * installed pack is read right too; a look the page made itself falls back
 * to the built-in pack's word for it.
 */
export function easyLook(site: PaintedLook, on: boolean = easyReadingOn()): PaintedLook {
  if (!on) return site;
  const dark = site.dark ?? isDarkPalette(site.palette);
  const layout = layoutOf(EASY_READING.theme);
  return {
    palette: dark ? EASY_READING.darkPalette : EASY_READING.palette,
    theme: EASY_READING.theme,
    ...paintedLayout(layout),
    dark,
  };
}

/**
 * The palette and theme the page script paints (mockup/siteLook.tsx): the
 * same choice as easyLook, for a look that is only a palette and a theme.
 * Without it the script kept painting the site's own fonts inline, over the
 * attributes Easier reading set.
 */
export function easyPair(
  look: { palette: string; theme: string; dark?: boolean | undefined },
  on: boolean = easyReadingOn(),
): { palette: string; theme: string } {
  if (!on) return { palette: look.palette, theme: look.theme };
  const dark = look.dark ?? isDarkPalette(look.palette);
  return {
    palette: dark ? EASY_READING.darkPalette : EASY_READING.palette,
    theme: EASY_READING.theme,
  };
}
