/** Every logbook screen is for administrators (which includes the owner). */
import { Outlet, createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';

export const Route = createFileRoute('/(staff)/logbooks')({
  component: () => (
    <StaffOnly needs="admin">
      <Outlet />
    </StaffOnly>
  ),
});
