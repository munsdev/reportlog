import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { SettingsPage } from '../../../features/moderation/Settings.tsx';

export const Route = createFileRoute('/(staff)/moderate/settings')({
  component: () => (
    <StaffOnly needs="admin">
      <SettingsPage />
    </StaffOnly>
  ),
});
