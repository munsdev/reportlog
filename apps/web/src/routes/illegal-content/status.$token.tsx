import { createFileRoute } from '@tanstack/react-router';
import { NoticeStatusPage } from '../../features/platform/IllegalContent.tsx';

export const Route = createFileRoute('/illegal-content/status/$token')({
  component: Status,
});

function Status() {
  const { token } = Route.useParams();
  return <NoticeStatusPage token={token} />;
}
