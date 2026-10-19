import { createFileRoute } from '@tanstack/react-router';
import { OrganizationsPage } from '../../../features/identity/Organizations.tsx';

export const Route = createFileRoute('/(staff)/access/orgs/')({
  component: OrganizationsPage,
});
