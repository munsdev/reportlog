/**
 * A map at its own address, /map/<slug>. Every map that is turned on has one,
 * whatever its slot.
 *
 * A link can carry the reader's two switches and the area they were looking
 * at (`?plane=world&view=outcome&area=US-AZ`) and nothing else. There is no
 * `threshold=`: a reader who could lower the threshold could undo the only
 * thing it is for.
 */
import { useQuery } from '@tanstack/react-query';
import { Page } from '../../components/ui/page.tsx';
import { HeatMap } from './HeatMap.tsx';
import type { MapStart } from './HeatMap.tsx';
import { mapQuery } from './queries.ts';

export function MapPage({ slug, start }: { slug: string; start: MapStart }) {
  const map = useQuery(mapQuery(slug));
  const title = map.data?.published ? map.data.title : 'Map';
  const lede = map.data?.published ? map.data.blurb : null;
  return (
    <Page title={title} lede={lede}>
      <HeatMap slug={slug} start={start} showTitle={false} />
    </Page>
  );
}
