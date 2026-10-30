import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { OwnerQueuePage } from '../../../features/journalists/OwnerQueue.tsx';

// The people who decide (decision 80): the server's /api/owner/journalists scope admits
// administrators, which the owner satisfies, and Access Managers.
export const Route = createFileRoute('/(staff)/access/journalists')({
  component: () => (
    <StaffOnly needs={['admin', 'access_manager']}>
      <OwnerQueuePage />
    </StaffOnly>
  ),
});
