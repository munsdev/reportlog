/**
 * Whether this page is past the password or on a door in front of it.
 *
 * On its own so that a component the gate itself draws (the setup wizard
 * uses the site's name and look) can share code with components that ask
 * this, without the two importing each other. gate.tsx provides it.
 */
import { getSiteAccessStatus } from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { call } from '../../lib/api.ts';

/** 'open' past the password; 'door' on one page in front of it. */
export type GateMode = 'open' | 'door';
export const GateContext = createContext<GateMode>('open');
export const useGateMode = () => useContext(GateContext);

/**
 * Whether this visitor needs the password. In front of it, so it is asked on
 * every page, the lock screen and the doors included; it also carries the
 * little those may show of the site (curtainRoutes.ts). Here rather than in
 * gate.tsx so the badge in the corner can read it without importing the gate.
 */
export const siteStatusQuery = queryOptions({
  queryKey: ['site-access', 'status'],
  queryFn: ({ signal }) => call(getSiteAccessStatus, { signal }),
  staleTime: Infinity,
});
