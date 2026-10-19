import { createFileRoute } from '@tanstack/react-router';
import type { MapStart } from '../../features/maps/HeatMap.tsx';
import { MapPage } from '../../features/maps/MapPage.tsx';

const text = (v: unknown) => (typeof v === 'string' ? v : undefined);

export const Route = createFileRoute('/map/$slug')({
  // Only the reader's own switches. Anything else in the address is ignored.
  validateSearch: (search: Record<string, unknown>): MapStart => ({
    plane: text(search.plane),
    view: text(search.view),
    area: text(search.area),
  }),
  component: function MapRoute() {
    const { slug } = Route.useParams();
    const start = Route.useSearch();
    return <MapPage slug={slug} start={start} />;
  },
});
