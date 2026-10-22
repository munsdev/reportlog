/**
 * The flood screen's server state, shared with the queue's filter panel
 * (its logbook and organization lists come from here).
 */
import { getFloodScreen, getSwitches, listOrganizationLane } from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export const floodQuery = queryOptions({
  queryKey: ['moderation', 'flood'],
  queryFn: ({ signal }) => call(getFloodScreen, { signal }),
  refetchOnWindowFocus: false,
});
export const switchesQuery = queryOptions({
  queryKey: ['moderation', 'switches'],
  queryFn: ({ signal }) => call(getSwitches, { signal }),
  refetchOnWindowFocus: false,
});
export const laneQuery = queryOptions({
  queryKey: ['moderation', 'lane'],
  queryFn: ({ signal }) => call(listOrganizationLane, { signal }),
  refetchOnWindowFocus: false,
});
