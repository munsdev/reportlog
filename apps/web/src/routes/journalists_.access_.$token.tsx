import { createFileRoute } from '@tanstack/react-router';
import { AccessLinkPage } from '../features/journalists/AccessPages.tsx';

export const Route = createFileRoute('/journalists_/access_/$token')({
  component: Link,
});

function Link() {
  const { token } = Route.useParams();
  return <AccessLinkPage token={token} />;
}
