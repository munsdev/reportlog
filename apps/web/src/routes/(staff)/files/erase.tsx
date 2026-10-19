import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { EraseFilePage } from '../../../features/files/staff/FileAdmin.tsx';

export const Route = createFileRoute('/(staff)/files/erase')({
  component: () => (
    <StaffOnly needs="admin">
      <EraseFilePage />
    </StaffOnly>
  ),
});
