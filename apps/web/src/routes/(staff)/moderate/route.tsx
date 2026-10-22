/**
 * The moderation screens. Moderators and administrators both (as the API:
 * admin does not imply moderator, so both are named). The settings page
 * narrows itself to administrators.
 *
 * Its pages are reached from the menu and the area tabs (features/nav, the
 * Moderation area in features/staff-nav/entries.ts), not from a row here.
 */
import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { AgreementGate } from '../../../features/platform/Agreement.tsx';

export const Route = createFileRoute('/(staff)/moderate')({
  component: ModerateLayout,
});

// The administrator's own pages are not behind the agreement they publish.
const NOT_GATED = ['/moderate/agreement', '/moderate/settings'];

function ModerateLayout() {
  const { pathname } = useLocation();
  const gated = !NOT_GATED.some((p) => pathname.startsWith(p));
  return (
    <StaffOnly needs={['moderator', 'admin']}>
      <div className="flex flex-col gap-6">
        {gated ? (
          <AgreementGate audience="moderator">
            <Outlet />
          </AgreementGate>
        ) : (
          <Outlet />
        )}
      </div>
    </StaffOnly>
  );
}
