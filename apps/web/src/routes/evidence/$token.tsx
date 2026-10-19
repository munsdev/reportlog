import { createFileRoute } from '@tanstack/react-router';
import { EvidencePage } from '../../features/files/EvidencePage.tsx';

export const Route = createFileRoute('/evidence/$token')({
  component: Evidence,
});

function Evidence() {
  const { token } = Route.useParams();
  return <EvidencePage token={token} />;
}
