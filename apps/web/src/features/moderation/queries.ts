/**
 * The moderation screens' server state, through contracts.
 */
import {
  getAccessLog,
  getArchiveSwitch,
  getCorroboration,
  getQueueItem,
  getReportNote,
  getReviewKeywords,
  listNotesSwitches,
  listQueue,
} from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export type QueueStatus = 'all' | 'pending' | 'valid' | 'invalid' | 'unknown' | 'withdrawn';

/** A rating, or `none` for the reports nobody has rated yet. */
export type QueueSeverity = 'note' | 'irregularity' | 'serious' | 'systemic' | 'none';

export interface QueueSearch {
  status?: QueueStatus | undefined;
  q?: string | undefined;
  flagged?: boolean | undefined;
  logbook?: string | undefined;
  severity?: QueueSeverity | undefined;
  sort?: 'newest' | 'oldest' | undefined;
  // Plan E (PE3): the flood filters.
  from?: string | undefined;
  to?: string | undefined;
  place?: string | undefined;
  answer_set?: string | undefined;
  organization?: string | undefined;
  lane?: 'organization' | 'open_form' | undefined;
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
          ...(s.severity ? { severity: s.severity } : {}),
          ...(s.sort ? { sort: s.sort } : {}),
          ...(s.from ? { from: s.from } : {}),
          ...(s.to ? { to: s.to } : {}),
          ...(s.place ? { place: s.place } : {}),
          ...(s.answer_set ? { answer_set: s.answer_set } : {}),
          ...(s.organization ? { organization: s.organization } : {}),
          ...(s.lane ? { lane: s.lane } : {}),
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

export const corroborationQuery = queryOptions({
  queryKey: ['moderation', 'corroboration'],
  queryFn: ({ signal }) => call(getCorroboration, { signal }),
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
