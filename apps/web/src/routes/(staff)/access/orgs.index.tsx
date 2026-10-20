import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { OrganizationsPage } from '../../../features/identity/Organizations.tsx';

// Those who grant access: the same people the server's requireGranter admits.
export const Route = createFileRoute('/(staff)/access/orgs/')({
  component: () => (
    <StaffOnly needs={['admin', 'access_manager']}>
      <OrganizationsPage />
    </StaffOnly>
  ),
});
