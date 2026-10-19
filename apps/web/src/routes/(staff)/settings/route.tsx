/**
 * The site settings: how it looks, what it is called, the words on its
 * pages, its legal notices and its front page. Administrators only: the
 * server refuses everybody else, and StaffOnly says so before it has to.
 */
import { Link, Outlet, createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';

export const Route = createFileRoute('/(staff)/settings')({
  component: SettingsLayout,
});

const SECTIONS = [
  { to: '/settings/look', label: 'Look' },
  { to: '/settings/name', label: 'Name' },
  { to: '/settings/words', label: 'Page wording' },
  { to: '/settings/legal', label: 'Legal notices' },
  // Arranged on the logbooks side, which knows when a logbook closes.
  { to: '/logbooks/front-page', label: 'Front page' },
] as const;

function SettingsLayout() {
  return (
    <StaffOnly needs="admin">
      <div className="flex flex-col gap-6">
        <nav aria-label="Site settings">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 border-b border-line pb-3 text-sm font-semibold">
            {SECTIONS.map((s) => (
              <li key={s.to}>
                <Link
                  to={s.to}
                  className="underline-offset-4 hover:underline aria-[current=page]:underline"
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Outlet />
      </div>
    </StaffOnly>
  );
}
