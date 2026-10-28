import { useLocation } from '@tanstack/react-router';
import { PTabs } from '@/mockup/PTabs.tsx';

/** Moderation rules' own sections: the rules, and the agreement moderators accept to work by them. */
export function RulesTabs() {
  const here = useLocation().pathname.replace(/\/+$/, '');
  return (
    <PTabs
      label="Sections"
      tabs={[
        { to: '/moderate/settings', label: 'Rules', current: here === '/moderate/settings' },
        {
          to: '/moderate/agreement',
          label: 'Moderator agreement',
          current: here === '/moderate/agreement',
        },
      ]}
    />
  );
}
