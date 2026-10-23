/**
 * Who is signed in, as a query every screen can share.
 */
import { getMe, signOut } from '@reportlog/contracts';
import type { Me, SystemRoleName } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export const meQuery = queryOptions({
  queryKey: ['identity', 'me'],
  queryFn: ({ signal }) => call(getMe, { signal }),
  staleTime: 60_000,
});

export function useMe() {
  return useQuery(meQuery);
}

export type SignedInMe = Extract<Me, { signedIn: true }>;

/** Refetch everything that depends on who is signed in. */
export function useIdentityChanged() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['identity'] });
}

export function useSignOut() {
  const changed = useIdentityChanged();
  return useMutation({
    mutationFn: () => call(signOut),
    onSuccess: changed,
  });
}

/** What each role is called on screen. */
export const ROLE_LABELS: Record<SystemRoleName, string> = {
  user: 'No role',
  moderator: 'Moderator',
  access_manager: 'Access Manager',
  admin: 'Administrator',
  owner: 'Owner',
  journalist: 'Journalist',
};

/** Everything somebody holds, in words: "Moderator, Access Manager", or "No role". */
export function rolesLabel(roles: readonly SystemRoleName[]): string {
  return roles.length ? roles.map((r) => ROLE_LABELS[r]).join(', ') : ROLE_LABELS.user;
}

export const ROLE_EXPLAINED: Record<SystemRoleName, string> = {
  user: 'Can sign in and see their own reports. No access to anybody else’s.',
  moderator: 'Reads and moderates reports.',
  access_manager:
    'Makes and removes Moderators and organizations. Cannot make another Access Manager.',
  admin: 'Runs the deployment. Can make Access Managers, but not another administrator.',
  owner: 'The one person who appoints administrators and can hand the deployment on.',
  journalist:
    'A vetted journalist. Reads the desk of checked links, and nothing else. Only the owner approves one.',
};
