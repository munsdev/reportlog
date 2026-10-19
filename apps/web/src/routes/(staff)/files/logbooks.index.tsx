import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { LogbookLimitsList } from '../../../features/files/staff/FileAdmin.tsx';

export const Route = createFileRoute('/(staff)/files/logbooks/')({
  component: () => (
    <StaffOnly needs="admin">
      <LogbookLimitsList />
    </StaffOnly>
  ),
});
