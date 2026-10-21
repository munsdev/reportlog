import { createFileRoute } from '@tanstack/react-router';
import { AlertSettingsPage } from '../features/journalists/AlertSettings.tsx';

export const Route = createFileRoute('/journalists_/settings/$token')({
  component: Settings,
});

function Settings() {
  const { token } = Route.useParams();
  return <AlertSettingsPage token={token} />;
}
