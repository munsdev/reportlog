import { createFileRoute } from '@tanstack/react-router';
import { AuditPage } from '../../../features/identity/AuditPage.tsx';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';

// Those who grant access: the same people the server's requireGranter admits.
export const Route = createFileRoute('/(staff)/access/audit')({
  component: () => (
    <StaffOnly needs={['admin', 'access_manager']}>
      <AuditPage />
    </StaffOnly>
  ),
});
