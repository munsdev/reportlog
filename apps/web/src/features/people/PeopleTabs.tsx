import { useLocation } from '@tanstack/react-router';
import { PTabs } from '@/mockup/PTabs.tsx';

/** People's own sections: the directory, and the record of every change to it. */
export function PeopleTabs() {
  const here = useLocation().pathname.replace(/\/+$/, '');
  return (
    <PTabs
      label="Sections"
      tabs={[
        { to: '/people', label: 'People', current: here === '/people' },
        { to: '/people/history', label: 'History', current: here === '/people/history' },
      ]}
    />
  );
}
