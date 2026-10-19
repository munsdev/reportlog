/**
 * The deployment's look and name, on every page.
 *
 * The look is applied by naming the palette and theme on <html>
 * (`data-palette`, `data-theme`); styles.css holds every value, so nothing
 * here computes a colour. The shipped choice is the bare page, so its
 * attributes are removed rather than set.
 *
 * The last look seen is remembered in this browser and put back before the
 * first render, so a returning reader of a dark deployment does not get a
 * flash of the light default while the settings load. It is only a hint:
 * the server's answer always wins.
 */
import { DEFAULT_LOOK, Look, getSite } from '@reportlog/contracts';
import type { BrandPart, Site } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useGateMode } from '@/features/identity/gate.tsx';
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

/** Paint a look onto the page. Remembers it for the next visit. */
export function applyLook(look: Look, root: HTMLElement = document.documentElement): void {
  for (const axis of ['palette', 'theme'] as const) {
    if (look[axis] === DEFAULT_LOOK[axis]) root.removeAttribute(`data-${axis}`);
    else root.setAttribute(`data-${axis}`, look[axis]);
  }
  try {
    localStorage.setItem(REMEMBERED, JSON.stringify(look));
  } catch {
    // Storage refused (a private window, say): the look still applies.
  }
}

/** The look remembered from last time, if it is still one the site offers. */
export function rememberedLook(): Look | null {
  try {
    const parsed = Look.safeParse(JSON.parse(localStorage.getItem(REMEMBERED) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

if (typeof document !== 'undefined') {
  const remembered = rememberedLook();
  if (remembered) applyLook(remembered);
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
