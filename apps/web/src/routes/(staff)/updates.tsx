import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../features/identity/StaffOnly.tsx';
import { UpdatesPage } from '../../features/updates/UpdatesPage.tsx';

// Administrators, the owner included: the server's scope asks the same.
export const Route = createFileRoute('/(staff)/updates')({
  component: () => (
    <StaffOnly needs="admin">
      <UpdatesPage />
    </StaffOnly>
  ),
});
