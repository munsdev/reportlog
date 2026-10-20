import { createFileRoute } from '@tanstack/react-router';
import { BackupsPage } from '../../features/backups/BackupsPage.tsx';
import { StaffOnly } from '../../features/identity/StaffOnly.tsx';

// The owner only: the server's scope asks the owner rank, and so does this.
export const Route = createFileRoute('/(staff)/backups')({
  component: () => (
    <StaffOnly needs="owner">
      <BackupsPage />
    </StaffOnly>
  ),
});
