import { createFileRoute } from '@tanstack/react-router';
import { CorrectFiling } from '../../../features/intake/CorrectFiling.tsx';

export const Route = createFileRoute('/(staff)/intake/reports/$threadId')({
  component: Correct,
});

function Correct() {
  const { threadId } = Route.useParams();
  return <CorrectFiling threadId={threadId} />;
}
