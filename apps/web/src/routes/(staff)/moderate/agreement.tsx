import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { AgreementAdminPage } from '../../../features/platform/Agreement.tsx';

export const Route = createFileRoute('/(staff)/moderate/agreement')({
  component: () => (
    <StaffOnly needs="admin">
      <AgreementAdminPage audience="moderator" />
    </StaffOnly>
  ),
});
