/**
 * Hands the site's saved look to the mock-up page script (public/mockup/site.js).
 *
 * The script draws the palette, the theme, the headline fitting and the header
 * background. It knows only the built-in looks until this tells it the saved
 * choice (palette, theme, the header background, motion, zones) and the parts
 * of the installed look packs, which are converted here from the packs' own
 * format 2 words to the shape the script reads.
 *
 * Reads the same site answer every page reads, so it is quiet on a door
 * (`useSite` is off there) and follows a save on the Look screen, which
 * refetches the site.
 */
import { headerImagePath } from '@reportlog/contracts';
import type { KitPalette, KitTheme, LookKit, LookOptions } from '@reportlog/contracts';
import { useEffect } from 'react';
import { useSite } from '@/components/ui/site.tsx';
import { useKit } from '@/features/looks/header-background/kits.ts';

interface ScriptPalette {
  label: string;
  chrome: string;
  deep: string;
  paper: string;
  ink: string;
  action: string;
  onAction: string;
  brand: string;
}

const px = (n: number) => `${String(n)}px`;
const GENERIC = /serif|mono/i;

/** A palette in the page script's seven colours. The chrome shares the deep ground. */
export function scriptPalette(p: KitPalette): ScriptPalette {
  const c = p.colors;
  const get = (k: string, d: string) => c[k] ?? d;
  return {
    label: p.label,
    chrome: get('background-deep', '#111111'),
    deep: get('background-deep', '#111111'),
    paper: get('background', '#ffffff'),
    ink: get('text', '#111111'),
    action: get('action', '#2f5be0'),
    onAction: get('on-action', '#ffffff'),
    brand: get('brand-on-deep', get('action', '#2f5be0')),
  };
}

export function scriptTheme(t: KitTheme): Record<string, string | number> {
  const h = t.type.heading;
  const d = t.display;
  const fallback = GENERIC.test(h.family) ? 'serif' : 'sans-serif';
  const upper = h.case === 'upper';
  const out: Record<string, string | number> = {
    label: t.label,
    display: `"${h.family}",${fallback}`,
    weight: h.weight,
    stretch: `${String(h.stretch ?? 100)}%`,
    case: upper ? 'uppercase' : 'none',
    lh: String(d?.lineHeight ?? 1),
    track: `${String(h.tracking ?? 0)}em`,
    hStretch: `${String(d?.headlineStretch ?? 100)}%`,
    hWeight: d?.headlineWeight ?? h.weight,
    fitMax: d?.fit.max ?? 96,
    fitMin: d?.fit.min ?? 38,
    bandMax: d?.band.max ?? 72,
    bandMin: d?.band.min ?? 32,
    pageMax: `${String(t.type.h1.max)}rem`,
    two: d?.second ?? 'muted',
    tag: d?.tag ?? 'plain',
    radius: px(t.shape.radius),
    radiusBtn: px(d?.radiusButton ?? t.shape.radius),
    line: px(t.shape.border),
    shadow: px(t.shape.shadow),
    btnCase: d?.buttonCase === 'upper' ? 'uppercase' : upper ? 'uppercase' : 'none',
  };
  if (t.type.body.family !== 'Public Sans') {
    out.body = `"${t.type.body.family}",sans-serif`;
  }
  return out;
}

export function scriptPack(k: LookKit) {
  return {
    id: k.pack,
    label: k.label,
    ...(k.credit ? { credit: k.credit } : {}),
    shapes: k.shapes,
    elements: k.elements,
    palettes: Object.fromEntries((k.palettes ?? []).map((p) => [p.id, scriptPalette(p)])),
    themes: Object.fromEntries((k.themes ?? []).map((t) => [t.id, scriptTheme(t)])),
  };
}

/** The saved choices in the script's flat names. */
export function scriptLook(palette: string, theme: string, o: LookOptions | undefined) {
  if (!o) return { palette, theme };
  const h = o.header;
  return {
    palette,
    theme,
    motion: o.motion,
    zones: o.zones,
    bg: {
      on: h.on,
      style: h.style,
      patOp: h.pattern,
      shapeOp: h.shapes,
      fade: h.fade.kind,
      fadeAmt: h.fade.strength,
      ...(h.image
        ? {
            img: headerImagePath(h.image.file),
            imgPlace: h.image.place,
            imgShape: h.image.shape ?? 'liberty',
            imgMode: h.image.mode,
            imgTone: h.image.tone,
            imgOp: h.image.strength,
            imgFocus: h.image.focus,
          }
        : {}),
    },
  };
}

export function SiteLookScript() {
  const site = useSite();
  const look = site.data?.look;
  const { packs } = useKit(look?.kits);
  const key = JSON.stringify([look?.palette, look?.theme, look?.options, packs]);
  useEffect(() => {
    if (!look || !window.elSetLook) return;
    window.elSetLook(scriptLook(look.palette, look.theme, look.options), packs.map(scriptPack));
    // `key` stands for everything read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
