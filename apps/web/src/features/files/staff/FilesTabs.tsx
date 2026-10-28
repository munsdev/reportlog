import { hasAdminAuthority } from '@reportlog/access';
import { useLocation } from '@tanstack/react-router';
import { PTabs } from '@/mockup/PTabs.tsx';
import { useMe } from '../../identity/session.ts';

/**
 * Files waiting's sections, for administrators: the queue, and erasing one
 * report's file. Erasing was a tab of File limits; it acts on a report's
 * files, as this page does. A moderator has only the queue, so no tabs.
 */
export function FilesTabs() {
  const me = useMe();
  const here = useLocation().pathname.replace(/\/+$/, '');
  if (!(me.data?.signedIn === true && hasAdminAuthority(me.data.roles))) return null;
  return (
    <PTabs
      label="Sections"
      tabs={[
        { to: '/files', label: 'Waiting', current: here === '/files' },
        { to: '/files/erase', label: 'Erasing a file', current: here === '/files/erase' },
      ]}
    />
  );
}
