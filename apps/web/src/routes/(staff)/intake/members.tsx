import { createFileRoute } from '@tanstack/react-router';
import { OrganizationJump } from '../../../features/intake/OrganizationJump.tsx';

export const Route = createFileRoute('/(staff)/intake/members')({
  component: () => <OrganizationJump where="members" />,
});
