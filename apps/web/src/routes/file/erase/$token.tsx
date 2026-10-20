import { createFileRoute } from '@tanstack/react-router';
import { ErasePage } from '../../../features/platform/ErasePage.tsx';

export const Route = createFileRoute('/file/erase/$token')({
  component: Erase,
});

function Erase() {
  const { token } = Route.useParams();
  return <ErasePage token={token} />;
}
