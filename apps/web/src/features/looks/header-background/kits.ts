/**
 * The header kits of the installed look packs: their elements and shapes,
 * fetched from this site (`/api/looks/<pack>/<sha256>.json`, named by the
 * hash of what they hold). Fetched only where a header background is drawn
 * or edited, and parsed against the contract, so a malformed answer draws
 * nothing rather than something strange.
 */
import { CORE_PACK, LookKit, LOOK_KIT } from '@reportlog/contracts';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CORE_KIT, mergeKits } from './scene.ts';
import type { Kit } from './scene.ts';

async function fetchKit(path: string, signal: AbortSignal): Promise<LookKit> {
  // Held to the exact shape, as the stylesheets are: no other address is fetched.
  if (!LOOK_KIT.test(path)) throw new Error('That is not a look pack address.');
  const res = await fetch(path, { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`The look pack's header kit answered ${String(res.status)}.`);
  return LookKit.parse(await res.json());
}

/**
 * The built-in pack's header elements and shapes (stars, stripes, the two big
 * shapes), and the palettes and themes the page script paints itself rather
 * than from looks.gen.css: the Civic ones, built in since 27 October so a
 * site can look like the approved mock-up without installing a pack. They
 * are options; the default look is still Workstation.
 */
const SCRIPT_PALETTES = ['civic-night', 'civic-navy', 'civic-old-glory'];
const SCRIPT_THEMES = ['poster'];
export const BUILT_IN_KIT: LookKit = LookKit.parse({
  pack: CORE_PACK.id,
  label: CORE_PACK.label,
  ...(CORE_PACK.credit ? { credit: CORE_PACK.credit } : {}),
  elements: (CORE_PACK.elements ?? []).filter((e) => e.id !== 'ruled'),
  shapes: CORE_PACK.shapes ?? {},
  palettes: (CORE_PACK.palettes ?? [])
    .filter((p) => SCRIPT_PALETTES.includes(p.id))
    .map((p) => ({ id: p.id, label: p.label, colors: p.colors })),
  themes: (CORE_PACK.themes ?? [])
    .filter((t) => SCRIPT_THEMES.includes(t.id))
    .map((t) => ({
      id: t.id,
      label: t.label,
      type: t.type,
      shape: t.shape,
      ...(t.display ? { display: t.display } : {}),
    })),
});

/** The built-in elements plus every installed pack's, once they have arrived. */
export function useKit(paths: readonly string[] | undefined): { kit: Kit; packs: LookKit[] } {
  const results = useQueries({
    queries: (paths ?? []).map((path) => ({
      queryKey: ['look-kit', path],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchKit(path, signal),
      // Named by its hash: it never changes under that name.
      staleTime: Infinity,
    })),
  });
  const packs = [BUILT_IN_KIT, ...results.flatMap((r) => (r.data ? [r.data] : []))];
  const key = packs.map((p) => p.pack).join(',');
  // `packs` is rebuilt every render; its content only changes with the key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ kit: mergeKits(CORE_KIT, ...packs), packs }), [key]);
}
