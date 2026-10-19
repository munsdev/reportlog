/**
 * The maps' server state. Every call goes through a contract, so a shape
 * change on the server breaks this file's build rather than a screen.
 */
import { getMap, listHeatMaps, listMapCandidates, listPlacedMaps } from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import { loadOutlines } from './outlines.ts';

/** Which maps are on, and where each goes. No counts. */
export const placedMapsQuery = () =>
  queryOptions({
    queryKey: ['maps', 'placed'],
    queryFn: ({ signal }) => call(listPlacedMaps, { signal }),
  });

/** One map's counts, with every area under its threshold already stripped of its number. */
export const mapQuery = (slug: string) =>
  queryOptions({
    queryKey: ['maps', 'one', slug],
    queryFn: ({ signal }) => call(getMap, { params: { slug }, signal }),
    retry: false,
  });

/** The outlines: one download a page, however many maps are on it. */
export const outlinesQuery = () =>
  queryOptions({
    queryKey: ['maps', 'outlines'],
    queryFn: loadOutlines,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

export const adminMapsQuery = () =>
  queryOptions({
    queryKey: ['admin', 'maps'],
    queryFn: ({ signal }) => call(listHeatMaps, { signal }),
  });

export const mapCandidatesQuery = () =>
  queryOptions({
    queryKey: ['admin', 'maps', 'candidates'],
    queryFn: ({ signal }) => call(listMapCandidates, { signal }),
  });
