import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { AgreementAdminPage } from '../../../features/platform/Agreement.tsx';

// Publishing is an administrator's call on the server, as for moderators;
// the page sits with the owner's queue, so the owner is who it asks for.
export const Route = createFileRoute('/(staff)/access/journalists_/agreement')({
  component: () => (
    <StaffOnly needs="owner">
      <AgreementAdminPage audience="journalist" />
    </StaffOnly>
  ),
});
