import { createFileRoute } from '@tanstack/react-router';
import { JoinPage } from '../../features/flood/IntakeLinks.tsx';

export const Route = createFileRoute('/organizations/join/$token')({
  component: function Join() {
    return <JoinPage token={Route.useParams().token} />;
  },
});
