import { createFileRoute } from '@tanstack/react-router';
import { FilingForm } from '../../features/form/FilingForm.tsx';

export const Route = createFileRoute('/file/$slug')({
  component: FilePage,
});

function FilePage() {
  const { slug } = Route.useParams();
  return <FilingForm slug={slug} />;
}
