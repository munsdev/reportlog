import { createFileRoute } from '@tanstack/react-router';
import { DeclarationPage } from './-Declaration.tsx';

export const Route = createFileRoute('/mine/declaration/$threadId')({
  component: Declaration,
});

function Declaration() {
  const { threadId } = Route.useParams();
  return <DeclarationPage threadId={threadId} />;
}
