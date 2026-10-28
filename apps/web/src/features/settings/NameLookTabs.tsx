import { useLocation } from '@tanstack/react-router';
import { PTabs } from '@/mockup/PTabs.tsx';

/** "Name and look": how the site names itself and how it looks, one menu entry, two tabs. */
export function NameLookTabs() {
  const here = useLocation().pathname.replace(/\/+$/, '');
  return (
    <PTabs
      label="Sections"
      tabs={[
        { to: '/settings/name', label: 'Name', current: here === '/settings/name' },
        { to: '/settings/look', label: 'Look', current: here === '/settings/look' },
      ]}
    />
  );
}
