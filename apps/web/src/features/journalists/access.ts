/**
 * Whether the signed-in person gets the journalists' extras on the board
 * (decision 81): they hold the role and have accepted the newest agreement.
 * The server asks the same on every call, so this only decides what to draw.
 *
 * `agreement` is a journalist who still has to accept: the board is the
 * public one for them, with the way to accept (/desk, which asks).
 */
import { useQuery } from '@tanstack/react-query';
import { agreementQuery } from '../platform/Agreement.tsx';
import { useMe } from '../identity/session.ts';

/** `loading`: a journalist whose agreement is not read yet, so nothing is decided. */
export type JournalistAccess = 'no' | 'loading' | 'agreement' | 'yes';

export function useJournalistAccess(): JournalistAccess {
  const me = useMe().data;
  const isJournalist = me?.signedIn === true && me.roles.includes('journalist');
  const agreement = useQuery({ ...agreementQuery('journalist'), enabled: isJournalist });
  if (!isJournalist) return 'no';
  if (!agreement.data) return agreement.isError ? 'no' : 'loading';
  // No text published: the server keeps the desk shut, so no extras.
  if (!agreement.data.current) return 'no';
  return agreement.data.accepted ? 'yes' : 'agreement';
}
