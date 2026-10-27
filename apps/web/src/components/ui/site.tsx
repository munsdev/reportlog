/**
 * The deployment's look and name, on every page.
 *
 * The look is applied by naming the palette and theme on <html>
 * (`data-palette`, `data-theme`); styles.css holds every value, so nothing
 * here computes a colour. The shipped choice is the bare page, so its
 * attributes are removed rather than set. The theme's layout choices ride
 * along as `data-panel-head`, `data-texture`, `data-width`, `data-columns`,
 * `data-scale` and `data-surface`.
 *
 * The last look seen is remembered in this browser and put back before the
 * first render, so a returning reader of a dark deployment does not get a
 * flash of the light default while the settings load. It is only a hint:
 * the server's answer always wins.
 *
 * Stage 6 adds two things to the same path, so both happen before the first
 * paint too: the installed look packs' stylesheets are linked
 * (features/looks/stylesheets.ts), and Easier reading, when this reader has
 * turned it on, is worn instead of the site's look
 * (features/easy-reading/easyReading.ts). What is remembered is always the
 * site's own look, never the Easier reading one.
 */
import { DEFAULT_LOOK, PaintedLook, getSite, layoutOf, paintedLayout } from '@reportlog/contracts';
import type { BrandPart, Look, LookOptions, Site, ThemeLayout } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { easyLook, onEasyReadingChange } from '@/features/easy-reading/easyReading.ts';
import { useGateMode } from '@/features/identity/gateMode.ts';
import { linkStylesheets } from '@/features/looks/stylesheets.ts';
import { call } from '@/lib/api.ts';
import { cn } from '@/lib/utils.ts';

const REMEMBERED = 'rl-look';

export const siteQuery = queryOptions({
  queryKey: ['site'],
  queryFn: ({ signal }) => call(getSite, { signal }),
});

/**
 * The site's name, look and wording, except on a door.
 *
 * A door page (a logbook opened for filing while the rest of the site is
 * behind its password) may call only the filing calls. The site's wording is
 * part of what the password protects, so asking for it there is refused, and
 * a refusal sends the visitor back to the lock screen. On a door the query
 * stays off and every caller falls back to the default name and look.
 */
export function useSite() {
  const onDoor = useGateMode() === 'door';
  return useQuery({ ...siteQuery, enabled: !onDoor });
}

/** The site's look as last applied, so Easier reading can be switched without asking again. */
let siteLook: { look: PaintedLook; root: HTMLElement } | null = null;

/** Paint a look onto the page. Remembers it for the next visit. */
export function applyLook(
  look: Look | PaintedLook,
  root: HTMLElement = document.documentElement,
): void {
  // The server sends the theme's layout with the look; a bare palette and
  // theme (the setup wizard's choice, say) takes a built-in theme's.
  let painted: PaintedLook;
  if ('panel_head' in look) painted = look;
  else painted = { ...look, ...paintedLayout(layoutOf(look.theme)) };
  // A look the page made itself names no pack stylesheets: keep the linked ones.
  const stylesheets = painted.stylesheets ?? siteLook?.look.stylesheets;
  if (stylesheets && !painted.stylesheets) painted = { ...painted, stylesheets };
  siteLook = { look: painted, root };
  paint(painted, root);
  try {
    localStorage.setItem(REMEMBERED, JSON.stringify(painted));
  } catch {
    // Storage refused (a private window, say): the look still applies.
  }
}

