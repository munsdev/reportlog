import { createFileRoute } from '@tanstack/react-router';
import { AlertLinkPage } from '../features/journalists/AlertLinkPage.tsx';

export const Route = createFileRoute('/journalists_/stop/$token')({
  component: Link,
});

function Link() {
  const { token } = Route.useParams();
  return <AlertLinkPage kind="stop" token={token} />;
}
