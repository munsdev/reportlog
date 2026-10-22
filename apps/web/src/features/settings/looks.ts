/**
 * Naming a look in words, for the Look screen, the setup wizard and the
 * settings overview. A look is a palette and a theme; a named look is a pair
 * somebody drew and named ("Morning edition"). A pair nobody named is still
 * a look, and is called by its two parts.
 */
import { CORE_PACK, LOOKS, PALETTES, THEMES } from '@reportlog/contracts';
import type { Look, NamedLook } from '@reportlog/contracts';

/** The named look this pair is, if any. */
export function namedLookFor(look: Look): NamedLook | undefined {
  return LOOKS.find((l) => l.palette === look.palette && l.theme === look.theme);
}

export function paletteLabel(id: string): string {
  return PALETTES.find((p) => p.id === id)?.label ?? id;
}

export function themeLabel(id: string): string {
  return THEMES.find((t) => t.id === id)?.label ?? id;
}

/** "Morning edition", or "Midnight with Docket" for a pair nobody named. */
export function lookName(look: Look): string {
  return (
    namedLookFor(look)?.label ?? `${paletteLabel(look.palette)} with ${themeLabel(look.theme)}`
  );
}

export function sameLook(a: Look, b: Look): boolean {
  return a.palette === b.palette && a.theme === b.theme;
}

/**
 * What is installed, in words: the built-in pack's line on the Look screen
 * and the count on the settings overview. Packs from a file are thread E's
 * (stage 6); until the site can list them, the built-in pack is all there is.
 */
export const BUILT_IN = {
  label: 'ReportLog, built in',
  palettes: CORE_PACK.palettes?.length ?? 0,
  themes: CORE_PACK.themes?.length ?? 0,
  looks: LOOKS.length,
};

export function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}
