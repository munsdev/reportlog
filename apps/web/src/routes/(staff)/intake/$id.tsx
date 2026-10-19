import { createFileRoute } from '@tanstack/react-router';
import { BatchPage } from '../../../features/intake/BatchPage.tsx';

export const Route = createFileRoute('/(staff)/intake/$id')({
  component: Batch,
});

function Batch() {
  const { id } = Route.useParams();
  return <BatchPage id={Number(id)} />;
}
