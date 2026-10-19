import { createFileRoute } from '@tanstack/react-router';
import { ListingPage } from '../../features/site-pages/Directory.tsx';

export const Route = createFileRoute('/organizations/$id/listing')({
  component: function Listing() {
    const { id } = Route.useParams();
    return <ListingPage id={Number(id)} />;
  },
});
