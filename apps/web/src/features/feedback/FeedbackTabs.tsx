import { hasAdminAuthority } from '@reportlog/access';
import { useLocation } from '@tanstack/react-router';
import { PTabs } from '@/mockup/PTabs.tsx';
import { useMe } from '../identity/session.ts';

/**
 * Feedback's sections: filing and reading, and for administrators the queue
 * where issues are moved between states. One menu entry instead of two pages
 * both called "Feedback". Nobody else is shown tabs: they have only the one.
 */
export function FeedbackTabs() {
  const me = useMe();
  const here = useLocation().pathname.replace(/\/+$/, '');
  if (!(me.data?.signedIn === true && hasAdminAuthority(me.data.roles))) return null;
  return (
    <PTabs
      label="Sections"
      tabs={[
        { to: '/feedback', label: 'Filed', current: here === '/feedback' },
        { to: '/settings/feedback', label: 'Queue', current: here === '/settings/feedback' },
      ]}
    />
  );
}
