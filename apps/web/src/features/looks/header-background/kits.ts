/**
 * The header kits of the installed look packs: their elements and shapes,
 * fetched from this site (`/api/looks/<pack>/<sha256>.json`, named by the
 * hash of what they hold). Fetched only where a header background is drawn
 * or edited, and parsed against the contract, so a malformed answer draws
 * nothing rather than something strange.
 */
import { LookKit, LOOK_KIT } from '@reportlog/contracts';
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
  const packs = results.flatMap((r) => (r.data ? [r.data] : []));
  const key = packs.map((p) => p.pack).join(',');
  // `packs` is rebuilt every render; its content only changes with the key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ kit: mergeKits(CORE_KIT, ...packs), packs }), [key]);
}
