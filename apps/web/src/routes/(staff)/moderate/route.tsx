/**
 * The moderation screens. Moderators and administrators both (as the API:
 * admin does not imply moderator, so both are named). The settings page
 * narrows itself to administrators.
 */
import { Link, Outlet, createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';

export const Route = createFileRoute('/(staff)/moderate')({
  component: ModerateLayout,
});

function ModerateLayout() {
  return (
    <StaffOnly needs={['moderator', 'admin']}>
      <div className="flex flex-col gap-6">
        <nav aria-label="Moderation">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 border-b border-line pb-3 text-sm font-semibold">
            <li>
              <Link to="/moderate" className="underline-offset-4 hover:underline">
                Queue
              </Link>
            </li>
            <li>
              <Link to="/board" className="underline-offset-4 hover:underline">
                The public board
              </Link>
            </li>
            <li>
              <Link to="/moderate/settings" className="underline-offset-4 hover:underline">
                Settings
              </Link>
            </li>
          </ul>
        </nav>
        <Outlet />
      </div>
    </StaffOnly>
  );
}
