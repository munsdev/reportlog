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
  // The work a report holds: what used to be pages of their own (WORK below).
  written?: boolean | undefined;
  links?: boolean | undefined;
  files?: boolean | undefined;
  sharing?: boolean | undefined;
  /** 1-based. */
  page?: number | undefined;
}

/**
 * The queue's work filters, in the order the page shows them. They replaced
 * the Written accounts, Links and Files waiting pages, and "Only second
 * reads" joined them (owner, 29 October 2026: "They should be able to just
 * filter that"). Filters on a staff work queue, not on public data, so they
 * are not the operator's to choose as the board's are.
 */
export const WORK = [
  { key: 'written', label: 'Has a written account', words: 'with a written account' },
  { key: 'links', label: 'Has links to check', words: 'with links to check' },
  { key: 'files', label: 'Has files to check', words: 'with files to check' },
  { key: 'sharing', label: 'Can go to journalists', words: 'the reporter allows journalists' },
  { key: 'flagged', label: 'Needs a second read', words: 'waiting for a second read' },
] as const satisfies readonly { key: keyof QueueSearch; label: string; words: string }[];

/**
 * The order the queue is read in: what was asked, or oldest first while
 * looking at what is waiting (the longest wait is the first to clear) and
 * newest first otherwise.
 */
export function sortOf(s: QueueSearch): 'newest' | 'oldest' {
  return s.sort ?? ((s.status ?? 'pending') === 'pending' ? 'oldest' : 'newest');
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
          sort: sortOf(s),
          ...(s.from ? { from: s.from } : {}),
          ...(s.to ? { to: s.to } : {}),
          ...(s.place ? { place: s.place } : {}),
          ...(s.answer_set ? { answer_set: s.answer_set } : {}),
          ...(s.organization ? { organization: s.organization } : {}),
          ...(s.lane ? { lane: s.lane } : {}),
          ...(s.written ? { written: 'true' as const } : {}),
          ...(s.links ? { links: 'true' as const } : {}),
          ...(s.files ? { files: 'true' as const } : {}),
          ...(s.sharing ? { sharing: 'true' as const } : {}),
          ...(s.page && s.page > 1 ? { page: String(s.page) } : {}),
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

const STATUSES: readonly QueueStatus[] = [
  'all',
  'pending',
  'valid',
  'invalid',
  'unknown',
  'withdrawn',
];
const SEVERITY_FILTERS: readonly QueueSeverity[] = [
  'note',
  'irregularity',
  'serious',
  'systemic',
  'none',
];

/**
 * The queue's filters from the address, each checked again by the server.
 * The report page takes the same ones, so "Back to the queue" and "Next
 * waiting report" keep the queue as it was left.
 */
export function parseQueueSearch(s: Record<string, unknown>): QueueSearch {
  const out: QueueSearch = {};
  if (STATUSES.includes(s.status as QueueStatus)) out.status = s.status as QueueStatus;
  if (typeof s.q === 'string' && s.q) out.q = s.q.slice(0, 200);
  for (const { key } of WORK) if (s[key] === true || s[key] === 'true') out[key] = true;
  if (typeof s.logbook === 'string' && s.logbook) out.logbook = s.logbook.slice(0, 63);
  if (SEVERITY_FILTERS.includes(s.severity as QueueSeverity)) {
    out.severity = s.severity as QueueSeverity;
  }
  if (s.sort === 'oldest' || s.sort === 'newest') out.sort = s.sort;
  const page = Number(s.page);
  if (Number.isInteger(page) && page > 1 && page < 1e6) out.page = page;
  // Plan E: the flood filters, checked again by the server.
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v ? v.slice(0, max) : undefined;
  const from = text(s.from, 40);
  if (from) out.from = from;
  const to = text(s.to, 40);
  if (to) out.to = to;
  const place = text(s.place, 16);
  if (place && /^[A-Z]{2}(-[A-Z0-9]{1,3}(-\d{5})?)?$/.test(place)) out.place = place;
  const set = text(s.answer_set, 32);
  if (set && /^[0-9a-f]{32}$/.test(set)) out.answer_set = set;
  const org =
    typeof s.organization === 'number' ? String(s.organization) : text(s.organization, 16);
  if (org && /^[1-9]\d*$/.test(org)) out.organization = org;
  if (s.lane === 'organization' || s.lane === 'open_form') out.lane = s.lane;
  return out;
}
