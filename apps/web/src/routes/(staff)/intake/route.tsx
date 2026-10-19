/**
 * Coordinator intake. Every page here is for a coordinator or manager of an
 * organization, so the layout names the door once.
 */
import { Outlet, createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';

export const Route = createFileRoute('/(staff)/intake')({
  component: () => (
    <StaffOnly needs={{ organization: ['coordinator', 'manager'] }}>
      <Outlet />
    </StaffOnly>
  ),
});
