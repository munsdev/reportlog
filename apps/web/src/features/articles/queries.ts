/**
 * Coverage's server state (decision 84). Every call goes through a contract.
 */
import {
  getCoverageCard,
  getCoverageCounts,
  getMyCoverage,
  listCoverage,
  listCoverageQueue,
} from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export const myCoverageQuery = queryOptions({
  queryKey: ['coverage', 'mine'],
  queryFn: ({ signal }) => call(getMyCoverage, { signal }),
});

export const coverageQueueQuery = (show: 'waiting' | 'approved' | 'declined') =>
  queryOptions({
    queryKey: ['coverage', 'queue', show],
    queryFn: ({ signal }) => call(listCoverageQueue, { query: { show }, signal }),
  });

export const coverageListQuery = (place: string | undefined, page: number) =>
  queryOptions({
    queryKey: ['coverage', 'list', place ?? '', page],
    queryFn: ({ signal }) =>
      call(listCoverage, { query: { ...(place ? { place } : {}), page }, signal }),
  });

export const coverageCountsQuery = queryOptions({
  queryKey: ['coverage', 'counts'],
  queryFn: ({ signal }) => call(getCoverageCounts, { signal }),
  staleTime: 60_000,
});

/**
 * A card is read from the article's page by the server and kept there in
 * memory; the browser keeps its copy for the visit and never asks the
 * article's own site for anything.
 */
export const coverageCardQuery = (id: number) =>
  queryOptions({
    queryKey: ['coverage', 'card', id],
    queryFn: ({ signal }) => call(getCoverageCard, { params: { id }, signal }),
    staleTime: 60 * 60_000,
    retry: false,
  });
