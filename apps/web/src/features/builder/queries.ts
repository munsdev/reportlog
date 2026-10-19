/**
 * The builder's server state. Every call goes through a contract, so a shape
 * change on the server breaks this file's build rather than the screen.
 */
import {
  getHomeButtonsAdmin,
  getIntakeSwitchAdmin,
  getLogbook,
  listLogbooks,
  listStartingPoints,
} from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export const logbooksQuery = () =>
  queryOptions({
    queryKey: ['admin', 'logbooks'],
    queryFn: ({ signal }) => call(listLogbooks, { signal }),
  });

export const logbookQuery = (id: number) =>
  queryOptions({
    queryKey: ['admin', 'logbooks', id],
    queryFn: ({ signal }) => call(getLogbook, { params: { id }, signal }),
  });

export const startingPointsQuery = () =>
  queryOptions({
    queryKey: ['admin', 'starting-points'],
    queryFn: ({ signal }) => call(listStartingPoints, { signal }),
    // Read off files that ship with the software: they change on an upgrade.
    staleTime: Infinity,
  });

export const homeButtonsAdminQuery = () =>
  queryOptions({
    queryKey: ['admin', 'home-buttons'],
    queryFn: ({ signal }) => call(getHomeButtonsAdmin, { signal }),
  });

/** The site's intake switch (filing workstream's API). */
export const intakeSwitchQuery = () =>
  queryOptions({
    queryKey: ['admin', 'intake-switch'],
    queryFn: ({ signal }) => call(getIntakeSwitchAdmin, { signal }),
  });
