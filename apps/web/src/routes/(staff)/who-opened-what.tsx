import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../features/identity/StaffOnly.tsx';
import { AccessLogPage } from '../../features/moderation/AccessLog.tsx';

// Records: who opened protected data. The access-log call is an
// administrator's on the server, as it was inside Moderation settings.
export const Route = createFileRoute('/(staff)/who-opened-what')({
  component: () => (
    <StaffOnly needs="admin">
      <AccessLogPage />
    </StaffOnly>
  ),
});
