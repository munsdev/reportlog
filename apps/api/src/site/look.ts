/**
 * Which palette and theme this deployment wears. The catalogue is the
 * built-in look pack in @reportlog/contracts (`PALETTES`, `THEMES`) plus any
 * installed look packs (looks/packs.ts, `lookCatalogue`); this is the
 * resolving and the validating.
 *
 * Each function takes the catalogue and defaults to the built-in one, so a
 * caller that has not read the installed packs still never names a look the
 * page has no stylesheet for: it falls back to the default instead.
 */
import { DEFAULT_LOOK, RETIRED_IDS, paintedLayout, themeLayout } from '@reportlog/contracts';
import type { Look, PaintedLook } from '@reportlog/contracts';
import { BUILT_IN_CATALOGUE } from '../looks/packs.ts';
import type { LookCatalogue } from '../looks/packs.ts';
import type { Checked } from './result.ts';

/**
 * An id as offered today. One stored by a version before the look library
 * is read as the built-in id that replaced it (`RETIRED_IDS`), so a site
 * keeps a look close to the one it chose; the next save writes the new id.
 * An installed pack may never take a retired id (looks/packs.ts), so the
 * two readings cannot collide.
 */
function current(
  value: unknown,
  items: readonly { id: string }[],
  retired: Readonly<Record<string, string>>,
) {
  const v = typeof value === 'string' ? value.trim() : '';
  const ids = items.map((x) => x.id);
  if (ids.includes(v)) return v;
  const mapped = Object.hasOwn(retired, v) ? retired[v] : undefined;
  return mapped !== undefined && ids.includes(mapped) ? mapped : null;
}

/**
 * Never returns a name the page has no CSS for. A palette dropped in a
 * later version, or one from a pack since removed, would otherwise leave
 * `data-palette` naming nothing: a page with no colours at all rather than
 * the shipped ones.
 */
export function resolveLook(
  stored: { palette?: unknown; theme?: unknown } | null,
  catalogue: LookCatalogue = BUILT_IN_CATALOGUE,
): Look {
  return {
    palette:
      current(stored?.palette, catalogue.palettes, RETIRED_IDS.palettes) ?? DEFAULT_LOOK.palette,
    theme: current(stored?.theme, catalogue.themes, RETIRED_IDS.themes) ?? DEFAULT_LOOK.theme,
  };
}

/**
 * The look as the public pages paint it: the two ids, the theme's layout
 * choices, whether the palette is dark (for Easier reading), and
 * the installed packs' stylesheets for the page to link.
 */
export function paintedLook(
  stored: { palette?: unknown; theme?: unknown } | null,
  catalogue: LookCatalogue = BUILT_IN_CATALOGUE,
): PaintedLook {
  const look = resolveLook(stored, catalogue);
  const theme =
    catalogue.themes.find((t) => t.id === look.theme) ??
    catalogue.themes.find((t) => t.id === DEFAULT_LOOK.theme);
  return {
    ...look,
    ...paintedLayout(themeLayout(theme ?? { panelHead: 'plain', texture: 'none' })),
    dark: catalogue.palettes.some((p) => p.id === look.palette && p.dark),
    stylesheets: [...catalogue.stylesheets],
  };
}

/**
 * One axis may be set without the other, so a palette change does not
 * carry a theme with it. A body still carrying the retired `layout` axis is
 * ignored rather than refused, and so is an id from before the look library
 * (it is saved as its replacement): an older settings page left open in a
 * tab should not start erroring.
 */
export function validateLook(
  body: { palette?: unknown; theme?: unknown },
  catalogue: LookCatalogue = BUILT_IN_CATALOGUE,
): Checked<Partial<Look>> {
  const out: Partial<Look> = {};
  if (body.palette !== undefined) {
    const v = current(body.palette, catalogue.palettes, RETIRED_IDS.palettes);
    if (v === null) return { ok: false, error: 'That is not one of the palettes on offer.' };
    out.palette = v;
  }
  if (body.theme !== undefined) {
    const v = current(body.theme, catalogue.themes, RETIRED_IDS.themes);
    if (v === null) return { ok: false, error: 'That is not one of the themes on offer.' };
    out.theme = v;
  }
  if (out.palette === undefined && out.theme === undefined) {
    return { ok: false, error: 'Choose a palette or a theme.' };
  }
  return { ok: true, value: out };
}
