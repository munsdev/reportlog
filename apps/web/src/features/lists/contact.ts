/**
 * The site's contact form: the one list an administrator marked as it
 * (Front page and pages, "Where each list appears"), while it is open to
 * the public. The footer, the site menu, About and the terms link to it, so
 * people write through a form rather than being handed an address.
 *
 * Read from the same call as Get involved (`/api/lists`, open lists only),
 * so a closed or hidden contact list is simply not linked. Asks nothing on a
 * door: a door page calls only what is named in front of the password.
 */
import { listOpenLists } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import { useGateMode } from '../identity/gateMode.ts';

export const openListsQuery = queryOptions({
  queryKey: ['open-lists'],
  queryFn: ({ signal }) => call(listOpenLists, { signal }),
});

/** The contact form's address and title, or null when there is none to link. */
export function useContactList(): { slug: string; title: string } | null {
  const door = useGateMode() === 'door';
  const lists = useQuery({ ...openListsQuery, enabled: !door });
  const found = lists.data?.lists.find((l) => l.is_contact);
  return found ? { slug: found.slug, title: found.title } : null;
}
