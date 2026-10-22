/**
 * The board's own maps page (the `board_tab` slot): every map an operator
 * placed there, in their order.
 *
 * A map here is the same map as at /map/<slug>: the server sends an area
 * under its threshold without its count, and nothing on this page can ask for
 * one. No tile layer, no other host.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { BoardFrame } from './BoardFrame.tsx';
import { MapSlot } from '../maps/MapSlot.tsx';
import { placedMapsQuery } from '../maps/queries.ts';
import { boardMetaQuery } from './queries.ts';

export function BoardMapsPage() {
  // The placement list is empty when the archive is off; the board's own
  // read says why, so this page says the same sentence as the board.
  const meta = useQuery(boardMetaQuery);
  const placed = useQuery(placedMapsQuery());
  const off = meta.data && !meta.data.published ? meta.data.reason : null;
  const none = !off && placed.data && !placed.data.maps.some((m) => m.slot === 'board_tab');
  return (
    <BoardFrame
      title="Maps"
      lede="Where published reports say things happened. An area with too few reports to count safely is not shaded and its number is not shown."
    >
      {placed.isPending ? <p role="status">Loading the maps…</p> : null}
      {placed.isError ? (
        <Alert tone="serious" title="The maps could not be loaded">
          {placed.error.message}
        </Alert>
      ) : null}
      {off ? <Alert>{off}</Alert> : null}
      {none ? <Empty title="No maps here">There are no maps on the board.</Empty> : null}
      <MapSlot slot="board_tab" />
    </BoardFrame>
  );
}

/**
 * The board's button to its maps page, shown only when a map is placed there:
 * a button to an empty page is a promise the board does not keep.
 */
export function BoardMapsButton() {
  const placed = useQuery(placedMapsQuery());
  if (!placed.data?.maps.some((m) => m.slot === 'board_tab')) return null;
  return (
    <Button asChild variant="secondary">
      <Link to="/board/maps">Maps</Link>
    </Button>
  );
}
