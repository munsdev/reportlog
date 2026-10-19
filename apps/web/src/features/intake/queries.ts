/**
 * Coordinator intake's server state. Every call goes through a contract, so a
 * shape change on the server breaks this file's build rather than a screen.
 */
import {
  getIntakeBatch,
  getIntakeFiling,
  getPublicLogbook,
  getPublicationCard,
  listIntakeBatches,
  listIntakeOrganizations,
  listPublicLogbooks,
  reviewIntakeBatch,
} from '@reportlog/contracts';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export const organizationsQuery = queryOptions({
  queryKey: ['intake', 'organizations'],
  queryFn: ({ signal }) => call(listIntakeOrganizations, { signal }),
});

export const batchesQuery = queryOptions({
  queryKey: ['intake', 'batches'],
  queryFn: ({ signal }) => call(listIntakeBatches, { signal }),
});

export const batchQuery = (id: number) =>
  queryOptions({
    queryKey: ['intake', 'batches', id],
    queryFn: ({ signal }) => call(getIntakeBatch, { params: { id }, signal }),
    retry: false,
  });

export const reviewQuery = (id: number) =>
  queryOptions({
    queryKey: ['intake', 'batches', id, 'review'],
    queryFn: ({ signal }) => call(reviewIntakeBatch, { params: { id }, signal }),
  });

export const filingQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['intake', 'reports', threadId],
    queryFn: ({ signal }) => call(getIntakeFiling, { params: { threadId }, signal }),
    retry: false,
  });

/** The logbooks taking reports now: an account can only be filed into one of these. */
export const openLogbooksQuery = queryOptions({
  queryKey: ['intake', 'logbooks'],
  queryFn: ({ signal }) => call(listPublicLogbooks, { query: { include: 'open' }, signal }),
});

export const logbookQuery = (slug: string) =>
  queryOptions({
    queryKey: ['intake', 'logbooks', slug],
    queryFn: ({ signal }) => call(getPublicLogbook, { params: { slug }, signal }),
    // The questions somebody is typing into must not change underneath them.
    staleTime: Infinity,
    retry: false,
  });

/**
 * The wording coordinators are shown, and its digest. The server issues the
 * digest; this page only hands it back with the answer.
 */
export const coordinatorCardQuery = queryOptions({
  queryKey: ['intake', 'card'],
  queryFn: ({ signal }) => call(getPublicationCard, { query: { variant: 'coordinator' }, signal }),
  staleTime: Infinity,
});

export function useIntakeRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['intake'] });
}
