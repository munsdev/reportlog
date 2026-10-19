/**
 * The moderation screens' server state, through contracts.
 */
import {
  getAccessLog,
  getArchiveSwitch,
  getQueueItem,
  getReportNote,
  getReviewKeywords,
  listNotesSwitches,
  listQueue,
} from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export type QueueStatus = 'all' | 'pending' | 'valid' | 'invalid' | 'unknown' | 'withdrawn';

export interface QueueSearch {
  status?: QueueStatus | undefined;
  q?: string | undefined;
  flagged?: boolean | undefined;
  logbook?: string | undefined;
  sort?: 'newest' | 'oldest' | undefined;
}

export const queueQuery = (s: QueueSearch) =>
  queryOptions({
    queryKey: ['moderation', 'queue', s],
    queryFn: ({ signal }) =>
      call(listQueue, {
        query: {
          status: s.status ?? 'pending',
          ...(s.q ? { q: s.q } : {}),
          ...(s.flagged ? { flagged: 'true' as const } : {}),
          ...(s.logbook ? { logbook: s.logbook } : {}),
          ...(s.sort ? { sort: s.sort } : {}),
        },
        signal,
      }),
  });

export const queueItemQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['moderation', 'item', threadId],
    queryFn: ({ signal }) => call(getQueueItem, { params: { threadId }, signal }),
    retry: false,
  });

export const noteQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['moderation', 'note', threadId],
    queryFn: ({ signal }) => call(getReportNote, { params: { threadId }, signal }),
  });

export const keywordsQuery = queryOptions({
  queryKey: ['moderation', 'keywords'],
  queryFn: ({ signal }) => call(getReviewKeywords, { signal }),
});

export const archiveQuery = queryOptions({
  queryKey: ['moderation', 'archive'],
  queryFn: ({ signal }) => call(getArchiveSwitch, { signal }),
});

export const notesSwitchesQuery = queryOptions({
  queryKey: ['moderation', 'notes-switches'],
  queryFn: ({ signal }) => call(listNotesSwitches, { signal }),
});

/** Reading the log is itself recorded, so it is fetched only when asked for. */
export const accessLogQuery = (months: number) =>
  queryOptions({
    queryKey: ['moderation', 'access-log', months],
    queryFn: ({ signal }) => call(getAccessLog, { query: { months }, signal }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
