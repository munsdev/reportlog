/**
 * The lists screens' server state. Every call goes through a contract, so a
 * shape change on the server breaks this file's build rather than a screen.
 */
import {
  getList,
  getListForm,
  getReviewBatch,
  listLists,
  listReviewQueues,
} from '@reportlog/contracts';
import type { ReviewState } from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

/** The visitor's form. On a door it is the ONLY read the page makes. */
export const listFormQuery = (slug: string) =>
  queryOptions({
    queryKey: ['lists', 'form', slug],
    queryFn: ({ signal }) => call(getListForm, { params: { slug }, signal }),
    // A form somebody is filling in must not change underneath them.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

export const listsQuery = () =>
  queryOptions({
    queryKey: ['admin', 'lists'],
    queryFn: ({ signal }) => call(listLists, { signal }),
  });

export const listQuery = (id: number) =>
  queryOptions({
    queryKey: ['admin', 'lists', id],
    queryFn: ({ signal }) => call(getList, { params: { id }, signal }),
  });

export const reviewQueuesQuery = () =>
  queryOptions({
    queryKey: ['list-review'],
    queryFn: ({ signal }) => call(listReviewQueues, { signal }),
  });

/** The review page's filters, from its address (routes/(staff)/lists/review.$id.tsx). */
export interface ReviewSearch {
  state?: ReviewState | undefined;
  /** Only entries holding a link nobody has judged yet. */
  links?: boolean | undefined;
  /** Only entries holding a written account (a tip description). */
  written?: boolean | undefined;
}

export function parseReviewSearch(s: Record<string, unknown>): ReviewSearch {
  const out: ReviewSearch = {};
  if (s.state === 'received' || s.state === 'approved' || s.state === 'rejected') {
    out.state = s.state;
  }
  if (s.links === true || s.links === 'true') out.links = true;
  if (s.written === true || s.written === 'true') out.written = true;
  return out;
}

export const reviewBatchQuery = (id: number, s: ReviewSearch) =>
  queryOptions({
    queryKey: ['list-review', id, s],
    queryFn: ({ signal }) =>
      call(getReviewBatch, {
        params: { id },
        query: {
          state: s.state ?? 'received',
          ...(s.links ? { links: 'true' as const } : {}),
          ...(s.written ? { written: 'true' as const } : {}),
        },
        signal,
      }),
  });
