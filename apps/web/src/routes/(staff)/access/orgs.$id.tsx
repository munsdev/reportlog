import { createFileRoute } from '@tanstack/react-router';
import { OrganizationPage } from '../../../features/identity/Organizations.tsx';

export const Route = createFileRoute('/(staff)/access/orgs/$id')({
  component: function Organization() {
    const { id } = Route.useParams();
    return <OrganizationPage id={Number(id)} />;
  },
});
