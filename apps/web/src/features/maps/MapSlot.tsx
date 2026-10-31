/**
 * Every map an operator placed in one slot, in their order.
 *
 * A slot is a place the website has (MAP_SLOTS in @reportlog/contracts). A
 * page that holds one renders `<MapSlot slot="…" />` and nothing else: which
 * maps, how many and in what order are the operator's. With none placed it
 * draws nothing and fetches nothing beyond the placement list; a map's
 * outlines are fetched only when a map is actually on screen.
 */
import type { MapSlotId } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { HeatMap } from './HeatMap.tsx';
import { placedMapsQuery } from './queries.ts';

export function MapSlot({
  slot,
  chosen,
  onChosen,
}: {
  slot: MapSlotId;
  /** A page that narrows its list by the area clicked (the board). */
  chosen?: string | null;
  onChosen?: (code: string | null) => void;
}) {
  const placed = useQuery(placedMapsQuery());
  const maps = (placed.data?.maps ?? [])
    .filter((m) => m.slot === slot || m.also_slots.includes(slot))
    .sort((a, b) => a.position - b.position);
  if (!maps.length) return null;
  return (
    <section aria-label="Maps" style={{ display: 'grid', gap: 24 }}>
      {maps.map((m) => (
        <HeatMap
          key={m.slug}
          slug={m.slug}
          {...(chosen !== undefined ? { chosen } : {})}
          {...(onChosen ? { onChosen } : {})}
        />
      ))}
    </section>
  );
}
