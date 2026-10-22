/**
 * The built-in look pack, read once: what the settings screens offer, what
 * the server accepts, and how an id stored by an earlier version is read.
 *
 * reportlog-core.look.json is the data. The website builds its stylesheet
 * from the same file with toCss(), so what is offered here and what is
 * painted there cannot drift; the website's suite checks both directions.
 */
import type { LookPack, NamedLook, PanelHead, Texture } from './pack.ts';
import core from './reportlog-core.look.json' with { type: 'json' };
import migration from './migration.json' with { type: 'json' };

/** Held to check() by the website's suite, which is what makes this cast safe. */
export const CORE_PACK = core as LookPack;

const palettes = CORE_PACK.palettes ?? [];
const themes = CORE_PACK.themes ?? [];
const looks = CORE_PACK.looks ?? [];

/**
 * `background` and `deep` are each palette's two colours as literals,
 * because a web manifest cannot reference a CSS variable: a phone paints its
 * splash screen and status bar from them.
 */
export const PALETTES = palettes.map((p) => ({
  id: p.id,
  label: p.label,
  description: p.description,
  dark: p.dark,
  background: p.colors.background,
  deep: p.colors['background-deep'],
}));

export const THEMES = themes.map((t) => ({
  id: t.id,
  label: t.label,
  description: t.description,
  panelHead: t.panelHead,
  texture: t.texture,
}));

export const LOOKS: readonly NamedLook[] = looks;

export const PALETTE_IDS: readonly string[] = PALETTES.map((p) => p.id);
export const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);

const defaultLook = looks.find((l) => l.default);
if (!defaultLook) throw new Error('The built-in look pack names no default look.');

/** What a fresh installation wears: Desk (Platinum with Desk). */
export const DEFAULT_LOOK = { palette: defaultLook.palette, theme: defaultLook.theme };

/**
 * What every installation wore before the look library: Flint with Signal.
 * The migration that shipped the library pins an existing site to it, so
 * nobody's site changed overnight.
 */
export const LEGACY_LOOK = { palette: 'flint', theme: 'signal' };

/**
 * Ids from before the look library, to the built-in ones that replaced them.
 * Applied on read; the next save writes the new id.
 */
export const RETIRED_IDS: {
  palettes: Readonly<Record<string, string>>;
  themes: Readonly<Record<string, string>>;
} = migration;

export function isDarkPalette(id: string): boolean {
  return PALETTES.some((p) => p.id === id && p.dark);
}

/** A theme's two layout choices, sent with the look so the page can set them on <html>. */
export function layoutOf(themeId: string): { panelHead: PanelHead; texture: Texture } {
  const t = THEMES.find((x) => x.id === themeId) ?? THEMES.find((x) => x.id === DEFAULT_LOOK.theme);
  return { panelHead: t?.panelHead ?? 'plain', texture: t?.texture ?? 'none' };
}
