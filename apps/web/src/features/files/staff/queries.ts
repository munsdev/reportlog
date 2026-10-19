import {
  getEvidenceState,
  getFileSettings,
  getLogbookFileLimits,
  getThreadFiles,
  listFileReports,
} from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '../../../lib/api.ts';

/**
 * Nothing on these screens refetches by itself. A moderator in the middle of
 * reading a file's record must not have it change under them; it is read
 * again after they act, and when they come back to the page.
 */
const still = { refetchOnWindowFocus: false } as const;

export const fileQueueQuery = (ref: string) =>
  queryOptions({
    queryKey: ['files-staff', 'queue', ref],
    queryFn: () => call(listFileReports, { query: ref ? { ref } : {} }),
    ...still,
  });

export const threadFilesQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['files-staff', 'thread', threadId],
    queryFn: () => call(getThreadFiles, { params: { threadId } }),
    ...still,
  });

export const evidenceQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['files-staff', 'evidence', threadId],
    queryFn: () => call(getEvidenceState, { params: { threadId } }),
    ...still,
  });

export const fileSettingsQuery = () =>
  queryOptions({
    queryKey: ['files-staff', 'settings'],
    queryFn: () => call(getFileSettings),
    ...still,
  });

export const logbookLimitsQuery = (id: number) =>
  queryOptions({
    queryKey: ['files-staff', 'logbook', id],
    queryFn: () => call(getLogbookFileLimits, { params: { id } }),
    ...still,
  });
