import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { OwnerQueuePage } from '../../../features/journalists/OwnerQueue.tsx';

// The owner only: the server's /api/owner/ scope admits nobody else (J7b).
export const Route = createFileRoute('/(staff)/access/journalists')({
  component: () => (
    <StaffOnly needs="owner">
      <OwnerQueuePage />
    </StaffOnly>
  ),
});
