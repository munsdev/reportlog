/**
 * The board's server state. Every call goes through a contract, so a shape
 * change on the server breaks this file's build rather than a screen.
 */
import {
  deskReportExtras,
  deskReports,
  getBoard,
  getBoardReport,
  getBoardStats,
  getPressPack,
  listBoardReports,
} from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export interface BoardSearch {
  q?: string | undefined;
  logbook?: string | undefined;
  page?: number | undefined;
  /** Question key → answer, for the questions an operator marked as filters. */
  f?: Record<string, string> | undefined;
  /** Journalists only: keep reports in the states they chose for alerts. */
  mine?: boolean | undefined;
}

export const boardMetaQuery = queryOptions({
  queryKey: ['board', 'meta'],
  queryFn: ({ signal }) => call(getBoard, { signal }),
});

export const boardReportsQuery = (s: BoardSearch) =>
  queryOptions({
    queryKey: ['board', 'reports', s],
    queryFn: ({ signal }) => {
      const query: Record<string, string> = {};
      if (s.q) query.q = s.q;
      if (s.logbook) query.logbook = s.logbook;
      if (s.page && s.page > 1) query.page = String(s.page);
      for (const [k, v] of Object.entries(s.f ?? {})) if (v) query[`a.${k}`] = v;
      return call(listBoardReports, { query, signal });
    },
  });

export const boardReportQuery = (ref: string) =>
  queryOptions({
    queryKey: ['board', 'report', ref],
    queryFn: ({ signal }) => call(getBoardReport, { params: { ref }, signal }),
    retry: false,
  });

export const boardStatsQuery = queryOptions({
  queryKey: ['board', 'stats'],
  queryFn: ({ signal }) => call(getBoardStats, { signal }),
});

/** The press pack, also read by the board's tabs to hide the tab when it is empty. */
export const pressQuery = queryOptions({
  queryKey: ['board', 'press'],
  queryFn: ({ signal }) => call(getPressPack, { signal }),
});

/** The journalists' list: the board's own query, plus "My states" and the Sources on each report. */
export const deskReportsQuery = (s: BoardSearch) =>
  queryOptions({
    queryKey: ['board', 'reports', 'journalist', s],
    queryFn: ({ signal }) => {
      const query: Record<string, string> = {};
      if (s.q) query.q = s.q;
      if (s.logbook) query.logbook = s.logbook;
      if (s.page && s.page > 1) query.page = String(s.page);
      if (s.mine) query.mine = 'true';
      for (const [k, v] of Object.entries(s.f ?? {})) if (v) query[`a.${k}`] = v;
      return call(deskReports, { query, signal });
    },
  });

export const deskReportExtrasQuery = (ref: string, enabled: boolean) =>
  queryOptions({
    queryKey: ['board', 'report', ref, 'journalist'],
    queryFn: ({ signal }) => call(deskReportExtras, { params: { ref }, signal }),
    enabled,
    retry: false,
  });
