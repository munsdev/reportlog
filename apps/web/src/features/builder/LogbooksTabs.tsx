import { useLocation } from '@tanstack/react-router';
import { PTabs } from '@/mockup/PTabs.tsx';

/**
 * Logbooks' sections: the logbooks, and starting points, which fill in a
 * logbook, lists and wording at once. One menu entry instead of two
 * (staff-nav/menu.ts); a starting point is more than "Make a logbook", so it
 * keeps its own tab rather than hiding inside that form.
 */
export function LogbooksTabs() {
  const here = useLocation().pathname.replace(/\/+$/, '');
  return (
    <PTabs
      label="Sections"
      tabs={[
        { to: '/logbooks', label: 'Logbooks', current: here === '/logbooks' },
        {
          to: '/settings/starting-points',
          label: 'Starting points',
          current: here === '/settings/starting-points',
        },
      ]}
    />
  );
}
