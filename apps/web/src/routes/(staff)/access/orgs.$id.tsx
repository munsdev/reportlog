import { createFileRoute } from '@tanstack/react-router';
import { OrganizationPage } from '../../../features/identity/Organizations.tsx';
import { OnlyFor } from '../../../features/staff-nav/OnlyFor.tsx';

export const Route = createFileRoute('/(staff)/access/orgs/$id')({
  component: function Organization() {
    const { id } = Route.useParams();
    // The server (requireOrgAuthority) admits those who grant access and a
    // manager of THIS organization. The door can only ask "in some
    // organization", so a coordinator, or a manager of another one, gets
    // past it and is then refused by the server, which the page shows.
    return (
      <OnlyFor
        audience={['admin', 'access_manager', 'organization']}
        who="administrators, Access Managers and the organization’s managers"
      >
        <OrganizationPage id={Number(id)} />
      </OnlyFor>
    );
  },
});
