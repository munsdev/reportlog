import { createFileRoute } from '@tanstack/react-router';
import { ConfirmPage } from '../../../features/form/ConfirmPage.tsx';

export const Route = createFileRoute('/file/confirm/$token')({
  component: Confirm,
});

function Confirm() {
  const { token } = Route.useParams();
  return <ConfirmPage token={token} />;
}
