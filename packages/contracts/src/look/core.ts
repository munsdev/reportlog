/**
 * The built-in look pack, read once: what the settings screens offer, what
 * the server accepts, and how an id stored by an earlier version is read.
 *
 * reportlog-core.look.json is the data. The website builds its stylesheet
 * from the same file with toCss(), so what is offered here and what is
 * painted there cannot drift; the website's suite checks both directions.
 */
import { themeLayout } from './pack.ts';
import type { LookPack, NamedLook, ThemeLayout } from './pack.ts';
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
  ...themeLayout(t),
}));

export const LOOKS: readonly NamedLook[] = looks;

export const PALETTE_IDS: readonly string[] = PALETTES.map((p) => p.id);
export const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);

const defaultLook = looks.find((l) => l.default);
if (!defaultLook) throw new Error('The built-in look pack names no default look.');

/** What a fresh installation wears: Workstation (the Workstation palette with the Workstation theme). */
export const DEFAULT_LOOK = { palette: defaultLook.palette, theme: defaultLook.theme };

/**
 * The default before Workstation. A database column default still writes it
 * into a new installation's settings row (a migration may not change it), so
 * the setup wizard reads this pair, on a site nobody has chosen a look for,
 * as "not chosen yet" and starts from DEFAULT_LOOK. A site that chose Newsdesk
 * on purpose saves a look at the wizard's step like any other.
 */
export const PREVIOUS_DEFAULT_LOOK = { palette: 'newsdesk', theme: 'newsdesk' };

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

/**
 * A built-in theme's layout choices, sent with the look so the page can set
 * them on <html>. An id no built-in theme has gets the default theme's.
 */
export function layoutOf(themeId: string): ThemeLayout {
  const t = THEMES.find((x) => x.id === themeId) ?? THEMES.find((x) => x.id === DEFAULT_LOOK.theme);
  return themeLayout(t ?? { panelHead: 'plain', texture: 'none' });
}