/** Easier reading, if this reader turned it on, else the site's look. */
function paint(site: PaintedLook, root: HTMLElement): void {
  const worn = easyLook(site);
  // Marked as well as painted: the larger root size in styles.css hangs off
  // this, because a palette and a theme cannot make a rem bigger.
  root.toggleAttribute('data-easy', worn !== site);
  for (const axis of ['palette', 'theme'] as const) {
    if (worn[axis] === DEFAULT_LOOK[axis]) root.removeAttribute(`data-${axis}`);
    else root.setAttribute(`data-${axis}`, worn[axis]);
  }
  // A look remembered before the theme chose width, columns, scale and
  // surface lacks them: the built-in theme's (or the default's) stand in
  // until the server answers.
  const fallback = layoutOf(worn.theme);
  setLayoutAttributes(root, {
    panelHead: worn.panel_head,
    texture: worn.texture,
    width: worn.width ?? fallback.width,
    columns: worn.columns ?? fallback.columns,
    scale: worn.scale ?? fallback.scale,
    surface: worn.surface ?? fallback.surface,
    second: worn.second ?? fallback.second,
    tag: worn.tag ?? fallback.tag,
  });
  setOptionAttributes(root, site.options);
  if (site.stylesheets) linkStylesheets(site.stylesheets, root.ownerDocument);
}

/** Paint the site's look again: after Easier reading is switched, here or in another tab. */
export function repaintLook(): void {
  if (siteLook) {
    paint(siteLook.look, siteLook.root);
    return;
  }
  paint(
    { ...DEFAULT_LOOK, ...paintedLayout(layoutOf(DEFAULT_LOOK.theme)) },
    document.documentElement,
  );
}

/**
 * A theme's layout choices, set on a root as the attributes styles.css
 * reads. Every one is always set, never left over from the look before.
 */
export function setLayoutAttributes(root: HTMLElement, layout: ThemeLayout): void {
  root.setAttribute('data-panel-head', layout.panelHead);
  root.setAttribute('data-texture', layout.texture);
  root.setAttribute('data-width', layout.width);
  root.setAttribute('data-columns', layout.columns);
  root.setAttribute('data-scale', layout.scale);
  root.setAttribute('data-surface', layout.surface);
  root.setAttribute('data-second', layout.second);
  root.setAttribute('data-tag', layout.tag);
}

/**
 * Zones and motion, set on <html> beside the layout choices. Absent (a look
 * remembered before they existed) is the mock-up's defaults: sections
 * alternate and decoration moves.
 */
export function setOptionAttributes(root: HTMLElement, options: LookOptions | undefined): void {
  root.setAttribute('data-zones', options?.zones ?? 'alternate');
  root.setAttribute('data-motion', options?.motion ?? 'on');
}

/** The look remembered from last time, if it is still one the site could send. */
export function rememberedLook(): PaintedLook | null {
  try {
    const parsed = PaintedLook.safeParse(JSON.parse(localStorage.getItem(REMEMBERED) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

if (typeof document !== 'undefined') {
  const remembered = rememberedLook();
  if (remembered) applyLook(remembered);
  // Nothing remembered: the default's layout attributes now, so a first
  // visit does not draw the default's colours in another theme's layout
  // until the server answers.
  else repaintLook();
  onEasyReadingChange(repaintLook);
}

/** Keeps the page wearing the site's look. Renders nothing. */
export function SiteLook() {
  const { data } = useSite();
  useEffect(() => {
    if (data) applyLook(data.look);
  }, [data]);
  return null;
}

/**
 * The two-tone name. `onDeep` is for the header, whose ground is dark in
 * every palette: the accents switch to the colours measured against it.
 * The accents are brand and muted text, never a status colour.
 */
export function BrandName({
  parts,
  onDeep = false,
  className,
}: {
  parts: readonly BrandPart[];
  onDeep?: boolean;
  className?: string;
}) {
  const tone = {
    '': '',
    a: onDeep ? 'text-brand-on-deep' : 'text-brand',
    b: onDeep ? 'text-on-deep-muted' : 'text-muted',
  } as const;
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.mark ? (
          <span key={i} className={cn(tone[p.mark])}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

/** The site's name for the tab title and anywhere plain, or the software's while loading. */
export function plainSiteName(site: Site | undefined): string {
  return site?.plain_name ?? 'ReportLog';
}
