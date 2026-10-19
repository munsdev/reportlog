import { createFileRoute, useRouter } from '@tanstack/react-router';
import { FilingForm } from '../../features/form/FilingForm.tsx';

export const Route = createFileRoute('/file/$slug')({
  component: FilePage,
});

function FilePage() {
  const { slug } = Route.useParams();
  // The router's history, so each card is an entry in it.
  const { history } = useRouter();
  return <FilingForm slug={slug} history={history} />;
}
