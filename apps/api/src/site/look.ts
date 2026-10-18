/**
 * Which palette and theme this deployment wears. The catalogue and the rule
 * that the two never overlap are in @reportlog/contracts (`PALETTES`,
 * `THEMES`); this is the resolving and the validating.
 */
import { DEFAULT_LOOK, PALETTE_IDS, THEME_IDS } from '@reportlog/contracts';
import type { Look } from '@reportlog/contracts';
import type { Checked } from './result.ts';

function pick<T extends string>(value: unknown, ids: readonly T[], fallback: T): T {
  const v = typeof value === 'string' ? value.trim() : '';
  return (ids as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Never returns a name the page has no CSS for. A palette dropped in a
 * later version would otherwise leave `data-palette` naming nothing: a page
 * with no colours at all rather than the shipped ones.
 */
export function resolveLook(stored: { palette?: unknown; theme?: unknown } | null): Look {
  return {
    palette: pick(stored?.palette, PALETTE_IDS, DEFAULT_LOOK.palette),
    theme: pick(stored?.theme, THEME_IDS, DEFAULT_LOOK.theme),
  };
}

/**
 * One axis may be set without the other, so a palette change does not
 * carry a theme with it. A body still carrying the retired `layout` axis is
 * ignored rather than refused: an older settings page left open in a tab
 * should not start erroring.
 */
export function validateLook(body: { palette?: unknown; theme?: unknown }): Checked<Partial<Look>> {
  const out: Partial<Look> = {};
  if (body.palette !== undefined) {
    const v = typeof body.palette === 'string' ? body.palette.trim() : '';
    if (!(PALETTE_IDS as readonly string[]).includes(v)) {
      return { ok: false, error: 'That is not one of the palettes on offer.' };
    }
    out.palette = v as Look['palette'];
  }
  if (body.theme !== undefined) {
    const v = typeof body.theme === 'string' ? body.theme.trim() : '';
    if (!(THEME_IDS as readonly string[]).includes(v)) {
      return { ok: false, error: 'That is not one of the themes on offer.' };
    }
    out.theme = v as Look['theme'];
  }
  if (out.palette === undefined && out.theme === undefined) {
    return { ok: false, error: 'Choose a palette or a theme.' };
  }
  return { ok: true, value: out };
}
