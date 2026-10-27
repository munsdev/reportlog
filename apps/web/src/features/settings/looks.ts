/**
 * Naming a look in words, for the Look screen, the setup wizard and the
 * settings overview. A look is a palette and a theme; a named look is a pair
 * somebody drew and named ("Morning edition"). A pair nobody named is still
 * a look, and is called by its two parts.
 *
 * THE CATALOGUE is what may be chosen: the built-in pack, plus every pack an
 * operator installed (stage 6). The packs' stylesheets are linked on every
 * page already, so a pack's palette id on a strip or a preview frame paints
 * it; this file only decides what is offered and what it is called.
 */
import { CORE_PACK, LOOKS, PALETTES, THEMES, themeLayout } from '@reportlog/contracts';
import type {
  Columns,
  InstalledLookPack,
  Look,
  PanelHead,
  Scale,
  Second,
  Surface,
  Tag,
  Texture,
  ThemeLayout,
  Width,
} from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { lookPacksQuery } from '../looks/queries.ts';

export interface CatalogueLook {
  id: string;
  label: string;
  palette: string;
  theme: string;
  /** The pack it came with, or undefined for a built-in look. */
  pack?: string | undefined;
}

export interface CataloguePalette {
  id: string;
  label: string;
  description: string;
  dark: boolean;
}

export interface CatalogueTheme {
  id: string;
  label: string;
  description: string;
  panelHead: PanelHead;
  texture: Texture;
  width?: Width | undefined;
  columns?: Columns | undefined;
  scale?: Scale | undefined;
  surface?: Surface | undefined;
  second?: Second | undefined;
  tag?: Tag | undefined;
}

export interface LookCatalogue {
  looks: readonly CatalogueLook[];
  palettes: readonly CataloguePalette[];
  themes: readonly CatalogueTheme[];
}

export const BUILT_IN_CATALOGUE: LookCatalogue = {
  looks: LOOKS.map((l) => ({ id: l.id, label: l.label, palette: l.palette, theme: l.theme })),
  palettes: PALETTES,
  themes: THEMES,
};

/** The built-in pack, then each installed pack's looks, palettes and themes in its own order. */
export function catalogueWith(packs: readonly InstalledLookPack[]): LookCatalogue {
  return {
    looks: [
      ...BUILT_IN_CATALOGUE.looks,
      ...packs.flatMap((p) => p.looks.map((l) => ({ ...l, pack: p.label }))),
    ],
    palettes: [...BUILT_IN_CATALOGUE.palettes, ...packs.flatMap((p) => p.palettes)],
    themes: [...BUILT_IN_CATALOGUE.themes, ...packs.flatMap((p) => p.themes)],
  };
}

/**
 * Everything installed on this site, for the owner's and administrators'
 * screens (the packs' list is theirs only). While it loads, or if it cannot
 * be read, the built-in pack alone: what is offered then is still all valid.
 */
export function useLookCatalogue(): LookCatalogue {
  const packs = useQuery(lookPacksQuery).data?.packs;
  return useMemo(() => (packs ? catalogueWith(packs) : BUILT_IN_CATALOGUE), [packs]);
}

/** The named look this pair is, if any. */
export function namedLookFor(
  look: Look,
  catalogue: LookCatalogue = BUILT_IN_CATALOGUE,
): CatalogueLook | undefined {
  return catalogue.looks.find((l) => l.palette === look.palette && l.theme === look.theme);
}

export function paletteLabel(id: string, catalogue: LookCatalogue = BUILT_IN_CATALOGUE): string {
  return catalogue.palettes.find((p) => p.id === id)?.label ?? id;
}

export function themeLabel(id: string, catalogue: LookCatalogue = BUILT_IN_CATALOGUE): string {
  return catalogue.themes.find((t) => t.id === id)?.label ?? id;
}

/** "Morning edition", or "Midnight with Docket" for a pair nobody named. */
export function lookName(look: Look, catalogue: LookCatalogue = BUILT_IN_CATALOGUE): string {
  return (
    namedLookFor(look, catalogue)?.label ??
    `${paletteLabel(look.palette, catalogue)} with ${themeLabel(look.theme, catalogue)}`
  );
}

/**
 * How a theme lays out its page (panel headings, texture, width, columns,
 * scale, surface), for a preview frame's root. A theme from a pack carries
 * its own; an id nobody offers falls back to the plain shapes rather than
 * drawing nothing.
 */
export function layoutIn(
  themeId: string,
  catalogue: LookCatalogue = BUILT_IN_CATALOGUE,
): ThemeLayout {
  const t = catalogue.themes.find((x) => x.id === themeId);
  return themeLayout(t ?? { panelHead: 'plain', texture: 'none' });
}

export function sameLook(a: Look, b: Look): boolean {
  return a.palette === b.palette && a.theme === b.theme;
}

/**
 * What is installed, in words: the built-in pack's line on the Look screen
 * and the count on the settings overview.
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
