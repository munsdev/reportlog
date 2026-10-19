/**
 * THE GATE IS THE WEBSITE'S AS WELL AS THE SERVER'S.
 *
 * The server refuses every call behind the site password, but a page is more
 * than its data: its headings, its words, the shape of what is behind the
 * curtain. So while the site is locked the router is NOT MOUNTED. Nothing
 * behind it renders, and Back, Forward or a typed address cannot make it
 * navigate, because there is nothing listening.
 *
 * The one exception is a door: an address that works without the password
 * (a logbook's filing form, a list's form, a report's confirmation link, the
 * link in a digest email that stops it).
 * There the router is mounted for that one page with navigation blocked, so
 * leaving it means a full page load, which lands back here. WHETHER THE THING
 * BEHIND A DOOR IS ACTUALLY OPEN is the server's decision: if a call on that
 * page is refused as locked, the password screen comes back.
 *
 * After the password, a deployment that has not been set up shows the setup
 * wizard instead of the site.
 */
import { getSetupStatus, getSiteAccessStatus } from '@reportlog/contracts';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { RouterHistory } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiRequestError, call } from '../../lib/api.ts';
import { LockScreen } from './LockScreen.tsx';
import { SetupWizard } from './SetupWizard.tsx';

/**
 * The addresses that work without the password, by shape. The filing and
 * lists workstreams build the pages; these are the paths agreed for them.
 */
export const DOOR_PATHS: readonly RegExp[] = [
  /^\/file\/[a-z0-9][a-z0-9-]{0,62}$/,
  /^\/file\/confirm\/[^/]+$/,
  /^\/list\/[a-z0-9][a-z0-9-]{0,62}$/,
  // Stopping email somebody asked for never waits on a password (identity/digestStop.ts).
  /^\/notifications\/stop\/[^/]+$/,
];

export function isDoorPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  return DOOR_PATHS.some((r) => r.test(p));
}

export const siteStatusQuery = queryOptions({
  queryKey: ['site-access', 'status'],
  queryFn: ({ signal }) => call(getSiteAccessStatus, { signal }),
  staleTime: Infinity,
});

export const setupStatusQuery = queryOptions({
  queryKey: ['site-access', 'setup'],
  queryFn: ({ signal }) => call(getSetupStatus, { signal }),
  staleTime: Infinity,
});

/** 'open' past the password; 'door' on one page in front of it. */
export type GateMode = 'open' | 'door';
const GateContext = createContext<GateMode>('open');
export const useGateMode = () => useContext(GateContext);

export const isLockedError = (e: unknown) => e instanceof ApiRequestError && e.code === 'locked';

/** Calls back whenever any query or mutation is refused as locked. */
function watchForLocked(client: QueryClient, onLocked: () => void): () => void {
  const q = client.getQueryCache().subscribe((event) => {
    if (
      event.type === 'updated' &&
      event.action.type === 'error' &&
      isLockedError(event.action.error)
    ) {
      onLocked();
    }
  });
  const m = client.getMutationCache().subscribe((event) => {
    if (
      event.type === 'updated' &&
      event.action.type === 'error' &&
      isLockedError(event.action.error)
    ) {
      onLocked();
    }
  });
  return () => {
    q();
    m();
  };
}

export function SiteGate({
  history,
  pathname,
  children,
}: {
  history: RouterHistory;
  /** Where the page was loaded. Read once: a door does not move. */
  pathname: string;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const status = useQuery(siteStatusQuery);
  const [doorRefused, setDoorRefused] = useState(false);
  const locked = status.data?.locked !== false;
  const door = status.isSuccess && locked && isDoorPath(pathname) && !doorRefused;
  const open = status.isSuccess && !locked;
  const setup = useQuery({ ...setupStatusQuery, enabled: open });

  // A refusal while inside means the password has lapsed; ask again. On a
  // door, it means the server did not open this one.
  useEffect(
    () =>
      watchForLocked(client, () => {
        if (door) setDoorRefused(true);
        else void client.invalidateQueries({ queryKey: siteStatusQuery.queryKey });
      }),
    [client, door],
  );

  // On a door, the router may render this page and go nowhere else.
  useEffect(() => {
    if (!door) return;
    return history.block({ blockerFn: () => true, enableBeforeUnload: false });
  }, [door, history]);

  if (status.isPending)
    return (
      <p className="sr-only" role="status">
        Loading
      </p>
    );
  if (status.isError) {
    // Closed, not open: when the server cannot say whether there is a gate,
    // the safe answer is to show nothing behind it.
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-16">
        <h1 className="font-display text-2xl font-bold">This site cannot be reached right now</h1>
        <p role="alert">The server did not answer. Check your connection and try again.</p>
        <button type="button" className="underline" onClick={() => void status.refetch()}>
          Try again
        </button>
      </main>
    );
  }
  if (locked && !door) {
    return (
      <LockScreen
        onUnlocked={async () => {
          setDoorRefused(false);
          await client.resetQueries();
        }}
      />
    );
  }
  if (open && setup.isPending)
    return (
      <p className="sr-only" role="status">
        Loading
      </p>
    );
  if (open && setup.data?.needed) {
    return (
      <SetupWizard
        status={setup.data}
        onFinished={async () => {
          await client.resetQueries();
        }}
      />
    );
  }
  // A setup status that failed for any other reason falls through to the
  // site: guessing "needs setup" would put an owner form in front of
  // somebody on a deployment that already has one.
  return <GateContext.Provider value={door ? 'door' : 'open'}>{children}</GateContext.Provider>;
}
