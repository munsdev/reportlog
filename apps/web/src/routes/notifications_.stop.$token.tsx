import { createFileRoute } from '@tanstack/react-router';
import { DigestStopPage } from '../features/identity/DigestStopPage.tsx';

export const Route = createFileRoute('/notifications_/stop/$token')({
  component: DigestStop,
});

function DigestStop() {
  const { token } = Route.useParams();
  return <DigestStopPage token={token} />;
}
