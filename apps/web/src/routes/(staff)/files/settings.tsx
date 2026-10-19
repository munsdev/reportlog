import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { FileSettingsPage } from '../../../features/files/staff/FileAdmin.tsx';

export const Route = createFileRoute('/(staff)/files/settings')({
  component: () => (
    <StaffOnly needs="admin">
      <FileSettingsPage />
    </StaffOnly>
  ),
});
