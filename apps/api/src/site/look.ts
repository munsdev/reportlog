/**
 * Which palette and theme this deployment wears. The catalogue is the
 * built-in look pack in @reportlog/contracts (`PALETTES`, `THEMES`); this is
 * the resolving and the validating.
 */
import { DEFAULT_LOOK, PALETTE_IDS, RETIRED_IDS, THEME_IDS, layoutOf } from '@reportlog/contracts';
import type { Look, PaintedLook } from '@reportlog/contracts';
import type { Checked } from './result.ts';

/**
 * An id as offered today. One stored by a version before the look library
 * is read as the built-in id that replaced it (`RETIRED_IDS`), so a site
 * keeps a look close to the one it chose; the next save writes the new id.
 */
function current(
  value: unknown,
  ids: readonly string[],
  retired: Readonly<Record<string, string>>,
) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (ids.includes(v)) return v;
  const mapped = Object.hasOwn(retired, v) ? retired[v] : undefined;
  return mapped !== undefined && ids.includes(mapped) ? mapped : null;
}

/**
 * Never returns a name the page has no CSS for. A palette dropped in a
 * later version would otherwise leave `data-palette` naming nothing: a page
 * with no colours at all rather than the shipped ones.
 */
export function resolveLook(stored: { palette?: unknown; theme?: unknown } | null): Look {
  return {
    palette: current(stored?.palette, PALETTE_IDS, RETIRED_IDS.palettes) ?? DEFAULT_LOOK.palette,
    theme: current(stored?.theme, THEME_IDS, RETIRED_IDS.themes) ?? DEFAULT_LOOK.theme,
  };
}

/** The look with its theme's two layout choices, as the public pages paint it. */
export function paintedLook(stored: { palette?: unknown; theme?: unknown } | null): PaintedLook {
  const look = resolveLook(stored);
  const layout = layoutOf(look.theme);
  return { ...look, panel_head: layout.panelHead, texture: layout.texture };
}

/**
 * One axis may be set without the other, so a palette change does not
 * carry a theme with it. A body still carrying the retired `layout` axis is
 * ignored rather than refused, and so is an id from before the look library
 * (it is saved as its replacement): an older settings page left open in a
 * tab should not start erroring.
 */
export function validateLook(body: { palette?: unknown; theme?: unknown }): Checked<Partial<Look>> {
  const out: Partial<Look> = {};
  if (body.palette !== undefined) {
    const v = current(body.palette, PALETTE_IDS, RETIRED_IDS.palettes);
    if (v === null) return { ok: false, error: 'That is not one of the palettes on offer.' };
    out.palette = v;
  }
  if (body.theme !== undefined) {
    const v = current(body.theme, THEME_IDS, RETIRED_IDS.themes);
    if (v === null) return { ok: false, error: 'That is not one of the themes on offer.' };
    out.theme = v;
  }
  if (out.palette === undefined && out.theme === undefined) {
    return { ok: false, error: 'Choose a palette or a theme.' };
  }
  return { ok: true, value: out };
}
