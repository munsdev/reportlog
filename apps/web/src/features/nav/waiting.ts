/**
 * The menu's waiting totals, and the little the header needs to read them.
 *
 * Kept under the `moderation` key on purpose: every moderation screen
 * invalidates `['moderation']` after a decision, so the number on the Menu
 * button follows the queue without either knowing about the other. The
 * person's address is in the key so one person's totals are never shown,
 * even for a moment, to the next person to sign in on this browser.
 */
import { getMenuWaiting } from '@reportlog/contracts';
import type { Me, MenuWaiting } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { call } from '@/lib/api.ts';

export const waitingQuery = (email: string) =>
  queryOptions({
    queryKey: ['moderation', 'menu-waiting', email],
    queryFn: ({ signal }) => call(getMenuWaiting, { signal }),
    staleTime: 30_000,
  });

/**
 * Whether the server could have any total for this person. Everybody else
 * is not asked at all: a reporter's every page load stays one call lighter.
 */
export function mayHaveWaiting(me: Me | undefined): me is Extract<Me, { signedIn: true }> {
  if (!me?.signedIn) return false;
  return (
    me.tester ||
    me.role === 'moderator' ||
    me.role === 'admin' ||
    me.role === 'owner' ||
    me.role === 'access_manager'
  );
}

export function useWaiting(me: Me | undefined): MenuWaiting | undefined {
  const email = me?.signedIn ? me.email : '';
  const query = useQuery({ ...waitingQuery(email), enabled: mayHaveWaiting(me) });
  return mayHaveWaiting(me) ? query.data : undefined;
}

/** The words for a total, so a count is never a bare figure to a screen reader. */
export function waitingWords(key: keyof MenuWaiting, n: number): string {
  const one = n === 1;
  switch (key) {
    case 'reports':
      return `${String(n)} ${one ? 'report' : 'reports'} waiting for a moderator`;
    case 'list_entries':
      return `${String(n)} list ${one ? 'entry' : 'entries'} waiting for review`;
    case 'tip_links':
      return `${String(n)} tip ${one ? 'link' : 'links'} waiting to be checked`;
    case 'feedback':
      return `${String(n)} open feedback ${one ? 'issue' : 'issues'}`;
  }
}

const PHONE = '(max-width: 767.98px)';

const noop = () => undefined;

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return noop;
  const list = window.matchMedia(PHONE);
  list.addEventListener('change', onChange);
  return () => {
    list.removeEventListener('change', onChange);
  };
}

const isPhone = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(PHONE).matches;

/** Below 768px the menu is a sheet with folding areas; above it, a panel with columns. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, isPhone, () => false);
}
